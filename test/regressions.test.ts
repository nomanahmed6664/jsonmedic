/**
 * Regressions from the 2026-10-21 end-user test of the live tool: each case used to say "JSON is now valid" (or
 * "already valid") while producing different data.
 */
import { describe, it, expect } from 'vitest';
import { repairJson, beautify, minify } from '../src/engine';
import { formatJsonLossless } from '../src/format';
import { groupIssues } from '../src/report';
import type { RepairIssue } from '../src/types';

const PAYLOAD = [
  '{',
  '  "query": "office chairs",',
  '  "results": [',
  '    { "id": "SKU-1", "price": 111.75, "tags": ["office", "sale"] },',
  '    { "id": "SKU-2", "price": 124, "tags": ["office", "new"] }',
  '  ],',
  '  "meta": { "model": "gpt-4o" }',
  '}',
].join('\n');
const TRUNCATED = PAYLOAD.slice(0, PAYLOAD.indexOf('"new"') + 3); // …"tags": ["office", "ne

describe('B1: prose before an unclosed ```json fence (truncated answer)', () => {
  it('strips the prose and the fence, then repairs the cut-off JSON like the fence-only input', () => {
    const fenceOnly = repairJson('```json\n' + TRUNCATED);
    const withProse = repairJson("Sure! Here's the JSON you asked for, with all 2 products:\n\n```json\n" + TRUNCATED);
    expect(withProse.isValid).toBe(true);
    expect(withProse.output).toBe(fenceOnly.output);
    const parsed = JSON.parse(withProse.output);
    expect(Array.isArray(parsed)).toBe(false);
    expect(parsed.query).toBe('office chairs');
    expect(parsed.results[1].tags).toEqual(['office', 'ne']);
    expect(withProse.issues.map((i) => i.category)).toEqual(expect.arrayContaining(['markdown', 'truncation']));
  });

  it('never turns prose into array elements, even with no fence at all', () => {
    const r = repairJson("Sure! Here's the JSON you asked for:\n" + TRUNCATED);
    expect(r.isValid).toBe(true);
    expect(JSON.parse(r.output).query).toBe('office chairs');
  });
});

describe('B2: prose after a closed fence / around bare JSON', () => {
  it('keeps the fenced JSON only and reports the dropped prose', () => {
    const input = "Here you go:\n\n```json\n" + PAYLOAD + "\n```\n\nLet me know if you'd like more fields, e.g. `warranty` or {\"rating\": 5}.";
    const r = repairJson(input);
    expect(r.isValid).toBe(true);
    expect(JSON.parse(r.output)).toEqual(JSON.parse(PAYLOAD));
    const md = r.issues.find((i) => i.category === 'markdown');
    expect(md?.description).toMatch(/prose after/);
  });

  it('picks the JSON block when an earlier fence is not JSON', () => {
    const input = 'Run this first:\n```bash\nnpm i\n```\nThen use:\n```json\n{"a": 1}\n```\nDone.';
    expect(JSON.parse(repairJson(input).output)).toEqual({ a: 1 });
  });

  it('extracts the outermost value when prose surrounds unfenced JSON', () => {
    const r = repairJson('Here is the result:\n{"a": [1, 2], "b": {"c": "x"}}\nHope that helps!');
    expect(r.isValid).toBe(true);
    expect(JSON.parse(r.output)).toEqual({ a: [1, 2], b: { c: 'x' } });
    expect(r.issues.some((i) => i.category === 'markdown')).toBe(true);
  });

  it('drops trailing prose after a JSON value', () => {
    const r = repairJson('{"a": 1,} Let me know if you need anything else.');
    expect(JSON.parse(r.output)).toEqual({ a: 1 });
  });

  it('leaves concatenated values alone (they are not prose)', () => {
    expect(JSON.parse(repairJson('{"a":1}\n{"b":2}').output)).toEqual([{ a: 1 }, { b: 2 }]);
  });
});

