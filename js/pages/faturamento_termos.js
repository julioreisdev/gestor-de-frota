// =============================================================================
// FATURAMENTO › Termos de Recebimento (lista)
// Para achar o termo pela nota fiscal: a busca compara só os dígitos do número.
// =============================================================================
import { supabase } from '../supabase.js';
import { esc, fmtDate, fmtCNPJ } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile } from '../auth.js';
import { fmtAmount, TERM_STATUS, billingError, isBillingMissing, withTimeout, nfMatches } from '../billing.js';
import { printReceiptTerm } from '../billing_docs.js';
import { openCancelTermModal } from './faturamento_termo.js';

let _terms = [];
let _search = '';
let _filter = { dept: '', status: '' };
let _ctx = null;

const canWrite = () => ['admin', 'usuario', 'faturamento'].includes(getProfile()?.role);

export async function renderTermsTab(container, ctx) {
  _ctx = ctx;
  container.innerHTML = `
    <div class="card" id="trl-card">
      <div class="table-toolbar">
        <div class="search ${_search ? 'has-value' : ''}" id="trl-search-box">
          ${icons.search}
          <input id="trl-search" type="search" autocomplete="off" value="${esc(_search)}"
                 placeholder="Buscar por nº da nota fiscal, termo, fornecedor, secretaria, empenho…">
          <button class="clear" id="trl-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="trl-count"></div>
      </div>
      <div class="filter-chips" id="trl-filters" hidden>
        <select class="select chip" id="trl-f-dept" aria-label="Secretaria"></select>
        <select class="select chip" id="trl-f-status" aria-label="Situação">
          <option value="">Todas situações</option>
          <option value="emitido">Emitido</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="trl-f-clear" hidden>Limpar filtros</button>
      </div>
      <div id="trl-tablebox">
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
  const box = document.getElementById('trl-tablebox');
  if (!box) return;
  let res;
  try {
    res = await withTimeout(supabase.from('receipt_term')
      .select(`id, number, status, invoice_number, invoice_series, invoice_date, issue_date, total_amount,
               commitment_number, fiscal_name, cancel_reason, canceled_at, created_at,
               order:supply_order_id(id, number, status, department_id, department_acronym_snapshot,
                 department_name_snapshot, supplier_name_snapshot, supplier_cnpj_snapshot,
                 contract_number_snapshot, reference_month, total_fuelings)`)
      .order('created_at', { ascending: false }));
  } catch (e) { res = { error: e }; }
  if (!box.isConnected) return;

  if (res.error) {
    _terms = [];
    const missing = isBillingMissing(res.error) || /receipt_term|relationship/i.test(res.error.message || '');
    box.innerHTML = stateHTML(icons.alert,
      missing ? 'Banco de dados ainda não atualizado' : 'Não foi possível carregar',
      missing ? 'Execute o arquivo apply.sql no Supabase e recarregue a página.' : billingError(res.error));
    return;
  }
  _terms = (res.data || []).filter(t => t.order);
  fillFilters();
  renderTable();
}

function stateHTML(icon, title, text) {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${esc(title)}</div>
    <p class="empty-state-text">${esc(text)}</p>
  </div>`;
}

function fillFilters() {
  document.getElementById('trl-filters').hidden = !_terms.length;
  const depts = new Map();
  _terms.forEach(t => depts.set(t.order.department_id, `${t.order.department_acronym_snapshot} — ${t.order.department_name_snapshot}`));
  if (!depts.has(_filter.dept)) _filter.dept = '';
  document.getElementById('trl-f-dept').innerHTML = '<option value="">Todas secretarias</option>' +
    [...depts.entries()].sort((a, b) => a[1].localeCompare(b[1]))
      .map(([id, l]) => `<option value="${id}" ${id === _filter.dept ? 'selected' : ''}>${esc(l)}</option>`).join('');
  document.getElementById('trl-f-status').value = _filter.status;
  syncClear();
}
function syncClear() {
  document.getElementById('trl-f-clear').hidden = !(_filter.dept || _filter.status);
}

function matches(t) {
  const o = t.order;
  if (_filter.dept && o.department_id !== _filter.dept) return false;
  if (_filter.status && t.status !== _filter.status) return false;
  if (!_search) return true;
  // Nota fiscal: só dígitos, sem zeros à esquerda ("4512" acha "4.512" e "004512")
  if (nfMatches(t.invoice_number, _search)) return true;
  const s = _search.toLowerCase();
  return [t.number, t.invoice_number, t.commitment_number, t.fiscal_name, o.number,
          o.department_acronym_snapshot, o.department_name_snapshot, o.supplier_name_snapshot,
          o.contract_number_snapshot, o.reference_month, fmtCNPJ(o.supplier_cnpj_snapshot)]
    .some(v => String(v || '').toLowerCase().includes(s));
}

