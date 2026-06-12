import { pageRoot, pageHeader } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, toast, openModal, closeModal, confirmDialog, formValues, fmtMoney } from '../ui.js';
import { icons } from '../icons.js';
import { printList, buildFiltersLabel } from '../print.js';
import { exportXLSX, timestampFilename } from '../export.js';
import { isAdmin } from '../auth.js';

const KIND_LABEL = { posto: 'Posto', mecanica: 'Mecânica', ambos: 'Posto + Mecânica' };
const KIND_BADGE = { posto: 'badge', mecanica: 'badge badge-warning', ambos: 'badge badge-success' };

let _items = [];
let _depts = [];
let _munis = [];
let _fuels = [];
let _fuelSubs = [];   // subtipos (Diesel S10, Gasolina Aditivada, etc.)
let _filter = { search: '', kind: '', dept: '', fuel: '' };

// =============================================================================
// HELPERS DE COMBUSTÍVEL (compartilhados com sub-form e exports)
// =============================================================================

/** Retorna subtipos ativos de um fuel_type_code. */
function subsOf(code) {
  return _fuelSubs.filter(s => s.fuel_type_code === code && s.active);
}

/** Descrição "Diesel S10" (subtipo) ou "DIESEL" (pai) conforme o caso. */
function fuelLabel(fuel_type_code, fuel_subtype_id) {
  if (fuel_subtype_id) {
    const sub = _fuelSubs.find(s => s.id === fuel_subtype_id);
    if (sub) return sub.description;
  }
  return _fuels.find(f => f.code === fuel_type_code)?.description || `Cód ${fuel_type_code}`;
}

/** Codifica (code, subId) em "code|subId" pra <option value="…">. */
function encFuelValue(code, subId) {
  return `${code ?? ''}|${subId ?? ''}`;
}
function decFuelValue(v) {
  const [c, s] = String(v || '').split('|');
  return {
    fuel_type_code: c ? Number(c) : null,
    fuel_subtype_id: s ? Number(s) : null,
  };
}

/**
 * Monta o HTML das opções de combustível agrupadas:
 *   - Quando o fuel_type tem subtipos, lista os subtipos em <optgroup>.
 *   - Quando NÃO tem subtipos, mostra o pai direto.
 * `selected`: { fuel_type_code, fuel_subtype_id } atualmente selecionado.
 * `excludeKeys`: array de "code|subId" pra esconder (combustíveis já usados em outras linhas).
 */
function fuelOptionsHTML(selected = {}, excludeKeys = []) {
  const ex = new Set(excludeKeys);
  const selKey = encFuelValue(selected.fuel_type_code, selected.fuel_subtype_id);
  return _fuels.map(f => {
    const subs = subsOf(f.code);
    if (subs.length === 0) {
      const key = encFuelValue(f.code, null);
      if (ex.has(key) && key !== selKey) return '';
      return `<option value="${key}" ${key === selKey ? 'selected' : ''}>${esc(f.description)}</option>`;
    }
    const opts = subs.map(s => {
      const key = encFuelValue(f.code, s.id);
      if (ex.has(key) && key !== selKey) return '';
      return `<option value="${key}" ${key === selKey ? 'selected' : ''}>${esc(s.description)}</option>`;
    }).filter(Boolean).join('');
    return opts ? `<optgroup label="${esc(f.description)}">${opts}</optgroup>` : '';
  }).join('');
}

