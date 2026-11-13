#!/usr/bin/env node
// Stand-in ISSUER for the agent's key tool. Zero dependencies (Node >= 22, `psql` for --db).
//   node ops/keys.mjs mint --subject <employee> --ttl <8h|2d> [--issuer <label>] [--db <DB_URL>] [--json]
//   node ops/keys.mjs list [--db <DB_URL>] [--json]
//   node ops/keys.mjs revoke <id> [--db <DB_URL>]
// A key is `ergk_` + base64url(32 random bytes). Only its sha256 (hex) goes to the database
// (ergon_warehouse.mint_access_key); the PLAINTEXT KEY IS PRINTED ONCE ON STDOUT and is never written to a
// file or log, and never enters the database. Without --db the exact SQL is printed instead, to run through
// another privileged route (e.g. the Management API database/query endpoint as postgres/service_role).
// --db runs psql against that URL: local hosts only (127.0.0.1, localhost, ::1) unless --allow-remote.
// The key is a secret: deliver it only through the person's agent (URL fragment #key=...), never commit it.
// The plaintext exists exactly once: a script that mints and then dies before using the key leaves a key nobody can ever present (revoke it
// untested). Any automated mint must capture the plaintext inside the same process that uses it (docs/HOSTED-APPLY-PACK.md, step 5).
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const die = (msg, code = 1) => { process.stderr.write(msg + '\n'); process.exit(code); };
const argv = process.argv.slice(2);
const cmd = argv.shift();
const opts = {}; const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json' || a === '--allow-remote') opts[a.slice(2)] = true;
  else if (a.startsWith('--')) { if (i + 1 >= argv.length) die(`missing value for ${a}`); opts[a.slice(2)] = argv[++i]; }
  else rest.push(a);
}
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";

function parseTtl(t) {
  const m = /^(\d+)([mhd])$/.exec(t ?? '');
  if (!m) die('--ttl must look like 30m, 8h or 2d');
  const secs = Number(m[1]) * { m: 60, h: 3600, d: 86400 }[m[2]];
  if (secs < 60) die('--ttl must be at least 1m');
  if (secs > 30 * 86400) die('--ttl must be at most 30d');
  return secs;
}

function runSql(sql) {
  const url = opts.db;
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { die('--db must be a postgresql:// URL'); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !opts['allow-remote']) die(`refusing non-local database host "${host}" (pass --allow-remote to override)`, 2);
  const r = spawnSync('psql', [url, '-X', '-q', '-At', '-F', '\t', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { input: sql, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) die((r.stderr || 'psql failed').trim());
  return r.stdout.trim();
}

if (cmd === 'mint') {
  const subject = (opts.subject ?? '').trim();
  if (subject.length < 1 || subject.length > 80 || /[\u0000-\u001f\u007f]/.test(subject)) die('--subject is required: 1 to 80 printable characters');
  const issuer = (opts.issuer ?? 'ops/keys.mjs').trim();
  if (issuer.length > 80) die('--issuer must be at most 80 characters');
  const secs = parseTtl(opts.ttl);
  const key = 'ergk_' + randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(key).digest('hex');
  const prefix = key.slice(0, 9);
  const call = `ergon_warehouse.mint_access_key(${q(hash)}, ${q(prefix)}, ${q(subject)}, now() + make_interval(secs => ${secs}), ${q(issuer)})`;
  let id = null, expires = null;
  if (opts.db) {
    const out = runSql(`select ${call} as kid \\gset\nselect :'kid', (select expires_at from ergon_warehouse.list_access_keys() k where k.id = :'kid'::uuid);\n`);
    [id, expires] = out.split('\t');
  }
  if (opts.json) process.stdout.write(JSON.stringify({ key, key_prefix: prefix, id, subject, issued_by: issuer, expires_at: expires, sql: id ? undefined : `select ${call};` }) + '\n');
  else {
    process.stdout.write(`KEY (shown once; deliver only via the person's agent, never commit or log it): ${key}\n`);
    if (id) process.stdout.write(`id:      ${id}\nsubject: ${subject}\nprefix:  ${prefix}\nexpires: ${expires}\n`);
    else process.stdout.write(`subject: ${subject}\nprefix:  ${prefix}\n-- run this as postgres/service_role (it returns the key id; the plaintext key is not in it):\nselect ${call};\n`);
  }
} else if (cmd === 'list') {
  const sql = 'select * from ergon_warehouse.list_access_keys();';
  if (!opts.db) { process.stdout.write(sql + '\n'); process.exit(0); }
  const out = runSql(sql);
  const cols = ['id', 'key_prefix', 'subject', 'issued_by', 'created_at', 'expires_at', 'revoked_at', 'last_used_at'];
  const rows = out ? out.split('\n').map((l) => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v === '' ? null : v]))) : [];
  process.stdout.write(opts.json ? JSON.stringify(rows) + '\n' : (rows.length ? rows.map((r) => `${r.id}  ${r.key_prefix}…  ${r.subject}  expires ${r.expires_at}${r.revoked_at ? '  REVOKED ' + r.revoked_at : ''}${r.last_used_at ? '  last used ' + r.last_used_at : ''}`).join('\n') : '(no keys)') + '\n');
} else if (cmd === 'revoke') {
  const id = rest[0];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? '')) die('revoke needs a key id (uuid)');
  const sql = `select ergon_warehouse.revoke_access_key(${q(id)}::uuid);`;
  if (!opts.db) { process.stdout.write(sql + '\n'); process.exit(0); }
  const r = runSql(sql);
  process.stdout.write(r === 't' ? `revoked ${id}\n` : `no key with id ${id}\n`);
  process.exit(r === 't' ? 0 : 3);
} else {
  die('usage: node ops/keys.mjs mint --subject <employee> --ttl <8h|2d> [--issuer <label>] [--db <DB_URL>] [--json]\n       node ops/keys.mjs list [--db <DB_URL>] [--json]\n       node ops/keys.mjs revoke <id> [--db <DB_URL>]\n(--db: local hosts only unless --allow-remote; without --db the SQL is printed)', 2);
}
