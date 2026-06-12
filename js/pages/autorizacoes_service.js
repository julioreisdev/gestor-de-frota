import { getEntity } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, fmtMoney, toast, openModal, closeModal, confirmDialog, formValues, formatPlate } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile, isAdmin } from '../auth.js';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

const STATUS_LABEL = { emitida: 'Emitida', utilizada: 'Utilizada', cancelada: 'Cancelada' };
const STATUS_BADGE = { emitida: 'badge badge-warning', utilizada: 'badge badge-success', cancelada: 'badge badge-danger' };
const KIND_LABEL = { preventiva: 'Preventiva', corretiva: 'Corretiva', sinistro: 'Sinistro', revisao: 'Revisão', outros: 'Outros' };
const KIND_BADGE = { preventiva: 'badge badge-success', corretiva: 'badge badge-warning', sinistro: 'badge badge-danger', revisao: 'badge', outros: 'badge badge-neutral' };

let _items = [];
let _vehicles = [];
let _suppliers = [];
let _filter = { search: '', status: '', month: '', kind: '' };

const isFornecedor = () => getProfile()?.role === 'fornecedor';

export async function renderServiceTab(container) {
  container.innerHTML = `
    <div class="page-header" style="margin-bottom:var(--s-4)">
      <div>
        <p class="page-subtitle" style="margin-top:0">${isFornecedor()
          ? 'Consulte as autorizações de manutenção vinculadas a você.'
          : 'Autorize serviços em mecânicas — orçamento, QR Code e impressão.'}</p>
      </div>
      <div class="page-actions">
        ${isFornecedor() ? '' : `
        <button class="btn btn-primary" id="btn-new-srv">
          <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span>
          Emitir autorização
        </button>`}
      </div>
    </div>
    <div class="card">
      <div class="table-toolbar">
        <div class="search ${_filter.search ? 'has-value' : ''}" id="srv-search-box">
          ${icons.search}
          <input id="srv-search" type="search"
                 placeholder="Buscar por nº, placa, mecânica, responsável, serviço…"
                 autocomplete="off" value="${esc(_filter.search)}">
          <button class="clear" id="srv-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="srv-count"></div>
      </div>
      <div class="filter-chips">
        <select class="select chip" id="ffs-status">
          <option value="">Todas situações</option>
          <option value="emitida">Emitida</option>
          <option value="utilizada">Utilizada</option>
          <option value="cancelada">Cancelada</option>
        </select>
        <select class="select chip" id="ffs-kind">
          <option value="">Todas categorias</option>
          <option value="preventiva">Preventiva</option>
          <option value="corretiva">Corretiva</option>
          <option value="sinistro">Sinistro</option>
          <option value="revisao">Revisão</option>
          <option value="outros">Outros</option>
        </select>
        <input class="input chip" type="month" id="ffs-month" value="${esc(_filter.month)}">
        <button class="btn btn-ghost btn-sm" id="ffs-clear" hidden>Limpar filtros</button>
      </div>
      <div id="srv-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;
  const btnNewSrv = document.getElementById('btn-new-srv');
  if (btnNewSrv) btnNewSrv.addEventListener('click', () => openSrvModal());
  const sBox = document.getElementById('srv-search-box');
  const sIn = document.getElementById('srv-search');
  document.getElementById('srv-search-clear').addEventListener('click', () => {
    _filter.search = ''; sIn.value = ''; sBox.classList.remove('has-value'); renderTable();
  });
  sIn.addEventListener('input', (e) => {
    _filter.search = e.target.value || '';
    sBox.classList.toggle('has-value', !!_filter.search);
    renderTable();
  });
  document.getElementById('ffs-status').addEventListener('change', (e) => { _filter.status = e.target.value; updateClear(); renderTable(); });
  document.getElementById('ffs-kind').addEventListener('change',   (e) => { _filter.kind   = e.target.value; updateClear(); renderTable(); });
  document.getElementById('ffs-month').addEventListener('change',  (e) => { _filter.month  = e.target.value; updateClear(); renderTable(); });
  document.getElementById('ffs-clear').addEventListener('click', () => {
    _filter = { search: _filter.search, status: '', month: '', kind: '' };
    document.getElementById('ffs-status').value = '';
    document.getElementById('ffs-kind').value = '';
    document.getElementById('ffs-month').value = '';
    updateClear(); renderTable();
  });
  await loadAll();
  if (_filter.status) document.getElementById('ffs-status').value = _filter.status;
  if (_filter.kind)   document.getElementById('ffs-kind').value   = _filter.kind;
  updateClear();
  renderTable();
}

function updateClear() {
  const any = _filter.status || _filter.month || _filter.kind;
  document.getElementById('ffs-clear').hidden = !any;
}

async function loadAll() {
  const [a, v, s] = await Promise.all([
    supabase.from('service_authorization').select(`
      id, number, date, status, vehicle_id, supplier_id, service_kind,
      description, estimated_value, responsible_name, notes,
      vehicle_plate_snapshot, vehicle_model_snapshot,
      department_acronym_snapshot, supplier_trade_name_snapshot,
      qr_payload, created_at
    `).is('deleted_at', null).order('date', { ascending: false }).order('number', { ascending: false }),
    supabase.from('vehicle').select(`
      id, plate, model, brand, current_km,
      department_id, department:department_id(acronym, name)
    `).is('deleted_at', null).order('plate'),
    supabase.from('supplier').select(`
      id, kind, legal_name, trade_name, cnpj, responsible_name, phone
    `).in('kind', ['mecanica', 'ambos']).order('legal_name'),
  ]);
  if (a.error) { toast('Falha ao carregar autorizações: ' + a.error.message, 'error'); _items = []; }
  else _items = a.data || [];
  _vehicles = v.data || [];
  _suppliers = s.data || [];
}

function applyFilters() {
  const t = (_filter.search || '').toLowerCase();
  return _items.filter(a => {
    if (_filter.status && a.status !== _filter.status) return false;
    if (_filter.kind && a.service_kind !== _filter.kind) return false;
    if (_filter.month && String(a.date).slice(0, 7) !== _filter.month) return false;
    if (!t) return true;
    return (a.number || '').toLowerCase().includes(t)
        || (a.vehicle_plate_snapshot || '').toLowerCase().includes(t)
        || (a.supplier_trade_name_snapshot || '').toLowerCase().includes(t)
        || (a.responsible_name || '').toLowerCase().includes(t)
        || (a.description || '').toLowerCase().includes(t);
  });
}

function renderTable() {
  const box = document.getElementById('srv-tablebox');
  const countEl = document.getElementById('srv-count');
  if (!_items.length) {
    if (countEl) countEl.textContent = '';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.wrench}</div>
        <div class="empty-state-title">Nenhuma autorização de manutenção</div>
        <p class="empty-state-text">Clique em "Emitir autorização" para criar a primeira.</p>
      </div>`;
    return;
  }
  const filtered = applyFilters();
  if (countEl) {
    const any = _filter.search || _filter.status || _filter.month || _filter.kind;
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
            <th>Categoria</th>
            <th>Serviço</th>
            <th>Valor est.</th>
            <th>Mecânica</th>
            <th>Responsável</th>
            <th>Situação</th>
            <th class="actions-col">Ações</th>
          </tr>
        </thead>
        <tbody>${filtered.map(srvRow).join('')}</tbody>
      </table>
    </div>
  `;
  box.querySelectorAll('[data-act="conclude"]').forEach(b => b.addEventListener('click', () => concludeService(b.dataset.id)));
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openSrvModal(b.dataset.id)));
  box.querySelectorAll('[data-act="qr"]').forEach(b => b.addEventListener('click', () => openQRModal(b.dataset.id)));
  box.querySelectorAll('[data-act="print-a4"]').forEach(b => b.addEventListener('click', () => printSrvA4(b.dataset.id)));
  box.querySelectorAll('[data-act="print-thermal"]').forEach(b => b.addEventListener('click', () => printSrvThermal(b.dataset.id)));
  box.querySelectorAll('[data-act="cancel"]').forEach(b => b.addEventListener('click', () => cancelSrv(b.dataset.id)));
  box.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteSrv(b.dataset.id)));
}

function srvRow(a) {
  const emitida = a.status === 'emitida';
  return `
    <tr ${a.status === 'cancelada' ? 'style="opacity:.6"' : ''}>
      <td data-label="Nº / Data">
        <div class="cell-stack">
          <strong style="font-family:ui-monospace,monospace;color:var(--primary);font-size:12px">${esc(a.number)}</strong>
          <span style="color:var(--text-muted);font-size:12px">${esc(fmtDate(a.date))}</span>
        </div>
      </td>
      <td data-label="Veículo">
        <div class="cell-stack">
          <strong>${esc(formatPlate(a.vehicle_plate_snapshot))}</strong>
          <span style="color:var(--text-muted);font-size:12px">${esc(a.vehicle_model_snapshot || '')}</span>
        </div>
      </td>
      <td data-label="Categoria"><span class="${KIND_BADGE[a.service_kind] || 'badge'}">${esc(KIND_LABEL[a.service_kind] || a.service_kind)}</span></td>
      <td data-label="Serviço" style="font-size:12.5px;max-width:300px"><div class="cell-stack"><span style="white-space:normal">${esc(a.description)}</span></div></td>
      <td data-label="Valor est." style="white-space:nowrap;color:var(--success);font-weight:500">${fmtMoney(a.estimated_value)}</td>
      <td data-label="Mecânica" style="font-size:12.5px">${esc(a.supplier_trade_name_snapshot || '—')}</td>
      <td data-label="Responsável" style="font-size:12.5px">${esc(a.responsible_name)}</td>
      <td data-label="Situação"><span class="${STATUS_BADGE[a.status]}">${esc(STATUS_LABEL[a.status])}</span></td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="conclude"      data-id="${a.id}" title="Concluir (registrar manutenção)" ${emitida ? '' : 'disabled'} style="color:var(--success)">${icons.check}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="qr"            data-id="${a.id}" title="Ver QR Code">${icons.qrcode}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="print-a4"      data-id="${a.id}" title="Imprimir A4">${icons.printer}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="print-thermal" data-id="${a.id}" title="Imprimir térmica 58mm">${icons.receipt}</button>
          ${isFornecedor() ? '' : `
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit"          data-id="${a.id}" title="Editar" ${emitida ? '' : 'disabled'}>${icons.edit}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="cancel"        data-id="${a.id}" title="Cancelar" ${emitida ? '' : 'disabled'} style="color:var(--warning)">${icons.ban}</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="delete"        data-id="${a.id}" title="Excluir" style="color:var(--danger)">${icons.trash}</button>` : ''}`}
        </div>
      </td>
    </tr>`;
}