// =============================================================================
// PÁGINA
// =============================================================================
export async function renderFornecedores() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Fornecedores',
      subtitle: 'Postos de combustível e mecânicas — com contratos e saldos.',
      actionsHtml: `
        <button class="btn btn-outline" id="btn-print-for" title="Imprimir lista filtrada">
          <span style="width:16px;height:16px;display:inline-flex">${icons.printer}</span>
          <span>Imprimir</span>
        </button>
        <button class="btn btn-outline" id="btn-export-for" title="Exportar lista filtrada (Excel)">
          <span style="width:16px;height:16px;display:inline-flex">${icons.download}</span>
          <span>Exportar Excel</span>
        </button>
        <button class="btn btn-primary" id="btn-new-for">
          <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span>
          Novo fornecedor
        </button>`,
    })}
    <div class="card">
      <div class="table-toolbar">
        <div class="search ${_filter.search ? 'has-value' : ''}" id="for-search-box">
          ${icons.search}
          <input id="for-search" type="search"
                 placeholder="Buscar por nome, fantasia, CNPJ, responsável…"
                 autocomplete="off" value="${esc(_filter.search)}">
          <button class="clear" id="for-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="for-count"></div>
      </div>
      <div class="filter-chips" id="for-filters">
        <select class="select chip" id="ff-kind">
          <option value="">Todos os tipos</option>
          <option value="posto">Posto</option>
          <option value="mecanica">Mecânica</option>
          <option value="ambos">Posto + Mecânica</option>
        </select>
        <select class="select chip" id="ff-dept"><option value="">Todas secretarias</option></select>
        <select class="select chip" id="ff-fuel"><option value="">Todos combustíveis</option></select>
        <button class="btn btn-ghost btn-sm" id="ff-clear" hidden>Limpar filtros</button>
      </div>
      <div id="for-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  document.getElementById('btn-new-for').addEventListener('click', () => openForModal());
  document.getElementById('btn-export-for').addEventListener('click', exportCSV);
  document.getElementById('btn-print-for').addEventListener('click', printFor);

  const sBox = document.getElementById('for-search-box');
  const sIn = document.getElementById('for-search');
  document.getElementById('for-search-clear').addEventListener('click', () => {
    _filter.search = ''; sIn.value = ''; sBox.classList.remove('has-value'); renderTable();
  });
  sIn.addEventListener('input', (e) => {
    _filter.search = e.target.value || '';
    sBox.classList.toggle('has-value', !!_filter.search);
    renderTable();
  });

  await loadAll();
  fillFilterSelects();
  bindFilterChips();
  renderTable();
}

async function loadAll() {
  const [s, d, m, f, fs] = await Promise.all([
    supabase.from('supplier').select(`
      id, kind, legal_name, trade_name, cnpj, responsible_name, phone,
      address, city, ibge_code, department_id, contract_number,
      department:department_id(acronym, name),
      fuels:supplier_fuel(id, fuel_type_code, fuel_subtype_id, unit_price, contract_amount, current_balance)
    `).order('legal_name'),
    supabase.from('department').select('id, acronym, name').order('acronym'),
    supabase.from('ibge_municipality').select('code, name').order('name'),
    supabase.from('fuel_type').select('code, description').order('code'),
    supabase.from('fuel_subtype').select('id, fuel_type_code, description, active').eq('active', true).order('description'),
  ]);
  if (s.error) { toast('Falha ao carregar fornecedores: ' + s.error.message, 'error'); _items = []; }
  else _items = s.data || [];
  _depts = d.data || [];
  _munis = m.data || [];
  _fuels = f.data || [];
  _fuelSubs = fs.data || [];
}

