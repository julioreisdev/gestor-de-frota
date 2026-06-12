import { pageRoot, pageHeader, getEntity } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, fmtMoney, toast, openModal, closeModal, confirmDialog, formValues, formatPlate } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile, isAdmin } from '../auth.js';

let _items = [];
let _vehicles = [];
let _suppliers = [];
let _supplierFuels = [];
let _fuels = [];
let _fuelSubs = [];
let _depts = [];
let _emittedAuths = []; // só as 'emitida' pra import
let _filter = { search: '', vehicle: '', dept: '', supplier: '', fuel: '', month: '' };

// =============================================================================
// PÁGINA
// =============================================================================
export async function renderAbastecimentos() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Abastecimentos',
      subtitle: 'Registre consumos — a partir de uma autorização ou avulso.',
      actionsHtml: `
        <button class="btn btn-outline" id="btn-rep-por-sec" title="Relatório de abastecimento agrupado por secretaria">
          <span style="width:16px;height:16px;display:inline-flex">${icons.printer}</span>
          <span>Relatório por Secretaria</span>
        </button>
        <button class="btn btn-outline" id="btn-import-aut">
          <span style="width:16px;height:16px;display:inline-flex">${icons.clipboard}</span>
          <span>Importar autorização</span>
        </button>
        <button class="btn btn-primary" id="btn-new-abs">
          <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span>
          Registrar manual
        </button>`,
    })}
    <div id="abs-stats"></div>
    <div class="card">
      <div class="table-toolbar">
        <div class="search ${_filter.search ? 'has-value' : ''}" id="abs-search-box">
          ${icons.search}
          <input id="abs-search" type="search"
                 placeholder="Buscar por placa, fornecedor, responsável…"
                 autocomplete="off" value="${esc(_filter.search)}">
          <button class="clear" id="abs-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="abs-count"></div>
      </div>
      <div class="filter-chips">
        <select class="select chip" id="ff-veh"><option value="">Todos veículos</option></select>
        <select class="select chip" id="ff-dept"><option value="">Todas secretarias</option></select>
        <select class="select chip" id="ff-sup"><option value="">Todos fornecedores</option></select>
        <select class="select chip" id="ff-fuel"><option value="">Todos combustíveis</option></select>
        <input class="input chip" type="month" id="ff-month" value="${esc(_filter.month)}">
        <button class="btn btn-ghost btn-sm" id="ff-clear" hidden>Limpar filtros</button>
      </div>
      <div id="abs-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  document.getElementById('btn-new-abs').addEventListener('click', () => openAbsModal());
  document.getElementById('btn-import-aut').addEventListener('click', () => openImportModal());
  document.getElementById('btn-rep-por-sec').addEventListener('click', () => printAbastecimentosPorSec());

  const sBox = document.getElementById('abs-search-box');
  const sIn = document.getElementById('abs-search');
  document.getElementById('abs-search-clear').addEventListener('click', () => {
    _filter.search = ''; sIn.value = ''; sBox.classList.remove('has-value'); renderTable();
  });
  sIn.addEventListener('input', (e) => {
    _filter.search = e.target.value || '';
    sBox.classList.toggle('has-value', !!_filter.search);
    renderTable();
  });
  document.getElementById('ff-veh').addEventListener('change',  e => { _filter.vehicle  = e.target.value; updateClear(); renderTable(); renderStats(); });
  document.getElementById('ff-dept').addEventListener('change', e => { _filter.dept     = e.target.value; updateClear(); renderTable(); renderStats(); });
  document.getElementById('ff-sup').addEventListener('change',  e => { _filter.supplier = e.target.value; updateClear(); renderTable(); renderStats(); });
  document.getElementById('ff-fuel').addEventListener('change', e => { _filter.fuel     = e.target.value; updateClear(); renderTable(); renderStats(); });
  document.getElementById('ff-month').addEventListener('change',e => { _filter.month    = e.target.value; updateClear(); renderTable(); renderStats(); });
  document.getElementById('ff-clear').addEventListener('click', () => {
    _filter = { search: _filter.search, vehicle: '', dept: '', supplier: '', fuel: '', month: '' };
    ['ff-veh', 'ff-dept', 'ff-sup', 'ff-fuel', 'ff-month'].forEach(id => document.getElementById(id).value = '');
    updateClear(); renderTable(); renderStats();
  });

  await loadAll();
  fillFilterSelects();
  renderStats();
  renderTable();
}

function updateClear() {
  const any = _filter.vehicle || _filter.dept || _filter.supplier || _filter.fuel || _filter.month;
  document.getElementById('ff-clear').hidden = !any;
}

