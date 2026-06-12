import { supabase } from './supabase.js';

let _session = null;
let _profile = null;

export async function loadSession() {
  // timeout defensivo: getSession pode pendurar em ambientes exóticos (Web Locks bloqueado).
  const withTimeout = (p, ms, label) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timeout')), ms))]);
  try {
    const { data } = await withTimeout(supabase.auth.getSession(), 5000, 'getSession');
    _session = data?.session || null;
  } catch (e) {
    console.warn(e);
    _session = null;
  }
  _profile = null;
  if (_session) await loadProfile();
  return _session;
}

export async function loadProfile() {
  if (!_session) { _profile = null; return null; }
  const { data, error } = await supabase
    .from('app_user')
    .select('id, username, full_name, role, active, supplier_id, monthly_authorization_limit')
    .eq('id', _session.user.id)
    .maybeSingle();
  if (error) { console.warn('loadProfile error', error); _profile = null; return null; }
  _profile = data;
  return _profile;
}

export function getSession() { return _session; }
export function getProfile() { return _profile; }
export function isAdmin() { return _profile?.role === 'admin'; }
export function isFornecedor() { return _profile?.role === 'fornecedor'; }

/** Login por username → resolve email → signInWithPassword */
export async function login(username, password) {
  const u = (username || '').trim().toLowerCase();
  if (!u || !password) throw new Error('Informe usuário e senha.');

  const { data: email, error: e1 } = await supabase.rpc('email_from_username', { p_username: u });
  if (e1) throw new Error('Erro ao localizar usuário.');
  if (!email) throw new Error('Usuário não encontrado ou inativo.');

  const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
  if (e2) {
    if (e2.message?.includes('Invalid login credentials')) throw new Error('Senha incorreta.');
    throw new Error(e2.message || 'Falha ao entrar.');
  }
  await loadSession();
  return _session;
}

export async function logout() {
  await supabase.auth.signOut();
  _session = null;
  _profile = null;
}

/** Listener pra mudanças (refresh, logout em outra aba, etc).
 *
 * CRÍTICO: o callback do supabase.auth.onAuthStateChange DEVE retornar
 * síncronamente. Se retornar uma Promise (async), o supabase-js v2 trava todas
 * as queries seguintes ao voltar de uma aba em background — bug conhecido
 * (supabase/supabase-js#1620, supabase/supabase#17612, supabase/supabase#40806).
 * Por isso o trabalho async é deferido com setTimeout(0).
 */
export function onAuthChange(cb) {
  return supabase.auth.onAuthStateChange((event, session) => {
    _session = session || null;
    _profile = null;
    setTimeout(async () => {
      try {
        if (_session) await loadProfile();
        await cb(event, _session, _profile);
      } catch (e) { console.warn('onAuthChange handler error', e); }
    }, 0);
  });
}
