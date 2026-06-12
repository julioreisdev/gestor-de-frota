import { pageRoot, pageHeader, getEntity } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, fmtMoney, toast, formatPlate } from '../ui.js';
import { icons } from '../icons.js';
import Chart from 'https://esm.sh/chart.js@4.4.1/auto';
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

// =============================================================================
// ESTADO
// =============================================================================
let _fueling = [];
let _maintenance = [];
let _vehicles = [];
let _suppliers = [];
let _supplierFuels = [];
let _depts = [];
let _fuels = [];
let _fuelSubs = [];

let _filter = {
  from: '', to: '',
  dept: '', vehicle: '', supplier: '', fuel: '',
};

let _charts = [];

// Filtros internos por card (sobrepõem os filtros globais quando preenchidos)
let _saldoFilter = { supplier: '', contract: '', dept: '', fuel: '', status: '' };
let _kindFilter  = { vehicle: '', dept: '', supplier: '', kind: '', status: '' };

const COLORS = ['#217AD8', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#1A65B5'];

// =============================================================================
// ENTRY
// =============================================================================
export async function renderRelatorios() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Relatórios Gerenciais',
      subtitle: 'Análise consolidada da frota — combustível, manutenção e gastos.',
    })}
    <div id="rep-filter-card"></div>
    <div id="rep-loading" class="card">
      <div class="skeleton skeleton-line w-40"></div>
      <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
      <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
    </div>
    <div id="rep-content" style="display:none"></div>
  `;

  await loadAll();
  renderFilterCard();
  render();
}

async function loadAll() {
  const [f, m, v, s, sf, d, ft, fs] = await Promise.all([
    supabase.from('fueling').select(`
      id, vehicle_id, supplier_id, fuel_type_code, fuel_subtype_id,
      date, quantity, unit_price, total, km_initial, km_final,
      responsible_name, authorization_id,
      vehicle_plate_snapshot, department_acronym_snapshot, supplier_trade_name_snapshot,
      authorization:authorization_id(number)
    `).is('deleted_at', null),
    supabase.from('maintenance').select(`
      id, vehicle_id, supplier_id, kind, status, open_date, close_date,
      total_value, responsible_name, authorization_id, description
    `).is('deleted_at', null),
    supabase.from('vehicle').select(`
      id, plate, model, brand, current_km, tank_capacity,
      fuel_type_code, vehicle_origin_code, department_id, vehicle_type_code,
      department:department_id(acronym, name)
    `).is('deleted_at', null).order('plate'),
    supabase.from('supplier').select('id, kind, legal_name, trade_name, cnpj, contract_number, department_id').order('legal_name'),
    supabase.from('supplier_fuel').select('supplier_id, fuel_type_code, fuel_subtype_id, unit_price, contract_amount, current_balance'),
    supabase.from('department').select('id, acronym, name').order('acronym'),
    supabase.from('fuel_type').select('code, description').order('code'),
    supabase.from('fuel_subtype').select('id, fuel_type_code, description, active').eq('active', true),
  ]);
  if (f.error) toast('Erro: ' + f.error.message, 'error');
  _fueling = f.data || [];
  _maintenance = m.data || [];
  _vehicles = v.data || [];
  _suppliers = s.data || [];
  _supplierFuels = sf.data || [];
  _depts = d.data || [];
  _fuels = ft.data || [];
  _fuelSubs = fs.data || [];
}

// =============================================================================
// FILTROS — começa zerado (mostra TUDO). Filtra só quando o user escolhe.
// =============================================================================
function renderFilterCard() {
  const card = document.getElementById('rep-filter-card');
  card.innerHTML = `
    <div class="card report-filter-card">
      <div class="report-filter-head">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="width:18px;height:18px;display:inline-flex;color:var(--primary)">${icons.search}</span>
          <strong style="font-size:14px;color:var(--text)">Filtros</strong>
        </div>
        <div class="report-filter-actions">
          <button class="btn btn-outline btn-sm" id="btn-print-pdf-all">
            <span style="width:14px;height:14px;display:inline-flex">${icons.printer}</span> Imprimir PDF (tudo)
          </button>
          <button class="btn btn-outline btn-sm" id="btn-export-xlsx-all" style="color:var(--success);border-color:var(--success)">
            <span style="width:14px;height:14px;display:inline-flex">${icons.download}</span> Exportar Excel (tudo)
          </button>
        </div>
      </div>
      <div class="report-filter-grid">
        <div class="field"><label class="field-label">Data inicial</label><input class="input" type="date" id="rf-from" value="${_filter.from}"></div>
        <div class="field"><label class="field-label">Data final</label><input class="input" type="date" id="rf-to" value="${_filter.to}"></div>
        <div class="field"><label class="field-label">Secretaria</label><select class="select" id="rf-dept"><option value="">Todas</option></select></div>
        <div class="field"><label class="field-label">Veículo</label><select class="select" id="rf-veh"><option value="">Todos</option></select></div>
        <div class="field"><label class="field-label">Fornecedor</label><select class="select" id="rf-sup"><option value="">Todos</option></select></div>
        <div class="field"><label class="field-label">Combustível</label><select class="select" id="rf-fuel"><option value="">Todos</option></select></div>
        <div class="field"><label class="field-label" style="visibility:hidden">_</label><button class="btn btn-outline" id="rf-clear" style="width:100%">Limpar filtros</button></div>
      </div>
      <div class="report-filter-summary" id="rep-summary"></div>
    </div>
  `;
  document.getElementById('rf-dept').innerHTML += _depts.map(d => `<option value="${d.id}">${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');
  document.getElementById('rf-veh').innerHTML += _vehicles.map(v => `<option value="${v.id}">${esc(formatPlate(v.plate))} — ${esc(v.model)}</option>`).join('');
  document.getElementById('rf-sup').innerHTML += _suppliers.map(s => `<option value="${s.id}">${esc(s.trade_name || s.legal_name)}</option>`).join('');
  document.getElementById('rf-fuel').innerHTML += _fuels.map(f => `<option value="${f.code}">${esc(f.description)}</option>`).join('');

  if (_filter.dept) document.getElementById('rf-dept').value = _filter.dept;
  if (_filter.vehicle) document.getElementById('rf-veh').value = _filter.vehicle;
  if (_filter.supplier) document.getElementById('rf-sup').value = _filter.supplier;
  if (_filter.fuel) document.getElementById('rf-fuel').value = _filter.fuel;

  ['rf-from', 'rf-to', 'rf-dept', 'rf-veh', 'rf-sup', 'rf-fuel'].forEach(id => {
    document.getElementById(id).addEventListener('change', (e) => {
      const map = { 'rf-from': 'from', 'rf-to': 'to', 'rf-dept': 'dept', 'rf-veh': 'vehicle', 'rf-sup': 'supplier', 'rf-fuel': 'fuel' };
      _filter[map[id]] = e.target.value;
      render();
    });
  });
  document.getElementById('rf-clear').addEventListener('click', () => {
    _filter = { from: '', to: '', dept: '', vehicle: '', supplier: '', fuel: '' };
    renderFilterCard();
    render();
  });
  document.getElementById('btn-print-pdf-all').addEventListener('click', exportPDF);
  document.getElementById('btn-export-xlsx-all').addEventListener('click', exportAllXLSX);
}

