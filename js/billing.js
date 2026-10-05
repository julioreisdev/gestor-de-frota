// Utilitários comuns do faturamento (Ordem de Fornecimento e Termo de Recebimento).
import { supabase } from './supabase.js';
import { fmtDate, onlyDigits, isValidCPF } from './ui.js';

/** Data de hoje no fuso do usuário (toISOString usa UTC e vira o dia às 21h no Brasil). */
export function localToday() {
  return isoDate(new Date());
}
export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Primeiro e último dia do mês de uma data ISO. */
export function monthRange(iso) {
  const [y, m] = iso.split('-').map(Number);
  return { start: isoDate(new Date(y, m - 1, 1)), end: isoDate(new Date(y, m, 0)) };
}
/** Mês anterior completo ao de hoje. */
export function previousMonthRange() {
  const n = new Date();
  return monthRange(isoDate(new Date(n.getFullYear(), n.getMonth() - 1, 1)));
}

const nf = (min, max) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max });
const NF2 = nf(2, 2), NF3 = nf(3, 3), NF0 = nf(0, 0);
export const fmtLiters = (n) => NF2.format(Number(n || 0));      // 1.300,07
export const fmtAmount = (n) => NF2.format(Number(n || 0));      // 8.099,44
export const fmtPrice  = (n) => NF3.format(Number(n || 0));      // 6,230
export const fmtInt    = (n) => NF0.format(Number(n || 0));

export const ORDER_STATUS = {
  emitida:   { label: 'Emitida',   badge: 'badge badge-warning' },
  faturada:  { label: 'Faturada',  badge: 'badge badge-success' },
  cancelada: { label: 'Cancelada', badge: 'badge badge-danger' },
};

export const TERM_STATUS = {
  emitido:   { label: 'Emitido',   badge: 'badge badge-success' },
  cancelado: { label: 'Cancelado', badge: 'badge badge-danger' },
};

// ---- Cálculo do termo: inteiros, nunca ponto flutuante; meio para cima ----
// O banco faz a mesma conta e é quem grava; a tela só mostra em tempo real.

/** "6,23", "6.23" ou 6.23 → milésimos de real (6230). null se não for número. */
export function priceToMilli(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!/^\d{1,5}(\.\d+)?$/.test(s)) return null;
  const [int, dec = ''] = s.split('.');
  const d = (dec + '0000').slice(0, 4);             // a 4ª casa decide o arredondamento
  return Number(int) * 1000 + Number(d.slice(0, 3)) + (Number(d[3]) >= 5 ? 1 : 0);
}
/** Valor com 2 casas (litros ou reais) → centésimos inteiros. null se não for número. */
export function toCenti(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [int, dec = ''] = s.split('.');
  const d = (dec + '000').slice(0, 3);
  return Number(int) * 100 + Number(d.slice(0, 2)) + (Number(d[2]) >= 5 ? 1 : 0);
}
/** R1 e R2: ROUND(litros × preço, 2), em centavos. */
export function amountCents(liters, priceMilli) {
  const l = toCenti(liters);
  if (l == null || priceMilli == null) return null;
  return Number((BigInt(l) * BigInt(priceMilli) + 500n) / 1000n);
}
export const fmtCents = (c) => fmtAmount((c || 0) / 100);

// ---- Fiscal do contrato ----
// Nome, CPF e portaria (número e data) são obrigatórios; matrícula é opcional.
// O CPF fica em tabela à parte (supplier_fiscal_doc), que o posto não lê.

/** Só o número da portaria: tira um "Portaria nº" digitado junto. */
export const normOrdinance = (s) => String(s || '').trim().replace(/^portaria\s*(n[ºo°.]*)?\s*/i, '').trim();

/** "Portaria nº 045/2026, de 02/01/2026" (sem a data, quando o registro é antigo). */
export function fmtOrdinance(number, date) {
  const n = normOrdinance(number);
  if (!n) return '';
  return `Portaria nº ${n}${date ? ', de ' + fmtDate(date) : ''}`;
}

