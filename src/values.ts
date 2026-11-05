import type { RepairIssue } from './types';
import { mapNonStringSegments } from './scan';

/**
 * Replaces JavaScript-only values that are invalid in JSON with `null`.
 *
 * Handles (outside string context only):
 *   NaN         → null
 *   Infinity    → null
 *   -Infinity   → null
 *   +Infinity   → null
 *   undefined   → null
 *
 * These appear when LLMs produce JavaScript object literals or when
 * numeric computation results are embedded in the JSON output.
 */
export function fixInvalidValues(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];
  const replacements: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bNaN\b/g, name: 'NaN' },
    { pattern: /[+-]?Infinity\b/g, name: 'Infinity' },
    { pattern: /\bundefined\b/g, name: 'undefined' },
  ];

  let result = input;

  for (const { pattern, name } of replacements) {
    if (!result.includes(name)) continue; // cheap skip: most inputs have none of these
    let count = 0;
    result = mapNonStringSegments(result, (seg) => seg.replace(pattern, () => { count++; return 'null'; }));
    if (count > 0) {
      issues.push({
        category: 'values',
        severity: 'fixed',
        description: `Replaced ${count}× \`${name}\` with \`null\` (not valid JSON)`,
        line: null,
        col: null,
        before: name,
        after: 'null',
      });
    }
  }

  return { result, issues };
}
