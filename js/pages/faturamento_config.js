// =============================================================================
// FATURAMENTO › Configuração (só administrador). Reúne o que os documentos
// exigem: data de início, dados das secretarias e dados dos contratos.
// =============================================================================
import { supabase } from '../supabase.js';
import { esc, toast, fmtDate, fmtCNPJ, maskCNPJ, isValidCNPJ, onlyDigits, isMissingColumn } from '../ui.js';
import { icons } from '../icons.js';
import { isAdmin } from '../auth.js';

let _entity = null;
let _depts = [];
let _contracts = [];   // fornecedores que vendem combustível (posto / ambos)
let _search = '';

// Data de hoje no fuso do usuário (toISOString usa UTC e vira o dia às 21h no Brasil)
function localToday() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}

const PRICE_LABEL = { fixo: 'Preço fixo por litro', desconto_bomba: 'Desconto sobre o preço da bomba' };

// =============================================================================
// ENTRY
// =============================================================================
export async function renderConfigTab(container) {
  container.innerHTML = `<div id="fat-body"></div>`;
  const body = document.getElementById('fat-body');

  if (!isAdmin()) {
    body.innerHTML = stateCard(icons.shield, 'Acesso restrito',
      'A configuração do faturamento é feita pelo administrador.');
    return;
  }

  const res = await loadAll();
  if (res === 'missing') {
    body.innerHTML = stateCard(icons.alert, 'Banco de dados ainda não atualizado',
      'O faturamento precisa da atualização do banco. Execute o arquivo apply.sql no Supabase e recarregue a página.');
    return;
  }
  if (res === 'error') {
    body.innerHTML = stateCard(icons.alert, 'Não foi possível carregar',
      'Verifique sua conexão e recarregue a página.');
    return;
  }
  renderConfig();
}

function stateCard(icon, title, text) {
  return `<div class="card"><div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${esc(title)}</div>
    <p class="empty-state-text">${esc(text)}</p>
  </div></div>`;
}

// false quando o banco ainda não tem a opção de numeração (versão anterior)
let _hasNumbering = true;

async function loadAll() {
  let [e, d, s] = await Promise.all([
    supabase.from('entity').select('id, billing_start_date, billing_numbering').maybeSingle(),
    supabase.from('department')
      .select('id, acronym, name, cnpj, responsible_name, responsible_role')
      .order('acronym'),
    supabase.from('supplier')
      .select('id, kind, legal_name, trade_name, cnpj, department_id, contract_number, price_type, fiscal_name, fiscal_registration, fiscal_ordinance')
      .in('kind', ['posto', 'ambos'])
      .order('legal_name'),
  ]);
  _hasNumbering = true;
  if (e.error && /billing_numbering/.test(e.error.message || '')) {
    _hasNumbering = false;
    e = await supabase.from('entity').select('id, billing_start_date').maybeSingle();
  }
  const err = e.error || d.error || s.error;
  if (err) return isMissingColumn(err) ? 'missing' : 'error';
  _entity = e.data;
  _depts = d.data || [];
  _contracts = s.data || [];
  return 'ok';
}

// =============================================================================
// PENDÊNCIAS
// =============================================================================
function deptMissing(d) {
  const m = [];
  if (!d.cnpj) m.push('CNPJ');
  if (!d.responsible_name) m.push('responsável');
  if (!d.responsible_role) m.push('cargo');
  return m;
}
function contractMissing(c) {
  const m = [];
  if (!c.department_id) m.push('secretaria');
  if (!c.contract_number) m.push('nº do contrato');
  if (!c.fiscal_name) m.push('fiscal');
  return m;
}
function computePending() {
  const list = [];
  if (!_entity?.billing_start_date) {
    list.push({ level: 'block', target: 'cfg-general', text: 'Data de início do faturamento não definida. Sem ela, nenhuma Ordem de Fornecimento pode ser emitida.' });
  }
  _contracts.filter(c => !c.department_id).forEach(c => {
    list.push({ level: 'block', target: `cfg-c-${c.id}`, text: `Contrato de ${c.trade_name || c.legal_name} sem secretaria: não aparece para faturar.` });
  });
  _depts.forEach(d => {
    const m = deptMissing(d);
    if (m.length) list.push({ level: 'warn', target: `cfg-d-${d.id}`, text: `${d.acronym}: falta ${joinList(m)}.` });
  });
  _contracts.filter(c => c.department_id).forEach(c => {
    const m = contractMissing(c);
    if (m.length) list.push({ level: 'warn', target: `cfg-c-${c.id}`, text: `Contrato ${contractTitle(c)}: falta ${joinList(m)}.` });
  });
  return list;
}
const joinList = (a) => a.length <= 1 ? a.join('') : a.slice(0, -1).join(', ') + ' e ' + a.at(-1);
const deptOf = (id) => _depts.find(d => d.id === id);
function contractTitle(c) {
  const sec = deptOf(c.department_id)?.acronym;
  return [c.trade_name || c.legal_name, sec, c.contract_number ? 'nº ' + c.contract_number : null].filter(Boolean).join(' · ');
}

