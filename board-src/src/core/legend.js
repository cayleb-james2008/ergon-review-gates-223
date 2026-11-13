import legend from '@/config/legend.json';

export const LEGEND = Object.entries(legend.initials).map(([initials, v]) => ({ initials, hue: v.hue })); // initials and a hue only: the owner ruled the legend initials-only (3 Nov 2026), so there is no name field

// initials on a card -> the hue it is coded with, or null (unconfirmed: shown as itself, neutral).
export function hueFor(initials, cfg = legend) {
  const k = String(initials ?? '').trim().toUpperCase();
  const key = cfg.aliases?.[k] ?? k;
  return cfg.initials[key]?.hue ?? null;
}
