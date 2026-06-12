import { getEntity } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, fmtMoney, toast, openModal, closeModal, confirmDialog, formValues, formatPlate } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile, isAdmin } from '../auth.js';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

const STATUS_LABEL = { emitida: 'Emitida', utilizada: 'Utilizada', cancelada: 'Cancelada' };
const STATUS_BADGE = { emitida: 'badge badge-warning', utilizada: 'badge badge-success', cancelada: 'badge badge-danger' };
const isFornecedor = () => getProfile()?.role === 'fornecedor';

let _items = [];
let _serviceItems = []; // só pra somar no card de limite mensal
let _vehicles = [];
let _usersWithLimit = []; // usuários ativos com limite mensal > 0 (admin vê)
let _limitFilter = { user: '', month: '' };
let _suppliers = [];
let _supplierFuels = []; // expandido: {supplier_id, fuel_type_code, fuel_subtype_id, unit_price, contract_amount, current_balance}
let _fuels = [];
let _fuelSubs = [];
let _depts = [];
let _filter = { search: '', status: '', month: '' };

// =============================================================================
// ABA DE ABASTECIMENTO — renderiza dentro de um container fornecido
// =============================================================================
export async function renderFuelingTab(container) {
  container.innerHTML = `
    <div class="page-header" style="margin-bottom:var(--s-4)">
      <div>
        <p class="page-subtitle" style="margin-top:0">${isFornecedor()
          ? 'Consulte as autorizações de combustível vinculadas a você.'
          : 'Emita, imprima, gere QR Code e gerencie autorizações de combustível.'}</p>
      </div>
      <div class="page-actions">
        ${isFornecedor() ? '' : `
        <button class="btn btn-primary" id="btn-new-aut">
          <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span>
          Emitir autorização
        </button>`}
      </div>
    </div>
    <div id="limit-card-slot"></div>
    <div class="card">
      <div class="table-toolbar">
        <div class="search ${_filter.search ? 'has-value' : ''}" id="aut-search-box">
          ${icons.search}
          <input id="aut-search" type="search"
                 placeholder="Buscar por nº, placa, fornecedor, responsável…"
                 autocomplete="off" value="${esc(_filter.search)}">
          <button class="clear" id="aut-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="aut-count"></div>
      </div>
      <div class="filter-chips">
        <select class="select chip" id="ff-status">
          <option value="">Todas situações</option>
          <option value="emitida">Emitida</option>
          <option value="utilizada">Utilizada</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <input class="input chip" type="month" id="ff-month"
               value="${esc(_filter.month)}">
        <button class="btn btn-ghost btn-sm" id="ff-clear" hidden>Limpar filtros</button>
      </div>
      <div id="aut-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  const btnNew = document.getElementById('btn-new-aut');
  if (btnNew) btnNew.addEventListener('click', () => openAutModal());

  const sBox = document.getElementById('aut-search-box');
  const sIn = document.getElementById('aut-search');
  document.getElementById('aut-search-clear').addEventListener('click', () => {
    _filter.search = ''; sIn.value = ''; sBox.classList.remove('has-value'); renderTable();
  });
  sIn.addEventListener('input', (e) => {
    _filter.search = e.target.value || '';
    sBox.classList.toggle('has-value', !!_filter.search);
    renderTable();
  });

  document.getElementById('ff-status').addEventListener('change', (e) => {
    _filter.status = e.target.value;
    updateFilterClearVisibility();
    renderTable();
  });
  document.getElementById('ff-month').addEventListener('change', (e) => {
    _filter.month = e.target.value;
    updateFilterClearVisibility();
    renderTable();
    renderLimitCard();
  });
  document.getElementById('ff-clear').addEventListener('click', () => {
    _filter = { search: _filter.search, status: '', month: '' };
    document.getElementById('ff-status').value = '';
    document.getElementById('ff-month').value = '';
    updateFilterClearVisibility();
    renderTable();
  });

  await loadAll();
  if (_filter.status) document.getElementById('ff-status').value = _filter.status;
  updateFilterClearVisibility();
  renderLimitCard();
  renderTable();
}

function updateFilterClearVisibility() {
  const any = _filter.status || _filter.month;
  document.getElementById('ff-clear').hidden = !any;
}

// =============================================================================
// CARGA DE DADOS
// =============================================================================
async function loadAll() {
  const me = getProfile();
  // Autorizações de manutenção: admin puxa de todos pra mostrar cards multi-user;
  // usuario puxa só as próprias. Filtra por created_by (uuid, match exato).
  const srvBaseQuery = supabase.from('service_authorization')
    .select('created_by, estimated_value, date, status')
    .in('status', ['emitida', 'utilizada'])
    .is('deleted_at', null);
  const srvPromise = isAdmin()
    ? srvBaseQuery
    : (me?.id ? srvBaseQuery.eq('created_by', me.id) : Promise.resolve({ data: [] }));
  // Admin precisa da lista de usuários com limite > 0 pra renderizar cards
  const usersPromise = isAdmin()
    ? supabase.rpc('admin_list_users')
    : Promise.resolve({ data: [] });
  const [a, v, s, sf, ft, fs, d, srv, users] = await Promise.all([
    supabase.from('fueling_authorization').select(`
      id, number, date, status,
      vehicle_id, supplier_id, fuel_type_code, fuel_subtype_id,
      authorized_quantity, unit_price_snapshot, estimated_total,
      responsible_name, notes, created_by,
      vehicle_plate_snapshot, vehicle_model_snapshot,
      department_acronym_snapshot, supplier_trade_name_snapshot,
      qr_payload, created_at
    `).is('deleted_at', null).order('date', { ascending: false }).order('number', { ascending: false }),
    supabase.from('vehicle').select(`
      id, plate, model, brand, tank_capacity, current_km,
      fuel_type_code, fuel_subtype_id, department_id, vehicle_origin_code,
      department:department_id(acronym, name)
    `).is('deleted_at', null).order('plate'),
    supabase.from('supplier').select(`
      id, kind, legal_name, trade_name, cnpj, responsible_name, phone
    `).order('legal_name'),
    supabase.from('supplier_fuel').select(`
      supplier_id, fuel_type_code, fuel_subtype_id,
      unit_price, contract_amount, current_balance
    `),
    supabase.from('fuel_type').select('code, description').order('code'),
    supabase.from('fuel_subtype').select('id, fuel_type_code, description, active').eq('active', true).order('description'),
    supabase.from('department').select('id, acronym, name').order('acronym'),
    srvPromise,
    usersPromise,
  ]);
  if (a.error) { toast('Falha ao carregar autorizações: ' + a.error.message, 'error'); _items = []; }
  else _items = a.data || [];
  _vehicles = v.data || [];
  _suppliers = s.data || [];
  _supplierFuels = sf.data || [];
  _fuels = ft.data || [];
  _fuelSubs = fs.data || [];
  _depts = d.data || [];
  _serviceItems = srv?.data || [];
  _usersWithLimit = (users?.data || []).filter(u => u.active && Number(u.monthly_authorization_limit || 0) > 0);
}

// =============================================================================
// HELPERS
// =============================================================================
function fuelLabel(code, subId) {
  if (subId) {
    const s = _fuelSubs.find(x => x.id === subId);
    if (s) return s.description;
  }
  return _fuels.find(f => f.code === code)?.description || `Cód ${code}`;
}

function encFuelKey(code, subId) { return `${code ?? ''}|${subId ?? ''}`; }
function decFuelKey(k) {
  const [c, s] = String(k || '').split('|');
  return { fuel_type_code: c ? Number(c) : null, fuel_subtype_id: s ? Number(s) : null };
}

function getSupplierFuels(supplierId) {
  return _supplierFuels.filter(sf => sf.supplier_id === supplierId);
}

function findSupplierFuel(supplierId, code, subId) {
  return _supplierFuels.find(sf =>
    sf.supplier_id === supplierId &&
    sf.fuel_type_code === code &&
    (sf.fuel_subtype_id ?? null) === (subId ?? null)
  );
}

// Mapeamento de compatibilidade veículo → combustíveis aceitos na autorização.
// fuel_type_code (vehicle) → array de fuel_type_code (autorização permitida).
// null = sem restrição (veículo não tem combustível definido).
function compatibleFuels(vehicleFuelCode) {
  switch (Number(vehicleFuelCode)) {
    case 1: return [1];        // Gasolina
    case 2: return [2];        // Álcool
    case 3: return [3];        // Eletricidade
    case 4: return [4];        // Diesel
    case 5: return [1, 2];     // Flex (gasolina ou álcool)
    case 6: return [6];        // GNV
    case 7: return [1, 2, 3];  // Híbrido (gasolina, álcool ou eletricidade)
    default: return null;
  }
}

// =============================================================================
// CARDS DE LIMITE MENSAL
// Admin: vê todos os usuários com limite > 0; filtra por usuário e mês.
// Usuario: vê só o seu próprio card; filtra por mês.
// =============================================================================
function computeUsage(userId, refMonth) {
  const usadoComb = _items
    .filter(a => a.created_by === userId
      && (a.status === 'emitida' || a.status === 'utilizada')
      && String(a.date).slice(0, 7) === refMonth)
    .reduce((s, a) => s + Number(a.estimated_total || 0), 0);
  const usadoServ = _serviceItems
    .filter(a => a.created_by === userId
      && String(a.date).slice(0, 7) === refMonth)
    .reduce((s, a) => s + Number(a.estimated_value || 0), 0);
  return usadoComb + usadoServ;
}

function singleLimitCard({ name, limit, usado, refMonth }) {
  const disp = Math.max(0, limit - usado);
  const pct = limit > 0 ? Math.min(100, Math.round(usado / limit * 100)) : 0;
  const cor = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
  const corBg = pct >= 100 ? 'var(--danger-bg, #FEE2E2)' : pct >= 80 ? 'var(--warning-bg, #FEF3C7)' : 'var(--success-bg, #DCFCE7)';
  return `
    <div class="limit-card" style="border-left:4px solid ${cor}">
      <div class="limit-card-head">
        <div class="limit-card-id">
          <span class="limit-icon" style="background:${corBg};color:${cor}">${icons.banknote}</span>
          <div>
            <div class="limit-label">Limite mensal — ${esc(refMonth)}</div>
            <div class="limit-name">${esc(name)}</div>
          </div>
        </div>
        <div class="limit-numbers">
          <div><div class="n-label">Utilizado</div><strong style="color:${cor}">${fmtMoney(usado)}</strong></div>
          <div><div class="n-label">Disponível</div><strong style="color:${disp <= 0 ? 'var(--danger)' : 'var(--success)'}">${fmtMoney(disp)}</strong></div>
          <div><div class="n-label">Limite</div><strong>${fmtMoney(limit)}</strong></div>
        </div>
      </div>
      <div class="limit-bar"><div class="limit-bar-fill" style="width:${pct}%;background:${cor}"></div></div>
      <div class="limit-bar-pct" style="color:${cor}">${pct}%</div>
    </div>
  `;
}

function renderLimitCard() {
  const slot = document.getElementById('limit-card-slot');
  if (!slot) return;
  const me = getProfile();
  if (!me) { slot.innerHTML = ''; return; }
  const refMonth = _limitFilter.month || _filter.month || new Date().toISOString().slice(0, 7);

  if (isAdmin()) {
    // Modo admin: mostra todos os usuários com limite > 0 (ou um, se filtrado)
    const filterUser = _limitFilter.user;
    const users = _usersWithLimit.filter(u => !filterUser || u.id === filterUser);
    if (!_usersWithLimit.length) { slot.innerHTML = ''; return; }
    const cards = users.map(u => singleLimitCard({
      name: u.full_name + ' (' + u.username + ')',
      limit: Number(u.monthly_authorization_limit),
      usado: computeUsage(u.id, refMonth),
      refMonth,
    })).join('');
    const monthVal = _limitFilter.month || refMonth;
    slot.innerHTML = `
      <div class="card limit-wrapper">
        <div class="limit-toolbar">
          <h3>${icons.banknote} Limites mensais por responsável</h3>
          <div class="limit-toolbar-fields">
            <select class="select" id="limit-user" style="height:36px;width:auto;min-width:200px">
              <option value="">Todos os responsáveis</option>
              ${_usersWithLimit.map(u => `<option value="${u.id}" ${filterUser === u.id ? 'selected' : ''}>${esc(u.full_name)} (${esc(u.username)})</option>`).join('')}
            </select>
            <input class="input" type="month" id="limit-month" value="${esc(monthVal)}" style="height:36px;width:auto;min-width:160px">
            ${(filterUser || _limitFilter.month) ? `<button class="btn btn-ghost btn-sm" id="limit-clear">Limpar</button>` : ''}
          </div>
        </div>
        <div class="limit-grid">${cards || '<p style="padding:var(--s-3);color:var(--text-muted);font-size:13px">Nenhum usuário com limite no critério selecionado.</p>'}</div>
      </div>
    `;
    document.getElementById('limit-user')?.addEventListener('change', e => { _limitFilter.user = e.target.value; renderLimitCard(); });
    document.getElementById('limit-month')?.addEventListener('change', e => { _limitFilter.month = e.target.value; renderLimitCard(); });
    document.getElementById('limit-clear')?.addEventListener('click', () => { _limitFilter = { user: '', month: '' }; renderLimitCard(); });
    return;
  }

  // Modo usuario: 1 card + filtro de mês
  if (!me.monthly_authorization_limit || Number(me.monthly_authorization_limit) <= 0) {
    slot.innerHTML = ''; return;
  }
  const limit = Number(me.monthly_authorization_limit);
  const usado = computeUsage(me.id, refMonth);
  const monthVal = _limitFilter.month || refMonth;
  slot.innerHTML = `
    <div class="card limit-wrapper">
      <div class="limit-toolbar">
        <h3>${icons.banknote} Seu limite mensal</h3>
        <div class="limit-toolbar-fields">
          <input class="input" type="month" id="limit-month" value="${esc(monthVal)}" style="height:36px;width:auto;min-width:160px">
          ${_limitFilter.month ? `<button class="btn btn-ghost btn-sm" id="limit-clear">Limpar</button>` : ''}
        </div>
      </div>
      <div class="limit-grid">${singleLimitCard({ name: me.full_name, limit, usado, refMonth })}</div>
    </div>
  `;
  document.getElementById('limit-month')?.addEventListener('change', e => { _limitFilter.month = e.target.value; renderLimitCard(); });
  document.getElementById('limit-clear')?.addEventListener('click', () => { _limitFilter = { user: '', month: '' }; renderLimitCard(); });
}

// =============================================================================
// FILTROS + RENDER
// =============================================================================
function applyFilters() {
  const t = (_filter.search || '').toLowerCase();
  return _items.filter(a => {
    if (_filter.status && a.status !== _filter.status) return false;
    if (_filter.month && String(a.date).slice(0, 7) !== _filter.month) return false;
    if (!t) return true;
    return (a.number || '').toLowerCase().includes(t)
        || (a.vehicle_plate_snapshot || '').toLowerCase().includes(t)
        || (a.supplier_trade_name_snapshot || '').toLowerCase().includes(t)
        || (a.responsible_name || '').toLowerCase().includes(t);
  });
}

function renderTable() {
  const box = document.getElementById('aut-tablebox');
  const countEl = document.getElementById('aut-count');

  if (!_items.length) {
    if (countEl) countEl.textContent = '';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.clipboard}</div>
        <div class="empty-state-title">Nenhuma autorização emitida</div>
        <p class="empty-state-text">Clique em "Emitir autorização" para criar a primeira.</p>
      </div>`;
    return;
  }

  const filtered = applyFilters();
  if (countEl) {
    const any = _filter.search || _filter.status || _filter.month;
    countEl.textContent = any
      ? `${filtered.length} de ${_items.length} autorização(ões)`
      : `${_items.length} autorização(ões)`;
  }

  if (!filtered.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.search}</div>
        <div class="empty-state-title">Nenhum resultado</div>
        <p class="empty-state-text">Nada encontrado com os filtros atuais.</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Nº / Data</th>
            <th>Veículo</th>
            <th>Combustível</th>
            <th>Qtd</th>
            <th>Valor est.</th>
            <th>Fornecedor</th>
            <th>Responsável</th>
            <th>Situação</th>
            <th class="actions-col">Ações</th>
          </tr>
        </thead>
        <tbody>${filtered.map(autRow).join('')}</tbody>
      </table>
    </div>
  `;
  box.querySelectorAll('[data-act="conclude"]').forEach(b => b.addEventListener('click', () => concludeFueling(b.dataset.id)));
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openAutModal(b.dataset.id)));
  box.querySelectorAll('[data-act="qr"]').forEach(b => b.addEventListener('click', () => openQRModal(b.dataset.id)));
  box.querySelectorAll('[data-act="print-a4"]').forEach(b => b.addEventListener('click', () => printAutA4(b.dataset.id)));
  box.querySelectorAll('[data-act="print-thermal"]').forEach(b => b.addEventListener('click', () => printAutThermal(b.dataset.id)));
  box.querySelectorAll('[data-act="cancel"]').forEach(b => b.addEventListener('click', () => cancelAut(b.dataset.id)));
  box.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteAut(b.dataset.id)));
}

function autRow(a) {
  const emitida = a.status === 'emitida';
  const veicInfo = `
    <div class="cell-stack">
      <strong>${esc(formatPlate(a.vehicle_plate_snapshot))}</strong>
      <span style="color:var(--text-muted);font-size:12px">${esc(a.vehicle_model_snapshot || '')}</span>
    </div>`;
  const dt = `
    <div class="cell-stack">
      <strong style="font-family:ui-monospace,monospace;color:var(--primary);font-size:12px">${esc(a.number)}</strong>
      <span style="color:var(--text-muted);font-size:12px">${esc(fmtDate(a.date))}</span>
    </div>`;
  return `
    <tr ${a.status === 'cancelada' ? 'style="opacity:.6"' : ''}>
      <td data-label="Nº / Data">${dt}</td>
      <td data-label="Veículo">${veicInfo}</td>
      <td data-label="Combustível">${esc(fuelLabel(a.fuel_type_code, a.fuel_subtype_id))}</td>
      <td data-label="Qtd" style="white-space:nowrap">${Number(a.authorized_quantity).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} L</td>
      <td data-label="Valor est." style="white-space:nowrap;color:var(--success);font-weight:500">${fmtMoney(a.estimated_total)}</td>
      <td data-label="Fornecedor" style="font-size:12.5px">${esc(a.supplier_trade_name_snapshot || '—')}</td>
      <td data-label="Responsável" style="font-size:12.5px">${esc(a.responsible_name)}</td>
      <td data-label="Situação"><span class="${STATUS_BADGE[a.status]}">${esc(STATUS_LABEL[a.status])}</span></td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="conclude"      data-id="${a.id}" title="Concluir (registrar abastecimento)" ${emitida ? '' : 'disabled'} style="color:var(--success)">${icons.check}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="qr"            data-id="${a.id}" title="Ver QR Code">${icons.qrcode}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="print-a4"      data-id="${a.id}" title="Imprimir A4">${icons.printer}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="print-thermal" data-id="${a.id}" title="Imprimir térmica 58mm">${icons.receipt}</button>
          ${isFornecedor() ? '' : `
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit"          data-id="${a.id}" title="Editar quantidade" ${emitida ? '' : 'disabled'}>${icons.edit}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="cancel"        data-id="${a.id}" title="Cancelar" ${emitida ? '' : 'disabled'} style="color:var(--warning)">${icons.ban}</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="delete"        data-id="${a.id}" title="Excluir" style="color:var(--danger)">${icons.trash}</button>` : ''}`}
        </div>
      </td>
    </tr>`;
}

