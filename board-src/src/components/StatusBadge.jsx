import { Badge } from '@/components/ui/badge';
import { statusLabel } from '@/core/lines';
import { CHEVRON, GLYPHS } from '@/lib/glyphs';

export function StatusGlyph({ status }) {
  return <span className="glyph" aria-hidden="true" dangerouslySetInnerHTML={{ __html: GLYPHS[status] ?? GLYPHS.open }} />;
}

export function Chevron({ className }) {
  return <span className={className ?? 'chev'} aria-hidden="true" dangerouslySetInnerHTML={{ __html: CHEVRON }} />;
}

export function StatusOption({ status, label }) {
  return <span className="status-opt"><StatusGlyph status={status} /><span className="status-word">{label ?? statusLabel(status)}</span></span>;
}

// Read-only status: glyph plus word.
export function StatusBadge({ status, ...props }) {
  return <Badge status={status} data-field="status" {...props}><StatusGlyph status={status} />{statusLabel(status)}</Badge>;
}
