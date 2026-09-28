// Documentos do faturamento em PDF (A4 retrato), conforme os modelos do cliente.
// São montados só com os dados congelados na ordem e no termo: reimprimir dá o
// mesmo documento.
import { supabase } from './supabase.js';
import { esc, fmtDate, fmtCNPJ, formatPlate, toast } from './ui.js';
import { getEntity, reportLogoUrl } from './shell.js';
import { openPrintTab } from './thermal.js';
import { fmtLiters, fmtAmount, fmtPrice, fmtInt, toCenti, fmtCents, billingError } from './billing.js';

// Estilo comum aos documentos (modelos/_estilo.css do pacote do cliente).
const DOC_CSS = `
@page { size: A4; margin: 16mm 14mm 18mm 14mm;
  @bottom-left { content: "Gerir Frota"; font: 8pt Arial, sans-serif; color: #5A6676; }
  @bottom-right { content: "Página " counter(page) " de " counter(pages); font: 8pt Arial, sans-serif; color: #5A6676; } }
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #18212C; line-height: 1.4; margin: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cab { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1C4A85; padding-bottom: 8px; }
.cab img { width: 48px; height: 48px; object-fit: contain; }
.cab .l1 { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: #5A6676; font-weight: bold; }
.cab .l2 { font-size: 12pt; font-weight: bold; }
.titulo { text-align: center; margin: 14px 0 12px; }
.titulo h1 { margin: 0; font-size: 14pt; letter-spacing: .03em; }
.titulo .num { font-size: 9.5pt; color: #1C4A85; font-weight: bold; margin-top: 2px; }
.cancelada { border: 2px solid #B42318; color: #B42318; text-align: center; font-weight: bold;
  letter-spacing: .12em; padding: 6px; margin: 0 0 10px; font-size: 11pt; }
.cancelada small { display: block; font-weight: normal; letter-spacing: 0; font-size: 8.5pt; margin-top: 2px; }
h2 { font-size: 8.5pt; letter-spacing: .1em; text-transform: uppercase; color: #1C4A85;
  border-bottom: 1px solid #C8D1DB; padding-bottom: 3px; margin: 14px 0 6px; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
table.dados td { border: 1px solid #C8D1DB; padding: 4px 6px; width: 50%; vertical-align: top; }
table.dados .k { display: block; font-size: 7pt; letter-spacing: .08em; text-transform: uppercase; color: #5A6676; font-weight: bold; }
table.lista th { background: #1C4A85; color: #fff; font-size: 7.5pt; letter-spacing: .06em; text-transform: uppercase; text-align: left; padding: 4px 6px; }
table.lista td { border-bottom: 1px solid #E3E8EE; padding: 3px 6px; }
table.lista .n { text-align: right; }
table.lista tr.tot td { font-weight: bold; background: #F1F4F8; border-top: 1.2px solid #18212C; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
.texto { text-align: justify; line-height: 1.6; margin: 10px 0; }
.local { text-align: right; margin: 10px 0 0; }
.assinaturas { display: flex; justify-content: space-around; gap: 30px; margin-top: 46px; }
.assinaturas div { flex: 0 1 230px; border-top: 1px solid #18212C; padding-top: 4px; text-align: center; font-size: 8.5pt; }
.assinaturas b { display: block; }
.anexo { page-break-before: always; break-before: page; }
`;

const dash = (v) => (v == null || v === '' ? '—' : v);

async function municipalityName(entity) {
  if (!entity?.ibge_code) return '';
  const { data } = await supabase.from('ibge_municipality').select('name').eq('code', entity.ibge_code).maybeSingle();
  return data?.name || '';
}

