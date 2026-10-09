// =============================================================================
// FATURAMENTO › Ordens de Fornecimento (lista)
// =============================================================================
import { supabase } from '../supabase.js';
import { esc, toast, fmtDate, fmtCNPJ, openModal, closeModal } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile } from '../auth.js';
import { exportXLSX, timestampFilename } from '../export.js';
import { fmtLiters, fmtAmount, ORDER_STATUS, billingError, isBillingMissing, withTimeout, nfMatches } from '../billing.js';
import { printSupplyOrder, printReceiptTerm } from '../billing_docs.js';
import { openTermModal, openCancelTermModal, openTermHistoryModal } from './faturamento_termo.js';

let _orders = [];
let _search = '';
let _filter = { dept: '', supplier: '', month: '', status: '' };
let _ctx = null;
// false quando o banco ainda não recebeu a parte do Termo de Recebimento
let _hasTerms = true;

const canWrite = () => ['admin', 'usuario', 'faturamento'].includes(getProfile()?.role);
const isSupplier = () => getProfile()?.role === 'fornecedor';
const activeTerm = (o) => (o.terms || []).find(t => t.status === 'emitido') || null;
const canceledTerms = (o) => (o.terms || []).filter(t => t.status === 'cancelado');
// O posto não vê termo; banco sem a parte do termo também não mostra a coluna
const showTerms = () => _hasTerms && !isSupplier();

export async function renderOrdersTab(container, ctx) {
  _ctx = ctx;
  container.innerHTML = `
    <div class="card" id="of-list-card">
      <div class="table-toolbar">
        <div class="search ${_search ? 'has-value' : ''}" id="of-search-box">
          ${icons.search}
          <input id="of-search" type="search" autocomplete="off" value="${esc(_search)}"
                 placeholder="Buscar por nº, secretaria, fornecedor, contrato, empenho, nota fiscal…">
          <button class="clear" id="of-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="of-count"></div>
        <div class="of-toolbar-actions">
          <button class="btn btn-outline btn-sm" id="of-export" hidden>
            <span style="width:14px;height:14px;display:inline-flex">${icons.download}</span> Exportar Excel
          </button>
          ${canWrite() ? `<button class="btn btn-primary btn-sm" id="of-new">
            <span style="width:14px;height:14px;display:inline-flex">${icons.plus}</span> Nova ordem
          </button>` : ''}
        </div>
      </div>
      <div class="filter-chips" id="of-filters" hidden>
        <select class="select chip" id="of-f-dept" aria-label="Secretaria"></select>
        <select class="select chip" id="of-f-supplier" aria-label="Contrato"></select>
        <input class="input chip" type="month" id="of-f-month" aria-label="Competência" value="${esc(_filter.month)}">
        <select class="select chip" id="of-f-status" aria-label="Situação">
          <option value="">Todas situações</option>
          <option value="emitida">Emitida</option>
          <option value="pendente">Empenho pendente</option>
          <option value="faturada">Faturada</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="of-f-clear" hidden>Limpar filtros</button>
      </div>
      <div id="of-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;
  bind(container);
  await load();
}

async function load() {
  const box = document.getElementById('of-tablebox');
  if (!box) return;
  const COLS = `
      id, department_id, supplier_id, number, year, seq, reference_month,
      period_start, period_end, issue_date, selection_mode, commitment_number, status,
      total_fuelings, total_liters,
      department_name_snapshot, department_acronym_snapshot,
      supplier_name_snapshot, supplier_cnpj_snapshot, contract_number_snapshot,
      cancel_reason, canceled_at, created_at,
      items:supply_order_item(fuel_label, fuelings_count, liters)`;
  const TERM_COLS = `,
      external_number,
      terms:receipt_term(id, number, status, invoice_number, invoice_series, invoice_date,
        issue_date, total_amount, fiscal_name, cancel_reason, canceled_at, created_at)`;
  const query = (cols) => withTimeout(supabase.from('supply_order').select(cols).order('created_at', { ascending: false }));
  let res;
  try {
    res = await query(COLS + TERM_COLS);
    _hasTerms = true;
    if (res.error && /receipt_term|relationship|external_number/i.test(res.error.message || '')) {
      _hasTerms = false;
      res = await query(COLS);
    }
  } catch (e) { res = { error: e }; }
  if (!box.isConnected) return;

  if (res.error) {
    _orders = [];
    box.innerHTML = stateHTML(icons.alert,
      isBillingMissing(res.error) ? 'Banco de dados ainda não atualizado' : 'Não foi possível carregar',
      billingError(res.error));
    return;
  }
  _orders = res.data || [];
  fillFilters();
  renderTable();
}

function stateHTML(icon, title, text, actionHTML = '') {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${esc(title)}</div>
    <p class="empty-state-text">${esc(text)}</p>
    ${actionHTML}
  </div>`;
}

