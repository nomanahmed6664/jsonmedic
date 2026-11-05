import type { RepairIssue } from './types';
import { isWsCode } from './scan';

/**
 * Detects duplicate keys in JSON objects.
 *
 * JSON spec says duplicate keys are undefined behavior.
 * Most parsers keep the last value. We warn the user rather than silently
 * removing one — this is often a real data integrity issue.
 *
 * We do NOT attempt to auto-fix duplicates (which value to keep is ambiguous)
 * but we report them clearly.
 */
export function detectDuplicateKeys(input: string): {
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];

  try {
    const parsed = parseWithDuplicateTracking(input);
    if (parsed.duplicates.length > 0) {
      for (const dup of parsed.duplicates) {
        issues.push({
          category: 'duplicate-key',
          severity: 'warning',
          description: `Duplicate key "${dup.key}" found in object (last value wins)`,
          line: dup.line,
          col: null,
          before: `"${dup.key}": [first occurrence]`,
          after: `"${dup.key}": [last occurrence kept]`,
        });
      }
    }
  } catch {
    // If parsing fails, duplicate detection is skipped (structural repair runs first)
  }

  return { issues };
}

interface DuplicateInfo {
  key: string;
  line: number;
}

interface ParseResult {
  duplicates: DuplicateInfo[];
}

/**
 * A lightweight JSON scanner that finds duplicate keys without full parsing.
 * Handles nested objects correctly (same key in different objects is fine).
 */
function parseWithDuplicateTracking(input: string): ParseResult {
  const duplicates: DuplicateInfo[] = [];

  // Stack of key sets — one per object level
  const keyStack: Set<string>[] = [];
  let i = 0;
  let line = 1;

  function skipWhitespace() {
    while (i < input.length && isWsCode(input.charCodeAt(i))) {
      if (input.charCodeAt(i) === 10) line++;
      i++;
    }
  }

  function readString(): string {
    // the key text without its escape sequences (they are skipped), collected as slices between them
    const quote = input.charCodeAt(i);
    i++; // skip opening quote
    let result = '';
    let from = i;
    while (i < input.length) {
      const c = input.charCodeAt(i);
      if (c === 92) {
        result += input.slice(from, i);
        i += 2; // skip escape sequence
        from = i;
        continue;
      }
      if (c === quote) {
        result += input.slice(from, i);
        i++; // skip closing quote
        return result;
      }
      if (c === 10) line++;
      i++;
    }
    return result + input.slice(from, Math.min(i, input.length));
  }

  function skipValue() {
    skipWhitespace();
    if (i >= input.length) return;
    const ch = input[i];

    if (ch === '"' || ch === "'") {
      readString();
      return;
    }
    if (ch === '{') {
      scanObject();
      return;
    }
    if (ch === '[') {
      scanArray();
      return;
    }
    // Number, boolean, null — scan until delimiter
    while (i < input.length) {
      const c = input.charCodeAt(i);
      if (c === 44 || c === 125 || c === 93 || isWsCode(c)) break;
      i++;
    }
  }

  function scanObject() {
    i++; // skip {
    keyStack.push(new Set<string>());

    skipWhitespace();
    while (i < input.length && input[i] !== '}') {
      skipWhitespace();
      if (input[i] === '}') break;

      // Read key
      if (input[i] === '"' || input[i] === "'") {
        const keyLine = line;
        const key = readString();
        const keySet = keyStack[keyStack.length - 1];

        if (keySet.has(key)) {
          duplicates.push({ key, line: keyLine });
        } else {
          keySet.add(key);
        }

        skipWhitespace();
        if (i < input.length && input[i] === ':') i++; // skip colon
        skipValue();
        skipWhitespace();
        if (i < input.length && input[i] === ',') i++; // skip comma
      } else {
        // Unquoted key or unexpected content — skip
        while (i < input.length && input[i] !== ':' && input[i] !== '}') i++;
        if (i < input.length && input[i] === ':') i++;
        skipValue();
        skipWhitespace();
        if (i < input.length && input[i] === ',') i++;
      }
      skipWhitespace();
    }

    if (i < input.length) i++; // skip }
    keyStack.pop();
  }

  function scanArray() {
    i++; // skip [
    skipWhitespace();
    while (i < input.length && input[i] !== ']') {
      skipValue();
      skipWhitespace();
      if (i < input.length && input[i] === ',') i++;
      skipWhitespace();
    }
    if (i < input.length) i++; // skip ]
  }

  skipWhitespace();
  if (i < input.length) {
    if (input[i] === '{') scanObject();
    else if (input[i] === '[') scanArray();
  }

  return { duplicates };
}