function renderSummary(k) {
  const el = document.getElementById('rep-summary');
  if (!el) return;
  const parts = [];
  if (_filter.from || _filter.to) parts.push(`📅 ${_filter.from ? fmtDate(_filter.from) : 'início'} → ${_filter.to ? fmtDate(_filter.to) : 'hoje'}`);
  if (_filter.dept)    parts.push('🏛️ ' + (_depts.find(d => d.id === _filter.dept)?.acronym || ''));
  if (_filter.vehicle) parts.push('🚗 ' + formatPlate(_vehicles.find(v => v.id === _filter.vehicle)?.plate || ''));
  if (_filter.supplier) parts.push('🏪 ' + (_suppliers.find(s => s.id === _filter.supplier)?.trade_name || _suppliers.find(s => s.id === _filter.supplier)?.legal_name || ''));
  if (_filter.fuel)    parts.push('⛽ ' + (_fuels.find(f => f.code === Number(_filter.fuel))?.description || ''));
  el.innerHTML = `
    <div class="report-summary-filters">${parts.map(p => `<span class="filter-pill">${esc(p)}</span>`).join('') || '<span style="color:var(--text-muted);font-size:12px">Nenhum filtro adicional</span>'}</div>
    <div class="report-summary-stats">
      <span><b>${k.nAbastecimentos}</b> abastecimento(s)</span>
      <span><b>${k.totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</b></span>
      <span><b>${k.nManutencoes}</b> manutenção(ões)</span>
      <span style="color:var(--success);font-weight:600">Total <b>${fmtMoney(k.totalGasto)}</b></span>
    </div>
  `;
}

// =============================================================================
// HELPERS
// =============================================================================
function inDateRange(d) {
  if (_filter.from && d < _filter.from) return false;
  if (_filter.to && d > _filter.to) return false;
  return true;
}
function filteredFueling() {
  return _fueling.filter(a => {
    if (!inDateRange(a.date)) return false;
    if (_filter.supplier && a.supplier_id !== _filter.supplier) return false;
    if (_filter.vehicle && a.vehicle_id !== _filter.vehicle) return false;
    if (_filter.fuel && String(a.fuel_type_code) !== String(_filter.fuel)) return false;
    if (_filter.dept) {
      const v = _vehicles.find(x => x.id === a.vehicle_id);
      if (v?.department_id !== _filter.dept) return false;
    }
    return true;
  });
}
function filteredMaintenance() {
  return _maintenance.filter(a => {
    if (!inDateRange(a.open_date)) return false;
    if (_filter.supplier && a.supplier_id !== _filter.supplier) return false;
    if (_filter.vehicle && a.vehicle_id !== _filter.vehicle) return false;
    if (_filter.dept) {
      const v = _vehicles.find(x => x.id === a.vehicle_id);
      if (v?.department_id !== _filter.dept) return false;
    }
    return true;
  });
}

function computeKPIs(abs, man) {
  const totalLitros = abs.reduce((s, a) => s + Number(a.quantity || 0), 0);
  const totalComb   = abs.reduce((s, a) => s + Number(a.total || 0), 0);
  const totalMan    = man.reduce((s, a) => s + Number(a.total_value || 0), 0);
  const totalGasto  = totalComb + totalMan;
  const kmRodado   = abs.reduce((s, a) => (a.km_initial != null && a.km_final != null) ? s + Math.max(0, a.km_final - a.km_initial) : s, 0);
  const veicAtivos = new Set([...abs.map(a => a.vehicle_id), ...man.map(a => a.vehicle_id)]).size;
  return { totalLitros, totalComb, totalMan, totalGasto, kmRodado, veicAtivos, nAbastecimentos: abs.length, nManutencoes: man.length };
}

// Cada agg começa com TODOS os cadastros e ZEROS, depois soma o uso filtrado.
// Filtros estruturais (secretaria, veículo) recortam a base; demais (data,
// fornecedor, combustível) afetam só os somatórios. Cadastros aparecem
// mesmo sem uso.

function aggByVehicle(abs, man) {
  const acc = new Map();
  _vehicles.forEach(v => {
    if (_filter.vehicle && v.id !== _filter.vehicle) return;
    if (_filter.dept && v.department_id !== _filter.dept) return;
    acc.set(v.id, {
      id: v.id, plate: v.plate, model: v.model,
      dept: v.department?.acronym || '—',
      nAbs: 0, litros: 0, gastoComb: 0, km: 0, gastoMan: 0, nMan: 0,
    });
  });
  abs.forEach(a => {
    const r = acc.get(a.vehicle_id); if (!r) return;
    r.nAbs++; r.litros += +a.quantity || 0; r.gastoComb += +a.total || 0;
    if (a.km_initial != null && a.km_final != null) r.km += Math.max(0, a.km_final - a.km_initial);
  });
  man.forEach(a => {
    const r = acc.get(a.vehicle_id); if (!r) return;
    r.gastoMan += +a.total_value || 0; r.nMan++;
  });
  return [...acc.values()]
    .map(r => ({ ...r, total: r.gastoComb + r.gastoMan, consumo: r.litros > 0 && r.km > 0 ? (r.km / r.litros) : null }))
    .sort((a, b) => b.total - a.total || a.plate.localeCompare(b.plate));
}

function aggByDept(abs, man) {
  const acc = new Map();
  _depts.forEach(d => {
    if (_filter.dept && d.id !== _filter.dept) return;
    acc.set(d.id, {
      id: d.id, acronym: d.acronym, name: d.name,
      nAbs: 0, litros: 0, gastoComb: 0, gastoMan: 0, nMan: 0,
    });
  });
  // bucket "Sem secretaria" só aparece se houver veículo sem dept E uso
  abs.forEach(a => {
    const v = _vehicles.find(x => x.id === a.vehicle_id);
    const k = v?.department_id || '__sem__';
    if (!acc.has(k)) {
      if (_filter.dept) return;
      acc.set(k, { id: k, acronym: 'SEM', name: 'Sem secretaria', nAbs: 0, litros: 0, gastoComb: 0, gastoMan: 0, nMan: 0 });
    }
    const r = acc.get(k);
    r.nAbs++; r.litros += +a.quantity || 0; r.gastoComb += +a.total || 0;
  });
  man.forEach(a => {
    const v = _vehicles.find(x => x.id === a.vehicle_id);
    const k = v?.department_id || '__sem__';
    if (!acc.has(k)) {
      if (_filter.dept) return;
      acc.set(k, { id: k, acronym: 'SEM', name: 'Sem secretaria', nAbs: 0, litros: 0, gastoComb: 0, gastoMan: 0, nMan: 0 });
    }
    const r = acc.get(k);
    r.gastoMan += +a.total_value || 0; r.nMan++;
  });
  return [...acc.values()]
    .map(r => ({ ...r, total: r.gastoComb + r.gastoMan }))
    .sort((a, b) => b.total - a.total || a.acronym.localeCompare(b.acronym));
}