// =============================================================================
// MODAL DE EMISSÃO / EDIÇÃO
// =============================================================================
function openAutModal(id) {
  const editing = !!id;
  const a = editing ? _items.find(x => x.id === id) : null;
  if (editing && a.status !== 'emitida') {
    toast('Apenas autorizações emitidas podem ser editadas.', 'warning'); return;
  }

  const me = getProfile();
  const today = new Date().toISOString().slice(0, 10);
  const defaultResp = me?.full_name || '';

  // Listas iniciais
  const vehOptions = '<option value="">— Selecione —</option>' +
    _vehicles.map(v => `<option value="${v.id}" ${a?.vehicle_id === v.id ? 'selected' : ''}>${esc(formatPlate(v.plate))} — ${esc(v.model)} (${esc(v.department?.acronym || '—')})</option>`).join('');
  const supOptions = '<option value="">— Selecione —</option>' +
    _suppliers.filter(s => s.kind !== 'mecanica')
      .map(s => `<option value="${s.id}" ${a?.supplier_id === s.id ? 'selected' : ''}>${esc(s.trade_name || s.legal_name)}</option>`).join('');

  const body = `
    <form id="aut-form" autocomplete="off">
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Data <span class="req">*</span></label>
          <input class="input" name="date" type="date" required value="${a?.date || today}" ${editing ? 'readonly' : ''}>
        </div>
        <div class="field">
          <label class="field-label">Responsável <span class="req">*</span></label>
          <input class="input" name="responsible_name" required value="${esc(a?.responsible_name || defaultResp)}" ${editing ? 'readonly' : ''}>
        </div>
        <div class="field col-full">
          <label class="field-label">Veículo <span class="req">*</span></label>
          <select class="select" name="vehicle_id" id="aut-vehicle" required ${editing ? 'disabled' : ''}>${vehOptions}</select>
          <div id="aut-vehicle-info" class="field-help" style="margin-top:4px"></div>
        </div>
        <div class="field col-full">
          <label class="field-label">Fornecedor <span class="req">*</span></label>
          <select class="select" name="supplier_id" id="aut-supplier" required ${editing ? 'disabled' : ''}>${supOptions}</select>
        </div>
        <div class="field col-full">
          <label class="field-label">Combustível <span class="req">*</span></label>
          <select class="select" id="aut-fuel-combo" required ${editing ? 'disabled' : ''}>
            <option value="">Selecione veículo e fornecedor primeiro…</option>
          </select>
          <input type="hidden" name="fuel_type_code"  id="aut-fuel-type"    value="${a?.fuel_type_code ?? ''}">
          <input type="hidden" name="fuel_subtype_id" id="aut-fuel-subtype" value="${a?.fuel_subtype_id ?? ''}">
          <div id="aut-saldo-info" class="field-help" style="margin-top:4px"></div>
        </div>
        <div class="field col-full">
          <label class="field-label">Quantidade (L) <span class="req">*</span></label>
          <input class="input" name="authorized_quantity" type="number" step="0.01" min="0.01"
                 required value="${a?.authorized_quantity ?? ''}" placeholder="0,00">
          <div id="aut-total-info" class="field-help" style="margin-top:4px"></div>
        </div>
        <div class="field col-full">
          <label class="field-label">Observações</label>
          <textarea class="textarea" name="notes" rows="2" ${editing ? 'readonly' : ''}>${esc(a?.notes || '')}</textarea>
        </div>
      </div>
      <div id="aut-errors" class="login-error" style="display:none;margin-top:12px"></div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="aut-save-btn">${editing ? 'Salvar quantidade' : 'Emitir autorização'}</button>
  `;
  const m = openModal({ title: editing ? `Editar Autorização ${a.number}` : 'Nova autorização', body, footer, size: 'lg' });

  const vehSel = m.querySelector('#aut-vehicle');
  const supSel = m.querySelector('#aut-supplier');
  const fuelSel = m.querySelector('#aut-fuel-combo');
  const fuelTypeIn = m.querySelector('#aut-fuel-type');
  const fuelSubIn  = m.querySelector('#aut-fuel-subtype');
  const qtyIn = m.querySelector('[name="authorized_quantity"]');
  const vehInfo = m.querySelector('#aut-vehicle-info');
  const saldoInfo = m.querySelector('#aut-saldo-info');
  const totalInfo = m.querySelector('#aut-total-info');

  function refreshVehicleInfo() {
    const v = _vehicles.find(x => x.id === vehSel.value);
    if (!v) { vehInfo.textContent = ''; return; }
    vehInfo.innerHTML = `Tanque: <b>${v.tank_capacity ? Number(v.tank_capacity).toFixed(0) + ' L' : '—'}</b> · KM atual: <b>${Number(v.current_km || 0).toLocaleString('pt-BR')}</b>`;
  }
  function refreshFuelOptions(initial = false) {
    const supId = supSel.value;
    if (!supId) {
      fuelSel.innerHTML = '<option value="">Selecione um fornecedor</option>';
      return;
    }
    const supFuels = getSupplierFuels(supId);
    if (!supFuels.length) {
      fuelSel.innerHTML = '<option value="">Fornecedor sem combustíveis cadastrados</option>';
      return;
    }
    // Filtra combustíveis compatíveis com o tipo do veículo. Ônibus diesel não
    // pode receber autorização de gasolina, por exemplo.
    const veh = _vehicles.find(x => x.id === vehSel.value);
    const allowed = compatibleFuels(veh?.fuel_type_code);
    const compatibleSupFuels = allowed
      ? supFuels.filter(sf => allowed.includes(sf.fuel_type_code))
      : supFuels;
    if (!compatibleSupFuels.length) {
      const vehFuelDesc = _fuels.find(f => f.code === veh?.fuel_type_code)?.description || '—';
      fuelSel.innerHTML = `<option value="">Fornecedor não vende combustível compatível (veículo: ${esc(vehFuelDesc)})</option>`;
      return;
    }
    const html = compatibleSupFuels.map(sf => {
      const key = encFuelKey(sf.fuel_type_code, sf.fuel_subtype_id);
      const sel = initial && Number(fuelTypeIn.value) === sf.fuel_type_code
                  && Number(fuelSubIn.value || 0) === Number(sf.fuel_subtype_id || 0);
      return `<option value="${key}" ${sel ? 'selected' : ''}>${esc(fuelLabel(sf.fuel_type_code, sf.fuel_subtype_id))} — R$ ${Number(sf.unit_price).toFixed(3)}/L</option>`;
    }).join('');
    fuelSel.innerHTML = '<option value="">— Selecione —</option>' + html;
    if (initial) refreshSaldo();
  }
  function refreshSaldo() {
    const supId = supSel.value;
    const { fuel_type_code, fuel_subtype_id } = decFuelKey(fuelSel.value);
    if (!supId || !fuel_type_code) { saldoInfo.innerHTML = ''; return; }
    const sf = findSupplierFuel(supId, fuel_type_code, fuel_subtype_id);
    if (!sf) { saldoInfo.innerHTML = ''; return; }
    const ilim = Number(sf.contract_amount) === 0;
    const pct = ilim ? 100 : Math.max(0, Math.round(Number(sf.current_balance) / Number(sf.contract_amount) * 100));
    const cor = ilim ? 'var(--text-muted)' : pct > 50 ? 'var(--success)' : pct > 20 ? 'var(--warning)' : 'var(--danger)';
    saldoInfo.innerHTML = ilim
      ? `Saldo do contrato: <b style="color:${cor}">ilimitado</b> · Preço: <b>R$ ${Number(sf.unit_price).toFixed(3)}/L</b>`
      : `Saldo: <b style="color:${cor}">${Number(sf.current_balance).toFixed(2)} L</b> de ${Number(sf.contract_amount).toFixed(2)} L (${pct}%) · Preço: <b>R$ ${Number(sf.unit_price).toFixed(3)}/L</b>`;
    refreshTotal();
  }
  function refreshTotal() {
    const supId = supSel.value;
    const { fuel_type_code, fuel_subtype_id } = decFuelKey(fuelSel.value);
    const sf = findSupplierFuel(supId, fuel_type_code, fuel_subtype_id);
    const q = Number(qtyIn.value);
    if (sf && q > 0) {
      totalInfo.innerHTML = `Valor estimado: <b style="color:var(--success)">${fmtMoney(q * Number(sf.unit_price))}</b>`;
    } else {
      totalInfo.innerHTML = '';
    }
  }

  vehSel.addEventListener('change', () => { refreshVehicleInfo(); refreshFuelOptions(); refreshSaldo(); });
  supSel.addEventListener('change', () => { refreshFuelOptions(); refreshSaldo(); });
  fuelSel.addEventListener('change', () => {
    const dec = decFuelKey(fuelSel.value);
    fuelTypeIn.value = dec.fuel_type_code ?? '';
    fuelSubIn.value = dec.fuel_subtype_id ?? '';
    refreshSaldo();
  });
  qtyIn.addEventListener('input', refreshTotal);

  // Inicialização (modo edição traz dados)
  if (editing) {
    refreshVehicleInfo();
    refreshFuelOptions(true);
    refreshSaldo();
    refreshTotal();
  } else {
    refreshVehicleInfo();
    refreshFuelOptions();
  }

  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#aut-save-btn').addEventListener('click', () => saveAut(editing ? id : null));
}

