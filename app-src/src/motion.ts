// The one source of motion values for screen code. A screen never writes a stiffness, a damping, a bounce, a mass or a
// duration of its own; it takes one of these (scripts/motion-source.mjs fails a literal one). Each value says where it
// comes from in references/motion.md, so that a value can be traced to a library's own source and never to a guess.
//
// CSS has the same values as tokens in references/tokens.css (--dur-press, --dur-reveal, --dur-swap, --dur-enter,
// --dur-sheet and the one easing --ease-house); Tailwind takes them as duration-(--dur-press) and ease-(--ease-house).
// The two tables below are the same numbers in seconds, and scripts/motion-source.mjs checks that they match the tokens.
//
// Cause first (references/motion.md section 1): a preset is for the thing it names, not for "making it feel alive".
// Anything used a hundred times a day, or triggered from the keyboard, takes `instant`.

/** Source: Ergon's confirmed curve, tokens.css --eg-ease (Ticket 068), kept as the house easing so nothing moves.
 *  references/motion.md section 4 names a near curve, 0.23, 1, 0.32, 1; this build keeps 0.22, 1, 0.36, 1. Equals --ease-house. */
export const ease = [0.22, 1, 0.36, 1] as [number, number, number, number];

/** Source: the CSS keyword ease-in-out (cubic-bezier 0.42, 0, 0.58, 1) that Ergon's typing dots and route pulse used in the
 *  confirmed build (app.css, Ticket 068). A symmetrical curve for a loop that breathes; the house ease is an ease-out and
 *  would make those two loops blink. Equals --ease-loop. Loops on live work only. */
export const loop = [0.42, 0, 0.58, 1] as [number, number, number, number];

/** Seconds. Source: references/motion.md section 4 (tap 120, swap 200, enter 250, sheet 350 ms) and section 3, Tremor
 *  hover card and tooltip 150 ms (reveal). Equal --dur-press, --dur-reveal, --dur-swap, --dur-enter and --dur-sheet.
 *  live and pulse are Ergon's own, from the confirmed build: the typing dots' 1 s cycle (app.css .typing) and the route
 *  node's 2.6 s pulse while a task works (app.css route-pulse). Equal --dur-live and --dur-pulse. */
export const dur = { press: 0.12, reveal: 0.15, swap: 0.2, enter: 0.25, sheet: 0.35, live: 1, pulse: 2.6 };

/** The transition for the nth message of the thread arriving: the enter preset, delayed 20 ms a message and capped at
 *  240 ms; no delay when the person has reduced motion. Source: Ergon's confirmed thread (views/Thread.tsx, Ticket 068),
 *  kept as it was; the enter preset is dur.enter on ease. */
export function arrival(i: number, reduce: boolean | null) {
  return { duration: reduce ? 0 : dur.enter, ease, delay: reduce ? 0 : Math.min(0.24, 0.02 * (i + 1)) };
}

/** Press feedback on a flat control, a tween. Source: references/motion.md section 4, "Press feedback 100 to 160 ms",
 *  and the 120 ms tap of the feel brief. For a Motion element's whileTap; CSS controls use duration-(--dur-press). */
export const press = { duration: dur.press, ease };

/** A pill or a highlight gliding to the chosen item (Motion Primitives Animated Background, a layoutId glide).
 *  Source: references/motion.md section 3, Motion Primitives: its toolbar demo passes bounce 0.1, duration 0.2; the
 *  starter keeps 0.35 so the glide can be seen. A duration spring: it does not carry the velocity of an interrupted one. */
export const glide = { type: "spring" as const, bounce: 0.1, duration: 0.35 };

/** A card growing into its detail, a dialog opening (Motion Primitives Morphing Dialog).
 *  Source: references/motion.md section 3, Motion Primitives: the dialog's own demo, bounce 0.05; the starter keeps 0.3. */
export const open = { type: "spring" as const, bounce: 0.05, duration: 0.3 };

/** A number or a word changing while the person watches (Motion Primitives Sliding Number, Text Morph).
 *  Source: references/motion.md section 3, Motion Primitives: stiffness 280, damping 18, mass 0.3, one spring per digit. */
export const roll = { type: "spring" as const, stiffness: 280, damping: 18, mass: 0.3 };

/** The island changing size or content (Cult UI Dynamic Island).
 *  Source: references/motion.md section 3, Cult UI: Dynamic Island stiffness 400, damping 30. */
export const island = { type: "spring" as const, stiffness: 400, damping: 30 };

/** An item moving to where it now belongs, a list reordering (a Motion `layout` prop, a layoutId move).
 *  Source: references/motion.md section 3, Motion: the per-property default for scale on a motion component,
 *  stiffness 550, damping 30, which carries velocity if the move is interrupted. (Motion's own default for a layout
 *  change with no transition is a 0.45 s tween; pass this when the person can interrupt it.) */
export const layout = { type: "spring" as const, stiffness: 550, damping: 30 };

/** Something fading or sliding in a short distance: a status line, a menu, a tooltip.
 *  Source: references/motion.md section 3, Tremor Raw hover card and tooltip, 150 ms, and section 4, "menus 150 to 250 ms". */
export const reveal = { duration: dur.reveal, ease };

/** Seconds between the children of a group entering one after the other (a delay for `staggerChildren`).
 *  Source: references/motion.md section 3, Motion Primitives Animated Group, 0.1 s per child. Never on a list he refilters. */
export const stagger = 0.1;

/** No motion: a change from the keyboard or one made a hundred times a day (references/motion.md section 2). */
export const instant = { duration: 0 };
