// Single source of truth for who may frame the board: ops/harness-origins.json. Read by ops/headers.mjs (the frame-ancestors header) and by vite.config.js
// (the postMessage allow-list baked into the build). There is no second list and no environment variable that carries origins.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ORIGINS_FILE = fileURLToPath(new URL('./harness-origins.json', import.meta.url));

// loopback http is accepted only for the test harness (the e2e serves its fake embedder from 127.0.0.1); the header generator never passes it
export function validate(origins, { loopback = false } = {}) {
  if (!Array.isArray(origins)) throw new Error('harness origins must be an array of exact https origins');
  for (const o of origins) {
    if (typeof o !== 'string' || o.includes('*')) throw new Error(`wildcards are not allowed in harness origins: ${o}`);
    const ok = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(o) || (loopback && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(o));
    if (!ok) throw new Error(`not an exact https origin (scheme://host[:port], no path): ${o}`);
  }
  return origins;
}

export function readOrigins(file = ORIGINS_FILE, opts) {
  return validate(JSON.parse(readFileSync(file, 'utf8')).origins, opts);
}

export const policy = (origins) => `frame-ancestors ${["'self'", ...origins].join(' ')}`;