/** O que falta no fiscal: lista de textos. Vazia = completo. */
export function fiscalMissing({ name, cpf, ordinance, ordinance_date }) {
  const m = [];
  if (!String(name || '').trim()) m.push('nome do fiscal');
  if (!onlyDigits(cpf)) m.push('CPF do fiscal');
  if (!normOrdinance(ordinance)) m.push('nº da portaria');
  if (!ordinance_date) m.push('data da portaria');
  return m;
}
/** Erro de preenchimento do fiscal, ou ''. Fiscal todo em branco é aceito (required = false). */
export function fiscalError(f, { required = false } = {}) {
  const any = [f.name, f.cpf, f.registration, f.ordinance, f.ordinance_date].some(v => String(v || '').trim());
  if (!any && !required) return '';
  const miss = fiscalMissing(f);
  if (miss.length) return `Fiscal do contrato: falta ${miss.join(', ')}.`;
  if (!isValidCPF(f.cpf)) return 'CPF do fiscal inválido. Confira os números.';
  if (f.ordinance_date > localToday()) return 'A data da portaria não pode ser futura.';
  return '';
}

/** CPF dos fiscais por contrato: Map(supplier_id → cpf). available = false quando
 *  o banco ainda não tem a tabela (versão anterior): as telas seguem sem o campo. */
export async function loadFiscalCpfs() {
  try {
    const r = await supabase.from('supplier_fiscal_doc').select('supplier_id, cpf');
    if (r.error) return { map: new Map(), available: false };
    return { map: new Map((r.data || []).map(x => [x.supplier_id, x.cpf])), available: true };
  } catch { return { map: new Map(), available: false }; }
}
/** Grava (ou apaga, se vazio) o CPF do fiscal do contrato. Devolve o erro, se houver. */
export async function saveFiscalCpf(supplierId, cpf) {
  const d = onlyDigits(cpf);
  const r = d
    ? await supabase.from('supplier_fiscal_doc').upsert({ supplier_id: supplierId, cpf: d, updated_at: new Date().toISOString() }, { onConflict: 'supplier_id' })
    : await supabase.from('supplier_fiscal_doc').delete().eq('supplier_id', supplierId);
  return r.error || null;
}

// ---- Busca pelo número da nota fiscal ----
/** Só os dígitos, sem zeros à esquerda: "4.512" e "004512" viram "4512". */
export const nfDigits = (s) => onlyDigits(s).replace(/^0+/, '');
/** A nota bate com o que foi digitado? Compara só dígitos e aceita parte do número. */
export function nfMatches(invoiceNumber, query) {
  const q = nfDigits(query);
  return !!q && nfDigits(invoiceNumber).includes(q);
}

// ---- Valor faturado ----
// Depois do Termo de Recebimento, o abastecimento vale o valor do termo (já com
// o ajuste de centavos), e não litros × preço. Assim relatório e termo batem.

/** Troca `total` pelo valor faturado nos abastecimentos que têm termo. */
export function applyInvoicedTotals(rows) {
  (rows || []).forEach(a => {
    if (a.invoiced_total != null) { a.invoiced = true; a.total = Number(a.invoiced_total); }
  });
  return rows;
}
/** Consulta abastecimentos pedindo também os dados do faturamento e do motorista.
 *  build(colunas extras) devolve a consulta. Banco em versão anterior: repete sem
 *  o motorista e, se preciso, sem o faturamento.
 *  Devolve { data, error, hasBilling, hasDrivers }. */
export async function queryFuelings(build) {
  const BILLING = ', supply_order_id, invoiced_total', DRIVER = ', driver_id, driver_name_snapshot';
  const missing = (r) => r.error && (r.error.code === '42703'
    || /supply_order_id|invoiced_total|driver_id|driver_name_snapshot/i.test(r.error.message || ''));
  let hasBilling = true, hasDrivers = true;
  let res = await build(BILLING + DRIVER);
  if (missing(res)) { hasDrivers = false; res = await build(BILLING); }
  if (missing(res)) { hasBilling = false; res = await build(''); }
  if (!res.error) applyInvoicedTotals(res.data);
  return { ...res, hasBilling, hasDrivers };
}

/** Tabela ou função do faturamento ainda não existe: o apply.sql não foi executado. */
export function isBillingMissing(err) {
  const msg = err?.message || '';
  return ['42P01', '42883', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(err?.code)
    || /could not find the (function|table|.* column)|does not exist/i.test(msg);
}

/** Mensagem para o usuário. As funções do banco já devolvem o texto em português. */
export function billingError(err) {
  if (isBillingMissing(err)) return 'Banco de dados ainda não atualizado. Execute o apply.sql no Supabase.';
  const msg = err?.message || String(err || '');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão. Verifique a internet e tente de novo.';
  return msg || 'Não foi possível concluir a operação.';
}

/** Corrida contra um tempo limite, para a tela nunca ficar presa em "carregando". */
export function withTimeout(promise, ms = 15000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado. Verifique sua conexão.')), ms)),
  ]);
}
