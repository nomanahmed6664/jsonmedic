export { repairJson, isValidJson, beautify, minify } from './engine';
export { DEFAULT_OPTIONS } from './types';
export type {
  RepairResult,
  RepairIssue,
  RepairOptions,
  RepairSeverity,
  RepairCategory,
} from './types';
export {
  buildRepairSummary,
  computeLineDiff,
  groupIssues,
  groupIssuesByCategory,
} from './report';
export type { LineDiff, GroupedIssue } from './report';