function fillFilterSelects() {
  const ffK = document.getElementById('ff-kind');
  const ffD = document.getElementById('ff-dept');
  const ffF = document.getElementById('ff-fuel');
  ffD.innerHTML = '<option value="">Todas secretarias</option>' +
    _depts.map(d => `<option value="${d.id}">${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');
  ffF.innerHTML = '<option value="">Todos combustíveis</option>' +
    _fuels.map(f => `<option value="${f.code}">${esc(f.description)}</option>`).join('');
  if (_filter.kind) ffK.value = _filter.kind;
  if (_filter.dept) ffD.value = _filter.dept;
  if (_filter.fuel) ffF.value = _filter.fuel;
  updateFilterClearVisibility();
}

function bindFilterChips() {
  document.getElementById('ff-kind').addEventListener('change', (e) => { _filter.kind = e.target.value; updateFilterClearVisibility(); renderTable(); });
  document.getElementById('ff-dept').addEventListener('change', (e) => { _filter.dept = e.target.value; updateFilterClearVisibility(); renderTable(); });
  document.getElementById('ff-fuel').addEventListener('change', (e) => { _filter.fuel = e.target.value; updateFilterClearVisibility(); renderTable(); });
  document.getElementById('ff-clear').addEventListener('click', () => {
    _filter = { search: _filter.search, kind: '', dept: '', fuel: '' };
    fillFilterSelects(); renderTable();
  });
}

function updateFilterClearVisibility() {
  const anyActive = _filter.kind || _filter.dept || _filter.fuel;
  document.getElementById('ff-clear').hidden = !anyActive;
}

// =============================================================================
// FILTRO E RENDER
// =============================================================================
function applyFilters() {
  const t = (_filter.search || '').toLowerCase();
  return _items.filter(s => {
    if (_filter.kind && s.kind !== _filter.kind) return false;
    if (_filter.dept && s.department_id !== _filter.dept) return false;
    if (_filter.fuel) {
      // filtro é pelo fuel_type_code pai — bate com qualquer subtipo do mesmo pai
      const has = (s.fuels || []).some(f => String(f.fuel_type_code) === String(_filter.fuel));
      if (!has) return false;
    }
    if (!t) return true;
    return (s.legal_name || '').toLowerCase().includes(t)
        || (s.trade_name || '').toLowerCase().includes(t)
        || (s.cnpj || '').toLowerCase().includes(t)
        || (s.responsible_name || '').toLowerCase().includes(t);
  });
}

function renderTable() {
  const box = document.getElementById('for-tablebox');
  const countEl = document.getElementById('for-count');

  if (!_items.length) {
    if (countEl) countEl.textContent = '';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.store}</div>
        <div class="empty-state-title">Nenhum fornecedor cadastrado</div>
        <p class="empty-state-text">Clique em "Novo fornecedor" para começar.</p>
      </div>`;
    return;
  }

  const filtered = applyFilters();
  if (countEl) {
    const hasFilters = _filter.search || _filter.kind || _filter.dept || _filter.fuel;
    countEl.textContent = hasFilters
      ? `${filtered.length} de ${_items.length} fornecedor(es)`
      : `${_items.length} fornecedor(es)`;
  }
  if (!filtered.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.search}</div>
        <div class="empty-state-title">Nenhum resultado</div>
        <p class="empty-state-text">Nenhum fornecedor encontrado com os filtros atuais.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Fornecedor</th>
            <th>CNPJ</th>
            <th>Tipo</th>
            <th>Secretaria</th>
            <th>Contato</th>
            <th>Combustíveis</th>
            <th class="actions-col">Ações</th>
          </tr>
        </thead>
        <tbody>${filtered.map(forRow).join('')}</tbody>
      </table>
    </div>
  `;
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openForModal(b.dataset.id)));
  box.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteFor(b.dataset.id)));
}

function forRow(s) {
  const nome = `
    <div class="cell-stack">
      <strong>${esc(s.trade_name || s.legal_name)}</strong>
      ${s.trade_name && s.legal_name ? `<span style="color:var(--text-muted);font-size:12px">${esc(s.legal_name)}</span>` : ''}
    </div>`;
  const contato = `
    <div class="cell-stack">
      ${s.responsible_name ? `<span>${esc(s.responsible_name)}</span>` : ''}
      ${s.phone ? `<span style="color:var(--text-muted);font-size:12px">${esc(s.phone)}</span>` : ''}
    </div>`;
  const fuels = (s.fuels || []);
  const fuelChips = fuels.length
    ? `<div class="cell-stack">${
        fuels.map(f => {
          const label = fuelLabel(f.fuel_type_code, f.fuel_subtype_id);
          return `<span class="badge" style="font-size:10.5px">${esc(label)} · ${fmtMoney(f.unit_price)}/L</span>`;
        }).join('')
      }</div>`
    : '<span style="color:var(--text-muted)">—</span>';
  return `
    <tr>
      <td data-label="Fornecedor">${nome}</td>
      <td data-label="CNPJ" style="font-family:ui-monospace,monospace;font-size:12px;white-space:nowrap">${esc(fmtCNPJ(s.cnpj))}</td>
      <td data-label="Tipo"><span class="${KIND_BADGE[s.kind] || 'badge'}">${esc(KIND_LABEL[s.kind] || s.kind)}</span></td>
      <td data-label="Secretaria">${s.department?.acronym ? esc(s.department.acronym) : '<span style="color:var(--text-muted)">—</span>'}</td>
      <td data-label="Contato">${contato.trim() === '<div class="cell-stack"></div>' ? '<span style="color:var(--text-muted)">—</span>' : contato}</td>
      <td data-label="Combustíveis">${fuelChips}</td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" data-id="${s.id}" title="Editar">${icons.edit}</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="delete" data-id="${s.id}" title="Excluir" style="color:var(--danger)">${icons.trash}</button>` : ''}
        </div>
      </td>
    </tr>`;
}

// =============================================================================
// DATASET COMPLETO (compartilhado entre CSV e impressão)
// =============================================================================

/** Concatena cidade do fornecedor com seu código IBGE (quando disponível). */
function cityIBGEName(s) {
  if (!s.ibge_code) return s.city || '';
  const m = _munis.find(x => x.code === s.ibge_code);
  return m ? m.name : (s.city || '');
}

function fuelDesc(code) {
  return _fuels.find(x => x.code === code)?.description || `Cód ${code}`;
}

function fuelsCompact(s) {
  return (s.fuels || []).map(f => {
    const contr = Number(f.contract_amount || 0) === 0
      ? 'ilimitado'
      : `${Number(f.contract_amount).toFixed(2)}L`;
    const subDesc = f.fuel_subtype_id ? ` · ${fuelLabel(f.fuel_type_code, f.fuel_subtype_id)}` : '';
    return `[${f.fuel_type_code}] ${fuelDesc(f.fuel_type_code)}${subDesc} · R$${Number(f.unit_price).toFixed(3)}/L · contrato: ${contr} · saldo: ${Number(f.current_balance).toFixed(2)}L`;
  }).join(' | ');
}

function describeActiveFilters() {
  return buildFiltersLabel([
    { label: 'Busca', value: _filter.search },
    { label: 'Tipo', value: KIND_LABEL[_filter.kind] },
    { label: 'Secretaria', value: _depts.find(d => d.id === _filter.dept)?.acronym },
    { label: 'Combustível', value: fuelDesc(Number(_filter.fuel)) === `Cód ${_filter.fuel}` ? null : fuelDesc(Number(_filter.fuel)) },
  ]);
}

// =============================================================================
// EXPORT XLSX
// =============================================================================
function exportCSV() {
  const list = applyFilters();
  if (!list.length) { toast('Nenhum fornecedor para exportar com os filtros atuais.', 'warning'); return; }
  const columns = [
    'ID',
    'Razão Social', 'Nome Fantasia', 'CNPJ',
    'Tipo (cód.)', 'Tipo',
    'Responsável', 'Telefone',
    'Endereço', 'Cidade', 'IBGE (cód.)', 'Município (IBGE)',
    'Secretaria (sigla)', 'Secretaria (nome)',
    'Nº/Ano Contrato',
    'Qtd. Combustíveis',
    'Combustíveis (cód · descrição · R$/L · contrato · saldo)',
  ];
  const rows = list.map(s => [
    s.id,
    s.legal_name || '',
    s.trade_name || '',
    fmtCNPJ(s.cnpj),
    s.kind,
    KIND_LABEL[s.kind] || s.kind,
    s.responsible_name || '',
    s.phone || '',
    s.address || '',
    s.city || '',
    s.ibge_code || '',
    cityIBGEName(s),
    s.department?.acronym || '',
    s.department?.name || '',
    s.contract_number || '',
    (s.fuels || []).length,
    fuelsCompact(s),
  ]);
  try {
    exportXLSX({
      filename: timestampFilename('fornecedores'),
      sheetName: 'Fornecedores',
      columns,
      rows,
    });
    toast(`${list.length} fornecedor(es) exportado(s).`, 'success');
  } catch (e) {
    toast('Erro ao exportar: ' + e.message, 'error');
  }
}

// =============================================================================
// IMPRESSÃO (A4 paisagem, subset prioritário)
// =============================================================================
async function printFor() {
  const list = applyFilters();
  if (!list.length) { toast('Nenhum fornecedor para imprimir com os filtros atuais.', 'warning'); return; }

  const cols = ['Fornecedor', 'CNPJ', 'Tipo', 'Secretaria', 'Nº Contrato', 'Contato', 'Cidade (IBGE)', 'Combustíveis (cód · desc · preço · saldo)'];
  const hints = ['', 'mono', '', '', 'mono', '', '', 'wrap'];

  const rows = list.map(s => [
    `${s.trade_name || s.legal_name}${s.trade_name && s.legal_name && s.trade_name !== s.legal_name ? ' (' + s.legal_name + ')' : ''}`,
    fmtCNPJ(s.cnpj),
    KIND_LABEL[s.kind] || s.kind,
    s.department?.acronym ? `${s.department.acronym}${s.department.name ? ' — ' + s.department.name : ''}` : '—',
    s.contract_number || '—',
    [s.responsible_name, s.phone].filter(Boolean).join(' · ') || '—',
    [cityIBGEName(s), s.ibge_code ? `(${s.ibge_code})` : ''].filter(Boolean).join(' '),
    (s.fuels || []).length
      ? (s.fuels || []).map(f => {
          const contr = Number(f.contract_amount || 0) === 0 ? 'ilim.' : `${Number(f.contract_amount).toFixed(0)}L`;
          return `[${f.fuel_type_code}] ${fuelDesc(f.fuel_type_code)} · R$${Number(f.unit_price).toFixed(3)} · ${contr} / saldo ${Number(f.current_balance).toFixed(0)}L`;
        }).join(' • ')
      : '—',
  ]);

  await printList({
    title: 'Relação de Fornecedores',
    columns: cols,
    colHints: hints,
    rows,
    filtersLabel: describeActiveFilters(),
  });
}

// =============================================================================
// MODAL DE CADASTRO/EDIÇÃO
// =============================================================================
function openForModal(id) {
  const editing = !!id;
  const s = editing ? _items.find(x => x.id === id) : null;
  const kind = s?.kind || 'posto';
  const muniOptions = '<option value="">— Não informado —</option>' +
    _munis.map(m => `<option value="${m.code}" ${s?.ibge_code === m.code ? 'selected' : ''}>${esc(m.name)}</option>`).join('');
  const deptOptions = '<option value="">— Nenhuma —</option>' +
    _depts.map(d => `<option value="${d.id}" ${s?.department_id === d.id ? 'selected' : ''}>${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');

  const body = `
    <form id="for-form" autocomplete="off">
      ${section('🏢 Identificação')}
      <div class="form-grid">
        <div class="field col-full">
          <label class="field-label">Razão Social <span class="req">*</span></label>
          <input class="input" name="legal_name" required minlength="3" maxlength="200"
                 value="${esc(s?.legal_name || '')}">
        </div>
        <div class="field">
          <label class="field-label">Nome Fantasia</label>
          <input class="input" name="trade_name" maxlength="120" value="${esc(s?.trade_name || '')}">
        </div>
        <div class="field">
          <label class="field-label">CNPJ <span class="req">*</span></label>
          <input class="input" name="cnpj" required value="${esc(fmtCNPJ(s?.cnpj))}"
                 placeholder="00.000.000/0000-00"
                 oninput="this.value=__maskCNPJ(this.value)">
        </div>
        <div class="field col-full">
          <label class="field-label">Tipo de fornecedor <span class="req">*</span></label>
          <div class="segmented" id="for-kind-seg">
            <button type="button" class="seg-btn ${kind === 'posto' ? 'active' : ''}" data-kind="posto">⛽ Posto</button>
            <button type="button" class="seg-btn ${kind === 'mecanica' ? 'active' : ''}" data-kind="mecanica">🔧 Mecânica</button>
            <button type="button" class="seg-btn ${kind === 'ambos' ? 'active' : ''}" data-kind="ambos">⛽🔧 Ambos</button>
          </div>
          <input type="hidden" name="kind" id="for-kind-input" value="${kind}">
          <span class="field-help">Mecânica também recebe autorizações para serviços de manutenção.</span>
        </div>
      </div>

      ${section('📞 Contato e localização')}
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Responsável</label>
          <input class="input" name="responsible_name" maxlength="120" value="${esc(s?.responsible_name || '')}">
        </div>
        <div class="field">
          <label class="field-label">Telefone</label>
          <input class="input" name="phone" type="tel" maxlength="20" value="${esc(s?.phone || '')}"
                 placeholder="(89) 99999-9999">
        </div>
        <div class="field col-full">
          <label class="field-label">Endereço</label>
          <input class="input" name="address" maxlength="200" value="${esc(s?.address || '')}">
        </div>
        <div class="field">
          <label class="field-label">Cidade</label>
          <input class="input" name="city" maxlength="120" value="${esc(s?.city || '')}">
        </div>
        <div class="field">
          <label class="field-label">Município (IBGE)</label>
          <select class="select" name="ibge_code">${muniOptions}</select>
        </div>
      </div>

      ${section('📄 Contrato')}
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Secretaria de origem</label>
          <select class="select" name="department_id">${deptOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">Nº / Ano do contrato</label>
          <input class="input" name="contract_number" maxlength="30" value="${esc(s?.contract_number || '')}"
                 placeholder="ex: 012/2025">
        </div>
      </div>

      <div id="fuels-block" style="display:${kind === 'mecanica' ? 'none' : ''}">
        ${section('⛽ Combustíveis e contratos')}
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:var(--s-3)">
          Adicione cada combustível vendido. <strong>Contrato = 0</strong> significa <em>sem limite</em> (não controla saldo). Saldo é debitado a cada autorização emitida.
        </p>
        <div id="fuels-rows"></div>
        <button type="button" class="btn btn-outline btn-sm" id="add-fuel-btn">
          <span style="width:14px;height:14px;display:inline-flex">${icons.plus}</span>
          Adicionar combustível
        </button>
      </div>

      <div id="for-form-errors" class="login-error" style="display:none;margin-top:12px"></div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="for-save-btn">${editing ? 'Salvar alterações' : 'Cadastrar fornecedor'}</button>
  `;
  const m = openModal({ title: editing ? 'Editar fornecedor' : 'Novo fornecedor', body, footer, size: 'lg' });

  // Helper de máscara (inline pra acessar via oninput=)
  window.__maskCNPJ = (v) => {
    const d = String(v || '').replace(/\D/g, '').slice(0, 14);
    let out = d;
    if (d.length > 12) out = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
    else if (d.length > 8) out = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8)}`;
    else if (d.length > 5) out = `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5)}`;
    else if (d.length > 2) out = `${d.slice(0,2)}.${d.slice(2)}`;
    return out;
  };

  // Segmented control
  m.querySelectorAll('#for-kind-seg .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      m.querySelectorAll('#for-kind-seg .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const k = btn.dataset.kind;
      m.querySelector('#for-kind-input').value = k;
      m.querySelector('#fuels-block').style.display = (k === 'mecanica') ? 'none' : '';
    });
  });

  // Fuels sub-form
  const initialFuels = (s?.fuels || []).map(f => ({
    fuel_type_code: f.fuel_type_code,
    fuel_subtype_id: f.fuel_subtype_id || '',
    unit_price: f.unit_price,
    contract_amount: f.contract_amount,
    current_balance: f.current_balance,
  }));
  renderFuelRows(initialFuels);
  m.querySelector('#add-fuel-btn').addEventListener('click', () => {
    const current = collectFuels();
    current.push({ fuel_type_code: '', fuel_subtype_id: '', unit_price: '', contract_amount: 0, current_balance: 0 });
    renderFuelRows(current);
  });

  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#for-save-btn').addEventListener('click', () => saveFor(editing ? id : null));
}

function renderFuelRows(fuels) {
  const wrap = document.getElementById('fuels-rows');
  if (!wrap) return;
  if (!fuels.length) {
    wrap.innerHTML = `<p style="font-size:12px;color:var(--text-muted);padding:8px 0">Nenhum combustível cadastrado.</p>`;
    return;
  }
  wrap.innerHTML = fuels.map((f, i) => fuelRow(f, i, fuels)).join('');
  wrap.querySelectorAll('[data-act="remove-fuel"]').forEach(b => {
    b.addEventListener('click', () => {
      const current = collectFuels();
      current.splice(Number(b.dataset.idx), 1);
      renderFuelRows(current);
    });
  });
  // Listener do select de combustível combo → atualiza hidden inputs e re-render
  wrap.querySelectorAll('select[data-k="combo"]').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = Number(sel.dataset.idx);
      const parsed = decFuelValue(sel.value);
      const current = collectFuels();
      current[idx].fuel_type_code = parsed.fuel_type_code ?? '';
      current[idx].fuel_subtype_id = parsed.fuel_subtype_id ?? '';
      renderFuelRows(current);
    });
  });
}

function fuelRow(f, idx, allFuels) {
  // Combustíveis já usados em OUTRAS linhas (chave composta code|subtype)
  const taken = allFuels
    .filter((_, i) => i !== idx)
    .map(x => encFuelValue(Number(x.fuel_type_code) || null, Number(x.fuel_subtype_id) || null))
    .filter(k => k !== '|');
  const opts = fuelOptionsHTML(
    { fuel_type_code: Number(f.fuel_type_code) || null,
      fuel_subtype_id: Number(f.fuel_subtype_id) || null },
    taken,
  );
  const currentKey = encFuelValue(f.fuel_type_code, f.fuel_subtype_id);
  return `
    <div class="fuel-row" data-idx="${idx}">
      <div class="field" style="margin:0">
        <label class="field-label">Combustível</label>
        <select class="select fuel-input" data-k="combo" data-idx="${idx}">
          <option value="">— Selecione —</option>
          ${opts}
        </select>
        <input type="hidden" class="fuel-input" data-k="fuel_type_code" data-idx="${idx}" value="${f.fuel_type_code ?? ''}">
        <input type="hidden" class="fuel-input" data-k="fuel_subtype_id" data-idx="${idx}" value="${f.fuel_subtype_id ?? ''}">
      </div>
      <div class="field" style="margin:0">
        <label class="field-label">Preço (R$/L)</label>
        <input class="input fuel-input" type="number" step="0.001" min="0" data-k="unit_price" data-idx="${idx}" value="${f.unit_price ?? ''}">
      </div>
      <div class="field" style="margin:0">
        <label class="field-label">Contrato (L) <span style="color:var(--text-muted);font-weight:400">0=∞</span></label>
        <input class="input fuel-input" type="number" step="0.01" min="0" data-k="contract_amount" data-idx="${idx}" value="${f.contract_amount ?? 0}">
      </div>
      <div class="field" style="margin:0">
        <label class="field-label">Saldo atual (L)</label>
        <input class="input fuel-input" type="number" step="0.01" min="0" data-k="current_balance" data-idx="${idx}" value="${f.current_balance ?? 0}">
      </div>
      <div class="fuel-remove">
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-act="remove-fuel" data-idx="${idx}" title="Remover" style="color:var(--danger)">${icons.trash}</button>
      </div>
    </div>
  `;
}

function collectFuels() {
  const inputs = document.querySelectorAll('.fuel-input');
  const acc = {};
  inputs.forEach(el => {
    const idx = Number(el.dataset.idx);
    const k = el.dataset.k;
    if (k === 'combo') return; // só pra UI, não persiste
    acc[idx] = acc[idx] || { fuel_type_code: '', fuel_subtype_id: '', unit_price: '', contract_amount: 0, current_balance: 0 };
    acc[idx][k] = el.value;
  });
  return Object.values(acc);
}

function section(label) {
  return `<div style="font-size:12px;font-weight:600;color:var(--primary);
                margin:16px 0 10px;padding-top:12px;
                border-top:1px dashed var(--border)">${label}</div>`;
}

