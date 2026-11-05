/**
 * Shared, linear-time scanning helpers for the repair stages.
 *
 * The stages used to build their output one character at a time (`out += ch`) and to copy every string literal char by
 * char; on a 3 MB paste that froze the tab for over a minute. These helpers find boundaries with charCodeAt and copy
 * whole runs with slice, so each stage is one pass with a handful of allocations.
 */

const BACKSLASH = 92;

/**
 * `i` points at an opening quote (" or '). Returns the index just after the matching closing quote, honouring backslash
 * escapes — or input.length when the string never closes.
 */
export function skipString(input: string, i: number): number {
  const quote = input.charCodeAt(i);
  const n = input.length;
  let j = i + 1;
  while (j < n) {
    const c = input.charCodeAt(j);
    if (c === BACKSLASH) { j += 2; continue; }
    if (c === quote) return j + 1;
    j++;
  }
  return n;
}

/** Index of the next " or ' at or after `from`, or input.length. */
export function nextQuote(input: string, from: number): number {
  const n = input.length;
  for (let j = from; j < n; j++) {
    const c = input.charCodeAt(j);
    if (c === 34 || c === 39) return j;
  }
  return n;
}

/** Applies `fn` to every stretch outside quoted strings; quoted strings (" or ') are copied through verbatim. */
export function mapNonStringSegments(input: string, fn: (seg: string) => string): string {
  const parts: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const q = nextQuote(input, i);
    if (q > i) parts.push(fn(input.slice(i, q)));
    if (q >= n) break;
    const end = skipString(input, q);
    parts.push(input.slice(q, end));
    i = end;
  }
  return parts.join('');
}

/** Line number (1-based) of increasing positions, counted incrementally: call with non-decreasing `pos` only. */
export function lineCounter(input: string): (pos: number) => number {
  let line = 1;
  let at = 0;
  return (pos: number) => {
    for (; at < pos; at++) if (input.charCodeAt(at) === 10) line++;
    return line;
  };
}

/**
 * `seg.replace(re, replacer)` on every stretch outside quoted strings. `re` must be global and must never match a quote
 * character, so a match lies wholly inside or wholly outside a string — that lets one test over the whole input skip the
 * segment walk when nothing can match (the common case).
 */
export function replaceOutsideStrings(
  input: string,
  re: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): string {
  re.lastIndex = 0;
  const any = re.test(input);
  re.lastIndex = 0;
  if (!any) return input;
  return mapNonStringSegments(input, (seg) => seg.replace(re, replacer as (m: string, ...a: unknown[]) => string));
}

/** `/\s/.test(ch)` for the char code `c`, without a regex call for the ASCII cases. */
export function isWsCode(c: number): boolean {
  if (c === 32 || c === 10 || c === 13 || c === 9 || c === 11 || c === 12) return true;
  if (c < 128) return false;
  return /\s/.test(String.fromCharCode(c));
}