async function saveAut(id) {
  const form = document.getElementById('aut-form');
  const errBox = document.getElementById('aut-errors');
  if (errBox) errBox.style.display = 'none';
  if (!form || !form.checkValidity()) { form?.reportValidity(); return; }
  const v = formValues(form);

  // Aviso de duplicata: se já existe autorização emitida/utilizada do mesmo
  // veículo na mesma data, confirma antes (não bloqueia, só alerta).
  // IMPORTANTE: confirmDialog abre um novo modal — o sistema só suporta 1
  // modal por vez, então isso FECHA o modal de emissão. Após o confirm o
  // form não existe mais no DOM. Tratamos com `setDOM` guards abaixo.
  let formGone = false;
  if (!id) {
    const dup = _items.filter(a =>
      a.vehicle_id === v.vehicle_id
      && a.date === v.date
      && (a.status === 'emitida' || a.status === 'utilizada'));
    if (dup.length > 0) {
      const veh = _vehicles.find(x => x.id === v.vehicle_id);
      const ok = await confirmDialog({
        title: 'Veículo já tem autorização nesta data',
        message: `${dup.length} autorização(ões) já existe(m) para ${formatPlate(veh?.plate || '')} em ${fmtDate(v.date)} (${dup.map(d => d.number).join(', ')}). Emitir mesmo assim?`,
        confirmText: 'Emitir mesmo assim',
        cancelText: 'Cancelar',
      });
      if (!ok) return;
      formGone = true; // modal de emissão foi fechado pelo confirmDialog
    }
  }

  const btn = formGone ? null : document.getElementById('aut-save-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Salvando...';
  }

  try {
    if (id) {
      // Edição: muda apenas quantidade via RPC (recalcula saldo)
      const { error } = await supabase.rpc('update_authorization_quantity', {
        p_auth_id: id,
        p_new_qty: Number(v.authorized_quantity),
      });
      if (error) throw error;
      toast('Quantidade atualizada.', 'success');
    } else {
      // Emissão: RPC atômica
      const { data, error } = await supabase.rpc('emit_authorization', {
        p_date: v.date,
        p_vehicle_id: v.vehicle_id,
        p_supplier_id: v.supplier_id,
        p_fuel_type_code: Number(v.fuel_type_code),
        p_quantity: Number(v.authorized_quantity),
        p_responsible_name: v.responsible_name,
        p_notes: v.notes || null,
        p_fuel_subtype_id: v.fuel_subtype_id ? Number(v.fuel_subtype_id) : null,
      });
      if (error) throw error;
      toast('Autorização emitida.', 'success');
      // Abre QR Code automaticamente da nova autorização
      await loadAll();
      renderLimitCard();
      renderTable();
      closeModal();
      setTimeout(() => openQRModal(data), 200);
      return;
    }
    closeModal();
    await loadAll();
    renderLimitCard();
    renderTable();
  } catch (err) {
    // Se o modal de emissão ainda existe (caminho normal), mostra erro inline.
    // Se foi fechado pelo confirmDialog (duplicata), usa toast.
    const msg = err.message || 'Erro ao salvar.';
    if (errBox && document.body.contains(errBox)) {
      errBox.innerHTML = '⚠️ ' + msg;
      errBox.style.display = 'block';
    } else {
      toast(msg, 'error');
    }
    if (btn && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = id ? 'Salvar quantidade' : 'Emitir autorização';
    }
  }
}

