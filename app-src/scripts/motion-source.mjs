// M1: one source for motion values. Run in a project root: node scripts/motion-source.mjs   (render-check.mjs runs it)
//
// Reads the screen source: every .ts and .tsx file under src/ except the copied library files and the bench (the same files
// scripts/role-coverage.mjs reads: not src/components, src/lib, src/utils, src/hooks, src/bench), and src/motion.ts, which is
// the one place the numbers live. Fails on, each with file and line:
//   1. a literal stiffness, damping, bounce, mass, duration, visualDuration or delay number (zero is allowed: duration 0 is `instant`;
//      a quoted key counts) in a transition: `transition={{...}}` or `transition: {...}`, an object that says type "spring", "tween",
//      "inertia" or "keyframes", the options of animate(), useSpring() or spring(), or a stiffness, damping or bounce key anywhere;
//      and in those places the value of a duration, visualDuration, delay, stiffness, damping, bounce or mass key that is not a
//      number must be a member of the presets file (dur.x, a preset's key, a name imported from "@/motion"), never a local variable
//      or arithmetic;
//   2. a numeric ease array (ease: [0.2, 0.8, 0.2, 1]); a style value transitionDuration, animationDuration, transitionDelay,
//      animationDelay, transitionTimingFunction or animationTimingFunction that is not a var(--dur-*) or var(--ease-house) (0 is fine);
//   3. a Tailwind class that sets a literal duration, delay or easing (duration-200, delay-75, ease-out, ease-[...]) or an arbitrary
//      property that does ([transition-duration:300ms], [animation-delay:1s], [transition-timing-function:...], a [transition:...]
//      or [animation:...] with a time or cubic-bezier in it); the house takes them from tokens: duration-(--dur-press), ease-(--ease-house);
//   4. transition-all, `transition: all` or transitionProperty "all" (also in src/*.css);
//   5. in src/*.css (not the copied library files): a transition or animation (shorthand, -duration, -delay) whose time is a literal
//      instead of var(--dur-*) (a calc() of a token is fine; 0 and anything of a millisecond or less, the reduced-motion idiom, is
//      instant) and a transition or animation whose easing is a literal cubic-bezier or ease keyword instead of var(--ease-house);
//   6. src/motion.ts missing, a preset in it with no comment naming its source, or its easing and durations not equal to the
//      --ease-house and --dur-* tokens of the tokens file (src/tokens.css, or ../references/tokens.css in the starter).
// A // or /* inside a string is not a comment. It does not check that a preset is the right one for the cause, nor motion inside the
// copied library files, nor Tailwind's @theme animation tokens.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "src");
const fails = [];
const fail = (where, msg) => { fails.push(`${where}: ${msg}`); console.error(`FAIL [motion-source] ${where}: ${msg}`); };
const rel = (p) => path.relative(root, p);
const inLib = (f) => /^(components|lib|utils|hooks|bench)(\/|$)/.test(path.relative(src, f).replace(/\\/g, "/"));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
// Comments become spaces (newlines kept). A // or /* inside a string is not a comment; a quote that is never closed ends with its line (an apostrophe in JSX text); "://" is a URL.
const strip = (s) => {
  let o = "", q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i], d = s[i + 1];
    if (q) { o += c; if (c === "\\") o += s[++i] ?? ""; else if (c === q || (c === "\n" && q !== "`")) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; o += c; continue; }
    if (c === "/" && d === "/" && s[i - 1] !== ":") { for (; i < s.length && s[i] !== "\n"; i++) o += " "; i--; continue; }
    if (c === "/" && d === "*") { const e = s.indexOf("*/", i + 2), end = e < 0 ? s.length : e + 2; for (; i < end; i++) o += s[i] === "\n" ? "\n" : " "; i--; continue; }
    o += c;
  }
  return o;
};
const lineOf = (t, i) => t.slice(0, i).split("\n").length;

