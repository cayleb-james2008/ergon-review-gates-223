# Libraries

Every package added for the component and asset layer rebuild, pinned exactly in `package.json` (`npm install --save-exact`) and locked in `package-lock.json`. Licence lines are quoted from the LICENSE file each package ships, next to the `license` field of its `package.json`. No CDN, no runtime network: the font and icons are bundled.

| package | pinned | licence (field, then first line of the shipped file) | repository | used for |
|---|---|---|---|---|
| react | 19.3.1 | MIT. "Copyright (c) Meta Platforms, Inc. and affiliates." | https://github.com/react/react.git | UI runtime. The plain modules in `src/core`, `src/data`, `src/config.js` are unchanged; React reads the store through `useSyncExternalStore` (`src/hooks.js`). |
| react-dom | 19.3.1 | MIT. "Copyright (c) Meta Platforms, Inc. and affiliates." | https://github.com/react/react.git | DOM renderer |
| @radix-ui/react-dialog | 1.3.1 | MIT. "Copyright (c) 2022 WorkOS" | https://github.com/radix-ui/primitives.git | job dialog (focus trap, Escape, scroll lock, ARIA) |
| @radix-ui/react-select | 2.4.1 | MIT. "Copyright (c) 2022 WorkOS" | https://github.com/radix-ui/primitives.git | status select in each card, Line and Status fields in the dialog |
| @radix-ui/react-popover | 1.3.1 | MIT. "Copyright (c) 2022 WorkOS" | https://github.com/radix-ui/primitives.git | inline Add job form on each row |
| @radix-ui/react-tooltip | 1.4.1 | MIT. "Copyright (c) 2022 WorkOS" | https://github.com/radix-ui/primitives.git | drag handle hint, reason on a disabled control |
| class-variance-authority | 0.7.1 | Apache-2.0. "Apache License, Version 2.0, January 2004" | https://github.com/joe-bell/cva.git | Button and Alert variants (shadcn convention) |
| clsx | 2.1.1 | MIT. "Copyright (c) Luke Edwards" | https://github.com/lukeed/clsx | class name joining in `cn()` |
| tailwind-merge | 3.7.0 | MIT. "Copyright (c) 2021 Dany Castillo" | https://github.com/dcastil/tailwind-merge.git | conflict-free class merging in `cn()` |
| lucide-react | 1.66.0 | ISC. "Copyright (c) 2026 Lucide Icons and Contributors" | https://github.com/lucide-icons/lucide.git | the one icon family: inline SVG, 16 px, stroke 2. 11 named icons are imported, the rest are tree-shaken. |
| @fontsource-variable/geist | 5.3.0 | OFL-1.1. "Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)... licensed under the SIL Open Font License, Version 1.1." | https://github.com/fontsource/font-files.git | Geist Variable, self-hosted woff2 (latin 28.7 KB, other subsets load only if their characters appear), `font-display: swap`, metric-matched fallback |
| tailwindcss (dev) | 4.3.3 | MIT. "Copyright (c) Tailwind Labs, Inc." | https://github.com/tailwindlabs/tailwindcss.git | utility classes. The theme is reset to the pack tokens: no default palette, shadows, blur or heavy weights exist as utilities. |
| @tailwindcss/vite (dev) | 4.3.3 | MIT. "Copyright (c) Tailwind Labs, Inc." | https://github.com/tailwindlabs/tailwindcss.git | Tailwind in the Vite build |
| @vitejs/plugin-react (dev) | 6.2.1 | MIT. "Copyright (c) 2019-present, Yuxi (Evan) You and Vite contributors" | https://github.com/vitejs/vite-plugin-react.git | JSX in the Vite build |

Backend client (round 5): `@supabase/postgrest-js` 2.118.0 and `@supabase/realtime-js` 2.118.0 (both MIT, the same release as before, already in the tree as dependencies of the full client, now pinned exactly as the app's own runtime dependencies). They are the only two parts of the Supabase client this app uses: reads and RPCs over PostgREST, and the realtime channel. The full `@supabase/supabase-js` 2.118.0 (MIT) stays as a dev dependency for the tests and ops scripts that talk to the database (`test/sql`, `test/agent`, `ops/n6-load.mjs`) and is not in the browser bundle (it also carries auth, storage and functions, which the app never uses). Unchanged and already pinned: `vite` 8.3.5 (MIT), `playwright-core` 1.64.1 (Apache-2.0).

Transitive packages (Radix internals such as `@radix-ui/react-popper`, `react-remove-scroll`, `aria-hidden`, and Tailwind's `lightningcss`) are fixed by `package-lock.json`. `npm audit` reported 0 vulnerabilities at install.

## shadcn/ui: source reference, not a dependency

shadcn/ui components are copied into the repo and owned by it (`src/components/ui/*.jsx`: button, input, label, select, dialog, popover, tooltip, alert, badge, skeleton). They are written in shadcn's source style (cva variants, `cn()`, Radix parts, `data-state` styling hooks) in JavaScript, then restyled to the pack tokens. The shadcn CLI was not run, because it fetches its registry from ui.shadcn.com and this build may use the npm registry only. Licence of the project the pattern comes from: the shadcn package 4.23.0 (read from its npm tarball, not installed) has `license: MIT` and its LICENSE.md begins "MIT License. Copyright (c) 2023 shadcn", repository https://github.com/shadcn-ui/ui.git. Differences from stock shadcn that are deliberate: Select, Popover and Dialog have no shadow or blur, the Button press is a scale of .97 over 120 ms, Skeleton does not shimmer, Alert is a flat bar.

## Not used, with the reason

* **MUI (Material UI) and MUI X**: not used. No surface on this board is a data grid or a picker, and MUI carries Material's visual identity (ripple, elevation shadows) that would have to be themed away. No paid MUI X tier is involved.
* **Kinetics** (kinetics.colorion.co): the vetting found no licence. Studied for motion patterns only, nothing copied.
* **OriginKit**: its components are not MIT. Studied as a pattern only, nothing copied.
* **React Bits**: MIT with the Commons Clause, and mostly spectacle (aurora, particles, text effects), which this product does not use.
* **Radix Themes** (the styled layer), **Radix Label**, **Radix Toast**: not needed. A plain `<label>` is used.
* No second icon set, no second font family, no animation library.

No package was added in round 3. `src/lib/glyphs.js` writes the lucide geometry for the status and chevron glyphs out as static SVG strings (ISC, same licence as above) so 60 cards do not mount 60 icon components; the other lucide icons are still imported by name.
