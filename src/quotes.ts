import type { RepairIssue } from './types';
import { replaceOutsideStrings, skipString } from './scan';

/**
 * Converts single-quoted strings to double-quoted strings.
 *
 * This is one of the trickiest transformations because:
 * 1. We must not corrupt strings that are already double-quoted.
 * 2. Apostrophes inside single-quoted strings must be escaped.
 * 3. Double quotes inside single-quoted strings must be escaped.
 * 4. Existing escape sequences inside single-quoted strings must be preserved.
 *
 * Strategy: full character-level state machine.
 *
 * Also handles:
 *   - Unquoted keys: { key: "value" } → { "key": "value" }
 */

export function fixSingleQuotes(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];
  const parts: string[] = [];
  let copied = 0;
  let i = 0;
  let fixCount = 0;
  const n = input.length;

  while (i < n) {
    const c = input.charCodeAt(i);

    // Double-quoted string — pass through unchanged
    if (c === 34) { i = skipString(input, i); continue; }

    // Single-quoted string — convert to double-quoted
    if (c === 39) {
      const { converted, end, changed } = convertSingleQuotedString(input, i);
      parts.push(input.slice(copied, i), converted);
      if (changed) fixCount++;
      i = end;
      copied = end;
      continue;
    }

    i++;
  }
  if (copied < n) parts.push(input.slice(copied));
  const output = parts.join('');

  if (fixCount > 0) {
    issues.push({
      category: 'quotes',
      severity: 'fixed',
      description: `Converted ${fixCount} single-quoted string${fixCount > 1 ? 's' : ''} to double-quoted`,
      line: null,
      col: null,
      before: "'value'",
      after: '"value"',
    });
  }

  return { result: output, issues };
}

/**
 * Converts a single-quoted string starting at position `start` to a
 * properly double-quoted JSON string.
 *
 * Handles:
 *   - Apostrophes in content: they're fine in double-quoted strings (no escape needed)
 *   - Double quotes in content: must be escaped → \"
 *   - Backslash escapes: preserve \n, \t, etc. verbatim
 *   - Unterminated string: close it
 */
function convertSingleQuotedString(
  input: string,
  start: number,
): { converted: string; end: number; changed: boolean } {
  let i = start + 1;
  let inner = '';
  let escaped = false;

  while (i < input.length) {
    const ch = input[i];

    if (escaped) {
      // Preserve escape sequences, but un-escape the apostrophe
      // (in single-quoted JS, \' is an escaped apostrophe — in JSON we just use ')
      if (ch === "'") {
        inner += "'"; // \' → ' (apostrophe doesn't need escaping in double-quoted JSON)
      } else {
        inner += '\\' + ch; // preserve all other escape sequences
      }
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      i++;
      continue;
    }

    if (ch === "'") {
      // Closing single quote
      return {
        converted: '"' + inner + '"',
        end: i + 1,
        changed: true,
      };
    }

    if (ch === '"') {
      // Double quote in content must be escaped for JSON
      inner += '\\"';
    } else {
      inner += ch;
    }

    i++;
  }

  // Unterminated single-quoted string — close it
  return {
    converted: '"' + inner + '"',
    end: i,
    changed: true,
  };
}

/**
 * Quotes unquoted object keys.
 *
 * Matches the pattern: whitespace/newline/{ KEY :
 * where KEY is an unquoted identifier.
 *
 * Does NOT run inside string values — uses regex with lookbehind/ahead
 * targeting structural positions only.
 *
 * This is run AFTER single-quote conversion so keys can be either
 * already double-quoted, single-quoted (now converted), or bare.
 */
export function fixUnquotedKeys(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];

  // Match unquoted keys: must appear after { or , (with optional whitespace)
  // and must be followed by :
  // Negative lookbehind for " ensures we don't re-wrap already-quoted keys.
  const unquotedKeyRe = /([{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)(\s*:)/g;

  // We need to be careful not to match inside string values.
  // Strategy: tokenise by strings first, only apply regex to non-string segments.
  const result = replaceOutsideStrings(input, unquotedKeyRe, (_match, p1 = '', p2 = '', p3 = '') => {
    issues.push({
      category: 'keys',
      severity: 'fixed',
      description: `Quoted unquoted key: ${p2}`,
      line: null,
      col: null,
      before: p2,
      after: `"${p2}"`,
    });
    return `${p1}"${p2}"${p3}`;
  });

  return { result, issues };
}
