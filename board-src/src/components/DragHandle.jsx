import { useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { agentBase } from '@/ui/agent-state';

const WORKING_MS = 700;

// The bubble's handle: a grip and a flat state dot (an outlined circle; it fills once per save or later sync; accent outline only while a form is telling someone a key is needed).
export function DragHandle({ state = 'idle', measure, ...props }) {
  return (
    <span className="agent" data-state={state} aria-hidden="true" {...props}>
      <GripVertical />
      <i className="agent-dot" data-measure={measure ? '' : undefined} />
    </span>
  );
}

// shortcut: a fixed 700 ms timer stands for "the save finished", upgrade: end the working state when the write resolves
// 'working' shows once per save or later sync (pulseKey changes), never on first load; a pulse already running absorbs the echo of the same save.
export function useAgentState({ needsYou, pulseKey }) {
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const last = useRef(pulseKey);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (pulseKey === last.current) return;
    last.current = pulseKey;
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    timer.current = setTimeout(() => { busy.current = false; setWorking(false); }, WORKING_MS);
  }, [pulseKey]);
  const base = agentBase({ needsYou });
  return base === 'needs-you' ? base : working ? 'working' : base;
}
