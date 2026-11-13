// Product rules for spacing and for controls that answer. render-check.mjs runs them in product mode.
//
//   node scripts/product-rules.mjs [S|A]     serves dist/ and runs them alone (S = spacing S1 to S7 at 1440 and 390 and S6 at the
//                                            laptop sizes, A = controls at 1440)
//
// Spacing (S1 to S5 and S7, at 1440 x 900 and 390 x 844, light theme, page at rest, scrolled to the top). Each failure names the
// rule, the element, the numbers measured and what to change.
//   S1 clipped beside empty  A band of empty canvas at least 64 px tall in the first screenful (no text, no filled or
//      bordered box, nothing fixed over it; a rect is measured with the clip of its overflow ancestors) while some text in
//      the first screenful is hidden by a clamp of two lines or more. The space is there; the words are cut. A single-line
//      ellipsis is a matter of width, not of height, and is not paired with a band.
//   S2 hollow box            In a box with chrome (a border on all four sides or a background unlike its parent's, whatever its corner
//      radius; at least 120 x 120, under 70 percent of the viewport height) the blocks stacked in it (single-child wrappers looked
//      through) leave a hole when: three or more blocks have a largest gap over 40 px and over three times the lower median; or exactly
//      two blocks have a gap over 64 px; or the room under the last block is over 40 px and over three times the room above the first.
//      data-spacing="pinned" on the box lists it instead; more than two fail. (A border means a border on all four sides; a rule
//      on one side, such as a divider, is not a box.)
//   S3 one rhythm for one kind  Three or more neighbours of one kind: equal gaps (within 1 px, one axis at a time) and equal paddings
//      (within 1 px). One kind = the same tag, the same display and the same size within 1 px along the way they run (the same
//      width when side by side, the same height when stacked, both when the run wraps); class lists are not compared, so one
//      differing class does not hide a card. The other extent is not evidence (a flex or grid item is stretched to its row or
//      column). The line counts how many runs were compared.
//   S4 edges line up         The top-level regions of the main content (single-child wrappers without chrome flattened,
//      fixed elements ignored) share one left edge and one right edge within 1 px.
//   S5 text has room         Text inside a box with chrome is 8 px from its left and right edges (the border box) (4 in a chip, a box
//      24 px tall or less, where the kit's own kbd and count chips measure 4 to 6; 6 inside a fully
//      rounded pill) and 4 px from its top and bottom (the text is measured as its em box, font-size tall, not the line box). In a chip
//      or pill 24 px tall or less the vertical floor is 3 px: the kit's own 18 px badge with 12 px text has 3 above and below.
//   S6 nothing fixed covers an answer  At 1366 x 768, 1280 x 720 and 1536 x 864, with the page at rest at the top, no element with
//      position fixed or sticky (a click-through wrapper is replaced by the pieces inside it that take the pointer) overlaps an
//      element marked data-answers, other than its own ancestors and descendants, by more than 8 px in both directions while it is
//      painted above it (a backdrop behind the answer is not a cover). Run by checkLaptops.
//   S7 a label sits in the middle of its control  At 1440 and 390: in a button, role button, radio, tab, switch or menuitem up to 64 px
//      tall that holds one line of text, the vertical centre of the text is within 2 px of the control's centre.
// Controls (A1, 1440 x 900, light, normal motion): every visible enabled control in the first screenful (buttons, links, tabs,
// switches, role button, menuitem, option, checkbox, summary, tabindex 0 with a pointer cursor, and any other element with a pointer
// cursor of its own or an onclick that is not inside another control and holds none) takes a fingerprint of itself, its ::before and
// ::after and its first 40 rendered descendants (display none and no-box elements are skipped; background, text and border colours,
// outline, box-shadow, opacity, transform, translate, scale, filter, fill, stroke, box). Two fingerprints are taken at rest 300 ms
// apart (three reads); a property that differs between them is moving by itself, and is left out. Hover must change the fingerprint
// within 300 ms; when the hover has settled (two equal reads 100 ms apart), holding the mouse down must change that settled
// fingerprint again within 200 ms (the pointer leaves before release, so nothing is activated; an option that already shows
// itself chosen, aria-selected, aria-pressed, aria-current or a checked radio or checkbox, needs no hover answer), and Tab must show
// a focus ring (a visible outline or a box-shadow that was not there). Text inputs need the ring only. At most CAP controls are
// tested; the rest are counted, and so are the controls below the first screenful. A failure line names a control by its accessible
// text (aria-label, else the rendered text that is not aria-hidden).
//
// What none of this decides: optical alignment, whether a layout is pleasant, whether the proportions are right. Those stay
// with a reviewer and with the owner. S3 compares neighbours by size only and S4 only the top-level regions of main.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

export const VH = { 1440: 900, 390: 844 };
const CAP = 80;       // controls tested by A1 (the rest are counted and printed)
const MORE = Number(process.env.PRODUCT_RULES_LINES) || 8; // lines printed per rule before "and N more"