function openSrvModal(id) {
  const editing = !!id;
  const a = editing ? _items.find(x => x.id === id) : null;
  if (editing && a.status !== 'emitida') {
    toast('Apenas autorizações emitidas podem ser editadas.', 'warning'); return;
  }
  const me = getProfile();
  const today = new Date().toISOString().slice(0, 10);
  const defaultResp = me?.full_name || '';

  const vehOptions = '<option value="">— Selecione —</option>' +
    _vehicles.map(v => `<option value="${v.id}" ${a?.vehicle_id === v.id ? 'selected' : ''}>${esc(formatPlate(v.plate))} — ${esc(v.model)} (${esc(v.department?.acronym || '—')})</option>`).join('');
  const supOptions = '<option value="">— Selecione —</option>' +
    _suppliers.map(s => `<option value="${s.id}" ${a?.supplier_id === s.id ? 'selected' : ''}>${esc(s.trade_name || s.legal_name)}</option>`).join('');
  const kindOptions = Object.entries(KIND_LABEL).map(([k, l]) =>
    `<option value="${k}" ${(a?.service_kind || 'corretiva') === k ? 'selected' : ''}>${esc(l)}</option>`).join('');

  const body = `
    <form id="srv-form" autocomplete="off">
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
          <select class="select" name="vehicle_id" required ${editing ? 'disabled' : ''}>${vehOptions}</select>
        </div>
        <div class="field col-full">
          <label class="field-label">Mecânica <span class="req">*</span></label>
          <select class="select" name="supplier_id" required ${editing ? 'disabled' : ''}>${supOptions}</select>
          <span class="field-help">Aparecem aqui apenas fornecedores marcados como Mecânica ou Posto + Mecânica.</span>
        </div>
        <div class="field">
          <label class="field-label">Categoria <span class="req">*</span></label>
          <select class="select" name="service_kind" required>${kindOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">Valor estimado (R$) <span class="req">*</span></label>
          <input class="input" name="estimated_value" type="number" step="0.01" min="0.01" required value="${a?.estimated_value ?? ''}" placeholder="0,00">
        </div>
        <div class="field col-full">
          <label class="field-label">Descrição do serviço <span class="req">*</span></label>
          <textarea class="textarea" name="description" rows="3" required minlength="3" maxlength="500"
                    placeholder="Ex.: Troca de óleo, filtros e revisão de freios">${esc(a?.description || '')}</textarea>
        </div>
        <div class="field col-full">
          <label class="field-label">Observações</label>
          <textarea class="textarea" name="notes" rows="2" ${editing ? '' : ''}>${esc(a?.notes || '')}</textarea>
        </div>
      </div>
      <div id="srv-errors" class="login-error" style="display:none;margin-top:12px"></div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="srv-save-btn">${editing ? 'Salvar alterações' : 'Emitir autorização'}</button>
  `;
  const m = openModal({ title: editing ? `Editar Autorização ${a.number}` : 'Nova autorização de manutenção', body, footer, size: 'lg' });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#srv-save-btn').addEventListener('click', () => saveSrv(editing ? id : null));
}