async function loadAll() {
  const [a, v, s, sf, ft, fs, d, ea] = await Promise.all([
    supabase.from('fueling').select(`
      id, authorization_id, vehicle_id, supplier_id, fuel_type_code, fuel_subtype_id,
      date, quantity, unit_price, total, km_initial, km_final,
      responsible_name, notes,
      vehicle_plate_snapshot, department_acronym_snapshot, supplier_trade_name_snapshot,
      created_at,
      authorization:authorization_id(number)
    `).is('deleted_at', null).order('date', { ascending: false }).order('created_at', { ascending: false }),
    supabase.from('vehicle').select(`
      id, plate, model, brand, current_km, tank_capacity, fuel_type_code, fuel_subtype_id,
      department_id, department:department_id(acronym, name)
    `).is('deleted_at', null).order('plate'),
    supabase.from('supplier').select('id, kind, legal_name, trade_name, cnpj').in('kind', ['posto','ambos']).order('legal_name'),
    supabase.from('supplier_fuel').select('supplier_id, fuel_type_code, fuel_subtype_id, unit_price, contract_amount, current_balance'),
    supabase.from('fuel_type').select('code, description').order('code'),
    supabase.from('fuel_subtype').select('id, fuel_type_code, description, active').eq('active', true).order('description'),
    supabase.from('department').select('id, acronym, name').order('acronym'),
    supabase.from('fueling_authorization').select(`
      id, number, date, vehicle_id, supplier_id, fuel_type_code, fuel_subtype_id,
      authorized_quantity, unit_price_snapshot, responsible_name,
      vehicle_plate_snapshot, vehicle_model_snapshot, supplier_trade_name_snapshot
    `).eq('status', 'emitida').is('deleted_at', null).order('date', { ascending: false }),
  ]);
  if (a.error) { toast('Falha ao carregar abastecimentos: ' + a.error.message, 'error'); _items = []; }
  else _items = a.data || [];
  _vehicles = v.data || [];
  _suppliers = s.data || [];
  _supplierFuels = sf.data || [];
  _fuels = ft.data || [];
  _fuelSubs = fs.data || [];
  _depts = d.data || [];
  _emittedAuths = ea.data || [];
}

function fillFilterSelects() {
  document.getElementById('ff-veh').innerHTML = '<option value="">Todos veículos</option>' +
    _vehicles.map(v => `<option value="${v.id}">${esc(formatPlate(v.plate))} — ${esc(v.model)}</option>`).join('');
  document.getElementById('ff-dept').innerHTML = '<option value="">Todas secretarias</option>' +
    _depts.map(d => `<option value="${d.id}">${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');
  document.getElementById('ff-sup').innerHTML = '<option value="">Todos fornecedores</option>' +
    _suppliers.map(s => `<option value="${s.id}">${esc(s.trade_name || s.legal_name)}</option>`).join('');
  document.getElementById('ff-fuel').innerHTML = '<option value="">Todos combustíveis</option>' +
    _fuels.map(f => `<option value="${f.code}">${esc(f.description)}</option>`).join('');
  if (_filter.vehicle) document.getElementById('ff-veh').value = _filter.vehicle;
  if (_filter.dept)    document.getElementById('ff-dept').value = _filter.dept;
  if (_filter.supplier) document.getElementById('ff-sup').value = _filter.supplier;
  if (_filter.fuel)    document.getElementById('ff-fuel').value = _filter.fuel;
  updateClear();
}

function fuelLabel(code, subId) {
  if (subId) {
    const s = _fuelSubs.find(x => x.id === subId);
    if (s) return s.description;
  }
  return _fuels.find(f => f.code === code)?.description || `Cód ${code}`;
}

function applyFilters() {
  const t = (_filter.search || '').toLowerCase();
  return _items.filter(a => {
    if (_filter.vehicle && a.vehicle_id !== _filter.vehicle) return false;
    if (_filter.supplier && a.supplier_id !== _filter.supplier) return false;
    if (_filter.fuel && String(a.fuel_type_code) !== String(_filter.fuel)) return false;
    if (_filter.month && String(a.date).slice(0, 7) !== _filter.month) return false;
    if (_filter.dept) {
      const veh = _vehicles.find(x => x.id === a.vehicle_id);
      if (veh?.department_id !== _filter.dept) return false;
    }
    if (!t) return true;
    return (a.vehicle_plate_snapshot || '').toLowerCase().includes(t)
        || (a.supplier_trade_name_snapshot || '').toLowerCase().includes(t)
        || (a.responsible_name || '').toLowerCase().includes(t);
  });
}

function renderStats() {
  const filtered = applyFilters();
  const totalLit = filtered.reduce((s, a) => s + Number(a.quantity || 0), 0);
  const totalVal = filtered.reduce((s, a) => s + Number(a.total || 0), 0);
  document.getElementById('abs-stats').innerHTML = `
    <div class="stat-row" style="margin-bottom:var(--s-4)">
      <div class="stat"><label>Registros</label><strong>${filtered.length}</strong></div>
      <div class="stat"><label>Total litros</label><strong>${totalLit.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</strong></div>
      <div class="stat"><label>Valor total</label><strong style="color:var(--success)">${fmtMoney(totalVal)}</strong></div>
    </div>
  `;
}

function renderTable() {
  const box = document.getElementById('abs-tablebox');
  const countEl = document.getElementById('abs-count');
  if (!_items.length) {
    if (countEl) countEl.textContent = '';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.droplet}</div>
        <div class="empty-state-title">Nenhum abastecimento</div>
        <p class="empty-state-text">Importe de uma autorização ou registre manualmente.</p>
      </div>`;
    return;
  }
  const filtered = applyFilters();
  if (countEl) {
    const any = _filter.search || _filter.vehicle || _filter.dept || _filter.supplier || _filter.fuel || _filter.month;
    countEl.textContent = any ? `${filtered.length} de ${_items.length} registro(s)` : `${_items.length} registro(s)`;
  }
  if (!filtered.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.search}</div>
        <div class="empty-state-title">Nenhum resultado</div>
      </div>`;
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Veículo</th>
            <th>Combustível</th>
            <th>Qtd</th>
            <th>R$/L</th>
            <th>Total</th>
            <th>KM</th>
            <th>Fornecedor</th>
            <th>Origem</th>
            <th class="actions-col">Ações</th>
          </tr>
        </thead>
        <tbody>${filtered.map(absRow).join('')}</tbody>
      </table>
    </div>
  `;
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openAbsModal(b.dataset.id)));
  box.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteAbs(b.dataset.id)));
}

