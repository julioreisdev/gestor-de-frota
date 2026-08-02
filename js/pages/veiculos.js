import { pageRoot, pageHeader } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, toast, openModal, closeModal, confirmDialog, formValues, formatPlate, cleanPlate } from '../ui.js';
import { icons } from '../icons.js';
import { printList, buildFiltersLabel } from '../print.js';
import { exportXLSX, timestampFilename } from '../export.js';
import { isAdmin } from '../auth.js';

const CONSERV = ['Ótimo', 'Bom', 'Regular', 'Ruim', 'Inativo'];

let _items = [];
let _depts = [];
let _types = [];
let _fuels = [];
let _fuelSubs = [];
let _origins = [];
let _filter = { search: '', dept: '', fuel: '', origin: '' };

// Próximo código interno sequencial no formato VEI-NNN (no mínimo 3 dígitos).
// Considera tanto os ativos quanto os deletados, pra não reusar números.
function nextInternalCode() {
  const maxN = _items.reduce((max, x) => {
    const m = String(x.internal_code || '').match(/^VEI-(\d+)$/i);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `VEI-${String(maxN + 1).padStart(3, '0')}`;
}

// Helpers de combustível com subtipo
function subsOf(code) { return _fuelSubs.filter(s => s.fuel_type_code === code && s.active); }
function fuelLabel(code, subId) {
  if (subId) {
    const s = _fuelSubs.find(x => x.id === subId);
    if (s) return s.description;
  }
  return _fuels.find(f => f.code === code)?.description || `Cód ${code}`;
}
function encFuelValue(code, subId) { return `${code ?? ''}|${subId ?? ''}`; }
function decFuelValue(v) {
  const [c, s] = String(v || '').split('|');
  return { fuel_type_code: c ? Number(c) : null, fuel_subtype_id: s ? Number(s) : null };
}
function fuelOptionsHTML(selected = {}, includeNullPair = false) {
  const selKey = encFuelValue(selected.fuel_type_code, selected.fuel_subtype_id);
  return _fuels.map(f => {
    const subs = subsOf(f.code);
    if (subs.length === 0) {
      const key = encFuelValue(f.code, null);
      return `<option value="${key}" ${key === selKey ? 'selected' : ''}>${esc(f.description)}</option>`;
    }
    // Quando há subtipos, opcionalmente permite escolher o pai sem subtipo
    const parentOpt = includeNullPair
      ? `<option value="${encFuelValue(f.code, null)}" ${encFuelValue(f.code, null) === selKey ? 'selected' : ''}>${esc(f.description)} (genérico)</option>`
      : '';
    const subOpts = subs.map(s => {
      const key = encFuelValue(f.code, s.id);
      return `<option value="${key}" ${key === selKey ? 'selected' : ''}>${esc(s.description)}</option>`;
    }).join('');
    return `<optgroup label="${esc(f.description)}">${parentOpt}${subOpts}</optgroup>`;
  }).join('');
}

// =============================================================================
// PÁGINA
// =============================================================================
export async function renderVeiculos() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Veículos',
      subtitle: 'Cadastro completo da frota — campos alinhados ao TCE-PI.',
      actionsHtml: `
        <button class="btn btn-outline" id="btn-print-veic" title="Imprimir lista filtrada">
          <span style="width:16px;height:16px;display:inline-flex">${icons.printer}</span>
          <span>Imprimir</span>
        </button>
        <button class="btn btn-outline" id="btn-export-veic" title="Exportar lista filtrada (Excel)">
          <span style="width:16px;height:16px;display:inline-flex">${icons.download}</span>
          <span>Exportar Excel</span>
        </button>
        <button class="btn btn-primary" id="btn-new-veic">
          <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span>
          Novo veículo
        </button>`,
    })}
    <div class="card">
      <div class="table-toolbar">
        <div class="search ${_filter.search ? 'has-value' : ''}" id="veic-search-box">
          ${icons.search}
          <input id="veic-search" type="search"
                 placeholder="Buscar por placa, modelo, marca…"
                 autocomplete="off" value="${esc(_filter.search)}">
          <button class="clear" id="veic-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="veic-count"></div>
      </div>
      <div class="filter-chips" id="veic-filters">
        <select class="select chip" id="ff-dept"><option value="">Todas secretarias</option></select>
        <select class="select chip" id="ff-fuel"><option value="">Todos combustíveis</option></select>
        <select class="select chip" id="ff-origin"><option value="">Todas origens</option></select>
        <button class="btn btn-ghost btn-sm" id="ff-clear" hidden>Limpar filtros</button>
      </div>
      <div id="veic-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  // bindings
  document.getElementById('btn-new-veic').addEventListener('click', () => openVeicModal());
  document.getElementById('btn-export-veic').addEventListener('click', exportCSV);
  document.getElementById('btn-print-veic').addEventListener('click', printVeic);

  const sBox = document.getElementById('veic-search-box');
  const sIn = document.getElementById('veic-search');
  document.getElementById('veic-search-clear').addEventListener('click', () => {
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
  const [v, d, t, f, fs, o] = await Promise.all([
    supabase.from('vehicle').select(`
      id, internal_code, plate, renavam, chassis, model, brand,
      year_manufacture, year_model, vehicle_type_code, fuel_type_code, fuel_subtype_id,
      vehicle_origin_code, department_id, tank_capacity, current_km,
      conservation_state, acquisition_date, notes,
      cession_destination_organ, cession_start_date, cession_end_date,
      lessor_doc, lessor_name, monthly_value, has_driver, cw_contract_code,
      lessor_lease_start_date, lessor_lease_end_date,
      department:department_id(acronym, name)
    `).order('plate'),
    supabase.from('department').select('id, acronym, name').order('acronym'),
    supabase.from('vehicle_type').select('code, description').order('code'),
    supabase.from('fuel_type').select('code, description').order('code'),
    supabase.from('fuel_subtype').select('id, fuel_type_code, description, active').eq('active', true).order('description'),
    supabase.from('vehicle_origin').select('code, description').order('code'),
  ]);
  if (v.error) { toast('Falha ao carregar veículos: ' + v.error.message, 'error'); _items = []; }
  else _items = v.data || [];
  _depts = d.data || [];
  _types = t.data || [];
  _fuels = f.data || [];
  _fuelSubs = fs.data || [];
  _origins = o.data || [];
}

function fillFilterSelects() {
  const ffD = document.getElementById('ff-dept');
  const ffF = document.getElementById('ff-fuel');
  const ffO = document.getElementById('ff-origin');
  ffD.innerHTML = '<option value="">Todas secretarias</option>' +
    _depts.map(d => `<option value="${d.id}">${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');
  ffF.innerHTML = '<option value="">Todos combustíveis</option>' +
    _fuels.map(f => `<option value="${f.code}">${esc(f.description)}</option>`).join('');
  ffO.innerHTML = '<option value="">Todas origens</option>' +
    _origins.map(o => `<option value="${o.code}">${esc(o.description)}</option>`).join('');
  if (_filter.dept) ffD.value = _filter.dept;
  if (_filter.fuel) ffF.value = _filter.fuel;
  if (_filter.origin) ffO.value = _filter.origin;
  updateFilterClearVisibility();
}

function bindFilterChips() {
  document.getElementById('ff-dept').addEventListener('change', (e) => { _filter.dept = e.target.value; updateFilterClearVisibility(); renderTable(); });
  document.getElementById('ff-fuel').addEventListener('change', (e) => { _filter.fuel = e.target.value; updateFilterClearVisibility(); renderTable(); });
  document.getElementById('ff-origin').addEventListener('change', (e) => { _filter.origin = e.target.value; updateFilterClearVisibility(); renderTable(); });
  document.getElementById('ff-clear').addEventListener('click', () => {
    _filter = { search: _filter.search, dept: '', fuel: '', origin: '' };
    fillFilterSelects(); renderTable();
  });
}

function updateFilterClearVisibility() {
  const anyActive = _filter.dept || _filter.fuel || _filter.origin;
  document.getElementById('ff-clear').hidden = !anyActive;
}

// =============================================================================
// FILTRO E RENDER
// =============================================================================
function applyFilters() {
  const t = (_filter.search || '').toLowerCase();
  return _items.filter(v => {
    if (_filter.dept && v.department_id !== _filter.dept) return false;
    if (_filter.fuel && String(v.fuel_type_code) !== String(_filter.fuel)) return false;
    if (_filter.origin && String(v.vehicle_origin_code) !== String(_filter.origin)) return false;
    if (!t) return true;
    return (v.plate || '').toLowerCase().includes(t)
        || (v.model || '').toLowerCase().includes(t)
        || (v.brand || '').toLowerCase().includes(t)
        || (v.internal_code || '').toLowerCase().includes(t)
        || (v.renavam || '').toLowerCase().includes(t);
  });
}

function renderTable() {
  const box = document.getElementById('veic-tablebox');
  const countEl = document.getElementById('veic-count');

  if (!_items.length) {
    if (countEl) countEl.textContent = '';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.car}</div>
        <div class="empty-state-title">Nenhum veículo cadastrado</div>
        <p class="empty-state-text">Clique em "Novo veículo" para cadastrar o primeiro.</p>
      </div>`;
    return;
  }

  const filtered = applyFilters();
  if (countEl) {
    const hasFilters = _filter.search || _filter.dept || _filter.fuel || _filter.origin;
    countEl.textContent = hasFilters
      ? `${filtered.length} de ${_items.length} veículo(s)`
      : `${_items.length} veículo(s)`;
  }

  if (!filtered.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.search}</div>
        <div class="empty-state-title">Nenhum resultado</div>
        <p class="empty-state-text">Nenhum veículo encontrado com os filtros atuais.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Placa</th>
            <th>Modelo / Marca</th>
            <th>Ano</th>
            <th>Tipo</th>
            <th>Combustível</th>
            <th>Origem</th>
            <th>Secretaria</th>
            <th>KM</th>
            <th class="actions-col">Ações</th>
          </tr>
        </thead>
        <tbody>${filtered.map(veicRow).join('')}</tbody>
      </table>
    </div>
  `;
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openVeicModal(b.dataset.id)));
  box.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteVeic(b.dataset.id)));
}

const ORIGIN_BADGE = { 1: 'badge badge-success', 2: 'badge', 3: 'badge badge-warning', 4: 'badge badge-warning', 9: 'badge badge-neutral' };

function veicRow(v) {
  const tipo = _types.find(t => t.code === v.vehicle_type_code)?.description || '—';
  const fuel = fuelLabel(v.fuel_type_code, v.fuel_subtype_id);
  const origem = _origins.find(o => o.code === v.vehicle_origin_code)?.description || '—';
  const dept = v.department?.acronym || '—';
  const modelo = `
    <div class="cell-stack">
      <strong>${esc(v.model || '')}</strong>
      ${v.brand ? `<span style="color:var(--text-muted);font-size:12px">${esc(v.brand)}</span>` : ''}
    </div>`;
  return `
    <tr>
      <td data-label="Placa">
        <strong>${esc(formatPlate(v.plate))}</strong>
        ${v.internal_code ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${esc(v.internal_code)}</div>` : ''}
      </td>
      <td data-label="Modelo / Marca">${modelo}</td>
      <td data-label="Ano" style="white-space:nowrap">${v.year_manufacture}/${v.year_model}</td>
      <td data-label="Tipo">${esc(tipo)}</td>
      <td data-label="Combustível">${esc(fuel)}</td>
      <td data-label="Origem"><span class="${ORIGIN_BADGE[v.vehicle_origin_code] || 'badge'}">${esc(origem)}</span></td>
      <td data-label="Secretaria">${esc(dept)}</td>
      <td data-label="KM" style="white-space:nowrap">${Number(v.current_km || 0).toLocaleString('pt-BR')}</td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" data-id="${v.id}" title="Editar">${icons.edit}</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="delete" data-id="${v.id}" title="Excluir" style="color:var(--danger)">${icons.trash}</button>` : ''}
        </div>
      </td>
    </tr>`;
}

// =============================================================================
// DATASET COMPLETO (compartilhado entre CSV e impressão)
// =============================================================================

/** Colunas completas, com códigos TCE e descrições separados. */
const FULL_COLUMNS = [
  { key: 'id',              label: 'ID' },
  { key: 'internal_code',   label: 'Código Interno' },
  { key: 'plate',           label: 'Placa' },
  { key: 'renavam',         label: 'RENAVAM' },
  { key: 'chassis',         label: 'Chassi' },
  { key: 'model',           label: 'Modelo' },
  { key: 'brand',           label: 'Marca' },
  { key: 'year_manufacture',label: 'Ano Fab' },
  { key: 'year_model',      label: 'Ano Mod' },
  { key: 'type_code',       label: 'Tipo (cód.)' },
  { key: 'type_desc',       label: 'Tipo' },
  { key: 'fuel_code',       label: 'Comb. (cód.)' },
  { key: 'fuel_desc',       label: 'Combustível' },
  { key: 'fuel_subtype_id', label: 'Subtipo (cód.)' },
  { key: 'fuel_subtype_desc', label: 'Subtipo' },
  { key: 'origin_code',     label: 'Origem (cód.)' },
  { key: 'origin_desc',     label: 'Origem' },
  { key: 'dept_acronym',    label: 'Secretaria (sigla)' },
  { key: 'dept_name',       label: 'Secretaria (nome)' },
  { key: 'tank_capacity',   label: 'Capacidade (L)' },
  { key: 'current_km',      label: 'KM Atual' },
  { key: 'conservation',    label: 'Conservação' },
  { key: 'acquisition_date',label: 'Data Aquisição' },
  { key: 'lessor_doc',      label: 'CPF/CNPJ Locador' },
  { key: 'lessor_name',     label: 'Nome Locador' },
  { key: 'monthly_value',   label: 'Valor Mensal (R$)' },
  { key: 'has_driver_code', label: 'Possui Motorista (cód.)' },
  { key: 'has_driver_desc', label: 'Possui Motorista' },
  { key: 'cw',              label: 'Código CW' },
  { key: 'lease_start',     label: 'Início Locação' },
  { key: 'lease_end',       label: 'Fim Locação' },
  { key: 'cession_organ',   label: 'Órgão Destino Cessão' },
  { key: 'cession_start',   label: 'Início Cessão' },
  { key: 'cession_end',     label: 'Fim Cessão' },
  { key: 'notes',           label: 'Observações' },
];

function buildFullRow(v) {
  const type   = _types.find(t => t.code === v.vehicle_type_code);
  const fuel   = _fuels.find(f => f.code === v.fuel_type_code);
  const origin = _origins.find(o => o.code === v.vehicle_origin_code);
  const driverCode = v.has_driver === true ? 1 : v.has_driver === false ? 0 : '';
  return {
    id: v.id,
    internal_code: v.internal_code || '',
    plate: formatPlate(v.plate),
    renavam: String(v.renavam || '').padStart(11, '0'),
    chassis: v.chassis || '',
    model: v.model || '',
    brand: v.brand || '',
    year_manufacture: v.year_manufacture,
    year_model: v.year_model,
    type_code: v.vehicle_type_code,
    type_desc: type?.description || '',
    fuel_code: v.fuel_type_code,
    fuel_desc: fuel?.description || '',
    fuel_subtype_id: v.fuel_subtype_id || '',
    fuel_subtype_desc: v.fuel_subtype_id ? (fuelLabel(v.fuel_type_code, v.fuel_subtype_id)) : '',
    origin_code: v.vehicle_origin_code,
    origin_desc: origin?.description || '',
    dept_acronym: v.department?.acronym || '',
    dept_name: v.department?.name || '',
    tank_capacity: v.tank_capacity != null ? Number(v.tank_capacity).toFixed(2) : '',
    current_km: v.current_km ?? 0,
    conservation: v.conservation_state || '',
    acquisition_date: v.acquisition_date || '',
    lessor_doc: v.lessor_doc || '',
    lessor_name: v.lessor_name || '',
    monthly_value: v.monthly_value != null ? Number(v.monthly_value).toFixed(2) : '',
    has_driver_code: driverCode,
    has_driver_desc: v.has_driver === true ? 'Sim' : v.has_driver === false ? 'Não' : '',
    cw: v.cw_contract_code || '',
    lease_start: v.lessor_lease_start_date || '',
    lease_end:   v.lessor_lease_end_date   || '',
    cession_organ: v.cession_destination_organ || '',
    cession_start: v.cession_start_date || '',
    cession_end:   v.cession_end_date   || '',
    notes: v.notes || '',
  };
}

function describeActiveFilters() {
  return buildFiltersLabel([
    { label: 'Busca', value: _filter.search },
    { label: 'Secretaria', value: _depts.find(d => d.id === _filter.dept)?.acronym },
    { label: 'Combustível', value: _fuels.find(f => String(f.code) === String(_filter.fuel))?.description },
    { label: 'Origem', value: _origins.find(o => String(o.code) === String(_filter.origin))?.description },
  ]);
}

// =============================================================================
// EXPORT XLSX (respeita filtros)
// =============================================================================
function exportCSV() {
  const list = applyFilters();
  if (!list.length) { toast('Nenhum veículo para exportar com os filtros atuais.', 'warning'); return; }
  const columns = FULL_COLUMNS.map(c => c.label);
  const rows = list.map(v => {
    const row = buildFullRow(v);
    return FULL_COLUMNS.map(c => {
      const val = row[c.key];
      // Números reais como Number (Excel reconhece como número)
      if (['year_manufacture','year_model','type_code','fuel_code','fuel_subtype_id','origin_code','current_km','has_driver_code']
          .includes(c.key) && val !== '' && val != null) {
        return Number(val);
      }
      if (['tank_capacity','monthly_value'].includes(c.key) && val !== '' && val != null) {
        return Number(val);
      }
      return val ?? '';
    });
  });
  try {
    exportXLSX({
      filename: timestampFilename('veiculos'),
      sheetName: 'Veículos',
      columns,
      rows,
    });
    toast(`${list.length} veículo(s) exportado(s).`, 'success');
  } catch (e) {
    toast('Erro ao exportar: ' + e.message, 'error');
  }
}

// =============================================================================
// IMPRESSÃO (subset visualmente otimizado pra A4 paisagem)
// =============================================================================

/** Colunas pra impressão — A4 paisagem cabe ~14-16 colunas legíveis. */
const PRINT_COLUMNS = [
  { key: 'plate',          label: 'Placa',     hint: 'mono' },
  { key: 'internal_code',  label: 'Cód.',      hint: 'mono' },
  { key: 'renavam',        label: 'RENAVAM',   hint: 'mono' },
  { key: 'model_brand',    label: 'Modelo / Marca' },
  { key: 'years',          label: 'Ano F/M',   hint: 'num' },
  { key: 'type',           label: 'Tipo' },
  { key: 'fuel',           label: 'Combustível' },
  { key: 'origin',         label: 'Origem' },
  { key: 'dept',           label: 'Secretaria' },
  { key: 'tank',           label: 'Tanque (L)', hint: 'num' },
  { key: 'km',             label: 'KM',         hint: 'num' },
  { key: 'conservation',   label: 'Conservação' },
];

async function printVeic() {
  const list = applyFilters();
  if (!list.length) { toast('Nenhum veículo para imprimir com os filtros atuais.', 'warning'); return; }
  const rows = list.map(v => {
    const type   = _types.find(t => t.code === v.vehicle_type_code);
    const fuel   = _fuels.find(f => f.code === v.fuel_type_code);
    const origin = _origins.find(o => o.code === v.vehicle_origin_code);
    return [
      formatPlate(v.plate),
      v.internal_code || '—',
      String(v.renavam || '').padStart(11, '0'),
      `${v.model || ''}${v.brand ? ' — ' + v.brand : ''}`,
      `${v.year_manufacture}/${v.year_model}`,
      type ? `${v.vehicle_type_code} - ${type.description}` : '—',
      fuel
        ? `${v.fuel_type_code} - ${fuel.description}${v.fuel_subtype_id ? ' (' + fuelLabel(v.fuel_type_code, v.fuel_subtype_id) + ')' : ''}`
        : '—',
      origin ? `${v.vehicle_origin_code} - ${origin.description}` : '—',
      v.department?.acronym || '—',
      v.tank_capacity != null ? Number(v.tank_capacity).toFixed(2) : '—',
      Number(v.current_km || 0).toLocaleString('pt-BR'),
      v.conservation_state || '—',
    ];
  });
  await printList({
    title: 'Relação de Veículos',
    columns: PRINT_COLUMNS.map(c => c.label),
    colHints: PRINT_COLUMNS.map(c => c.hint || ''),
    rows,
    filtersLabel: describeActiveFilters(),
  });
}

// =============================================================================
// MODAL DE CADASTRO/EDIÇÃO
// =============================================================================
function openVeicModal(id) {
  const editing = !!id;
  const v = editing ? _items.find(x => x.id === id) : null;
  const body = `
    <form id="veic-form" autocomplete="off">
      ${section('🪪 Identificação')}
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Placa <span class="req">*</span></label>
          <input class="input" name="plate" required maxlength="8" value="${esc(formatPlate(v?.plate))}"
                 placeholder="ABC-1234 ou ABC1D23"
                 oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9-]/g,'').slice(0,8)">
          <span class="field-help">Antiga (<code>ABC-1234</code>) ou Mercosul (<code>ABC1D23</code>). O hífen é opcional.</span>
        </div>
        <div class="field">
          <label class="field-label">RENAVAM <span class="req">*</span></label>
          <input class="input" name="renavam" required maxlength="11" inputmode="numeric"
                 value="${esc(v?.renavam || '')}"
                 oninput="this.value=this.value.replace(/\\D/g,'').slice(0,11)">
          <span class="field-help">Exatamente 11 dígitos.</span>
        </div>
        <div class="field">
          <label class="field-label">Código interno</label>
          <input class="input" name="internal_code" readonly
                 value="${esc(v?.internal_code || nextInternalCode())}"
                 style="background:var(--surface-alt);color:var(--text-soft)">
          <span class="field-help">Gerado automaticamente.</span>
        </div>
        <div class="field">
          <label class="field-label">Chassi</label>
          <input class="input" name="chassis" value="${esc(v?.chassis || '')}"
                 oninput="this.value=this.value.toUpperCase()">
        </div>
      </div>

      ${section('🚙 Veículo')}
      <div class="form-grid">
        <div class="field col-full">
          <label class="field-label">Modelo <span class="req">*</span></label>
          <input class="input" name="model" required minlength="3" maxlength="120"
                 value="${esc(v?.model || '')}" placeholder="ex: Strada CS 1.4">
        </div>
        <div class="field">
          <label class="field-label">Marca</label>
          <input class="input" name="brand" value="${esc(v?.brand || '')}" placeholder="ex: Fiat">
        </div>
        <div class="field">
          <label class="field-label">Tipo <span class="req">*</span></label>
          <select class="select" name="vehicle_type_code" required id="veic-type-select">
            ${_types.map(t => `<option value="${t.code}" ${v?.vehicle_type_code === t.code ? 'selected' : ''}>${esc(t.description)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field-label">Ano de fabricação <span class="req">*</span></label>
          <input class="input" name="year_manufacture" type="number" required
                 min="1900" max="${new Date().getFullYear()}"
                 value="${v?.year_manufacture || new Date().getFullYear()}">
        </div>
        <div class="field">
          <label class="field-label">Ano do modelo <span class="req">*</span></label>
          <input class="input" name="year_model" type="number" required
                 min="1900" max="${new Date().getFullYear() + 1}"
                 value="${v?.year_model || new Date().getFullYear()}">
        </div>
        <div class="field">
          <label class="field-label">Combustível <span class="req">*</span></label>
          <select class="select" id="veic-fuel-combo" required>
            <option value="">— Selecione —</option>
            ${fuelOptionsHTML({ fuel_type_code: v?.fuel_type_code, fuel_subtype_id: v?.fuel_subtype_id }, true)}
          </select>
          <input type="hidden" name="fuel_type_code" value="${v?.fuel_type_code ?? ''}">
          <input type="hidden" name="fuel_subtype_id" value="${v?.fuel_subtype_id ?? ''}">
          <span class="field-help">Subtipos (Diesel S10, Gasolina Aditivada…) são opções internas; exportações TCE usam só o combustível-pai.</span>
        </div>
        <div class="field">
          <label class="field-label">Capacidade do tanque (L)</label>
          <input class="input" name="tank_capacity" type="number" step="0.01" min="0.01" max="999.99"
                 value="${v?.tank_capacity ?? ''}">
        </div>
      </div>

      ${section('🏛️ Operacional')}
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Origem <span class="req">*</span></label>
          <select class="select" name="vehicle_origin_code" required id="veic-origin-select">
            ${_origins.map(o => `<option value="${o.code}" ${v?.vehicle_origin_code === o.code ? 'selected' : ''}>${esc(o.description)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field-label">Secretaria</label>
          <select class="select" name="department_id">
            <option value="">— Nenhuma —</option>
            ${_depts.map(d => `<option value="${d.id}" ${v?.department_id === d.id ? 'selected' : ''}>${esc(d.acronym)} — ${esc(d.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field-label">KM atual</label>
          <input class="input" name="current_km" type="number" min="0" max="99999999"
                 value="${v?.current_km ?? 0}">
        </div>
        <div class="field">
          <label class="field-label">Estado de conservação</label>
          <select class="select" name="conservation_state">
            <option value="">—</option>
            ${CONSERV.map(c => `<option ${v?.conservation_state === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field-label">Data de aquisição</label>
          <input class="input" name="acquisition_date" type="date" value="${v?.acquisition_date || ''}">
        </div>
      </div>

      <div id="block-cedido" style="display:none">
        ${section('📋 Cessão (origem: Cedido)')}
        <div class="form-grid">
          <div class="field col-full">
            <label class="field-label">Órgão de destino</label>
            <input class="input" name="cession_destination_organ" value="${esc(v?.cession_destination_organ || '')}">
          </div>
          <div class="field">
            <label class="field-label">Data início cessão</label>
            <input class="input" name="cession_start_date" type="date" value="${v?.cession_start_date || ''}">
          </div>
          <div class="field">
            <label class="field-label">Data fim cessão</label>
            <input class="input" name="cession_end_date" type="date" value="${v?.cession_end_date || ''}">
          </div>
        </div>
      </div>

      <div id="block-locado" style="display:none">
        ${section('📋 Contrato de locação (origem: Locado/Sublocado)')}
        <div class="form-grid">
          <div class="field">
            <label class="field-label">CPF ou CNPJ do locador <span class="req">*</span></label>
            <input class="input" name="lessor_doc" value="${esc(v?.lessor_doc || '')}"
                   placeholder="só dígitos (11 ou 14)"
                   oninput="this.value=this.value.replace(/\\D/g,'').slice(0,14)">
          </div>
          <div class="field">
            <label class="field-label">Nome do locador <span class="req">*</span></label>
            <input class="input" name="lessor_name" value="${esc(v?.lessor_name || '')}">
          </div>
          <div class="field">
            <label class="field-label">Valor mensal (R$) <span class="req">*</span></label>
            <input class="input" name="monthly_value" type="number" step="0.01" min="0.01"
                   value="${v?.monthly_value ?? ''}">
          </div>
          <div class="field">
            <label class="field-label">Possui motorista? <span class="req">*</span></label>
            <select class="select" name="has_driver">
              <option value="false" ${v?.has_driver === false ? 'selected' : ''}>Não</option>
              <option value="true"  ${v?.has_driver === true ? 'selected' : ''}>Sim</option>
            </select>
          </div>
          <div class="field col-full">
            <label class="field-label">Código CW (contrato) <span class="req">*</span></label>
            <input class="input" name="cw_contract_code" value="${esc(v?.cw_contract_code || '')}"
                   placeholder="CW-XXXXXX/XX">
            <span class="field-help">Padrão: <code>CW-</code> + 6 dígitos + <code>/</code> + 2 dígitos.</span>
          </div>
          <div class="field">
            <label class="field-label">Início da locação</label>
            <input class="input" name="lessor_lease_start_date" type="date" value="${v?.lessor_lease_start_date || ''}">
          </div>
          <div class="field">
            <label class="field-label">Fim da locação</label>
            <input class="input" name="lessor_lease_end_date" type="date" value="${v?.lessor_lease_end_date || ''}">
          </div>
        </div>
      </div>

      ${section('📝 Observações')}
      <div class="field">
        <textarea class="textarea" name="notes" placeholder="Notas internas…">${esc(v?.notes || '')}</textarea>
      </div>

      <div id="veic-form-errors" class="login-error" style="display:none;margin-top:12px"></div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="veic-save-btn">${editing ? 'Salvar alterações' : 'Cadastrar veículo'}</button>
  `;
  const m = openModal({ title: editing ? 'Editar veículo' : 'Novo veículo', body, footer, size: 'lg' });

  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#veic-save-btn').addEventListener('click', () => saveVeic(editing ? id : null));

  const originSel = m.querySelector('#veic-origin-select');
  const typeSel = m.querySelector('#veic-type-select');
  const fuelSel = m.querySelector('#veic-fuel-combo');
  originSel.addEventListener('change', updateConditionalBlocks);
  typeSel.addEventListener('change', () => {
    if (Number(typeSel.value) === 99) applyOutrosDefaults(m);
  });
  fuelSel.addEventListener('change', () => {
    const { fuel_type_code, fuel_subtype_id } = decFuelValue(fuelSel.value);
    m.querySelector('[name="fuel_type_code"]').value = fuel_type_code ?? '';
    m.querySelector('[name="fuel_subtype_id"]').value = fuel_subtype_id ?? '';
  });
  updateConditionalBlocks();

  function updateConditionalBlocks() {
    const o = Number(originSel.value);
    document.getElementById('block-cedido').style.display = (o === 2) ? '' : 'none';
    document.getElementById('block-locado').style.display = (o === 3 || o === 4) ? '' : 'none';
  }
}

function applyOutrosDefaults(modal) {
  const plateIn = modal.querySelector('[name="plate"]');
  const renavamIn = modal.querySelector('[name="renavam"]');
  if (!cleanPlate(plateIn.value).startsWith('XYZ')) plateIn.value = 'XYZ-0000';
  renavamIn.value = '99999999999';
}

function section(label) {
  return `<div style="font-size:12px;font-weight:600;color:var(--primary);
                margin:16px 0 10px;padding-top:12px;
                border-top:1px dashed var(--border)">${label}</div>`;
}

// =============================================================================
// SAVE / DELETE
// =============================================================================
async function saveVeic(id) {
  const form = document.getElementById('veic-form');
  const errBox = document.getElementById('veic-form-errors');
  errBox.style.display = 'none';
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const v = formValues(form);
  v.plate = cleanPlate(v.plate); // normaliza removendo hífen antes de validar
  const errors = validateClient(v);
  if (errors.length) {
    errBox.innerHTML = '⚠️ ' + errors.join('<br>⚠️ ');
    errBox.style.display = 'block';
    return;
  }

  const origin = Number(v.vehicle_origin_code);
  const payload = {
    plate: v.plate,
    renavam: v.renavam,
    internal_code: v.internal_code || null,
    chassis: v.chassis || null,
    model: v.model,
    brand: v.brand || null,
    year_manufacture: Number(v.year_manufacture),
    year_model: Number(v.year_model),
    vehicle_type_code: Number(v.vehicle_type_code),
    fuel_type_code: Number(v.fuel_type_code),
    fuel_subtype_id: v.fuel_subtype_id ? Number(v.fuel_subtype_id) : null,
    vehicle_origin_code: origin,
    department_id: v.department_id || null,
    tank_capacity: v.tank_capacity ? Number(v.tank_capacity) : null,
    current_km: Number(v.current_km || 0),
    conservation_state: v.conservation_state || null,
    acquisition_date: v.acquisition_date || null,
    notes: v.notes || null,
    // condicionais
    cession_destination_organ: origin === 2 ? (v.cession_destination_organ || null) : null,
    cession_start_date: origin === 2 ? (v.cession_start_date || null) : null,
    cession_end_date:   origin === 2 ? (v.cession_end_date   || null) : null,
    lessor_doc:         (origin === 3 || origin === 4) ? (v.lessor_doc || null) : null,
    lessor_name:        (origin === 3 || origin === 4) ? (v.lessor_name || null) : null,
    monthly_value:      (origin === 3 || origin === 4) ? Number(v.monthly_value || 0) : null,
    has_driver:         (origin === 3 || origin === 4) ? (v.has_driver === 'true') : null,
    cw_contract_code:   (origin === 3 || origin === 4) ? (v.cw_contract_code || null) : null,
    lessor_lease_start_date: (origin === 3 || origin === 4) ? (v.lessor_lease_start_date || null) : null,
    lessor_lease_end_date:   (origin === 3 || origin === 4) ? (v.lessor_lease_end_date   || null) : null,
  };

  const btn = document.getElementById('veic-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';
  try {
    let error;
    if (id) ({ error } = await supabase.from('vehicle').update(payload).eq('id', id));
    else    ({ error } = await supabase.from('vehicle').insert(payload));
    if (error) throw error;
    toast(id ? 'Veículo atualizado.' : 'Veículo cadastrado.', 'success');
    closeModal();
    await loadAll();
    renderTable();
  } catch (err) {
    errBox.innerHTML = '⚠️ ' + friendlyError(err);
    errBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = id ? 'Salvar alterações' : 'Cadastrar veículo';
  }
}

function validateClient(v) {
  const errs = [];
  const yearNow = new Date().getFullYear();
  const tipo = Number(v.vehicle_type_code);
  const af = Number(v.year_manufacture);
  const am = Number(v.year_model);

  // placa
  const plate = (v.plate || '').toUpperCase();
  const reNormal = /^[A-Z]{3}[0-9]{4}$/;
  const reMercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/;
  if (!reNormal.test(plate) && !reMercosul.test(plate)) errs.push('Placa em formato inválido.');

  // renavam
  if (!/^\d{11}$/.test(v.renavam || '')) errs.push('RENAVAM deve ter 11 dígitos.');

  // anos
  if (af > am) errs.push('Ano de fabricação não pode ser maior que ano do modelo.');
  if (af > yearNow) errs.push('Ano de fabricação não pode ser maior que o ano corrente.');
  if (am > yearNow + 1) errs.push('Ano do modelo não pode ser maior que ano corrente + 1.');

  // OUTROS (TCE 517 §1.1.8/1.1.9)
  if (tipo === 99) {
    if (v.renavam !== '99999999999') errs.push('Tipo OUTROS exige RENAVAM = 99999999999.');
    if (!plate.startsWith('XYZ'))     errs.push('Tipo OUTROS exige placa começando com XYZ.');
  } else {
    if (v.renavam === '99999999999') errs.push('RENAVAM sentinela 99999999999 só é válido para tipo OUTROS.');
    if (plate.startsWith('XYZ')) errs.push('Placas começando com XYZ são reservadas ao tipo OUTROS.');
  }

  // Locado/Sublocado
  const o = Number(v.vehicle_origin_code);
  if (o === 3 || o === 4) {
    const doc = (v.lessor_doc || '').replace(/\D/g, '');
    if (!/^(\d{11}|\d{14})$/.test(doc)) errs.push('CPF (11) ou CNPJ (14) do locador inválido.');
    if (!v.lessor_name) errs.push('Nome do locador obrigatório.');
    if (Number(v.monthly_value || 0) <= 0) errs.push('Valor mensal deve ser maior que zero.');
    if (!/^CW-\d{6}\/\d{2}$/.test(v.cw_contract_code || '')) errs.push('Código CW no formato CW-XXXXXX/XX.');
    const dIni = v.lessor_lease_start_date, dFim = v.lessor_lease_end_date;
    if (dIni && dFim && dFim < dIni) errs.push('Fim da locação anterior ao início.');
  }

  // Cedido
  if (o === 2) {
    const dIni = v.cession_start_date, dFim = v.cession_end_date;
    if (dIni && dFim && dFim < dIni) errs.push('Fim da cessão anterior ao início.');
  }

  return errs;
}

async function deleteVeic(id) {
  const v = _items.find(x => x.id === id);
  if (!v) return;
  const ok = await confirmDialog({
    title: 'Excluir veículo',
    message: `Excluir o veículo ${formatPlate(v.plate)} — ${v.model}? Esta ação não pode ser desfeita.`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.from('vehicle').delete().eq('id', id);
  if (error) { toast(friendlyError(error), 'error'); return; }
  toast('Veículo excluído.', 'success');
  await loadAll();
  renderTable();
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (err?.code === '23505' || /duplicate key|already exists|unique/i.test(msg)) {
    return 'Já existe um veículo com essa placa ou código interno.';
  }
  if (err?.code === '23503' || /foreign key/i.test(msg)) {
    return 'Não é possível excluir: há autorizações, abastecimentos ou manutenções vinculados a este veículo.';
  }
  if (/chk_outros_consistency/.test(msg))  return 'Veículo tipo OUTROS exige placa XYZ + RENAVAM 99999999999.';
  if (/chk_lease_required_fields/.test(msg)) return 'Veículo locado exige CPF/CNPJ, locador, valor mensal, motorista e código CW.';
  if (/chk_lease_dates/.test(msg))         return 'Fim da locação deve ser ≥ início da locação.';
  if (/chk_cession_dates/.test(msg))       return 'Fim da cessão deve ser ≥ início da cessão.';
  if (/chk_years_consistent/.test(msg))    return 'Ano de fabricação não pode ser maior que ano do modelo.';
  if (/chk_year_mfg_max/.test(msg))        return 'Ano de fabricação maior que o ano corrente.';
  if (/chk_year_mdl_max/.test(msg))        return 'Ano do modelo maior que o ano corrente + 1.';
  if (/chk_plate_format/.test(msg))        return 'Placa em formato inválido (ABC1234 ou ABC1D23).';
  if (/chk_renavam_digits/.test(msg))      return 'RENAVAM deve ter exatamente 11 dígitos.';
  return msg;
}