function aggBySupplier(abs, man) {
  const acc = new Map();
  _suppliers.forEach(s => {
    if (_filter.supplier && s.id !== _filter.supplier) return;
    acc.set(s.id, {
      id: s.id, name: s.trade_name || s.legal_name, kind: s.kind || '',
      nAbs: 0, litros: 0, fatComb: 0, fatMan: 0, nMan: 0,
    });
  });
  abs.forEach(a => {
    const r = acc.get(a.supplier_id); if (!r) return;
    r.nAbs++; r.litros += +a.quantity || 0; r.fatComb += +a.total || 0;
  });
  man.forEach(a => {
    const r = acc.get(a.supplier_id); if (!r) return;
    r.fatMan += +a.total_value || 0; r.nMan++;
  });
  return [...acc.values()]
    .map(r => ({ ...r, total: r.fatComb + r.fatMan }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function aggByFuel(abs) {
  const acc = new Map();
  // Base: combustíveis presentes nos contratos (supplier_fuel) — os que a
  // cidade efetivamente comercializa. Sempre listamos todos, mesmo zerados.
  const codes = new Set(_supplierFuels.map(sf => sf.fuel_type_code));
  abs.forEach(a => codes.add(a.fuel_type_code));
  [...codes].forEach(code => {
    if (_filter.fuel && String(code) !== String(_filter.fuel)) return;
    acc.set(code, {
      code, description: _fuels.find(f => f.code === code)?.description || `Cód ${code}`,
      nAbs: 0, litros: 0, gasto: 0,
    });
  });
  abs.forEach(a => {
    const r = acc.get(a.fuel_type_code); if (!r) return;
    r.nAbs++; r.litros += +a.quantity || 0; r.gasto += +a.total || 0;
  });
  return [...acc.values()]
    .map(r => ({ ...r, pricMed: r.litros > 0 ? r.gasto / r.litros : 0 }))
    .sort((a, b) => b.litros - a.litros || a.description.localeCompare(b.description));
}

function aggByMaintKind(man) {
  const K = { preventiva: 'Preventiva', corretiva: 'Corretiva', sinistro: 'Sinistro', revisao: 'Revisão', outros: 'Outros' };
  const f = _kindFilter;
  const filteredMan = man.filter(m => {
    if (f.kind && m.kind !== f.kind) return false;
    if (f.status && m.status !== f.status) return false;
    if (f.vehicle && m.vehicle_id !== f.vehicle) return false;
    if (f.supplier && m.supplier_id !== f.supplier) return false;
    if (f.dept) {
      const v = _vehicles.find(x => x.id === m.vehicle_id);
      if (v?.department_id !== f.dept) return false;
    }
    return true;
  });
  return Object.keys(K).map(k => {
    const items = filteredMan.filter(x => x.kind === k);
    return { kind: k, label: K[k], count: items.length, total: items.reduce((s, m) => s + (+m.total_value || 0), 0) };
  }).sort((a, b) => b.total - a.total);
}
function aggSaldo() {
  // Combina filtro global + filtro interno do card (interno tem prioridade)
  const supF  = _saldoFilter.supplier || _filter.supplier;
  const fuelF = _saldoFilter.fuel     || _filter.fuel;
  const deptF = _saldoFilter.dept     || _filter.dept;
  const contractF = _saldoFilter.contract;
  const statusF   = _saldoFilter.status;
  return _supplierFuels.filter(sf => {
    if (supF && sf.supplier_id !== supF) return false;
    if (fuelF && String(sf.fuel_type_code) !== String(fuelF)) return false;
    const s = _suppliers.find(x => x.id === sf.supplier_id);
    if (deptF && s?.department_id !== deptF) return false;
    if (contractF && s?.contract_number !== contractF) return false;
    return true;
  }).map(sf => {
    const s = _suppliers.find(x => x.id === sf.supplier_id);
    const desc = sf.fuel_subtype_id
      ? (_fuelSubs.find(x => x.id === sf.fuel_subtype_id)?.description)
      : (_fuels.find(f => f.code === sf.fuel_type_code)?.description);
    const used = Number(sf.contract_amount || 0) === 0 ? 0 : Math.max(0, Number(sf.contract_amount) - Number(sf.current_balance));
    const pct = Number(sf.contract_amount) > 0 ? (Number(sf.current_balance) / Number(sf.contract_amount) * 100) : null;
    return {
      supplier_id: sf.supplier_id,
      supplier_name: s?.trade_name || s?.legal_name || '—',
      contract_number: s?.contract_number || '',
      fuel: desc || `Cód ${sf.fuel_type_code}`,
      unit_price: Number(sf.unit_price),
      contract_amount: Number(sf.contract_amount),
      current_balance: Number(sf.current_balance),
      used, pct,
      status: pct == null ? 'ilim' : pct > 50 ? 'ok' : pct > 20 ? 'atencao' : 'crit',
    };
  })
  .filter(r => !statusF || r.status === statusF)
  .sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
}

// =============================================================================
// RENDER
// =============================================================================
function render() {
  destroyCharts();
  const abs = filteredFueling();
  const man = filteredMaintenance();
  const k = computeKPIs(abs, man);
  const byDept = aggByDept(abs, man);
  const byVeh = aggByVehicle(abs, man);
  const bySup = aggBySupplier(abs, man);
  const byFuel = aggByFuel(abs);
  const byKind = aggByMaintKind(man);
  const saldos = aggSaldo();

  document.getElementById('rep-loading').style.display = 'none';
  const root = document.getElementById('rep-content');
  root.style.display = 'block';

  renderSummary(k);

  // Gráficos só se houver pelo menos algum valor > 0
  const hasDeptVals = byDept.some(r => r.total > 0);
  const hasSupVals  = bySup.some(r => r.total > 0);
  const hasFuelVals = byFuel.some(r => r.litros > 0);

  root.innerHTML = `
    ${kpiRow(k)}
    ${section('por-secretaria', '🏛️ Por Secretaria',
      tblDept(byDept),
      hasDeptVals ? chartCanvas('chart-dept', 230) : '')}
    ${section('por-veiculo', '🚗 Por Veículo', tblVehicle(byVeh))}
    ${section('por-fornecedor', '🏪 Por Fornecedor',
      tblSupplier(bySup),
      hasSupVals ? chartCanvas('chart-sup', 230) : '')}
    ${section('por-combustivel', '⛽ Por Combustível',
      tblFuel(byFuel),
      hasFuelVals ? chartCanvas('chart-fuel', 230) : '')}
    ${section('por-manutencao', '🔧 Manutenções por Categoria', renderKindFilters() + tblMaintKind(byKind))}
    ${section('saldo-contrato', '💰 Saldo Disponível por Fornecedor e Combustível', renderSaldoFilters() + tblSaldo(saldos))}
    ${section('abast-detalhado', '📋 Abastecimentos por Secretaria (detalhado)', tblAbastecimentosPorSec(abs))}
  `;

  // bind dos botões PDF/Excel por seção
  document.querySelectorAll('[data-export-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = btn.dataset.exportSection;
      const fmt = btn.dataset.exportFormat;
      exportSection(sec, fmt);
    });
  });

  // charts
  drawCharts({ byDept, bySup, byFuel });

  // bind dos filtros internos do card Saldo
  document.querySelectorAll('[data-saldof]').forEach(el => {
    el.addEventListener('change', e => { _saldoFilter[e.target.dataset.saldof] = e.target.value; render(); });
  });
  const clearSaldo = document.getElementById('saldo-clear');
  if (clearSaldo) clearSaldo.addEventListener('click', () => {
    _saldoFilter = { supplier: '', contract: '', dept: '', fuel: '', status: '' };
    render();
  });
  // bind dos filtros internos do card Manutenção por Categoria
  document.querySelectorAll('[data-kindf]').forEach(el => {
    el.addEventListener('change', e => { _kindFilter[e.target.dataset.kindf] = e.target.value; render(); });
  });
  const clearKind = document.getElementById('kind-clear');
  if (clearKind) clearKind.addEventListener('click', () => {
    _kindFilter = { vehicle: '', dept: '', supplier: '', kind: '', status: '' };
    render();
  });
}