// =============================================================================
// FILTROS
// =============================================================================
function fillFilters() {
  const bar = document.getElementById('of-filters');
  bar.hidden = !_orders.length;
  document.getElementById('of-export').hidden = !_orders.length || isSupplier();

  const depts = new Map(), sups = new Map();
  _orders.forEach(o => {
    depts.set(o.department_id, `${o.department_acronym_snapshot} — ${o.department_name_snapshot}`);
    sups.set(o.supplier_id, `${o.supplier_name_snapshot}${o.contract_number_snapshot ? ' · nº ' + o.contract_number_snapshot : ''} (${o.department_acronym_snapshot})`);
  });
  const opts = (map, first, sel) => `<option value="">${first}</option>` +
    [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, l]) => `<option value="${id}" ${id === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
  if (!depts.has(_filter.dept)) _filter.dept = '';
  if (!sups.has(_filter.supplier)) _filter.supplier = '';
  document.getElementById('of-f-dept').innerHTML = opts(depts, 'Todas secretarias', _filter.dept);
  document.getElementById('of-f-supplier').innerHTML = opts(sups, 'Todos contratos', _filter.supplier);
  document.getElementById('of-f-status').value = _filter.status;
  syncClear();
}
function syncClear() {
  const any = _filter.dept || _filter.supplier || _filter.month || _filter.status;
  document.getElementById('of-f-clear').hidden = !any;
}

function matches(o) {
  if (_filter.dept && o.department_id !== _filter.dept) return false;
  if (_filter.supplier && o.supplier_id !== _filter.supplier) return false;
  if (_filter.month) {                       // input month = 'AAAA-MM'; competência = 'MM/AAAA'
    const [y, m] = _filter.month.split('-');
    if (o.reference_month !== `${m}/${y}`) return false;
  }
  if (_filter.status === 'pendente') {
    if (!(o.status === 'emitida' && !o.commitment_number)) return false;
  } else if (_filter.status && o.status !== _filter.status) return false;
  if (!_search) return true;
  const t = _search.toLowerCase();
  // Nota fiscal: compara só os dígitos ("4512" acha "4.512" e "004512")
  if ((o.terms || []).some(x => nfMatches(x.invoice_number, _search))) return true;
  return [o.number, o.department_acronym_snapshot, o.department_name_snapshot, o.supplier_name_snapshot,
          o.contract_number_snapshot, o.commitment_number, o.reference_month, fmtCNPJ(o.supplier_cnpj_snapshot),
          ...(o.terms || []).map(t => t.invoice_number)]
    .some(v => String(v || '').toLowerCase().includes(t));
}

// =============================================================================
// TABELA
// =============================================================================
function renderTable() {
  const box = document.getElementById('of-tablebox');
  const count = document.getElementById('of-count');
  if (!box) return;

  if (!_orders.length) {
    count.textContent = '';
    box.innerHTML = stateHTML(icons.receipt, 'Nenhuma Ordem de Fornecimento',
      isSupplier()
        ? 'Quando a prefeitura emitir uma ordem para o seu posto, ela aparece aqui.'
        : 'Emita a primeira ordem a partir dos abastecimentos do período.',
      canWrite() ? `<button class="btn btn-primary" data-new style="margin-top:var(--s-4)">
        <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span> Nova ordem</button>` : '');
    return;
  }

  const list = _orders.filter(matches);
  const filtering = _search || _filter.dept || _filter.supplier || _filter.month || _filter.status;
  count.textContent = filtering ? `${list.length} de ${_orders.length} ordem(ns)` : `${_orders.length} ordem(ns)`;

  if (!list.length) {
    box.innerHTML = stateHTML(icons.search, 'Nenhum resultado', 'Nenhuma ordem corresponde à busca e aos filtros.');
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>Ordem</th>
          <th>Fornecedor</th>
          <th>Competência</th>
          <th>Quantidade</th>
          <th>Empenho</th>
          <th>Situação</th>
          ${showTerms() ? '<th>Termo</th>' : ''}
          <th class="actions-col">Ações</th>
        </tr></thead>
        <tbody>${list.map(rowHTML).join('')}</tbody>
      </table>
    </div>`;
}