// ---------------------------------------------------------------------------------------------------------------------
// S1 to S5, S7 (and S6 when only is "S6"): one pass in the page, returns { S1: [...], ... } of finished lines.
const measureSpacing = ({ vh, only }) => {
  const R = (el) => { const r = el.getBoundingClientRect(); return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY, w: r.width, h: r.height }; };
  const cs = (el, p) => getComputedStyle(el, p);
  const px = (v) => parseFloat(v) || 0;
  const g = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  g.canvas.width = g.canvas.height = 1;
  const rgba = (c) => { // straight rgba of any CSS colour
    g.clearRect(0, 0, 1, 1); g.fillStyle = "#010203"; g.fillStyle = c; g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const over = (t, b) => { const a = t[3]; return [t[0] * a + b[0] * (1 - a), t[1] * a + b[1] * (1 - a), t[2] * a + b[2] * (1 - a), 1]; };
  const effBg = (el) => { // colour behind and including el, composited over white
    const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e);
    return chain.reduceRight((acc, e) => over(rgba(cs(e).backgroundColor), acc), [255, 255, 255, 1]);
  };
  const vis = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true, contentVisibilityAuto: true });
  const skipTag = (el) => el.closest("script,style,noscript,[data-sonner-toaster]") || (el.tagName.toLowerCase() !== "svg" && el.closest("svg")); // an svg is one block; what is inside it is not measured
  const word = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 26);
  const name = (el) => {
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => "." + c.slice(0, 20)).join("") : "";
    const a = el.getAttribute("data-answers") || el.getAttribute("data-bay") || el.getAttribute("data-slot") || el.getAttribute("aria-label");
    const w = word(el);
    return `<${el.tagName.toLowerCase()}${cls}${a ? `[${a.slice(0, 16)}]` : ""}>${w ? ` "${w}"` : ""}`;
  };
  const n = (v) => Math.round(v * 10) / 10;
  const fixed = (el) => cs(el).position === "fixed";
  const kids = (el) => [...el.children].flatMap((c) => {
    if (!c.checkVisibility?.({ visibilityProperty: true })) return [];
    const s = cs(c);
    if (s.display === "contents") return kids(c);
    if (s.display === "none" || s.position === "absolute" || s.position === "fixed" || skipTag(c)) return [];
    const r = R(c); return r.w > 1 && r.h > 1 ? [c] : [];
  });
  const radius = (s) => Math.max(...["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((k) => px(s[`border${k}Radius`])));
  const bordered = (s) => ["Top", "Right", "Bottom", "Left"].every((k) => px(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== "none" && rgba(s[`border${k}Color`])[3] > 0.04);
  const chromeOf = (el) => {
    if (el === document.body || el === document.documentElement) return false;
    const s = cs(el);
    if (bordered(s)) return true;
    if (s.backgroundImage !== "none") return true;
    if (rgba(s.backgroundColor)[3] < 0.03) return false;
    const mine = effBg(el), par = el.parentElement ? effBg(el.parentElement) : [255, 255, 255, 1];
    return [0, 1, 2].some((i) => Math.abs(mine[i] - par[i]) > 3);
  };
  const chromeCache = new Map();
  const chrome = (el) => { if (!chromeCache.has(el)) chromeCache.set(el, chromeOf(el)); return chromeCache.get(el); };
  const clip = (r, el) => { // a rect {l,t,r,b} cut by every ancestor (and el itself) that hides overflow
    let o = { ...r };
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const s = cs(a); const clipX = s.overflowX !== "visible", clipY = s.overflowY !== "visible";
      if (!clipX && !clipY) continue;
      const b = R(a);
      if (clipX) { o.l = Math.max(o.l, b.l); o.r = Math.min(o.r, b.r); }
      if (clipY) { o.t = Math.max(o.t, b.t); o.b = Math.min(o.b, b.b); }
    }
    return o.r > o.l + 0.5 && o.b > o.t + 0.5 ? o : null;
  };
  const tiny = (el) => { const r = el.getBoundingClientRect(); return r.width <= 1 || r.height <= 1; }; // sr-only and clipped to nothing
  const out = { S1: [], S2: [], S3: [], S4: [], S5: [], S6: [], S7: [], pinned: [], runs: 0 };
  const all = [...document.body.querySelectorAll("*")].filter((e) => !skipTag(e) && vis(e));

  // ----- S6 (only at the laptop sizes, see checkLaptops): nothing fixed or sticky lies over an answer
  if (only === "S6") {
    const layers = (e) => (cs(e).pointerEvents !== "none" ? [e] : [...e.children].filter((c) => !skipTag(c) && vis(c)).flatMap(layers)); // a click-through wrapper stands for the pieces inside it that take the pointer
    const answers = [...document.querySelectorAll("[data-answers]")].filter((a) => vis(a) && !tiny(a));
    const seen = new Set();
    for (const f of all) {
      const pos = cs(f).position; if ((pos !== "fixed" && pos !== "sticky") || tiny(f)) continue;
      for (const l of layers(f)) {
        const lr = l.getBoundingClientRect(); if (lr.width < 2 || lr.height < 2) continue;
        for (const a of answers) {
          if (a === f || a.contains(f) || f.contains(a) || a.contains(l) || l.contains(a)) continue;
          const ar = a.getBoundingClientRect();
          const ox = Math.min(lr.right, ar.right) - Math.max(lr.left, ar.left), oy = Math.min(lr.bottom, ar.bottom) - Math.max(lr.top, ar.top);
          if (ox <= 8 || oy <= 8) continue;
          const stack = document.elementsFromPoint((Math.max(lr.left, ar.left) + Math.min(lr.right, ar.right)) / 2, (Math.max(lr.top, ar.top) + Math.min(lr.bottom, ar.bottom)) / 2);
          const iL = stack.findIndex((x) => l.contains(x)), iA = stack.findIndex((x) => a.contains(x));
          if (iL < 0 || (iA >= 0 && iA < iL)) continue; // not painted above the answer: a backdrop is not a cover
          const key = `${name(l)}|${name(a)}`; if (seen.has(key)) continue; seen.add(key);
          out.S6.push(`S6 fixed-covers-answer: ${name(l)} (${pos}) lies over ${name(a)} by ${n(ox)} x ${n(oy)} px with the page at rest at the top. Leave room for it (padding at the end of the page as tall as the dock, a smaller dock) or put it in the flow at this height.`);
        }
      }
    }
    return out;
  }

  // ----- S1
  {
    const rects = []; // occupied rects in document coordinates
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.nodeValue.trim()) continue;
      const el = t.parentElement; if (!el || skipTag(el) || !vis(el) || tiny(el)) continue;
      const rg = document.createRange(); rg.selectNodeContents(t);
      for (const q of rg.getClientRects()) { const c = clip({ l: q.left + scrollX, t: q.top + scrollY, r: q.right + scrollX, b: q.bottom + scrollY }, el); if (c && q.width > 1) rects.push(c); }
    }
    let contentL = Infinity, contentR = -Infinity;
    for (const e of all) {
      const r = R(e); if (r.w < 2 || r.h < 2) continue;
      if (fixed(e)) { if (r.w * r.h < 0.9 * innerWidth * innerHeight) rects.push({ l: r.l, t: r.t, r: r.r, b: r.b, fx: true }); continue; }
      const tag = e.tagName;
      const media = /^(IMG|CANVAS|VIDEO|INPUT|SELECT|TEXTAREA|IFRAME|SVG)$/i.test(tag);
      if (media || chrome(e)) {
        if (!media && r.w >= 0.9 * innerWidth && r.h >= 0.5 * vh) continue; // a backdrop, not content
        const c = clip(r, e); if (c) rects.push(c);
      }
    }
    for (const r of rects) if (!r.fx) { contentL = Math.min(contentL, r.l); contentR = Math.max(contentR, r.r); }
    const iv = rects.map((r) => [r.t, r.b]).sort((a, b) => a[0] - b[0]);
    const gaps = []; let end = iv.length ? iv[0][1] : 0;
    for (const [t, b] of iv) { if (t > end) gaps.push([end, t]); end = Math.max(end, b); }
    const docEnd = Math.max(document.documentElement.scrollHeight, vh);
    if (docEnd > end) gaps.push([end, docEnd]);
    const band = gaps.map(([a, b]) => [a, Math.min(b, vh)]).filter(([a, b]) => b - a >= 64 && a < vh).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
    const cut = []; // text hidden by a clamp of two lines or more: vertical room would show it. A single-line ellipsis is a matter of width.
    for (const e of all) {
      const r = R(e); if (r.t >= vh || r.b <= 0 || r.w < 2) continue;
      const s = cs(e);
      if (Number(s.webkitLineClamp) > 1 && e.scrollHeight > e.clientHeight + 1 && word(e)) cut.push(`${name(e)} cut at ${e.clientHeight} px of ${e.scrollHeight} px (${s.webkitLineClamp}-line clamp)`);
    }
    if (band && cut.length) out.S1.push(`S1 clipped-beside-empty: an empty band y=${Math.round(band[0])} to ${Math.round(band[1])} (${Math.round(band[1] - band[0])} px) across x=${Math.round(contentL)} to ${Math.round(contentR)} in the first screenful, while ${cut.length} text(s) are cut by a clamp, e.g. ${cut[0]}. The room is there: let the cut text use it (more lines, a larger clamp) or take the band out.`);
  }

  // ----- S2
  {
    // The blocks stacked in a box: single-child wrappers are looked through, and a wrapper without chrome that stacks block
    // children (a block or a column flex of at least two block-level children one above the other) is replaced by them.
    const stackedRows = (list) => { const rs = list.map(R).sort((a, b) => a.t - b.t); let rows = 0, end = -Infinity; for (const q of rs) { if (q.t >= end - 1) rows++; end = Math.max(end, q.b); } return rows; };
    const expandable = (c) => {
      if (chrome(c)) return false;
      const s = cs(c), k = kids(c);
      const col = (s.display.includes("flex") && s.flexDirection.startsWith("column")) || s.display === "block" || s.display === "flow-root";
      return col && k.length >= 2 && k.every((x) => !/^inline/.test(cs(x).display)) && stackedRows(k) >= 2;
    };
    const stacked = (el, depth = 0) => {
      const k = kids(el);
      if (k.length === 1 && !chrome(k[0]) && depth < 6) return stacked(k[0], depth + 1);
      return k.flatMap((c) => (depth < 4 && expandable(c) ? stacked(c, depth + 1) : [c]));
    };
    for (const e of all) {
      if (!chrome(e)) continue;
      const r = R(e);
      if (r.w < 120 || r.h < 120 || r.h >= 0.7 * vh) continue;
      const k = stacked(e).map(R).sort((a, b) => a.t - b.t);
      const rows = [];
      for (const q of k) { const last = rows[rows.length - 1]; if (last && q.t < last.b - 1) { last.b = Math.max(last.b, q.b); } else rows.push({ t: q.t, b: q.b }); }
      if (!rows.length) continue;
      const gs = rows.slice(1).map((q, i) => Math.max(0, q.t - rows[i].b));
      const holes = [];
      if (rows.length >= 3) {
        const sorted = [...gs].sort((a, b) => a - b), med = sorted[Math.floor((sorted.length - 1) / 2)], big = Math.max(...gs);
        if (big > 40 && big > 3 * med) holes.push(`gaps between its stacked blocks ${gs.map(n).join(", ")} px; the largest, ${n(big)}, is over 40 and over three times the median (${n(med)})`);
      } else if (rows.length === 2 && gs[0] > 64) holes.push(`two stacked blocks with ${n(gs[0])} px between them (over 64)`);
      const top = rows[0].t - r.t, bottom = r.b - rows[rows.length - 1].b;
      if (bottom > 40 && bottom > 3 * top) holes.push(`${n(bottom)} px of room under the last block against ${n(Math.max(top, 0))} px above the first (over 40 and over three times)`);
      if (!holes.length) continue;
      const line = `S2 hollow-box: ${name(e)} ${Math.round(r.w)}x${Math.round(r.h)} px: ${holes.join("; ")}.`;
      if (e.getAttribute("data-spacing") === "pinned") out.pinned.push(line.replace("S2 hollow-box:", "pinned on purpose:"));
      else out.S2.push(`${line} Close the hole (let the blocks stack, or give the short one more content) or, if the last block is pinned to the bottom on purpose, mark the box data-spacing="pinned".`);
    }
    if (out.pinned.length > 2) out.S2.push(`S2 hollow-box: ${out.pinned.length} boxes are marked data-spacing="pinned" (two at most on a screen): ${out.pinned.slice(0, 3).join(" | ")}. Pin fewer; a screen of holes is a layout that does not fit its content.`);
  }

  // ----- S3
  {
    // One kind = one tag, one display and one size: the next neighbour has the same tag, the same display and, along the way the neighbours run, the same extent within 1 px
    // (the same width when they stand side by side, the same height when they are stacked, both when the run wraps). The other extent is
    // not evidence: a flex or grid item is stretched to its row's height or a column's width whatever it is.
    const near = (a, b) => Math.abs(a - b) <= 1;
    const reported = new Set();
    const sameKind = (x, y, sz) => {
      if (x.tagName !== y.tagName || y.previousElementSibling !== x || cs(x).display !== cs(y).display) return false;
      const a = sz.get(x), b = sz.get(y), vOver = a.t < b.b - 1 && b.t < a.b - 1, hOver = a.l < b.r - 1 && b.l < a.r - 1;
      return vOver && !hOver ? near(a.w, b.w) : hOver && !vOver ? near(a.h, b.h) : near(a.w, b.w) && near(a.h, b.h);
    };
    for (const c of all) {
      if (c.closest('[aria-hidden="true"]')) continue;
      const k = kids(c); if (k.length < 3) continue;
      const sz = new Map(k.map((e) => [e, R(e)]));
      let i = 0;
      while (i < k.length) {
        let j = i; while (j + 1 < k.length && sameKind(k[j], k[j + 1], sz)) j++;
        const run = k.slice(i, j + 1); i = j + 1;
        if (run.length < 3) continue;
        out.runs++;
        const rs = run.map(R), gx = [], gy = [];
        for (let m = 1; m < rs.length; m++) {
          const a = rs[m - 1], b = rs[m];
          const vOver = a.t < b.b - 1 && b.t < a.b - 1, hOver = a.l < b.r - 1 && b.l < a.r - 1;
          if (vOver && !hOver) gx.push(b.l >= a.l ? b.l - a.r : a.l - b.r);
          else if (hOver && !vOver) gy.push(b.t >= a.t ? b.t - a.b : a.t - b.b);
        }
        const bad = [];
        for (const [axis, gl] of [["horizontal", gx], ["vertical", gy]]) if (gl.length >= 2 && Math.max(...gl) - Math.min(...gl) > 1) bad.push(`${axis} gaps ${gl.map(n).join(", ")} px`);
        for (const side of ["Top", "Right", "Bottom", "Left"]) {
          const p = run.map((e) => px(cs(e)[`padding${side}`]));
          if (Math.max(...p) - Math.min(...p) > 1) bad.push(`padding-${side.toLowerCase()} ${[...new Set(p.map(n))].join(" / ")} px`);
        }
        if (bad.length) {
          const key = `${name(c)}|${run[0].tagName}|${Math.round(rs[0].w)}x${Math.round(rs[0].h)}`; if (reported.has(key)) continue; reported.add(key);
          out.S3.push(`S3 one-rhythm: ${run.length} neighbours ${name(run[0])} in ${name(c)} (one tag, one size) differ: ${bad.join("; ")}. Give one kind of thing one gap and one padding (the same utility classes), and let only a different kind differ.`);
        }
      }
    }
  }

  // ----- S4
  {
    let cur = document.querySelector("main,[role=main]") ?? document.body;
    for (let i = 0; i < 8; i++) { const k = kids(cur).filter((e) => !fixed(e)); if (k.length === 1 && !chrome(k[0]) && kids(k[0]).length) { cur = k[0]; continue; } break; }
    const flat = (e) => { for (let i = 0; i < 6; i++) { const k = kids(e); if (k.length === 1 && !chrome(e) && !chrome(k[0])) e = k[0]; else break; } return e; };
    const regions = kids(cur).filter((e) => !fixed(e)).map(flat);
    if (regions.length >= 2) {
      const lefts = regions.map((e) => R(e).l), rights = regions.map((e) => R(e).r);
      const spreadL = Math.max(...lefts) - Math.min(...lefts), spreadR = Math.max(...rights) - Math.min(...rights);
      if (spreadL > 1 || spreadR > 1) {
        const odd = regions.map((e, i) => `${name(e)} x=${n(lefts[i])}..${n(rights[i])}`);
        out.S4.push(`S4 edges-line-up: the ${regions.length} top-level regions of ${name(cur)} do not share edges (left spread ${n(spreadL)} px, right spread ${n(spreadR)} px): ${odd.slice(0, 5).join(" | ")}. Give the regions one left and one right edge (one container padding, no region with its own side margin).`);
      }
    }
  }

  // ----- S5
  {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.nodeValue.trim()) continue;
      const el = t.parentElement; if (!el || skipTag(el) || !vis(el) || tiny(el) || el.closest('[aria-hidden="true"]')) continue;
      let box = el; while (box && !chrome(box)) box = box.parentElement;
      if (!box) continue;
      const rg = document.createRange(); rg.selectNodeContents(t);
      const q0 = rg.getBoundingClientRect(); if (q0.width < 1) continue;
      const cq = clip({ l: q0.left + scrollX, t: q0.top + scrollY, r: q0.right + scrollX, b: q0.bottom + scrollY }, el); if (!cq) continue; // text cut away entirely (a clamp, a closed panel)
      const q = { left: cq.l - scrollX, right: cq.r - scrollX, top: cq.t - scrollY, bottom: cq.b - scrollY };
      const b = box.getBoundingClientRect(), s = cs(box), fs = px(cs(el).fontSize);
      const inner = { l: b.left, r: b.right, t: b.top, b: b.bottom }; // the border box: a 1 px border is part of the room, as a designer measures a frame (the COSS button's padding is 8 px minus its 1 px border)
      const mid = (q.top + q.bottom) / 2, top = mid - fs / 2, bot = mid + fs / 2;
      const pill = radius(s) >= Math.min(b.width, b.height) / 2 - 0.5;
      const chip = b.height <= 24; // a chip, a keycap, a count: the kit's own measure 4 to 6 px at the sides (square-ui-spec.md: kbd chip about 24x17, count chip 20 square)
      const needX = chip ? 4 : pill ? 6 : 8, needY = chip ? 3 : 4, tol = 0.25; // the vertical floor is 3 px in a box 24 px tall or less (the kit's own 18 px badge with 12 px text measures 3 as an em box), 4 above
      const d = { left: q.left - inner.l, right: inner.r - q.right, top: top - inner.t, bottom: inner.b - bot };
      const clippedY = cq.t > q0.top + scrollY + 0.5 || cq.b < q0.bottom + scrollY - 0.5; // a clamp or a scroll area cut the text: its em box cannot be placed
      const bad = [];
      if (d.left < needX - tol) bad.push(`${n(d.left)} px from the left edge (needs ${needX})`);
      if (d.right < needX - tol) bad.push(`${n(d.right)} px from the right edge (needs ${needX})`);
      if (!clippedY && d.top < needY - tol) bad.push(`${n(d.top)} px from the top edge (needs ${needY})`);
      if (!clippedY && d.bottom < needY - tol) bad.push(`${n(d.bottom)} px from the bottom edge (needs ${needY})`);
      if (!bad.length) continue;
      const key = `${name(box)}|${bad.join()}`; if (seen.has(key)) continue; seen.add(key);
      out.S5.push(`S5 text-has-room: "${t.nodeValue.trim().slice(0, 24)}" in ${name(box)} (${Math.round(b.width)}x${Math.round(b.height)} px${pill ? ", a pill" : ""}) is ${bad.join(", ")}. Give the box more padding or the text a shorter line.`);
    }
  }
  // ----- S7
  {
    const seen = new Set();
    for (const el of document.body.querySelectorAll('button,[role="button"],[role="radio"],[role="tab"],[role="switch"],[role="menuitem"]')) {
      if (skipTag(el) || !vis(el) || tiny(el)) continue;
      const b = el.getBoundingClientRect(); if (b.height > 64 || b.height < 12 || b.width < 8) continue;
      const rects = [], walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let tn = walker.nextNode(); tn; tn = walker.nextNode()) {
        if (!tn.nodeValue.trim()) continue;
        const te = tn.parentElement; if (!te || !vis(te) || tiny(te)) continue;
        const rg = document.createRange(); rg.selectNodeContents(tn);
        for (const q of rg.getClientRects()) if (q.width > 1 && q.height > 1) rects.push(q);
      }
      if (!rects.length) continue;
      const top = Math.min(...rects.map((q) => q.top)), bot = Math.max(...rects.map((q) => q.bottom));
      const lines = []; // rects on one line overlap by more than half of the smaller one's height
      for (const q of [...rects].sort((x, y) => x.top - y.top)) {
        const last = lines[lines.length - 1];
        if (last && Math.min(last.bot, q.bottom) - Math.max(last.top, q.top) > 0.5 * Math.min(last.bot - last.top, q.height)) { last.top = Math.min(last.top, q.top); last.bot = Math.max(last.bot, q.bottom); }
        else lines.push({ top: q.top, bot: q.bottom });
      }
      if (lines.length !== 1) continue; // two lines of text are not a label to centre
      const d = (top + bot) / 2 - (b.top + b.bottom) / 2;
      if (Math.abs(d) <= 2) continue;
      const key = `${name(el)}|${n(d)}`; if (seen.has(key)) continue; seen.add(key);
      out.S7.push(`S7 label-centred: ${name(el)} (${Math.round(b.width)}x${Math.round(b.height)} px) holds one line of text whose centre is ${n(Math.abs(d))} px ${d < 0 ? "above" : "below"} the centre of the control (over 2). Centre it: make the control a flex box with items-center (and justify-center), and take any one-sided padding off.`);
    }
  }
  return out;
};

