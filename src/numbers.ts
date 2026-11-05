import type { RepairIssue } from './types';
import { replaceOutsideStrings } from './scan';

/**
 * Normalizes JavaScript / loosely-typed number literals that are invalid JSON.
 *
 * Applied outside string context only:
 *   0x1F        → 31        (hexadecimal integer)
 *   +5          → 5         (leading unary plus in a value position)
 *   5.          → 5         (trailing decimal point)
 *   .5          → 0.5       (leading decimal point in a value position)
 *
 * Conservative by design: leading-`+`/`.` fixes require a preceding value
 * position (`:`, `[`, or `,`) so we never touch exponents (`1e+5`) or arithmetic
 * inside strings. Leading-zero/octal handling is intentionally skipped — it's
 * rare from LLMs and ambiguous (e.g. zip codes are usually strings already).
 */
export function fixNumbers(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];
  let hex = 0;
  let plus = 0;
  let dot = 0;

  // Each pattern is first tested on the whole input (none of them can match a quote), so clean input costs four scans.
  let result = input;
  // Hexadecimal integer → decimal
  result = replaceOutsideStrings(result, /\b0[xX][0-9a-fA-F]+\b/g, (m) => {
    hex++;
    return String(parseInt(m, 16));
  });
  // Leading unary plus in a value position
  result = replaceOutsideStrings(result, /([:[,]\s*)\+(\d)/g, (_m, p, d) => {
    plus++;
    return p! + d!;
  });
  // Trailing decimal point (5. → 5) when followed by a separator/end
  result = replaceOutsideStrings(result, /(\d)\.(?=\s*[,}\]]|\s*$)/g, (_m, d) => {
    dot++;
    return d!;
  });
  // Leading decimal point (.5 → 0.5) in a value position
  result = replaceOutsideStrings(result, /([:[,]\s*)\.(\d)/g, (_m, p, d) => {
    dot++;
    return `${p}0.${d}`;
  });

  if (hex > 0) {
    issues.push(issue(`Converted ${hex} hexadecimal number${plural(hex)} to decimal`, '0x1F', '31'));
  }
  if (plus > 0) {
    issues.push(issue(`Removed leading + from ${plus} number${plural(plus)}`, '+5', '5'));
  }
  if (dot > 0) {
    issues.push(issue(`Normalized ${dot} malformed decimal${plural(dot)} (leading/trailing dot)`, '.5 / 5.', '0.5 / 5'));
  }

  return { result, issues };
}

function plural(n: number): string {
  return n === 1 ? '' : 's';
}

function issue(description: string, before: string, after: string): RepairIssue {
  return { category: 'numbers', severity: 'fixed', description, line: null, col: null, before, after };
}
