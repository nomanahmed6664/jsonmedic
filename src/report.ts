import type { RepairIssue, RepairResult, RepairSeverity } from './types';

const CATEGORY_LABELS: Record<RepairIssue['category'], string> = {
  markdown: 'Markdown Fence',
  encoding: 'Encoding',
  comments: 'Comments',
  python: 'Python Literals',
  quotes: 'Quote Style',
  keys: 'Unquoted Keys',
  'trailing-comma': 'Trailing Comma',
  'missing-comma': 'Missing Comma',
  values: 'Invalid Values',
  escapes: 'Invalid Escapes',
  numbers: 'Numbers',
  concatenation: 'Concatenated JSON',
  truncation: 'Truncation',
  brackets: 'Brackets',
  structural: 'Structure',
  'duplicate-key': 'Duplicate Key',
};

const SEVERITY_ICONS: Record<RepairSeverity, string> = {
  fixed: '✓',
  warning: '⚠',
  unfixable: '✗',
};

/**
 * Builds a human-readable summary of all repairs performed.
 * Intended for display in the tool's repair report panel.
 */
export function buildRepairSummary(result: RepairResult): string {
  const { issues, unfixable, changeCount, wasAlreadyValid } = result;

  if (wasAlreadyValid) {
    return 'JSON is already valid — no repairs needed.';
  }

  if (changeCount === 0 && unfixable.length === 0) {
    return 'No repairs were applied.';
  }

  const lines: string[] = [];

  if (changeCount > 0) {
    lines.push(`${changeCount} issue${changeCount > 1 ? 's' : ''} found and fixed:`);
    for (const issue of issues) {
      const icon = SEVERITY_ICONS[issue.severity];
      const label = CATEGORY_LABELS[issue.category];
      const loc = issue.line ? ` (line ${issue.line})` : '';
      lines.push(`  ${icon} [${label}]${loc} ${issue.description}`);
    }
  }

  if (unfixable.length > 0) {
    lines.push('');
    lines.push(`${unfixable.length} issue${unfixable.length > 1 ? 's' : ''} could not be auto-repaired:`);
    for (const issue of unfixable) {
      const loc = issue.line ? ` (line ${issue.line})` : '';
      lines.push(`  ✗ [${CATEGORY_LABELS[issue.category]}]${loc} ${issue.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Returns a structured diff: list of { line, before, after } for display
 * in the before/after panel.
 */
export interface LineDiff {
  lineNumber: number;
  type: 'unchanged' | 'changed' | 'added' | 'removed';
  content: string;
  originalContent?: string;
}

export function computeLineDiff(before: string, after: string): LineDiff[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diffs: LineDiff[] = [];

  // Simple LCS-based line diff for display purposes
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];

    if (b === undefined) {
      diffs.push({ lineNumber: i + 1, type: 'added', content: a });
    } else if (a === undefined) {
      diffs.push({ lineNumber: i + 1, type: 'removed', content: b });
    } else if (b === a) {
      diffs.push({ lineNumber: i + 1, type: 'unchanged', content: a });
    } else {
      diffs.push({
        lineNumber: i + 1,
        type: 'changed',
        content: a,
        originalContent: b,
      });
    }
  }

  return diffs;
}

/**
 * Group issues by category for a categorized display in the report panel.
 */
export function groupIssuesByCategory(
  issues: RepairIssue[],
): Record<string, RepairIssue[]> {
  return issues.reduce(
    (acc, issue) => {
      const label = CATEGORY_LABELS[issue.category];
      if (!acc[label]) acc[label] = [];
      acc[label].push(issue);
      return acc;
    },
    {} as Record<string, RepairIssue[]>,
  );
}

/** An issue row that may stand for several identical fixes. */
export type GroupedIssue = RepairIssue & { count: number };

/**
 * Merges issues with the same category, severity and description into one row with a count, in first-seen order —
 * 152 × "Removed trailing comma before '}'" becomes one row "Removed trailing comma before '}' (152×)" at the line of
 * the first one. Single issues are returned unchanged (count 1).
 */
export function groupIssues(issues: RepairIssue[]): GroupedIssue[] {
  const byKey = new Map<string, GroupedIssue>();
  for (const issue of issues) {
    const key = `${issue.category}\u0000${issue.severity}\u0000${issue.description}`;
    const seen = byKey.get(key);
    if (seen) seen.count++;
    else byKey.set(key, { ...issue, count: 1 });
  }
  return [...byKey.values()].map((g) => (g.count > 1 ? { ...g, description: `${g.description} (${g.count}×)` } : g));
}
