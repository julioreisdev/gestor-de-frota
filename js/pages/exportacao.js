// =============================================================================
// EXPORTAÇÃO TCE-PI — Cód. 517, 503, 443
// Layouts oficiais (mar/2026). CSVs fechados (zero customização) + PDFs internos.
// =============================================================================
import { pageRoot, pageHeader, getEntity } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, fmtMoney, toast, formatPlate } from '../ui.js';
import { icons } from '../icons.js';

// =============================================================================
// ESTADO
// =============================================================================
let _vehicles = [];
let _depts = [];
let _fueling = [];
let _vehicleTypes = [];
let _fuelTypes = [];
let _vehicleOrigins = [];
let _entity = null;

// Períodos independentes por layout (cliente v4: 503 = cessão, 443 = locação)
let _periods = {
  '517': { from: '', to: '' }, // abastecimentos
  '503': { from: '', to: '' }, // cessão
  '443': { from: '', to: '' }, // locação
};

// =============================================================================
// ENTRY
// =============================================================================
export async function renderExportacao() {
  // Default: mês corrente para 517 (abastecimento). 503/443 ficam abertos.
  if (!_periods['517'].from) {
    const now = new Date();
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
    _periods['517'].from = `${y}-${m}-01`;
    _periods['517'].to = new Date(y, now.getMonth() + 1, 0).toISOString().slice(0, 10);
  }

  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Exportação TCE-PI',
      subtitle: 'Layouts oficiais (Cód. 517, 503, 443) para envio ao Documentação Web do TCE.',
    })}
    <div class="card alert-info exp-warning">
      <span style="width:18px;height:18px;display:inline-flex;color:var(--primary);flex-shrink:0">${icons.info || icons.search}</span>
      <div>
        Os arquivos <strong>CSV</strong> seguem rigorosamente o leiaute técnico do TCE-PI.
        Configure a entidade em <a href="#/entidade" style="color:var(--primary);font-weight:600">Cadastro de Entidade</a> antes de exportar (IBGE é obrigatório).
        Os <strong>PDFs</strong> são apenas para conferência interna.
      </div>
    </div>
    <div id="exp-entity-card"></div>
    <div id="exp-loading" class="card">
      <div class="skeleton skeleton-line w-40"></div>
      <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
      <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
    </div>
    <div id="exp-content" style="display:none"></div>
  `;
  await loadAll();
  renderEntityCard();
  renderContent();
}

async function loadAll() {
  _entity = await getEntity();
  const [vs, ds, vts, fts, vos] = await Promise.all([
    supabase.from('vehicle').select(`
      id, plate, renavam, model, brand,
      year_manufacture, year_model,
      vehicle_type_code, fuel_type_code, fuel_subtype_id, vehicle_origin_code,
      department_id, tank_capacity, current_km, conservation_state,
      cession_destination_organ, cession_start_date, cession_end_date,
      lessor_doc, lessor_name, monthly_value, has_driver, cw_contract_code
    `).is('deleted_at', null).order('plate'),
    supabase.from('department').select('id, acronym, name').order('acronym'),
    supabase.from('vehicle_type').select('code, description').order('code'),
    supabase.from('fuel_type').select('code, description').order('code'),
    supabase.from('vehicle_origin').select('code, description').order('code'),
  ]);
  _vehicles = vs.data || [];
  _depts = ds.data || [];
  _vehicleTypes = vts.data || [];
  _fuelTypes = fts.data || [];
  _vehicleOrigins = vos.data || [];
  await reloadFueling();
}

async function reloadFueling() {
  // Carrega TUDO; filtra client-side conforme o período do 517.
  const r = await supabase.from('fueling').select(`
    vehicle_id, fuel_type_code, fuel_subtype_id,
    date, quantity, unit_price, total, km_initial, km_final
  `).is('deleted_at', null).order('date');
  _fueling = r.data || [];
}

// =============================================================================
// CARD DE INFO DA ENTIDADE (resumo institucional acima dos 3 layouts)
// =============================================================================
function renderEntityCard() {
  document.getElementById('exp-entity-card').innerHTML = `
    <div class="card exp-period-card">
      <div class="exp-period-info">
        <div class="exp-info-pill"><span class="pill-label">Entidade</span><strong>${esc(_entity?.organ_name || '—')}</strong></div>
        <div class="exp-info-pill"><span class="pill-label">Tipo</span><strong>${esc(_entity?.entity_type || '—')}</strong></div>
        <div class="exp-info-pill"><span class="pill-label">IBGE</span><strong>${esc(_entity?.ibge_code || '—')}</strong></div>
        <div class="exp-info-pill"><span class="pill-label">Veículos cadastrados</span><strong>${_vehicles.length}</strong></div>
      </div>
    </div>
  `;
}

// Renderiza UMA VEZ a estrutura dos 3 cards (inputs de período permanentes).
// Em seguida updateAllCards() atualiza só os blocos dinâmicos sem mexer nos inputs.
function renderContent() {
  document.getElementById('exp-loading').style.display = 'none';
  const root = document.getElementById('exp-content');
  root.style.display = 'block';

  if (!_entity?.ibge_code) {
    root.innerHTML = `
      <div class="card alert-error" style="border-left:4px solid var(--danger)">
        <strong>Entidade sem código IBGE.</strong> Configure a entidade antes de exportar (campo obrigatório nos layouts 503 e 443).
      </div>`;
    return;
  }

  root.innerHTML = `
    ${cardShell({ code: '517', title: 'Abastecimento de Veículos', desc: 'Uma linha por (veículo + combustível) consolidando o mês.', tipoBadge: 'badge badge-warning' })}
    ${cardShell({ code: '503', title: 'Veículos Próprios e Cedidos', desc: 'Veículos com origem 1 (Próprio) ou 2 (Cedido).', tipoBadge: 'badge badge-success' })}
    ${cardShell({ code: '443', title: 'Veículos Locados e Sublocados', desc: 'Veículos com origem 3 (Locado) ou 4 (Sublocado).', tipoBadge: 'badge' })}
  `;

  // bind dos INPUTS de período — atualiza o estado e chama updateAllCards,
  // que NÃO recria os inputs (eles ficam intactos pra digitação).
  document.querySelectorAll('[data-period-code]').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const code = e.target.dataset.periodCode;
      const field = e.target.dataset.periodField;
      _periods[code][field] = e.target.value;
      // Mostra/esconde botão Limpar daquele card
      const card = document.querySelector(`[data-card-code="${code}"]`);
      const clearBtn = card?.querySelector('[data-period-clear]');
      if (clearBtn) clearBtn.hidden = !_periods[code].from && !_periods[code].to;
      updateAllCards();
    });
  });
  document.querySelectorAll('[data-period-clear]').forEach(btn => {
    btn.addEventListener('click', () => {
      const code = btn.dataset.periodClear;
      _periods[code] = { from: '', to: '' };
      // Limpa os inputs do card sem recriar
      const card = document.querySelector(`[data-card-code="${code}"]`);
      card.querySelectorAll('[data-period-field]').forEach(i => { i.value = ''; });
      btn.hidden = true;
      updateAllCards();
    });
  });

  // Bind dos botões de toggle issues — também só uma vez (delegação não é
  // estritamente necessária aqui pq o botão fica dentro da área dinâmica;
  // será re-bindado no updateAllCards).
  updateAllCards();
}

// Atualiza só os blocos dinâmicos (métricas + status + issues + preview +
// botões de export). NÃO toca nos inputs de período.
function updateAllCards() {
  // Filtrado (com período do user)
  const r517 = build517();
  const r503 = build503();
  const r443 = build443();
  // Total sem filtro de período (pra mostrar "N de M no total")
  const EMPTY = { from: '', to: '' };
  const t517 = build517(EMPTY);
  const t503 = build503(EMPTY);
  const t443 = build443(EMPTY);

  const v517 = validate517(r517);
  const v503 = validate503(r503);
  const v443 = validate443(r443);
  const cross = crossValidate(r517, r503, r443);

  const has = (c) => !!(_periods[c].from || _periods[c].to);

  updateCardDynamic('517', r517, t517.length, has('517'), [...v517.errors, ...cross.e517], v517.warnings,
    ['placa','modelo','tipoCombustivel','quantidadeAbastecimento','kmInicial','kmFinal']);
  updateCardDynamic('503', r503, t503.length, has('503'), v503.errors, v503.warnings,
    ['placa','modelo','tipoCombustivel','localizacao','veiculoCedido']);
  updateCardDynamic('443', r443, t443.length, has('443'), v443.errors, v443.warnings,
    ['placa','modelo','nomeLocador','valorUnitMensal','codigoCw']);
}

const PERIOD_LABEL = {
  '517': 'Data dos abastecimentos',
  '503': 'Data de cessão',
  '443': 'Data de locação',
};
// Explicação visível abaixo do filtro pra esclarecer o efeito esperado.
const PERIOD_HINT = {
  '517': 'Filtra os abastecimentos que entram no consolidado mensal.',
  '503': 'Filtra apenas veículos CEDIDOS (origem 2). Próprios sem data de cessão aparecem sempre.',
  '443': 'Filtra veículos cuja locação intersecta o período. Veículos sem datas de locação aparecem sempre.',
};

// Shell ESTÁTICO do card: header + inputs de período + container vazio pro
// conteúdo dinâmico. Esses inputs NÃO são re-renderizados em mudança de filtro.
function cardShell({ code, title, desc, tipoBadge }) {
  return `
    <div class="card layout-card layout-${code}" data-card-code="${code}">
      <div class="layout-card-head">
        <div class="layout-card-title">
          <span class="${tipoBadge}" style="font-family:ui-monospace,monospace">Cód. ${code}</span>
          <h3>${esc(title)}</h3>
          <p>${esc(desc)}</p>
        </div>
        <div class="layout-card-status" data-slot="status"></div>
      </div>

      <div class="lc-period">
        <div class="lc-period-label">${esc(PERIOD_LABEL[code])}</div>
        <div class="lc-period-fields">
          <div class="field" style="margin:0">
            <label class="field-label">De</label>
            <input class="input" type="date" data-period-code="${code}" data-period-field="from" value="${esc(_periods[code].from)}">
          </div>
          <div class="field" style="margin:0">
            <label class="field-label">Até</label>
            <input class="input" type="date" data-period-code="${code}" data-period-field="to" value="${esc(_periods[code].to)}">
          </div>
          <button class="btn btn-ghost btn-sm" data-period-clear="${code}" ${(!_periods[code].from && !_periods[code].to) ? 'hidden' : ''}>Limpar</button>
        </div>
        <p class="lc-period-hint">${esc(PERIOD_HINT[code])}</p>
      </div>

      <div data-slot="dynamic"></div>
    </div>
  `;
}

// Atualiza só o conteúdo dinâmico do card (status badge + métricas + issues +
// preview + botões export). Inputs de período ficam intactos.
function updateCardDynamic(code, rows, totalNoFilter, hasFilter, errors, warnings, previewColumns) {
  const card = document.querySelector(`[data-card-code="${code}"]`);
  if (!card) return;
  const blocked = errors.length > 0;
  const empty = rows.length === 0;
  // Quando há filtro aplicado, mostra "N de M" mesmo se N=M — deixa óbvio
  // que o filtro está ativo e o número é o resultado real da filtragem.
  const rowsLabel = hasFilter
    ? `${rows.length} <span style="font-size:11px;color:var(--text-muted);font-weight:400">de ${totalNoFilter}</span>`
    : `${rows.length}`;

  // Status badge no header
  card.querySelector('[data-slot="status"]').innerHTML = empty
    ? `<span class="badge badge-neutral">Sem registros</span>`
    : blocked
    ? `<span class="badge badge-danger">${errors.length} erro(s)</span>`
    : warnings.length
    ? `<span class="badge badge-warning">${warnings.length} aviso(s)</span>`
    : `<span class="badge badge-success">OK</span>`;

  const issuesHTML = (errors.length || warnings.length) ? `
    <div class="exp-issues-wrap">
      <button class="btn btn-ghost btn-sm" data-toggle-issues>Ver detalhes</button>
      <div class="exp-issues">
        ${errors.length ? `<div class="exp-issue-group">
          <h4>Erros (bloqueiam o envio)</h4>
          <ul>${errors.map(e => `<li><strong>${esc(e.placa || '—')}:</strong> ${esc(e.msg)}</li>`).join('')}</ul>
        </div>` : ''}
        ${warnings.length ? `<div class="exp-issue-group" style="margin-top:8px">
          <h4 style="color:var(--warning)">Avisos</h4>
          <ul>${warnings.map(e => `<li><strong>${esc(e.placa || '—')}:</strong> ${esc(e.msg)}</li>`).join('')}</ul>
        </div>` : ''}
      </div>
    </div>` : '';

  card.querySelector('[data-slot="dynamic"]').innerHTML = `
    <div class="layout-card-metrics">
      <div class="lc-metric lc-metric-pulse"><span>Linhas geradas</span><strong>${rowsLabel}</strong></div>
      <div class="lc-metric"><span>Erros</span><strong style="color:${errors.length ? 'var(--danger)' : 'var(--text)'}">${errors.length}</strong></div>
      <div class="lc-metric"><span>Avisos</span><strong style="color:${warnings.length ? 'var(--warning)' : 'var(--text)'}">${warnings.length}</strong></div>
    </div>
    ${issuesHTML}
    ${rows.length ? `
    <div class="exp-preview">
      <div class="exp-preview-head">
        <span style="width:14px;height:14px;display:inline-flex;color:var(--text-muted)">${icons.search}</span>
        <strong>Pré-visualização (3 primeiras linhas)</strong>
      </div>
      <div class="exp-preview-table-wrap">
        <table class="exp-preview-table">
          <thead><tr>${previewColumns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${rows.slice(0, 3).map(r => `<tr>${previewColumns.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}
    <div class="layout-card-actions">
      <button class="btn report-btn-pdf" data-export="${code}" data-format="pdf" ${empty ? 'disabled' : ''}>
        <span style="width:16px;height:16px;display:inline-flex">${icons.printer}</span> Baixar PDF (conferência interna)
      </button>
      <button class="btn report-btn-xlsx" data-export="${code}" data-format="csv" ${blocked || empty ? 'disabled' : ''}>
        <span style="width:16px;height:16px;display:inline-flex">${icons.download}</span> Baixar CSV (oficial TCE-PI)
      </button>
    </div>
    ${blocked && !empty ? `<p class="lc-blocked-msg">⛔ Corrija os erros antes de baixar o CSV oficial.</p>` : ''}
  `;

  // Re-bind dos botões dentro do conteúdo dinâmico
  card.querySelectorAll('[data-export]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.export;
      const fmt = btn.dataset.format;
      const r = c === '517' ? build517() : c === '503' ? build503() : build443();
      if (fmt === 'csv') downloadCSV(c, r);
      else downloadPDF(c, r);
    });
  });
  card.querySelectorAll('[data-toggle-issues]').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.layout-card').querySelector('.exp-issues');
      wrap.classList.toggle('open');
      btn.textContent = wrap.classList.contains('open') ? 'Esconder detalhes' : 'Ver detalhes';
    });
  });
}

// =============================================================================
// HELPERS DE CONVERSÃO TCE
// =============================================================================
function cleanPlate(s) { return String(s || '').replace(/[^A-Z0-9]/gi, '').toUpperCase(); }
function padRenavam(s) { return String(s || '').padStart(11, '0'); }
function dec(n) { const v = Number(n || 0); return v.toFixed(2); }
function periodSlug(code) {
  const p = _periods[code];
  if (!p.from && !p.to) return 'todos';
  return `${p.from || 'inicio'}_${p.to || 'hoje'}`;
}
function periodLabel(code) {
  const p = _periods[code];
  if (!p.from && !p.to) return 'todos os registros';
  return `${p.from ? fmtDate(p.from) : 'início'} a ${p.to ? fmtDate(p.to) : 'hoje'}`;
}
function intersectsPeriod(startDate, endDate, from, to) {
  // Range do registro [startDate..endDate] (datas opcionais) cruza com [from..to]?
  if (!from && !to) return true;
  const s = startDate || '0000-01-01';
  const e = endDate   || '9999-12-31';
  if (from && e < from) return false;
  if (to && s > to) return false;
  return true;
}

// =============================================================================
// BUILD 517 — Abastecimento (uma linha por veículo+combustível agregada no período)
// =============================================================================
function build517(period) {
  const { from, to } = period || _periods['517'];
  const periodFueling = _fueling.filter(f => {
    if (from && f.date < from) return false;
    if (to && f.date > to) return false;
    return true;
  });
  const out = [];
  const byVehicleFuel = new Map();
  for (const f of periodFueling) {
    // Subtipos comerciais NUNCA vão no CSV TCE — só o fuel_type_code pai
    const k = `${f.vehicle_id}|${f.fuel_type_code}`;
    if (!byVehicleFuel.has(k)) byVehicleFuel.set(k, []);
    byVehicleFuel.get(k).push(f);
  }
  for (const [k, list] of byVehicleFuel.entries()) {
    const [vehId, fuelCode] = k.split('|');
    const v = _vehicles.find(x => x.id === vehId);
    if (!v) continue;
    list.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const totalQty = list.reduce((s, x) => s + Number(x.quantity || 0), 0);
    // kmInicial = min(km_initial) ou km_initial da primeira linha; kmFinal = max(km_final) ou km_final da última
    const kmsInit = list.map(x => x.km_initial).filter(n => n != null && n !== '');
    const kmsFinal = list.map(x => x.km_final).filter(n => n != null && n !== '');
    let kmInicial = kmsInit.length ? Math.min(...kmsInit.map(Number)) : 0;
    let kmFinal   = kmsFinal.length ? Math.max(...kmsFinal.map(Number)) : kmInicial;
    // Regra OUTROS (tipo 99): força sentinelas em renavam/placa/km
    const isOutros = v.vehicle_type_code === 99;
    const orgao = _depts.find(d => d.id === v.department_id)?.name || _entity?.organ_name || '—';
    out.push({
      modelo: v.model,
      placa: isOutros ? 'XYZ0000' : cleanPlate(v.plate),
      renavam: isOutros ? '99999999999' : padRenavam(v.renavam),
      anoFabricacao: v.year_manufacture,
      anoModelo: v.year_model,
      tipoVeiculo: v.vehicle_type_code,
      origemVeiculo: v.vehicle_origin_code,
      orgaoLocalizacao: orgao,
      capacidade: dec(v.tank_capacity || 0),
      quantidadeAbastecimento: dec(totalQty),
      tipoCombustivel: Number(fuelCode),
      kmInicial: isOutros ? 99999999 : kmInicial,
      kmFinal: isOutros ? 99999999 : kmFinal,
      _vehicleId: vehId,
    });
  }
  return out.sort((a, b) => a.placa.localeCompare(b.placa));
}

// =============================================================================
// BUILD 503 — Próprios (1) e Cedidos (2). Filtro por período = data de cessão.
// =============================================================================
function build503(period) {
  const { from, to } = period || _periods['503'];
  return _vehicles
    .filter(v => v.vehicle_origin_code === 1 || v.vehicle_origin_code === 2)
    .filter(v => {
      if (!from && !to) return true;
      // Próprios sem cessão: incluir sempre (não dá pra filtrar por data)
      if (v.vehicle_origin_code === 1 && !v.cession_start_date && !v.cession_end_date) return true;
      return intersectsPeriod(v.cession_start_date, v.cession_end_date, from, to);
    })
    .map(v => {
      const cedido = v.vehicle_origin_code === 2 ? 1 : 0;
      return {
        modelo: v.model,
        placa: cleanPlate(v.plate),
        renavam: padRenavam(v.renavam),
        anoFabricacao: v.year_manufacture,
        anoModelo: v.year_model,
        tipoCombustivel: v.fuel_type_code,
        estadoConservacao: v.conservation_state || 'Bom',
        localizacao: _entity?.ibge_code || '',
        veiculoCedido: cedido,
        orgaoDestVeicCedido: cedido ? (v.cession_destination_organ || '') : '',
        dataInicCessao: cedido ? (v.cession_start_date || '') : '',
        dataFimCessao: cedido ? (v.cession_end_date || '') : '',
        _vehicleId: v.id,
      };
    })
    .sort((a, b) => a.placa.localeCompare(b.placa));
}

// =============================================================================
// BUILD 443 — Locados (3) e Sublocados (4). Filtro por período = data de locação.
// =============================================================================
function build443(period) {
  const { from, to } = period || _periods['443'];
  return _vehicles
    .filter(v => v.vehicle_origin_code === 3 || v.vehicle_origin_code === 4)
    .filter(v => intersectsPeriod(v.lessor_lease_start_date, v.lessor_lease_end_date, from, to))
    .map(v => ({
      modelo: v.model,
      placa: cleanPlate(v.plate),
      renavam: padRenavam(v.renavam),
      anoFabricacao: v.year_manufacture,
      anoModelo: v.year_model,
      tipoCombustivel: v.fuel_type_code,
      cpfOuCnpj: String(v.lessor_doc || '').replace(/\D/g, ''),
      nomeLocador: v.lessor_name || '',
      localizacao: _entity?.ibge_code || '',
      valorUnitMensal: dec(v.monthly_value || 0),
      possuiMotorista: v.has_driver ? 1 : 0,
      codigoCw: v.cw_contract_code || '',
      _vehicleId: v.id,
    }))
    .sort((a, b) => a.placa.localeCompare(b.placa));
}

// =============================================================================
// VALIDAÇÕES
// =============================================================================
const YEAR_NOW = new Date().getFullYear();
const PLATE_RX = /^([A-Z]{3}[0-9]{4}|[A-Z]{3}[0-9][A-Z][0-9]{2})$/;
const RENAVAM_RX = /^[0-9]{11}$/;
const CPFCNPJ_RX = /^([0-9]{11}|[0-9]{14})$/;
const CW_RX = /^CW-[0-9]{6}\/[0-9]{2}$/;
const FUEL_517_ALLOWED = new Set([1, 2, 3, 4, 6]); // sem FLEX/HIBRIDO

function validate517(rows) {
  const errors = [], warnings = [];
  rows.forEach(r => {
    const ctx = { placa: r.placa };
    if (!String(r.modelo || '').match(/.{3,300}/)) errors.push({ ...ctx, msg: 'Modelo precisa ter 3 a 300 caracteres.' });
    if (!PLATE_RX.test(r.placa)) errors.push({ ...ctx, msg: `Placa inválida: ${r.placa}` });
    if (!RENAVAM_RX.test(r.renavam)) errors.push({ ...ctx, msg: 'RENAVAM deve ter 11 dígitos.' });
    if (Number(r.anoFabricacao) > YEAR_NOW) errors.push({ ...ctx, msg: `Ano de fabricação (${r.anoFabricacao}) maior que ano atual.` });
    if (Number(r.anoModelo) > YEAR_NOW + 1) errors.push({ ...ctx, msg: `Ano modelo (${r.anoModelo}) maior que ${YEAR_NOW + 1}.` });
    if (Number(r.anoFabricacao) > Number(r.anoModelo)) errors.push({ ...ctx, msg: 'Ano de fabricação maior que ano modelo.' });
    if (!FUEL_517_ALLOWED.has(Number(r.tipoCombustivel))) errors.push({ ...ctx, msg: `Combustível ${r.tipoCombustivel} não aceito no 517 (use 1, 2, 3, 4 ou 6).` });
    const cap = Number(r.capacidade);
    if (!(cap > 0 && cap < 1000)) errors.push({ ...ctx, msg: `Capacidade inválida (${r.capacidade}).` });
    if (Number(r.quantidadeAbastecimento) <= 0) errors.push({ ...ctx, msg: 'Quantidade deve ser > 0.' });
    if (Number(r.kmInicial) > Number(r.kmFinal)) errors.push({ ...ctx, msg: `KM inicial (${r.kmInicial}) maior que KM final (${r.kmFinal}).` });
    if (!String(r.orgaoLocalizacao || '').match(/.{3,300}/)) errors.push({ ...ctx, msg: 'Órgão/localização precisa ter 3 a 300 caracteres.' });

    // Regra 1.1.8 (Outros)
    if (Number(r.tipoVeiculo) === 99) {
      if (r.renavam !== '99999999999') errors.push({ ...ctx, msg: 'Tipo 99 (Outros) exige RENAVAM = 99999999999.' });
      if (!String(r.placa).startsWith('XYZ')) errors.push({ ...ctx, msg: 'Tipo 99 (Outros) exige placa iniciando com XYZ.' });
      if (Number(r.kmInicial) !== 99999999 || Number(r.kmFinal) !== 99999999) errors.push({ ...ctx, msg: 'Tipo 99 (Outros) exige kmInicial=kmFinal=99999999.' });
    } else {
      // Regra 1.1.9 (anti-Outros)
      if (r.renavam === '99999999999') errors.push({ ...ctx, msg: 'RENAVAM 99999999999 só permitido para tipo 99.' });
      if (String(r.placa).startsWith('XYZ')) errors.push({ ...ctx, msg: 'Placa começando com XYZ só permitida para tipo 99.' });
      if (Number(r.kmInicial) === 99999999 || Number(r.kmFinal) === 99999999) errors.push({ ...ctx, msg: 'KM 99999999 só permitido para tipo 99.' });
    }
  });
  return { errors, warnings };
}

function validate503(rows) {
  const errors = [], warnings = [];
  // Para validação de cessão, usa o "to" do filtro ou hoje
  const lastDay = _periods['503'].to || new Date().toISOString().slice(0, 10);
  rows.forEach(r => {
    const ctx = { placa: r.placa };
    if (!String(r.modelo || '').match(/.{3,300}/)) errors.push({ ...ctx, msg: 'Modelo 3-300 chars.' });
    if (!PLATE_RX.test(r.placa)) errors.push({ ...ctx, msg: `Placa inválida.` });
    if (!RENAVAM_RX.test(r.renavam)) errors.push({ ...ctx, msg: 'RENAVAM 11 dígitos.' });
    if (Number(r.anoFabricacao) > YEAR_NOW) errors.push({ ...ctx, msg: `Ano de fabricação > ${YEAR_NOW}.` });
    if (Number(r.anoModelo) > YEAR_NOW + 1) errors.push({ ...ctx, msg: `Ano modelo > ${YEAR_NOW + 1}.` });
    if (Number(r.anoFabricacao) > Number(r.anoModelo)) errors.push({ ...ctx, msg: 'Ano fabricação > ano modelo.' });
    if (!String(r.estadoConservacao || '').match(/.{3,300}/)) errors.push({ ...ctx, msg: 'Estado de conservação 3-300 chars.' });
    if (!/^\d{7}$/.test(String(r.localizacao))) errors.push({ ...ctx, msg: 'localizacao deve ser IBGE de 7 dígitos (configure a entidade).' });
    if (r.veiculoCedido === 1) {
      if (r.dataInicCessao && r.dataInicCessao > lastDay) errors.push({ ...ctx, msg: 'dataInicCessao posterior ao mês de referência.' });
      if (r.dataInicCessao && r.dataFimCessao && r.dataFimCessao < r.dataInicCessao) errors.push({ ...ctx, msg: 'dataFimCessao < dataInicCessao.' });
      if (!r.orgaoDestVeicCedido) warnings.push({ ...ctx, msg: 'Veículo cedido sem órgão de destino preenchido.' });
    }
  });
  return { errors, warnings };
}

function validate443(rows) {
  const errors = [], warnings = [];
  rows.forEach(r => {
    const ctx = { placa: r.placa };
    if (!String(r.modelo || '').match(/.{3,300}/)) errors.push({ ...ctx, msg: 'Modelo 3-300 chars.' });
    if (!PLATE_RX.test(r.placa)) errors.push({ ...ctx, msg: 'Placa inválida.' });
    if (!RENAVAM_RX.test(r.renavam)) errors.push({ ...ctx, msg: 'RENAVAM 11 dígitos.' });
    if (Number(r.anoFabricacao) > YEAR_NOW) errors.push({ ...ctx, msg: `Ano fabricação > ${YEAR_NOW}.` });
    if (Number(r.anoModelo) > YEAR_NOW + 1) errors.push({ ...ctx, msg: `Ano modelo > ${YEAR_NOW + 1}.` });
    if (!CPFCNPJ_RX.test(r.cpfOuCnpj)) errors.push({ ...ctx, msg: 'CPF (11) ou CNPJ (14) inválido — só dígitos.' });
    if (!String(r.nomeLocador || '').match(/.{3,300}/)) errors.push({ ...ctx, msg: 'Nome do locador 3-300 chars.' });
    if (!/^\d{7}$/.test(String(r.localizacao))) errors.push({ ...ctx, msg: 'localizacao IBGE inválida.' });
    if (Number(r.valorUnitMensal) <= 0) errors.push({ ...ctx, msg: 'valorUnitMensal deve ser > 0.' });
    if (!CW_RX.test(r.codigoCw)) errors.push({ ...ctx, msg: `codigoCw inválido (padrão CW-XXXXXX/XX) — recebido: ${r.codigoCw || '∅'}` });
  });
  return { errors, warnings };
}

function crossValidate(r517, r503, r443) {
  // 1.1.6: origem 1/2 em 517 deve estar em 503
  // 1.1.7: origem 3/4 em 517 deve estar em 443
  const e517 = [], w517 = [];
  const plates503 = new Set(r503.map(x => x.placa));
  const plates443 = new Set(r443.map(x => x.placa));
  r517.forEach(r => {
    const ctx = { placa: r.placa };
    if ((r.origemVeiculo === 1 || r.origemVeiculo === 2) && !plates503.has(r.placa)) {
      e517.push({ ...ctx, msg: `Veículo abastecido com origem ${r.origemVeiculo} (próprio/cedido) precisa aparecer no layout 503.` });
    }
    if ((r.origemVeiculo === 3 || r.origemVeiculo === 4) && !plates443.has(r.placa)) {
      e517.push({ ...ctx, msg: `Veículo abastecido com origem ${r.origemVeiculo} (locado/sublocado) precisa aparecer no layout 443.` });
    }
  });
  return { e517, w517 };
}

// =============================================================================
// GERADORES CSV (oficial TCE)
// =============================================================================
function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function rowsToCSV(rows, columns) {
  const head = columns.join(';');
  const body = rows.map(r => columns.map(c => csvEscape(r[c])).join(';')).join('\r\n');
  return '﻿' + head + '\r\n' + body + '\r\n'; // BOM + CRLF
}

// Valida que from/to do período do layout estão num intervalo plausível.
// Detecta caso de "ano digitado pela metade" (ex.: 0020 enquanto ainda digitava 2026).
function validatePeriod(code) {
  const p = _periods[code];
  for (const [field, val] of [['início', p.from], ['fim', p.to]]) {
    if (!val) continue;
    const year = Number(val.slice(0, 4));
    if (Number.isNaN(year) || year < 1900 || year > 2100) {
      toast(`Data de ${field} inválida (${val}). Corrija o ano (use 4 dígitos).`, 'error');
      return false;
    }
  }
  if (p.from && p.to && p.from > p.to) {
    toast('Data inicial maior que a final. Corrija o período.', 'error');
    return false;
  }
  return true;
}

function downloadCSV(code, rows) {
  if (!validatePeriod(code)) return;
  if (!rows.length) { toast('Sem registros para exportar.', 'warning'); return; }
  let columns;
  if (code === '517') columns = ['modelo', 'placa', 'renavam', 'anoFabricacao', 'anoModelo', 'tipoVeiculo', 'origemVeiculo', 'orgaoLocalizacao', 'capacidade', 'quantidadeAbastecimento', 'tipoCombustivel', 'kmInicial', 'kmFinal'];
  else if (code === '503') columns = ['modelo', 'placa', 'renavam', 'anoFabricacao', 'anoModelo', 'tipoCombustivel', 'estadoConservacao', 'localizacao', 'veiculoCedido', 'orgaoDestVeicCedido', 'dataInicCessao', 'dataFimCessao'];
  else columns = ['modelo', 'placa', 'renavam', 'anoFabricacao', 'anoModelo', 'tipoCombustivel', 'cpfOuCnpj', 'nomeLocador', 'localizacao', 'valorUnitMensal', 'possuiMotorista', 'codigoCw'];
  const csv = rowsToCSV(rows, columns);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tce_${code}_${periodSlug(code)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`CSV ${code} exportado (${rows.length} linhas).`, 'success');
}

// =============================================================================
// GERADORES PDF (interno — pode incluir descrições, totais, brasão)
// =============================================================================
function fuelDesc(code) { return _fuelTypes.find(f => f.code === Number(code))?.description || ''; }
function vehTypeDesc(code) { return _vehicleTypes.find(f => f.code === Number(code))?.description || ''; }
function originDesc(code) { return _vehicleOrigins.find(f => f.code === Number(code))?.description || ''; }

function downloadPDF(code, rows) {
  if (!validatePeriod(code)) return;
  if (!rows.length) { toast('Sem registros para imprimir.', 'warning'); return; }
  const orgao = _entity?.organ_name || 'Prefeitura Municipal';
  const logo = new URL('logo.png', location.href).href;
  const ibge = _entity?.ibge_code || '';
  const now = new Date().toLocaleString('pt-BR');

  let title, columns, rowsHTML, totals = '';

  if (code === '517') {
    title = 'Cód. 517 — Abastecimento de Veículos';
    columns = ['Modelo', 'Placa', 'RENAVAM', 'Ano Fab.', 'Ano Mod.', 'Tipo Veículo', 'Origem', 'Órgão/Localização', 'Capacidade (L)', 'Qtd. Abast. (L)', 'Combustível', 'KM Inicial', 'KM Final'];
    rowsHTML = rows.map(r => `<tr>
      <td>${esc(r.modelo)}</td>
      <td>${esc(formatPlate(r.placa))}</td>
      <td class="mono">${esc(r.renavam)}</td>
      <td class="num">${esc(r.anoFabricacao)}</td>
      <td class="num">${esc(r.anoModelo)}</td>
      <td>${esc(r.tipoVeiculo)} — ${esc(vehTypeDesc(r.tipoVeiculo))}</td>
      <td>${esc(r.origemVeiculo)} — ${esc(originDesc(r.origemVeiculo))}</td>
      <td>${esc(r.orgaoLocalizacao)}</td>
      <td class="num">${esc(r.capacidade)}</td>
      <td class="num">${esc(r.quantidadeAbastecimento)}</td>
      <td>${esc(r.tipoCombustivel)} — ${esc(fuelDesc(r.tipoCombustivel))}</td>
      <td class="num">${esc(r.kmInicial)}</td>
      <td class="num">${esc(r.kmFinal)}</td>
    </tr>`).join('');
    const sumLitros = rows.reduce((s, r) => s + Number(r.quantidadeAbastecimento), 0);
    totals = `<p class="totals"><b>Totais:</b> ${rows.length} linha(s) · ${sumLitros.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} litros</p>`;
  } else if (code === '503') {
    title = 'Cód. 503 — Veículos Próprios e Cedidos';
    columns = ['Modelo', 'Placa', 'RENAVAM', 'Ano Fab.', 'Ano Mod.', 'Combustível', 'Conservação', 'Localização (IBGE)', 'Cedido?', 'Órgão Destino', 'Início Cessão', 'Fim Cessão'];
    rowsHTML = rows.map(r => `<tr>
      <td>${esc(r.modelo)}</td>
      <td>${esc(formatPlate(r.placa))}</td>
      <td class="mono">${esc(r.renavam)}</td>
      <td class="num">${esc(r.anoFabricacao)}</td>
      <td class="num">${esc(r.anoModelo)}</td>
      <td>${esc(r.tipoCombustivel)} — ${esc(fuelDesc(r.tipoCombustivel))}</td>
      <td>${esc(r.estadoConservacao)}</td>
      <td class="num mono">${esc(r.localizacao)}</td>
      <td>${r.veiculoCedido ? 'SIM' : 'NÃO'}</td>
      <td>${esc(r.orgaoDestVeicCedido)}</td>
      <td>${r.dataInicCessao ? esc(fmtDate(r.dataInicCessao)) : '—'}</td>
      <td>${r.dataFimCessao ? esc(fmtDate(r.dataFimCessao)) : '—'}</td>
    </tr>`).join('');
    totals = `<p class="totals"><b>Totais:</b> ${rows.length} veículo(s)</p>`;
  } else {
    title = 'Cód. 443 — Veículos Locados e Sublocados';
    columns = ['Modelo', 'Placa', 'RENAVAM', 'Ano Fab.', 'Ano Mod.', 'Combustível', 'CPF/CNPJ', 'Locador', 'Localização (IBGE)', 'Valor Mensal (R$)', 'Motorista?', 'Cód. CW'];
    rowsHTML = rows.map(r => `<tr>
      <td>${esc(r.modelo)}</td>
      <td>${esc(formatPlate(r.placa))}</td>
      <td class="mono">${esc(r.renavam)}</td>
      <td class="num">${esc(r.anoFabricacao)}</td>
      <td class="num">${esc(r.anoModelo)}</td>
      <td>${esc(r.tipoCombustivel)} — ${esc(fuelDesc(r.tipoCombustivel))}</td>
      <td class="mono">${esc(r.cpfOuCnpj)}</td>
      <td>${esc(r.nomeLocador)}</td>
      <td class="num mono">${esc(r.localizacao)}</td>
      <td class="num">${fmtMoney(r.valorUnitMensal)}</td>
      <td>${r.possuiMotorista ? 'SIM' : 'NÃO'}</td>
      <td class="mono">${esc(r.codigoCw)}</td>
    </tr>`).join('');
    const sumVal = rows.reduce((s, r) => s + Number(r.valorUnitMensal), 0);
    totals = `<p class="totals"><b>Totais:</b> ${rows.length} veículo(s) · ${fmtMoney(sumVal)}/mês</p>`;
  }

  const w = window.open('', '_blank', 'width=1400,height=900');
  if (!w) { toast('Permita popups.', 'error'); return; }
  w.document.write(`<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#1A2A3A; margin:0; font-size:9px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .hdr { display:flex; align-items:center; gap:12px; padding:8px 0; border-bottom:2px solid #217AD8; margin-bottom:10px; }
  .hdr img { width:50px; height:50px; object-fit:contain; }
  .hdr .org { font-size:9px; color:#475569; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .hdr .title { font-size:16px; font-weight:700; color:#0F172A; margin-top:2px; }
  .hdr .meta { font-size:9px; color:#64748B; margin-top:4px; display:flex; gap:12px; flex-wrap:wrap; }
  .hdr .meta b { color:#1A2A3A; }
  .banner { font-size:9px; color:#92400E; background:#FEF3DC; border-left:3px solid #D97706; padding:5px 10px; border-radius:0 4px 4px 0; margin-bottom:10px; }
  table { width:100%; border-collapse:collapse; font-size:8px; page-break-inside:auto; }
  thead { display:table-header-group; }
  tr { page-break-inside:avoid; }
  th { background:#1A65B5; color:#fff; text-align:left; padding:4px 5px; font-weight:600; font-size:7.5px; text-transform:uppercase; letter-spacing:.02em; }
  td { padding:3px 5px; border-bottom:1px solid #E5E9F0; vertical-align:top; }
  tr:nth-child(even) td { background:#F8FAFC; }
  td.num, th.num { text-align:right; white-space:nowrap; }
  td.mono, th.mono { font-family:ui-monospace,'SF Mono',Menlo,monospace; }
  .totals { margin-top:10px; padding:6px 10px; background:#EAF2FB; border-radius:4px; font-size:9px; }
  .footer { margin-top:14px; padding-top:6px; border-top:1px solid #E5E9F0; font-size:8px; color:#94A3B8; text-align:center; }
  .footer b { color:#475569; }
</style></head><body>
  <div class="hdr">
    ${logo ? `<img src="${esc(logo)}" alt="">` : ''}
    <div>
      <div class="org">${esc(_entity?.entity_type || '')}</div>
      <div class="title">${esc(title)}</div>
      <div class="meta">
        <span><b>${esc(orgao)}</b></span>
        ${ibge ? `<span>IBGE ${esc(ibge)}</span>` : ''}
        <span>Período: ${esc(periodLabel(code))}</span>
        <span>Gerado em ${esc(now)}</span>
      </div>
    </div>
  </div>
  <div class="banner">Documento de conferência interna. O envio oficial ao TCE-PI deve ser feito pelo CSV correspondente.</div>
  <table>
    <thead><tr>${columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rowsHTML}</tbody>
  </table>
  ${totals}
  <div class="footer">Gerir Frota · ${esc(orgao)} · ${esc(now)}</div>
  <script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 400);</script>
</body></html>`);
  w.document.close();
}
