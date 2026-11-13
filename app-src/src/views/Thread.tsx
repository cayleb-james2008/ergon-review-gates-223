// views/Thread.tsx — the one quiet ongoing thread. The MORNING BRIEF SPEAKS FIRST (the reference's
// opening move), then the conversation: user turns sit on the neutral surface, agent turns are mostly
// un-boxed text. The agent is "Your agent" — no named persona anywhere.
import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BRIEF, briefLines, MAKES, type Msg } from '../data/fixtures';
import { DEMO } from '../data/store';
import { DEMO_BRIEF_LINES, DEMO_BRIEF_TITLE } from '../data/demo';
import { MessageCard } from '../components/DemoCards';
import { useErgon } from '../data/store';
import { PresenceMark } from '../components/PresenceMark';
import { DeliveryRoute } from '../components/Diagrams';
import type { Task } from '../data/fixtures';
import { arrival, dur, ease } from '../motion';

const ENTER = { duration: dur.enter, ease } as const;

/** F4 (Standard 069 §8): every quantity and time in the brief sets in Geist Mono; the prose stays
 *  sans. The brief's figures come from live state and from the demo clock, so the wrapper is applied
 *  to the rendered strings rather than to a copied layout. */
const FIGURE = /(\d+(?::\d{2})?)/g;
function withMonoFigures(text: string) {
  return text.split(FIGURE).map((part, i) => (
    i % 2 === 1 ? <span key={`fig-${i}`} className="mono">{part}</span> : part
  ));
}

function clock(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function Thread({ messages, replying, tasks = [], compact = false }: {
  messages: Msg[]; replying: boolean; tasks?: Task[]; compact?: boolean;
}) {
  const reduce = useReducedMotion();
  const enter = reduce ? { duration: 0 } : ENTER;
  // the opening brief SPEAKS FIRST and its figures are the app's own state, not a fixed copy
  const approvals = useErgon((s) => s.approvals);
  const settings = useErgon((s) => s.settings);
  const waiting = tasks.filter((t) => t.state === 'waiting').length;
  const working = tasks.filter((t) => t.state === 'working').length;
  // ONE needs-you derivation: pending approvals + waiting tasks. The brief prints it, and the
  // Decisions page reads the same two live counts, so the two surfaces cannot disagree.
  const needsYou = approvals.length + waiting;
  const lines = DEMO ? DEMO_BRIEF_LINES : briefLines({ approvals: approvals.length, waiting, working, makes: compact ? MAKES.length : 0 }, settings.briefAt);
  const endRef = useRef<HTMLDivElement | null>(null);
  // a screen reader hears the agent's new turn (I-25): a visually hidden polite status that carries only a turn that arrives after the first render
  const lastTurn = messages[messages.length - 1];
  const firstTurnId = useRef(lastTurn?.id);
  const announced = lastTurn && lastTurn.from === 'agent' && lastTurn.id !== firstTurnId.current ? `Your agent: ${lastTurn.text}` : '';
  // Real app behaviour: the newest turn is kept in view when a turn arrives or the agent starts
  // replying (the composer is glued to the bottom, so a reply must not land under it). The FIRST
  // render does not scroll: the morning brief speaks first and must be the first thing on screen.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, replying]);
  return (
    <div className={`thread${compact ? ' thread-compact' : ''}`} data-testid="thread">
      <motion.section
        className="brief"
        data-testid="morning-brief"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={enter}
      >
        <header className="brief-head">
          <PresenceMark size={20} state={needsYou ? 'needs-you' : 'working'} title="your agent" />
          <h2>{DEMO ? DEMO_BRIEF_TITLE : BRIEF.title}</h2>
          <span className="brief-who">your agent</span>
        </header>
        <ul className="brief-lines">
          {lines.map((l, i) => (
            <li
              key={l}
              className={`brief-line brief-line-${i}`}
              data-testid={i === 0 ? 'brief-needs-you' : i === 3 ? 'brief-schedule' : undefined}
              data-answers={i === 0 ? '1' : i === 1 ? '3' : i === 3 ? '5' : undefined}
              data-needs={i === 0 ? String(needsYou) : undefined}
            >{withMonoFigures(l)}</li>
          ))}
        </ul>
      </motion.section>

      {tasks.length > 0 ? <DeliveryRoute tasks={tasks} compact={compact} /> : null}

      {/* the agent's "needs you" tag and mark belong to the GRANT it asks about, so they follow the pending approvals, not the whole queue: a task still waiting on a sign-off is the brief's line, not this message's (U-28) */}
      {messages.map((m, i) => (
        <motion.article
          key={m.id}
          className={`turn ${m.from}`}
          data-testid={`turn-${m.from}`}
          data-answers={m.from === 'agent' && i === messages.length - 1 ? '4' : undefined}
          initial={reduce ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={arrival(i, reduce)}
        >
          {m.from === 'agent'
            ? <PresenceMark size={18} state={m.tag === 'needs-you' && approvals.length > 0 ? 'needs-you' : 'working'} title="your agent" className="turn-mark" />
            : null}
          <div className="turn-body">
            <div className="turn-who">
              <span>{m.from === 'agent' ? 'Your agent' : (settings.displayName.trim() || 'You')}</span>
              {m.tag && approvals.length > 0 ? <span className="turn-tag">needs you</span> : null}
              <span className="turn-time mono">{clock(m.at)}</span>
            </div>
            {m.text ? <p className="turn-text">{m.text}</p> : null}
            <MessageCard m={m} />
          </div>
        </motion.article>
      ))}

      {replying ? (
        <div className="turn agent pending" data-testid="agent-replying">
          <PresenceMark size={18} state="working" title="your agent" className="turn-mark" />
          <div className="turn-body"><p className="turn-text typing" aria-label="your agent is replying"><span /><span /><span /></p></div>
        </div>
      ) : null}

      <div className="sr-only" role="status" aria-live="polite" data-testid="thread-live">{announced}</div>
      <div ref={endRef} aria-hidden="true" />
    </div>
  );
}

export default Thread;
