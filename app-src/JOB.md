Ergon lets one owner read what his agent needs from him, decide it where it is shown, and see what the agent is doing, from one thread and its inbox.

1. What needs me now?
2. Which approval or task is waiting on my decision?
3. What can wait, and how far along is it?
4. What did my agent last say to me?
5. When does the next morning brief come?

Source of the questions: the brief lines in src/data/fixtures.ts:49-70 (Needs you now / Can wait / Context / Next morning brief) and the thread in src/views/Thread.tsx:58-108. Measured at head (commit 41d960a7, dist index.html sha256 b288c33eb280…, served from polish/dist-r5) by polish/OBSERVED-final.json. Line numbers are those of 41d960a7. The elements that answer questions 1 to 5 carry `data-answers` marks (src/views/Thread.tsx:76 and :91, src/components/ApprovalCard.tsx:19).

## Screen 0 — Thread (Chat), the first screen
Desktop: the centre column, src/faces/Desktop.tsx:95-120. Phone: the Chat tab and the approval slot above the composer, src/faces/Mobile.tsx:83-85 and :110-129.
- Q1 is answered by the brief's first line, data-testid brief-needs-you, `data-answers` 1 (src/views/Thread.tsx:75-76). Phone and desktop both print it.
- Q2 is answered by the approval card above the composer, `data-answers` 2 (src/components/ApprovalCard.tsx:12-59) and by the waiting cards of Today's route (src/components/Diagrams.tsx:61-98).
- Q3 is answered by the brief's second line, `data-answers` 3 (fixtures.ts:63-65) and by Today's route, the step rail with done, in progress and waiting counts (Diagrams.tsx:61-98). The line names the artefacts in Make only where a Make view exists, the phone (Thread.tsx:42, fixtures.ts:63-65); on the desktop it counts tasks in progress only. The "Context" line says nothing needs you before 09:00 only while nothing waits (fixtures.ts:67).
- Q4 is answered by the last agent turn in the thread, `data-answers` 4 (src/views/Thread.tsx:86-108), which scrolls into view on arrival except on first render (Thread.tsx:51-55). Its "needs you" tag shows only while an approval is pending (Thread.tsx:97, :102).
- Q5 is answered by the brief's fourth line, data-testid brief-schedule, `data-answers` 5 (fixtures.ts:68 and nextBriefLabel :75-86, Thread.tsx:75-76). The next brief is computed from the demo clock (fixtures.ts:33), not the wall clock. Entries made while the app runs are stamped on the same clock, which starts at the fixture's Sun 8 Nov 12:00 the first time an entry is stamped in this browser and runs with real time; its offset is kept in localStorage (`ergon.frontend.clock`), so a reload does not take it back to 12:00, and `?reset=1` starts it again (store.ts:87-105, :234).

## Screen 1 — Tasks
Desktop: the Tasks view, a three-column board (src/views/Tasks.tsx:151-201). Phone: the Tasks tab, a card list with a sub-switch to Decisions (src/faces/Mobile.tsx:86-104, src/views/Tasks.tsx:113-149).
- T1: Which tasks wait on my decision, and which one do I sign off first?
- T2: What is my agent working on now, and how far along is each task?
- T3: What closed today?
- T4: Can I add a task and see it on the board at once?

Real data (src/data/fixtures.ts:103-110, store.ts:140-149): six seed tasks, fields id (T-nnnn, mono), title, state (working | waiting | done), last (one line), at (time). Seed mix: 2 working, 1 waiting, 3 done. The longest title is "Package the 1.5.5 installer QA report" (37 characters, fixtures.ts:107). The empty case is an empty column, printed as "Nothing here." (Tasks.tsx:195). Adding a task persists to localStorage (store.ts:64-72, :140-149) and is stamped on the demo clock (store.ts:147), and its line carries a time such as 12:03 PM instead of "just now" (store.ts:140). A new task is numbered from the highest id plus one.

