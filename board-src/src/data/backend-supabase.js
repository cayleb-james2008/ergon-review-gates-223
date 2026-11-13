// Which backend this build talks to, chosen at build time (vite.config.js aliases @backend). The other one is not in the bundle.
import { createSupabaseAdapter } from './supabase.js';
export const createBackend = () => createSupabaseAdapter();
