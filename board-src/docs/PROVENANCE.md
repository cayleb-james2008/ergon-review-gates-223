# Provenance

## RHL logo (public/rhl-logo.svg, public/rhl-logo-light.svg)

Copied unmodified (read-only source) from `/home/cayleb/Work/projects/rhl-concept/assets/`. These are the company's header logo vector (colours #231f20 / #88ae3f).

| file | sha256 |
|---|---|
| rhl-logo.svg | `be5903929c0ee2c9e0523f34a3e00f8bb96217eb2c2d271265ade664e99444e0` |
| rhl-logo-light.svg | `c517a61a208a20ee1f2c0d6c2d5d6783ca3350ccc27558dca7c2879ed15a3849` |

The board header uses `rhl-logo-light.svg` on the dark default and `rhl-logo.svg` (dark ink + green) on the light theme and on paper. Only the file for the theme in use is on the critical path; on a dark screen the other file is fetched once the page is idle so the printed page has it. `vercel.json` caches both for a day with stale-while-revalidate.

## Everything else

All source in `src/`, `test/` and `index.html` was written for this rebuild. No third-party code beyond the pinned dependencies in `package.json` (`@supabase/postgrest-js` and `@supabase/realtime-js` 2.118.0 at runtime, `@supabase/supabase-js` 2.118.0 for the database tests and ops scripts only, `vite` 8.3.5 and `playwright-core` 1.64.1 for build and tests). No webfonts, no CDN assets. All demo data is synthetic (names start "TEST ").
