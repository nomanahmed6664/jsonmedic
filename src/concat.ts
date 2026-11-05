import type { RepairIssue } from './types';

/**
 * Merges concatenated / NDJSON top-level values into a single JSON array.
 *
 * LLM streaming, log files, and "paste several API responses" frequently produce
 * multiple complete JSON values stuck together with only whitespace or commas
 * between them, e.g.:
 *
 *   {"a":1}{"a":2}                  (concatenated objects)
 *   {"a":1}\n{"a":2}\n{"a":3}       (NDJSON / JSON Lines)
 *   [1,2] [3,4]                     (concatenated arrays)
 *   {"a":1}, {"a":2}                (comma-separated, no brackets)
 *
 * None of these parse as a single JSON value. We detect ≥2 balanced top-level
 * bracket groups separated by nothing but whitespace/commas and wrap them in an
 * array: `[v1,v2,...]`.
 *
 * Safety: this only fires when the WHOLE input is cleanly composed of balanced
 * `{...}`/`[...]` groups plus whitespace/commas. Any other top-level content
 * (bare scalars, a leading string, junk, or an unbalanced/truncated value) makes
 * it bail and return the input unchanged, so it never fights the truncation,
 * markdown, or other stages.
 */
export function mergeConcatenated(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];

  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;
  let start = -1;
  let cleanSeparators = true;
  const groups: string[] = [];

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (depth === 0) cleanSeparators = false; // top-level string → not a clean object/array concat
      inStr = true;
      quote = ch;
      continue;
    }

    if (ch === '{' || ch === '[') {
      if (depth === 0) start = i;
      depth++;
      continue;
    }

    if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0 && start !== -1) {
        groups.push(input.slice(start, i + 1));
        start = -1;
      } else if (depth < 0) {
        // Unbalanced — let the truncation/bracket stages handle it.
        return { result: input, issues };
      }
      continue;
    }

    // Between/around top-level groups, only whitespace or commas are allowed.
    if (depth === 0 && !/\s|,/.test(ch)) {
      cleanSeparators = false;
    }
  }

  if (groups.length >= 2 && cleanSeparators && depth === 0 && !inStr) {
    issues.push({
      category: 'concatenation',
      severity: 'fixed',
      description: `Wrapped ${groups.length} concatenated top-level values into a single array`,
      line: null,
      col: null,
      before: `${groups.length} separate values`,
      after: '[ … ]',
    });
    return { result: '[' + groups.join(',') + ']', issues };
  }

  return { result: input, issues };
}
