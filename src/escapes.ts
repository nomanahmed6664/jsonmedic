import type { RepairIssue } from './types';

/**
 * Doubles a backslash that does not start a valid JSON escape (\" \\ \/ \b \f \n \r \t \uXXXX), inside strings only.
 *
 * `"C:\Users\sam"` and `"\d+\.\d+"` are what a Windows path or a regex looks like when it is pasted without escaping.
 * Without this stage the fallback parser dropped the backslash (`C:Userssam`, `d+.d+`) and reported nothing — the
 * output was valid JSON with different data. Doubling keeps the text exactly what the author meant.
 *
 * Windows paths get one more rule. In `"C:\Users\sam\new_app"` or `"C:\temp\build"` the `\n`, `\t` and `\b` are
 * valid JSON escapes, but nobody means a newline, tab or backspace inside a path — they are folder separators. So in a
 * string that looks like a Windows path (`X:\…`, `\\server\…`, or containing `\Users\`, `\Program Files`, `\Windows\`)
 * and that still has a lone backslash, every lone backslash is doubled, valid escape or not. A path whose backslashes
 * are all already doubled (`"C:\\Windows\\System32"`) is left alone.
 */
export function fixInvalidEscapes(input: string): { result: string; issues: RepairIssue[] } {
  const issues: RepairIssue[] = [];
  const parts: string[] = [];
  let copied = 0;
  let line = 1;
  let lineAt = 0;
  const lineOf = (pos: number) => {
    for (; lineAt < pos; lineAt++) if (input.charCodeAt(lineAt) === 10) line++;
    return line;
  };
  const colOf = (pos: number) => pos - input.lastIndexOf('\n', pos - 1);

  const n = input.length;
  let i = 0;
  while (i < n) {
    if (input.charCodeAt(i) !== 34) { i++; continue; }
    // a string: find its end and whether it has any backslash at all
    const start = i;
    let j = i + 1;
    let hasBackslash = false;
    while (j < n) {
      const c = input.charCodeAt(j);
      if (c === 92) { hasBackslash = true; j += 2; continue; }
      if (c === 34) break;
      j++;
    }
    const end = Math.min(j, n); // index of the closing quote (or n)
    i = end + 1;
    if (!hasBackslash) continue;

    const body = input.slice(start + 1, end);
    const fixed = fixStringBody(body, start + 1);
    if (fixed.out === body) continue;
    parts.push(input.slice(copied, start + 1), fixed.out);
    copied = end;
    for (const f of fixed.fixes) issues.push({ ...f, line: lineOf(f.pos), col: colOf(f.pos) });
  }
  if (!parts.length) return { result: input, issues };
  parts.push(input.slice(copied));
  return { result: parts.join(''), issues };
}

type Fix = Omit<RepairIssue, 'line' | 'col'> & { pos: number };

const WIN_PATH = /^\s*(?:[A-Za-z]:\\|\\\\[A-Za-z0-9._$-]+\\)|\\(?:Users|Program Files|Windows)\\/i;

/** True when a string body (raw source text) reads as a Windows path with at least one lone (undoubled) backslash. */
export function isRawWindowsPath(body: string): boolean {
  if (!WIN_PATH.test(body)) return false;
  for (let k = 0; k < body.length; k++) {
    if (body.charCodeAt(k) !== 92) continue;
    if (body.charCodeAt(k + 1) === 92) { k++; continue; }
    return true;
  }
  return false;
}

function fixStringBody(body: string, offset: number): { out: string; fixes: Fix[] } {
  const fixes: Fix[] = [];
  if (isRawWindowsPath(body)) {
    // Every lone backslash is a path separator. A leading `\\` is the UNC prefix (two literal backslashes);
    // other doubled pairs were already escaped and stay as they are.
    let out = '';
    let from = 0;
    let k = 0;
    if (/^\\\\[^\\]/.test(body)) { out = '\\\\\\\\'; from = k = 2; }
    for (; k < body.length; k++) {
      if (body.charCodeAt(k) !== 92) continue;
      if (body.charCodeAt(k + 1) === 92) { k++; continue; }
      out += body.slice(from, k) + '\\\\';
      from = k + 1;
    }
    out += body.slice(from);
    const shown = body.length > 60 ? `${body.slice(0, 57)}…` : body;
    fixes.push({
      category: 'escapes',
      severity: 'warning',
      description: 'Read a Windows path: kept every backslash as a folder separator (\\n, \\t, \\b in a path are not a new line, tab or backspace)',
      before: shown,
      after: out.length > 60 ? `${out.slice(0, 57)}…` : out,
      pos: offset,
    });
    return { out, fixes };
  }

  let out = '';
  let from = 0;
  for (let k = 0; k < body.length; k++) {
    if (body.charCodeAt(k) !== 92) continue;
    const next = body[k + 1];
    if (next !== undefined && '"\\/bfnrt'.includes(next)) { k++; continue; }
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(k + 2, k + 6))) { k += 5; continue; }
    if (next === "'") { // \' means an apostrophe; a JSON string needs no escape for it
      out += body.slice(from, k) + "'";
      from = k + 2;
      fixes.push({ category: 'escapes', severity: 'fixed', description: "Removed the backslash before ' — an apostrophe needs no escape in JSON", before: "\\'", after: "'", pos: offset + k });
      k++;
      continue;
    }
    // an escape JSON does not know: keep the backslash as a character
    out += body.slice(from, k) + '\\\\';
    from = k + 1;
    const seq = next === undefined ? '\\' : `\\${next}`;
    fixes.push({ category: 'escapes', severity: 'fixed', description: `Doubled the backslash in ${seq} — it is not a JSON escape`, before: seq, after: `\\${seq}`, pos: offset + k });
  }
  out += body.slice(from);
  return { out, fixes };
}
