/**
 * Lossless JSON formatting: re-indents (or strips) the whitespace of an already-valid JSON text, token by token.
 *
 * `JSON.stringify(JSON.parse(x))` turns every number into a JS double first, so 1849203948571234567 came out as
 * 1849203948571234600, 9007199254740993 as …992, 1e400 as null and 10.50 as 10.5 — on a page that said "already
 * valid". Here numbers, strings and literals are copied verbatim; only whitespace between tokens changes. Duplicate
 * keys are kept too (the duplicate-key warning reports them).
 *
 * The caller must pass valid JSON (check with JSON.parse first); on anything else the result is unspecified.
 */

const INDENT_CACHE: string[] = [''];

/** Formats like `JSON.stringify(value, null, indent)` but without converting values. indent 0 → minified. */
export function formatJsonLossless(input: string, indent: number | string = 2): string {
  const unit = typeof indent === 'string' ? indent.slice(0, 10) : ' '.repeat(Math.max(0, Math.min(10, Math.floor(indent) || 0)));
  const pretty = unit.length > 0;
  INDENT_CACHE.length = 1;
  const pad = (depth: number): string => {
    while (INDENT_CACHE.length <= depth) INDENT_CACHE.push(INDENT_CACHE[INDENT_CACHE.length - 1] + unit);
    return INDENT_CACHE[depth]!;
  };

  const out: string[] = [];
  const n = input.length;
  let depth = 0;
  let i = 0;

  const skipWs = (from: number): number => {
    let k = from;
    while (k < n) {
      const c = input.charCodeAt(k);
      if (c === 32 || c === 10 || c === 13 || c === 9) k++;
      else break;
    }
    return k;
  };

  while (i < n) {
    const c = input.charCodeAt(i);
    if (c === 32 || c === 10 || c === 13 || c === 9) { i++; continue; }

    if (c === 34) { // string, verbatim
      let j = i + 1;
      while (j < n) {
        const d = input.charCodeAt(j);
        if (d === 92) { j += 2; continue; }
        if (d === 34) break;
        j++;
      }
      out.push(input.slice(i, j + 1));
      i = j + 1;
      continue;
    }

    if (c === 123 || c === 91) { // { [
      const next = skipWs(i + 1);
      const closer = c === 123 ? 125 : 93;
      if (input.charCodeAt(next) === closer) { // empty: {} / []
        out.push(c === 123 ? '{}' : '[]');
        i = next + 1;
        continue;
      }
      depth++;
      out.push(pretty ? `${input[i]}\n${pad(depth)}` : input[i]!);
      i++;
      continue;
    }

    if (c === 125 || c === 93) { // } ]
      depth--;
      out.push(pretty ? `\n${pad(depth)}${input[i]}` : input[i]!);
      i++;
      continue;
    }

    if (c === 44) { out.push(pretty ? `,\n${pad(depth)}` : ','); i++; continue; } // ,
    if (c === 58) { out.push(pretty ? ': ' : ':'); i++; continue; } // :

    // number / true / false / null, verbatim up to the next delimiter or whitespace
    let j = i + 1;
    while (j < n) {
      const d = input.charCodeAt(j);
      if (d === 44 || d === 58 || d === 93 || d === 125 || d === 32 || d === 10 || d === 13 || d === 9) break;
      j++;
    }
    out.push(input.slice(i, j));
    i = j;
  }
  return out.join('');
}
