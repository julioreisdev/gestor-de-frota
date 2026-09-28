// =============================================================================
// FATURAMENTO › Nova Ordem de Fornecimento
// Secretaria → contrato → veículos → prévia → emitir.
// O estado fica no módulo: se a tela for redesenhada (voltar de outra aba do
// navegador, trocar de aba interna), a seleção do usuário é mantida.
// =============================================================================
import { supabase } from '../supabase.js';
import { esc, toast, fmtDate, formatPlate, confirmDialog } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile, isAdmin } from '../auth.js';
import {
  localToday, monthRange, previousMonthRange, fmtLiters, fmtInt,
  billingError, isBillingMissing, withTimeout,
} from '../billing.js';
import { printSupplyOrder } from '../billing_docs.js';

const st = {
  dept: '', start: '', end: '', issue: '', commitment: '',
  number: '',           // nº informado (cidade em que a ordem vem de outro sistema)
  contract: '', mode: 'contrato',
  selV: new Set(),      // veículos incluídos
  excl: new Set(),      // abastecimentos desmarcados (exceções)
  vSearch: '', detailsOpen: false,
  lastEmitted: null,    // { id, number, fuelings, liters }
};

let _root = null, _ctx = null;
let _depts = [], _startDate = null, _lockedDept = null;
let _contracts = [], _fuelings = [], _unbilled = null;
let _informed = false;         // numeração informada: a ordem é emitida em outro sistema
let _deptOrders = [];          // ordens da secretaria, para conferir o número informado
let _reqC = 0, _reqF = 0;      // descarta respostas de pedidos antigos
let _loadingC = false, _loadingF = false;

// =============================================================================
// ENTRY
// =============================================================================
export async function renderNewOrderTab(container, ctx) {
  _root = container; _ctx = ctx;

  let base;
  try {
    base = await withTimeout(Promise.all([
      supabase.from('department').select('id, acronym, name, cnpj, responsible_name, responsible_role').order('acronym'),
      supabase.from('entity').select('id, billing_start_date, billing_numbering').maybeSingle()
        .then(r => (r.error && /billing_numbering/.test(r.error.message || '')
          ? supabase.from('entity').select('id, billing_start_date').maybeSingle() : r)),
      getProfile()?.role === 'usuario' ? supabase.rpc('current_user_department_id') : Promise.resolve({ data: null }),
      supabase.rpc('billing_unbilled_summary'),
    ]));
  } catch (e) { base = [{ error: e }]; }
  if (!container.isConnected) return;

  const err = base.map(r => r?.error).find(Boolean);
  if (err) {
    container.innerHTML = stateCard(icons.alert,
      isBillingMissing(err) ? 'Banco de dados ainda não atualizado' : 'Não foi possível carregar',
      billingError(err));
    return;
  }
  const [d, e, locked, unbilled] = base;
  _startDate = e.data?.billing_start_date || null;
  _informed = e.data?.billing_numbering === 'informado';
  if (!_informed) st.number = '';
  _lockedDept = locked.data || null;
  _depts = (d.data || []).filter(x => !_lockedDept || x.id === _lockedDept);
  _unbilled = (unbilled.data || [])[0] || null;

  if (!_startDate) {
    container.innerHTML = `<div class="card">${noticeHTML('block',
      'Data de início do faturamento não definida',
      isAdmin()
        ? 'Defina a partir de que data os abastecimentos entram em Ordem de Fornecimento. Sem isso, nenhuma ordem pode ser emitida.'
        : 'Peça ao administrador para definir a data de início do faturamento na Configuração.',
      isAdmin() ? `<button class="btn btn-primary btn-sm" data-go="config">Abrir Configuração</button>` : '')}</div>`;
    container.querySelector('[data-go]')?.addEventListener('click', () => _ctx.goTab('config'));
    return;
  }
  if (!_depts.length) {
    container.innerHTML = stateCard(icons.briefcase, 'Nenhuma secretaria disponível', 'Cadastre as secretarias antes de faturar.');
    return;
  }

  // Padrões (só na primeira vez ou quando o valor guardado deixou de valer)
  if (!_depts.some(x => x.id === st.dept)) st.dept = _depts[0].id;
  if (!st.start || !st.end) {
    let p = previousMonthRange();
    if (p.end < _startDate) { p = monthRange(_startDate); p.start = _startDate; }
    else if (p.start < _startDate) p.start = _startDate;
    st.start = p.start; st.end = p.end;
  }
  if (!st.issue) st.issue = localToday();

  renderShell();
  bind();
  await Promise.all([loadContracts(), loadDeptOrders()]);
}