function absRow(a) {
  const kmDelta = (a.km_initial != null && a.km_final != null) ? Math.max(0, a.km_final - a.km_initial) : null;
  const km = (a.km_initial != null || a.km_final != null)
    ? `<div class="cell-stack"><span>${a.km_initial != null ? Number(a.km_initial).toLocaleString('pt-BR') : '—'} → ${a.km_final != null ? Number(a.km_final).toLocaleString('pt-BR') : '—'}</span>${kmDelta != null ? `<span style="color:var(--text-muted);font-size:11px">${kmDelta.toLocaleString('pt-BR')} km</span>` : ''}</div>`
    : '—';
  const origin = a.authorization?.number
    ? `<span class="badge" style="font-family:ui-monospace,monospace;font-size:10.5px">${esc(a.authorization.number)}</span>`
    : `<span class="badge badge-neutral">manual</span>`;
  return `
    <tr>
      <td data-label="Data" style="white-space:nowrap">${esc(fmtDate(a.date))}</td>
      <td data-label="Veículo"><strong>${esc(formatPlate(a.vehicle_plate_snapshot))}</strong></td>
      <td data-label="Combustível">${esc(fuelLabel(a.fuel_type_code, a.fuel_subtype_id))}</td>
      <td data-label="Qtd" style="white-space:nowrap">${Number(a.quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L</td>
      <td data-label="R$/L" style="white-space:nowrap">${Number(a.unit_price).toFixed(3)}</td>
      <td data-label="Total" style="white-space:nowrap;color:var(--success);font-weight:500">${fmtMoney(a.total)}</td>
      <td data-label="KM">${km}</td>
      <td data-label="Fornecedor" style="font-size:12.5px">${esc(a.supplier_trade_name_snapshot || '—')}</td>
      <td data-label="Origem">${origin}</td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" data-id="${a.id}" title="Editar">${icons.edit}</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="delete" data-id="${a.id}" title="Excluir" style="color:var(--danger)">${icons.trash}</button>` : ''}
        </div>
      </td>
    </tr>`;
}

// =============================================================================
// MODAL: IMPORTAR DE AUTORIZAÇÃO
// =============================================================================
function openImportModal() {
  if (!_emittedAuths.length) {
    toast('Nenhuma autorização emitida disponível para importar.', 'info');
    return;
  }
  const body = `
    <p style="font-size:13px;color:var(--text-soft);margin-bottom:var(--s-4)">
      Selecione uma autorização emitida. Os dados serão pré-preenchidos no próximo passo.
    </p>
    <div class="table-toolbar" style="margin-bottom:var(--s-3)">
      <div class="search has-value" style="max-width:none">
        ${icons.search}
        <input id="imp-search" type="search" placeholder="Buscar por nº, placa…" autocomplete="off">
      </div>
    </div>
    <div id="imp-list" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r-md)"></div>
  `;
  const footer = `<button class="btn btn-outline" data-cancel>Cancelar</button>`;
  const m = openModal({ title: 'Importar de autorização', body, footer, size: 'lg' });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);

  const listEl = m.querySelector('#imp-list');
  const renderList = (term = '') => {
    const t = term.toLowerCase();
    const filtered = _emittedAuths.filter(a =>
      !t ||
      (a.number || '').toLowerCase().includes(t) ||
      (a.vehicle_plate_snapshot || '').toLowerCase().includes(t) ||
      (a.supplier_trade_name_snapshot || '').toLowerCase().includes(t)
    );
    if (!filtered.length) {
      listEl.innerHTML = `<div style="padding:var(--s-5);text-align:center;color:var(--text-muted);font-size:13px">Nenhuma autorização encontrada.</div>`;
      return;
    }
    listEl.innerHTML = filtered.map(a => `
      <button type="button" class="imp-row" data-id="${a.id}" style="
        display:flex;justify-content:space-between;align-items:center;width:100%;
        padding:var(--s-3) var(--s-4);border-bottom:1px solid var(--border);
        background:var(--surface);text-align:left;transition:background var(--transition)">
        <div>
          <div style="font-family:ui-monospace,monospace;font-weight:700;color:var(--primary);font-size:13px">${esc(a.number)}</div>
          <div style="font-size:12px;color:var(--text-soft);margin-top:2px">
            ${esc(formatPlate(a.vehicle_plate_snapshot))} — ${esc(a.vehicle_model_snapshot)} ·
            ${esc(fuelLabel(a.fuel_type_code, a.fuel_subtype_id))} ·
            ${Number(a.authorized_quantity).toFixed(2)} L
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ${esc(fmtDate(a.date))} · ${esc(a.supplier_trade_name_snapshot)} · ${esc(a.responsible_name)}
          </div>
        </div>
        <span style="color:var(--primary)">${icons.chevronRight}</span>
      </button>
    `).join('');
    listEl.querySelectorAll('.imp-row').forEach(btn => {
      btn.addEventListener('mouseenter', () => btn.style.background = 'var(--primary-tint)');
      btn.addEventListener('mouseleave', () => btn.style.background = 'var(--surface)');
      btn.addEventListener('click', () => {
        closeModal();
        const a = _emittedAuths.find(x => x.id === btn.dataset.id);
        openAbsModal(null, a);
      });
    });
  };
  m.querySelector('#imp-search').addEventListener('input', e => renderList(e.target.value));
  renderList();
}

// =============================================================================
// MODAL: NOVO/EDITAR ABASTECIMENTO
// =============================================================================
function openAbsModal(id, fromAuth = null) {
  const editing = !!id;
  const a = editing ? _items.find(x => x.id === id) : null;
  const me = getProfile();
  const today = new Date().toISOString().slice(0, 10);

  // Pré-preenchimento conforme origem
  let initial;
  if (editing) {
    initial = {
      date: a.date,
      vehicle_id: a.vehicle_id,
      supplier_id: a.supplier_id,
      fuel_type_code: a.fuel_type_code,
      fuel_subtype_id: a.fuel_subtype_id,
      quantity: a.quantity,
      unit_price: a.unit_price,
      km_initial: a.km_initial,
      km_final: a.km_final,
      responsible_name: a.responsible_name,
      notes: a.notes,
      authorization_id: a.authorization_id,
      _maxQty: null,
    };
  } else if (fromAuth) {
    const veh = _vehicles.find(v => v.id === fromAuth.vehicle_id);
    initial = {
      date: fromAuth.date || today,   // data da autorização (editável)
      vehicle_id: fromAuth.vehicle_id,
      supplier_id: fromAuth.supplier_id,
      fuel_type_code: fromAuth.fuel_type_code,
      fuel_subtype_id: fromAuth.fuel_subtype_id,
      quantity: fromAuth.authorized_quantity,
      unit_price: fromAuth.unit_price_snapshot,
      km_initial: veh?.current_km ?? null,
      km_final: veh?.current_km ?? null,
      responsible_name: fromAuth.responsible_name,
      notes: 'Importado da autorização ' + fromAuth.number,
      authorization_id: fromAuth.id,
      _maxQty: Number(fromAuth.authorized_quantity),
    };
  } else {
    initial = {
      date: today,
      vehicle_id: '', supplier_id: '', fuel_type_code: '', fuel_subtype_id: '',
      quantity: '', unit_price: '', km_initial: '', km_final: '',
      responsible_name: me?.full_name || '',
      notes: '', authorization_id: null, _maxQty: null,
    };
  }

  const isLinked = !!initial.authorization_id;
  const vehOptions = '<option value="">— Selecione —</option>' +
    _vehicles.map(v => `<option value="${v.id}" ${initial.vehicle_id === v.id ? 'selected' : ''}>${esc(formatPlate(v.plate))} — ${esc(v.model)} (${esc(v.department?.acronym || '—')})</option>`).join('');
  const supOptions = '<option value="">— Selecione —</option>' +
    _suppliers.map(s => `<option value="${s.id}" ${initial.supplier_id === s.id ? 'selected' : ''}>${esc(s.trade_name || s.legal_name)}</option>`).join('');

  const body = `
    <form id="abs-form" autocomplete="off">
      ${isLinked ? `
        <div class="alert" style="background:var(--primary-tint);border-left:3px solid var(--primary);padding:var(--s-3) var(--s-4);border-radius:var(--r-md);margin-bottom:var(--s-4);font-size:13px">
          <strong>Vinculado à autorização</strong>${fromAuth ? ` <span style="font-family:ui-monospace,monospace;color:var(--primary)">${esc(fromAuth.number)}</span>` : ''}<br>
          <span style="color:var(--text-muted);font-size:12px">Quantidade não pode exceder ${initial._maxQty != null ? Number(initial._maxQty).toFixed(2) + ' L (autorizado)' : 'o autorizado'}.</span>
        </div>` : ''}
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Data <span class="req">*</span></label>
          <input class="input" name="date" type="date" required value="${initial.date}">
        </div>
        <div class="field">
          <label class="field-label">Responsável <span class="req">*</span></label>
          <input class="input" name="responsible_name" required value="${esc(initial.responsible_name || '')}">
        </div>
        <div class="field col-full">
          <label class="field-label">Veículo <span class="req">*</span></label>
          <select class="select" name="vehicle_id" id="abs-veh" required ${isLinked ? 'disabled' : ''}>${vehOptions}</select>
          <input type="hidden" name="vehicle_id_h" value="${initial.vehicle_id}">
          <div id="abs-veh-info" class="field-help" style="margin-top:4px"></div>
        </div>
        <div class="field col-full">
          <label class="field-label">Fornecedor <span class="req">*</span></label>
          <select class="select" name="supplier_id" id="abs-sup" required ${isLinked ? 'disabled' : ''}>${supOptions}</select>
          <input type="hidden" name="supplier_id_h" value="${initial.supplier_id}">
        </div>
        <div class="field col-full">
          <label class="field-label">Combustível <span class="req">*</span></label>
          <select class="select" id="abs-fuel" required ${isLinked ? 'disabled' : ''}>
            <option value="">Selecione veículo e fornecedor primeiro…</option>
          </select>
          <input type="hidden" name="fuel_type_code"  value="${initial.fuel_type_code || ''}">
          <input type="hidden" name="fuel_subtype_id" value="${initial.fuel_subtype_id || ''}">
        </div>
        <div class="field">
          <label class="field-label">Quantidade (L) <span class="req">*</span></label>
          <input class="input" name="quantity" type="number" step="0.01" min="0.01"
                 ${initial._maxQty != null ? `max="${initial._maxQty}"` : ''}
                 required value="${initial.quantity ?? ''}" placeholder="0,00">
        </div>
        <div class="field">
          <label class="field-label">Valor unitário (R$/L) <span class="req">*</span></label>
          <input class="input" name="unit_price" type="number" step="0.001" min="0"
                 required value="${initial.unit_price ?? ''}" placeholder="0,000">
        </div>
        <div class="field">
          <label class="field-label">KM inicial</label>
          <input class="input" name="km_initial" type="number" min="0" max="99999999" value="${initial.km_initial ?? ''}">
        </div>
        <div class="field">
          <label class="field-label">KM final</label>
          <input class="input" name="km_final" type="number" min="0" max="99999999" value="${initial.km_final ?? ''}">
        </div>
        <div class="field col-full">
          <label class="field-label">Total estimado</label>
          <input class="input" readonly id="abs-total-est" value="—">
        </div>
        <div class="field col-full">
          <label class="field-label">Observações</label>
          <textarea class="textarea" name="notes" rows="2">${esc(initial.notes || '')}</textarea>
        </div>
      </div>
      <div id="abs-errors" class="login-error" style="display:none;margin-top:12px"></div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="abs-save-btn">${editing ? 'Salvar alterações' : 'Registrar abastecimento'}</button>
  `;
  const m = openModal({ title: editing ? 'Editar abastecimento' : (isLinked ? 'Concluir abastecimento' : 'Registrar abastecimento'), body, footer, size: 'lg' });

  const vehSel  = m.querySelector('#abs-veh');
  const supSel  = m.querySelector('#abs-sup');
  const fuelSel = m.querySelector('#abs-fuel');
  const vehHid  = m.querySelector('[name="vehicle_id_h"]');
  const supHid  = m.querySelector('[name="supplier_id_h"]');
  const ftHid   = m.querySelector('[name="fuel_type_code"]');
  const fsHid   = m.querySelector('[name="fuel_subtype_id"]');
  const qtyIn   = m.querySelector('[name="quantity"]');
  const upIn    = m.querySelector('[name="unit_price"]');
  const kmiIn   = m.querySelector('[name="km_initial"]');
  const vehInfoEl = m.querySelector('#abs-veh-info');
  const totalEst  = m.querySelector('#abs-total-est');

  function refreshVehInfo() {
    const v = _vehicles.find(x => x.id === vehSel.value || x.id === vehHid.value);
    if (!v) { vehInfoEl.textContent = ''; return; }
    vehInfoEl.innerHTML = `Tanque: <b>${v.tank_capacity ? Number(v.tank_capacity).toFixed(0) + ' L' : '—'}</b> · KM atual: <b>${Number(v.current_km || 0).toLocaleString('pt-BR')}</b>`;
    if (!isLinked && !editing && (kmiIn.value === '' || kmiIn.value === null)) {
      kmiIn.value = v.current_km || 0;
    }
  }
  function refreshFuelOptions() {
    const supId = supSel.value || supHid.value;
    if (!supId) { fuelSel.innerHTML = '<option value="">Selecione um fornecedor</option>'; return; }
    const fuels = _supplierFuels.filter(sf => sf.supplier_id === supId);
    if (!fuels.length) { fuelSel.innerHTML = '<option value="">Sem combustíveis cadastrados</option>'; return; }
    fuelSel.innerHTML = '<option value="">— Selecione —</option>' + fuels.map(sf => {
      const key = `${sf.fuel_type_code}|${sf.fuel_subtype_id ?? ''}`;
      const sel = Number(ftHid.value) === sf.fuel_type_code && Number(fsHid.value || 0) === Number(sf.fuel_subtype_id || 0);
      return `<option value="${key}" ${sel ? 'selected' : ''}>${esc(fuelLabel(sf.fuel_type_code, sf.fuel_subtype_id))} — R$ ${Number(sf.unit_price).toFixed(3)}/L</option>`;
    }).join('');
  }
  function setHiddenIds() {
    vehHid.value = vehSel.value || vehHid.value;
    supHid.value = supSel.value || supHid.value;
  }
  function refreshFuelHidden() {
    const [c, s] = (fuelSel.value || '').split('|');
    ftHid.value = c || ftHid.value;
    fsHid.value = s || '';
    // ao escolher combustível, sugere o unit_price do fornecedor
    if (!editing && c) {
      const sf = _supplierFuels.find(x => x.supplier_id === (supSel.value || supHid.value)
        && x.fuel_type_code === Number(c)
        && (x.fuel_subtype_id ?? null) === (s ? Number(s) : null));
      if (sf && (upIn.value === '' || upIn.value == 0)) upIn.value = sf.unit_price;
    }
  }
  function refreshTotal() {
    const q = Number(qtyIn.value), u = Number(upIn.value);
    totalEst.value = (q > 0 && u > 0) ? fmtMoney(q * u) : '—';
  }

  vehSel.addEventListener('change', () => { setHiddenIds(); refreshVehInfo(); });
  supSel.addEventListener('change', () => { setHiddenIds(); refreshFuelOptions(); });
  fuelSel.addEventListener('change', () => { refreshFuelHidden(); refreshTotal(); });
  qtyIn.addEventListener('input', refreshTotal);
  upIn.addEventListener('input', refreshTotal);

  refreshVehInfo();
  refreshFuelOptions();
  refreshTotal();

  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#abs-save-btn').addEventListener('click', () => saveAbs(id, initial));
}

async function saveAbs(id, initial) {
  const form = document.getElementById('abs-form');
  const errBox = document.getElementById('abs-errors');
  errBox.style.display = 'none';
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const v = formValues(form);
  // Pega valores dos hidden quando selects estavam disabled
  const vehicle_id = v.vehicle_id || v.vehicle_id_h || initial.vehicle_id;
  const supplier_id = v.supplier_id || v.supplier_id_h || initial.supplier_id;
  const fuel_type_code = Number(v.fuel_type_code || initial.fuel_type_code);
  const fuel_subtype_id = v.fuel_subtype_id ? Number(v.fuel_subtype_id) : (initial.fuel_subtype_id || null);

  if (!vehicle_id || !supplier_id || !fuel_type_code) {
    errBox.innerHTML = '⚠️ Selecione veículo, fornecedor e combustível.';
    errBox.style.display = 'block'; return;
  }
  const qty = Number(v.quantity);
  if (initial?._maxQty && qty > Number(initial._maxQty)) {
    errBox.innerHTML = `⚠️ Quantidade excede o autorizado (${Number(initial._maxQty).toFixed(2)} L).`;
    errBox.style.display = 'block'; return;
  }
  const kmi = v.km_initial ? Number(v.km_initial) : null;
  const kmf = v.km_final ? Number(v.km_final) : null;
  if (kmi != null && kmf != null && kmi > kmf) {
    errBox.innerHTML = '⚠️ KM inicial maior que KM final.';
    errBox.style.display = 'block'; return;
  }

  // Snapshots
  const veh = _vehicles.find(x => x.id === vehicle_id);
  const sup = _suppliers.find(x => x.id === supplier_id);
  const payload = {
    authorization_id: initial?.authorization_id || null,
    vehicle_id, supplier_id,
    fuel_type_code, fuel_subtype_id,
    date: v.date,
    quantity: qty,
    unit_price: Number(v.unit_price),
    km_initial: kmi, km_final: kmf,
    responsible_name: v.responsible_name,
    notes: v.notes || null,
    vehicle_plate_snapshot: veh?.plate || '',
    department_acronym_snapshot: veh?.department?.acronym || null,
    supplier_trade_name_snapshot: sup?.trade_name || sup?.legal_name || '',
  };

  const btn = document.getElementById('abs-save-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando...';
  try {
    let error;
    if (id) ({ error } = await supabase.from('fueling').update(payload).eq('id', id));
    else    ({ error } = await supabase.from('fueling').insert(payload));
    if (error) throw error;
    toast(id ? 'Abastecimento atualizado.' : 'Abastecimento registrado.', 'success');
    closeModal();
    await loadAll(); renderStats(); renderTable();
  } catch (err) {
    errBox.innerHTML = '⚠️ ' + (err.message || 'Erro ao salvar.');
    errBox.style.display = 'block';
    btn.disabled = false; btn.textContent = id ? 'Salvar alterações' : 'Registrar abastecimento';
  }
}

async function deleteAbs(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const linked = a.authorization?.number ? ` (vinculado à autorização ${a.authorization.number})` : '';
  const ok = await confirmDialog({
    title: 'Excluir abastecimento',
    message: `Excluir o abastecimento de ${formatPlate(a.vehicle_plate_snapshot)} em ${fmtDate(a.date)}${linked}? Se for o único do vínculo, a autorização volta para "Emitida".`,
    confirmText: 'Excluir', danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.from('fueling').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Abastecimento excluído.', 'success');
  await loadAll(); renderStats(); renderTable();
}

// =============================================================================
// RELATÓRIO POR SECRETARIA — respeita os filtros aplicados na página
// Abre PDF imprimível com abastecimentos agrupados, incluindo Nº autorização.
// =============================================================================
async function printAbastecimentosPorSec() {
  const filtered = applyFilters();
  if (!filtered.length) { toast('Sem abastecimentos para imprimir.', 'warning'); return; }
  // Agrupa por secretaria
  const groups = new Map();
  for (const a of filtered) {
    const v = _vehicles.find(x => x.id === a.vehicle_id);
    const key = v?.department_id || '__sem__';
    if (!groups.has(key)) {
      groups.set(key, {
        acronym: v?.department?.acronym || 'SEM',
        name: v?.department?.name || 'Sem secretaria',
        items: [],
      });
    }
    groups.get(key).items.push(a);
  }
  const sortedGroups = [...groups.values()]
    .map(g => ({
      ...g,
      total: g.items.reduce((s, i) => s + Number(i.total || 0), 0),
      litros: g.items.reduce((s, i) => s + Number(i.quantity || 0), 0),
    }))
    .sort((a, b) => b.total - a.total);
  const grandTotal = sortedGroups.reduce((s, g) => s + g.total, 0);
  const grandLit = sortedGroups.reduce((s, g) => s + g.litros, 0);

  const entity = await getEntity();
  const orgao = entity?.organ_name || 'Prefeitura Municipal';
  const logo = new URL('logo.png', location.href).href;
  const ibge = entity?.ibge_code || '';
  const now = new Date().toLocaleString('pt-BR');
  const period = (_filter.month ? `Mês: ${_filter.month}` : 'Todos os períodos');

  const w = window.open('', '_blank', 'width=1200,height=900');
  if (!w) { toast('Permita popups pra imprimir.', 'error'); return; }
  const groupsHTML = sortedGroups.map(g => `
    <h2 class="group">${esc(g.acronym)} — ${esc(g.name)}
      <span class="meta">${g.items.length} abast. · ${g.litros.toLocaleString('pt-BR',{maximumFractionDigits:2})} L · R$ ${g.total.toLocaleString('pt-BR',{minimumFractionDigits:2})}</span>
    </h2>
    <table class="data"><thead><tr>
      <th>Data</th><th>Nº Autorização</th><th>Placa</th><th>Combustível</th>
      <th class="num">Qtd (L)</th><th class="num">R$/L</th><th class="num">Total</th>
      <th>Responsável</th><th>Fornecedor</th>
    </tr></thead><tbody>
      ${g.items.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(a => `<tr>
        <td>${esc(fmtDate(a.date))}</td>
        <td class="mono">${esc(a.authorization?.number || '—')}</td>
        <td><b>${esc(formatPlate(a.vehicle_plate_snapshot))}</b></td>
        <td>${esc(_fuels.find(f => f.code === a.fuel_type_code)?.description || `Cód ${a.fuel_type_code}`)}</td>
        <td class="num">${Number(a.quantity).toFixed(2)}</td>
        <td class="num">${Number(a.unit_price).toFixed(3)}</td>
        <td class="num"><b>R$ ${Number(a.total).toLocaleString('pt-BR',{minimumFractionDigits:2})}</b></td>
        <td>${esc(a.responsible_name || '')}</td>
        <td>${esc(a.supplier_trade_name_snapshot || '')}</td>
      </tr>`).join('')}
    </tbody></table>
  `).join('');

  w.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Abastecimentos por Secretaria</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#1A2A3A; margin:0; font-size:10px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr { display:flex; align-items:center; gap:14px; padding:10px 0; border-bottom:2px solid #217AD8; margin-bottom:14px; }
  .hdr img { width:50px; height:50px; object-fit:contain; }
  .hdr .org { font-size:10px; color:#475569; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .hdr .title { font-size:17px; font-weight:700; color:#0F172A; margin-top:2px; }
  .hdr .meta { font-size:10px; color:#64748B; margin-top:4px; display:flex; gap:14px; flex-wrap:wrap; }
  .hdr .meta b { color:#1A2A3A; font-weight:600; }
  h2.group { font-size:12px; font-weight:700; color:#fff; background:#1A65B5; margin:14px 0 0; padding:6px 10px; border-radius:4px 4px 0 0; display:flex; align-items:center; justify-content:space-between; page-break-after:avoid; }
  h2.group .meta { font-size:10px; font-weight:500; opacity:.9; }
  table.data { width:100%; border-collapse:collapse; font-size:9px; page-break-inside:auto; margin-bottom:6px; }
  table.data th { background:#EAF2FB; color:#1A2A3A; text-align:left; padding:4px 6px; font-weight:600; font-size:8.5px; text-transform:uppercase; letter-spacing:.02em; border-bottom:1px solid #C9D6E8; }
  table.data td { padding:3px 6px; border-bottom:1px solid #E5E9F0; vertical-align:top; }
  table.data tr:nth-child(even) td { background:#F8FAFC; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.mono { font-family:ui-monospace,'SF Mono',Menlo,monospace; font-size:9px; }
  .totals { margin-top:14px; padding:8px 12px; background:#EAF2FB; border-left:3px solid #1A65B5; font-size:11px; font-weight:600; color:#0F172A; }
  .footer { margin-top:14px; padding-top:6px; border-top:1px solid #E5E9F0; font-size:8px; color:#94A3B8; text-align:center; }
</style></head><body>
  <div class="hdr">
    <img src="${esc(logo)}" alt="">
    <div>
      <div class="org">${esc(entity?.entity_type || '')}</div>
      <div class="title">Abastecimentos por Secretaria</div>
      <div class="meta">
        <span><b>${esc(orgao)}</b></span>
        ${ibge ? `<span>IBGE ${esc(ibge)}</span>` : ''}
        <span>${esc(period)}</span>
        <span>Gerado em ${esc(now)}</span>
      </div>
    </div>
  </div>
  ${groupsHTML}
  <div class="totals">
    Total geral: ${filtered.length} abastecimento(s) · ${grandLit.toLocaleString('pt-BR',{maximumFractionDigits:2})} L · R$ ${grandTotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}
  </div>
  <div class="footer">Gerir Frota · ${esc(now)}</div>
  <script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 400);</script>
</body></html>`);
  w.document.close();
}