function renderSaldoFilters() {
  const contractNumbers = [...new Set(_suppliers.map(s => s.contract_number).filter(Boolean))].sort();
  const F = _saldoFilter;
  const opt = (val, label, sel) => `<option value="${esc(val)}" ${val === sel ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <div class="report-inner-filters">
      <div class="field"><label class="field-label">Fornecedor</label>
        <select class="select" data-saldof="supplier">
          <option value="">Todos os Fornecedores</option>
          ${_suppliers.map(s => opt(s.id, s.trade_name || s.legal_name, F.supplier)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Nº Contrato</label>
        <select class="select" data-saldof="contract">
          <option value="">Todos os Contratos</option>
          ${contractNumbers.map(c => opt(c, c, F.contract)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Secretaria</label>
        <select class="select" data-saldof="dept">
          <option value="">Todas as Secretarias</option>
          ${_depts.map(d => opt(d.id, `${d.acronym} — ${d.name}`, F.dept)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Combustível</label>
        <select class="select" data-saldof="fuel">
          <option value="">Todos os Combustíveis</option>
          ${_fuels.map(f => opt(String(f.code), f.description, F.fuel)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Situação</label>
        <select class="select" data-saldof="status">
          <option value="">Todas as Situações</option>
          <option value="ok"      ${F.status === 'ok' ? 'selected' : ''}>OK (&gt; 50%)</option>
          <option value="atencao" ${F.status === 'atencao' ? 'selected' : ''}>Atenção (20-50%)</option>
          <option value="crit"    ${F.status === 'crit' ? 'selected' : ''}>Crítico (&lt; 20%)</option>
          <option value="ilim"    ${F.status === 'ilim' ? 'selected' : ''}>Ilimitado</option>
        </select>
      </div>
      <div class="field" style="align-self:end">
        <button class="btn btn-outline btn-sm" id="saldo-clear" style="height:38px">✕ Limpar filtros</button>
      </div>
    </div>
  `;
}

function renderKindFilters() {
  const F = _kindFilter;
  const opt = (val, label, sel) => `<option value="${esc(val)}" ${val === sel ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <div class="report-inner-filters">
      <div class="field"><label class="field-label">Veículo</label>
        <select class="select" data-kindf="vehicle">
          <option value="">Todos os Veículos</option>
          ${_vehicles.map(v => opt(v.id, `${formatPlate(v.plate)} — ${v.model}`, F.vehicle)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Secretaria</label>
        <select class="select" data-kindf="dept">
          <option value="">Todas as Secretarias</option>
          ${_depts.map(d => opt(d.id, `${d.acronym} — ${d.name}`, F.dept)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Mecânica</label>
        <select class="select" data-kindf="supplier">
          <option value="">Todas as Mecânicas</option>
          ${_suppliers.filter(s => s.kind === 'mecanica' || s.kind === 'ambos').map(s => opt(s.id, s.trade_name || s.legal_name, F.supplier)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Categoria</label>
        <select class="select" data-kindf="kind">
          <option value="">Todas as Categorias</option>
          ${['preventiva','corretiva','sinistro','revisao','outros'].map(k => opt(k, k.charAt(0).toUpperCase() + k.slice(1), F.kind)).join('')}
        </select>
      </div>
      <div class="field"><label class="field-label">Status</label>
        <select class="select" data-kindf="status">
          <option value="">Todos os Status</option>
          ${['aberta','em_andamento','concluida','cancelada'].map(s => opt(s, s === 'em_andamento' ? 'Em andamento' : s.charAt(0).toUpperCase() + s.slice(1), F.status)).join('')}
        </select>
      </div>
      <div class="field" style="align-self:end">
        <button class="btn btn-outline btn-sm" id="kind-clear" style="height:38px">✕ Limpar filtros</button>
      </div>
    </div>
  `;
}

function kpiRow(k) {
  return `
    <div class="stat-row" style="margin-bottom:var(--s-4)">
      <div class="stat"><label>Veículos ativos</label><strong>${k.veicAtivos}</strong></div>
      <div class="stat"><label>Abastecimentos</label><strong>${k.nAbastecimentos}</strong></div>
      <div class="stat"><label>Litros totais</label><strong>${k.totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</strong></div>
      <div class="stat"><label>KM rodado</label><strong>${k.kmRodado.toLocaleString('pt-BR')}</strong></div>
      <div class="stat"><label>Gasto combustível</label><strong style="color:var(--primary)">${fmtMoney(k.totalComb)}</strong></div>
      <div class="stat"><label>Manutenções</label><strong>${k.nManutencoes}</strong></div>
      <div class="stat"><label>Gasto manutenção</label><strong style="color:var(--warning)">${fmtMoney(k.totalMan)}</strong></div>
      <div class="stat"><label>Gasto total</label><strong style="color:var(--success)">${fmtMoney(k.totalGasto)}</strong></div>
    </div>
  `;
}

