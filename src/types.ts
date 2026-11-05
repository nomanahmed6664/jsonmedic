export type RepairSeverity = 'fixed' | 'warning' | 'unfixable';

export type RepairCategory =
  | 'markdown'      // Markdown code fence stripped
  | 'encoding'      // BOM, null bytes, encoding issues
  | 'comments'      // JS/Python comments removed
  | 'python'        // Python literals (True/False/None)
  | 'quotes'        // Single → double quotes
  | 'keys'          // Unquoted keys quoted
  | 'trailing-comma'
  | 'missing-comma'
  | 'values'        // NaN, Infinity, undefined → null
  | 'numbers'       // hex / leading + / malformed decimals → valid JSON numbers
  | 'escapes'       // backslashes that start no JSON escape, doubled
  | 'concatenation' // multiple concatenated / NDJSON values → array
  | 'truncation'    // Closed unclosed structures
  | 'brackets'      // Mismatched or extra brackets
  | 'structural'    // Other structural repairs
  | 'duplicate-key';

export interface RepairIssue {
  category: RepairCategory;
  severity: RepairSeverity;
  description: string;
  // Line/col are best-effort — may be null for global transforms
  line: number | null;
  col: number | null;
  // Snippet of what changed (may be truncated for display)
  before: string | null;
  after: string | null;
}

export interface RepairResult {
  /** The repaired JSON string (beautified by default) */
  output: string;
  /** Whether the output is valid JSON after repair */
  isValid: boolean;
  /** Whether the input was already valid (no repair needed) */
  wasAlreadyValid: boolean;
  /** Ordered list of every repair applied */
  issues: RepairIssue[];
  /** Errors we detected but could not repair */
  unfixable: RepairIssue[];
  /** Total number of changes made */
  changeCount: number;
  /** Processing time in milliseconds */
  durationMs: number;
}

export interface RepairOptions {
  /** Beautify output (default: true) */
  beautify?: boolean;
  /** Indentation spaces when beautifying (default: 2) */
  indent?: number;
  /** Replace NaN/Infinity/undefined with null (default: true) */
  replaceInvalidValues?: boolean;
  /** Normalize hex / leading-+ / malformed-decimal numbers (default: true) */
  normalizeNumbers?: boolean;
  /** Merge concatenated / NDJSON top-level values into an array (default: true) */
  mergeConcatenated?: boolean;
  /** Use the jsonrepair library as a last-resort fallback (default: true) */
  useFallback?: boolean;
  /** Close unclosed structures for truncated JSON (default: true) */
  repairTruncation?: boolean;
  /** Convert Python-style literals (default: true) */
  fixPythonLiterals?: boolean;
  /** Strip JS/Python comments (default: true) */
  stripComments?: boolean;
  /** Strip markdown code fences (default: true) */
  stripMarkdown?: boolean;
  /** Convert single quotes to double quotes (default: true) */
  fixQuotes?: boolean;
  /** Quote unquoted object keys (default: true) */
  fixUnquotedKeys?: boolean;
  /** Remove trailing commas (default: true) */
  fixTrailingCommas?: boolean;
  /** Insert missing commas between items (default: true) */
  fixMissingCommas?: boolean;
  /** Warn about duplicate keys (default: true) */
  warnDuplicateKeys?: boolean;
  /** Double backslashes that start no JSON escape, and every lone backslash in a Windows path (default: true) */
  fixEscapes?: boolean;
}

export const DEFAULT_OPTIONS: Required<RepairOptions> = {
  beautify: true,
  indent: 2,
  replaceInvalidValues: true,
  normalizeNumbers: true,
  mergeConcatenated: true,
  useFallback: true,
  repairTruncation: true,
  fixPythonLiterals: true,
  stripComments: true,
  stripMarkdown: true,
  fixQuotes: true,
  fixUnquotedKeys: true,
  fixTrailingCommas: true,
  fixMissingCommas: true,
  warnDuplicateKeys: true,
  fixEscapes: true,
};