// ---- Número informado ----
const orderYear = () => Number(String(st.end || '').slice(0, 4)) || new Date().getFullYear();
const numKey = (n) => String(n || '').trim().toUpperCase();
const numValue = (n) => { const m = String(n || '').match(/\d+/); return m ? Number(m[0]) : null; };

async function loadDeptOrders() {
  if (!_informed || !st.dept) { _deptOrders = []; return; }
  const dept = st.dept;
  const { data, error } = await supabase.from('supply_order')
    .select('number, year, status, external_number, created_at')
    .eq('department_id', dept).order('created_at', { ascending: false });
  if (dept !== st.dept || !_root.isConnected) return;
  _deptOrders = error ? [] : (data || []);
  renderNumberHint(); renderPreview();
}
/** Ordens que ocupam número neste exercício: as ativas e as automáticas (mesmo canceladas). */
const takenOrders = () => _deptOrders.filter(o => Number(o.year) === orderYear() && (o.status !== 'cancelada' || !o.external_number));
const lastInformed = () => _deptOrders.find(o => Number(o.year) === orderYear() && o.external_number && o.status !== 'cancelada') || null;

/** Erro que impede registrar; '' quando o número pode ser usado. */
function numberError() {
  if (!_informed) return '';
  const n = st.number.trim();
  if (!n) return 'Informe o número da ordem emitida no outro sistema.';
  if (takenOrders().some(o => numKey(o.number) === numKey(n))) return `Já existe uma ordem nº ${n} nesta secretaria em ${orderYear()}.`;
  return '';
}
function renderNumberHint() {
  const box = document.getElementById('nof-number-hint');
  if (!box) return;
  const last = lastInformed(), n = st.number.trim();
  const err = n ? numberError() : '';
  const a = numValue(n), b = numValue(last?.number);
  document.getElementById('nof-number').classList.toggle('is-invalid', !!err);
  if (err) { box.className = 'field-error nof-number-hint'; box.textContent = err; return; }
  if (n && last && a != null && b != null && a < b) {
    box.className = 'field-help nof-number-hint nof-hint-warn';
    box.textContent = `Atenção: o nº ${n} é menor que o último informado nesta secretaria (${last.number}). Confira antes de registrar.`;
    return;
  }
  box.className = 'field-help nof-number-hint';
  box.textContent = last
    ? `Último nº de ordem informado nesta secretaria em ${orderYear()}: ${last.number}`
    : `Nenhuma ordem informada nesta secretaria em ${orderYear()}.`;
}

function stateCard(icon, title, text) {
  return `<div class="card"><div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${esc(title)}</div>
    <p class="empty-state-text">${esc(text)}</p>
  </div></div>`;
}

function noticeHTML(level, title, text, actions = '') {
  const icon = level === 'ok' ? icons.check : level === 'info' ? icons.info : icons.alert;
  return `
    <div class="nof-notice is-${level}">
      <span class="nof-notice-icon">${icon}</span>
      <div class="nof-notice-body"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>
      ${actions ? `<div class="nof-notice-actions">${actions}</div>` : ''}
    </div>`;
}

