#!/usr/bin/env node
// serve.mjs — the demo pack host.
//
// Serves the site tree under pack/site/: the de-branded demo phone app at /app/, the real warehouse
// board demo build (VITE_BACKEND=demo, TEST rows) at /board/, the recorded footage at /footage/ when
// present, and the small demo API the phone app needs:
//   GET  /api/demo/library   published skills from the DEMO library instance (port 8751) + the role map
//   POST /api/demo/skill     submit → review → approve → publish a skill through the REAL library gate
//   GET  /api/demo/health    what this host is serving (build hashes), for the acceptance gate
// The app calls the API on its own origin (it is served at /app/, so the path also arrives as
// /app/api/demo/library; both are answered). Nothing here talks to the live warehouse board, any RHL
// production service, or the live company library. DEMO DATA ONLY.
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, extname, normalize, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { LIBRARY_PORT, LIBRARY_ACTOR, DEMO_REVIEWER, ROLE_MAP, SEED_TOOLS } from './demo-config.mjs';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SITE = join(ROOT, 'site');
const APP = join(SITE, 'app');
const BOARD = join(SITE, 'board');
const FOOTAGE = join(SITE, 'footage');
const PORT = Number(process.env.DEMO_PORT || 4966);
const LIB = `http://127.0.0.1:${LIBRARY_PORT}`;
const SEEDED = new Set(SEED_TOOLS.map((t) => t.name));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.ico': 'image/x-icon', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};

function json(res, status, body) {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

function sha256(p) { return createHash('sha256').update(readFileSync(p)).digest('hex'); }

function serveFile(res, base, pathname, { cache = false } = {}) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = resolve(base, rel);
  if (!file.startsWith(resolve(base) + '/') && file !== resolve(base)) { res.writeHead(403); res.end('forbidden'); return; }
  let target = existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file;
  if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
  if (!existsSync(target)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
  const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'content-type': type,
    'content-length': statSync(target).size,
    'cache-control': cache ? 'public, max-age=300' : 'no-store',
    'access-control-allow-origin': '*',
  });
  res.end(readFileSync(target));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 2 * 1024 * 1024) throw new Error('body too large');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function libCall(method, path, body) {
  const res = await fetch(LIB + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`${method} ${path} -> ${res.status} ${parsed?.error?.code || ''} ${parsed?.error?.message || text}`);
    e.status = res.status; e.body = parsed;
    throw e;
  }
  return parsed;
}

function mapTool(t) {
  return {
    name: t.name, version: t.version, description: t.description,
    summary: t.discovery?.summary, keywords: t.discovery?.keywords || [],
    publishedAt: t.publishedAt, author: t.author?.id || null,
  };
}

async function getLibrary() {
  const pub = await libCall('GET', '/tools');
  const all = pub.tools.map(mapTool);
  const role = 'warehouse operator';
  const want = ROLE_MAP[role] || [];
  const chosen = all.filter((t) => want.includes(t.name));
  const fresh = all.filter((t) => !SEEDED.has(t.name)).map((t) => t.name);
  return { ok: true, role, chosen, all, fresh, count: pub.count, source: 'demo library instance (port ' + LIBRARY_PORT + ')' };
}

async function createSkill(body) {
  const manifest = body?.manifest;
  if (!manifest || typeof manifest !== 'object' || !manifest.name || !manifest.version) throw new Error('manifest missing');
  const name = manifest.name, version = manifest.version;
  const steps = [];
  try {
    await libCall('POST', '/tools', { manifest, submittedBy: LIBRARY_ACTOR });
    steps.push('submitted');
  } catch (e) {
    if (e.status !== 409) throw e;
    steps.push('already submitted (409)');
  }
  for (const [label, path, payload] of [
    ['review started', `/tools/${name}/versions/${version}/review`, { action: 'start', reviewer: DEMO_REVIEWER }],
    ['approved', `/tools/${name}/versions/${version}/review`, { action: 'approve', reviewer: DEMO_REVIEWER, reason: 'demo run-through — the skill is reviewed at the library door', acknowledgeEscalation: true }],
    ['published', `/tools/${name}/versions/${version}/publish`, { by: DEMO_REVIEWER }],
  ]) {
    try { await libCall('POST', path, payload); steps.push(label); }
    catch (e) { if (/invalid_transition/.test(String(e.message))) steps.push(`${label} (already)`); else throw e; }
  }
  const sum = await libCall('GET', `/tools/${name}`);
  return { ok: true, tool: { name, version: sum.latestPublished || version, description: manifest.description }, steps };
}

function readdirSafe(dir) {
  try { return readdirSync(dir); } catch { return null; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = url.pathname;
  try {
    // the app is served at /app/, so its relative API calls arrive with that prefix; both shapes answer
    const api = /(?:^|\/)api\/demo\/(health|library|skill)$/.exec(p);
    if (api) {
      const which = api[1];
      if (which === 'health' || (which === 'library' && req.method === 'GET')) {
        if (which === 'library') {
          try { return json(res, 200, await getLibrary()); }
          catch (e) { return json(res, 200, { ok: false, error: e.message, role: 'warehouse operator', chosen: [], all: [], fresh: [] }); }
        }
      }
      if (which === 'health') {
        const health = {
          ok: true,
          service: 'rhl-warehouse-demo-pack',
          demoOnly: true,
          appIndex: existsSync(join(APP, 'index.html')) ? sha256(join(APP, 'index.html')) : null,
          appAssets: existsSync(join(APP, 'assets')) ? readdirSafe(join(APP, 'assets')) : [],
          boardIndex: existsSync(join(BOARD, 'index.html')) ? sha256(join(BOARD, 'index.html')) : null,
          boardAssets: existsSync(join(BOARD, 'assets')) ? readdirSafe(join(BOARD, 'assets')) : [],
          library: LIB,
          footage: existsSync(FOOTAGE) ? readdirSafe(FOOTAGE) : [],
        };
        return json(res, 200, health);
      }
      if (which === 'library' && req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      if (which === 'skill' && req.method === 'POST') {
        try { return json(res, 200, await createSkill(await readBody(req))); }
        catch (e) { return json(res, 200, { ok: false, error: e.message }); }
      }
      if (which === 'skill') { res.writeHead(405); res.end(); return; }
    }

    if (p.startsWith('/footage/')) return serveFile(res, FOOTAGE, p.slice('/footage/'.length), { cache: true });
    // the board build's logo/agent docs are relative inside /board/, but answer the root paths too for
    // a page that embeds the board standalone
    if (p === '/rhl-logo.svg' || p === '/rhl-logo-light.svg' || p === '/agent.json' || p === '/agent-tools.json') return serveFile(res, BOARD, p.slice(1));
    if (p === '/board' || p === '/board/') return serveFile(res, BOARD, 'index.html');
    if (p.startsWith('/board/')) return serveFile(res, BOARD, p.slice('/board/'.length));
    if (p === '/app' || p === '/app/') return serveFile(res, APP, 'index.html');
    if (p.startsWith('/app/')) return serveFile(res, APP, p.slice('/app/'.length));
    if (p === '/' || p === '/index.html') {
      if (existsSync(join(SITE, 'index.html'))) return serveFile(res, SITE, 'index.html');
      res.writeHead(302, { location: '/app/?demo=rhl' });
      return res.end();
    }
    return serveFile(res, SITE, p);
  } catch (e) {
    json(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DEMO HOST on http://0.0.0.0:${PORT}  (guest sees http://10.0.2.2:${PORT})`);
  console.log(`  app   ${APP}`);
  console.log(`  board ${BOARD}`);
  console.log(`  library ${LIB}`);
});
