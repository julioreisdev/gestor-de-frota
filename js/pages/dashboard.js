// =============================================================================
// DASHBOARD GERENCIAL
// KPIs + alertas + 4 gráficos + atividade recente + atalhos
// =============================================================================
import { pageRoot, pageHeader } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, fmtMoney, toast, formatPlate } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile } from '../auth.js';
import Chart from 'https://esm.sh/chart.js@4.4.1/auto';

// =============================================================================
// ESTADO
// =============================================================================
let _vehicles = [];
let _depts = [];
let _suppliers = [];
let _supplierFuels = [];
let _fuels = [];
let _fueling = [];
let _maintenance = [];
let _fAuth = [];
let _sAuth = [];
let _users = [];
let _filter = { from: '', to: '' };
let _charts = [];

const COLORS = ['#217AD8', '#16A34A', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#1A65B5'];

// =============================================================================
// ENTRY
// =============================================================================
export async function renderDashboard() {
  // Default: mês corrente
  if (!_filter.from && !_filter.to) {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
    _filter.from = `${y}-${m}-01`;
    _filter.to = new Date(y, now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }

  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Dashboard',
      subtitle: 'Visão consolidada da operação — KPIs, alertas e tendências.',
    })}
    <div id="dash-filter"></div>
    <div id="dash-loading" class="card">
      <div class="skeleton skeleton-line w-40"></div>
      <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
      <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
    </div>
    <div id="dash-content" style="display:none"></div>
  `;
  await loadAll();
  renderFilter();
  render();
}

async function loadAll() {
  const [v, d, s, sf, ft, f, m, fa, sa, u] = await Promise.all([
    supabase.from('vehicle').select(`
      id, plate, model, current_km, tank_capacity, vehicle_origin_code,
      fuel_type_code, department_id, department:department_id(acronym, name)
    `).is('deleted_at', null),
    supabase.from('department').select('id, acronym, name').order('acronym'),
    supabase.from('supplier').select('id, kind, legal_name, trade_name').order('legal_name'),
    supabase.from('supplier_fuel').select('supplier_id, fuel_type_code, fuel_subtype_id, contract_amount, current_balance, unit_price'),
    supabase.from('fuel_type').select('code, description').order('code'),
    supabase.from('fueling').select(`
      id, vehicle_id, supplier_id, fuel_type_code, date, quantity, unit_price, total,
      km_initial, km_final, responsible_name, authorization_id,
      vehicle_plate_snapshot, supplier_trade_name_snapshot
    `).is('deleted_at', null).order('date', { ascending: false }),
    supabase.from('maintenance').select(`
      id, vehicle_id, supplier_id, kind, status, open_date, close_date, total_value, description
    `).is('deleted_at', null).order('open_date', { ascending: false }),
    supabase.from('fueling_authorization').select(`
      id, number, date, status, vehicle_id, supplier_id, fuel_type_code,
      authorized_quantity, estimated_total, responsible_name, vehicle_plate_snapshot
    `).is('deleted_at', null),
    supabase.from('service_authorization').select(`
      id, number, date, status, vehicle_id, supplier_id, service_kind,
      estimated_value, responsible_name, vehicle_plate_snapshot
    `).is('deleted_at', null),
    supabase.from('app_user').select('id, username, full_name, role, monthly_authorization_limit, active'),
  ]);
  _vehicles = v.data || [];
  _depts = d.data || [];
  _suppliers = s.data || [];
  _supplierFuels = sf.data || [];
  _fuels = ft.data || [];
  _fueling = f.data || [];
  _maintenance = m.data || [];
  _fAuth = fa.data || [];
  _sAuth = sa.data || [];
  _users = u.data || [];
}

// =============================================================================
// FILTRO DE PERÍODO
// =============================================================================
function renderFilter() {
  document.getElementById('dash-filter').innerHTML = `
    <div class="card dash-filter">
      <div class="dash-filter-head">
        <span style="width:18px;height:18px;display:inline-flex;color:var(--primary)">${icons.calendar || icons.search}</span>
        <strong>Período</strong>
      </div>
      <div class="dash-filter-fields">
        <div class="field" style="margin:0">
          <label class="field-label">De</label>
          <input class="input" type="date" id="df-from" value="${_filter.from}">
        </div>
        <div class="field" style="margin:0">
          <label class="field-label">Até</label>
          <input class="input" type="date" id="df-to" value="${_filter.to}">
        </div>
        <div class="dash-filter-presets">
          <button class="btn btn-ghost btn-sm" data-preset="month">Este mês</button>
          <button class="btn btn-ghost btn-sm" data-preset="last30">Últimos 30 dias</button>
          <button class="btn btn-ghost btn-sm" data-preset="year">Este ano</button>
          <button class="btn btn-ghost btn-sm" data-preset="all">Tudo</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('df-from').addEventListener('change', e => { _filter.from = e.target.value; render(); });
  document.getElementById('df-to').addEventListener('change', e => { _filter.to = e.target.value; render(); });
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      const now = new Date();
      const y = now.getFullYear(), m = now.getMonth();
      if (preset === 'month') {
        _filter.from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
        _filter.to = new Date(y, m + 1, 0).toISOString().slice(0, 10);
      } else if (preset === 'last30') {
        const d = new Date(); d.setDate(d.getDate() - 30);
        _filter.from = d.toISOString().slice(0, 10);
        _filter.to = now.toISOString().slice(0, 10);
      } else if (preset === 'year') {
        _filter.from = `${y}-01-01`;
        _filter.to = `${y}-12-31`;
      } else {
        _filter.from = ''; _filter.to = '';
      }
      renderFilter();
      render();
    });
  });
}

