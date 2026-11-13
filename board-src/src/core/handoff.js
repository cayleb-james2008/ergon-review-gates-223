// Where the bubble's command text may go when the board is framed. Only an embedder whose origin is on the build's allow-list (ops/harness-origins.json) gets the message;
// every other case behaves as a plain browser. The origin comes from the browser (location.ancestorOrigins), never from the referrer or the message.
// -> the exact origin to pass as postMessage's targetOrigin, or null (never '*')
export function harnessTarget({ ancestorOrigins, allowed }) {
  const parent = ancestorOrigins && ancestorOrigins.length ? ancestorOrigins[0] : '';
  return parent && parent !== 'null' && allowed.includes(parent) ? parent : null;
}
