/**
 * AI JSONMedic — Repair Engine Tests
 *
 * Covers the AI-specific failure patterns the engine handles.
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import { repairJson, isValidJson, beautify, minify } from '../src/engine';

// ─── Helper ──────────────────────────────────────────────────────────────────

function fix(input: string): string {
  return repairJson(input).output;
}

function issues(input: string): string[] {
  return repairJson(input).issues.map((i) => i.category);
}

// ─── Already-valid fast path ─────────────────────────────────────────────────

describe('already-valid JSON', () => {
  it('passes through a valid object unchanged (whitespace may differ)', () => {
    const result = repairJson('{"a":1,"b":true}');
    expect(result.wasAlreadyValid).toBe(true);
    expect(result.isValid).toBe(true);
    expect(result.changeCount).toBe(0);
  });

  it('passes through a valid array', () => {
    expect(repairJson('[1,2,3]').wasAlreadyValid).toBe(true);
  });

  it('passes through a valid nested structure', () => {
    const json = JSON.stringify({ a: { b: [1, 2, { c: null }] } });
    expect(repairJson(json).wasAlreadyValid).toBe(true);
  });
});

// ─── Markdown fence stripping ─────────────────────────────────────────────────

describe('markdown fences', () => {
  it('strips ```json\\n...\\n```', () => {
    const input = '```json\n{"a":1}\n```';
    expect(fix(input)).toBe('{\n  "a": 1\n}');
    expect(issues(input)).toContain('markdown');
  });

  it('strips ``` with no language tag', () => {
    const input = '```\n{"a":1}\n```';
    expect(fix(input)).toBe('{\n  "a": 1\n}');
  });

  it('strips ```JSON (uppercase)', () => {
    expect(fix('```JSON\n{"x":1}\n```')).toBe('{\n  "x": 1\n}');
  });

  it('strips tilde fences ~~~json', () => {
    expect(fix('~~~json\n{"x":1}\n~~~')).toBe('{\n  "x": 1\n}');
  });

  it('strips single-backtick inline wrapper', () => {
    expect(fix('`{"a":1}`')).toBe('{\n  "a": 1\n}');
  });

  it('does not corrupt JSON that happens to contain backticks in strings', () => {
    const valid = '{"code":"let x = `hello`"}';
    const result = repairJson(valid);
    expect(result.wasAlreadyValid).toBe(true);
  });
});

// ─── Encoding fixes ───────────────────────────────────────────────────────────

describe('encoding', () => {
  it('strips UTF-8 BOM', () => {
    const input = '﻿{"a":1}';
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    expect(issues(input)).toContain('encoding');
  });

  it('strips null bytes', () => {
    const input = '{"a":\x001}';
    expect(fix(input)).toBe('{\n  "a": 1\n}');
    expect(issues(input)).toContain('encoding');
  });
});

// ─── Comment stripping ────────────────────────────────────────────────────────

describe('comments', () => {
  it('strips // line comments', () => {
    const input = '{\n  "a": 1 // this is a\n}';
    expect(fix(input)).toBe('{\n  "a": 1\n}');
    expect(issues(input)).toContain('comments');
  });

  it('strips /* block comments */', () => {
    const input = '{"a": /* the value */ 1}';
    expect(fix(input)).toBe('{\n  "a": 1\n}');
  });

  it('strips # hash comments (Python style)', () => {
    const input = '{"a": 1 # comment\n}';
    expect(fix(input)).toBe('{\n  "a": 1\n}');
  });

  it('does not strip // inside a string value', () => {
    const input = '{"url": "https://example.com"}';
    const result = repairJson(input);
    expect(result.wasAlreadyValid).toBe(true);
    expect(result.output).toContain('https://example.com');
  });

  it('does not strip # inside a string value', () => {
    const input = '{"color": "#ff0000"}';
    const result = repairJson(input);
    expect(result.wasAlreadyValid).toBe(true);
    expect(result.output).toContain('#ff0000');
  });
});

// ─── Python literal conversion ────────────────────────────────────────────────