// =============================================================================
// SAVE / DELETE
// =============================================================================
async function saveFor(id) {
  const form = document.getElementById('for-form');
  const errBox = document.getElementById('for-form-errors');
  errBox.style.display = 'none';
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const v = formValues(form);
  const cnpj = (v.cnpj || '').replace(/\D/g, '');
  if (cnpj.length !== 14) {
    showErr(errBox, ['CNPJ deve ter 14 dígitos.']); return;
  }

  const fuelsRaw = (v.kind === 'mecanica') ? [] : collectFuels();
  const fuels = fuelsRaw
    .filter(f => f.fuel_type_code)
    .map(f => ({
      fuel_type_code: Number(f.fuel_type_code),
      fuel_subtype_id: f.fuel_subtype_id ? Number(f.fuel_subtype_id) : null,
      unit_price: Number(f.unit_price || 0),
      contract_amount: Number(f.contract_amount || 0),
      current_balance: Number(f.current_balance || 0),
    }));

  // valida sub-form
  const fuelErrs = [];
  const keysSeen = new Set();
  fuels.forEach((f, i) => {
    const tag = `Linha ${i + 1}: `;
    const key = `${f.fuel_type_code}|${f.fuel_subtype_id ?? ''}`;
    if (keysSeen.has(key)) fuelErrs.push(tag + 'combustível/subtipo duplicado.');
    keysSeen.add(key);
    if (f.unit_price < 0) fuelErrs.push(tag + 'preço inválido.');
    if (f.contract_amount < 0) fuelErrs.push(tag + 'contrato inválido.');
    if (f.current_balance < 0) fuelErrs.push(tag + 'saldo inválido.');
    if (f.contract_amount > 0 && f.current_balance > f.contract_amount) {
      fuelErrs.push(tag + 'saldo maior que o contrato.');
    }
  });
  if (fuelErrs.length) { showErr(errBox, fuelErrs); return; }

  const payload = {
    kind: v.kind,
    legal_name: (v.legal_name || '').trim(),
    trade_name: (v.trade_name || '').trim() || null,
    cnpj,
    responsible_name: (v.responsible_name || '').trim() || null,
    phone: (v.phone || '').trim() || null,
    address: (v.address || '').trim() || null,
    city: (v.city || '').trim() || null,
    ibge_code: v.ibge_code || null,
    department_id: v.department_id || null,
    contract_number: (v.contract_number || '').trim() || null,
  };

  const btn = document.getElementById('for-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    let supId = id;
    if (id) {
      const { error } = await supabase.from('supplier').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from('supplier').insert(payload).select('id').single();
      if (error) throw error;
      supId = data.id;
    }

    // Substitui supplier_fuel em bloco (simples e consistente).
    // Pra evitar deletar e o app cair em estado inconsistente em erro,
    // fazemos: delete all → insert new. Atomicidade pra MVP é OK; se o
    // volume crescer, mover pra RPC com transação.
    const { error: delErr } = await supabase.from('supplier_fuel').delete().eq('supplier_id', supId);
    if (delErr) throw delErr;
    if (fuels.length) {
      const ins = fuels.map(f => ({ ...f, supplier_id: supId }));
      const { error: insErr } = await supabase.from('supplier_fuel').insert(ins);
      if (insErr) throw insErr;
    }

    toast(id ? 'Fornecedor atualizado.' : 'Fornecedor cadastrado.', 'success');
    closeModal();
    await loadAll();
    renderTable();
  } catch (err) {
    showErr(errBox, [friendlyError(err)]);
    btn.disabled = false;
    btn.textContent = id ? 'Salvar alterações' : 'Cadastrar fornecedor';
  }
}

