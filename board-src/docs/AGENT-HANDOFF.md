# Agent hand-off (the bubble's command field)

The command bubble has **one field**. Typing filters the board, as search always did. Pressing **Enter** hands the text to the user's own agent through a hook the harness provides. The app contains **no command grammar and does no interpretation** of the text: it never turns "add Foo to line C" into a write. The agent operates the board through its own tools (docs/AGENT-INTERFACE.md) and its changes arrive live, so there is no return channel.

Placeholder: `Search or tell your agent`.

## The hook, in the order the app looks for it
1. **In-process bridge.** `window.ergon.agent.send(message)`, provided by a contained harness surface. Called once per Enter.
2. **Framed by an allow-listed harness.** When `window.parent !== window`, the app reads the embedder's origin from the browser (`location.ancestorOrigins[0]`, the direct parent; never from the referrer or from a message) and posts the same message to that exact origin, `window.parent.postMessage(message, thatOrigin)`, **only if that origin is on the build's allow-list**. The allow-list is `ops/harness-origins.json` (exact `https` origins, no wildcards, shipped **empty**); it is baked into the build and is the same list that drives the `frame-ancestors` header (below). The target origin is never `*`. An embedder that is not on the list, a browser that does not report ancestor origins (Firefox), and the default empty list all fall through to 3: the page behaves as a plain browser.
3. **Neither (a plain browser).** Enter does nothing with the text. Once per session (`sessionStorage` `rhl.agentNote`) a plain note shows in the header (round 6: not inside the bubble, so the bubble stays 50 px and no row changes size; it clears after 6 s or on the next keystroke): `Connect your agent to run commands.` The field still searches. No network call and no write is made from command text.

## The message
```json
{ "type": "ergon.agent.command", "app": "rhl-warehouse-board", "text": "<exactly what was typed>",
  "context": { "search": "<the field's text>", "focusedJobId": "<uuid of the job last opened, or null>", "lineCode": "<its line, A to S, or null>" } }
```
The text is sent exactly as typed (not trimmed); text that is only whitespace is not sent, and Enter that commits an IME composition is not a command. If the in-process bridge throws, the person sees `Your agent could not be reached. Try again.` The app never reads a reply.

## What the harness side owns
Providing `window.ergon.agent.send`, or listening for the `message` event on the embedding page, and routing the text to the user's agent. Authentication is unchanged: writes still need the agent-issued key (docs/DATA-CONTRACT.md, ACCESS MODEL); the hand-off carries no key and no identity.

## Who may frame the board (one list, one rule)
Framing is never open and never `*`. The response header is `Content-Security-Policy: frame-ancestors 'self' <enumerated shell origins>`, with no `X-Frame-Options`. The origins come from one committed file, `ops/harness-origins.json` (`{ "origins": [] }` today, so the header is `frame-ancestors 'self'`). `node ops/headers.mjs` writes that header into `vercel.json` (`--check` fails if they drift), and `vite.config.js` reads the same file as the postMessage allow-list, so there is no second list. The generator and the build reject `*`, any non-`https` origin, paths and anything that is not an exact `scheme://host[:port]` (test: `test/unit/handoff.test.js`). The real Ergon shell domains are added to the file when they are supplied; nothing else changes. The staging and showcase deployments carry the same rule. A showcase whose in-harness form uses the in-process bridge (`window.ergon.agent.send`) needs no frame at all.

## Tests
`test/e2e/functional.test.mjs` and `test/e2e/round3.test.mjs` ("agent hand-off"): a fake `window.ergon.agent.send` receives the text once with the right context; a framed page posts to an allow-listed embedder (and only to its origin) and to nobody else: an unlisted embedder gets no message and the person sees the note, the default build posts nothing; in a plain browser the note shows once, and no RPC and no write follows from command text. `test/unit/handoff.test.js`: the target-origin rule, the list validator and the committed header.