What this app cannot answer yet: which task the agent is really running (no live runtime; the replies come from a named fixture engine, Composer.tsx:34). Whether a task ever finishes by itself (no timer moves a task; only a sign-off or the store's advanceTask moves one, and the UI calls only signOffTask; advanceTask has no caller). Who a task is for beyond the fixed "owner: your agent" line (Tasks.tsx:141, :189).

## Screen 2 — Decisions
Desktop: the Decisions view (src/views/Decisions.tsx:71-78). Phone: the Decisions sub-tab inside Tasks (src/faces/Mobile.tsx:95-103).
- D1: What did I approve or deny, and when?
- D2: What is still waiting on me after I acted?

Real data (fixtures.ts:124-135, store.ts:166-214): the record holds decisions with fields id (D-nn), title, scope, outcome (approved | denied), at, note, and kind (approval | signoff). Seed mix: 2 decisions (D-08 approved, D-07 denied). The longest title is "Re-run the ledger import with the corrected mapping" (51 characters, fixtures.ts:131). A decision made while the app runs is stamped on the demo clock, so its "when" reads Nov 8, 12:00 PM and after, on the same day as the thread (store.ts:87-91, :204-205; Decisions.tsx:8-10). The empty cases are "No decisions recorded yet." (Decisions.tsx:66) and "Nothing waiting on you." (Decisions.tsx:49-51). While something still waits (D2), the amber sentence names the two places it waits: "N approval(s) in Chat" and "N task(s) on the Tasks board" are links to the Chat view or tab and to the Tasks view or tab (Decisions.tsx:13-23, :44-47).

What this app cannot answer yet: whether a granted scope is enforced anywhere (the scope is a label; no backend, fixtures.ts:182-187). Whether the decision reached any system outside this browser (store.ts header: localStorage only).

## Screen 3 — Make and Apps
Phone: the Make tab, four artefacts (src/faces/Mobile.tsx:105, src/views/Make.tsx:8-36). Desktop has no Make view: the Apps canvas on the right holds four app tabs with rows (src/views/AppCanvas.tsx:13-76), and the nav has no Make item (src/faces/Desktop.tsx:21-25). The brief names the artefacts only on the phone for that reason.
- M1: Which artefact is ready, and which is waiting on my sign-off?
- M2: What is my agent producing, and what is each app's state?

Real data (fixtures.ts:137-172): four artefacts with fields id (M-nn), kind, title, state (ready | in review | in progress), preview. The longest title is "Pilot-week ledger reconciliation notes" (38 characters, fixtures.ts:138). Four app tabs (Ledger, Documents, Fleet, Routines) hold 4, 3, 2 and 2 rows; the longest row label is "Pilot-week opening balance" (fixtures.ts:148). The empty case is not reached by any control: the canvas always has its rows.

What this app cannot answer yet: anything in the apps can be changed; the canvas is read-only (AppCanvas.tsx:73, "Read-only in this build"). The Make items are fixtures and do not open.

## Screen 4 — Settings
Desktop: the gear in the sidebar foot, src/views/Settings.tsx:14-123, opened from settings-trigger. Phone: the same dialog from the header, compact (src/faces/Mobile.tsx:69).
- S1: What is my display name, and does my agent's thread use it?
- S2: How does my agent reply: concise or detailed?
- S3: When is the morning brief?
- S4: Is the view dense or reduced in motion?

Real data (fixtures.ts:20-26, 174-180): displayName (free text, default "Cayleb", no length limit in the input, Settings.tsx:44-49), agentTone (concise | detailed), briefAt (HH:MM, default 07:30), density (comfortable | compact), motion (full | reduced). Changes apply at once and persist (store.ts:222-224). A cleared Morning brief time is refused: the field keeps the last valid time, so the next-brief line never reads "tomorrow at ." (Settings.tsx:76). The empty case of the name prints "—" in the summary line (Settings.tsx:115) and "You" as the turn label (Thread.tsx:101).

What this app cannot answer yet: the brief time moves the next-brief line only; no real schedule runs (fixtures.ts:75-86). The reply style changes the fixture engine's answer length only (fixtures.ts:226-236). Who the account belongs to, beyond the display name.