function renderTable() {
  const box = document.getElementById('trl-tablebox');
  const count = document.getElementById('trl-count');
  if (!box) return;

  if (!_terms.length) {
    count.textContent = '';
    box.innerHTML = stateHTML(icons.fileCheck, 'Nenhum Termo de Recebimento',
      'O termo é gerado na lista de Ordens de Fornecimento, quando a nota fiscal chega.');
    return;
  }
  const list = _terms.filter(matches);
  const filtering = _search || _filter.dept || _filter.status;
  count.textContent = filtering ? `${list.length} de ${_terms.length} termo(s)` : `${_terms.length} termo(s)`;
  if (!list.length) {
    box.innerHTML = stateHTML(icons.search, 'Nenhum resultado', 'Nenhum termo corresponde à busca e aos filtros.');
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>Termo</th>
          <th>Nota fiscal</th>
          <th>Fornecedor</th>
          <th>Competência</th>
          <th>Valor</th>
          <th>Situação</th>
          <th class="actions-col">Ações</th>
        </tr></thead>
        <tbody>${list.map(rowHTML).join('')}</tbody>
      </table>
    </div>`;
}

function rowHTML(t) {
  const o = t.order;
  const st = TERM_STATUS[t.status] || TERM_STATUS.emitido;
  const active = t.status === 'emitido';
  return `
    <tr ${active ? '' : 'class="is-canceled"'}>
      <td data-label="Termo">
        <div class="cell-stack">
          <strong class="of-mono">${esc(t.number)}</strong>
          <span class="of-sub of-nowrap" title="${esc(o.department_name_snapshot)}"><b>${esc(o.department_acronym_snapshot)}</b> · ${esc(fmtDate(t.issue_date))}</span>
        </div>
      </td>
      <td data-label="Nota fiscal">
        <div class="cell-stack">
          <strong class="of-mono">${esc(t.invoice_number)}${t.invoice_series ? ' · série ' + esc(t.invoice_series) : ''}</strong>
          <span class="of-sub of-nowrap">${esc(fmtDate(t.invoice_date))}</span>
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
          <span class="of-sub of-nowrap">Empenho ${esc(t.commitment_number || '—')}</span>
        </div>
      </td>
      <td data-label="Valor"><span class="of-amount of-nowrap">R$ ${fmtAmount(t.total_amount)}</span></td>
      <td data-label="Situação">
        <div class="cell-stack">
          <span class="${st.badge}">${st.label}</span>
          ${!active && t.cancel_reason ? `<span class="of-sub of-reason">${esc(t.cancel_reason)}</span>` : ''}
        </div>
      </td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="pdf" data-id="${t.id}"
                  title="Abrir o Termo de Recebimento em PDF">${icons.printer}</button>
          ${active && canWrite() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="cancel" data-id="${t.id}"
              title="Cancelar o termo" style="color:var(--danger)">${icons.ban}</button>` : ''}
        </div>
      </td>
    </tr>`;
}

function bind(container) {
  const box = document.getElementById('trl-search-box');
  container.addEventListener('input', (e) => {
    if (e.target.id !== 'trl-search') return;
    _search = e.target.value || '';
    box.classList.toggle('has-value', !!_search);
    renderTable();
  });
  container.addEventListener('change', (e) => {
    const key = { 'trl-f-dept': 'dept', 'trl-f-status': 'status' }[e.target.id];
    if (!key) return;
    _filter[key] = e.target.value || '';
    syncClear();
    renderTable();
  });
  container.addEventListener('click', async (e) => {
    if (e.target.closest('#trl-search-clear')) {
      _search = '';
      const input = document.getElementById('trl-search');
      input.value = ''; box.classList.remove('has-value');
      renderTable(); input.focus();
      return;
    }
    if (e.target.closest('#trl-f-clear')) {
      _filter = { dept: '', status: '' };
      fillFilters(); renderTable();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const t = _terms.find(x => x.id === btn.dataset.id);
    if (!t) return;
    if (btn.dataset.act === 'pdf') {
      btn.disabled = true;
      try { await printReceiptTerm(t.id); } finally { btn.disabled = false; }
    } else if (btn.dataset.act === 'cancel') openCancelTermModal(t.order, t, load);
  });
}
