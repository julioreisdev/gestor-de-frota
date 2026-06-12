import * as SB from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

// processLock (fila em memória) substitui Web Locks API, que "vaza" quando aba
// fica em background. Fallback no-op se a versão do esm.sh não exportar.
const lock = SB.processLock ?? ((_acq, _to, fn) => fn());

export const supabase = SB.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    lock,
  },
});