// =============================================================================
// QR CODE MODAL
// =============================================================================
async function openQRModal(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const sup = _suppliers.find(s => s.id === a.supplier_id);
  const veh = _vehicles.find(v => v.id === a.vehicle_id);
  const body = `
    <div style="text-align:center">
      <div id="qr-canvas-wrap" style="display:flex;justify-content:center;margin-bottom:var(--s-4);min-height:280px;align-items:center">
        <div class="spinner" style="color:var(--primary)"></div>
      </div>
      <div style="background:var(--surface-alt);border-radius:var(--r-md);padding:var(--s-4);font-size:13px;line-height:1.7;text-align:left">
        <div style="font-family:ui-monospace,monospace;font-size:16px;font-weight:700;color:var(--primary);text-align:center;margin-bottom:var(--s-3)">${esc(a.number)}</div>
        <div><strong>Data:</strong> ${esc(fmtDate(a.date))} · <span class="${STATUS_BADGE[a.status]}">${esc(STATUS_LABEL[a.status])}</span></div>
        <div><strong>Veículo:</strong> ${esc(formatPlate(a.vehicle_plate_snapshot))} — ${esc(a.vehicle_model_snapshot)}</div>
        <div><strong>Combustível:</strong> ${esc(fuelLabel(a.fuel_type_code, a.fuel_subtype_id))}</div>
        <div><strong>Quantidade:</strong> ${Number(a.authorized_quantity).toFixed(2)} L</div>
        <div><strong>Valor estimado:</strong> ${fmtMoney(a.estimated_total)}</div>
        <div><strong>Fornecedor:</strong> ${esc(sup?.trade_name || sup?.legal_name || a.supplier_trade_name_snapshot)}</div>
        ${sup?.cnpj ? `<div><strong>CNPJ:</strong> ${esc(sup.cnpj)}</div>` : ''}
        <div><strong>Responsável:</strong> ${esc(a.responsible_name)}</div>
        ${a.notes ? `<div style="margin-top:var(--s-2);padding-top:var(--s-2);border-top:1px dashed var(--border)"><strong>Obs:</strong> ${esc(a.notes)}</div>` : ''}
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin-top:var(--s-3)">
        Aponte a câmera do frentista para o QR — os dados acima serão lidos automaticamente.
      </p>
    </div>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Fechar</button>
    <button class="btn btn-outline" id="qr-print-thermal">
      <span style="width:16px;height:16px;display:inline-flex">${icons.receipt}</span> Térmica
    </button>
    <button class="btn btn-primary" id="qr-print-a4">
      <span style="width:16px;height:16px;display:inline-flex">${icons.printer}</span> Imprimir A4
    </button>
  `;
  const m = openModal({ title: 'QR Code da autorização', body, footer });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#qr-print-a4').addEventListener('click', () => printAutA4(a.id));
  m.querySelector('#qr-print-thermal').addEventListener('click', () => printAutThermal(a.id));

  // Renderiza o QR
  try {
    const canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, a.qr_payload, { width: 280, margin: 1, errorCorrectionLevel: 'M' });
    const wrap = m.querySelector('#qr-canvas-wrap');
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
  } catch (e) {
    m.querySelector('#qr-canvas-wrap').innerHTML = `<p style="color:var(--danger)">Erro ao gerar QR: ${esc(e.message)}</p>`;
  }
}

