import type { RepairIssue } from './types';
import { skipString } from './scan';

/**
 * Strips JavaScript-style (//, block-style) and Python-style (#) comments
 * from JSON-like text while preserving comment-like content inside strings.
 *
 * Uses a character-level state machine to avoid corrupting string values
 * that happen to contain //, #, or block comment markers.
 */
export function stripComments(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];
  // Strings and code are copied as whole runs (slice); only the comments are cut out.
  const parts: string[] = [];
  let copied = 0;
  let i = 0;
  const n = input.length;
  let lineLineComments = 0;
  let blockComments = 0;
  let hashComments = 0;
  const cut = (from: number, to: number, keep: string) => {
    parts.push(input.slice(copied, from), keep);
    copied = to;
  };

  while (i < n) {
    const c = input.charCodeAt(i);

    // String (" or ') — skip over it whole
    if (c === 34 || c === 39) { i = skipString(input, i); continue; }

    // Block comment: /* ... */
    if (c === 47 /* / */ && input.charCodeAt(i + 1) === 42 /* * */) {
      let end = input.indexOf('*/', i + 2);
      if (end === -1) end = n - 2; // unterminated — skip to end
      blockComments++;
      // Preserve newlines so line numbers stay accurate
      let newlines = 0;
      for (let k = i; k < end + 2 && k < n; k++) if (input.charCodeAt(k) === 10) newlines++;
      cut(i, Math.min(end + 2, n), '\n'.repeat(newlines));
      i = end + 2;
      continue;
    }

    // Line comment: // ...   or   Hash comment: # ... (Python style — LLMs sometimes add these)
    const line = c === 47 && input.charCodeAt(i + 1) === 47;
    if (line || c === 35 /* # */) {
      const end = input.indexOf('\n', i + (line ? 2 : 1));
      if (line) lineLineComments++; else hashComments++;
      if (end === -1) { cut(i, n, ''); i = n; } // comment runs to EOF
      else { cut(i, end + 1, '\n'); i = end + 1; } // keep the newline
      continue;
    }

    i++;
  }
  if (copied < n) parts.push(input.slice(copied));
  const output = parts.join('');

  const totalRemoved = lineLineComments + blockComments + hashComments;
  if (totalRemoved > 0) {
    const parts: string[] = [];
    if (lineLineComments > 0) parts.push(`${lineLineComments} line comment${lineLineComments > 1 ? 's' : ''} (//)`);
    if (blockComments > 0) parts.push(`${blockComments} block comment${blockComments > 1 ? 's' : ''} (/* */)`);
    if (hashComments > 0) parts.push(`${hashComments} hash comment${hashComments > 1 ? 's' : ''} (#)`);

    issues.push({
      category: 'comments',
      severity: 'fixed',
      description: `Removed ${parts.join(', ')}`,
      line: null,
      col: null,
      before: `// comment or /* comment */ or # comment`,
      after: '',
    });
  }

  return { result: output, issues };
}