async function saveSrv(id) {
  const form = document.getElementById('srv-form');
  const errBox = document.getElementById('srv-errors');
  if (errBox) errBox.style.display = 'none';
  if (!form || !form.checkValidity()) { form?.reportValidity(); return; }
  const v = formValues(form);

  // Aviso de duplicata na mesma data + veículo.
  // confirmDialog fecha o modal de emissão (1 modal por vez). Por isso
  // marcamos formGone e protegemos os acessos ao DOM depois.
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
        message: `${dup.length} autorização(ões) de manutenção já existe(m) para ${formatPlate(veh?.plate || '')} em ${fmtDate(v.date)} (${dup.map(d => d.number).join(', ')}). Emitir mesmo assim?`,
        confirmText: 'Emitir mesmo assim',
        cancelText: 'Cancelar',
      });
      if (!ok) return;
      formGone = true;
    }
  }

  const btn = formGone ? null : document.getElementById('srv-save-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Salvando...';
  }
  try {
    if (id) {
      const { error } = await supabase.rpc('update_service_authorization', {
        p_auth_id: id,
        p_service_kind: v.service_kind,
        p_description: v.description,
        p_estimated_value: Number(v.estimated_value),
        p_notes: v.notes || null,
      });
      if (error) throw error;
      toast('Autorização atualizada.', 'success');
      closeModal();
      await loadAll(); renderTable();
    } else {
      const { data, error } = await supabase.rpc('emit_service_authorization', {
        p_date: v.date,
        p_vehicle_id: v.vehicle_id,
        p_supplier_id: v.supplier_id,
        p_service_kind: v.service_kind,
        p_description: v.description,
        p_estimated_value: Number(v.estimated_value),
        p_responsible_name: v.responsible_name,
        p_notes: v.notes || null,
      });
      if (error) throw error;
      toast('Autorização emitida.', 'success');
      await loadAll(); renderTable();
      closeModal();
      setTimeout(() => openQRModal(data), 200);
    }
  } catch (err) {
    const msg = err.message || 'Erro ao salvar.';
    if (errBox && document.body.contains(errBox)) {
      errBox.innerHTML = '⚠️ ' + msg;
      errBox.style.display = 'block';
    } else {
      toast(msg, 'error');
    }
    if (btn && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = id ? 'Salvar alterações' : 'Emitir autorização';
    }
  }
}

