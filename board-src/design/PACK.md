# RHL lines board design pack

The pack is the source of truth for how this product looks. `tokens.json` mirrors the token blocks in `src/styles.css`, `components/*.json` declares every admitted component and every state it must render, and `styleguide.html` (second Vite entry, build with `STYLEGUIDE=1`) renders them all in both themes. `test/e2e/pack-check.test.mjs` and `test/unit/design-pack.test.js` are the pack-check. A component that is not declared here is off-pack.

**Feel reference (owner, round 3).** Claude-app feel, not look: restraint, quiet chrome, low contrast between neighbouring surfaces, one rare accent, content first. No palette is copied; warm cream with a terracotta accent is rejected. Dark is the default and primary graded mode; `?theme=light` is kept and tested.

## Direction (five lines)

1. **Product.** The shared board where warehouse staff and their agents see and update which jobs sit on lines A to S.
2. **Character.** Calm, exact, legible at distance.
3. **World.** The paper line board by the dock door: floor bay markings, marker on whiteboard, a clipboard of jobs. It tints the neutrals (cool slate and paper white, not warm cream) and keeps the accent rare. The RHL logo and its green (`#88AE3F`) are the brand.
4. **Moments.** The line letters and the status of each job card. Everything else (header, rows, controls, banners) stays plain.
5. **Signature.** The line letter is a painted bay marker: a solid block for a line with jobs, bare floor for an empty one, with that line's ready/total tally under the letter. Used for every line and as the selected value of the dialog's Line field, nowhere else. Every line sits in its own 1px frame, empty ones included.

## Rules

* Surfaces step up in tone: page, panel (board), raised (job cards), floating (bubble, dialog, popovers). Borders are 1px. No blur, no shadow, no gradient, no glow.
* One accent (RHL green): primary action, Ready status, focus ring, the Live dot. Accent text uses `--accent-text` (4.5:1 or better on every surface).
* Type: Geist Variable only. Scale 12 / 14 / 16 / 18 / 22 px, weights 400 / 500 / 600, sentence case. Three text roles: ink, muted, accent text. Numbers are tabular.
* Radii by role: 4 badge, 6 control, 8 card, 12 panel, 14 floating layer. Inner radius is the outer radius minus padding.
* Icons: lucide, 16 px, stroke 2 (the badge glyph scales with the text).
* Motion: 120 tap, 200 swap, 250 enter, 350 sheet, one curve. Only state-change cue (350 ms tint), press feedback, and floating-layer enter. Nothing animates on load, on typing or on keyboard moves.
* Copy: sentence case, no trailing period on labels and buttons, whole sentences for messages, no greeting or hype words, no exclamation marks.

## Round 2 additions

* **Stepped type, declared.** Job text is the one non-scale exception: `--fs` 14px (16px on screens 1000px tall or more) for note, initials and status, and `--fs-title` 16px (18px) for the customer. Paper uses 11px. Type tokens are named by use: `--text-label` 12, `--text-body-sm` 14, `--text-body` 16, `--text-title` 18 (h1, message titles and dialog title are one step), `--text-marker` 22 (the bay marker letter only; 18px on phones).
* **Line-height** is unitless by role: body 1.5, headings 1.1, card text 1.1 (at most two lines).
* **Opacity** is for disabled (`--opacity-disabled`) and drag (`--opacity-drag`) only; the slop gate fails any other opacity literal. Dimming (search, non-matching) is a flat tone step with muted text. The command bubble is translucent through an alpha fill token (`--bubble-fill`), never through blur.
* **Focus.** One 2px ring per control. On a job card the CARD carries the ring for both of its controls (the name button and the status badge draw none): they are 12 to 18px strips and a ring on them ran through the letters and glyph (round 6). Normal cards ring inside (offset -2); compact cards, too short for that, ring in the 2px gap around them and the focused compact line lets the ring spill over its own clip. The row's Add job rings inside its control; the bubble's grip, field and buttons ring 2px outside theirs. On the last row the compact ring spills into the board's 8px bottom padding.
* **Drag handle, not an agent mark.** The bubble's handle is a lucide `GripVertical` and a flat state dot (idle, working, needs-you). The neural-net generator is reserved exclusively for agent profile icons and lives in `design/reserved/agent-avatar/`; it is not a pack component.
* **Initials colours.** Five low-chroma hue tokens (`--hue-blue/pink/orange/green/purple`) carry the floor's own sticker colours from `src/config/legend.json`; unconfirmed initials are neutral. Ink on every tint is 7:1 or better in both themes.
* **Access chrome.** The key chip (`#key-status`) has a reserved footprint, so the first frame is the same with or without a key. There is no Edit or Lock button and no passcode field.
* Lists, popovers and tooltips fade (120 ms); only the dialog also rises (250 ms).

## Round 4 additions

* **Declared components for the header and board states:** legend chip (with the five hue states and neutral), connection indicator (live, polling, offline, error), test-data marker, board message (error, not set up, no lines), no-match note, version label. Each is in `design/components` with its states and both-theme specimens.
* **Compact job card** (`job-card-compact`): the dense form, chosen per line by fit. One line: customer with ellipsis, status glyph (word in the accessible name and the title), initials chip with its tint. 12px text at every screen size, the initials as a tint only (the letters stay in the accessible name, the title and the details). Wraps to a second line inside the row height; on touch it keeps the full row height and swipes. `--space-2` (2px) is the one half step on the 4px grid and is for the compact card only.
* **Motion:** the dialog fades in 120 ms and does not rise; nothing moves on a keyboard open.
* **Bubble:** alpha fill .9 (lowest that keeps 4.5:1 text and a 3:1 field edge over a painted bay marker), border in the frame tone.

## Round 5 additions

* **The dock.** On desktop and tablet the board ends one dock above the page bottom (bubble height plus 8px above and 8px below); the command bubble rests there by default and covers no line. Dragged over the board it floats on top, translucent. Phones keep the board's bottom padding.
* **Font sizes are tokens.** Every `font-size` is a token or `inherit` (gate rule `font-size-tokens`); `.top-status` and `.bubble` use `--text-body-sm`.
* **Print is sized by the page:** the app is the page area, rows share what the header leaves, nothing clips, compact cards print no note.