export async function checkSpacing(page, cfg, width, fail, log = console.log) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const r = await page.evaluate(measureSpacing, { vh: VH[width] });
  let total = 0;
  for (const rule of ["S1", "S2", "S3", "S4", "S5", "S7"]) {
    const lines = r[rule]; total += lines.length;
    lines.slice(0, MORE).forEach((l, i) => fail(cfg, i === MORE - 1 && lines.length > MORE ? `${l} (and ${lines.length - MORE} more ${rule} lines)` : l));
  }
  log(`spacing ${cfg} (${width} x ${VH[width]}): S1 ${r.S1.length}, S2 ${r.S2.length} (${r.pinned.length} pinned on purpose${r.pinned.length ? ": " + r.pinned.map((p) => p.slice(0, 70)).join(" | ") : ""}), S3 ${r.S3.length} (${r.runs} runs of three or more compared), S4 ${r.S4.length}, S5 ${r.S5.length}, S7 ${r.S7.length}`);
  return total;
}

// S6: at laptop heights, with the page at rest and at the top, nothing fixed or sticky lies over an answer. The viewport is
// resized for the check and put back.
export const LAPTOPS = [[1366, 768], [1280, 720], [1536, 864]];
export async function checkLaptops(page, cfg, fail, log = console.log) {
  const was = page.viewportSize(), counts = [];
  try {
    for (const [w, h] of LAPTOPS) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(450);
      const r = await page.evaluate(measureSpacing, { vh: h, only: "S6" });
      r.S6.forEach((l) => fail(`${w}x${h}-${cfg.replace(/^\d+-/, "")}`, l));
      counts.push(`${w} x ${h}: ${r.S6.length}`);
    }
  } finally { if (was) await page.setViewportSize(was); await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(250); }
  log(`S6 ${cfg}: ${counts.join(", ")}`);
}