function section(id, title, tableHTML, chartHTML = '') {
  const hasContent = tableHTML.includes('<tbody');
  return `
    <div class="card report-card" id="rep-${id}">
      <div class="report-card-header">
        <h3>${title}</h3>
        <div class="report-card-actions">
          <button class="btn btn-sm report-btn-pdf" data-export-section="${id}" data-export-format="pdf" ${hasContent ? '' : 'disabled'}>
            <span style="width:14px;height:14px;display:inline-flex">${icons.printer}</span> PDF
          </button>
          <button class="btn btn-sm report-btn-xlsx" data-export-section="${id}" data-export-format="xlsx" ${hasContent ? '' : 'disabled'}>
            <span style="width:14px;height:14px;display:inline-flex">${icons.download}</span> Excel
          </button>
        </div>
      </div>
      ${chartHTML
        ? `<div class="report-grid"><div class="report-chart-wrap">${chartHTML}</div><div>${tableHTML}</div></div>`
        : tableHTML}
    </div>
  `;
}

function chartCanvas(id, h) {
  return `<canvas id="${id}" style="max-height:${h}px"></canvas>`;
}

function tblEmpty(msg = 'Sem dados no período.') {
  return `<div class="report-empty">${icons.barChart}<span>${msg}</span></div>`;
}

function tblDept(rows) {
  if (!rows.length) return tblEmpty();
  return tableHTML(
    ['Sigla', 'Secretaria', 'Abast.', 'Litros', 'Gasto comb.', 'Manut.', 'Gasto manut.', 'Total'],
    rows.map(r => [
      { v: r.acronym, html: `<span class="badge">${esc(r.acronym)}</span>` },
      r.name,
      { v: r.nAbs, cls: 'num' },
      { v: r.litros.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' L', cls: 'num' },
      { v: fmtMoney(r.gastoComb), cls: 'money' },
      { v: r.nMan, cls: 'num' },
      { v: fmtMoney(r.gastoMan), cls: 'money' },
      { v: fmtMoney(r.total), cls: 'money', style: 'color:var(--success);font-weight:600' },
    ])
  );
}
function tblVehicle(rows) {
  if (!rows.length) return tblEmpty();
  return tableHTML(
    ['Placa', 'Modelo', 'Sec.', 'Abast.', 'Litros', 'KM', 'km/L', 'Gasto comb.', 'Manut.', 'Gasto manut.', 'Total'],
    rows.map(r => [
      { v: formatPlate(r.plate), html: `<strong>${esc(formatPlate(r.plate))}</strong>` },
      r.model,
      r.dept,
      { v: r.nAbs, cls: 'num' },
      { v: r.litros.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' L', cls: 'num' },
      { v: r.km.toLocaleString('pt-BR'), cls: 'num' },
      { v: r.consumo != null ? r.consumo.toFixed(2) : '—', cls: 'num' },
      { v: fmtMoney(r.gastoComb), cls: 'money' },
      { v: r.nMan, cls: 'num' },
      { v: fmtMoney(r.gastoMan), cls: 'money' },
      { v: fmtMoney(r.total), cls: 'money', style: 'color:var(--success);font-weight:600' },
    ])
  );
}
function tblSupplier(rows) {
  if (!rows.length) return tblEmpty();
  return tableHTML(
    ['Fornecedor', 'Tipo', 'Abast.', 'Litros', 'Fat. comb.', 'Manut.', 'Fat. manut.', 'Total'],
    rows.map(r => [
      r.name,
      r.kind === 'posto' ? 'Posto' : r.kind === 'mecanica' ? 'Mecânica' : 'Ambos',
      { v: r.nAbs, cls: 'num' },
      { v: r.litros.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' L', cls: 'num' },
      { v: fmtMoney(r.fatComb), cls: 'money' },
      { v: r.nMan, cls: 'num' },
      { v: fmtMoney(r.fatMan), cls: 'money' },
      { v: fmtMoney(r.total), cls: 'money', style: 'color:var(--success);font-weight:600' },
    ])
  );
}
function tblFuel(rows) {
  if (!rows.length) return tblEmpty();
  return tableHTML(
    ['Combustível', 'Abast.', 'Litros', 'Preço médio', 'Total'],
    rows.map(r => [
      { v: r.description, html: `<strong>${esc(r.description)}</strong>` },
      { v: r.nAbs, cls: 'num' },
      { v: r.litros.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' L', cls: 'num' },
      { v: 'R$ ' + r.pricMed.toFixed(3), cls: 'money' },
      { v: fmtMoney(r.gasto), cls: 'money', style: 'color:var(--success);font-weight:600' },
    ])
  );
}
function tblMaintKind(rows) {
  if (!rows.length) return tblEmpty('Sem manutenções no período.');
  return tableHTML(
    ['Categoria', 'Quantidade', 'Gasto total', 'Ticket médio'],
    rows.map(r => [
      r.label,
      { v: r.count, cls: 'num' },
      { v: fmtMoney(r.total), cls: 'money', style: 'color:var(--success);font-weight:600' },
      { v: fmtMoney(r.count > 0 ? r.total / r.count : 0), cls: 'money' },
    ])
  );
}
function tblSaldo(rows) {
  if (!rows.length) return tblEmpty('Nenhum contrato de combustível cadastrado.');
  return tableHTML(
    ['Fornecedor', 'Nº Contrato', 'Combustível', 'R$/L', 'Contrato (L)', 'Utilizado (L)', 'Saldo Atual (L)', '% Saldo', 'Situação'],
    rows.map(r => {
      const statusBadge = r.status === 'ilim'
        ? '<span class="badge badge-neutral">Ilimitado</span>'
        : r.status === 'ok'
        ? '<span class="badge badge-success">OK</span>'
        : r.status === 'atencao'
        ? '<span class="badge badge-warning">Atenção</span>'
        : '<span class="badge badge-danger">Crítico</span>';
      const pctTxt = r.pct == null ? '—' : r.pct.toFixed(1) + '%';
      return [
        r.supplier_name,
        r.contract_number || '—',
        r.fuel,
        { v: 'R$ ' + r.unit_price.toFixed(3), cls: 'money' },
        { v: r.contract_amount === 0 ? 'Ilimitado' : r.contract_amount.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), cls: 'num' },
        { v: r.used ? r.used.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—', cls: 'num' },
        { v: r.current_balance.toLocaleString('pt-BR', { maximumFractionDigits: 2 }), cls: 'num', style: 'font-weight:600' },
        { v: pctTxt, cls: 'num' },
        { v: r.status, html: statusBadge },
      ];
    })
  );
}

