// N5: viewing open; every write needs a valid agent-issued key; no passcode surface; nothing sensitive exposed.
// usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... node ops/n5-access.mjs <board URL>
const [board] = process.argv.slice(2);
const { SUPABASE_URL: base, SUPABASE_ANON_KEY: key } = process.env;
if (!board || !base || !key) { console.error('need <board URL>, SUPABASE_URL, SUPABASE_ANON_KEY'); process.exit(2); }
const h = { apikey: key, Authorization: `Bearer ${key}`, 'Accept-Profile': 'ergon_warehouse', 'Content-Profile': 'ergon_warehouse', 'Content-Type': 'application/json' };
const rest = (m, p, b) => fetch(`${base}/rest/v1/${p}`, { method: m, headers: h, body: b && JSON.stringify(b) });
const checks = [];
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); };
check('board loads without sign-in', (await fetch(board)).status === 200);
check('anon can view lines', (await rest('GET', 'lines?select=id&limit=1')).status === 200);
for (const [m, p, b] of [['POST', 'entries', { title: 'x' }], ['PATCH', 'entries?id=not.is.null', { title: 'x' }], ['DELETE', 'entries?id=not.is.null'], ['POST', 'lines', { code: 'Z' }]]) {
  const r = await rest(m, p, b); check(`anon ${m} ${p.split('?')[0]} refused`, [401, 403].includes(r.status), `status ${r.status}`);
}
const bogus = 'ergk_' + 'A'.repeat(43);
const rpc = await (await rest('POST', 'rpc/save_entry', { p_key: bogus, p_entry: { line_code: 'A', title: 'N5 probe' } })).json();
check('unknown key refused, nothing written', rpc.ok === false && rpc.error === 'key_invalid', JSON.stringify(rpc));
const none = await (await rest('POST', 'rpc/save_entry', { p_key: '', p_entry: { line_code: 'A', title: 'N5 probe' } })).json();
check('no key refused, nothing written', none.ok === false && none.error === 'key_invalid', JSON.stringify(none));
check('private key table unreadable', [401, 403, 404].includes((await rest('GET', 'access_keys?select=*')).status));
check('issuer functions not callable by anon', [401, 403, 404].includes((await rest('POST', 'rpc/mint_access_key', { p_key_hash: 'a'.repeat(64), p_key_prefix: 'ergk_AAAA', p_subject: 'x', p_expires_at: '2099-01-01T00:00:00Z' })).status));
check('no passcode surface exists', [401, 403, 404].includes((await rest('POST', 'rpc/check_passcode', { p_passcode: 'x' })).status));
for (const p of ['/.env', '/.git/config', '/package.json', '/supabase/config.toml', '/src/main.js']) {
  const r = await fetch(new URL(p, board)); const ct = r.headers.get('content-type') || '';
  check(`${p} not served`, r.status === 404 || ct.includes('text/html'), `status ${r.status} ${ct}`);
}
const bundle = await Promise.all([...(await (await fetch(board)).text()).matchAll(/src="(\/assets\/[^"]+\.js)"/g)].map((m) => fetch(new URL(m[1], board)).then((r) => r.text())));
check('no service-role/secret key in shipped JS', !/service_role|sb_secret_/.test(bundle.join('')));
console.table(checks); process.exit(checks.every((c) => c.ok) ? 0 : 1);
