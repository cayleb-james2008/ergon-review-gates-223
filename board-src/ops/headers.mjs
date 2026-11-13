// Writes the framing policy into vercel.json from ops/harness-origins.json (the one list). Framing is never open: `frame-ancestors 'self'` plus the
// enumerated shell origins, no X-Frame-Options, no '*'. An empty list gives `frame-ancestors 'self'`.
//
//   node ops/headers.mjs            # rewrite vercel.json from ops/harness-origins.json
//   node ops/headers.mjs --check    # exit 1 if vercel.json is out of step with the list
//   --file <vercel.json> and --origins <file> point at other files (used by the tests)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ORIGINS_FILE, policy, readOrigins } from './harness-origins.mjs';

export function apply(config, origins) {
  const all = config.headers.find((h) => h.source === '/(.*)');
  all.headers = all.headers.filter((h) => h.key !== 'X-Frame-Options' && h.key !== 'Content-Security-Policy');
  all.headers.push({ key: 'Content-Security-Policy', value: policy(origins) });
  return config;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const file = arg('--file', fileURLToPath(new URL('../vercel.json', import.meta.url)));
  const origins = readOrigins(arg('--origins', ORIGINS_FILE));
  const current = readFileSync(file, 'utf8');
  const next = `${JSON.stringify(apply(JSON.parse(current), origins), null, 2)}\n`;
  if (args.includes('--check')) { if (next !== current) { console.error(`${file} is out of step with the origin list; run node ops/headers.mjs`); process.exit(1); } console.log('ok'); }
  else { writeFileSync(file, next); console.log(`${file}: ${policy(origins)}`); }
}