function pendingHTML() {
  const list = computePending();
  if (!list.length) {
    return `
      <div class="cfg-ok">
        <span class="cfg-ok-icon">${icons.check}</span>
        <div>
          <strong>Tudo pronto para faturar.</strong>
          <span>Data de início, secretarias e contratos estão completos.</span>
        </div>
      </div>`;
  }
  const blocks = list.filter(p => p.level === 'block').length;
  return `
    <div class="cfg-pending-head">
      <strong>${list.length} pendência(s)</strong>
      <span>${blocks ? `${blocks} impede(m) o faturamento. As demais saem como "—" nos documentos.` : 'Nenhuma impede o faturamento, mas os campos vazios saem como "—" nos documentos.'}</span>
    </div>
    <ul class="cfg-pending-list">
      ${list.map(p => `
        <li class="cfg-pending ${p.level === 'block' ? 'is-block' : ''}">
          <span class="cfg-pending-icon">${p.level === 'block' ? icons.alert : icons.info}</span>
          <span class="cfg-pending-text">${esc(p.text)}</span>
          <button type="button" class="btn btn-ghost btn-sm" data-goto="${esc(p.target)}">Preencher</button>
        </li>`).join('')}
    </ul>`;
}

// =============================================================================
// RENDER
// =============================================================================
function renderConfig() {
  const body = document.getElementById('fat-body');
  body.innerHTML = `
    <div class="card" id="cfg-pending-card">
      <h2 class="cfg-title">Pendências</h2>
      <div id="cfg-pending">${pendingHTML()}</div>
    </div>

    <div class="card" id="cfg-general">
      <h2 class="cfg-title">Início do faturamento</h2>
      <p class="cfg-help">Abastecimentos anteriores a esta data nunca entram em Ordem de Fornecimento. Para faturar meses anteriores, recue a data antes de emitir a primeira ordem.</p>
      <div class="cfg-row is-inline" data-row="general">
        <div class="cfg-fields">
          <div class="field">
            <label class="field-label" for="cfg-start">Data de início</label>
            <input class="input" type="date" id="cfg-start" data-f="billing_start_date"
                   value="${esc(_entity?.billing_start_date || '')}">
          </div>
        </div>
        ${rowFoot()}
      </div>
    </div>

    ${_hasNumbering ? `
    <div class="card" id="cfg-numbering">
      <h2 class="cfg-title">Numeração das ordens</h2>
      <p class="cfg-help">Quem dá o número da Ordem de Fornecimento. Use "Informada" quando a ordem já é emitida em outro sistema, para não existirem duas ordens do mesmo fornecimento.</p>
      <div class="cfg-row is-inline" data-row="numbering">
        <div class="cfg-fields cfg-fields-wide">
          <div class="field">
            <label class="field-label" for="cfg-numbering-mode">Numeração</label>
            <select class="select" id="cfg-numbering-mode" data-f="billing_numbering">
              <option value="auto" ${_entity?.billing_numbering !== 'informado' ? 'selected' : ''}>Automática: o Gerir Frota numera (001/2026, 002/2026…)</option>
              <option value="informado" ${_entity?.billing_numbering === 'informado' ? 'selected' : ''}>Informada: a ordem é emitida em outro sistema</option>
            </select>
          </div>
        </div>
        ${rowFoot()}
      </div>
      <p class="cfg-help cfg-numbering-note" id="cfg-numbering-note">${numberingNote(_entity?.billing_numbering)}</p>
    </div>` : ''}

    <div class="card" id="cfg-depts">
      <h2 class="cfg-title">Secretarias</h2>
      <p class="cfg-help">Cada secretaria é uma unidade gestora: tem CNPJ próprio e numeração própria de ordens. O responsável assina os documentos. São os mesmos campos do cadastro de Secretarias: o que for preenchido aqui aparece lá, e vice-versa.</p>
      ${_depts.length ? _depts.map(deptRowHTML).join('') : `<p class="cfg-empty">Nenhuma secretaria cadastrada.</p>`}
    </div>

    <div class="card" id="cfg-contracts">
      <h2 class="cfg-title">Contratos</h2>
      <p class="cfg-help">Cada cadastro de posto é um contrato com uma secretaria. Para um contrato novo com o mesmo posto, cadastre um novo fornecedor com o novo número. São os mesmos campos do cadastro de Fornecedores.</p>
      <div class="table-toolbar">
        <div class="search ${_search ? 'has-value' : ''}" id="cfg-search-box">
          ${icons.search}
          <input id="cfg-search" type="search" placeholder="Buscar por posto, CNPJ, secretaria, contrato, fiscal…"
                 autocomplete="off" value="${esc(_search)}">
          <button class="clear" id="cfg-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="cfg-count"></div>
      </div>
      <div id="cfg-contract-list"></div>
    </div>
  `;
  renderContracts();
  bindConfig(body);
}