/** Lista detalhada de abastecimentos AGRUPADA por secretaria, com nº da
 *  autorização. Pedido do cliente: "relatorio de abastecimento contenha o
 *  numero autorização, separe por secretaria". */
function tblAbastecimentosPorSec(absList) {
  if (!absList.length) return tblEmpty('Sem abastecimentos no período.');
  // Agrupa por secretaria do veículo (resolve via vehicle.department_id)
  const groups = new Map();
  for (const a of absList) {
    const v = _vehicles.find(x => x.id === a.vehicle_id);
    const d = _depts.find(x => x.id === v?.department_id);
    const key = d?.id || '__sem__';
    if (!groups.has(key)) {
      groups.set(key, {
        acronym: d?.acronym || 'SEM',
        name: d?.name || 'Sem secretaria',
        items: [],
      });
    }
    groups.get(key).items.push(a);
  }
  // Ordena: secretaria com mais valor primeiro
  const sortedGroups = [...groups.values()]
    .map(g => ({ ...g, total: g.items.reduce((s, i) => s + Number(i.total || 0), 0), litros: g.items.reduce((s, i) => s + Number(i.quantity || 0), 0) }))
    .sort((a, b) => b.total - a.total);
  return sortedGroups.map(g => `
    <div class="abast-sec-group">
      <div class="abast-sec-head">
        <span class="badge">${esc(g.acronym)}</span>
        <strong>${esc(g.name)}</strong>
        <span class="abast-sec-meta">${g.items.length} abast. · ${g.litros.toLocaleString('pt-BR',{maximumFractionDigits:2})} L · ${fmtMoney(g.total)}</span>
      </div>
      <div class="table-wrap">
        <table class="table"><thead><tr>
          <th>Data</th><th>Nº Autorização</th><th>Veículo</th><th>Combustível</th>
          <th>Qtd</th><th>R$/L</th><th>Total</th><th>Responsável</th><th>Fornecedor</th>
        </tr></thead><tbody>
          ${g.items.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(a => {
            const autNum = a.authorization?.number || '—';
            return `<tr>
              <td data-label="Data">${esc(fmtDate(a.date))}</td>
              <td data-label="Nº Autorização" style="font-family:ui-monospace,monospace;font-size:11.5px">${esc(autNum)}</td>
              <td data-label="Veículo"><strong>${esc(formatPlate(a.vehicle_plate_snapshot))}</strong></td>
              <td data-label="Combustível">${esc(_fuels.find(f => f.code === a.fuel_type_code)?.description || `Cód ${a.fuel_type_code}`)}</td>
              <td data-label="Qtd" class="num">${Number(a.quantity).toFixed(2)} L</td>
              <td data-label="R$/L" class="num">${Number(a.unit_price).toFixed(3)}</td>
              <td data-label="Total" class="money" style="color:var(--success);font-weight:600">${fmtMoney(a.total)}</td>
              <td data-label="Responsável" style="font-size:12px">${esc(a.responsible_name || '—')}</td>
              <td data-label="Fornecedor" style="font-size:12px">${esc(a.supplier_trade_name_snapshot || '—')}</td>
            </tr>`;
          }).join('')}
        </tbody></table>
      </div>
    </div>
  `).join('');
}