// =============================================================================
// ESTRUTURA FIXA (os campos não são redesenhados, para não perder o foco)
// =============================================================================
function renderShell() {
  const deptOptions = _depts.map(d =>
    `<option value="${d.id}" ${d.id === st.dept ? 'selected' : ''}>${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');

  _root.innerHTML = `
    <div id="nof-top"></div>

    <div class="card">
      <h2 class="cfg-title">1 · O que faturar</h2>
      <p class="cfg-help">A ordem reúne os abastecimentos de um contrato no período. Faturamento a partir de ${esc(fmtDate(_startDate))}.${_informed
        ? ' A Ordem de Fornecimento é emitida em outro sistema: informe o número dela.' : ''}</p>
      <div class="nof-fields ${_informed ? 'has-number' : ''}">
        <div class="field nof-f-dept">
          <label class="field-label" for="nof-dept">Secretaria</label>
          <select class="select" id="nof-dept" ${_lockedDept ? 'disabled' : ''}>${deptOptions}</select>
        </div>
        ${_informed ? `<div class="field nof-f-number">
          <label class="field-label" for="nof-number">Nº da ordem <span class="req">*</span></label>
          <input class="input" id="nof-number" maxlength="30" autocomplete="off" value="${esc(st.number)}" placeholder="ex: 045/2026"
                 aria-describedby="nof-number-hint">
        </div>` : ''}
        <div class="field">
          <label class="field-label" for="nof-start">Período de</label>
          <input class="input" type="date" id="nof-start" value="${esc(st.start)}">
        </div>
        <div class="field">
          <label class="field-label" for="nof-end">até</label>
          <input class="input" type="date" id="nof-end" value="${esc(st.end)}">
        </div>
        <div class="field">
          <label class="field-label" for="nof-issue">Data de emissão</label>
          <input class="input" type="date" id="nof-issue" value="${esc(st.issue)}">
        </div>
        <div class="field">
          <label class="field-label" for="nof-commitment">Empenho <span class="nof-opt">(opcional)</span></label>
          <input class="input" id="nof-commitment" maxlength="30" value="${esc(st.commitment)}" placeholder="ex: 2026/000123">
        </div>
      </div>
      ${_informed ? '<p class="field-help nof-number-hint" id="nof-number-hint"></p>' : ''}
      <div id="nof-period-msg"></div>
      <div class="nof-label">Contratos da secretaria</div>
      <div id="nof-contracts"></div>
    </div>

    <div class="nof-main">
      <div class="card" id="nof-veh-card">
        <h2 class="cfg-title">2 · Veículos com abastecimentos pendentes</h2>
        <div class="nof-veh-tools">
          <div class="segmented" role="group" aria-label="Selecionar veículos por">
            <button type="button" class="seg-btn" data-mode="contrato">Todos os veículos</button>
            <button type="button" class="seg-btn" data-mode="veiculos">Escolher veículos</button>
          </div>
          <div class="table-toolbar nof-veh-search">
            <div class="search ${st.vSearch ? 'has-value' : ''}" id="nof-vsearch-box">
              ${icons.search}
              <input id="nof-vsearch" type="search" placeholder="Buscar placa ou modelo…" autocomplete="off" value="${esc(st.vSearch)}">
              <button class="clear" id="nof-vsearch-clear" aria-label="Limpar busca">${icons.close}</button>
            </div>
          </div>
        </div>
        <div id="nof-vehicles"></div>
      </div>

      <div class="card" id="nof-prev-card">
        <h2 class="cfg-title">3 · Prévia da ordem</h2>
        <div id="nof-preview"></div>
      </div>
    </div>
  `;
  renderTop();
  renderNumberHint();
}

function renderTop() {
  const box = document.getElementById('nof-top');
  if (!box) return;
  const parts = [];
  if (st.lastEmitted) {
    const o = st.lastEmitted;
    parts.push(`<div class="card">${noticeHTML('ok',
      `Ordem de Fornecimento ${o.number} ${o.informed ? 'registrada' : 'emitida'}`,
      `${fmtInt(o.fuelings)} abastecimentos · ${fmtLiters(o.liters)} L. Os abastecimentos ficaram vinculados à ordem e não podem mais ser alterados.`,
      `<button class="btn btn-primary btn-sm" data-open-pdf="${o.id}">
         <span style="width:14px;height:14px;display:inline-flex">${icons.printer}</span> ${o.informed ? 'Abrir relação em PDF' : 'Abrir PDF'}</button>
       <button class="btn btn-outline btn-sm" data-go="orders">Ver ordens</button>
       <button class="btn btn-ghost btn-sm" data-dismiss>Fechar</button>`)}</div>`);
  }
  if (_unbilled?.fuelings > 0 && _unbilled.oldest && _unbilled.oldest < st.start) {
    parts.push(`<div class="card">${noticeHTML('info',
      `${fmtInt(_unbilled.fuelings)} abastecimentos de meses encerrados ainda sem ordem`,
      `O mais antigo é de ${fmtDate(_unbilled.oldest)}, anterior ao período escolhido.`,
      `<button class="btn btn-outline btn-sm" data-from="${esc(_unbilled.oldest)}">Incluir desde ${esc(fmtDate(_unbilled.oldest))}</button>`)}</div>`);
  }
  box.innerHTML = parts.join('');
}

// =============================================================================
// DADOS
// =============================================================================
function periodError() {
  if (!st.start || !st.end) return 'Informe o início e o fim do período.';
  if (st.end < st.start) return 'O fim do período não pode ser anterior ao início.';
  return '';
}

async function loadContracts() {
  const msg = document.getElementById('nof-period-msg');
  const perr = periodError();
  msg.innerHTML = perr ? `<p class="nof-error">${esc(perr)}</p>` : '';
  if (perr) { _contracts = []; _fuelings = []; renderContracts(); renderVehicles(); renderPreview(); return; }

  const req = ++_reqC;
  _loadingC = true; renderContracts();
  let res;
  try {
    res = await withTimeout(supabase.rpc('billing_pending_contracts', { p_department: st.dept, p_start: st.start, p_end: st.end }));
  } catch (e) { res = { error: e }; }
  if (req !== _reqC || !_root.isConnected) return;
  _loadingC = false;

  if (res.error) {
    _contracts = []; _fuelings = [];
    document.getElementById('nof-contracts').innerHTML = `<p class="nof-error">${esc(billingError(res.error))}</p>`;
    renderVehicles(); renderPreview();
    return;
  }
  _contracts = res.data || [];
  if (!_contracts.some(c => c.supplier_id === st.contract)) {
    st.contract = (_contracts.find(c => c.fuelings > 0) || _contracts[0])?.supplier_id || '';
    resetSelection();
  }
  renderContracts();
  await loadFuelings();
}

async function loadFuelings() {
  if (!st.contract) { _fuelings = []; renderVehicles(); renderPreview(); return; }
  const req = ++_reqF;
  _loadingF = true; renderVehicles(); renderPreview();
  let res;
  try {
    res = await withTimeout(supabase.rpc('billing_pending_fuelings', { p_supplier: st.contract, p_start: st.start, p_end: st.end }));
  } catch (e) { res = { error: e }; }
  if (req !== _reqF || !_root.isConnected) return;
  _loadingF = false;

  if (res.error) {
    _fuelings = [];
    document.getElementById('nof-vehicles').innerHTML = `<p class="nof-error">${esc(billingError(res.error))}</p>`;
    renderPreview();
    return;
  }
  _fuelings = res.data || [];
  // Mantém só o que ainda existe
  const vIds = new Set(_fuelings.map(f => f.vehicle_id)), fIds = new Set(_fuelings.map(f => f.fueling_id));
  st.selV = new Set([...st.selV].filter(id => vIds.has(id)));
  st.excl = new Set([...st.excl].filter(id => fIds.has(id)));
  if (st.mode === 'contrato') st.selV = vIds;
  renderVehicles(); renderPreview();
}

function resetSelection() { st.selV = new Set(); st.excl = new Set(); st.vSearch = ''; }

function vehicles() {
  const map = new Map();
  _fuelings.forEach(f => {
    let v = map.get(f.vehicle_id);
    if (!v) { v = { id: f.vehicle_id, plate: f.plate, model: f.vehicle_model || '', fuels: new Set(), n: 0, liters: 0 }; map.set(f.vehicle_id, v); }
    v.fuels.add(f.fuel_label); v.n++; v.liters += Number(f.liters);
  });
  return [...map.values()].sort((a, b) => a.plate.localeCompare(b.plate));
}
const included = () => _fuelings.filter(f => st.selV.has(f.vehicle_id));
const finalList = () => included().filter(f => !st.excl.has(f.fueling_id));
const deptObj = () => _depts.find(d => d.id === st.dept);
const contractObj = () => _contracts.find(c => c.supplier_id === st.contract);

// =============================================================================
// RENDER DINÂMICO
// =============================================================================
function renderContracts() {
  const box = document.getElementById('nof-contracts');
  if (!box) return;
  if (_loadingC && !_contracts.length) {
    box.innerHTML = `<div class="skeleton skeleton-line w-60"></div>`;
    return;
  }
  if (!_contracts.length) {
    box.innerHTML = periodError() ? '' : `<p class="cfg-empty">Esta secretaria não tem contrato de combustível cadastrado. Cadastre o posto em Fornecedores, com a secretaria e o nº do contrato.</p>`;
    return;
  }
  box.innerHTML = `<div class="nof-contracts">${_contracts.map(c => {
    const on = c.supplier_id === st.contract, empty = !c.fuelings;
    return `
      <button type="button" class="nof-contract ${on ? 'is-on' : ''} ${empty ? 'is-empty' : ''}" data-contract="${c.supplier_id}" aria-pressed="${on}">
        <strong>${c.contract_number ? 'Contrato nº ' + esc(c.contract_number) : 'Contrato sem número'}</strong>
        <span class="nof-contract-name">${esc(c.legal_name)}</span>
        <span class="nof-contract-total">${empty
          ? 'Nada pendente no período'
          : `${fmtInt(c.fuelings)} abast. · ${fmtLiters(c.liters)} L · ${fmtInt(c.vehicles)} veíc.`}</span>
        ${empty ? '' : `<span class="nof-contract-fuels">${(c.fuels || []).map(f => `<span class="badge badge-neutral">${esc(f)}</span>`).join('')}</span>`}
      </button>`;
  }).join('')}</div>`;
}

/** Veículos que batem com a busca (placa com ou sem hífen, ou modelo). */
function filterVehicles(all) {
  const t = st.vSearch.trim().toLowerCase();
  if (!t) return all;
  return all.filter(v => v.plate.toLowerCase().includes(t.replace(/-/g, ''))
    || formatPlate(v.plate).toLowerCase().includes(t)
    || (v.model || '').toLowerCase().includes(t));
}

function renderVehicles() {
  const box = document.getElementById('nof-vehicles');
  if (!box) return;
  document.querySelectorAll('#nof-veh-card [data-mode]').forEach(b => {
    const on = b.dataset.mode === st.mode;
    b.classList.toggle('active', on); b.setAttribute('aria-pressed', on);
  });
  if (_loadingF && !_fuelings.length) {
    box.innerHTML = `<div class="skeleton skeleton-line w-80"></div><div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>`;
    return;
  }
  const all = vehicles();
  if (!all.length) {
    box.innerHTML = `<div class="empty-state nof-empty">
      <div class="empty-state-icon">${icons.check}</div>
      <div class="empty-state-title">Nada pendente</div>
      <p class="empty-state-text">${st.contract ? 'Este contrato não tem abastecimentos sem ordem no período.' : 'Escolha um contrato.'}</p>
    </div>`;
    return;
  }
  const list = filterVehicles(all);
  if (!list.length) {
    box.innerHTML = `<div class="empty-state nof-empty">
      <div class="empty-state-icon">${icons.search}</div>
      <div class="empty-state-title">Nenhum veículo encontrado</div>
      <p class="empty-state-text">Nada encontrado para "<strong>${esc(st.vSearch)}</strong>".</p>
    </div>`;
    return;
  }
  const allOn = list.every(v => st.selV.has(v.id)), someOn = list.some(v => st.selV.has(v.id));
  const nOn = all.filter(v => st.selV.has(v.id)).length;
  box.innerHTML = `
    <div class="nof-selbar">
      <span><strong>${fmtInt(nOn)}</strong> de ${fmtInt(all.length)} veículo(s) na ordem</span>
      <span class="nof-selbar-actions">
        <button type="button" class="nof-link" data-sel="all" ${allOn ? 'disabled' : ''}>Marcar todos</button>
        <button type="button" class="nof-link" data-sel="none" ${someOn ? '' : 'disabled'}>Desmarcar todos</button>
      </span>
    </div>
    <div class="table-wrap">
      <table class="table nof-table">
        <thead><tr>
          <th class="nof-check"><input type="checkbox" id="nof-all" ${allOn ? 'checked' : ''} aria-label="Marcar todos os veículos"></th>
          <th>Placa</th><th>Veículo</th><th>Combustível</th><th class="num">Abast.</th><th class="num">Litros</th>
        </tr></thead>
        <tbody>${list.map(v => {
          const on = st.selV.has(v.id);
          return `<tr class="${on ? '' : 'is-off'}">
            <td class="nof-check" data-label="Incluir"><input type="checkbox" data-veh="${v.id}" ${on ? 'checked' : ''} aria-label="Incluir ${esc(formatPlate(v.plate))}"></td>
            <td data-label="Placa"><strong class="of-mono">${esc(formatPlate(v.plate))}</strong></td>
            <td data-label="Veículo">${esc(v.model || '—')}</td>
            <td data-label="Combustível">${esc([...v.fuels].join(', '))}</td>
            <td data-label="Abast." class="num">${fmtInt(v.n)}</td>
            <td data-label="Litros" class="num">${fmtLiters(v.liters)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  const allBox = document.getElementById('nof-all');
  if (allBox) allBox.indeterminate = !allOn && someOn;
}

function issueError(list) {
  if (!st.issue) return 'Informe a data de emissão.';
  if (st.issue > localToday()) return 'A data de emissão não pode ser futura.';
  const last = list.reduce((m, f) => (f.fueling_date > m ? f.fueling_date : m), '');
  if (last && st.issue < last) return `A data de emissão não pode ser anterior ao último abastecimento da ordem (${fmtDate(last)}).`;
  return '';
}

function renderPreview() {
  const box = document.getElementById('nof-preview');
  if (!box) return;
  const inc = included(), fin = finalList();
  const byFuel = new Map();
  fin.forEach(f => {
    const g = byFuel.get(f.fuel_label) || { label: f.fuel_label, n: 0, liters: 0 };
    g.n++; g.liters += Number(f.liters); byFuel.set(f.fuel_label, g);
  });
  const items = [...byFuel.values()].sort((a, b) => a.label.localeCompare(b.label));
  const liters = fin.reduce((s, f) => s + Number(f.liters), 0);
  const nVeh = new Set(fin.map(f => f.vehicle_id)).size;

  const d = deptObj(), c = contractObj();
  const missing = [];
  if (d && !d.cnpj) missing.push('CNPJ');
  if (d && !d.responsible_name) missing.push('responsável');
  if (d && !d.responsible_role) missing.push('cargo do responsável');
  const err = fin.length ? (issueError(fin) || numberError()) : '';

  box.innerHTML = `
    <div class="nof-kpis">
      <div class="nof-kpi"><span>Veículos</span><strong>${fmtInt(nVeh)}</strong></div>
      <div class="nof-kpi"><span>Abastecimentos</span><strong>${fmtInt(fin.length)}</strong></div>
      <div class="nof-kpi"><span>Litros</span><strong>${fmtLiters(liters)}</strong></div>
    </div>

    ${fin.length ? `
    <div class="table-wrap">
      <table class="table nof-table">
        <thead><tr><th>Combustível</th><th class="num">Abast.</th><th class="num">Litros</th></tr></thead>
        <tbody>
          ${items.map(i => `<tr><td data-label="Combustível">${esc(i.label)}</td><td data-label="Abast." class="num">${fmtInt(i.n)}</td><td data-label="Litros" class="num">${fmtLiters(i.liters)}</td></tr>`).join('')}
          <tr class="nof-total"><td data-label="Combustível">Total</td><td data-label="Abast." class="num">${fmtInt(fin.length)}</td><td data-label="Litros" class="num">${fmtLiters(liters)}</td></tr>
        </tbody>
      </table>
    </div>` : `<p class="cfg-empty nof-prev-empty">${_fuelings.length ? 'Marque pelo menos um veículo para montar a ordem.' : 'Sem abastecimentos para faturar.'}</p>`}

    ${inc.length ? `
    <details class="nof-details" ${st.detailsOpen ? 'open' : ''}>
      <summary>Abastecimentos incluídos: ${fmtInt(fin.length)} de ${fmtInt(inc.length)} <span>desmarque só as exceções</span></summary>
      <div class="nof-details-list">
        ${inc.map(f => {
          const off = st.excl.has(f.fueling_id);
          return `<label class="nof-fueling ${off ? 'is-off' : ''}">
            <input type="checkbox" data-fueling="${f.fueling_id}" ${off ? '' : 'checked'}>
            <span class="nof-fueling-main">
              <span>${esc(fmtDate(f.fueling_date))}</span>
              <span class="of-mono">${esc(formatPlate(f.plate))}</span>
              <span class="of-mono">${esc(f.authorization_number || 'manual')}</span>
              <span class="nof-fueling-fuel">${esc(f.fuel_label)}</span>
            </span>
            <span class="nof-fueling-l">${fmtLiters(f.liters)} L</span>
          </label>`;
        }).join('')}
      </div>
    </details>` : ''}

    ${missing.length && fin.length ? `<p class="nof-warn">
      <span class="nof-warn-icon">${icons.info}</span>
      <span>${esc(d.acronym)} está sem ${esc(missing.join(', '))}: esses campos saem como "—" na ordem.
      ${isAdmin() ? '<button type="button" class="nof-link" data-go="config">Preencher na Configuração</button>' : ''}</span>
    </p>` : ''}
    ${err ? `<p class="nof-error">${esc(err)}</p>` : ''}

    <div class="nof-emit">
      <span class="nof-emit-text">${fin.length && c
        ? `${esc(d?.acronym || '')} · ${c.contract_number ? 'Contrato nº ' + esc(c.contract_number) : esc(c.legal_name)}`
        : ''}</span>
      <button type="button" class="btn btn-primary" id="nof-emit" ${fin.length && !err ? '' : 'disabled'}>
        <span style="width:16px;height:16px;display:inline-flex">${icons.receipt}</span> ${_informed ? 'Registrar ordem' : 'Emitir ordem'}
      </button>
    </div>`;
}

// =============================================================================
// EVENTOS
// =============================================================================
function bind() {
  _root.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'nof-dept') { st.dept = el.value; st.contract = ''; resetSelection(); syncSearchBox(); loadContracts(); loadDeptOrders(); return; }
    if (el.id === 'nof-start' || el.id === 'nof-end') {
      st[el.id === 'nof-start' ? 'start' : 'end'] = el.value;
      renderTop(); renderNumberHint(); loadContracts();
      return;
    }
    if (el.id === 'nof-issue') { st.issue = el.value; renderPreview(); return; }
    if (el.id === 'nof-all') {
      filterVehicles(vehicles()).forEach(v => (el.checked ? st.selV.add(v.id) : st.selV.delete(v.id)));
      st.mode = 'veiculos';
      renderVehicles(); renderPreview();
      return;
    }
    if (el.dataset.veh) {
      el.checked ? st.selV.add(el.dataset.veh) : st.selV.delete(el.dataset.veh);
      st.mode = 'veiculos';
      renderVehicles(); renderPreview();
      return;
    }
    if (el.dataset.fueling) {
      el.checked ? st.excl.delete(el.dataset.fueling) : st.excl.add(el.dataset.fueling);
      st.detailsOpen = true;
      renderPreview();
    }
  });

  _root.addEventListener('input', (e) => {
    if (e.target.id === 'nof-commitment') { st.commitment = e.target.value; return; }
    if (e.target.id === 'nof-number') { st.number = e.target.value; renderNumberHint(); renderPreview(); return; }
    if (e.target.id === 'nof-vsearch') { st.vSearch = e.target.value || ''; syncSearchBox(); renderVehicles(); }
  });

  // <details> não borbulha "toggle": escuta na fase de captura
  _root.addEventListener('toggle', (e) => {
    if (e.target.classList?.contains('nof-details')) st.detailsOpen = e.target.open;
  }, true);

  _root.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-contract]');
    if (c) {
      if (c.dataset.contract === st.contract) return;
      st.contract = c.dataset.contract; resetSelection(); st.mode = 'contrato'; syncSearchBox();
      renderContracts(); await loadFuelings();
      return;
    }
    const m = e.target.closest('[data-mode]');
    if (m) {
      st.mode = m.dataset.mode; st.excl = new Set();
      st.selV = st.mode === 'contrato' ? new Set(_fuelings.map(f => f.vehicle_id)) : new Set();
      renderVehicles(); renderPreview();
      return;
    }
    const sel = e.target.closest('[data-sel]');
    if (sel) {
      const on = sel.dataset.sel === 'all';
      filterVehicles(vehicles()).forEach(v => (on ? st.selV.add(v.id) : st.selV.delete(v.id)));
      st.mode = 'veiculos';
      renderVehicles(); renderPreview();
      return;
    }
    if (e.target.closest('#nof-vsearch-clear')) {
      st.vSearch = ''; syncSearchBox(); renderVehicles();
      document.getElementById('nof-vsearch').focus();
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) { _ctx.goTab(go.dataset.go); return; }
    const from = e.target.closest('[data-from]');
    if (from) {
      st.start = from.dataset.from;
      document.getElementById('nof-start').value = st.start;
      renderTop(); await loadContracts();
      return;
    }
    const pdf = e.target.closest('[data-open-pdf]');
    if (pdf) {
      pdf.disabled = true;
      try { await printSupplyOrder(pdf.dataset.openPdf); } finally { pdf.disabled = false; }
      return;
    }
    if (e.target.closest('[data-dismiss]')) { st.lastEmitted = null; renderTop(); return; }
    if (e.target.closest('#nof-emit')) emit();
  });
}

function syncSearchBox() {
  const input = document.getElementById('nof-vsearch'), box = document.getElementById('nof-vsearch-box');
  if (!input) return;
  if (input.value !== st.vSearch) input.value = st.vSearch;
  box.classList.toggle('has-value', !!st.vSearch);
}

async function emit() {
  const fin = finalList();
  if (!fin.length) return;
  const err = issueError(fin) || numberError();
  if (err) { toast(err, 'error'); return; }
  const d = deptObj(), c = contractObj();
  const number = st.number.trim();
  const liters = fin.reduce((s, f) => s + Number(f.liters), 0);
  const nVeh = new Set(fin.map(f => f.vehicle_id)).size;

  const ok = await confirmDialog({
    title: _informed ? `Registrar Ordem de Fornecimento nº ${number}` : 'Emitir Ordem de Fornecimento',
    message: `${d.acronym} · ${c.legal_name}${c.contract_number ? ' · contrato nº ' + c.contract_number : ''}. `
      + `${fmtInt(fin.length)} abastecimentos de ${fmtInt(nVeh)} veículo(s), ${fmtLiters(liters)} litros, `
      + `de ${fmtDate(st.start)} a ${fmtDate(st.end)}. `
      + (_informed ? 'Depois de registrada' : 'Depois de emitida') + ', esses abastecimentos não poderão ser alterados nem excluídos.',
    confirmText: _informed ? 'Registrar ordem' : 'Emitir ordem',
  });
  if (!ok) return;

  const btn = document.getElementById('nof-emit');
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${_informed ? 'Registrando' : 'Emitindo'}`; }
  let res;
  try {
    res = await withTimeout(supabase.rpc('emit_supply_order', {
      p_supplier: st.contract, p_start: st.start, p_end: st.end,
      p_mode: st.mode, p_fueling_ids: fin.map(f => f.fueling_id),
      p_commitment: st.commitment.trim() || null, p_issue_date: st.issue,
      ...(_informed ? { p_number: number } : {}),   // só quando a cidade usa número informado
    }), 30000);
  } catch (e) { res = { error: e }; }

  if (res.error) {
    toast(billingError(res.error), 'error', 7000);
    await Promise.all([loadContracts(), loadDeptOrders()]);   // a lista pode ter mudado (outra pessoa emitiu)
    return;
  }
  const id = res.data;
  const { data: o } = await supabase.from('supply_order').select('id, number, total_fuelings, total_liters').eq('id', id).maybeSingle();
  st.lastEmitted = { id, number: o?.number || number, fuelings: o?.total_fuelings ?? fin.length, liters: o?.total_liters ?? liters, informed: _informed };
  st.commitment = ''; st.number = ''; st.excl = new Set(); st.detailsOpen = false;
  const inp = document.getElementById('nof-commitment'); if (inp) inp.value = '';
  const num = document.getElementById('nof-number'); if (num) num.value = '';
  toast(`Ordem ${st.lastEmitted.number} ${_informed ? 'registrada' : 'emitida'}.`, 'success');

  const { data: u } = await supabase.rpc('billing_unbilled_summary');
  _unbilled = (u || [])[0] || null;
  renderTop();
  document.getElementById('nof-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await Promise.all([loadContracts(), loadDeptOrders()]);
}