function rowFoot() {
  return `
    <div class="cfg-foot">
      <span class="cfg-status" data-status></span>
      <button type="button" class="btn btn-primary btn-sm" data-save disabled>Salvar</button>
    </div>`;
}

function chipHTML(missing) {
  return missing.length
    ? `<span class="badge badge-warning">Falta ${esc(joinList(missing))}</span>`
    : `<span class="badge badge-success">Completo</span>`;
}

function deptRowHTML(d) {
  return `
    <div class="cfg-row" id="cfg-d-${d.id}" data-row="dept" data-id="${d.id}">
      <div class="cfg-head">
        <span class="badge">${esc(d.acronym)}</span>
        <strong class="cfg-name">${esc(d.name)}</strong>
        <span class="cfg-chip" data-chip>${chipHTML(deptMissing(d))}</span>
      </div>
      <div class="cfg-fields">
        <div class="field">
          <label class="field-label">CNPJ</label>
          <input class="input" data-f="cnpj" inputmode="numeric" maxlength="18"
                 value="${esc(fmtCNPJ(d.cnpj))}" placeholder="00.000.000/0000-00">
        </div>
        <div class="field">
          <label class="field-label">Responsável</label>
          <input class="input" data-f="responsible_name" maxlength="120"
                 value="${esc(d.responsible_name || '')}" placeholder="Nome de quem assina">
        </div>
        <div class="field">
          <label class="field-label">Cargo do responsável</label>
          <input class="input" data-f="responsible_role" maxlength="120"
                 value="${esc(d.responsible_role || '')}" placeholder="ex: Secretário(a) Municipal de Saúde">
        </div>
      </div>
      ${rowFoot()}
    </div>`;
}

