import type { RepairIssue } from './types';
import { isWsCode } from './scan';

/**
 * Repairs truncated JSON from streaming LLM responses.
 *
 * Streaming LLMs cut off mid-response when they hit token limits,
 * leaving unclosed structures like:
 *   {"name":"Alice","items":["a","b"
 *   {"name":"Alice","meta":{"k":"v"
 *   {"name":"Ali   (truncated mid-string)
 *
 * Strategy:
 * 1. Walk the input tracking a stack of open delimiters: { and [
 * 2. Track whether we're inside a string (and whether it's terminated)
 * 3. At EOF, close any unterminated string, then close all open structures
 *    in reverse order.
 * 4. Also detect and remove trailing incomplete tokens (partial keys/values
 *    at the end of the stream) before closing.
 */
export function repairTruncation(input: string): {
  result: string;
  issues: RepairIssue[];
} {
  const issues: RepairIssue[] = [];

  if (!input.trim()) return { result: input, issues };

  const analysis = analyzeStructure(input);

  if (!analysis.isTruncated) {
    return { result: input, issues };
  }

  let result = input;

  // If truncated inside a string, close the string first
  if (analysis.insideString) {
    result = result.trimEnd();
    // Remove any partial escape at the very end (e.g. ends with \)
    if (result.endsWith('\\')) {
      result = result.slice(0, -1);
    }
    result += '"';
  }

  // If we ended mid-way through a key (after the opening { and some content
  // but before the colon), we need to add a value to make it valid.
  if (analysis.needsValueForKey) {
    result = result.trimEnd();
    // If the last non-ws char is a colon, add null
    const lastMeaningful = result.trimEnd().slice(-1);
    if (lastMeaningful === ':') {
      result += 'null';
    }
  }

  // Remove trailing comma if the last non-whitespace before the truncation point is a comma
  // (the structure was cut off right after a comma)
  const trimmed = result.trimEnd();
  if (trimmed.endsWith(',')) {
    result = trimmed.slice(0, -1);
  }

  // Close all open structures in reverse order
  const closers = analysis.stack.map((open) => (open === '{' ? '}' : ']')).reverse();

  if (closers.length > 0) {
    result = result.trimEnd() + '\n' + closers.join('');
  }

  const depth = analysis.stack.length;
  const stringNote = analysis.insideString ? ', unclosed string' : '';

  issues.push({
    category: 'truncation',
    severity: 'fixed',
    description: `Repaired truncated JSON: closed ${depth} open structure${depth !== 1 ? 's' : ''}${stringNote} (${closers.join('')})`,
    line: null,
    col: null,
    before: '…truncated',
    after: `…${closers.join('')}`,
  });

  return { result, issues };
}

interface StructureAnalysis {
  /** Stack of currently open delimiters ({, [) in order of opening */
  stack: string[];
  /** True if the input ends inside an unclosed string */
  insideString: boolean;
  /** The quote character of the unclosed string (" or ') */
  stringQuote: string;
  /** True if the last thing we saw was a key: with no value yet */
  needsValueForKey: boolean;
  /** True if any repair is needed */
  isTruncated: boolean;
}

function analyzeStructure(input: string): StructureAnalysis {
  const stack: string[] = [];
  let inString = false;
  let stringQuote = '';
  let escaped = false;
  let afterColon = false; // We just saw a colon (waiting for value)
  let lastMeaningfulChar = '';

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
        stringQuote = '';
        lastMeaningfulChar = '"';
        afterColon = false;
      }
      continue;
    }

    // Whitespace — skip, don't update lastMeaningfulChar
    if (isWsCode(input.charCodeAt(i))) continue;

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      afterColon = false;
      lastMeaningfulChar = ch;
      continue;
    }

    if (ch === '}' || ch === ']') {
      // Pop matching opener
      const expected = ch === '}' ? '{' : '[';
      if (stack.length > 0 && stack[stack.length - 1] === expected) {
        stack.pop();
      }
      // Mismatched closer — leave stack alone (structural repair handles it)
      afterColon = false;
      lastMeaningfulChar = ch;
      continue;
    }

    if (ch === ':') {
      afterColon = true;
      lastMeaningfulChar = ':';
      continue;
    }

    if (ch === ',') {
      afterColon = false;
      lastMeaningfulChar = ',';
      continue;
    }

    // Any other character (number, letter for boolean/null/identifier)
    lastMeaningfulChar = ch;
    if (afterColon) afterColon = false;
  }

  const isTruncated =
    stack.length > 0 ||
    inString ||
    lastMeaningfulChar === ':' ||
    lastMeaningfulChar === ',';

  return {
    stack,
    insideString: inString,
    stringQuote,
    needsValueForKey: afterColon || lastMeaningfulChar === ':',
    isTruncated,
  };
}
