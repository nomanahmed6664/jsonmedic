#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { repairJson } from './engine';

const USAGE = `Usage: jsonmedic [file] [--minify] [--indent N]
Reads broken JSON from a file (or stdin), prints the repaired JSON to stdout
and the list of changes to stderr. Exit code 1 if it could not be repaired.`;

function main(argv: string[]): number {
  let file: string | undefined;
  let beautify = true;
  let indent = 2;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); return 0; }
    else if (a === '--minify') beautify = false;
    else if (a === '--indent') indent = Number(argv[++i]);
    else if (a === '-') file = undefined;
    else if (a.startsWith('-')) { process.stderr.write(`Unknown option ${a}\n${USAGE}\n`); return 2; }
    else file = a;
  }
  if (!Number.isInteger(indent) || indent < 0) { process.stderr.write('--indent needs a whole number\n'); return 2; }

  let input: string;
  try {
    input = readFileSync(file ?? 0, 'utf8');
  } catch (e) {
    process.stderr.write(`jsonmedic: cannot read ${file ?? 'stdin'}: ${(e as Error).message}\n`);
    return 2;
  }

  const r = repairJson(input, { beautify, indent });
  for (const i of r.issues) {
    const where = i.line != null ? ` (line ${i.line})` : '';
    process.stderr.write(`${i.severity}: ${i.description}${where}\n`);
  }
  for (const u of r.unfixable) process.stderr.write(`unfixable: ${u.description}\n`);
  if (r.output) process.stdout.write(r.output + '\n');
  return r.isValid ? 0 : 1;
}

process.exitCode = main(process.argv.slice(2));