// =============================================================================
// HELPERS DE FILTRAGEM
// =============================================================================
function inRange(d) {
  if (_filter.from && d < _filter.from) return false;
  if (_filter.to && d > _filter.to) return false;
  return true;
}
function fueledPeriod() { return _fueling.filter(f => inRange(f.date)); }
function maintainedPeriod() { return _maintenance.filter(m => inRange(m.open_date)); }
function authPeriod() { return _fAuth.filter(a => inRange(a.date)); }
function srvAuthPeriod() { return _sAuth.filter(a => inRange(a.date)); }

// =============================================================================
// RENDER
// =============================================================================
function render() {
  destroyCharts();
  document.getElementById('dash-loading').style.display = 'none';
  const root = document.getElementById('dash-content');
  root.style.display = 'block';

  root.innerHTML = `
    ${renderKPIs()}
    ${renderAlerts()}
    <div class="dash-grid-2">
      ${renderCard('Consumo por Secretaria (L)', '<canvas id="chart-sec"></canvas>')}
      ${renderCard('Combustível por Tipo (L)', '<canvas id="chart-fuel"></canvas>')}
    </div>
    <div class="dash-grid-2">
      ${renderCard('Evolução mensal de gastos (R$)', '<canvas id="chart-evol"></canvas>')}
      ${renderTopVeiculos()}
    </div>
    ${renderActivity()}
    ${renderShortcuts()}
  `;
  drawCharts();
}