describe('python literals', () => {
  it('converts True → true', () => {
    const input = '{"flag": True}';
    expect(fix(input)).toBe('{\n  "flag": true\n}');
    expect(issues(input)).toContain('python');
  });

  it('converts False → false', () => {
    expect(fix('{"flag": False}')).toBe('{\n  "flag": false\n}');
  });

  it('converts None → null', () => {
    expect(fix('{"val": None}')).toBe('{\n  "val": null\n}');
  });

  it('converts all three in one object', () => {
    const input = '{"a": True, "b": False, "c": None}';
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"a": true');
    expect(result.output).toContain('"b": false');
    expect(result.output).toContain('"c": null');
  });

  it('does not corrupt "TrueColor" or similar identifiers in strings', () => {
    const input = '{"theme": "TrueColor"}';
    const result = repairJson(input);
    expect(result.wasAlreadyValid).toBe(true);
    expect(result.output).toContain('"TrueColor"');
  });

  it('does not replace inside a string value', () => {
    // "True" inside a string must not become "true"
    const input = '{"label": "True"}';
    const result = repairJson(input);
    expect(result.wasAlreadyValid).toBe(true);
    expect(result.output).toContain('"True"');
  });
});

// ─── Invalid value replacement ────────────────────────────────────────────────

describe('invalid values', () => {
  it('replaces NaN with null', () => {
    expect(fix('{"val": NaN}')).toBe('{\n  "val": null\n}');
    expect(issues('{"val": NaN}')).toContain('values');
  });

  it('replaces Infinity with null', () => {
    expect(fix('{"val": Infinity}')).toBe('{\n  "val": null\n}');
  });

  it('replaces -Infinity with null', () => {
    expect(fix('{"val": -Infinity}')).toBe('{\n  "val": null\n}');
  });

  it('replaces undefined with null', () => {
    expect(fix('{"val": undefined}')).toBe('{\n  "val": null\n}');
  });

  it('does not replace "NaN" inside a string', () => {
    const input = '{"err": "Got NaN from sensor"}';
    const result = repairJson(input);
    expect(result.wasAlreadyValid).toBe(true);
    expect(result.output).toContain('"Got NaN from sensor"');
  });
});

// ─── Quote fixing ─────────────────────────────────────────────────────────────

describe('single to double quotes', () => {
  it("converts {'key': 'value'}", () => {
    expect(fix("{'key': 'value'}")).toBe('{\n  "key": "value"\n}');
    expect(issues("{'key': 'value'}")).toContain('quotes');
  });

  it('handles apostrophes in single-quoted string content', () => {
    const input = "{'msg': 'it\\'s fine'}";
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    // Apostrophe should be preserved, no longer escaped (valid in double-quoted strings)
    expect(result.output).toContain("it's fine");
  });

  it('escapes double quotes found inside single-quoted content', () => {
    const input = `{'msg': 'he said "hi"'}`;
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('\\"hi\\"');
  });

  it('does not double-escape already double-quoted strings', () => {
    const input = '{"key": "value"}';
    const result = repairJson(input);
    expect(result.wasAlreadyValid).toBe(true);
  });
});

// ─── Unquoted keys ────────────────────────────────────────────────────────────

describe('unquoted keys', () => {
  it('quotes a bare identifier key', () => {
    expect(fix('{name: "Alice"}')).toBe('{\n  "name": "Alice"\n}');
    expect(issues('{name: "Alice"}')).toContain('keys');
  });

  it('quotes multiple bare keys', () => {
    const result = repairJson('{a: 1, b: 2, c: 3}');
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"a": 1');
    expect(result.output).toContain('"b": 2');
  });

  it('does not requote already-quoted keys', () => {
    const input = '{"name": "Alice"}';
    expect(repairJson(input).wasAlreadyValid).toBe(true);
  });
});

// ─── Trailing comma removal ───────────────────────────────────────────────────

describe('trailing commas', () => {
  it('removes trailing comma in object', () => {
    expect(fix('{"a":1,}')).toBe('{\n  "a": 1\n}');
    expect(issues('{"a":1,}')).toContain('trailing-comma');
  });

  it('removes trailing comma in array', () => {
    expect(fix('[1, 2, 3,]')).toBe('[\n  1,\n  2,\n  3\n]');
  });

  it('removes trailing comma with whitespace before closer', () => {
    expect(fix('{"a":1,  }')).toBe('{\n  "a": 1\n}');
  });

  it('handles multiple trailing commas in nested structures', () => {
    const input = '{"a":[1,2,],"b":{"c":3,},}';
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
  });

  it('does not remove commas inside strings', () => {
    const input = '{"csv": "1,2,3,"}';
    const result = repairJson(input);
    expect(result.wasAlreadyValid).toBe(true);
    expect(result.output).toContain('"1,2,3,"');
  });
});

