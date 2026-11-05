import type { RepairIssue } from './types';

/**
 * Pulls the JSON out of an AI chat answer.
 *
 * 1. A fenced block (```json … ``` or ~~~ … ~~~), anywhere in the text: the fenced content is the JSON. Prose before
 *    the opening fence and after the closing fence is dropped. A fence that never closes (the answer was cut off)
 *    runs to the end of the input — the truncation stage closes the JSON after this.
 * 2. `{...}` wrapped in single inline backticks.
 * 3. No fence, but prose around a JSON object/array ("Here is the JSON:\n{…}\nHope that helps!"): the outermost
 *    `{…}` / `[…]` value is kept; English before and after it is dropped.
 *
 * Without this, prose reached the fallback parser, which turned every English word into an array element
 * (`["Sure!", "Here", …]`) and still reported valid JSON.
 *
 * Returns null if nothing was stripped.
 */
export function stripMarkdownFences(
  input: string,
): { result: string; issue: RepairIssue } | null {
  const trimmed = input.trim();

  const fenced = extractFenced(trimmed);
  if (fenced) {
    const { content, before, after, kind, closed } = fenced;
    const extras: string[] = [];
    if (before) extras.push('the prose before it');
    if (after) extras.push('the prose after it');
    const what = `${kind} wrapping the JSON${extras.length ? `, and ${extras.join(' and ')}` : ''}`;
    return makeResult(input, content, `Stripped ${what}${closed ? '' : ' (the fence never closed — the JSON was cut off)'}`);
  }

  // Inline single-backtick wrapping entire content: `{...}`
  if (trimmed.startsWith('`') && trimmed.endsWith('`') && !trimmed.startsWith('``')) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner.startsWith('{') || inner.startsWith('[')) {
      return makeResult(input, inner, 'Stripped the inline backticks wrapping the JSON');
    }
  }

  const prose = extractFromProse(trimmed);
  if (prose) return makeResult(input, prose.content, `Stripped ${prose.detail} (kept only the JSON)`);

  return null;
}

// ─── Fenced blocks ───────────────────────────────────────────────────────────

interface Fenced { content: string; before: boolean; after: boolean; kind: string; closed: boolean }

const JSONISH_TAG = /^(?:json[c5l]?|ndjson|jsonl|js|javascript|ts|typescript|python|py|text|txt)?$/i;

function extractFenced(text: string): Fenced | null {
  // an opening fence: ``` or ~~~ at the start of a line, with an optional language tag
  const openRe = /(^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+.-]*)[ \t]*/g;
  let firstJsonish: Fenced | null = null;
  let whole: Fenced | null = null;
  let m: RegExpExecArray | null;
  // each opener rescans the text, so a pasted wall of fences would stall the server: real answers have a handful
  for (let seen = 0; seen < 100 && (m = openRe.exec(text)); seen++) {
    const fence = m[2]!;
    const tag = m[3]!;
    const fenceStart = m.index + m[1]!.length;
    const contentStart = m.index + m[0].length;
    // the closing fence: the same run of ` or ~ (usually on its own line; some models put it right after the JSON)
    const close = text.indexOf(fence, contentStart);
    const closed = close !== -1;
    const content = text.slice(contentStart, closed ? close : text.length).trim();
    const block: Fenced = {
      content,
      before: text.slice(0, fenceStart).trim().length > 0,
      after: closed && text.slice(close + fence.length).trim().length > 0,
      kind: fence[0] === '~' ? 'tilde code fence (~~~)' : 'triple-backtick code fence',
      closed,
    };
    if (!block.before && !block.after) whole = block;
    if (JSONISH_TAG.test(tag) && content) {
      if (/^[[{]/.test(content)) return block;
      firstJsonish ??= /^json/i.test(tag) || !tag ? block : null;
    }
    if (!closed) break;
    openRe.lastIndex = close + fence.length; // the next block starts after this one's closing fence
  }
  return firstJsonish ?? whole;
}

// ─── Prose around a bare JSON value ──────────────────────────────────────────

/**
 * "Here is the JSON:\n{…}\nLet me know!" → `{…}`. Only when the text before the value starts with a letter (an
 * English lead-in, not a key, a quote or a comment) or the text after it does. A value that never closes (cut off)
 * keeps everything from its opening bracket on.
 */
function extractFromProse(text: string): { content: string; detail: string } | null {
  const first = text[0];
  if (first === '{' || first === '[') {
    // JSON first: only trailing prose can be dropped
    const end = matchingClose(text, 0);
    if (end === -1) return null;
    const tail = text.slice(end + 1).trim();
    if (!isProse(tail)) return null;
    return { content: text.slice(0, end + 1), detail: 'trailing prose after the JSON' };
  }
  if (!/^[A-Za-z]/.test(text)) return null;
  // a lead-in: the JSON starts at the first { or [ that opens a line, else after a colon, else the first one at all
  const start = firstMatch(text, /(?:^|\n)[ \t]*([[{])/) ?? firstMatch(text, /:\s*([[{])/) ?? firstMatch(text, /([[{])/);
  if (start === null) return null;
  const lead = text.slice(0, start);
  if (!isProse(lead)) return null;
  const end = matchingClose(text, start);
  if (end === -1) return { content: text.slice(start), detail: 'prose before the JSON' };
  const tail = text.slice(end + 1).trim();
  if (tail && !isProse(tail)) return { content: text.slice(start), detail: 'prose before the JSON' };
  return { content: text.slice(start, end + 1), detail: tail ? 'prose before and after the JSON' : 'prose before the JSON' };
}

/** English text: starts with a letter and has at least one more word, or ends a sentence. Not true/false/null/None. */
function isProse(s: string): boolean {
  const t = s.trim();
  if (!t || !/^[A-Za-z]/.test(t)) return false;
  if (/^(?:true|false|null|none|nan|undefined|infinity)\b/i.test(t) && !/\s\S+\s/.test(t)) return false;
  return /^[A-Za-z][\w'’-]*[\s!?.,:;]/.test(t) || /[.!?:]$/.test(t);
}

function firstMatch(text: string, re: RegExp): number | null {
  const m = re.exec(text);
  if (!m) return null;
  return m.index + m[0].length - 1;
}

/** Index of the bracket that closes the one at `start` (strings in " or ' skipped), or -1 when it never closes. */
function matchingClose(text: string, start: number): number {
  let depth = 0;
  const n = text.length;
  for (let i = start; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 34 || (c === 39 && depth > 0 && isStringOpener(text, i))) {
      // skip a string
      let j = i + 1;
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === 92) { j += 2; continue; }
        if (d === c) break;
        j++;
      }
      if (j >= n) return -1;
      i = j;
      continue;
    }
    if (c === 123 || c === 91) depth++;
    else if (c === 125 || c === 93) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** A ' opens a string only in a value/key position (after { [ , : or whitespace), not as an apostrophe in a word. */
function isStringOpener(text: string, i: number): boolean {
  let k = i - 1;
  while (k >= 0 && /\s/.test(text[k]!)) k--;
  return k < 0 || '{[,:'.includes(text[k]!);
}

function makeResult(
  original: string,
  extracted: string,
  description: string,
): { result: string; issue: RepairIssue } {
  return {
    result: extracted,
    issue: {
      category: 'markdown',
      severity: 'fixed',
      description,
      line: 1,
      col: 1,
      before: original.slice(0, 40).replace(/\n/g, '↵') + (original.length > 40 ? '…' : ''),
      after: extracted.slice(0, 40).replace(/\n/g, '↵') + (extracted.length > 40 ? '…' : ''),
    },
  };
}
