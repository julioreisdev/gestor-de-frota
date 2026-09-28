// Utilitários comuns do faturamento (Ordem de Fornecimento e Termo de Recebimento).

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