// ---------------------------------------------------------------------------------------------------------------------
// A1. Page-side helpers are installed with page.evaluate after every load.
const A1_SRC = () => {
  const NATIVE = 'button,a[href],[role="button"],[role="tab"],[role="switch"],[role="menuitem"],[role="option"],[role="checkbox"],summary,input,textarea,select,[role="searchbox"],[role="combobox"]';
  const CONTROL = NATIVE + ',[tabindex="0"]';
  const textInput = (e) => (e.matches("textarea,[role=searchbox],[role=combobox]") || (e.matches("input") && !/^(checkbox|radio|button|submit|reset|range|file|hidden|image|color)$/.test(e.type)));
  const PROPS = ["backgroundColor", "backgroundImage", "color", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "outlineColor", "outlineStyle", "outlineWidth", "boxShadow", "opacity", "transform", "translate", "scale", "filter", "fill", "stroke"];
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(","); };
  const parts = (el) => [el, ...[...el.querySelectorAll("*")].filter((e) => e.getClientRects().length > 0).slice(0, 40)]; // rendered descendants only: a hidden variant placed first cannot use up the 40
  const snap = (el) => { // every measured property of the control, its rendered descendants and its pseudo-elements, one entry each
    const o = [];
    for (const e of parts(el)) { const s = getComputedStyle(e); for (const k of PROPS) o.push(s[k]); o.push(box(e)); }
    for (const p of ["::before", "::after"]) { const s = getComputedStyle(el, p); for (const k of PROPS) o.push(s[k]); }
    return o;
  };
  const fp = (el) => snap(el).filter((_, i) => !el.__a1mask?.[i]).join("\u0001"); // without the properties that move by themselves
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__a1 = {
    CONTROL, NATIVE, textInput, fp,
    // at rest: three fingerprints across 300 ms; a property that differs between any two is moving by itself (a loop inside the control) and is left out of every later comparison
    rest: async (el) => { const a = snap(el); await sleep(137); const b = snap(el); await sleep(163); const c = snap(el); el.__a1mask = a.map((v, i) => v !== b[i] || v !== c[i]); return fp(el); },
    // after a hover: wait until the fingerprint has stopped changing (two equal reads 100 ms apart), at most ms
    settle: async (el, ms) => { const t0 = performance.now(); let prev = fp(el); for (;;) { await sleep(100); const cur = fp(el); if (cur === prev || performance.now() - t0 > ms) return cur; prev = cur; } },
    ring: (el) => parts(el).map((e) => { const s = getComputedStyle(e); return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 ? "o:" + s.outlineWidth + s.outlineColor : "") + "|" + s.boxShadow; }).join("\n"),
    poll: async (el, base, ms) => { const t0 = performance.now(); for (;;) { if (fp(el) !== base) return Math.round(performance.now() - t0); if (performance.now() - t0 > ms) return null; await sleep(16); } },
  };
};
const MARK = ({ vh }) => {
  const a = window.__a1;
  document.querySelectorAll("[data-a1]").forEach((e) => e.removeAttribute("data-a1"));
  const out = []; let skippedCovered = 0, below = 0;
  // the accessible text: aria-label, else the text that is rendered and not aria-hidden, with a space between elements
  const accText = (n) => {
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1 || n.getAttribute("aria-hidden") === "true" || !n.checkVisibility?.({ visibilityProperty: true })) return "";
    return n.getAttribute("aria-label") ?? [...n.childNodes].map((c) => (c.nodeType === 1 ? ` ${accText(c)} ` : accText(c))).join("");
  };
  const ownPointer = (e) => getComputedStyle(e).cursor === "pointer" && !(e.parentElement && getComputedStyle(e.parentElement).cursor === "pointer");
  // a clickable thing that is not one of the native kinds: a pointer cursor of its own (the cursor is inherited) or an onclick, outside every other control and holding none
  const clickable = (e) => e.tagName !== "LABEL" && !e.matches(a.CONTROL) && (ownPointer(e) || typeof e.onclick === "function") && !e.parentElement?.closest(a.CONTROL) && !e.querySelector(a.CONTROL);
  for (const el of document.body.querySelectorAll("*")) {
    if (!el.matches(a.CONTROL) && !clickable(el)) continue;
    if (el.closest('[data-sonner-toaster],[inert],[aria-hidden="true"]') || el.matches(":disabled,[aria-disabled='true']")) continue;
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    // a bare tabindex="0" is a control only when it has a click handler, which shows as a pointer cursor of its own (the cursor is inherited, so the parent's must differ): a focusable scroll area or group is not one
    if (el.matches('[tabindex="0"]') && !el.matches(a.NATIVE) && !ownPointer(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.top >= vh) { below++; continue; }
    if (r.bottom <= 0 || r.right <= 0 || r.left >= innerWidth) continue;
    const x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, vh);
    let pt = null;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
      const x = x0 + (x1 - x0) * fx, y = y0 + (y1 - y0) * fy, hit = document.elementFromPoint(x, y);
      if (hit && (el.contains(hit) || hit.contains(el))) { pt = [x, y]; break; }
    }
    if (!pt) { skippedCovered++; continue; }
    el.setAttribute("data-a1", String(out.length));
    const tag = el.tagName.toLowerCase(), cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 2).map((c) => "." + c.slice(0, 18)).join("") : "";
    const label = (el.getAttribute("aria-label") || el.getAttribute("placeholder") || accText(el) || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 30);
    out.push({ i: out.length, pt, text: a.textInput(el), chosen: el.matches('[aria-selected="true"],[aria-pressed="true"],[aria-current]:not([aria-current="false"]),[role="radio"][aria-checked="true"],[role="checkbox"][aria-checked="true"]'), name: `<${tag}${cls}>${label ? ` "${label}"` : ""}`, size: `${Math.round(r.width)}x${Math.round(r.height)}`, at: `${Math.round(r.left)},${Math.round(r.top)}` });
  }
  return { list: out, skippedCovered, below };
};

