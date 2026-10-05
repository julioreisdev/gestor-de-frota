// Anexo de conferência do relatório gerencial (só administrador).
// Lista o que corrigir ou analisar antes de gerar os dados para exportação.
// Sai no fim do PDF completo; o corpo do relatório e o Excel não o citam.
// Só monta dados e HTML: quem busca no banco é a tela de Relatórios.
import { esc, fmtDate, formatPlate } from './ui.js';
import { fiscalMissing } from './billing.js';

const liters = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Máquina não tem odômetro (no TCE vai com 99999999): trator e "Outros" ficam fora do km zerado
const MACHINE_TYPES = new Set([9, 99]);

/**
 * Monta as nove pendências.
 * @param fuelings   abastecimentos do período (já filtrados), com authorization { number, date }
 * @param vehicles   cadastro de veículos (id, plate, model, vehicle_type_code, tank_capacity, department)
 * @param suppliers  contratos, com fiscal_* e fiscal_cpf (null quando não avaliado)
 * @param orders     ordens de fornecimento do período, não canceladas (null = banco sem faturamento)
 * @param futureAuths autorizações não canceladas com data posterior a hoje
 * @param hasBilling / hasFiscalDoc  false = pendência "não avaliada"
 */
export function buildConference({ fuelings, vehicles, suppliers, orders, futureAuths, today, fuelLabel, hasBilling, hasFiscalDoc }) {
  const veh = new Map(vehicles.map(v => [v.id, v]));
  const sup = new Map(suppliers.map(s => [s.id, s]));
  const plate = (a) => formatPlate(veh.get(a.vehicle_id)?.plate || a.vehicle_plate_snapshot || '');
  const dept = (a) => a.department_acronym_snapshot || veh.get(a.vehicle_id)?.department?.acronym || '—';
  const authNo = (a) => a.authorization?.number || 'Manual';
  const fuelRow = (a) => [fmtDate(a.date), authNo(a), dept(a), plate(a), fuelLabel(a), liters(a.quantity)];
  const C_AB = ['Data', 'Autorização', 'Secretaria', 'Placa', 'Combustível', 'Litros'];
  const N_AB = [5];
  const P = [];
  const add = (code, title, level, action, cols, rows, opt = {}) =>
    P.push({ code, title, level, action, cols, rows, count: opt.count ?? rows.length, num: opt.num || [], note: opt.note || '', evaluated: opt.evaluated !== false });

  // P1: data posterior a hoje (registros anteriores ao bloqueio). Não depende do período.
  const p1 = futureAuths.map(a => [fmtDate(a.date), a.number, a.department_acronym_snapshot || '—',
    formatPlate(a.vehicle_plate_snapshot || ''), fuelLabel(a), liters(a.authorized_quantity)]);
  const seen = new Set(futureAuths.map(a => a.id));
  fuelings.filter(a => a.date > today && !seen.has(a.authorization_id)).forEach(a => p1.push(fuelRow(a)));
  add('P1', 'Autorização com data futura', 'corrigir', 'Corrigir a data ou cancelar a autorização.', C_AB, p1,
    { num: N_AB, note: 'Lançamentos anteriores ao bloqueio de data futura. Esta conferência não depende do período do relatório.' });

  // P2: veículo que abasteceu e ficou com km rodado zerado no período (consolidado)
  const byVeh = new Map();
  fuelings.forEach(a => {
    const g = byVeh.get(a.vehicle_id) || { n: 0, liters: 0, km: 0, a };
    g.n++; g.liters += +a.quantity || 0;
    if (a.km_initial != null && a.km_final != null) g.km += Math.max(0, a.km_final - a.km_initial);
    byVeh.set(a.vehicle_id, g);
  });
  const p2 = [...byVeh.entries()]
    .filter(([id, g]) => g.km === 0 && !MACHINE_TYPES.has(Number(veh.get(id)?.vehicle_type_code)))
    .map(([id, g]) => [dept(g.a), plate(g.a), veh.get(id)?.model || '—', g.n, liters(g.liters)])
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  add('P2', 'Veículo com abastecimento e km rodado zerado no mês', 'corrigir',
    'Conferir o odômetro informado nos abastecimentos do veículo no período. Se for máquina, corrigir o tipo no cadastro (odômetro padrão 99999999 do TCE).',
    ['Secretaria', 'Placa', 'Veículo', 'Abast.', 'Litros'], p2,
    { num: [3, 4], note: 'Conferência pelo consolidado do período: o veículo abasteceu e o km rodado ficou em zero. Máquinas (trator e tipo Outros) não entram nesta lista.' });

  // P3: abastecimentos sem Ordem de Fornecimento, resumidos pela secretaria do contrato
  const noOrder = new Map();
  let noOrderCount = 0;
  if (hasBilling) fuelings.filter(a => !a.supply_order_id).forEach(a => {
    const k = sup.get(a.supplier_id)?.department?.acronym || dept(a);
    const g = noOrder.get(k) || { n: 0, liters: 0 };
    g.n++; g.liters += +a.quantity || 0; noOrder.set(k, g); noOrderCount++;
  });
  add('P3', 'Abastecimentos sem ordem de fornecimento', 'corrigir', 'Emitir a ordem de fornecimento do contrato e período.',
    ['Secretaria', 'Abastecimentos', 'Litros'],
    [...noOrder.entries()].sort((a, b) => b[1].liters - a[1].liters).map(([k, g]) => [k, g.n, liters(g.liters)]),
    { num: [1, 2], count: noOrderCount, evaluated: hasBilling,
      note: 'Resumo por secretaria. A lista de cada contrato está em Faturamento › Nova ordem.' });

  // P4 e P5: ordens do período sem empenho / sem termo
  const C_OF = ['Ordem', 'Secretaria', 'Contrato', 'Litros'];
  const orderRow = (o) => [o.number, o.department_acronym_snapshot,
    `${o.supplier_name_snapshot}${o.contract_number_snapshot ? ' · nº ' + o.contract_number_snapshot : ''}`, liters(o.total_liters)];
  add('P4', 'Ordem de fornecimento sem empenho', 'corrigir', 'Informar o número do empenho na ordem.',
    C_OF, (orders || []).filter(o => !o.commitment_number).map(orderRow), { num: [3], evaluated: !!orders });
  add('P5', 'Ordem de fornecimento sem termo de recebimento', 'corrigir', 'Gerar o termo de recebimento com a nota fiscal e o preço.',
    C_OF, (orders || []).filter(o => o.status === 'emitida').map(orderRow), { num: [3], evaluated: !!orders });

  // P6: contratos com abastecimento no período e fiscal incompleto
  const used = new Set(fuelings.map(a => a.supplier_id));
  const p6 = !hasFiscalDoc ? [] : suppliers.filter(s => used.has(s.id) && s.kind !== 'mecanica').map(s => {
    const miss = fiscalMissing({ name: s.fiscal_name, cpf: s.fiscal_cpf, ordinance: s.fiscal_ordinance, ordinance_date: s.fiscal_ordinance_date });
    return miss.length ? [
      `${s.trade_name || s.legal_name}${s.department?.acronym ? ' · ' + s.department.acronym : ''}${s.contract_number ? ' · nº ' + s.contract_number : ''}`,
      s.fiscal_name || '—', miss.map(m => m.replace(' do fiscal', '')).join(', ')] : null;
  }).filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]));
  add('P6', 'Fiscal do contrato com cadastro incompleto', 'corrigir',
    'Completar CPF e portaria (número e data) do fiscal em Faturamento › Configuração.',
    ['Contrato', 'Fiscal', 'Falta'], p6, { evaluated: hasFiscalDoc });

  // P7: data do abastecimento diferente da data da autorização
  const p7 = fuelings.filter(a => a.authorization?.date && a.date !== a.authorization.date && a.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(a => [authNo(a), fmtDate(a.authorization.date), fmtDate(a.date), dept(a), plate(a), liters(a.quantity)]);
  add('P7', 'Data do abastecimento diferente da data de emissão da autorização', 'analisar',
    'Conferir qual é a data correta do abastecimento e corrigir se for erro de digitação.',
    ['Autorização', 'Emitida em', 'Data do abastecimento', 'Secretaria', 'Placa', 'Litros'], p7, { num: [5] });

  // P8: mais de um abastecimento do mesmo veículo no mesmo dia
  const byDay = new Map();
  fuelings.forEach(a => { const k = a.vehicle_id + '|' + a.date; byDay.set(k, [...(byDay.get(k) || []), a]); });
  const p8 = [...byDay.values()].filter(l => l.length > 1).sort((a, b) => a[0].date.localeCompare(b[0].date))
    .map(l => [fmtDate(l[0].date), dept(l[0]), plate(l[0]), veh.get(l[0].vehicle_id)?.model || '—',
      l.map(authNo).join(', '), liters(l.reduce((s, a) => s + (+a.quantity || 0), 0))]);
  add('P8', 'Mais de um abastecimento do mesmo veículo no mesmo dia', 'analisar',
    'Conferir se não houve lançamento em duplicidade. Se houve, excluir o abastecimento repetido.',
    ['Data', 'Secretaria', 'Placa', 'Veículo', 'Autorizações', 'Litros no dia'], p8, { num: [5] });

  // P9: litros acima da capacidade do tanque
  const cap = (a) => Number(veh.get(a.vehicle_id)?.tank_capacity || 0);
  const p9 = fuelings.filter(a => cap(a) > 0 && Number(a.quantity) > cap(a))
    .sort((a, b) => a.date.localeCompare(b.date)).map(a => [...fuelRow(a), liters(cap(a))]);
  add('P9', 'Abastecimento acima da capacidade do tanque', 'analisar',
    'Conferir os litros lançados e a capacidade do tanque no cadastro do veículo.',
    [...C_AB, 'Tanque (L)'], p9, { num: [5, 6] });

  const sum = (lv) => P.filter(p => p.level === lv).reduce((s, p) => s + p.count, 0);
  return { items: P, fix: sum('corrigir'), review: sum('analisar') };
}

