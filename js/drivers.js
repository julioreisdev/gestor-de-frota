// Regras comuns de motoristas: situação da CNH, categorias e cursos.
// Usado pelo cadastro, pelo painel e pelas autorizações.
import { fmtDate } from './ui.js';
import { localToday, isoDate } from './billing.js';

export const CNH_CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'];
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const EMPLOYMENT_TYPES = {
  efetivo: 'Efetivo', comissionado: 'Comissionado', contratado: 'Contratado', terceirizado: 'Terceirizado',
};
export const COURSE_KINDS = {
  escolar: 'Transporte escolar',
  coletivo: 'Transporte coletivo de passageiros',
  emergencia: 'Veículos de emergência',
  perigosos: 'Produtos perigosos',
  indivisivel: 'Carga indivisível',
};
export const STATES = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export const CNH_WARN_DAYS = 30;

export const CNH_STATUS = {
  ok:       { label: 'CNH em dia',            badge: 'badge badge-success' },
  expiring: { label: 'Vence em até 30 dias',  badge: 'badge badge-warning' },
  expired:  { label: 'CNH vencida',           badge: 'badge badge-danger' },
  missing:  { label: 'CNH não informada',     badge: 'badge badge-neutral' },
};

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return isoDate(new Date(y, m - 1, d + n));
}

/** Situação da CNH: 'ok' | 'expiring' | 'expired' | 'missing'. Vencer hoje ainda é válida. */
export function cnhStatus(driver, today = localToday()) {
  if (!driver?.cnh_expiry) return 'missing';
  if (driver.cnh_expiry < today) return 'expired';
  if (driver.cnh_expiry <= addDays(today, CNH_WARN_DAYS)) return 'expiring';
  return 'ok';
}

/** Exame toxicológico só é exigido nas categorias C, D e E. */
export const needsToxicology = (driver) => /[CDE]/.test(driver?.cnh_category || '');
export function toxicologyExpired(driver, today = localToday()) {
  return needsToxicology(driver) && !!driver.toxicology_expiry && driver.toxicology_expiry < today;
}

/** Texto curto da CNH para listas: "D · 20/05/2027". */
export function cnhSummary(driver) {
  const parts = [];
  if (driver?.cnh_category) parts.push(driver.cnh_category);
  if (driver?.cnh_expiry) parts.push(fmtDate(driver.cnh_expiry));
  return parts.join(' · ');
}
