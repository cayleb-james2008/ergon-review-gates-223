// Shared e2e harness: build the app for a backend, serve it with `vite preview`, drive it with playwright-core.
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITE = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

export const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});

export async function buildAndServe(env, { port: wanted } = {}) { // env may carry STYLEGUIDE=1 to build the style guide entry as well
  const outDir = mkdtempSync(join(tmpdir(), 'rhl-board-e2e-'));
  execFileSync(process.execPath, [VITE, 'build', '--outDir', outDir, '--emptyOutDir'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'pipe' });
  const port = wanted ?? await freePort();
  const child = spawn(process.execPath, [VITE, 'preview', '--outDir', outDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { url, port, outDir, stop() { child.kill('SIGTERM'); rmSync(outDir, { recursive: true, force: true }); } };
}

export const launch = (extra = []) => chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', ...extra] });

// A browser context that records console errors, failed requests and every request URL.
export async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, ...opts });
  const log = { errors: [], failed: [], requests: [] };
  ctx.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  ctx.on('weberror', (e) => log.errors.push(String(e.error())));
  ctx.on('requestfailed', (r) => log.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  ctx.on('request', (r) => log.requests.push(r.url()));
  return { ctx, log };
}

export async function openBoard(ctx, base, flag = '', { key = '' } = {}) {
  const page = await ctx.newPage();
  await page.goto(base + (flag ? `?demo=${flag}` : '') + (key ? `#key=${key}` : ''));
  await page.waitForSelector('#board[data-state="ready"], #board[data-state="empty"], #board[data-state="error"]');
  if (key) await page.waitForSelector('#key-status[data-state]:not([data-state="checking"])');
  return page;
}

// A fixed, app-independent workload (1200 elements created and 20 forced layouts) measured in the page at whatever CPU throttle the caller has
// already set. Host contention and throttling inflate it exactly as they inflate the board's own tasks, so a wall-clock bound can be written
// against it ("no more than k times this") instead of against bare milliseconds, which are a property of the machine, not of the app.
// Reported, not asserted: a caller that ignores the number keeps the plain absolute bound.
export async function hostRef(page) {
  const ms = await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px';
    document.body.appendChild(host);
    const t0 = performance.now();
    for (let round = 0; round < 20; round++) {
      host.textContent = '';
      for (let i = 0; i < 60; i++) {
        const d = document.createElement('div');
        d.textContent = `ref ${i}`;
        d.style.cssText = 'padding:2px;border:1px solid #888';
        host.appendChild(d);
      }
      void host.offsetHeight; // force layout
    }
    const ms = performance.now() - t0;
    host.remove();
    return Math.round(ms);
  });
  return ms;
}

// The demo issuer's public test keys (the same #key= fragment an agent uses in production).
export const DEMO_KEY = 'demo-employee';
export const DEMO_KEYS = { valid: 'demo-employee', expired: 'demo-expired', revoked: 'demo-revoked' };

// An agent hands a key to a board that is already open by changing the fragment; the board takes it in and strips it.
export async function unlock(page, key = DEMO_KEY, state = 'valid') {
  await page.evaluate((k) => { location.hash = `key=${k}`; }, key);
  await page.waitForSelector(`#key-status[data-state="${state}"]`);
  await page.waitForFunction(() => !location.hash.includes('key='));
}

// Radix selects are buttons (role=combobox) that open a listbox in a portal: click the trigger, then the option by its name.
export async function choose(page, trigger, label) {
  await (typeof trigger === 'string' ? page.locator(trigger) : trigger).click();
  const option = page.getByRole('option', { name: label, exact: true });
  await option.click();
  // Wait for the list to be gone before the caller types or presses Enter. Without this, a slow frame leaves the listbox open, the caller's
  // Enter closes the listbox instead of submitting the dialog, and the next wait times out 30 s later somewhere else entirely.
  await option.waitFor({ state: 'detached' });
}
export const STATUS_TRIGGER = '[role="combobox"][data-field="status"]';