// =============================================================================
// KPIs
// =============================================================================
function renderKPIs() {
  const abs = fueledPeriod();
  const man = maintainedPeriod();
  const fa = authPeriod();
  const sa = srvAuthPeriod();
  const totalLitros = abs.reduce((s, a) => s + Number(a.quantity || 0), 0);
  const gastoComb = abs.reduce((s, a) => s + Number(a.total || 0), 0);
  const gastoMan = man.reduce((s, a) => s + Number(a.total_value || 0), 0);
  const gastoTotal = gastoComb + gastoMan;
  const kmRodado = abs.reduce((s, a) => (a.km_initial != null && a.km_final != null) ? s + Math.max(0, a.km_final - a.km_initial) : s, 0);
  const veicAtivos = new Set([...abs.map(a => a.vehicle_id), ...man.map(a => a.vehicle_id)]).size;
  const autEmitidas = [...fa, ...sa].filter(a => a.status === 'emitida').length;
  const manAbertas = man.filter(m => m.status === 'aberta' || m.status === 'em_andamento').length;

  return `
    <div class="dash-kpis">
      ${kpi('Veículos cadastrados', _vehicles.length, icons.car, 'var(--primary)', 'Frota total')}
      ${kpi('Veículos ativos no período', veicAtivos, icons.activity || icons.car, 'var(--success)', `${_vehicles.length ? ((veicAtivos / _vehicles.length * 100) | 0) : 0}% da frota`)}
      ${kpi('Abastecimentos', abs.length, icons.droplet, '#0891B2', `${totalLitros.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} L`)}
      ${kpi('Manutenções', man.length, icons.wrench, 'var(--warning)', `${manAbertas} aberta(s)`)}
      ${kpi('KM rodado', kmRodado.toLocaleString('pt-BR'), icons.activity || icons.car, '#7C3AED', 'No período')}
      ${kpi('Gasto combustível', fmtMoney(gastoComb), icons.banknote, 'var(--primary)', `R$/L médio: ${totalLitros > 0 ? (gastoComb / totalLitros).toFixed(3) : '—'}`)}
      ${kpi('Gasto manutenção', fmtMoney(gastoMan), icons.banknote, 'var(--warning)', 'No período')}
      ${kpi('Gasto total', fmtMoney(gastoTotal), icons.banknote, 'var(--success)', `${autEmitidas} aut. pendente(s)`)}
    </div>
  `;
}

function kpi(label, value, icon, color, subtitle) {
  return `
    <div class="dash-kpi">
      <div class="dash-kpi-icon" style="background:${color}15;color:${color}">
        <span style="width:20px;height:20px;display:inline-flex">${icon || icons.search}</span>
      </div>
      <div class="dash-kpi-body">
        <div class="dash-kpi-label">${esc(label)}</div>
        <div class="dash-kpi-value">${esc(String(value))}</div>
        ${subtitle ? `<div class="dash-kpi-sub">${esc(subtitle)}</div>` : ''}
      </div>
    </div>
  `;
}

