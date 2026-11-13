// Writes (or with --check verifies) MANIFEST.json: every file in the repo with its sha256.
// Import-ready contract: this file plus package-lock.json let a company repo's first commit be audited.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'MANIFEST.json';
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter((f) => f && f !== OUT && existsSync(f)).sort();
const entries = Object.fromEntries(files.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));

if (process.argv.includes('--check')) {
  const have = JSON.parse(readFileSync(OUT, 'utf8')).files;
  const bad = [...new Set([...Object.keys(have), ...Object.keys(entries)])].filter((f) => have[f] !== entries[f]);
  if (bad.length) { console.error('MANIFEST mismatch:\n' + bad.join('\n')); process.exit(1); }
  console.log(`MANIFEST ok: ${files.length} files`);
} else {
  writeFileSync(OUT, JSON.stringify({ format: 1, count: files.length, files: entries }, null, 2) + '\n');
  console.log(`wrote ${OUT}: ${files.length} files`);
}