/** HTML do anexo, para o fim do PDF do relatório (começa em página nova). */
export function conferenceHTML(conf, { period, generatedAt }) {
  const cls = (i, num) => num.includes(i) ? ' class="n"' : '';
  const table = (cols, rows, num) => `
    <table class="data"><thead><tr>${cols.map((c, i) => `<th${cls(i, num)}>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((v, i) => `<td${cls(i, num)}>${esc(v ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const level = (p) => p.level === 'corrigir' ? '<span class="cf-fix">Corrigir</span>' : '<span class="cf-rev">Analisar</span>';
  const count = (p) => !p.evaluated ? 'não avaliada' : p.count ? p.count : '<span class="cf-ok">0</span>';
  const pending = conf.items.filter(p => p.evaluated && p.count);

  return `
  <style>
    .cf { page-break-before: always; break-before: page; }
    .cf-head { font-size:16px; font-weight:700; color:#0F172A; margin:0; }
    .cf-sub { font-size:10px; color:#64748B; margin:4px 0 0; }
    .cf table.data th.n, .cf table.data td.n { text-align:right; }
    .cf-fix { color:#B42318; font-weight:700; } .cf-rev { color:#9A5B00; font-weight:700; } .cf-ok { color:#1E7A46; font-weight:700; }
    .cf-tot td { font-weight:700; background:#EEF2F7 !important; }
    .cf-note { font-size:9px; color:#64748B; margin:4px 0 0; }
    .cf h3 { font-size:11px; font-weight:700; color:#0F172A; margin:16px 0 2px; page-break-after:avoid; break-after:avoid-page; }
    .cf-do { font-size:10px; margin:0 0 6px; } .cf-do b { color:#1A65B5; }
  </style>
  <div class="cf">
    <p class="cf-head">Anexo de conferência</p>
    <p class="cf-sub">Período: ${esc(period)} · emitido em ${esc(generatedAt)} · visível só para o administrador</p>
    <h2 class="section">Resumo</h2>
    <table class="data"><thead><tr><th>Nº</th><th>Pendência</th><th>Tipo</th><th class="n">Ocorrências</th></tr></thead>
    <tbody>
      ${conf.items.map(p => `<tr><td>${p.code}</td><td>${esc(p.title)}</td><td>${level(p)}</td><td class="n">${count(p)}</td></tr>`).join('')}
      <tr class="cf-tot"><td colspan="3">A corrigir: ${conf.fix} · A analisar: ${conf.review}</td><td class="n">${conf.fix + conf.review}</td></tr>
    </tbody></table>
    <p class="cf-note"><b>Corrigir</b>: o dado está errado ou incompleto e deve ser acertado antes da exportação. <b>Analisar</b>: pode estar certo; conferir e corrigir só se for erro.</p>
    ${pending.map(p => `
      <h3>${p.code} · ${esc(p.title)} (${p.count})</h3>
      <p class="cf-do"><b>O que fazer:</b> ${esc(p.action)}</p>
      ${table(p.cols, p.rows, p.num)}
      ${p.note ? `<p class="cf-note">${esc(p.note)}</p>` : ''}`).join('')}
  </div>`;
}