// =============================================================================
// AÇÃO: CONCLUIR (cria fueling vinculado e marca aut. como utilizada)
// =============================================================================
function concludeFueling(id) {
  const a = _items.find(x => x.id === id);
  if (!a || a.status !== 'emitida') return;
  const veh = _vehicles.find(v => v.id === a.vehicle_id);
  // Data padrão = data da autorização (editável). Usuário pode mudar.
  const defaultDate = a.date || new Date().toISOString().slice(0, 10);
  const body = `
    <p style="font-size:13px;color:var(--text-soft);margin-bottom:var(--s-3)">
      Registrando abastecimento para <strong style="font-family:ui-monospace,monospace;color:var(--primary)">${esc(a.number)}</strong>
      — ${esc(formatPlate(a.vehicle_plate_snapshot))} ${esc(a.vehicle_model_snapshot)} ·
      ${esc(fuelLabel(a.fuel_type_code, a.fuel_subtype_id))}
    </p>
    <form id="conclude-form" autocomplete="off">
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Data <span class="req">*</span></label>
          <input class="input" name="date" type="date" required value="${defaultDate}">
        </div>
        <div class="field">
          <label class="field-label">Quantidade real (L) <span class="req">*</span></label>
          <input class="input" name="quantity" type="number" step="0.01" min="0.01"
                 max="${a.authorized_quantity}" required value="${a.authorized_quantity}">
          <span class="field-help">Máx. autorizado: ${Number(a.authorized_quantity).toFixed(2)} L</span>
        </div>
        <div class="field">
          <label class="field-label">Valor unit. (R$/L) <span class="req">*</span></label>
          <input class="input" name="unit_price" type="number" step="0.001" min="0" required value="${Number(a.unit_price_snapshot).toFixed(3)}">
        </div>
        <div class="field">
          <label class="field-label">KM inicial</label>
          <input class="input" name="km_initial" type="number" min="0" value="${veh?.current_km ?? ''}">
        </div>
        <div class="field col-full">
          <label class="field-label">KM final <span class="req">*</span></label>
          <input class="input" name="km_final" type="number" min="0" required value="${veh?.current_km ?? ''}">
        </div>
        <div class="field col-full">
          <label class="field-label">Observações</label>
          <textarea class="textarea" name="notes" rows="2"></textarea>
        </div>
      </div>
      <div id="conclude-errors" class="login-error" style="display:none;margin-top:12px"></div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="conclude-save-btn">${icons.check} Concluir e registrar</button>
  `;
  const m = openModal({ title: 'Concluir abastecimento', body, footer });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#conclude-save-btn').addEventListener('click', async () => {
    const form = document.getElementById('conclude-form');
    const errBox = document.getElementById('conclude-errors');
    errBox.style.display = 'none';
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const v = formValues(form);
    const qty = Number(v.quantity);
    if (qty > Number(a.authorized_quantity)) {
      errBox.innerHTML = `⚠️ Quantidade excede o autorizado (${Number(a.authorized_quantity).toFixed(2)} L).`;
      errBox.style.display = 'block'; return;
    }
    const kmi = v.km_initial ? Number(v.km_initial) : null;
    const kmf = Number(v.km_final);
    if (kmi != null && kmi > kmf) {
      errBox.innerHTML = '⚠️ KM inicial maior que KM final.';
      errBox.style.display = 'block'; return;
    }
    const btn = document.getElementById('conclude-save-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando...';
    try {
      const sup = _suppliers.find(s => s.id === a.supplier_id);
      const { error } = await supabase.from('fueling').insert({
        authorization_id: a.id,
        vehicle_id: a.vehicle_id,
        supplier_id: a.supplier_id,
        fuel_type_code: a.fuel_type_code,
        fuel_subtype_id: a.fuel_subtype_id,
        date: v.date,
        quantity: qty,
        unit_price: Number(v.unit_price),
        km_initial: kmi,
        km_final: kmf,
        responsible_name: a.responsible_name,
        notes: v.notes || null,
        vehicle_plate_snapshot: a.vehicle_plate_snapshot,
        department_acronym_snapshot: a.department_acronym_snapshot,
        supplier_trade_name_snapshot: a.supplier_trade_name_snapshot,
      });
      if (error) throw error;
      toast('Abastecimento registrado. Autorização marcada como utilizada.', 'success');
      closeModal();
      await loadAll(); renderLimitCard(); renderTable();
    } catch (err) {
      errBox.innerHTML = '⚠️ ' + (err.message || 'Erro ao registrar.');
      errBox.style.display = 'block';
      btn.disabled = false; btn.innerHTML = `${icons.check} Concluir e registrar`;
    }
  });
}

