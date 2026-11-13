// The product signature, small: the painted bay marker as it appears in the chrome (the dialog's Line field).
export function BayMarker({ letter }) {
  return <span className="bay" aria-hidden="true">{letter}</span>;
}
