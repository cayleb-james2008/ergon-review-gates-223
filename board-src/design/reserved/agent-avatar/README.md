# Agent avatar (reserved)

A little neural net grown from a name: `seeded-mark.js` (pure geometry), `AgentAvatar.jsx` (the SVG), `agent-avatar.css` (flat, monochrome, no glow, no shadow, no sweep).

**Reserved for agent profile icons only**: animated little neural nets as agent avatars. It is **not** a decorative surface mark anywhere in Ergon, and the lines board does not use it. Nothing in `src/` imports this folder, so it is not in the board's bundle (a unit test checks that).

Owner ruling, Cayleb, 2 Nov 11:46: the neural-net look is reserved exclusively for agent profile icons. This supersedes his 10:53 word that it could be a standing look on the board.

Personalization surface (props of `AgentAvatar`):

* customizable: `seed` (the agent's name; same seed and density give the same geometry), `density` (`sparse` 6, `medium` 10, `dense` 14 nodes; omitted lets the seed decide), `tone` (`ink`, or `accent`), `size` (px), `state` (`idle`, `working`, `needs-you`);
* not customizable: effects, motion, shape language.

Tests: `test/unit/agent-avatar.test.js` (determinism, different seeds differ, density bounds the node count, connectivity).