// =============================================================================
// AÇÕES: CANCELAR / EXCLUIR
// =============================================================================
async function cancelAut(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const ok = await confirmDialog({
    title: 'Cancelar autorização',
    message: `Cancelar a autorização ${a.number}? O saldo do contrato será restaurado.`,
    confirmText: 'Cancelar autorização',
    danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.rpc('cancel_authorization', { p_auth_id: id });
  if (error) { toast(error.message, 'error'); return; }
  toast('Autorização cancelada.', 'success');
  await loadAll(); renderLimitCard(); renderTable();
}

async function deleteAut(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const ok = await confirmDialog({
    title: 'Excluir autorização',
    message: `Excluir definitivamente a autorização ${a.number}? Esta ação não pode ser desfeita.`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.rpc('delete_authorization', { p_auth_id: id });
  if (error) { toast(error.message, 'error'); return; }
  toast('Autorização excluída.', 'success');
  await loadAll(); renderLimitCard(); renderTable();
}

// =============================================================================
// IMPRESSÃO A4
// =============================================================================
async function printAutA4(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const entity = await getEntity();
  const sup = _suppliers.find(s => s.id === a.supplier_id);
  const veh = _vehicles.find(v => v.id === a.vehicle_id);
  const orgao = entity?.organ_name || 'Prefeitura Municipal';
  const logo = new URL('logo.png', location.href).href;
  const ibge = entity?.ibge_code || '';
  const qrDataUrl = await QRCode.toDataURL(a.qr_payload, { width: 200, margin: 1, errorCorrectionLevel: 'M' });

  const w = window.open('', '_blank', 'width=900,height=1200');
  if (!w) { toast('Permita popups para imprimir.', 'error'); return; }
  const cancel = a.status === 'cancelada';
  const used = a.status === 'utilizada';
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Autorização ${esc(a.number)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1A2A3A; margin: 0; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .hdr { display:flex; align-items:center; gap:14px; padding:12px 0; border-bottom:2px solid #217AD8; margin-bottom:18px; }
  .hdr img { width:64px; height:64px; object-fit:contain; }
  .hdr .org { font-size:12px; color:#475569; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .hdr .title { font-size:20px; font-weight:700; color:#0F172A; margin-top:2px; }
  .hdr .ibge { font-size:10px; color:#94A3B8; margin-top:2px; }
  .num-box { background:linear-gradient(135deg,#217AD8,#1A65B5); color:#fff; padding:18px 20px; border-radius:10px; text-align:center; margin-bottom:18px; }
  .num-box .lbl { font-size:11px; opacity:.85; letter-spacing:.1em; text-transform:uppercase; }
  .num-box .val { font-family:ui-monospace,'SF Mono',Menlo,monospace; font-size:34px; font-weight:700; margin-top:4px; letter-spacing:.04em; }
  .num-box .meta { font-size:11px; opacity:.9; margin-top:4px; }
  .cancel-stamp { text-align:center; background:#FDECEC; border:3px solid #C0392B; color:#C0392B; font-size:24px; font-weight:900; padding:14px; margin-bottom:18px; border-radius:10px; letter-spacing:6px; }
  .used-stamp { text-align:center; background:#E8F6EE; border:3px solid #16A34A; color:#16A34A; font-size:18px; font-weight:800; padding:10px; margin-bottom:18px; border-radius:10px; letter-spacing:4px; }
  .grid { display:grid; grid-template-columns:1.5fr 1fr; gap:20px; }
  table.data { width:100%; border-collapse:collapse; margin-bottom:14px; }
  table.data td { padding:9px 12px; border:1px solid #E5E9F0; font-size:11.5px; vertical-align:top; }
  table.data .lbl { background:#F6F8FB; font-weight:600; color:#475569; width:40%; }
  table.data .big { font-size:16px; font-weight:700; color:#0F172A; }
  .qr-box { text-align:center; padding:14px; border:1px solid #E5E9F0; border-radius:8px; }
  .qr-box img { width:100%; max-width:200px; }
  .qr-box .qr-label { font-size:10px; color:#64748B; margin-top:8px; }
  .sign-box { margin-top:50px; display:grid; grid-template-columns:1fr 1fr; gap:30px; }
  .sign-line { border-top:1px solid #1A2A3A; padding-top:8px; text-align:center; font-size:10px; color:#475569; }
  .footer { margin-top:30px; padding-top:8px; border-top:1px solid #E5E9F0; text-align:center; font-size:9px; color:#94A3B8; }
  .notes { background:#FEF3DC; border-left:3px solid #D97706; padding:10px 14px; margin-top:14px; font-size:11px; }
  .notes b { color:#92400E; }
</style></head><body>
  <div class="hdr">
    ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
    <div>
      <div class="org">${esc(entity?.entity_type || '')}</div>
      <div class="title">${esc(orgao)}</div>
      ${ibge ? `<div class="ibge">IBGE ${esc(ibge)}</div>` : ''}
    </div>
  </div>
  ${cancel ? `<div class="cancel-stamp">⚠️ CANCELADA ⚠️</div>` : ''}
  ${used ? `<div class="used-stamp">✓ UTILIZADA</div>` : ''}
  <div class="num-box">
    <div class="lbl">Autorização de Abastecimento</div>
    <div class="val">${esc(a.number)}</div>
    <div class="meta">Emitida em ${esc(fmtDate(a.date))}</div>
  </div>
  <div class="grid">
    <div>
      <table class="data">
        <tr><td class="lbl">Veículo</td><td class="big">${esc(formatPlate(a.vehicle_plate_snapshot))}</td></tr>
        <tr><td class="lbl">Modelo</td><td>${esc(a.vehicle_model_snapshot)}</td></tr>
        <tr><td class="lbl">Secretaria</td><td>${esc(a.department_acronym_snapshot || '—')}</td></tr>
        <tr><td class="lbl">Combustível</td><td class="big">${esc(fuelLabel(a.fuel_type_code, a.fuel_subtype_id))}</td></tr>
        <tr><td class="lbl">Quantidade</td><td class="big">${Number(a.authorized_quantity).toFixed(2)} L</td></tr>
        <tr><td class="lbl">Valor unitário</td><td>R$ ${Number(a.unit_price_snapshot).toFixed(3)} / L</td></tr>
        <tr><td class="lbl">Valor estimado</td><td class="big" style="color:#16A34A">${fmtMoney(a.estimated_total)}</td></tr>
        <tr><td class="lbl">Fornecedor</td><td>${esc(a.supplier_trade_name_snapshot)}${sup?.cnpj ? '<br><small>CNPJ ' + esc(sup.cnpj) + '</small>' : ''}</td></tr>
        <tr><td class="lbl">Responsável</td><td>${esc(a.responsible_name)}</td></tr>
      </table>
      ${a.notes ? `<div class="notes"><b>Observações:</b> ${esc(a.notes)}</div>` : ''}
    </div>
    <div class="qr-box">
      <img src="${qrDataUrl}" alt="QR">
      <div class="qr-label">Escaneie para verificar</div>
    </div>
  </div>
  ${!cancel && !used ? `
  <div class="sign-box">
    <div class="sign-line">Motorista / Solicitante</div>
    <div class="sign-line">Frentista / Atendente</div>
  </div>` : ''}
  <div class="footer">Gerir Frota · ${esc(new Date().toLocaleString('pt-BR'))}</div>
  <script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 300);</script>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

// =============================================================================
// IMPRESSÃO TÉRMICA 58mm
// =============================================================================
async function printAutThermal(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const entity = await getEntity();
  // QR Code com payload compacto + error correction L = mais "aberto" (módulos
  // maiores), escaneia muito melhor em impressão térmica.
  const compactPayload = [
    `AUT ${a.number}`,
    `${fmtDate(a.date)}`,
    `${formatPlate(a.vehicle_plate_snapshot)} - ${a.vehicle_model_snapshot}`,
    `${fuelLabel(a.fuel_type_code, a.fuel_subtype_id)}`,
    `Qtd: ${Number(a.authorized_quantity).toFixed(2)} L`,
    `Total: ${fmtMoney(a.estimated_total)}`,
    `Fornecedor: ${a.supplier_trade_name_snapshot}`,
    `Resp: ${a.responsible_name}`,
  ].join('\n');
  const qrDataUrl = await QRCode.toDataURL(compactPayload, { width: 360, margin: 2, errorCorrectionLevel: 'L' });
  const orgao = entity?.organ_name || 'Prefeitura Municipal';
  const cancel = a.status === 'cancelada';

  const w = window.open('', '_blank', 'width=320,height=600');
  if (!w) { toast('Permita popups para imprimir.', 'error'); return; }
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Aut ${esc(a.number)}</title>
<style>
  @page { size: 58mm auto; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; }
  /* Largura útil = 50mm (58mm físico - 4mm cada lado de padding pra evitar corte) */
  body { font-family:'Courier New',monospace; color:#000; margin:0; padding:3mm 4mm; font-size:10px; line-height:1.35; width:58mm; word-break:break-word; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .center { text-align:center; }
  .bold { font-weight:700; }
  .big { font-size:13px; font-weight:700; }
  .sep { border-top:1px dashed #000; margin:4px 0; }
  .num { font-size:14px; font-weight:700; letter-spacing:1px; }
  .cancel { border:2px solid #000; padding:4px; margin:6px 0; font-weight:900; font-size:13px; letter-spacing:2px; }
  /* QR ocupa quase toda a largura disponível e tem padding branco em volta */
  img.qr { width:42mm; height:42mm; margin:6px auto; display:block; background:#fff; padding:2mm; }
  .lbl { color:#000; font-weight:700; display:block; font-size:9.5px; }
  .val { display:block; font-size:11.5px; font-weight:700; margin-top:1px; word-break:break-word; }
  .row { margin-bottom:3px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:4px; margin-top:3px; }
</style></head><body>
  <div class="center bold">${esc(orgao)}</div>
  <div class="center" style="font-size:9px">AUTORIZAÇÃO DE ABASTECIMENTO</div>
  <div class="sep"></div>
  ${cancel ? `<div class="center cancel">CANCELADA</div>` : ''}
  <div class="center num">${esc(a.number)}</div>
  <div class="center" style="font-size:9px">${esc(fmtDate(a.date))} · ${esc(STATUS_LABEL[a.status].toUpperCase())}</div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Veículo:</span><span class="val">${esc(formatPlate(a.vehicle_plate_snapshot))}</span></div>
  <div style="font-size:9px;margin-top:-2px">${esc(a.vehicle_model_snapshot)}</div>
  <div class="row" style="margin-top:3px"><span class="lbl">Secretaria:</span><span style="font-size:10px">${esc(a.department_acronym_snapshot || '—')}</span></div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Combustível:</span><span class="val">${esc(fuelLabel(a.fuel_type_code, a.fuel_subtype_id))}</span></div>
  <div class="row"><span class="lbl">Quantidade:</span><span class="val">${Number(a.authorized_quantity).toFixed(2)} L</span></div>
  <div class="grid2">
    <div><span class="lbl">R$/L:</span><span style="font-size:10.5px">${Number(a.unit_price_snapshot).toFixed(3)}</span></div>
    <div><span class="lbl">Total est:</span><span style="font-size:10.5px;font-weight:700">${fmtMoney(a.estimated_total)}</span></div>
  </div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Fornecedor:</span><span style="font-size:9.5px">${esc(a.supplier_trade_name_snapshot)}</span></div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Responsável:</span><span style="font-size:10px">${esc(a.responsible_name)}</span></div>
  ${a.notes ? `<div class="sep"></div><div style="font-size:9px"><span class="lbl">Obs:</span>${esc(a.notes)}</div>` : ''}
  <div class="sep"></div>
  <img class="qr" src="${qrDataUrl}" alt="QR">
  <div class="center" style="font-size:8.5px">Escaneie para verificar</div>
  ${!cancel ? `
  <div style="margin-top:18px;border-top:1px solid #000;padding-top:3px;text-align:center;font-size:8.5px">Motorista</div>
  <div style="margin-top:18px;border-top:1px solid #000;padding-top:3px;text-align:center;font-size:8.5px">Frentista</div>` : ''}
  <div class="center bold" style="font-size:8.5px;margin-top:8px">Gerir Frota</div>
  <script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 300);</script>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}