function headerHTML(entity, order) {
  const logo = reportLogoUrl(entity);
  const fallback = new URL('logo.png', location.href).href;
  return `
<div class="cab">
  <img src="${esc(logo)}" alt="" onerror="if (this.dataset.fb) { this.style.display = 'none'; } else { this.dataset.fb = '1'; this.src = '${esc(fallback)}'; }">
  <div>
    <div class="l1">Estado do Piauí · ${esc(entity?.organ_name || '')}</div>
    <div class="l2">${esc(order.department_name_snapshot)}</div>
  </div>
</div>`;
}

/** Faixa de documento cancelado. doc = ordem ou termo; label = 'ORDEM CANCELADA'. */
function canceledHTML(doc, label) {
  if (!['cancelada', 'cancelado'].includes(doc.status)) return '';
  return `<div class="cancelada">${label}<small>${esc(doc.cancel_reason || '')}${doc.canceled_at ? ' · ' + esc(fmtDate(String(doc.canceled_at).slice(0, 10))) : ''}</small></div>`;
}

/** "A", "A e B", "A, B e C" */
const joinList = (arr) => arr.length < 2 ? arr.join('') : arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];

/** HTML completo da Ordem de Fornecimento. Exportado para os testes. */
export function supplyOrderHTML({ entity, city, order, items, fuelings }) {
  const periodo = `${fmtDate(order.period_start)} a ${fmtDate(order.period_end)}`;
  const empenho = (order.commitment_number || '').trim();
  const contratante = `${esc(order.department_name_snapshot)} · CNPJ ${esc(order.department_cnpj_snapshot ? fmtCNPJ(order.department_cnpj_snapshot) : '—')}`;
  const contratada = `${esc(order.supplier_name_snapshot)} · CNPJ ${esc(fmtCNPJ(order.supplier_cnpj_snapshot))}`;

  const itemRows = items.map((it, i) => `
    <tr><td>${i + 1}</td><td>${esc(it.fuel_label)}</td><td>L</td>
        <td class="n">${it.fuelings_count}</td><td class="n">${fmtLiters(it.liters)}</td></tr>`).join('');
  const fuelingRows = fuelings.map(f => `
      <tr><td>${esc(fmtDate(f.fueling_date))}</td><td>${esc(f.authorization_number || 'manual')}</td>
          <td>${esc(formatPlate(f.plate))}</td><td>${esc(f.fuel_label)}</td><td class="n">${fmtLiters(f.liters)}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Ordem de Fornecimento ${esc(order.number)} - ${esc(order.department_acronym_snapshot)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
${headerHTML(entity, order)}

<div class="titulo">
  <h1>ORDEM DE FORNECIMENTO</h1>
  <div class="num">Nº ${esc(order.number)} · Combustíveis · Competência ${esc(order.reference_month)}</div>
</div>
${canceledHTML(order, 'ORDEM CANCELADA')}

<h2>1. Dados do contrato</h2>
<table class="dados">
  <tr><td><span class="k">Contratante</span>${contratante}</td>
      <td><span class="k">Contratada</span>${contratada}</td></tr>
  <tr><td><span class="k">Contrato nº</span>${esc(dash(order.contract_number_snapshot))}</td>
      <td><span class="k">Nota de empenho nº</span>${esc(empenho || 'a informar')}</td></tr>
  <tr><td><span class="k">Período de fornecimento</span>${esc(periodo)}</td>
      <td><span class="k">Data de emissão</span>${esc(fmtDate(order.issue_date))}</td></tr>
</table>

<h2>2. Quantidade</h2>
<table class="lista">
  <thead><tr><th>Item</th><th>Combustível</th><th>Unid.</th><th class="n">Abastecimentos</th><th class="n">Quantidade</th></tr></thead>
  <tbody>${itemRows}
    <tr class="tot"><td colspan="3">Total</td><td class="n">${order.total_fuelings}</td><td class="n">${fmtLiters(order.total_liters)}</td></tr>
  </tbody>
</table>

<p class="texto">
  Fica autorizada a empresa <b>${esc(order.supplier_name_snapshot)}</b> a faturar o fornecimento de
  <b>${fmtLiters(order.total_liters)} litros</b> de combustíveis realizado ao
  ${esc(order.department_name_snapshot)} no período de ${esc(periodo)},
  conforme as quantidades acima e a relação anexa. A nota fiscal deve ser emitida em nome do
  ${esc(order.department_acronym_snapshot)}, informando o nº desta ordem e do contrato${empenho ? ` e o empenho nº ${esc(empenho)}` : ''}.
</p>
<p class="local">${esc(city || '')} (PI), ${esc(fmtDate(order.issue_date))}.</p>

<div class="assinaturas">
  <div><b>${esc(dash(order.responsible_name_snapshot))}</b>${esc(order.responsible_role_snapshot || '')}</div>
</div>

<div class="anexo">
  <h2>Anexo · Relação de abastecimentos</h2>
  <table class="lista">
    <thead><tr><th>Data</th><th>Autorização</th><th>Placa</th><th>Combustível</th><th class="n">Litros</th></tr></thead>
    <tbody>${fuelingRows}
      <tr class="tot"><td colspan="4">Total · ${order.total_fuelings} abastecimentos</td><td class="n">${fmtLiters(order.total_liters)}</td></tr>
    </tbody>
  </table>
</div>

</body>
</html>`;
}

/** R3 · Anexo II: soma das linhas do Anexo I por veículo. Km = soma de (final − inicial). */
export function termVehicles(lines) {
  const map = new Map();
  lines.forEach(l => {
    const v = map.get(l.plate) || { plate: l.plate, model: l.vehicle_model || '', fuels: new Set(), n: 0, liters: 0, amount: 0, km: 0 };
    v.n++; v.liters += toCenti(l.liters) || 0; v.amount += toCenti(l.amount) || 0;
    v.fuels.add(l.fuel_label);
    // tipo 99 (Outros) usa o km sentinela 99999999: não tem odômetro
    if (l.vehicle_type_code !== 99 && l.km_initial != null && l.km_final != null && l.km_final !== 99999999) {
      v.km += Math.max(0, l.km_final - l.km_initial);
    }
    map.set(l.plate, v);
  });
  return [...map.values()].sort((a, b) => a.plate.localeCompare(b.plate)).map(v => ({
    ...v, fuel: [...v.fuels].join(', '),
    kmPerLiter: v.km > 0 && v.liters > 0 ? Math.round(v.km * 10000 / v.liters) / 100 : null,
  }));
}

/** HTML completo do Termo de Recebimento. Exportado para os testes. */
export function receiptTermHTML({ entity, city, term, order, items, lines }) {
  const contratante = `${esc(order.department_name_snapshot)} · CNPJ ${esc(order.department_cnpj_snapshot ? fmtCNPJ(order.department_cnpj_snapshot) : '—')}`;
  const contratada = `${esc(order.supplier_name_snapshot)} · CNPJ ${esc(fmtCNPJ(order.supplier_cnpj_snapshot))}`;
  const nf = `${esc(term.invoice_number)}${term.invoice_series ? ' · série ' + esc(term.invoice_series) : ''}`;
  const vehicles = termVehicles(lines);
  const fiscalLine = ['Fiscal do contrato', term.fiscal_registration ? 'Mat. ' + term.fiscal_registration : ''].filter(Boolean).join(' · ');

  const itemRows = items.map(it => `
    <tr><td>${esc(it.fuel_label)}</td><td class="n">${fmtInt(it.fuelings_count)}</td><td class="n">${fmtLiters(it.liters)}</td>
        <td class="n">${fmtPrice(it.unit_price)}</td><td class="n">${fmtAmount(it.amount)}</td></tr>`).join('');
  const lineRows = lines.map(l => `
      <tr><td>${esc(fmtDate(l.fueling_date))}</td><td>${esc(l.authorization_number || 'manual')}</td>
          <td>${esc(formatPlate(l.plate))}</td><td>${esc(l.fuel_label)}</td>
          <td class="n">${fmtLiters(l.liters)}</td><td class="n">${fmtAmount(l.amount)}</td></tr>`).join('');
  const vehicleRows = vehicles.map(v => `
      <tr><td>${esc(formatPlate(v.plate))}</td><td>${esc(v.model)}</td><td>${esc(v.fuel)}</td>
          <td class="n">${fmtInt(v.n)}</td><td class="n">${fmtCents(v.liters)}</td>
          <td class="n">${v.km > 0 ? fmtInt(v.km) : '—'}</td><td class="n">${v.kmPerLiter != null ? fmtAmount(v.kmPerLiter) : '—'}</td>
          <td class="n">${fmtCents(v.amount)}</td></tr>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Termo de Recebimento ${esc(term.number)} - ${esc(order.department_acronym_snapshot)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
${headerHTML(entity, order)}

<div class="titulo">
  <h1>TERMO DE RECEBIMENTO DEFINITIVO</h1>
  <div class="num">Nº ${esc(term.number)} · Combustíveis · Competência ${esc(order.reference_month)}</div>
</div>
${canceledHTML(term, 'TERMO CANCELADO')}

<h2>1. Dados do contrato</h2>
<table class="dados">
  <tr><td><span class="k">Contratante</span>${contratante}</td>
      <td><span class="k">Contratada</span>${contratada}</td></tr>
  <tr><td><span class="k">Contrato nº</span>${esc(dash(order.contract_number_snapshot))}</td>
      <td><span class="k">Nota de empenho nº</span>${esc(term.commitment_number)}</td></tr>
  <tr><td><span class="k">Ordem de fornecimento nº</span>${esc(order.number)}</td>
      <td><span class="k">Nota fiscal nº / data</span>${nf} · ${esc(fmtDate(term.invoice_date))}</td></tr>
</table>

<h2>2. Quantidade e valor</h2>
<table class="lista">
  <thead><tr><th>Combustível</th><th class="n">Abast.</th><th class="n">Litros</th><th class="n">Preço (R$/L)</th><th class="n">Valor (R$)</th></tr></thead>
  <tbody>${itemRows}
    <tr class="tot"><td>Total</td><td class="n">${fmtInt(order.total_fuelings)}</td><td class="n">${fmtLiters(order.total_liters)}</td><td></td><td class="n">${fmtAmount(term.total_amount)}</td></tr>
  </tbody>
</table>

<h2>3. Declaração</h2>
<p class="texto">
  Declaro, para fins de liquidação da despesa, que o ${esc(order.department_name_snapshot)} recebeu em definitivo da empresa
  <b>${esc(order.supplier_name_snapshot)}</b> o fornecimento objeto da Ordem de Fornecimento nº <b>${esc(order.number)}</b>:
  ${joinList(items.map(it => `<b>${fmtLiters(it.liters)} litros de ${esc(it.fuel_label)}</b>`))},
  totalizando <b>${fmtLiters(order.total_liters)} litros</b> em <b>${fmtInt(order.total_fuelings)} abastecimentos</b>
  realizados de ${esc(fmtDate(order.period_start))} a ${esc(fmtDate(order.period_end))}, conforme os Anexos I e II,
  no valor de <b>R$ ${fmtAmount(term.total_amount)}</b>. O fornecimento atende ao contrato em quantidade,
  especificação e preço, e a nota fiscal nº ${esc(term.invoice_number)} fica atestada para pagamento
  (Lei nº 14.133/2021, art. 140, II, "b"; Lei nº 4.320/1964, art. 63).
</p>
<p class="local">${esc(city || '')} (PI), ${esc(fmtDate(term.issue_date))}.</p>

<div class="assinaturas">
  <div><b>${esc(term.fiscal_name)}</b>${esc(fiscalLine)}${term.fiscal_ordinance ? '<br>' + esc(term.fiscal_ordinance) : ''}</div>
  <div><b>${esc(dash(term.responsible_name_snapshot))}</b>${esc(term.responsible_role_snapshot || '')}</div>
</div>

<div class="anexo">
  <h2>Anexo I · Relação de abastecimentos</h2>
  <table class="lista">
    <thead><tr><th>Data</th><th>Autorização</th><th>Placa</th><th>Combustível</th><th class="n">Litros</th><th class="n">Valor (R$)</th></tr></thead>
    <tbody>${lineRows}
      <tr class="tot"><td colspan="4">Total · ${fmtInt(order.total_fuelings)} abastecimentos</td><td class="n">${fmtLiters(order.total_liters)}</td><td class="n">${fmtAmount(term.total_amount)}</td></tr>
    </tbody>
  </table>

  <h2>Anexo II · Relação de veículos</h2>
  <table class="lista">
    <thead><tr><th>Placa</th><th>Veículo</th><th>Combustível</th><th class="n">Abast.</th><th class="n">Litros</th><th class="n">Km</th><th class="n">Km/L</th><th class="n">Valor (R$)</th></tr></thead>
    <tbody>${vehicleRows}
      <tr class="tot"><td colspan="3">Total · ${fmtInt(vehicles.length)} veículo${vehicles.length === 1 ? '' : 's'}</td><td class="n">${fmtInt(order.total_fuelings)}</td><td class="n">${fmtLiters(order.total_liters)}</td><td></td><td></td><td class="n">${fmtAmount(term.total_amount)}</td></tr>
    </tbody>
  </table>
</div>

</body>
</html>`;
}

/** Busca o termo e abre o PDF em nova aba. Devolve true se abriu. */
export async function printReceiptTerm(termId) {
  const [t, l, entity] = await Promise.all([
    supabase.from('receipt_term')
      .select('*, items:receipt_term_item(fuel_label, fuelings_count, liters, unit_price, amount), order:supply_order_id(*)')
      .eq('id', termId).maybeSingle(),
    supabase.rpc('receipt_term_fuelings', { p_term: termId }),
    getEntity(),
  ]);
  const err = t.error || l.error;
  if (err) { toast(billingError(err), 'error'); return false; }
  if (!t.data || !t.data.order) { toast('Termo de Recebimento não encontrado.', 'error'); return false; }
  const city = await municipalityName(entity);
  const items = [...(t.data.items || [])].sort((a, b) => String(a.fuel_label).localeCompare(String(b.fuel_label)));
  const html = receiptTermHTML({ entity, city, term: t.data, order: t.data.order, items, lines: l.data || [] });
  const win = openPrintTab(html, { title: `Termo de Recebimento ${t.data.number}` });
  if (!win) toast('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente de novo.', 'warning', 7000);
  return !!win;
}

/** Busca a ordem e abre o PDF em nova aba. Devolve true se abriu. */
export async function printSupplyOrder(orderId) {
  const [o, f, entity] = await Promise.all([
    supabase.from('supply_order')
      .select('*, items:supply_order_item(fuel_type_code, fuel_label, fuelings_count, liters)')
      .eq('id', orderId).maybeSingle(),
    supabase.rpc('supply_order_fuelings', { p_order: orderId }),
    getEntity(),
  ]);
  const err = o.error || f.error;
  if (err) { toast(billingError(err), 'error'); return false; }
  if (!o.data) { toast('Ordem de Fornecimento não encontrada.', 'error'); return false; }
  const city = await municipalityName(entity);
  const items = [...(o.data.items || [])].sort((a, b) => String(a.fuel_label).localeCompare(String(b.fuel_label)));
  const html = supplyOrderHTML({ entity, city, order: o.data, items, fuelings: f.data || [] });
  const win = openPrintTab(html, { title: `Ordem de Fornecimento ${o.data.number}` });
  if (!win) toast('O navegador bloqueou a nova aba. Permita pop-ups para este site e tente de novo.', 'warning', 7000);
  return !!win;
}