// ─── Missing comma insertion ──────────────────────────────────────────────────

describe('missing commas', () => {
  it('inserts comma between adjacent string values in array', () => {
    const result = repairJson('["a" "b" "c"]');
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"a"');
    expect(result.output).toContain('"b"');
    expect(result.output).toContain('"c"');
  });

  it('inserts comma between adjacent number values', () => {
    const result = repairJson('[1 2 3]');
    expect(result.isValid).toBe(true);
  });

  it('inserts comma between adjacent objects', () => {
    const result = repairJson('[{"a":1} {"b":2}]');
    expect(result.isValid).toBe(true);
  });
});

// ─── Truncation repair ────────────────────────────────────────────────────────

describe('truncation', () => {
  it('closes unclosed object', () => {
    const result = repairJson('{"name":"Alice"');
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"name": "Alice"');
    expect(issues('{"name":"Alice"')).toContain('truncation');
  });

  it('closes unclosed nested structure', () => {
    const result = repairJson('{"a":{"b":[1,2');
    expect(result.isValid).toBe(true);
  });

  it('closes unclosed string before closing brackets', () => {
    const result = repairJson('{"name":"Ali');
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"Ali"');
  });

  it('handles truncation after a comma (removes trailing comma + closes)', () => {
    const result = repairJson('{"a":1,"b":2,');
    expect(result.isValid).toBe(true);
  });

  it('handles deep nesting truncation', () => {
    const result = repairJson('[{"a":{"b":{"c":1');
    expect(result.isValid).toBe(true);
  });
});

// ─── Duplicate key detection ──────────────────────────────────────────────────

describe('duplicate keys', () => {
  it('warns on duplicate key', () => {
    const result = repairJson('{"a":1,"a":2}');
    // Already valid JSON — passes through, but warns
    const dupIssues = result.issues.filter((i) => i.category === 'duplicate-key');
    expect(dupIssues.length).toBeGreaterThan(0);
    expect(dupIssues[0].severity).toBe('warning');
  });

  it('does not warn on same key in different nested objects', () => {
    const result = repairJson('{"a":{"id":1},"b":{"id":2}}');
    const dupIssues = result.issues.filter((i) => i.category === 'duplicate-key');
    expect(dupIssues.length).toBe(0);
  });
});

// ─── Complex real-world AI output patterns ────────────────────────────────────

