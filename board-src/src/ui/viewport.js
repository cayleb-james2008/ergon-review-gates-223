// Phones: the on-screen keyboard shrinks what the person can see (the visual viewport), but not always the page's own height (iOS never does, Android only with
// interactive-widget=resizes-content). The Add job sheets size and place themselves from these two variables so their fields and Save stay on screen.
export function trackVisualViewport(root = document.documentElement, vv = window.visualViewport) {
  if (!vv) return () => {};
  const set = () => { root.style.setProperty('--vv-h', `${vv.height}px`); root.style.setProperty('--vv-top', `${vv.offsetTop}px`); };
  set();
  vv.addEventListener('resize', set);
  vv.addEventListener('scroll', set);
  return () => { vv.removeEventListener('resize', set); vv.removeEventListener('scroll', set); root.style.removeProperty('--vv-h'); root.style.removeProperty('--vv-top'); };
}
