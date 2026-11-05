import type { RepairIssue } from './types';
import { replaceOutsideStrings, skipString } from './scan';

/**
 * Trailing comma removal and missing comma insertion.
 *
 * Trailing commas:
 *   {"a":1,}       → {"a":1}
 *   [1, 2, 3,]     → [1, 2, 3]
 *   {"a":1,\n}     → {"a":1\n}
 *
 * Missing commas:
 *   {"a":1 "b":2}  → {"a":1,"b":2}
 *   [1 2 3]        → [1,2,3]
 *
 * Both transforms operate only outside string values.
 */

export function fixTrailingCommas(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];

  // Match: comma followed by optional whitespace then ] or }
  // We use the outside-strings replacement to avoid hitting content
  const trailingRe = /,(\s*)([\]}])/g;
  const result = replaceOutsideStrings(input, trailingRe, (_match, ws = '', close = '') => {
    issues.push({
      category: 'trailing-comma',
      severity: 'fixed',
      description: `Removed trailing comma before '${close}'`,
      line: null,
      col: null,
      before: `,${ws}${close}`,
      after: `${ws}${close}`,
    });
    return `${ws}${close}`;
  });

  return { result, issues };
}

export function fixMissingCommas(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];

  // Patterns where a comma is missing between two values:
  //
  // Case 1: closing delimiter (} or ]) followed by whitespace then opening ({, [, ", ')
  //   ...}\n{...  →  ...},\n{...
  //   ...]\n"...  →  ...],\n"...
  //
  // Case 2: a string value followed by whitespace then a new key or value
  //   "a" "b"  →  "a","b"
  //   1 "b"    →  1,"b"
  //   true "b" →  true,"b"

  // We need a careful approach: scan the token stream for adjacent values
  // missing a comma separator.

  const result = insertMissingCommas(input, issues);
  return { result, issues };
}

/**
 * Insert missing commas between adjacent JSON values/keys.
 * Uses a lightweight token scanner rather than full parsing.
 */
function insertMissingCommas(input: string, issues: RepairIssue[]): string {
  // Copy runs with slice and only splice in the commas (per-character `output +=` was the slow part on big input).
  const parts: string[] = [];
  let copied = 0;
  let i = 0;
  let insertions = 0;
  const n = input.length;

  // Track what kind of token we just finished emitting
  type LastToken = 'value' | 'comma' | 'colon' | 'open' | 'close' | 'none';
  let lastToken: LastToken = 'none';
  const comma = () => {
    if (lastToken === 'value' || lastToken === 'close') {
      parts.push(input.slice(copied, i), ',');
      copied = i;
      insertions++;
    }
  };

  while (i < n) {
    const ch = input[i]!;
    const c = input.charCodeAt(i);

    if (c === 32 || c === 10 || c === 13 || c === 9 || (c > 127 && /\s/.test(ch)) || c === 11 || c === 12) { i++; continue; }

    if (ch === '"' || ch === "'") { comma(); i = skipString(input, i); lastToken = 'value'; continue; }
    if (ch === '{' || ch === '[') { comma(); i++; lastToken = 'open'; continue; }
    if (ch === '}' || ch === ']') { i++; lastToken = 'close'; continue; }
    if (ch === ',') { i++; lastToken = 'comma'; continue; }
    if (ch === ':') { i++; lastToken = 'colon'; continue; }

    // Number, boolean (true/false/null), or bare identifier
    const wordEnd = scanWord(input, i);
    if (wordEnd > i) { comma(); i = wordEnd; lastToken = 'value'; continue; }

    // Unknown character — pass through
    i++;
  }
  parts.push(input.slice(copied));
  const output = parts.join('');

  if (insertions > 0) {
    issues.push({
      category: 'missing-comma',
      severity: 'fixed',
      description: `Inserted ${insertions} missing comma${insertions > 1 ? 's' : ''} between values`,
      line: null,
      col: null,
      before: '"a" "b"',
      after: '"a","b"',
    });
  }

  return output;
}

/**
 * Scan a word token (number, boolean, null, or bare identifier) from position i.
 * Returns the end position (exclusive). Returns i if no word found.
 */
const NUM_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const KW_RE = /[a-zA-Z_$][a-zA-Z0-9_$]*/y;

function scanWord(input: string, i: number): number {
  // Number: optional minus, digits, optional decimal, optional exponent
  NUM_RE.lastIndex = i;
  if (NUM_RE.test(input)) return NUM_RE.lastIndex;

  // Keyword or identifier
  KW_RE.lastIndex = i;
  if (KW_RE.test(input)) return KW_RE.lastIndex;

  return i;
}
