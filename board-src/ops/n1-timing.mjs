// N1: HTTPS, every response 200, median server response <= 3.0 s (cold start included).
// usage: node ops/n1-timing.mjs <URL> [runs=15]   (full page load is measured separately in a browser)
const [url, runsArg] = process.argv.slice(2);
if (!url?.startsWith('https://')) { console.error('usage: node ops/n1-timing.mjs https://<url> [runs]'); process.exit(2); }
const runs = Number(runsArg || 15);
const html = await (await fetch(url, { cache: 'no-store' })).text();
const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|svg))"/g)].map((m) => new URL(m[1], url).href);
const times = []; const bad = [];
for (let i = 0; i < runs; i++) {
  for (const u of [url, ...assets]) {
    const t0 = performance.now();
    const r = await fetch(u, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
    await r.arrayBuffer();
    times.push((performance.now() - t0) / 1000);
    if (r.status !== 200) bad.push(`${u} ${r.status}`);
  }
}
times.sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
const pass = bad.length === 0 && median <= 3.0;
console.log(JSON.stringify({ url, responses: times.length, nonOk: bad, medianS: +median.toFixed(3), maxS: +times.at(-1).toFixed(3), pass }, null, 2));
process.exit(pass ? 0 : 1);
