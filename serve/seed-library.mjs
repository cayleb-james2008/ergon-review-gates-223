#!/usr/bin/env node
// tools/seed-library.mjs — seed the DEMO instance of the Ergon shared tool library.
// Everything passes through the real review gate: submit → start review → approve → publish.
// DEMO DATA ONLY: the service runs against showcase/library-data inside this mission's work dir.
import { LIBRARY_PORT, LIBRARY_ACTOR, DEMO_REVIEWER, SEED_TOOLS } from './demo-config.mjs';

const BASE = `http://127.0.0.1:${LIBRARY_PORT}`;

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status} ${json?.error?.code || ''} ${json?.error?.message || text}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

const toolName = (m) => m.name;

export async function publishSeedTool(manifest) {
  const name = toolName(manifest);
  const version = manifest.version;
  try {
    await call('POST', '/tools', { manifest, submittedBy: LIBRARY_ACTOR });
  } catch (e) {
    if (e.status !== 409) throw e; // 409 = same version already there (idempotent reseed)
  }
  try { await call('POST', `/tools/${name}/versions/${version}/review`, { action: 'start', reviewer: DEMO_REVIEWER }); }
  catch (e) { if (!/invalid_transition/.test(String(e.message))) throw e; }
  try {
    await call('POST', `/tools/${name}/versions/${version}/review`, { action: 'approve', reviewer: DEMO_REVIEWER, reason: 'demo seed — typed I/O and surfaces checked', acknowledgeEscalation: true });
  } catch (e) { if (!/invalid_transition/.test(String(e.message))) throw e; }
  try { await call('POST', `/tools/${name}/versions/${version}/publish`, { by: DEMO_REVIEWER }); }
  catch (e) { if (!/invalid_transition/.test(String(e.message))) throw e; }
  const summary = await call('GET', `/tools/${name}`);
  return { name, version, latestPublished: summary.latestPublished };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const m of SEED_TOOLS) {
    const r = await publishSeedTool(m);
    console.log(`SEEDED ${r.name}@${r.version} latestPublished=${r.latestPublished}`);
  }
  const all = await call('GET', '/tools');
  console.log(`LIBRARY published=${all.count}: ${all.tools.map((t) => t.name).join(', ')}`);
}
