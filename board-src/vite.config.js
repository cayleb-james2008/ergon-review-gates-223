import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readOrigins } from './ops/harness-origins.mjs';

// Build id shown in the app so a device can be matched to a deployment (N2). RHL_BUILD_ID wins (a CLI deploy has no git: pass it with --build-env),
// then Vercel's commit sha, then git.
const sha = process.env.RHL_BUILD_ID || process.env.VERCEL_GIT_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); } catch { return 'local'; } })();
const root = (p) => fileURLToPath(new URL(p, import.meta.url));

// The rendered style guide (design pack) is a second entry. It is built only when STYLEGUIDE=1 (the pack-check test), so the
// production bundle ships the board alone.
const input = { main: root('index.html'), ...(process.env.STYLEGUIDE === '1' ? { styleguide: root('styleguide.html') } : {}) };

// Production load: the first data read must not wait for the app. For a Supabase build, index.html connects to the API origin straight away and starts the
// two first-load reads before any script has downloaded; the adapter picks the answers up (src/data/supabase.js, __rhlEarly). The URL and key are the public
// ones already in the bundle. Same URLs and headers PostgREST would be asked with, so a failed or odd answer just falls back to the normal read.
function earlyFetch(env) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  return {
    name: 'rhl-early-fetch',
    transformIndexHtml() {
      if (env.VITE_BACKEND === 'demo' || !url || !key) return [];
      const api = `${new URL(url).origin}/rest/v1`;
      const script = `(function(){try{var h={apikey:${JSON.stringify(key)},Authorization:'Bearer '+${JSON.stringify(key)},'Accept-Profile':'ergon_warehouse'};`
        + `var g=function(p){return fetch(${JSON.stringify(api)}+p,{headers:h}).then(function(r){if(!r.ok)throw 0;return r.json()})};`
        + `var p=Promise.all([g('/lines?select=id%2Ccode%2Csort_order%2Cis_test%2Ccreated_at&order=sort_order.asc'),`
        + `g('/entries?select=id%2Cline_id%2Ctitle%2Cdetails%2Cinitials%2Cstatus%2Crevision%2Cis_test%2Ccreated_at%2Cupdated_at%2Cupdated_by&order=created_at.asc')]);`
        + `p.catch(function(){});window.__rhlEarly=p}catch(e){}})();`;
      return [
        { tag: 'link', attrs: { rel: 'preconnect', href: new URL(url).origin, crossorigin: '' }, injectTo: 'head-prepend' },
        { tag: 'script', children: script, injectTo: 'head' },
      ];
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_'))) };
  const demo = env.VITE_BACKEND === 'demo';
  return {
    plugins: [react(), tailwindcss(), earlyFetch(env)],
    resolve: { alias: { '@': root('src'), '@backend': root(demo ? 'src/data/backend-demo.js' : 'src/data/backend-supabase.js') } },
    // the embedders the page may post command text to: the same list that drives the frame-ancestors header (ops/harness-origins.json). HARNESS_ORIGINS_FILE
    // only points the build at another copy of that file (the e2e harness); loopback http is accepted for that case alone.
    define: { __BUILD_ID__: JSON.stringify(sha.trim().slice(0, 7)), __HARNESS_ORIGINS__: JSON.stringify(readOrigins(process.env.HARNESS_ORIGINS_FILE || undefined, { loopback: !!process.env.HARNESS_ORIGINS_FILE })) },
    base: './',
    build: { target: 'es2022', sourcemap: false, rollupOptions: { input } },
    server: { host: '127.0.0.1' },
  };
});