function showErr(el, errs) {
  el.innerHTML = '⚠️ ' + errs.join('<br>⚠️ ');
  el.style.display = 'block';
}

async function deleteFor(id) {
  const s = _items.find(x => x.id === id);
  if (!s) return;
  const ok = await confirmDialog({
    title: 'Excluir fornecedor',
    message: `Excluir "${s.trade_name || s.legal_name}"? Esta ação remove também os combustíveis e contratos.`,
    confirmText: 'Excluir', danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.from('supplier').delete().eq('id', id);
  if (error) { toast(friendlyError(error), 'error'); return; }
  toast('Fornecedor excluído.', 'success');
  await loadAll();
  renderTable();
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (err?.code === '23505' || /duplicate key|already exists|unique/i.test(msg)) {
    return 'Já existe um fornecedor com esse CNPJ ou combustível duplicado para o mesmo fornecedor.';
  }
  if (err?.code === '23503' || /foreign key/i.test(msg)) {
    return 'Não é possível excluir: há autorizações ou abastecimentos vinculados.';
  }
  if (/chk_balance_within_contract/.test(msg)) {
    return 'Saldo atual não pode ser maior que o contrato.';
  }
  return msg;
}

function fmtCNPJ(c) {
  if (!c) return '';
  const d = String(c).replace(/\D/g, '').padStart(14, '0').slice(-14);
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}