// The text of the balanced group that opens at text[open] ({ or ( ), string-aware.
function group(t, open) {
  const pair = { "{": "}", "(": ")" }[t[open]]; let depth = 0, q = null;
  for (let i = open; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if (c === t[open]) depth++; else if (c === pair && --depth === 0) return [open, i + 1];
  }
  return [open, t.length];
}
// The expression that starts at t[i] and ends at the next comma or closing bracket of its own level.
function valueAt(t, i) {
  let depth = 0, q = null, k = i;
  for (; k < t.length; k++) {
    const c = t[k];
    if (q) { if (c === "\\") k++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") { q = c; continue; }
    if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) { if (depth === 0) break; depth--; }
    else if (c === "," && depth === 0) break;
  }
  return t.slice(i, k).trim();
}
// The innermost { } that holds index i.
function enclosing(t, i) {
  let depth = 0, q = null;
  for (let k = i; k >= 0; k--) {
    const c = t[k];
    if (c === "}") depth++; else if (c === "{") { if (depth === 0) return k; depth--; }
  }
  return -1;
}

const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?`;
const SPRING_KEYS = ["stiffness", "damping", "bounce", "restSpeed", "restDelta"];
const TIME_KEYS = ["duration", "visualDuration", "delay", "mass", "staggerChildren", "delayChildren"];
const MEMBER_KEYS = ["duration", "visualDuration", "delay", "stiffness", "damping", "bounce", "mass"]; // in a transition these take a member of src/motion.ts, never a number, a local variable or arithmetic

function scanMotion(file, raw) {
  const t = strip(raw), hits = new Map(); // index -> message
  const imported = new Set(); // names this file takes from the presets file (src/motion.ts)
  for (let m, re = /\bimport\s*(?:type\s*)?(?:\{([^}]*)\}|\*\s*as\s+(\w+))\s*from\s*["'](?:@\/|\.{1,2}\/)(?:[\w.\/-]*\/)?motion(?:\.tsx?)?["']/g; (m = re.exec(t)); ) {
    if (m[2]) imported.add(m[2]);
    else for (const part of m[1].split(",")) { const nm = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim(); if (nm) imported.add(nm); }
  }
  const keyRe = (keys) => new RegExp(String.raw`["']?\b(${keys.join("|")})["']?\s*:\s*(${NUM})(?![\w.])`, "g");
  const scanRegion = (a, b, keys, member = true) => {
    const re = keyRe(keys); re.lastIndex = a;
    for (let m; (m = re.exec(t)) && m.index < b; ) {
      const v = Number(m[2]);
      if ((m[1] === "duration" || m[1] === "delay") && v === 0) continue; // instant
      hits.set(m.index, `a literal ${m[1]} of ${m[2]} in a motion value`);
    }
    // not a number: it must be a member of the presets file (dur.x, a preset's own key, a name imported from it), not a local variable or arithmetic
    if (!member) return;
    const re2 = new RegExp(String.raw`["']?\b(${MEMBER_KEYS.join("|")})["']?\s*:\s*`, "g"); re2.lastIndex = a;
    for (let m; (m = re2.exec(t)) && m.index < b; ) {
      const v = valueAt(t, m.index + m[0].length);
      if (!v || new RegExp(`^${NUM}$`).test(v)) continue; // a number is the literal rule above
      const chains = v.match(/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/g) ?? [];
      const rest = v.replace(/[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*/g, "").trim();
      const local = chains.find((c) => !imported.has(c.split(".")[0].trim()));
      if (rest || local || !chains.length) hits.set(m.index, `${m[1]}: ${v.slice(0, 40)} is not a member of @/motion (${local ? `${local.split(".")[0]} is not imported from it` : "arithmetic or an expression"})`);
    }
  };
  // 1a. transition={{ ... }} and transition: { ... }
  for (let m, re = /\btransition\s*[:=]\s*\{/g; (m = re.exec(t)); ) { const [a, b] = group(t, m.index + m[0].length - 1); scanRegion(a, b, [...SPRING_KEYS, ...TIME_KEYS]); }
  // 1b. an object that says what kind of transition it is
  for (let m, re = /\btype\s*:\s*["'](?:spring|tween|inertia|keyframes)["']/g; (m = re.exec(t)); ) {
    const o = enclosing(t, m.index); if (o < 0) continue; const [a, b] = group(t, o); scanRegion(a, b, [...SPRING_KEYS, ...TIME_KEYS]);
  }
  // 1c. the options of animate(), useSpring(), spring()
  for (let m, re = /(?<![\w$.])(?:animate|useSpring|spring)\s*\(/g; (m = re.exec(t)); ) { const [a, b] = group(t, m.index + m[0].length - 1); scanRegion(a, b, [...SPRING_KEYS, ...TIME_KEYS]); }
  // 1d. a spring key anywhere
  scanRegion(0, t.length, SPRING_KEYS, false);
  const out = [...hits.entries()].sort((x, y) => x[0] - y[0]).map(([i, msg]) => [lineOf(t, i), msg]);
  for (const [line, msg] of out) fail(`${rel(file)}:${line}`, `${msg}: take a preset (glide, open, roll, island, layout, reveal, press, stagger, instant) or dur.x from @/motion and cite nothing of your own`);

  // 1e. a numeric ease array, and a literal transition or animation time or easing in a style object
  for (let m, re = /["']?\b(?:ease|easing)["']?\s*:\s*\[\s*-?(?:\d|\.\d)/g; (m = re.exec(t)); ) fail(`${rel(file)}:${lineOf(t, m.index)}`, "a numeric ease array of your own: take `ease` from @/motion (references/motion.md section 4)");
  for (let m, re = /\b(transition|animation)(Duration|Delay|TimingFunction)\s*:\s*/g; (m = re.exec(t)); ) {
    const v = valueAt(t, m.index + m[0].length), tok = m[2] === "TimingFunction" ? /var\(--ease-house\)/ : /var\(--dur-/;
    if (tok.test(v) || /^["'`]?0(?:m?s)?["'`]?$/.test(v)) continue;
    fail(`${rel(file)}:${lineOf(t, m.index)}`, `the style value ${m[0].trim()} ${v.slice(0, 30)} is a literal time or easing: use "var(--dur-press)" (a --dur-* token) or "var(--ease-house)"`);
  }

  // 2 and 3. Tailwind classes and transition: all, in any string of the file
  const variant = String.raw`(?:[\w\[\]=&>*().:-]+:)*`;
  const cls = [
    [new RegExp(String.raw`(?<![\w-])${variant}(?:duration|delay)-(?:\d+|\[[^\]\s]+\])(?![\w-])`, "g"), (m) => `the Tailwind class "${m[0]}" sets a literal duration or delay: use duration-(--dur-press), duration-(--dur-reveal), duration-(--dur-swap), duration-(--dur-enter) or duration-(--dur-sheet)`],
    [new RegExp(String.raw`(?<![\w-])${variant}ease-(?:linear|in|out|in-out|\[[^\]\s]+\])(?![\w-])`, "g"), (m) => `the Tailwind class "${m[0]}" sets a literal easing: use ease-(--ease-house)`],
    [new RegExp(String.raw`(?<![\w-])${variant}\[(?:transition|animation)-(?:duration|delay|timing-function):(?:(?!var\(--(?:dur-|ease-house)\))[^\]\s])+\]`, "g"), (m) => `the Tailwind arbitrary property "${m[0]}" sets a literal duration, delay or timing function: use duration-(--dur-press) and ease-(--ease-house)`],
    [new RegExp(String.raw`(?<![\w-])${variant}\[(?:transition|animation):(?:(?!var\(--(?:dur-|ease-house)\))[^\]\s])*(?:\d(?:ms|s)|cubic-bezier)[^\]\s]*\]`, "g"), (m) => `the Tailwind arbitrary property "${m[0]}" sets a literal time or easing: name the properties with transition-colors and the like and take the time from duration-(--dur-press) and ease-(--ease-house)`],
    [new RegExp(String.raw`(?<![\w-])${variant}transition-all(?![\w-])`, "g"), () => `transition-all animates every property: name them (transition-colors, transition-opacity, transition-transform, transition-[box-shadow])`],
    [/\btransition(?:Property)?\s*:\s*["'`]?\s*all\b/g, () => `a transition on "all": name the properties`],
    [/\btransition-property\s*:\s*all\b/g, () => `a transition on "all": name the properties`],
  ];
  for (const [re, msg] of cls) for (let m; (m = re.exec(t)); ) fail(`${rel(file)}:${lineOf(t, m.index)}`, msg(m));
}

const files = walk(src).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !inLib(f) && path.relative(src, f) !== "motion.ts");
for (const f of files) scanMotion(f, fs.readFileSync(f, "utf8"));
for (const f of walk(src).filter((f) => f.endsWith(".css") && !inLib(f))) {
  const c = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  for (let m, re = /\btransition(?:-property)?\s*:\s*all\b/g; (m = re.exec(c)); ) fail(`${rel(f)}:${lineOf(c, m.index)}`, "a transition on \"all\": name the properties");
  // a time must be a --dur-* token (a calc() of one is fine; 0 and a hundredth of a millisecond, the reduced-motion idiom, are instant) and an easing --ease-house
  for (let m, re = /(?<![\w-])(transition|animation)(-duration|-delay|-timing-function)?\s*:\s*([^;}]+)/g; (m = re.exec(c)); ) {
    const v = m[3].replace(/!important/, "").replace(/calc\((?:[^()]|\([^()]*\))*\)/g, (x) => (/var\(--dur-/.test(x) ? "T" : x)).replace(/var\(--[\w-]+\)/g, "V");
    const lit = [...v.matchAll(/(?<![\w.-])(\d*\.?\d+)(ms|s)\b/g)].find((x) => Number(x[1]) * (x[2] === "s" ? 1000 : 1) > 1);
    const ease = m[2] !== "-duration" && m[2] !== "-delay" && (/cubic-bezier\(/.test(v) || /(?<![\w-])ease(?:-in|-out|-in-out)?(?![\w-])/.test(v));
    if (lit) fail(`${rel(f)}:${lineOf(c, m.index)}`, `a literal time ${lit[0]} in ${m[0].trim().slice(0, 40)}: use var(--dur-press), var(--dur-reveal), var(--dur-swap), var(--dur-enter) or var(--dur-sheet) (a calc() of one is fine)`);
    else if (ease) fail(`${rel(f)}:${lineOf(c, m.index)}`, `a literal easing in ${m[0].trim().slice(0, 40)}: use var(--ease-house)`);
  }
}

// 4. the presets themselves
const mf = path.join(src, "motion.ts");
if (!fs.existsSync(mf)) fail("src/motion.ts", "missing: the house presets (press, glide, open, roll, island, layout, reveal, stagger) live there, copied from the starter");
else {
  const raw = fs.readFileSync(mf, "utf8"), lines = raw.split("\n");
  const exported = [];
  lines.forEach((l, i) => { const m = l.match(/^export const (\w+)/); if (m) exported.push([m[1], i]); });
  for (const [name, i] of exported) {
    let k = i - 1, comment = [];
    while (k >= 0 && /^\s*(\/\*\*|\*|\/\/|\*\/)/.test(lines[k])) comment.unshift(lines[k--]);
    if (!/Source:|references\/motion\.md/.test(comment.join(" "))) fail(`src/motion.ts:${i + 1}`, `the preset ${name} has no comment that gives its source in references/motion.md`);
  }
  const tokenFile = [path.join(src, "tokens.css"), path.join(root, "..", "references", "tokens.css")].find((f) => fs.existsSync(f));
  const tk = tokenFile ? fs.readFileSync(tokenFile, "utf8") : "";
  const cssEase = tk.match(/--ease-house\s*:\s*cubic-bezier\(([^)]*)\)/)?.[1].split(",").map(Number);
  const jsEase = raw.match(/export const ease = \[([^\]]*)\]/)?.[1].split(",").map(Number);
  if (!cssEase) fail(tokenFile ? rel(tokenFile) : "tokens.css", "has no --ease-house token (cubic-bezier(...))");
  else if (!jsEase || jsEase.join() !== cssEase.join()) fail("src/motion.ts", `ease [${jsEase}] is not the --ease-house token cubic-bezier(${cssEase})`);
  const jsDur = raw.match(/export const dur = \{([^}]*)\}/)?.[1];
  for (const k of ["press", "reveal", "swap", "enter", "sheet"]) {
    const css = tk.match(new RegExp(String.raw`--dur-${k}\s*:\s*(\d+)ms`))?.[1];
    const js = jsDur?.match(new RegExp(String.raw`\b${k}\s*:\s*(${NUM})`))?.[1];
    if (!css) fail(tokenFile ? rel(tokenFile) : "tokens.css", `has no --dur-${k} token in ms`);
    else if (js === undefined || Math.round(Number(js) * 1000) !== Number(css)) fail("src/motion.ts", `dur.${k} (${js} s) is not the --dur-${k} token (${css} ms)`);
  }
}

console.log(`motion-source: ${fails.length ? `FAILED (${fails.length})` : `ok, ${files.length} screen files read, src/motion.ts and the tokens agree`}`);
process.exit(fails.length ? 1 : 0);
