// The bubble's drag handle asks for attention only while a job form is telling someone a key is needed (see NOTICES in core/key.js).
// Offline and error stay calm: green means Live and Ready elsewhere on this board, so it is never used to say something is wrong.
export const agentBase = ({ needsYou }) => (needsYou ? 'needs-you' : 'idle');