// =============================================================================
// ALERTAS
// =============================================================================
function renderAlerts() {
  const alerts = [];

  // 1) Saldos críticos de contrato (< 20% restante e contrato != 0)
  _supplierFuels.forEach(sf => {
    if (Number(sf.contract_amount) > 0) {
      const pct = Number(sf.current_balance) / Number(sf.contract_amount) * 100;
      if (pct < 20) {
        const s = _suppliers.find(x => x.id === sf.supplier_id);
        const fuel = _fuels.find(f => f.code === sf.fuel_type_code)?.description || `Cód ${sf.fuel_type_code}`;
        alerts.push({
          level: pct < 5 ? 'danger' : 'warning',
          icon: '⛽',
          title: `Saldo crítico — ${s?.trade_name || s?.legal_name || '—'} / ${fuel}`,
          msg: `Restam ${Number(sf.current_balance).toFixed(2)} L de ${Number(sf.contract_amount).toFixed(2)} L (${pct.toFixed(1)}%).`,
          link: '#/fornecedores',
        });
      }
    }
  });

  // 2) Autorizações emitidas há mais de 7 dias sem uso
  const today = new Date(); const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);
  const sevenAgoStr = sevenDaysAgo.toISOString().slice(0, 10);
  const oldEmitidas = [..._fAuth, ..._sAuth].filter(a => a.status === 'emitida' && a.date < sevenAgoStr);
  if (oldEmitidas.length > 0) {
    alerts.push({
      level: 'warning',
      icon: '⏰',
      title: `${oldEmitidas.length} autorização(ões) emitida(s) há +7 dias sem conclusão`,
      msg: 'Verifique se foram utilizadas ou se devem ser canceladas para restaurar saldo.',
      link: '#/autorizacoes',
    });
  }

  // 3) Limite mensal do usuário logado próximo do estouro
  const me = getProfile();
  if (me?.monthly_authorization_limit && Number(me.monthly_authorization_limit) > 0) {
    const refMonth = new Date().toISOString().slice(0, 7);
    const usadoFuel = _fAuth.filter(a => a.responsible_name === me.full_name
      && (a.status === 'emitida' || a.status === 'utilizada')
      && String(a.date).slice(0, 7) === refMonth)
      .reduce((s, a) => s + Number(a.estimated_total || 0), 0);
    const usadoMan = _sAuth.filter(a => a.responsible_name === me.full_name
      && (a.status === 'emitida' || a.status === 'utilizada')
      && String(a.date).slice(0, 7) === refMonth)
      .reduce((s, a) => s + Number(a.estimated_value || 0), 0);
    const usado = usadoFuel + usadoMan;
    const limit = Number(me.monthly_authorization_limit);
    const pct = usado / limit * 100;
    if (pct >= 80) {
      alerts.push({
        level: pct >= 100 ? 'danger' : 'warning',
        icon: '💳',
        title: pct >= 100 ? 'Seu limite mensal foi atingido' : `Seu limite mensal está em ${pct.toFixed(0)}%`,
        msg: `Utilizado ${fmtMoney(usado)} de ${fmtMoney(limit)} este mês.`,
        link: '#/autorizacoes',
      });
    }
  }

  // 4) Manutenções abertas há +30 dias
  const thirtyDaysAgo = new Date(today); thirtyDaysAgo.setDate(today.getDate() - 30);
  const thirtyStr = thirtyDaysAgo.toISOString().slice(0, 10);
  const oldMan = _maintenance.filter(m => (m.status === 'aberta' || m.status === 'em_andamento') && m.open_date < thirtyStr);
  if (oldMan.length > 0) {
    alerts.push({
      level: 'warning',
      icon: '🔧',
      title: `${oldMan.length} manutenção(ões) aberta(s) há +30 dias`,
      msg: 'Verifique status e atualize ou conclua.',
      link: '#/manutencoes',
    });
  }

  if (!alerts.length) return '';
  return `
    <div class="dash-alerts">
      ${alerts.map(a => `
        <a href="${esc(a.link)}" class="dash-alert dash-alert-${a.level}">
          <div class="dash-alert-icon">${a.icon}</div>
          <div class="dash-alert-body">
            <div class="dash-alert-title">${esc(a.title)}</div>
            <div class="dash-alert-msg">${esc(a.msg)}</div>
          </div>
          <div class="dash-alert-arrow">${icons.chevronRight || '→'}</div>
        </a>`).join('')}
    </div>
  `;
}

// =============================================================================
// GRÁFICOS
// =============================================================================
function renderCard(title, bodyHTML) {
  return `
    <div class="card dash-chart-card">
      <h3 class="dash-card-title">${esc(title)}</h3>
      <div class="dash-chart-wrap">${bodyHTML}</div>
    </div>
  `;
}

function destroyCharts() { _charts.forEach(c => { try { c.destroy(); } catch {} }); _charts = []; }

