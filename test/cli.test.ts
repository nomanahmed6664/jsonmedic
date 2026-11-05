import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Runs against the built files (npm test builds first).
const root = resolve(__dirname, '..');
const cli = join(root, 'dist', 'cli.js');
const run = (args: string[], input?: string) =>
  spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });

describe('CLI', () => {
  it('repairs stdin: JSON to stdout, changes to stderr', () => {
    const r = run([], "```json\n{'ok': True,}\n```");
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true });
    expect(r.stdout).toBe('{\n  "ok": true\n}\n');
    expect(r.stderr).toMatch(/fixed: /);
  });

  it('reads a file and honours --minify', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jsonmedic-'));
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{"a": [1, 2, 3');
    const r = run([file, '--minify']);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{"a":[1,2,3]}\n');
  });

  it('exits 1 on input it cannot repair', () => {
    const r = run([], '   ');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unfixable: Input is empty/);
  });

  it('exits 2 on a missing file', () => {
    expect(run(['/nonexistent/x.json']).status).toBe(2);
  });
});

describe('built package', () => {
  it('loads through require (CJS) and import (ESM)', async () => {
    const req = createRequire(join(root, 'package.json'));
    const cjs = req(join(root, 'dist', 'index.cjs'));
    const esm = await import(join(root, 'dist', 'index.js'));
    for (const m of [cjs, esm]) {
      const r = m.repairJson("{name: 'x', n: NaN}");
      expect(r.isValid).toBe(true);
      expect(JSON.parse(r.output)).toEqual({ name: 'x', n: null });
      expect(r.changeCount).toBeGreaterThan(0);
    }
  });
});
