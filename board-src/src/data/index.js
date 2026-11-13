// The backend is a static import of the build's own module, so the first screen needs one chunk and no second round trip, and the unused backend is not in the bundle.
import { createBackend } from '@backend';
export async function createAdapter() { return createBackend(); }
