// Regras comuns de motoristas: situação da CNH, categorias e cursos.
// Usado pelo cadastro, pelo painel e pelas autorizações.
import { supabase } from './supabase.js';
import { fmtDate, esc } from './ui.js';
import { icons } from './icons.js';
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

// =============================================================================
// Motorista na autorização e no abastecimento (sempre opcional, nunca bloqueia)
// =============================================================================

export const VEHICLE_TYPE_LABEL = {
  1: 'Automóvel', 2: 'Ônibus', 3: 'Micro-ônibus', 4: 'Caminhão', 5: 'Caminhonete',
  6: 'Camioneta', 7: 'Utilitário', 8: 'Motocicleta', 9: 'Trator', 99: 'Outros',
};
// Categoria exigida por tipo de veículo: letras aceitas e texto do aviso
const CATEGORY_RULE = {
  8: { letters: 'A',    text: 'A' },
  1: { letters: 'BCDE', text: 'B ou superior' }, 5: { letters: 'BCDE', text: 'B ou superior' },
  6: { letters: 'BCDE', text: 'B ou superior' }, 7: { letters: 'BCDE', text: 'B ou superior' },
  9: { letters: 'BCDE', text: 'B ou superior' },
  4: { letters: 'CDE',  text: 'C, D ou E' },
  2: { letters: 'DE',   text: 'D ou E' }, 3: { letters: 'DE', text: 'D ou E' },
};

/** Avisos sobre o motorista escolhido para o veículo. Lista vazia = tudo certo. */
export function driverWarnings(driver, vehicle, today = localToday()) {
  if (!driver) return [];
  const out = [];
  const st = cnhStatus(driver, today);
  if (st === 'expired') out.push(`CNH vencida em ${fmtDate(driver.cnh_expiry)}.`);
  else if (st === 'expiring') out.push(driver.cnh_expiry === today ? 'CNH vence hoje.' : `CNH vence em ${fmtDate(driver.cnh_expiry)}.`);
  else if (st === 'missing') out.push(driver.cnh_number || driver.cnh_category ? 'CNH sem validade cadastrada.' : 'Motorista sem CNH cadastrada.');
  const rule = CATEGORY_RULE[vehicle?.vehicle_type_code];
  if (rule && driver.cnh_category && ![...driver.cnh_category].some(l => rule.letters.includes(l))) {
    out.push(`Categoria ${driver.cnh_category} não atende ${VEHICLE_TYPE_LABEL[vehicle.vehicle_type_code]} (exige ${rule.text}).`);
  }
  if (toxicologyExpired(driver, today)) out.push(`Exame toxicológico vencido em ${fmtDate(driver.toxicology_expiry)}.`);
  return out;
}

export function driverOptionLabel(d) {
  const cnh = cnhSummary(d);
  return `${d.full_name} — ${cnh ? 'CNH ' + cnh : 'sem CNH cadastrada'}`;
}

/** Motoristas para escolha. Banco ainda sem o cadastro: devolve available = false
 *  e as telas seguem sem o campo. */
export async function loadDriversForPick() {
  try {
    const r = await supabase.from('driver')
      .select('id, full_name, department_id, cnh_number, cnh_category, cnh_expiry, toxicology_expiry, active')
      .order('full_name');
    if (r.error) return { drivers: [], available: false };
    return { drivers: r.data || [], available: true };
  } catch { return { drivers: [], available: false }; }
}

/** Ativos da secretaria do veículo e os sem secretaria. Mantém o já escolhido
 *  (mesmo inativo ou de outra secretaria) para a edição não perder o valor. */
export function driversForVehicle(drivers, vehicle, keepId = '') {
  return drivers.filter(d => d.id === keepId
    || (d.active && (!vehicle?.department_id || !d.department_id || d.department_id === vehicle.department_id)));
}

export const driverFieldHTML = (cls = 'col-full') => `
  <div class="field ${cls}" data-driver-field>
    <label class="field-label" for="pick-driver">Motorista <span class="nof-opt">(opcional)</span></label>
    <select class="select" id="pick-driver" name="driver_id"></select>
    <div class="drv-warnings" id="pick-driver-warnings" hidden></div>
  </div>`;

/** Liga o campo de motorista de um modal. getVehicle() devolve o veículo escolhido.
 *  Devolve { refresh } para chamar quando o veículo mudar. */
export function mountDriverField(root, { drivers, getVehicle, selectedId = '' }) {
  const sel = root.querySelector('#pick-driver');
  const box = root.querySelector('#pick-driver-warnings');
  if (!sel) return { refresh() {} };
  let current = selectedId || '';
  const warn = () => {
    const d = drivers.find(x => x.id === sel.value);
    const list = driverWarnings(d, getVehicle());
    box.hidden = !list.length;
    box.innerHTML = list.length ? `
      <span class="nof-warn-icon">${icons.alert}</span>
      <div>${list.map(w => `<div>${esc(w)}</div>`).join('')}
        <div class="drv-warnings-note">É só um aviso: a emissão não é bloqueada.</div></div>` : '';
  };
  const refresh = () => {
    // selectedId (o que já estava gravado) fica na lista mesmo fora da regra;
    // outra escolha que deixou de servir ao trocar o veículo é desfeita
    const pool = driversForVehicle(drivers, getVehicle(), selectedId);
    if (current && !pool.some(d => d.id === current)) current = '';
    sel.innerHTML = '<option value="">— Não informar —</option>' +
      pool.map(d => `<option value="${d.id}" ${d.id === current ? 'selected' : ''}>${esc(driverOptionLabel(d))}${d.active ? '' : ' (inativo)'}</option>`).join('');
    warn();
  };
  sel.addEventListener('change', () => { current = sel.value; warn(); });
  refresh();
  return { refresh };
}