async function openQRModal(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const sup = _suppliers.find(s => s.id === a.supplier_id);
  const body = `
    <div style="text-align:center">
      <div id="qr-canvas-wrap" style="display:flex;justify-content:center;margin-bottom:var(--s-4);min-height:280px;align-items:center">
        <div class="spinner" style="color:var(--primary)"></div>
      </div>
      <div style="background:var(--surface-alt);border-radius:var(--r-md);padding:var(--s-4);font-size:13px;line-height:1.7;text-align:left">
        <div style="font-family:ui-monospace,monospace;font-size:16px;font-weight:700;color:var(--primary);text-align:center;margin-bottom:var(--s-3)">${esc(a.number)}</div>
        <div><strong>Data:</strong> ${esc(fmtDate(a.date))} · <span class="${STATUS_BADGE[a.status]}">${esc(STATUS_LABEL[a.status])}</span></div>
        <div><strong>Veículo:</strong> ${esc(formatPlate(a.vehicle_plate_snapshot))} — ${esc(a.vehicle_model_snapshot)}</div>
        <div><strong>Categoria:</strong> <span class="${KIND_BADGE[a.service_kind] || 'badge'}">${esc(KIND_LABEL[a.service_kind])}</span></div>
        <div style="margin-top:var(--s-2);padding-top:var(--s-2);border-top:1px dashed var(--border)"><strong>Serviço:</strong><br>${esc(a.description)}</div>
        <div><strong>Valor estimado:</strong> ${fmtMoney(a.estimated_value)}</div>
        <div><strong>Mecânica:</strong> ${esc(sup?.trade_name || sup?.legal_name || a.supplier_trade_name_snapshot)}</div>
        ${sup?.cnpj ? `<div><strong>CNPJ:</strong> ${esc(sup.cnpj)}</div>` : ''}
        <div><strong>Responsável:</strong> ${esc(a.responsible_name)}</div>
        ${a.notes ? `<div style="margin-top:var(--s-2);padding-top:var(--s-2);border-top:1px dashed var(--border)"><strong>Obs:</strong> ${esc(a.notes)}</div>` : ''}
      </div>
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
  m.querySelector('#qr-print-a4').addEventListener('click', () => printSrvA4(a.id));
  m.querySelector('#qr-print-thermal').addEventListener('click', () => printSrvThermal(a.id));
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

function concludeService(id) {
  const a = _items.find(x => x.id === id);
  if (!a || a.status !== 'emitida') return;
  const veh = _vehicles.find(v => v.id === a.vehicle_id);
  // Datas padrão = data da autorização (editáveis). Cliente pediu pra
  // confirmação ser vinculada à autorização e não à data de hoje.
  const defaultDate = a.date || new Date().toISOString().slice(0, 10);
  const body = `
    <p style="font-size:13px;color:var(--text-soft);margin-bottom:var(--s-3)">
      Registrando manutenção para <strong style="font-family:ui-monospace,monospace;color:var(--primary)">${esc(a.number)}</strong>
      — ${esc(formatPlate(a.vehicle_plate_snapshot))} ${esc(a.vehicle_model_snapshot)} ·
      <span class="${KIND_BADGE[a.service_kind]}">${esc(KIND_LABEL[a.service_kind])}</span>
    </p>
    <form id="conc-srv-form" autocomplete="off">
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Data abertura <span class="req">*</span></label>
          <input class="input" name="open_date" type="date" required value="${defaultDate}">
        </div>
        <div class="field">
          <label class="field-label">Data conclusão</label>
          <input class="input" name="close_date" type="date" value="${defaultDate}">
        </div>
        <div class="field">
          <label class="field-label">Valor real (R$)</label>
          <input class="input" name="total_value" type="number" step="0.01" min="0" value="${Number(a.estimated_value).toFixed(2)}">
          <span class="field-help">Estimado na autorização: ${fmtMoney(a.estimated_value)}</span>
        </div>
        <div class="field">
          <label class="field-label">KM no serviço</label>
          <input class="input" name="km_at_service" type="number" min="0" value="${veh?.current_km ?? ''}">
        </div>
        <div class="field col-full">
          <label class="field-label">Descrição executada <span class="req">*</span></label>
          <textarea class="textarea" name="description" rows="3" required>${esc(a.description)}</textarea>
        </div>
        <div class="field col-full">
          <label class="field-label">Observações</label>
          <textarea class="textarea" name="notes" rows="2"></textarea>
        </div>
      </div>
      <div id="conc-srv-errors" class="login-error" style="display:none;margin-top:12px"></div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="conc-srv-save-btn">${icons.check} Concluir e registrar</button>
  `;
  const m = openModal({ title: 'Concluir manutenção', body, footer });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#conc-srv-save-btn').addEventListener('click', async () => {
    const form = document.getElementById('conc-srv-form');
    const errBox = document.getElementById('conc-srv-errors');
    errBox.style.display = 'none';
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const v = formValues(form);
    const btn = document.getElementById('conc-srv-save-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando...';
    try {
      const { error } = await supabase.from('maintenance').insert({
        authorization_id: a.id,
        vehicle_id: a.vehicle_id,
        supplier_id: a.supplier_id,
        kind: a.service_kind,
        status: 'concluida',
        open_date: v.open_date,
        close_date: v.close_date || null,
        km_at_service: v.km_at_service ? Number(v.km_at_service) : null,
        description: v.description,
        total_value: v.total_value ? Number(v.total_value) : null,
        responsible_name: a.responsible_name,
        notes: v.notes || null,
      });
      if (error) throw error;
      toast('Manutenção registrada. Autorização marcada como utilizada.', 'success');
      closeModal();
      await loadAll(); renderTable();
    } catch (err) {
      errBox.innerHTML = '⚠️ ' + (err.message || 'Erro ao registrar.');
      errBox.style.display = 'block';
      btn.disabled = false; btn.innerHTML = `${icons.check} Concluir e registrar`;
    }
  });
}

async function cancelSrv(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const ok = await confirmDialog({
    title: 'Cancelar autorização',
    message: `Cancelar a autorização ${a.number}?`,
    confirmText: 'Cancelar autorização',
    danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.rpc('cancel_service_authorization', { p_auth_id: id });
  if (error) { toast(error.message, 'error'); return; }
  toast('Autorização cancelada.', 'success');
  await loadAll(); renderTable();
}

async function deleteSrv(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const ok = await confirmDialog({
    title: 'Excluir autorização',
    message: `Excluir definitivamente a autorização ${a.number}?`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.rpc('delete_service_authorization', { p_auth_id: id });
  if (error) { toast(error.message, 'error'); return; }
  toast('Autorização excluída.', 'success');
  await loadAll(); renderTable();
}

async function printSrvA4(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const entity = await getEntity();
  const sup = _suppliers.find(s => s.id === a.supplier_id);
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
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color:#1A2A3A; margin:0; font-size:11px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr { display:flex; align-items:center; gap:14px; padding:12px 0; border-bottom:2px solid #D97706; margin-bottom:18px; }
  .hdr img { width:64px; height:64px; object-fit:contain; }
  .hdr .org { font-size:12px; color:#475569; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .hdr .title { font-size:20px; font-weight:700; color:#0F172A; margin-top:2px; }
  .num-box { background:linear-gradient(135deg,#D97706,#B45309); color:#fff; padding:18px 20px; border-radius:10px; text-align:center; margin-bottom:18px; }
  .num-box .lbl { font-size:11px; opacity:.85; letter-spacing:.1em; text-transform:uppercase; }
  .num-box .val { font-family:ui-monospace,'SF Mono',Menlo,monospace; font-size:30px; font-weight:700; margin-top:4px; letter-spacing:.04em; }
  .num-box .meta { font-size:11px; opacity:.9; margin-top:4px; }
  .cancel-stamp { text-align:center; background:#FDECEC; border:3px solid #C0392B; color:#C0392B; font-size:24px; font-weight:900; padding:14px; margin-bottom:18px; border-radius:10px; letter-spacing:6px; }
  .used-stamp { text-align:center; background:#E8F6EE; border:3px solid #16A34A; color:#16A34A; font-size:18px; font-weight:800; padding:10px; margin-bottom:18px; border-radius:10px; letter-spacing:4px; }
  .grid { display:grid; grid-template-columns:1.5fr 1fr; gap:20px; }
  table.data { width:100%; border-collapse:collapse; margin-bottom:14px; }
  table.data td { padding:9px 12px; border:1px solid #E5E9F0; font-size:11.5px; vertical-align:top; }
  table.data .lbl { background:#F6F8FB; font-weight:600; color:#475569; width:35%; }
  table.data .big { font-size:14px; font-weight:700; color:#0F172A; }
  .service-box { background:#FEF3DC; border-left:4px solid #D97706; padding:14px; border-radius:6px; margin:14px 0; }
  .service-box .lbl { font-size:10px; font-weight:600; color:#92400E; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }
  .service-box .desc { font-size:13px; line-height:1.5; color:#1A2A3A; }
  .qr-box { text-align:center; padding:14px; border:1px solid #E5E9F0; border-radius:8px; }
  .qr-box img { width:100%; max-width:200px; }
  .qr-box .qr-label { font-size:10px; color:#64748B; margin-top:8px; }
  .sign-box { margin-top:50px; display:grid; grid-template-columns:1fr 1fr; gap:30px; }
  .sign-line { border-top:1px solid #1A2A3A; padding-top:8px; text-align:center; font-size:10px; color:#475569; }
  .footer { margin-top:30px; padding-top:8px; border-top:1px solid #E5E9F0; text-align:center; font-size:9px; color:#94A3B8; }
</style></head><body>
  <div class="hdr">
    ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
    <div>
      <div class="org">${esc(entity?.entity_type || '')}</div>
      <div class="title">${esc(orgao)}</div>
      ${ibge ? `<div style="font-size:10px;color:#94A3B8;margin-top:2px">IBGE ${esc(ibge)}</div>` : ''}
    </div>
  </div>
  ${cancel ? `<div class="cancel-stamp">⚠️ CANCELADA ⚠️</div>` : ''}
  ${used ? `<div class="used-stamp">✓ UTILIZADA</div>` : ''}
  <div class="num-box">
    <div class="lbl">Autorização de Manutenção</div>
    <div class="val">${esc(a.number)}</div>
    <div class="meta">Emitida em ${esc(fmtDate(a.date))}</div>
  </div>
  <div class="grid">
    <div>
      <table class="data">
        <tr><td class="lbl">Veículo</td><td class="big">${esc(formatPlate(a.vehicle_plate_snapshot))}</td></tr>
        <tr><td class="lbl">Modelo</td><td>${esc(a.vehicle_model_snapshot)}</td></tr>
        <tr><td class="lbl">Secretaria</td><td>${esc(a.department_acronym_snapshot || '—')}</td></tr>
        <tr><td class="lbl">Categoria</td><td class="big">${esc(KIND_LABEL[a.service_kind])}</td></tr>
        <tr><td class="lbl">Valor estimado</td><td class="big" style="color:#16A34A">${fmtMoney(a.estimated_value)}</td></tr>
        <tr><td class="lbl">Mecânica</td><td>${esc(a.supplier_trade_name_snapshot)}${sup?.cnpj ? '<br><small>CNPJ ' + esc(sup.cnpj) + '</small>' : ''}</td></tr>
        <tr><td class="lbl">Responsável</td><td>${esc(a.responsible_name)}</td></tr>
      </table>
      <div class="service-box">
        <div class="lbl">📋 Serviço a ser realizado</div>
        <div class="desc">${esc(a.description)}</div>
      </div>
      ${a.notes ? `<div style="background:#F6F8FB;border-radius:6px;padding:10px 14px;font-size:11px;margin-top:8px"><b>Observações:</b> ${esc(a.notes)}</div>` : ''}
    </div>
    <div class="qr-box">
      <img src="${qrDataUrl}" alt="QR">
      <div class="qr-label">Escaneie para verificar</div>
    </div>
  </div>
  ${!cancel && !used ? `
  <div class="sign-box">
    <div class="sign-line">Motorista / Solicitante</div>
    <div class="sign-line">Mecânica / Atendente</div>
  </div>` : ''}
  <div class="footer">Gerir Frota · ${esc(new Date().toLocaleString('pt-BR'))}</div>
  <script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 300);</script>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}

async function printSrvThermal(id) {
  const a = _items.find(x => x.id === id);
  if (!a) return;
  const entity = await getEntity();
  const compactPayload = [
    `AUT ${a.number}`,
    `${fmtDate(a.date)}`,
    `${formatPlate(a.vehicle_plate_snapshot)} - ${a.vehicle_model_snapshot}`,
    `${KIND_LABEL[a.service_kind]}`,
    `${a.description}`,
    `Valor: ${fmtMoney(a.estimated_value)}`,
    `Mecânica: ${a.supplier_trade_name_snapshot}`,
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
  body { font-family:'Courier New',monospace; color:#000; margin:0; padding:3mm 4mm; font-size:10px; line-height:1.35; width:58mm; word-break:break-word; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .center { text-align:center; } .bold { font-weight:700; } .big { font-size:13px; font-weight:700; }
  .sep { border-top:1px dashed #000; margin:4px 0; }
  .num { font-size:14px; font-weight:700; letter-spacing:1px; }
  .cancel { border:2px solid #000; padding:4px; margin:6px 0; font-weight:900; font-size:13px; letter-spacing:2px; }
  img.qr { width:42mm; height:42mm; margin:6px auto; display:block; background:#fff; padding:2mm; }
  .lbl { color:#000; font-weight:700; display:block; font-size:9.5px; }
  .val { display:block; font-size:11.5px; font-weight:700; margin-top:1px; word-break:break-word; }
  .row { margin-bottom:3px; }
  .service { background:#000; color:#fff; padding:3px 6px; margin:4px 0; font-weight:700; font-size:11px; text-align:center; }
</style></head><body>
  <div class="center bold">${esc(orgao)}</div>
  <div class="center" style="font-size:9px">AUTORIZAÇÃO DE MANUTENÇÃO</div>
  <div class="sep"></div>
  ${cancel ? `<div class="center cancel">CANCELADA</div>` : ''}
  <div class="center num">${esc(a.number)}</div>
  <div class="center" style="font-size:9px">${esc(fmtDate(a.date))} · ${esc(STATUS_LABEL[a.status].toUpperCase())}</div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Veículo:</span><span class="val">${esc(formatPlate(a.vehicle_plate_snapshot))}</span></div>
  <div style="font-size:9px;margin-top:-2px">${esc(a.vehicle_model_snapshot)}</div>
  <div class="row" style="margin-top:3px"><span class="lbl">Secretaria:</span><span style="font-size:10px">${esc(a.department_acronym_snapshot || '—')}</span></div>
  <div class="sep"></div>
  <div class="service">${esc(KIND_LABEL[a.service_kind].toUpperCase())}</div>
  <div style="font-size:9.5px;line-height:1.4">${esc(a.description)}</div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Valor estimado:</span><span class="val">${fmtMoney(a.estimated_value)}</span></div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Mecânica:</span><span style="font-size:9.5px">${esc(a.supplier_trade_name_snapshot)}</span></div>
  <div class="sep"></div>
  <div class="row"><span class="lbl">Responsável:</span><span style="font-size:10px">${esc(a.responsible_name)}</span></div>
  ${a.notes ? `<div class="sep"></div><div style="font-size:9px"><span class="lbl">Obs:</span>${esc(a.notes)}</div>` : ''}
  <div class="sep"></div>
  <img class="qr" src="${qrDataUrl}" alt="QR">
  <div class="center" style="font-size:8.5px">Escaneie para verificar</div>
  ${!cancel ? `
  <div style="margin-top:18px;border-top:1px solid #000;padding-top:3px;text-align:center;font-size:8.5px">Motorista</div>
  <div style="margin-top:18px;border-top:1px solid #000;padding-top:3px;text-align:center;font-size:8.5px">Mecânica</div>` : ''}
  <div class="center bold" style="font-size:8.5px;margin-top:8px">Gerir Frota</div>
  <script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 300);</script>
</body></html>`;
  w.document.open(); w.document.write(html); w.document.close();
}
