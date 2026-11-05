import type { RepairIssue } from './types';
import { lineCounter, skipString } from './scan';

/**
 * Converts Python-style literals to valid JSON equivalents.
 *
 * LLMs trained on Python codebases commonly produce these:
 *   True   → true
 *   False  → false
 *   None   → null
 *
 * Uses word-boundary matching so we never corrupt string content
 * (e.g. a string value "IsTrue" should not become "Istrue").
 *
 * Strategy: only replace bare tokens that appear in structural positions
 * (after `:`, `,`, `[`, or at the start of the value position).
 * We do NOT try to replace inside strings.
 */
export function fixPythonLiterals(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];

  // One pass outside strings; untouched runs are copied whole (slice), only the literals are swapped.
  const parts: string[] = [];
  let copied = 0;
  let i = 0;
  const n = input.length;
  const lineOf = lineCounter(input); // incremental: scanning from 0 for every hit made big inputs quadratic

  const trueFixed: number[] = [];
  const falseFixed: number[] = [];
  const noneFixed: number[] = [];
  const swap = (len: number, to: string, hits: number[]) => {
    parts.push(input.slice(copied, i), to);
    hits.push(lineOf(i));
    i += len;
    copied = i;
  };

  while (i < n) {
    const c = input.charCodeAt(i);
    if (c === 34 || c === 39) { i = skipString(input, i); continue; }
    // T, F, N at a word start — check word boundary (not preceded/followed by word char)
    if ((c === 84 || c === 70 || c === 78) && !(i > 0 && isWordChar(input[i - 1]))) {
      if (input.startsWith('False', i) && !isWordChar(input[i + 5])) { swap(5, 'false', falseFixed); continue; }
      if (input.startsWith('True', i) && !isWordChar(input[i + 4])) { swap(4, 'true', trueFixed); continue; }
      if (input.startsWith('None', i) && !isWordChar(input[i + 4])) { swap(4, 'null', noneFixed); continue; }
    }
    i++;
  }
  if (copied < n) parts.push(input.slice(copied));
  const output = parts.join('');

  if (trueFixed.length > 0) {
    issues.push({
      category: 'python',
      severity: 'fixed',
      description: `Converted ${trueFixed.length}× Python \`True\` → JSON \`true\``,
      line: trueFixed[0],
      col: null,
      before: 'True',
      after: 'true',
    });
  }
  if (falseFixed.length > 0) {
    issues.push({
      category: 'python',
      severity: 'fixed',
      description: `Converted ${falseFixed.length}× Python \`False\` → JSON \`false\``,
      line: falseFixed[0],
      col: null,
      before: 'False',
      after: 'false',
    });
  }
  if (noneFixed.length > 0) {
    issues.push({
      category: 'python',
      severity: 'fixed',
      description: `Converted ${noneFixed.length}× Python \`None\` → JSON \`null\``,
      line: noneFixed[0],
      col: null,
      before: 'None',
      after: 'null',
    });
  }

  return { result: output, issues };
}

function isWordChar(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return /\w/.test(ch);
}
