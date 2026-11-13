import { useEffect, useId, useRef } from 'react';
import { Plus, Search } from 'lucide-react';
import { initBubble } from '@/ui/bubble';
import { DragHandle } from './DragHandle';
import { KeyChip } from './KeyChip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// The command bubble: search, the key status, Add job. Dragging and keyboard moves are custom (src/ui/bubble.js). `isStatic` renders it in flow for the style guide.
export function Bubble({ keyState = 'none', subject = '', expiresAt = '', canEdit = true, query, onQuery, onCommand, onAdd, agentState = 'idle', isStatic = false }) {
  const bubbleRef = useRef(null);
  const gripRef = useRef(null);
  useEffect(() => {
    if (isStatic) return undefined;
    return initBubble(bubbleRef.current, gripRef.current);
  }, [isStatic]);

  const sid = useId();
  // static copies (style guide) must not repeat the hook ids the live page owns
  // Enter that commits an IME composition is not a command (isComposing)
  const ids = isStatic ? { bubble: undefined, grip: undefined, search: `${sid}search`, key: undefined, add: undefined } : { bubble: 'bubble', grip: 'grip', search: 'search', key: 'key-status', add: 'add-btn' };

  return (
    <div id={ids.bubble} ref={bubbleRef} className={isStatic ? 'bubble bubble-static' : 'bubble'} role="group" aria-label="Board controls" data-state={agentState === 'needs-you' ? 'needs-you' : 'idle'}>
      <div className={isStatic ? 'bubble-row flex-wrap' : 'bubble-row'}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button id={ids.grip} ref={gripRef} className="grip" type="button" aria-label="Move controls. Drag, or use the arrow keys.">
              <DragHandle id={isStatic ? undefined : 'agent'} state={agentState} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Drag to move. Arrow keys also move it.</TooltipContent>
        </Tooltip>
        <Label htmlFor={ids.search} className="sr-only">Search jobs and lines</Label>
        <div className={isStatic ? 'relative min-w-0 flex-[1_1_240px]' : 'relative min-w-0 flex-1'}> {/* a style-guide copy is narrower than the live bubble: its field keeps the whole placeholder and the chip and Add job wrap under it */}
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input id={ids.search} type="search" className="pl-8" placeholder="Search or tell your agent" autoComplete="off" spellCheck={false}
            value={query} onChange={(e) => onQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onQuery(''); else if (e.key === 'Enter' && !e.nativeEvent.isComposing) onCommand?.(e.currentTarget.value); }} />
        </div>
        <KeyChip id={ids.key} state={keyState} subject={subject} expiresAt={expiresAt} />
        <Button id={ids.add} disabled={!canEdit} onClick={onAdd}><Plus aria-hidden="true" /><span className="btn-label">Add job</span></Button>
      </div>
    </div>
  );
}