/** "01/08 a 31/08/2026" quando o período fica no mesmo ano. */
function fmtPeriod(a, b) {
  const s = fmtDate(a), e = fmtDate(b);
  return String(a).slice(0, 4) === String(b).slice(0, 4) ? `${s.slice(0, 5)} a ${e}` : `${s} a ${e}`;
}

function rowHTML(o) {
  const st = ORDER_STATUS[o.status] || ORDER_STATUS.emitida;
  const items = [...(o.items || [])].sort((a, b) => String(a.fuel_label).localeCompare(String(b.fuel_label)));
  const editable = canWrite() && o.status === 'emitida';
  const term = activeTerm(o), old = canceledTerms(o);

  const empenho = isSupplier()
    ? esc(o.commitment_number || '—')
    : `<div class="of-empenho">
        ${o.commitment_number
          ? `<span class="of-mono">${esc(o.commitment_number)}</span>`
          : (o.status === 'emitida' ? `<span class="badge badge-warning">Pendente</span>` : '<span>—</span>')}
        ${editable ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="empenho" data-id="${o.id}"
            title="${o.commitment_number ? 'Alterar empenho' : 'Informar empenho'}">${icons.edit}</button>` : ''}
      </div>`;

  return `
    <tr ${o.status === 'cancelada' ? 'class="is-canceled"' : ''}>
      <td data-label="Ordem">
        <div class="cell-stack">
          <strong class="of-mono">${esc(o.number)}</strong>
          <span class="of-sub of-nowrap" title="${esc(o.department_name_snapshot)}"><b>${esc(o.department_acronym_snapshot)}</b> · ${esc(fmtDate(o.issue_date))}</span>
          ${o.external_number ? '<span class="of-sub" title="Ordem emitida em outro sistema; o número foi informado">nº informado</span>' : ''}
        </div>
      </td>
      <td data-label="Fornecedor" class="of-col-supplier">
        <div class="cell-stack">
          <span>${esc(o.supplier_name_snapshot)}</span>
          <span class="of-sub">${o.contract_number_snapshot ? 'Contrato nº ' + esc(o.contract_number_snapshot) : 'Sem nº de contrato'}</span>
        </div>
      </td>
      <td data-label="Competência">
        <div class="cell-stack">
          <span>${esc(o.reference_month)}</span>
          <span class="of-sub of-nowrap">${esc(fmtPeriod(o.period_start, o.period_end))}</span>
        </div>
      </td>
      <td data-label="Quantidade">
        <div class="cell-stack">
          <span class="of-nowrap"><strong>${fmtLiters(o.total_liters)} L</strong> · ${o.total_fuelings} abast.</span>
          <span class="of-sub">${items.map(i => `${esc(i.fuel_label)} ${fmtLiters(i.liters)} L`).join(' · ')}</span>
        </div>
      </td>
      <td data-label="Empenho">${empenho}</td>
      <td data-label="Situação">
        <div class="cell-stack">
          <span class="${st.badge}">${st.label}</span>
          ${o.status === 'cancelada' && o.cancel_reason ? `<span class="of-sub of-reason">${esc(o.cancel_reason)}</span>` : ''}
        </div>
      </td>
      ${showTerms() ? `<td data-label="Termo">${
        term ? `<div class="cell-stack">
            <span class="of-nowrap">NF ${esc(term.invoice_number)} · ${esc(fmtDate(term.invoice_date))}</span>
            <span class="of-sub of-amount">R$ ${fmtAmount(term.total_amount)}</span>
          </div>`
        : editable ? `<button class="btn btn-outline btn-sm of-act" data-act="term" data-id="${o.id}"
            title="Gerar o Termo de Recebimento desta ordem">${icons.fileCheck}<span>Gerar termo</span></button>`
        : '<span class="of-sub">—</span>'}</td>` : ''}
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="pdf" data-id="${o.id}" title="${o.external_number ? 'Abrir a relação de abastecimentos em PDF' : 'Abrir a ordem em PDF'}">${icons.printer}</button>
          ${term && showTerms() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="term-pdf" data-id="${o.id}"
              title="Abrir o Termo de Recebimento em PDF">${icons.fileCheck}</button>` : ''}
          ${old.length ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="term-history" data-id="${o.id}"
              title="${old.length} termo(s) cancelado(s) desta ordem">${icons.history}</button>` : ''}
          ${editable ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="cancel" data-id="${o.id}"
              title="Cancelar a ordem" style="color:var(--danger)">${icons.ban}</button>` : ''}
          ${term && canWrite() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="term-cancel" data-id="${o.id}"
              title="Cancelar o termo" style="color:var(--danger)">${icons.ban}</button>` : ''}
        </div>
      </td>
    </tr>`;
}

// =============================================================================
// EVENTOS
// =============================================================================
function bind(container) {
  const box = document.getElementById('of-search-box');
  container.addEventListener('input', (e) => {
    if (e.target.id !== 'of-search') return;
    _search = e.target.value || '';
    box.classList.toggle('has-value', !!_search);
    renderTable();
  });
  container.addEventListener('change', (e) => {
    const map = { 'of-f-dept': 'dept', 'of-f-supplier': 'supplier', 'of-f-month': 'month', 'of-f-status': 'status' };
    const key = map[e.target.id];
    if (!key) return;
    _filter[key] = e.target.value || '';
    syncClear();
    renderTable();
  });
  container.addEventListener('click', async (e) => {
    if (e.target.closest('#of-search-clear')) {
      _search = '';
      const input = document.getElementById('of-search');
      input.value = ''; box.classList.remove('has-value');
      renderTable(); input.focus();
      return;
    }
    if (e.target.closest('#of-f-clear')) {
      _filter = { dept: '', supplier: '', month: '', status: '' };
      document.getElementById('of-f-month').value = '';
      fillFilters(); renderTable();
      return;
    }
    if (e.target.closest('#of-new') || e.target.closest('[data-new]')) { _ctx?.goTab('new'); return; }
    if (e.target.closest('#of-export')) { exportList(); return; }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const o = _orders.find(x => x.id === btn.dataset.id);
    if (!o) return;
    if (btn.dataset.act === 'pdf') {
      btn.disabled = true;
      try { await printSupplyOrder(o.id); } finally { btn.disabled = false; }
    } else if (btn.dataset.act === 'term-pdf') {
      btn.disabled = true;
      try { await printReceiptTerm(activeTerm(o)?.id); } finally { btn.disabled = false; }
    } else if (btn.dataset.act === 'empenho') openCommitmentModal(o);
    else if (btn.dataset.act === 'cancel') openCancelModal(o);
    else if (btn.dataset.act === 'term') openTermModal(o, load);
    else if (btn.dataset.act === 'term-cancel') openCancelTermModal(o, activeTerm(o), load);
    else if (btn.dataset.act === 'term-history') openTermHistoryModal(o);
  });
}

function summaryHTML(o) {
  return `
    <div class="of-summary">
      <div><span>Ordem</span><strong class="of-mono">${esc(o.number)}</strong></div>
      <div><span>Secretaria</span><strong>${esc(o.department_acronym_snapshot)}</strong></div>
      <div><span>Fornecedor</span><strong>${esc(o.supplier_name_snapshot)}</strong></div>
      <div><span>Quantidade</span><strong>${fmtLiters(o.total_liters)} L · ${o.total_fuelings} abast.</strong></div>
    </div>`;
}

function openCommitmentModal(o) {
  const m = openModal({
    title: o.commitment_number ? 'Alterar empenho' : 'Informar empenho',
    body: `
      ${summaryHTML(o)}
      <form id="of-emp-form" autocomplete="off">
        <div class="field">
          <label class="field-label" for="of-emp-input">Nota de empenho nº</label>
          <input class="input" id="of-emp-input" maxlength="30" value="${esc(o.commitment_number || '')}" placeholder="ex: 2026/000123">
          <span class="field-help">Deixe em branco para voltar a "Pendente". O empenho é obrigatório para gerar o Termo de Recebimento.</span>
        </div>
        <div id="of-emp-error" class="login-error" style="display:none;margin-top:12px"></div>
      </form>`,
    footer: `<button class="btn btn-outline" data-cancel>Cancelar</button>
             <button class="btn btn-primary" id="of-emp-save">Salvar</button>`,
  });
  const input = m.querySelector('#of-emp-input');
  const save = async () => {
    const btn = m.querySelector('#of-emp-save'), errBox = m.querySelector('#of-emp-error');
    errBox.style.display = 'none';
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando';
    let error = null;
    try {
      ({ error } = await withTimeout(supabase.rpc('set_supply_order_commitment', { p_order: o.id, p_commitment: input.value.trim() })));
    } catch (e) { error = e; }
    if (error) {
      errBox.textContent = billingError(error); errBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Salvar';
      return;
    }
    closeModal();
    toast(input.value.trim() ? 'Empenho informado.' : 'Empenho removido.', 'success');
    await load();
  };
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#of-emp-save').addEventListener('click', save);
  m.querySelector('#of-emp-form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

function openCancelModal(o) {
  const m = openModal({
    title: 'Cancelar Ordem de Fornecimento',
    body: `
      ${summaryHTML(o)}
      <p class="of-modal-text">
        Os ${o.total_fuelings} abastecimentos voltam a ficar pendentes e podem entrar em outra ordem.
        O número <strong>${esc(o.number)}</strong> não será reaproveitado.
      </p>
      <div class="field">
        <label class="field-label" for="of-cancel-reason">Justificativa <span class="req">*</span></label>
        <textarea class="textarea" id="of-cancel-reason" rows="3" maxlength="300"
                  placeholder="ex: abastecimento lançado no veículo errado"></textarea>
      </div>
      <div id="of-cancel-error" class="login-error" style="display:none;margin-top:12px"></div>`,
    footer: `<button class="btn btn-outline" data-cancel>Voltar</button>
             <button class="btn btn-danger" id="of-cancel-ok">Cancelar a ordem</button>`,
  });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#of-cancel-ok').addEventListener('click', async () => {
    const btn = m.querySelector('#of-cancel-ok'), errBox = m.querySelector('#of-cancel-error');
    const reason = m.querySelector('#of-cancel-reason').value.trim();
    errBox.style.display = 'none';
    if (reason.length < 5) {
      errBox.textContent = 'Informe a justificativa do cancelamento.'; errBox.style.display = 'block';
      m.querySelector('#of-cancel-reason').focus();
      return;
    }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Cancelando';
    let error = null;
    try {
      ({ error } = await withTimeout(supabase.rpc('cancel_supply_order', { p_order: o.id, p_reason: reason })));
    } catch (e) { error = e; }
    if (error) {
      errBox.textContent = billingError(error); errBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Cancelar a ordem';
      return;
    }
    closeModal();
    toast(`Ordem ${o.number} cancelada.`, 'success');
    await load();
  });
}

function exportList() {
  const list = _orders.filter(matches);
  if (!list.length) { toast('Sem ordens para exportar.', 'warning'); return; }
  exportXLSX({
    filename: timestampFilename('ordens_de_fornecimento'),
    sheetName: 'Ordens de Fornecimento',
    columns: ['Nº', 'Numeração', 'Emissão', 'Sigla', 'Secretaria', 'Fornecedor', 'CNPJ', 'Contrato', 'Competência',
              'Período início', 'Período fim', 'Abastecimentos', 'Litros', 'Combustíveis', 'Empenho', 'Situação', 'Justificativa do cancelamento',
              'Nota fiscal', 'Série', 'Data da nota', 'Data do termo', 'Valor do termo (R$)', 'Fiscal', 'Termos cancelados'],
    rows: list.map(o => [o, activeTerm(o)]).map(([o, t]) => [
      o.number, o.external_number ? 'Informada' : 'Automática', fmtDate(o.issue_date), o.department_acronym_snapshot, o.department_name_snapshot,
      o.supplier_name_snapshot, fmtCNPJ(o.supplier_cnpj_snapshot), o.contract_number_snapshot || '',
      o.reference_month, fmtDate(o.period_start), fmtDate(o.period_end),
      o.total_fuelings, Number(o.total_liters),
      (o.items || []).map(i => `${i.fuel_label}: ${fmtLiters(i.liters)} L`).join(' | '),
      o.commitment_number || '', (ORDER_STATUS[o.status] || {}).label || o.status, o.cancel_reason || '',
      t?.invoice_number || '', t?.invoice_series || '', t ? fmtDate(t.invoice_date) : '', t ? fmtDate(t.issue_date) : '',
      t ? Number(t.total_amount) : '', t?.fiscal_name || '', canceledTerms(o).length || '',
    ]),
  });
  toast(`${list.length} ordem(ns) exportada(s).`, 'success');
}