function drawCharts() {
  const abs = fueledPeriod();
  const man = maintainedPeriod();

  // 1) Consumo por secretaria (barras)
  const bySec = new Map();
  abs.forEach(a => {
    const v = _vehicles.find(x => x.id === a.vehicle_id);
    const d = _depts.find(x => x.id === v?.department_id);
    const k = d?.acronym || 'SEM';
    bySec.set(k, (bySec.get(k) || 0) + Number(a.quantity || 0));
  });
  const secRows = [...bySec.entries()].filter(([, l]) => l > 0).sort((a, b) => b[1] - a[1]);
  const secEl = document.getElementById('chart-sec');
  if (secEl && secRows.length) {
    _charts.push(new Chart(secEl, {
      type: 'bar',
      data: { labels: secRows.map(r => r[0]), datasets: [{ data: secRows.map(r => r[1]), backgroundColor: COLORS[0], borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L` } } },
        scales: { y: { ticks: { callback: v => v.toLocaleString('pt-BR') + ' L' } } },
      },
    }));
  } else if (secEl) emptyChart(secEl);

  // 2) Combustível por tipo (doughnut)
  const byFuel = new Map();
  abs.forEach(a => byFuel.set(a.fuel_type_code, (byFuel.get(a.fuel_type_code) || 0) + Number(a.quantity || 0)));
  const fuelRows = [...byFuel.entries()].filter(([, l]) => l > 0);
  const fuelEl = document.getElementById('chart-fuel');
  if (fuelEl && fuelRows.length) {
    _charts.push(new Chart(fuelEl, {
      type: 'doughnut',
      data: {
        labels: fuelRows.map(([code]) => _fuels.find(f => f.code === code)?.description || `Cód ${code}`),
        datasets: [{ data: fuelRows.map(r => r[1]), backgroundColor: COLORS, borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } }, tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L` } } },
      },
    }));
  } else if (fuelEl) emptyChart(fuelEl);

  // 3) Evolução mensal (últimos 6 meses)
  const months = [];
  const today = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(key);
  }
  const evolComb = months.map(k => _fueling.filter(a => a.date && a.date.startsWith(k)).reduce((s, a) => s + Number(a.total || 0), 0));
  const evolMan  = months.map(k => _maintenance.filter(m => m.open_date && m.open_date.startsWith(k)).reduce((s, m) => s + Number(m.total_value || 0), 0));
  const evolEl = document.getElementById('chart-evol');
  if (evolEl && (evolComb.some(x => x > 0) || evolMan.some(x => x > 0))) {
    _charts.push(new Chart(evolEl, {
      type: 'line',
      data: {
        labels: months.map(k => { const [y, m] = k.split('-'); return `${m}/${y.slice(2)}`; }),
        datasets: [
          { label: 'Combustível', data: evolComb, borderColor: COLORS[0], backgroundColor: COLORS[0] + '20', tension: 0.3, fill: true },
          { label: 'Manutenção', data: evolMan, borderColor: COLORS[2], backgroundColor: COLORS[2] + '20', tension: 0.3, fill: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmtMoney(c.parsed.y)}` } } },
        scales: { y: { ticks: { callback: v => 'R$' + Number(v).toLocaleString('pt-BR') } } },
      },
    }));
  } else if (evolEl) emptyChart(evolEl);
}

function emptyChart(el) {
  const p = document.createElement('div');
  p.className = 'dash-empty-chart';
  p.innerHTML = `<span>${icons.barChart}</span><span>Sem dados no período</span>`;
  el.replaceWith(p);
}

// =============================================================================
// TOP 5 VEÍCULOS POR GASTO
// =============================================================================
function renderTopVeiculos() {
  const abs = fueledPeriod();
  const man = maintainedPeriod();
  const acc = new Map();
  abs.forEach(a => {
    const v = _vehicles.find(x => x.id === a.vehicle_id);
    if (!v) return;
    const k = v.id;
    if (!acc.has(k)) acc.set(k, { plate: v.plate, model: v.model, dept: v.department?.acronym || '—', total: 0, litros: 0 });
    acc.get(k).total += Number(a.total || 0);
    acc.get(k).litros += Number(a.quantity || 0);
  });
  man.forEach(a => {
    const v = _vehicles.find(x => x.id === a.vehicle_id);
    if (!v) return;
    const k = v.id;
    if (!acc.has(k)) acc.set(k, { plate: v.plate, model: v.model, dept: v.department?.acronym || '—', total: 0, litros: 0 });
    acc.get(k).total += Number(a.total_value || 0);
  });
  const top = [...acc.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  const maxV = Math.max(...top.map(r => r.total), 1);
  const body = top.length ? `
    <div class="dash-rank">
      ${top.map((r, i) => `
        <div class="dash-rank-row">
          <div class="dash-rank-pos">${i + 1}</div>
          <div class="dash-rank-info">
            <div class="dash-rank-title"><strong>${esc(formatPlate(r.plate))}</strong> — ${esc(r.model)}</div>
            <div class="dash-rank-sub">${esc(r.dept)} · ${r.litros.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L</div>
            <div class="dash-rank-bar"><div class="dash-rank-fill" style="width:${(r.total / maxV * 100)}%"></div></div>
          </div>
          <div class="dash-rank-value">${fmtMoney(r.total)}</div>
        </div>
      `).join('')}
    </div>
  ` : `<div class="dash-empty-chart"><span>${icons.car}</span><span>Sem dados no período</span></div>`;
  return renderCard('Top 5 veículos por gasto', body);
}

// =============================================================================
// ATIVIDADE RECENTE
// =============================================================================
function renderActivity() {
  const items = [
    ..._fueling.slice(0, 15).map(f => ({
      type: 'fuel', date: f.date, ts: f.date,
      title: `Abastecimento — ${formatPlate(f.vehicle_plate_snapshot)}`,
      sub: `${Number(f.quantity).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L · ${esc(f.supplier_trade_name_snapshot || '')} · ${fmtMoney(f.total)}`,
      icon: icons.droplet, color: '#0891B2', link: '#/abastecimentos',
    })),
    ..._maintenance.slice(0, 15).map(m => ({
      type: 'maint', date: m.open_date, ts: m.open_date,
      title: `Manutenção — ${esc(_vehicles.find(v => v.id === m.vehicle_id)?.plate ? formatPlate(_vehicles.find(v => v.id === m.vehicle_id).plate) : '—')}`,
      sub: `${m.kind} · ${esc(m.description?.slice(0, 60) || '')} · ${m.total_value != null ? fmtMoney(m.total_value) : '—'}`,
      icon: icons.wrench, color: 'var(--warning)', link: '#/manutencoes',
    })),
    ..._fAuth.slice(0, 15).filter(a => a.status === 'emitida').map(a => ({
      type: 'fauth', date: a.date, ts: a.date,
      title: `Aut. abastecimento ${a.number}`,
      sub: `${formatPlate(a.vehicle_plate_snapshot)} · ${Number(a.authorized_quantity).toFixed(2)} L · ${fmtMoney(a.estimated_total)}`,
      icon: icons.clipboard, color: 'var(--primary)', link: '#/autorizacoes',
    })),
    ..._sAuth.slice(0, 15).filter(a => a.status === 'emitida').map(a => ({
      type: 'sauth', date: a.date, ts: a.date,
      title: `Aut. manutenção ${a.number}`,
      sub: `${formatPlate(a.vehicle_plate_snapshot)} · ${fmtMoney(a.estimated_value)}`,
      icon: icons.clipboard, color: '#7C3AED', link: '#/autorizacoes',
    })),
  ].sort((a, b) => (b.ts || '').localeCompare(a.ts || '')).slice(0, 10);

  if (!items.length) return '';
  return `
    <div class="card dash-activity-card">
      <h3 class="dash-card-title">Atividade recente</h3>
      <div class="dash-activity">
        ${items.map(it => `
          <a href="${esc(it.link)}" class="dash-activity-row">
            <div class="dash-activity-icon" style="background:${it.color}15;color:${it.color}">
              <span style="width:16px;height:16px;display:inline-flex">${it.icon || icons.search}</span>
            </div>
            <div class="dash-activity-body">
              <div class="dash-activity-title">${it.title}</div>
              <div class="dash-activity-sub">${it.sub}</div>
            </div>
            <div class="dash-activity-date">${esc(fmtDate(it.date))}</div>
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

// =============================================================================
// ATALHOS
// =============================================================================
function renderShortcuts() {
  const me = getProfile();
  const role = me?.role || 'usuario';
  const items = [
    { label: 'Emitir autorização', icon: icons.plus, link: '#/autorizacoes', color: 'var(--primary)' },
    { label: 'Registrar abastecimento', icon: icons.droplet, link: '#/abastecimentos', color: '#0891B2' },
    { label: 'Registrar manutenção', icon: icons.wrench, link: '#/manutencoes', color: 'var(--warning)' },
    { label: 'Ver relatórios', icon: icons.barChart, link: '#/relatorios', color: 'var(--success)' },
  ];
  if (role === 'admin') items.push({ label: 'Exportação TCE-PI', icon: icons.download, link: '#/exportacao', color: '#7C3AED' });
  return `
    <div class="dash-shortcuts">
      ${items.map(it => `
        <a href="${esc(it.link)}" class="dash-shortcut" style="--c:${it.color}">
          <div class="dash-shortcut-icon">${it.icon || icons.search}</div>
          <span>${esc(it.label)}</span>
        </a>
      `).join('')}
    </div>
  `;
}