describe('B3: numbers are never changed by formatting', () => {
  const INPUT = '{"tweet_id": 1849203948571234567, "order_id": 9007199254740993, "price": 10.50, "ratio": 1.0, "big": 1e400, "s": "caf\\u00e9"}';

  it('already-valid input keeps every number verbatim', () => {
    const r = repairJson(INPUT);
    expect(r.wasAlreadyValid).toBe(true);
    for (const n of ['1849203948571234567', '9007199254740993', '10.50', '1.0', '1e400']) expect(r.output).toContain(n);
    expect(r.output).toContain('"caf\\u00e9"');
  });

  it('repaired input keeps big integers verbatim', () => {
    const r = repairJson('{"tweet_id": 1849203948571234567, "price": 10.50, "tags": ["a", "b",]}');
    expect(r.isValid).toBe(true);
    expect(r.output).toContain('1849203948571234567');
    expect(r.output).toContain('10.50');
  });

  it('minified output keeps them too', () => {
    expect(repairJson(INPUT, { beautify: false }).output).toBe(INPUT.replace(/: /g, ':').replace(/, /g, ','));
  });

  it('beautify / minify helpers (the /format and /minify pages) are lossless', () => {
    expect(beautify('{"id":9007199254740993}')).toBe('{\n  "id": 9007199254740993\n}');
    expect(minify('{ "id" : 9007199254740993 , "x": [ ] }')).toBe('{"id":9007199254740993,"x":[]}');
  });

  it('formats exactly like JSON.stringify when no number is at risk', () => {
    const sample = '{"a":[1,2,{"b":null,"c":[],"d":{}}],"e":"x, y: [z]","f":true,"g":-0.5}';
    for (const indent of [0, 2, 4]) {
      expect(formatJsonLossless(sample, indent)).toBe(JSON.stringify(JSON.parse(sample), null, indent));
    }
    expect(formatJsonLossless('[ ]', 2)).toBe('[]');
    expect(formatJsonLossless(' "s" ', 2)).toBe('"s"');
  });
});

describe('B4: Windows paths', () => {
  const INPUT = [
    '{',
    '  "workspace": "C:\\Users\\sam\\Documents\\projects\\new_app",',
    '  "temp": "C:\\temp\\build",',
    '  "unc": "\\\\server\\share\\data",',
    '  "regex_digits": "^\\d+$",',
    '  "already_ok": "C:\\\\Windows\\\\System32",',
    '  "newline_intended": "line1\\nline2",',
    '  "tab_intended": "a\\tb",',
    '}',
  ].join('\n');

  it('keeps every backslash of a path literal; real escapes elsewhere untouched', () => {
    const r = repairJson(INPUT);
    expect(r.isValid).toBe(true);
    const o = JSON.parse(r.output);
    expect(o.workspace).toBe('C:\\Users\\sam\\Documents\\projects\\new_app');
    expect(o.temp).toBe('C:\\temp\\build');
    expect(o.unc).toBe('\\\\server\\share\\data');
    expect(o.regex_digits).toBe('^\\d+$');
    expect(o.already_ok).toBe('C:\\Windows\\System32');
    expect(o.newline_intended).toBe('line1\nline2');
    expect(o.tab_intended).toBe('a\tb');
  });

  it('explains the path rule as an escapes warning', () => {
    const w = repairJson(INPUT).issues.filter((i) => i.category === 'escapes' && i.severity === 'warning');
    expect(w.length).toBe(3); // workspace, temp, unc
    expect(w[0]!.description).toMatch(/Windows path/);
  });

  it('fixes a path even when the JSON otherwise parses (C:\\temp would be C:<tab>emp)', () => {
    const r = repairJson('{"temp": "C:\\temp\\build"}');
    expect(r.wasAlreadyValid).toBe(false);
    expect(JSON.parse(r.output).temp).toBe('C:\\temp\\build');
  });

  it('leaves a correctly escaped path as already valid', () => {
    expect(repairJson('{"p": "C:\\\\temp\\\\build"}').wasAlreadyValid).toBe(true);
  });
});

describe('B5: big broken input stays linear', () => {
  const record = (i: number) =>
    `  {"id": ${i}, 'name': 'User ${i}', "active": True, "note": None, "tags": ["a", "b",], "addr": {"city": "Lahore"}},\n`;
  const build = (bytes: number) => {
    const parts: string[] = ['['];
    let size = 1;
    for (let i = 0; size < bytes; i++) { const r = record(i); parts.push(r); size += r.length; }
    parts.push(']');
    return parts.join('');
  };

  it('repairs ~1 MB of broken JSON in well under the old 7 s', () => {
    const input = build(1_000_000);
    const t0 = performance.now();
    const r = repairJson(input);
    const ms = performance.now() - t0;
    expect(r.isValid).toBe(true);
    expect(ms).toBeLessThan(2000); // ~150 ms here; the old engine took 7–13 s
  });
});

describe('report: identical fixes are one row with a count', () => {
  it('groups by category + severity + description', () => {
    const issue = (description: string): RepairIssue => ({ category: 'trailing-comma', severity: 'fixed', description, line: null, col: null, before: ',}', after: '}' });
    const rows = groupIssues([issue("Removed trailing comma before '}'"), issue("Removed trailing comma before ']'"), issue("Removed trailing comma before '}'")]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.count).toBe(2);
    expect(rows[0]!.description).toBe("Removed trailing comma before '}' (2×)");
    expect(rows[1]!.count).toBe(1);
  });
});