describe('real-world AI output patterns', () => {
  it('fixes typical ChatGPT response (markdown + trailing comma + Python bool)', () => {
    const input = [
      '```json',
      '{',
      '  "name": "Alice",',
      '  "active": True,',
      '  "score": 98,',
      '}',
      '```',
    ].join('\n');

    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    expect(result.changeCount).toBeGreaterThanOrEqual(2);
    expect(result.output).toContain('"active": true');
    expect(result.output).not.toContain(',\n}');
  });

  it('fixes Claude streaming truncation', () => {
    const input = '{"users":[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"';
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
  });

  it('fixes n8n-style JS object literal output', () => {
    const input = `{
  name: 'workflow_output',
  data: [1, 2, 3,],
  active: True,
  meta: None
}`;
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"name"');
    expect(result.output).toContain('"workflow_output"');
    expect(result.output).toContain('"active": true');
    expect(result.output).toContain('"meta": null');
  });

  it('fixes DeepSeek-style response with // comments and single quotes', () => {
    const input = `{
  // user object
  'id': 42,
  'name': 'Test User',
  'roles': ['admin', 'editor',], // trailing comma
  'verified': True
}`;
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"id": 42');
    expect(result.output).toContain('"verified": true');
  });

  it('fixes Gemini response with NaN values and missing quotes on keys', () => {
    const input = `{
  score: 95.5,
  confidence: NaN,
  result: 'pass'
}`;
    const result = repairJson(input);
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"confidence": null');
    expect(result.output).toContain('"result": "pass"');
  });

  it('fixes response with undefined values', () => {
    const result = repairJson('{"a": undefined, "b": 1}');
    expect(result.isValid).toBe(true);
    expect(result.output).toContain('"a": null');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty input', () => {
    const result = repairJson('');
    expect(result.isValid).toBe(false);
    expect(result.unfixable.length).toBeGreaterThan(0);
  });

  it('handles whitespace-only input', () => {
    const result = repairJson('   \n  ');
    expect(result.isValid).toBe(false);
  });

  it('handles a plain string (not an object or array)', () => {
    // Some LLMs return bare strings without object wrapping
    const result = repairJson('"hello"');
    expect(result.wasAlreadyValid).toBe(true);
  });

  it('handles a plain number', () => {
    const result = repairJson('42');
    expect(result.wasAlreadyValid).toBe(true);
  });

  it('handles deeply nested valid JSON without corruption', () => {
    const deep = JSON.stringify({ a: { b: { c: { d: { e: [1, 2, 3] } } } } });
    expect(repairJson(deep).wasAlreadyValid).toBe(true);
  });

  it('handles a large array of objects', () => {
    const large = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` })),
    );
    expect(repairJson(large).wasAlreadyValid).toBe(true);
  });
});

// ─── Options ──────────────────────────────────────────────────────────────────

describe('options', () => {
  it('beautify: true (default) produces indented output', () => {
    const result = repairJson('{"a":1}');
    expect(result.output).toContain('\n');
    expect(result.output).toContain('  ');
  });

  it('beautify: false (minify) produces single-line output', () => {
    const result = repairJson('{"a":1}', { beautify: false });
    expect(result.output).toBe('{"a":1}');
  });

  it('custom indent: 4', () => {
    const result = repairJson('{"a":1}', { indent: 4 });
    expect(result.output).toBe('{\n    "a": 1\n}');
  });

  it('stripMarkdown: false leaves fences intact', () => {
    const input = '```json\n{"a":1}\n```';
    const result = repairJson(input, { stripMarkdown: false });
    // Without markdown stripping the remaining pipeline may still fail
    expect(result.issues.find((i) => i.category === 'markdown')).toBeUndefined();
  });

  it('fixPythonLiterals: false leaves True untouched', () => {
    const result = repairJson('{"a": True}', { fixPythonLiterals: false });
    // Will be invalid JSON since True is not valid — but we didn't touch it
    expect(result.issues.find((i) => i.category === 'python')).toBeUndefined();
  });
});

// ─── Utility functions ────────────────────────────────────────────────────────

describe('utilities', () => {
  it('isValidJson returns true for valid JSON', () => {
    expect(isValidJson('{"a":1}')).toBe(true);
    expect(isValidJson('[1,2,3]')).toBe(true);
    expect(isValidJson('"string"')).toBe(true);
    expect(isValidJson('null')).toBe(true);
  });

  it('isValidJson returns false for invalid JSON', () => {
    expect(isValidJson('{a:1}')).toBe(false);
    expect(isValidJson("{'a':1}")).toBe(false);
    expect(isValidJson('{"a":1,}')).toBe(false);
  });

  it('beautify formats with correct indentation', () => {
    expect(beautify('{"a":1}', 2)).toBe('{\n  "a": 1\n}');
    expect(beautify('{"a":1}', 4)).toBe('{\n    "a": 1\n}');
  });

  it('minify produces compact JSON', () => {
    expect(minify('{\n  "a": 1\n}')).toBe('{"a":1}');
  });
});

// ─── Concatenated / NDJSON recovery ───────────────────────────────────────────

describe('concatenated / NDJSON values', () => {
  it('wraps two concatenated objects into an array', () => {
    const r = repairJson('{"a":1}{"b":2}');
    expect(r.isValid).toBe(true);
    expect(JSON.parse(r.output)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(r.issues.map((i) => i.category)).toContain('concatenation');
  });

  it('wraps NDJSON (newline-delimited) objects', () => {
    expect(JSON.parse(fix('{"a":1}\n{"a":2}\n{"a":3}'))).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('wraps concatenated arrays', () => {
    expect(JSON.parse(fix('[1,2] [3,4]'))).toEqual([[1, 2], [3, 4]]);
  });

  it('wraps comma-separated objects with no brackets', () => {
    expect(JSON.parse(fix('{"a":1}, {"a":2}'))).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('repairs broken values inside concatenated input', () => {
    expect(JSON.parse(fix("{'a':1}{'b':2,}"))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('does NOT wrap a single object', () => {
    expect(repairJson('{"a":1}').wasAlreadyValid).toBe(true);
    expect(issues('{"a":1}')).not.toContain('concatenation');
  });

  it('does NOT wrap a single array', () => {
    expect(issues('[{"a":1},{"a":2}]')).not.toContain('concatenation');
  });
});

// ─── Smart / curly quotes ─────────────────────────────────────────────────────

describe('smart quotes', () => {
  it('straightens curly double quotes', () => {
    expect(JSON.parse(fix('{“a”: “b”}'))).toEqual({ a: 'b' });
  });

  it('straightens curly single quotes', () => {
    expect(JSON.parse(fix('{‘a’: ‘b’}'))).toEqual({ a: 'b' });
  });

  it('reports an encoding fix for smart quotes', () => {
    expect(issues('{“a”:1}')).toContain('encoding');
  });
});

// ─── Number normalization ─────────────────────────────────────────────────────

describe('number normalization', () => {
  it('converts hexadecimal to decimal', () => {
    expect(JSON.parse(fix('{"a": 0x1F}'))).toEqual({ a: 31 });
  });

  it('removes a leading + from numbers', () => {
    expect(JSON.parse(fix('{"a": +5}'))).toEqual({ a: 5 });
  });

  it('fixes a trailing decimal point', () => {
    expect(JSON.parse(fix('{"a": 5.}'))).toEqual({ a: 5 });
  });

  it('fixes a leading decimal point', () => {
    expect(JSON.parse(fix('{"a": .5}'))).toEqual({ a: 0.5 });
  });

  it('handles several malformed numbers in an array', () => {
    expect(JSON.parse(fix('[0xFF, +1, .5, 5.]'))).toEqual([255, 1, 0.5, 5]);
    expect(issues('[0xFF, +1, .5, 5.]')).toContain('numbers');
  });

  it('does not touch valid exponents', () => {
    expect(repairJson('{"a":1e+5}').wasAlreadyValid).toBe(true);
  });

  it('does not change hex-looking content inside strings', () => {
    expect(JSON.parse(fix('{"a":"0x1F"}'))).toEqual({ a: '0x1F' });
  });
});

// ─── Fallback repair + overall robustness ─────────────────────────────────────

describe('fallback / overall robustness', () => {
  const messy = [
    "{name: 'John', age: 30, hobbies: ['a' 'b']}",
    '{"a": 1, "b": [1 2 3], "c": True,}',
    '```json\n{a: 0x10, b: .5}\n```',
    '{"x":1}{"y":2}',
  ];
  for (const input of messy) {
    it(`produces valid JSON for: ${input.slice(0, 32)}`, () => {
      expect(repairJson(input).isValid).toBe(true);
    });
  }

  it('respects useFallback:false (no jsonrepair safety net)', () => {
    // engine still runs the explainable pipeline; just no library backstop
    const r = repairJson('{"a":1}', { useFallback: false });
    expect(r.isValid).toBe(true);
  });
});

describe('invalid escapes (2026-10-20: the fallback dropped the backslashes and reported nothing)', () => {
  it('doubles a backslash that starts no JSON escape, keeping the data exactly', () => {
    const input = String.raw`{
  "dir": "C:\Users\sam\a.log",
  "re": "\d+\.\d+",
  "msg": "it\'s ready"
}`;
    const r = repairJson(input, { beautify: true, indent: 2 });
    expect(r.isValid).toBe(true);
    const v = JSON.parse(r.output);
    expect(v.dir).toBe(String.raw`C:\Users\sam\a.log`);
    expect(v.re).toBe(String.raw`\d+\.\d+`);
    expect(v.msg).toBe("it's ready");
    expect(r.issues.some((i) => i.category === 'escapes')).toBe(true);
  });

  it('leaves valid escapes alone', () => {
    const r = repairJson(String.raw`{"a": "line\nnext \"q\" \\ \u00e9 \/"}`);
    expect(r.wasAlreadyValid).toBe(true);
    expect(r.issues.filter((i) => i.category === 'escapes')).toHaveLength(0);
  });

  it('a fallback change is always reported, never filtered as a no-op', () => {
    const r = repairJson('{"a": [1, 2 "b": }');
    if (r.isValid && r.issues.length === 0) throw new Error('a changed output must carry at least one issue');
  });
});