function contractRowHTML(c) {
  const deptOptions = '<option value="">— Sem secretaria —</option>' +
    _depts.map(d => `<option value="${d.id}" ${c.department_id === d.id ? 'selected' : ''}>${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');
  const priceOptions = Object.entries(PRICE_LABEL)
    .map(([k, l]) => `<option value="${k}" ${(c.price_type || 'fixo') === k ? 'selected' : ''}>${esc(l)}</option>`).join('');
  return `
    <div class="cfg-row" id="cfg-c-${c.id}" data-row="contract" data-id="${c.id}">
      <div class="cfg-head">
        <div class="cell-stack">
          <strong class="cfg-name">${esc(c.trade_name || c.legal_name)}</strong>
          <span class="cfg-sub">CNPJ ${esc(fmtCNPJ(c.cnpj))}</span>
        </div>
        <span class="cfg-chip" data-chip>${chipHTML(contractMissing(c))}</span>
      </div>
      <div class="cfg-fields">
        <div class="field">
          <label class="field-label">Secretaria</label>
          <select class="select" data-f="department_id">${deptOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">Nº / ano do contrato</label>
          <input class="input" data-f="contract_number" maxlength="30"
                 value="${esc(c.contract_number || '')}" placeholder="ex: 012/2025">
        </div>
        <div class="field">
          <label class="field-label">Tipo de preço</label>
          <select class="select" data-f="price_type">${priceOptions}</select>
        </div>
        <div class="field">
          <label class="field-label">Fiscal do contrato</label>
          <input class="input" data-f="fiscal_name" maxlength="120"
                 value="${esc(c.fiscal_name || '')}" placeholder="Nome completo">
        </div>
        <div class="field">
          <label class="field-label">Matrícula do fiscal</label>
          <input class="input" data-f="fiscal_registration" maxlength="30"
                 value="${esc(c.fiscal_registration || '')}">
        </div>
        <div class="field">
          <label class="field-label">Portaria de designação</label>
          <input class="input" data-f="fiscal_ordinance" maxlength="60"
                 value="${esc(c.fiscal_ordinance || '')}" placeholder="ex: Portaria nº 015/2026">
        </div>
      </div>
      ${rowFoot()}
    </div>`;
}

function matchesContract(c, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  const d = deptOf(c.department_id);
  const digits = onlyDigits(term);
  return (c.trade_name || '').toLowerCase().includes(t)
      || (c.legal_name || '').toLowerCase().includes(t)
      || (c.contract_number || '').toLowerCase().includes(t)
      || (c.fiscal_name || '').toLowerCase().includes(t)
      || (d?.acronym || '').toLowerCase().includes(t)
      || (d?.name || '').toLowerCase().includes(t)
      || (digits.length >= 3 && onlyDigits(c.cnpj).includes(digits));
}

function renderContracts() {
  const box = document.getElementById('cfg-contract-list');
  const count = document.getElementById('cfg-count');
  if (!box) return;
  if (!_contracts.length) {
    count.textContent = '';
    box.innerHTML = `<p class="cfg-empty">Nenhum posto cadastrado. Cadastre em Fornecedores.</p>`;
    return;
  }
  const list = _contracts.filter(c => matchesContract(c, _search));
  count.textContent = _search ? `${list.length} de ${_contracts.length} contrato(s)` : `${_contracts.length} contrato(s)`;
  box.innerHTML = list.length
    ? list.map(contractRowHTML).join('')
    : `<div class="empty-state">
         <div class="empty-state-icon">${icons.search}</div>
         <div class="empty-state-title">Nenhum resultado</div>
         <p class="empty-state-text">Nada encontrado para "<strong>${esc(_search)}</strong>".</p>
       </div>`;
}

// =============================================================================
// EVENTOS
// =============================================================================
function bindConfig(body) {
  // Delegação: as linhas de contrato são redesenhadas na busca.
  body.addEventListener('input', (e) => {
    const el = e.target;
    if (el.id === 'cfg-search') {
      _search = el.value || '';
      document.getElementById('cfg-search-box').classList.toggle('has-value', !!_search);
      renderContracts();
      return;
    }
    if (!el.dataset?.f) return;
    if (el.dataset.f === 'cnpj') el.value = maskCNPJ(el.value);
    markDirty(el.closest('.cfg-row'));
  });
  body.addEventListener('change', (e) => {
    if (e.target.dataset?.f) markDirty(e.target.closest('.cfg-row'));
    // a explicação acompanha a opção escolhida, antes mesmo de salvar
    if (e.target.id === 'cfg-numbering-mode') document.getElementById('cfg-numbering-note').textContent = numberingNote(e.target.value);
  });
  body.addEventListener('click', (e) => {
    const save = e.target.closest('[data-save]');
    if (save) { saveRow(save.closest('.cfg-row')); return; }
    const go = e.target.closest('[data-goto]');
    if (go) { goTo(go.dataset.goto); return; }
    if (e.target.closest('#cfg-search-clear')) {
      _search = '';
      const input = document.getElementById('cfg-search');
      input.value = '';
      document.getElementById('cfg-search-box').classList.remove('has-value');
      renderContracts();
      input.focus();
    }
  });
}

function markDirty(row) {
  if (!row) return;
  row.classList.add('is-dirty');
  row.dataset.unsaved = '1';   // app.js não recarrega a rota ao voltar pra aba enquanto houver edição pendente
  row.querySelector('[data-save]').disabled = false;
  setStatus(row, 'Alterações não salvas', 'dirty');
}
function setStatus(row, text, kind = '') {
  const el = row.querySelector('[data-status]');
  el.textContent = text;
  el.className = 'cfg-status' + (kind ? ' is-' + kind : '');
}

/** Leva até a linha da pendência; se ela estiver escondida pela busca, limpa a busca. */
function goTo(targetId) {
  let el = document.getElementById(targetId);
  if (!el && _search) {
    _search = '';
    document.getElementById('cfg-search').value = '';
    document.getElementById('cfg-search-box').classList.remove('has-value');
    renderContracts();
    el = document.getElementById(targetId);
  }
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('is-focus');
  setTimeout(() => el.classList.remove('is-focus'), 1600);
  const empty = [...el.querySelectorAll('[data-f]')].find(i => !i.value);
  (empty || el.querySelector('[data-f]'))?.focus({ preventScroll: true });
}

function numberingNote(mode) {
  return mode === 'informado'
    ? 'Ao registrar a ordem, o usuário informa o número que ela recebeu no outro sistema. O Gerir Frota gera a relação de abastecimentos e o Termo de Recebimento com esse número. Número repetido na mesma secretaria é recusado.'
    : 'Cada secretaria tem a sua sequência, que recomeça em 001 a cada ano. O número de uma ordem cancelada não é reaproveitado.';
}

function readRow(row) {
  const v = {};
  row.querySelectorAll('[data-f]').forEach(i => { v[i.dataset.f] = (i.value || '').trim(); });
  return v;
}

async function saveRow(row) {
  const kind = row.dataset.row;
  const id = row.dataset.id;
  const v = readRow(row);
  let table, payload, match;

  if (kind === 'general') {
    const date = v.billing_start_date || null;
    if (date && date > localToday()) {
      setStatus(row, 'A data de início não pode ser futura.', 'error'); return;
    }
    table = 'entity'; match = { id: 1 };
    payload = { billing_start_date: date };
  } else if (kind === 'numbering') {
    table = 'entity'; match = { id: 1 };
    payload = { billing_numbering: v.billing_numbering === 'informado' ? 'informado' : 'auto' };
  } else if (kind === 'dept') {
    const cnpj = onlyDigits(v.cnpj);
    if (cnpj && !isValidCNPJ(cnpj)) {
      setStatus(row, 'CNPJ inválido. Confira os dígitos.', 'error');
      row.querySelector('[data-f="cnpj"]').focus();
      return;
    }
    table = 'department'; match = { id };
    payload = {
      cnpj: cnpj || null,
      responsible_name: v.responsible_name || null,
      responsible_role: v.responsible_role || null,
    };
  } else {
    table = 'supplier'; match = { id };
    payload = {
      department_id: v.department_id || null,
      contract_number: v.contract_number || null,
      price_type: v.price_type === 'desconto_bomba' ? 'desconto_bomba' : 'fixo',
      fiscal_name: v.fiscal_name || null,
      fiscal_registration: v.fiscal_registration || null,
      fiscal_ordinance: v.fiscal_ordinance || null,
    };
  }

  const btn = row.querySelector('[data-save]');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando';
  setStatus(row, '');

  let error = null;
  try {
    const req = supabase.from(table).update(payload).match(match).select('id');
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Tempo esgotado. Verifique sua conexão.')), 12000));
    const res = await Promise.race([req, timeout]);
    if (res.error) error = res.error;
    else if (!res.data?.length) error = { message: 'Registro não foi alterado. Verifique sua permissão.' };
  } catch (e) {
    error = { message: e?.message || String(e) };
  }
  btn.textContent = 'Salvar';

  if (error) {
    btn.disabled = false;
    setStatus(row, friendlyError(error), 'error');
    return;
  }

  // Estado local + pendências, sem redesenhar a página (mantém foco e rolagem)
  if (kind === 'general' || kind === 'numbering') Object.assign(_entity, payload);
  else Object.assign((kind === 'dept' ? _depts : _contracts).find(x => x.id === id), payload);
  row.classList.remove('is-dirty');
  delete row.dataset.unsaved;
  if (kind === 'dept') {
    row.querySelector('[data-chip]').innerHTML = chipHTML(deptMissing(_depts.find(x => x.id === id)));
  } else if (kind === 'contract') {
    row.querySelector('[data-chip]').innerHTML = chipHTML(contractMissing(_contracts.find(x => x.id === id)));
  }
  document.getElementById('cfg-pending').innerHTML = pendingHTML();
  if (kind === 'numbering') document.getElementById('cfg-numbering-note').textContent = numberingNote(payload.billing_numbering);
  setStatus(row, kind === 'general' && payload.billing_start_date
    ? `Salvo. Faturamento a partir de ${fmtDate(payload.billing_start_date)}.`
    : kind === 'numbering'
      ? (payload.billing_numbering === 'informado' ? 'Salvo. As próximas ordens pedem o número.' : 'Salvo. As próximas ordens são numeradas pelo sistema.')
      : 'Salvo.', 'ok');
  toast('Configuração salva.', 'success');
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (err?.code === '23505' || /duplicate key|unique/i.test(msg)) {
    return 'Já existe um contrato deste posto com essa secretaria e esse número. Use outro número de contrato.';
  }
  if (/chk_department_cnpj/.test(msg)) return 'CNPJ inválido: informe os 14 dígitos.';
  if (isMissingColumn(err)) return 'Banco ainda não atualizado. Execute o apply.sql no Supabase.';
  return msg;
}
