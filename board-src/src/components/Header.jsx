import { useEffect, useState } from 'react';
import { LEGEND } from '@/core/legend';

const VERSION = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'local';

// The logo file for the theme in use is the only one on the critical path. On a dark screen the dark-ink file (what paper needs) is added once the page
// is idle, so printing the dark board still has it and nothing else is fetched up front. Light theme: the one file serves screen and paper.
const FILES = { dark: './rhl-logo-light.svg', light: './rhl-logo.svg' }; // page-relative: the board is served under a suite subpath, never only at domain root
function Logo() {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const [print, setPrint] = useState(false);
  useEffect(() => {
    if (theme === 'light') return undefined;
    const t = window.requestIdleCallback ? window.requestIdleCallback(() => setPrint(true)) : setTimeout(() => setPrint(true), 1500);
    return () => (window.cancelIdleCallback ? window.cancelIdleCallback(t) : clearTimeout(t));
  }, [theme]);
  const img = (cls, src) => <img className={`logo ${cls}`} src={src} alt="RHL" title={`Version ${VERSION}`} width="353" height="53" decoding="async" />;
  return <>{img('logo-screen', FILES[theme])}{print && <img className="logo logo-paper" src={FILES.light} alt="" aria-hidden="true" width="353" height="53" decoding="async" />}</>;
}

// The small parts of the header, each an admitted component (design/components): a legend chip, the connection indicator, the test-data marker, the version label.
export const LegendChip = ({ initials, hue, measure }) => <li className="initials" data-hue={hue ?? undefined} data-measure={measure ? '' : undefined}>{initials}</li>;
export const Connection = ({ conn, label, measure }) => <span id="conn" className="conn" data-state={conn} data-blank={label ? undefined : ''} aria-live="polite"><span className="dot" aria-hidden="true" data-measure={measure ? '' : undefined} /><span id="conn-label">{label}</span></span>;
export const TestMarker = ({ show = true, measure }) => <span id="test-marker" className="test-marker" role="status" hidden={!show}><span className="dot" aria-hidden="true" data-measure={measure ? '' : undefined} />Test data</span>;
export const VersionLabel = ({ version }) => <footer className="version">Version {version}</footer>;

// Flat header: logo (the heading below is visually hidden: the owner ordered the title text off the screen), the slot where the command bubble sits until it is moved, then status.
export function Header({ liveText, conn, connLabel, testMode, note = '' }) {
  return (
    <header className="top">
      <div className="brand">
        <Logo />
        <h1>RHL Warehouse Board</h1>
        {note && <p id="agent-note" className="agent-note" aria-hidden="true">{note}</p>}
      </div>
      <p id="agent-note-live" className="sr-only" role="status">{note}</p>{/* always mounted, so a screen reader announces the text when it is filled in */}
      <ul className="legend" aria-label="Initials colours">{LEGEND.map((l) => <LegendChip key={l.initials} initials={l.initials} hue={l.hue} />)}</ul>
      <div className="top-status">
        <p id="live-text" className="live-text" aria-live="polite">{liveText}</p>
        <TestMarker show={testMode} />
        <Connection conn={conn} label={connLabel} />
      </div>
    </header>
  );
}