export async function checkAnswers(page, cfg, width, fail, reload, log = console.log) {
  const vh = VH[width];
  const prep = async () => { await page.evaluate(A1_SRC); return page.evaluate(MARK, { vh }); };
  await reload(page); await page.evaluate(() => window.scrollTo(0, 0));
  let { list, skippedCovered, below } = await prep();
  const all = list.length; list = list.slice(0, CAP);
  const same = (b) => b.list.length >= list.length && list.every((c, k) => c.name === b.list[k].name);
  const res = new Map(list.map((c) => [c.i, { c, hover: null, press: null, ring: null, how: "tab" }]));

  // ring: real Tab presses from the top of the page
  await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur?.(); });
  await page.mouse.move(2, 2);
  const base = await page.evaluate((idx) => Object.fromEntries(idx.map((i) => [i, window.__a1.ring(document.querySelector(`[data-a1="${i}"]`))])), list.map((c) => c.i));
  const ringNow = (i) => page.evaluate(async ({ i, b }) => {
    const el = document.querySelector(`[data-a1="${i}"]`);
    for (let k = 0; k < 14; k++) { const now = window.__a1.ring(el); if (now !== b && (/o:/.test(now) || now.split("\n").some((l, j) => l.split("|")[1] !== b.split("\n")[j]?.split("|")[1] && l.split("|")[1] !== "none"))) return true; await new Promise((r) => setTimeout(r, 20)); }
    return false;
  }, { i, b: base[i] });
  const reached = new Set();
  for (let k = 0; k < 220 && reached.size < list.length; k++) {
    await page.keyboard.press("Tab");
    const i = await page.evaluate(() => { const a = document.activeElement?.closest?.("[data-a1]"); return a ? Number(a.getAttribute("data-a1")) : -1; });
    if (i >= 0 && res.has(i) && !reached.has(i)) { reached.add(i); res.get(i).ring = await ringNow(i); }
  }
  for (const [i, r] of res) if (r.ring === null) { // not on the Tab path (roving tabindex): focus it with keyboard modality on
    r.how = "focus()"; await page.evaluate((i) => document.querySelector(`[data-a1="${i}"]`).focus({ focusVisible: true }), i); r.ring = await ringNow(i);
  }

  // hover and press
  await reload(page); const again = await prep();
  if (!same(again)) fail(cfg, `A1 control-answers: the list of controls in the first screenful changed between two loads of the same page (${list.length} then ${again.list.length}); a page that is not the same twice cannot be swept`);
  else {
    const neutral = [2, 2];
    let dirty = 0;
    for (const c of list) {
      if (c.text) continue;
      await page.mouse.move(...neutral); await page.waitForTimeout(140);
      const hasOpen = () => page.evaluate(() => !!document.querySelector('[role="dialog"],[role="menu"],[role="listbox"],[data-vaul-drawer]'));
      const before = await page.evaluate(() => document.body.innerText.length);
      const fp0 = await page.evaluate((i) => window.__a1.rest(document.querySelector(`[data-a1="${i}"]`)), c.i);
      await page.mouse.move(...c.pt);
      const h = await page.evaluate(([i, fp0]) => window.__a1.poll(document.querySelector(`[data-a1="${i}"]`), fp0, 300), [c.i, fp0]);
      const fpH = await page.evaluate((i) => window.__a1.settle(document.querySelector(`[data-a1="${i}"]`), 2000), c.i); // the hover transition has ended
      await page.mouse.down();
      const p = await page.evaluate(([i, fpH]) => window.__a1.poll(document.querySelector(`[data-a1="${i}"]`), fpH, 200), [c.i, fpH]);
      await page.mouse.move(...neutral); await page.mouse.up();
      res.get(c.i).hover = h; res.get(c.i).press = p;
      await page.waitForTimeout(120);
      const after = await page.evaluate(() => document.body.innerText.length);
      if (await hasOpen() || after !== before || ++dirty >= 12) { await reload(page); await prep(); dirty = 0; }
    }
  }

  let bad = 0;
  for (const { c, hover, press, ring, how } of res.values()) {
    const miss = [];
    if (!c.text && !c.chosen && hover === null) miss.push("no hover answer (nothing about it changed within 300 ms of the pointer arriving)");
    if (!c.text && press === null) miss.push("no press answer (nothing changed within 200 ms of the mouse going down)");
    if (!ring) miss.push(`no focus ring (${how === "tab" ? "reached with Tab" : "focused by key; Tab never lands on it"}, no outline or box-shadow appeared)`);
    if (miss.length) { bad++; fail(cfg, `A1 control-answers: ${c.name} at ${c.at} (${c.size} px): ${miss.join("; ")}. Give it a hover style, an active (pressed) style and a focus-visible ring, all from the tokens.`); }
  }
  log(`A1 ${cfg}: ${list.length} of ${all} controls in the first screenful tested (${all - list.length} skipped by the cap of ${CAP}${skippedCovered ? `, ${skippedCovered} covered by something else and not tested` : ""}); ${below} more on the page are below the first screenful and not tested; ${bad} with a missing answer; ${[...res.values()].filter((r) => r.how !== "tab").length} reached by focus() because Tab skips them`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Standalone: node scripts/product-rules.mjs [S|A]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { chromium } = await import("playwright-core");
  const root = path.resolve(import.meta.dirname, "..");
  const dist = path.join(root, "dist");
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  const cached = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).flatMap((d) => ["chrome-linux64", "chrome-linux"].map((o) => path.join(cache, d, o, "chrome"))) : [];
  const exe = [process.env.CHROME_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", ...cached].find((p) => p && fs.existsSync(p));
  if (!exe) { console.error("No Chromium found"); process.exit(2); }
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
  const server = http.createServer((req, res) => {
    let file = path.join(dist, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const which = process.argv[2] ?? "SA";
  const failures = [];
  const fail = (cfg, m) => { failures.push(m); console.error(`FAIL [${cfg}] ${m}`); };
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const reload = async (page) => { await page.reload({ waitUntil: "networkidle" }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(700); };
  try {
    for (const width of [1440, 390]) {
      if (width === 390 && !which.includes("S")) continue;
      const ctx = await browser.newContext({ viewport: { width, height: VH[width] }, colorScheme: "light", deviceScaleFactor: 1, hasTouch: width < 500 });
      const page = await ctx.newPage();
      await page.goto(base, { waitUntil: "networkidle" }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
      if (which.includes("S")) await checkSpacing(page, `${width}-light`, width, fail);
      if (which.includes("S") && width === 1440) await checkLaptops(page, `${width}-light`, fail);
      if (which.includes("A") && width === 1440) await checkAnswers(page, `${width}-light`, width, fail, reload);
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  console.log(failures.length ? `product-rules: ${failures.length} failure(s)` : "product-rules: ok");
  process.exit(failures.length ? 1 : 0);
}