function tableHTML(cols, rows) {
  const labelOf = (i) => cols[i];
  return `
    <div class="table-wrap">
      <table class="table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(r => `<tr>${r.map((c, i) => {
        const cell = (typeof c === 'object' && c !== null && !Array.isArray(c)) ? c : { v: c };
        const style = cell.style ? `style="${cell.style}"` : '';
        const cls = cell.cls ? `class="${cell.cls}"` : '';
        const content = cell.html != null ? cell.html : esc(cell.v ?? '');
        return `<td data-label="${esc(labelOf(i))}" ${cls} ${style}>${content}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>
    </div>
  `;
}

// =============================================================================
// CHARTS
// =============================================================================
function destroyCharts() { _charts.forEach(c => { try { c.destroy(); } catch {} }); _charts = []; }
function drawCharts({ byDept, bySup, byFuel }) {
  const deptEl = document.getElementById('chart-dept');
  if (deptEl && byDept.some(r => r.total > 0)) {
    const rows = byDept.filter(r => r.total > 0);
    _charts.push(new Chart(deptEl, {
      type: 'bar',
      data: { labels: rows.map(r => r.acronym), datasets: [
        { label: 'Combustível', data: rows.map(r => r.gastoComb), backgroundColor: COLORS[0] },
        { label: 'Manutenção',  data: rows.map(r => r.gastoMan),  backgroundColor: COLORS[2] },
      ]},
      options: chartOpts({ stacked: true, money: true }),
    }));
  }
  const supEl = document.getElementById('chart-sup');
  if (supEl && bySup.some(r => r.total > 0)) {
    const top = bySup.filter(r => r.total > 0).slice(0, 8);
    _charts.push(new Chart(supEl, {
      type: 'bar',
      data: { labels: top.map(r => r.name.length > 18 ? r.name.slice(0, 17) + '…' : r.name),
              datasets: [{ label: 'Total faturado', data: top.map(r => r.total), backgroundColor: COLORS[1] }] },
      options: chartOpts({ horizontal: true, money: true }),
    }));
  }
  const fuelEl = document.getElementById('chart-fuel');
  if (fuelEl && byFuel.some(r => r.litros > 0)) {
    const rows = byFuel.filter(r => r.litros > 0);
    _charts.push(new Chart(fuelEl, {
      type: 'doughnut',
      data: { labels: rows.map(r => r.description), datasets: [{ data: rows.map(r => r.litros), backgroundColor: COLORS, borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } },
    }));
  }
}
function chartOpts({ stacked = false, horizontal = false, money = false } = {}) {
  return {
    indexAxis: horizontal ? 'y' : 'x',
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label || ''}: ${money ? fmtMoney(ctx.parsed[horizontal ? 'x' : 'y']) : ctx.parsed[horizontal ? 'x' : 'y']}` } },
    },
    scales: {
      x: { stacked, ticks: horizontal && money ? { callback: (v) => 'R$' + Number(v).toLocaleString('pt-BR') } : {} },
      y: { stacked, ticks: !horizontal && money ? { callback: (v) => 'R$' + Number(v).toLocaleString('pt-BR') } : {} },
    },
  };
}

// =============================================================================
// EXPORTS POR SEÇÃO
// =============================================================================
function getSectionData(sec) {
  const abs = filteredFueling();
  const man = filteredMaintenance();
  switch (sec) {
    case 'por-secretaria': return {
      title: 'Por Secretaria',
      cols: ['Sigla', 'Secretaria', 'Abast.', 'Litros', 'Gasto Combustível', 'Manut.', 'Gasto Manutenção', 'Total'],
      rows: aggByDept(abs, man).map(r => [r.acronym, r.name, r.nAbs, +r.litros.toFixed(2), +r.gastoComb.toFixed(2), r.nMan, +r.gastoMan.toFixed(2), +r.total.toFixed(2)]),
    };
    case 'por-veiculo': return {
      title: 'Por Veículo',
      cols: ['Placa', 'Modelo', 'Secretaria', 'Abast.', 'Litros', 'KM Rodado', 'Consumo km/L', 'Gasto Combustível', 'Manut.', 'Gasto Manutenção', 'Total'],
      rows: aggByVehicle(abs, man).map(r => [formatPlate(r.plate), r.model, r.dept, r.nAbs, +r.litros.toFixed(2), r.km, r.consumo != null ? +r.consumo.toFixed(2) : '', +r.gastoComb.toFixed(2), r.nMan, +r.gastoMan.toFixed(2), +r.total.toFixed(2)]),
    };
    case 'por-fornecedor': return {
      title: 'Por Fornecedor',
      cols: ['Fornecedor', 'Tipo', 'Abast.', 'Litros', 'Faturado Combustível', 'Manut.', 'Faturado Manutenção', 'Total'],
      rows: aggBySupplier(abs, man).map(r => [r.name, r.kind, r.nAbs, +r.litros.toFixed(2), +r.fatComb.toFixed(2), r.nMan, +r.fatMan.toFixed(2), +r.total.toFixed(2)]),
    };
    case 'por-combustivel': return {
      title: 'Por Combustível',
      cols: ['Combustível', 'Abast.', 'Litros', 'Preço Médio', 'Gasto Total'],
      rows: aggByFuel(abs).map(r => [r.description, r.nAbs, +r.litros.toFixed(2), +r.pricMed.toFixed(3), +r.gasto.toFixed(2)]),
    };
    case 'por-manutencao': return {
      title: 'Manutenções por Categoria',
      cols: ['Categoria', 'Quantidade', 'Gasto Total', 'Ticket Médio'],
      rows: aggByMaintKind(man).map(r => [r.label, r.count, +r.total.toFixed(2), +(r.count > 0 ? r.total / r.count : 0).toFixed(2)]),
    };
    case 'saldo-contrato': return {
      title: 'Saldo Disponível por Fornecedor e Combustível',
      cols: ['Fornecedor', 'Nº Contrato', 'Combustível', 'R$/L', 'Contrato (L)', 'Utilizado (L)', 'Saldo Atual (L)', '% Saldo'],
      rows: aggSaldo().map(r => [r.supplier_name, r.contract_number || '', r.fuel, +r.unit_price.toFixed(3), r.contract_amount === 0 ? 'Ilimitado' : +r.contract_amount.toFixed(2), r.used ? +r.used.toFixed(2) : '', +r.current_balance.toFixed(2), r.pct != null ? +r.pct.toFixed(1) : '']),
    };
    case 'abast-detalhado': {
      // Lista achatada com Secretaria como primeira coluna, ordenada por sec
      // depois data desc.
      const rows = [...abs]
        .sort((a, b) => {
          const va = _vehicles.find(x => x.id === a.vehicle_id);
          const vb = _vehicles.find(x => x.id === b.vehicle_id);
          const da = _depts.find(x => x.id === va?.department_id)?.acronym || 'ZZZ';
          const db = _depts.find(x => x.id === vb?.department_id)?.acronym || 'ZZZ';
          if (da !== db) return da.localeCompare(db);
          return (b.date || '').localeCompare(a.date || '');
        })
        .map(a => {
          const v = _vehicles.find(x => x.id === a.vehicle_id);
          const d = _depts.find(x => x.id === v?.department_id);
          return [
            d?.acronym || 'SEM',
            d?.name || 'Sem secretaria',
            fmtDate(a.date),
            a.authorization?.number || '',
            formatPlate(a.vehicle_plate_snapshot),
            _fuels.find(f => f.code === a.fuel_type_code)?.description || `Cód ${a.fuel_type_code}`,
            +Number(a.quantity).toFixed(2),
            +Number(a.unit_price).toFixed(3),
            +Number(a.total).toFixed(2),
            a.responsible_name || '',
            a.supplier_trade_name_snapshot || '',
          ];
        });
      return {
        title: 'Abastecimentos por Secretaria',
        cols: ['Sigla', 'Secretaria', 'Data', 'Nº Autorização', 'Veículo', 'Combustível', 'Qtd (L)', 'R$/L', 'Total (R$)', 'Responsável', 'Fornecedor'],
        rows,
      };
    }
  }
}

async function exportSection(sec, fmt) {
  const data = getSectionData(sec);
  if (!data || !data.rows.length) { toast('Sem dados para exportar.', 'warning'); return; }
  if (fmt === 'xlsx') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([data.cols, ...data.rows]);
    ws['!cols'] = data.cols.map(c => ({ wch: Math.min(Math.max(c.length + 4, 12), 36) }));
    XLSX.utils.book_append_sheet(wb, ws, data.title.slice(0, 31));
    XLSX.writeFile(wb, `relatorio_${sec}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast(`${data.title} exportado.`, 'success');
  } else {
    await exportPDFCustom(data.title, data.cols, data.rows);
  }
}

// =============================================================================
// EXPORT TUDO (XLSX e PDF)
// =============================================================================
function exportAllXLSX() {
  const sections = ['por-secretaria', 'por-veiculo', 'por-fornecedor', 'por-combustivel', 'por-manutencao', 'saldo-contrato', 'abast-detalhado'];
  const datas = sections.map(getSectionData).filter(d => d?.rows.length);
  if (!datas.length) { toast('Sem dados para exportar.', 'warning'); return; }
  const wb = XLSX.utils.book_new();

  // KPIs como primeira aba
  const abs = filteredFueling(); const man = filteredMaintenance(); const k = computeKPIs(abs, man);
  const wsK = XLSX.utils.aoa_to_sheet([
    ['Indicador', 'Valor'],
    ['Veículos ativos', k.veicAtivos],
    ['Abastecimentos', k.nAbastecimentos],
    ['Litros totais', +k.totalLitros.toFixed(2)],
    ['KM rodado', k.kmRodado],
    ['Gasto combustível (R$)', +k.totalComb.toFixed(2)],
    ['Manutenções', k.nManutencoes],
    ['Gasto manutenção (R$)', +k.totalMan.toFixed(2)],
    ['Gasto total (R$)', +k.totalGasto.toFixed(2)],
  ]);
  wsK['!cols'] = [{ wch: 28 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsK, 'KPIs');

  datas.forEach(d => {
    const ws = XLSX.utils.aoa_to_sheet([d.cols, ...d.rows]);
    ws['!cols'] = d.cols.map(c => ({ wch: Math.min(Math.max(c.length + 4, 12), 36) }));
    XLSX.utils.book_append_sheet(wb, ws, d.title.slice(0, 31));
  });
  XLSX.writeFile(wb, `relatorio_frota_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast(`${datas.length} seção(ões) exportadas.`, 'success');
}

async function exportPDFCustom(title, cols, rows) {
  const entity = await getEntity();
  const orgao = entity?.organ_name || 'Prefeitura Municipal';
  const logo = new URL('logo.png', location.href).href;
  const ibge = entity?.ibge_code || '';
  const now = new Date().toLocaleString('pt-BR');
  const period = `${_filter.from ? fmtDate(_filter.from) : 'início'} a ${_filter.to ? fmtDate(_filter.to) : 'hoje'}`;
  const w = window.open('', '_blank', 'width=1200,height=900');
  if (!w) { toast('Permita popups para imprimir.', 'error'); return; }
  const th = cols.map(c => `<th>${esc(c)}</th>`).join('');
  const tb = rows.map(r => `<tr>${r.map(v => `<td>${esc(v ?? '')}</td>`).join('')}</tr>`).join('');
  w.document.write(pdfTemplate({ orgao, logo, ibge, now, period, entity_type: entity?.entity_type, body: `
    <h2 class="section">${esc(title)}</h2>
    <table class="data"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>
  ` }));
  w.document.close();
}

async function exportPDF() {
  const sections = ['por-secretaria', 'por-veiculo', 'por-fornecedor', 'por-combustivel', 'por-manutencao', 'saldo-contrato', 'abast-detalhado'];
  const datas = sections.map(s => ({ key: s, ...getSectionData(s) })).filter(d => d.rows && d.rows.length);
  if (!datas.length) { toast('Sem dados para imprimir.', 'warning'); return; }
  const entity = await getEntity();
  const orgao = entity?.organ_name || 'Prefeitura Municipal';
  const logo = new URL('logo.png', location.href).href;
  const ibge = entity?.ibge_code || '';
  const now = new Date().toLocaleString('pt-BR');
  const period = `${_filter.from ? fmtDate(_filter.from) : 'início'} a ${_filter.to ? fmtDate(_filter.to) : 'hoje'}`;
  const k = computeKPIs(filteredFueling(), filteredMaintenance());

  const w = window.open('', '_blank', 'width=1200,height=900');
  if (!w) { toast('Permita popups para imprimir.', 'error'); return; }

  const moneyStr = n => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const kpisHTML = `
    <div class="kpis">
      <div class="kpi"><div class="lbl">Veículos ativos</div><div class="val">${k.veicAtivos}</div></div>
      <div class="kpi"><div class="lbl">Abastecimentos</div><div class="val">${k.nAbastecimentos}</div></div>
      <div class="kpi"><div class="lbl">Litros totais</div><div class="val">${k.totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</div></div>
      <div class="kpi"><div class="lbl">KM rodado</div><div class="val">${k.kmRodado.toLocaleString('pt-BR')}</div></div>
      <div class="kpi"><div class="lbl">Gasto combustível</div><div class="val">${moneyStr(k.totalComb)}</div></div>
      <div class="kpi"><div class="lbl">Manutenções</div><div class="val">${k.nManutencoes}</div></div>
      <div class="kpi"><div class="lbl">Gasto manutenção</div><div class="val">${moneyStr(k.totalMan)}</div></div>
      <div class="kpi"><div class="lbl">Gasto total</div><div class="val" style="color:#16A34A">${moneyStr(k.totalGasto)}</div></div>
    </div>`;

  const sectionsHTML = datas.map(d => `
    <h2 class="section">${esc(d.title)}</h2>
    <table class="data"><thead><tr>${d.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${d.rows.map(r => `<tr>${r.map(v => `<td>${esc(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>
  `).join('');

  w.document.write(pdfTemplate({ orgao, logo, ibge, now, period, entity_type: entity?.entity_type, body: kpisHTML + sectionsHTML }));
  w.document.close();
}

function pdfTemplate({ orgao, logo, ibge, now, period, entity_type, body }) {
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>Relatório — ${esc(orgao)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#1A2A3A; margin:0; font-size:10px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr { display:flex; align-items:center; gap:14px; padding:10px 0; border-bottom:2px solid #217AD8; margin-bottom:12px; }
  .hdr img { width:56px; height:56px; object-fit:contain; }
  .hdr .org { font-size:10px; color:#475569; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .hdr .title { font-size:18px; font-weight:700; color:#0F172A; margin-top:2px; }
  .hdr .meta { font-size:10px; color:#64748B; margin-top:6px; display:flex; gap:14px; flex-wrap:wrap; }
  .hdr .meta b { color:#1A2A3A; font-weight:600; }
  .kpis { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:14px; }
  .kpi { border:1px solid #E5E9F0; border-left:3px solid #217AD8; border-radius:6px; padding:8px 10px; background:#fff; }
  .kpi .lbl { font-size:9px; color:#64748B; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .kpi .val { font-size:14px; font-weight:700; color:#0F172A; margin-top:2px; }
  h2.section { font-size:13px; font-weight:700; color:#1A65B5; margin:18px 0 8px; padding-bottom:4px; border-bottom:1px solid #E5E9F0; page-break-after:avoid; }
  table.data { width:100%; border-collapse:collapse; font-size:9px; page-break-inside:avoid; }
  table.data th { background:#1A65B5; color:#fff; text-align:left; padding:5px 6px; font-weight:600; font-size:8.5px; text-transform:uppercase; letter-spacing:.02em; }
  table.data td { padding:4px 6px; border-bottom:1px solid #E5E9F0; vertical-align:top; }
  table.data tr:nth-child(even) td { background:#F8FAFC; }
  .footer { margin-top:14px; padding-top:6px; border-top:1px solid #E5E9F0; font-size:8px; color:#94A3B8; text-align:center; }
</style></head><body>
  <div class="hdr">
    ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
    <div>
      <div class="org">${esc(entity_type || '')}</div>
      <div class="title">Relatório Gerencial de Frota</div>
      <div class="meta">
        <span><b>${esc(orgao)}</b></span>
        ${ibge ? `<span>IBGE ${esc(ibge)}</span>` : ''}
        <span>Gerado em ${esc(now)}</span>
        <span>Período: ${esc(period)}</span>
      </div>
    </div>
  </div>
  ${body}
  <div class="footer">Relatório gerado por Gerir Frota · ${esc(now)}</div>
  <script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 400);</script>
</body></html>`;
}
