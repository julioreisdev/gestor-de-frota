// =============================================================================
// MOTORISTAS — cadastro
// Obrigatórios: nome e CPF. O resto é opcional, em grupos recolhidos.
// Admin e usuário cadastram e editam; só admin exclui. Posto não acessa.
// =============================================================================
import { pageRoot, pageHeader } from '../shell.js';
import { supabase } from '../supabase.js';
import {
  esc, fmtDate, toast, openModal, closeModal, confirmDialog, onlyDigits,
  fmtCPF, hideCPF, maskCPF, isValidCPF, maskPhone, maskCEP,
} from '../ui.js';
import { icons } from '../icons.js';
import { getProfile, isAdmin } from '../auth.js';
import { exportXLSX, timestampFilename } from '../export.js';
import { printList } from '../print.js';
import { localToday, isBillingMissing, withTimeout } from '../billing.js';
import {
  CNH_CATEGORIES, BLOOD_TYPES, EMPLOYMENT_TYPES, COURSE_KINDS, STATES, CNH_STATUS,
  cnhStatus, toxicologyExpired, cnhSummary,
} from '../drivers.js';
import { readCNH } from '../cnh.js';

let _items = [];
let _depts = [];
let _userDept = null;   // secretaria do usuário logado (null = enxerga todas)
let _filter = { search: '', dept: '', active: '', category: '', cnh: '' };

const ico = (name, size = 16) => `<span style="width:${size}px;height:${size}px;display:inline-flex">${icons[name]}</span>`;
const canWrite = () => ['admin', 'usuario'].includes(getProfile()?.role);

// =============================================================================
// PÁGINA
// =============================================================================
export async function renderMotoristas() {
  if (!canWrite()) {
    pageRoot().innerHTML = `
      ${pageHeader({ title: 'Motoristas', subtitle: 'Cadastro de motoristas.' })}
      <div class="card"><div class="empty-state">
        <div class="empty-state-icon">${icons.shield}</div>
        <div class="empty-state-title">Sem acesso</div>
        <p class="empty-state-text">O cadastro de motoristas é restrito à prefeitura.</p>
      </div></div>`;
    return;
  }

  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Motoristas',
      subtitle: 'Cadastro de motoristas e acompanhamento da validade da CNH.',
      actionsHtml: `
        <button class="btn btn-outline" id="btn-print-drv" title="Imprimir lista filtrada">
          ${ico('printer')}<span>Imprimir</span>
        </button>
        <button class="btn btn-outline" id="btn-export-drv" title="Exportar lista filtrada (Excel)">
          ${ico('download')}<span>Exportar Excel</span>
        </button>
        <button class="btn btn-primary" id="btn-new-drv">
          ${ico('plus')} Novo motorista
        </button>`,
    })}
    <div id="drv-stats"></div>
    <div class="card" id="drv-card">
      <div class="table-toolbar">
        <div class="search ${_filter.search ? 'has-value' : ''}" id="drv-search-box">
          ${icons.search}
          <input id="drv-search" type="search" placeholder="Buscar por nome, CPF, matrícula, CNH…"
                 autocomplete="off" value="${esc(_filter.search)}">
          <button class="clear" id="drv-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="drv-count"></div>
      </div>
      <div class="filter-chips" id="drv-filters">
        <select class="select chip" id="df-dept" aria-label="Secretaria"></select>
        <select class="select chip" id="df-active" aria-label="Situação">
          <option value="">Ativos e inativos</option>
          <option value="1">Ativos</option>
          <option value="0">Inativos</option>
        </select>
        <select class="select chip" id="df-category" aria-label="Categoria da CNH">
          <option value="">Todas categorias</option>
          ${CNH_CATEGORIES.map(c => `<option value="${c}">Categoria ${c}</option>`).join('')}
        </select>
        <select class="select chip" id="df-cnh" aria-label="Situação da CNH">
          <option value="">CNH: todas</option>
          <option value="ok">CNH em dia</option>
          <option value="expiring">Vence em até 30 dias</option>
          <option value="expired">CNH vencida</option>
          <option value="missing">CNH não informada</option>
        </select>
        <button class="btn btn-ghost btn-sm" id="df-clear" hidden>Limpar filtros</button>
      </div>
      <div id="drv-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  bind();
  await loadAll();
  fillFilters();
  renderStats();
  renderTable();
}

const DRIVER_COLS = `
  id, full_name, cpf, rg, rg_issuer, birth_date, blood_type,
  registration, job_title, employment_type, department_id, admission_date,
  cnh_number, cnh_category, cnh_expiry, cnh_first_issue, cnh_state, cnh_paid_activity, toxicology_expiry,
  phone, phone2, email,
  address_street, address_number, address_district, address_city, address_zip,
  emergency_contact_name, emergency_contact_phone,
  active, notes, created_at,
  department:department_id(acronym, name),
  courses:driver_course(kind, expiry)`;

let _loadError = null;
async function loadAll() {
  _loadError = null;
  try {
    const [d, s, u] = await withTimeout(Promise.all([
      supabase.from('driver').select(DRIVER_COLS).order('full_name'),
      supabase.from('department').select('id, acronym, name').order('acronym'),
      supabase.rpc('current_user_department_id'),
    ]));
    if (d.error) throw d.error;
    _items = d.data || [];
    _depts = s.data || [];
    _userDept = u.error ? null : (u.data || null);
  } catch (e) {
    _items = [];
    _loadError = e;
  }
}

// =============================================================================
// FILTROS
// =============================================================================
function fillFilters() {
  const sel = document.getElementById('df-dept');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas secretarias</option><option value="none">Sem secretaria</option>' +
    _depts.map(d => `<option value="${d.id}">${esc(d.acronym)} — ${esc(d.name)}</option>`).join('');
  sel.value = _filter.dept;
  document.getElementById('df-active').value = _filter.active;
  document.getElementById('df-category').value = _filter.category;
  document.getElementById('df-cnh').value = _filter.cnh;
  document.getElementById('drv-filters').hidden = !_items.length;
  syncClear();
}
function syncClear() {
  const any = _filter.dept || _filter.active || _filter.category || _filter.cnh;
  document.getElementById('df-clear').hidden = !any;
}

function applyFilters() {
  const t = _filter.search.trim().toLowerCase();
  const digits = onlyDigits(t);
  return _items.filter(d => {
    if (_filter.dept === 'none' && d.department_id) return false;
    if (_filter.dept && _filter.dept !== 'none' && d.department_id !== _filter.dept) return false;
    if (_filter.active === '1' && !d.active) return false;
    if (_filter.active === '0' && d.active) return false;
    if (_filter.category && d.cnh_category !== _filter.category) return false;
    if (_filter.cnh && cnhStatus(d) !== _filter.cnh) return false;
    if (!t) return true;
    return (d.full_name || '').toLowerCase().includes(t)
        || (d.registration || '').toLowerCase().includes(t)
        || (digits && ((d.cpf || '').includes(digits) || (d.cnh_number || '').includes(digits)));
  });
}

function filtersLabel() {
  const p = [];
  if (_filter.search) p.push(`Busca: "${_filter.search}"`);
  if (_filter.dept === 'none') p.push('Sem secretaria');
  else if (_filter.dept) p.push('Secretaria: ' + (_depts.find(d => d.id === _filter.dept)?.acronym || ''));
  if (_filter.active) p.push(_filter.active === '1' ? 'Ativos' : 'Inativos');
  if (_filter.category) p.push('Categoria ' + _filter.category);
  if (_filter.cnh) p.push(CNH_STATUS[_filter.cnh].label);
  return p.join(' · ');
}

// =============================================================================
// RESUMO E TABELA
// =============================================================================
function renderStats() {
  const box = document.getElementById('drv-stats');
  if (!box) return;
  if (!_items.length) { box.innerHTML = ''; return; }
  const act = _items.filter(d => d.active);
  const n = (s) => act.filter(d => cnhStatus(d) === s).length;
  const expired = n('expired'), expiring = n('expiring');
  box.innerHTML = `
    <div class="stat-row drv-stats" style="margin-bottom:var(--s-4)">
      <div class="stat"><label>Motoristas ativos</label><strong>${act.length}</strong></div>
      <div class="stat"><label>CNH vencida</label><strong ${expired ? 'style="color:var(--danger)"' : ''}>${expired}</strong></div>
      <div class="stat"><label>Vence em até 30 dias</label><strong ${expiring ? 'style="color:var(--warning)"' : ''}>${expiring}</strong></div>
      <div class="stat"><label>CNH não informada</label><strong>${n('missing')}</strong></div>
    </div>`;
}

function stateHTML(icon, title, text, action = '') {
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${esc(title)}</div>
    <p class="empty-state-text">${esc(text)}</p>${action}
  </div>`;
}

function renderTable() {
  const box = document.getElementById('drv-tablebox');
  const countEl = document.getElementById('drv-count');
  if (!box) return;

  if (_loadError) {
    countEl.textContent = '';
    box.innerHTML = stateHTML(icons.alert,
      isBillingMissing(_loadError) ? 'Banco de dados ainda não atualizado' : 'Não foi possível carregar',
      isBillingMissing(_loadError) ? 'Execute o apply.sql no Supabase para liberar o cadastro de motoristas.' : (_loadError.message || 'Tente de novo.'));
    return;
  }
  if (!_items.length) {
    countEl.textContent = '';
    box.innerHTML = stateHTML(icons.idCard, 'Nenhum motorista cadastrado',
      'Para cadastrar, bastam o nome e o CPF. Os outros dados podem ser completados depois.',
      `<button class="btn btn-primary" data-new style="margin-top:var(--s-4)">${ico('plus')} Novo motorista</button>`);
    return;
  }

  const list = applyFilters();
  const filtering = _filter.search || _filter.dept || _filter.active || _filter.category || _filter.cnh;
  countEl.textContent = filtering ? `${list.length} de ${_items.length} motorista(s)` : `${_items.length} motorista(s)`;

  if (!list.length) {
    box.innerHTML = stateHTML(icons.search, 'Nenhum resultado', 'Nenhum motorista corresponde à busca e aos filtros.');
    return;
  }
  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>Motorista</th>
          <th>CPF</th>
          <th>Secretaria</th>
          <th>CNH</th>
          <th>Telefone</th>
          <th>Situação</th>
          <th class="actions-col">Ações</th>
        </tr></thead>
        <tbody>${list.map(rowHTML).join('')}</tbody>
      </table>
    </div>`;
}

function cnhBadges(d) {
  const st = cnhStatus(d);
  const out = [];
  if (st !== 'ok') out.push(`<span class="${CNH_STATUS[st].badge}">${CNH_STATUS[st].label}</span>`);
  if (toxicologyExpired(d)) out.push(`<span class="badge badge-warning" title="Exame toxicológico vencido em ${esc(fmtDate(d.toxicology_expiry))}">Toxicológico vencido</span>`);
  return out.join('');
}

function rowHTML(d) {
  const sub = [d.registration ? 'Mat. ' + d.registration : '', d.job_title || ''].filter(Boolean).join(' · ');
  const summary = cnhSummary(d);
  const badges = d.active ? cnhBadges(d) : '';
  const courses = (d.courses || []).length;
  return `
    <tr ${d.active ? '' : 'class="is-canceled"'}>
      <td data-label="Motorista">
        <div class="cell-stack">
          <strong>${esc(d.full_name)}</strong>
          ${sub ? `<span class="of-sub">${esc(sub)}</span>` : ''}
        </div>
      </td>
      <td data-label="CPF"><span class="of-mono">${esc(hideCPF(d.cpf))}</span></td>
      <td data-label="Secretaria">${d.department
        ? `<span class="badge" title="${esc(d.department.name)}">${esc(d.department.acronym)}</span>`
        : '<span class="of-sub">Todas</span>'}</td>
      <td data-label="CNH">
        <div class="cell-stack">
          ${summary ? `<span class="of-nowrap">${esc(summary)}</span>` : ''}
          ${badges ? `<span class="drv-badges">${badges}</span>` : ''}
          ${courses ? `<span class="of-sub">${courses} curso${courses > 1 ? 's' : ''}</span>` : ''}
          ${!summary && !badges && !courses ? '<span class="of-sub">—</span>' : ''}
        </div>
      </td>
      <td data-label="Telefone">${d.phone ? `<span class="of-nowrap">${esc(d.phone)}</span>` : '<span class="of-sub">—</span>'}</td>
      <td data-label="Situação"><span class="badge ${d.active ? 'badge-success' : 'badge-neutral'}">${d.active ? 'Ativo' : 'Inativo'}</span></td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" data-id="${d.id}" title="Editar">${icons.edit}</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="delete" data-id="${d.id}" title="Excluir" style="color:var(--danger)">${icons.trash}</button>` : ''}
        </div>
      </td>
    </tr>`;
}

// =============================================================================
// EVENTOS
// =============================================================================
function bind() {
  const sBox = document.getElementById('drv-search-box');
  const sIn = document.getElementById('drv-search');
  sIn.addEventListener('input', () => {
    _filter.search = sIn.value || '';
    sBox.classList.toggle('has-value', !!_filter.search);
    renderTable();
  });
  document.getElementById('drv-search-clear').addEventListener('click', () => {
    _filter.search = ''; sIn.value = ''; sBox.classList.remove('has-value');
    renderTable(); sIn.focus();
  });
  const map = { 'df-dept': 'dept', 'df-active': 'active', 'df-category': 'category', 'df-cnh': 'cnh' };
  Object.keys(map).forEach(id => document.getElementById(id).addEventListener('change', (e) => {
    _filter[map[id]] = e.target.value; syncClear(); renderTable();
  }));
  document.getElementById('df-clear').addEventListener('click', () => {
    _filter = { search: _filter.search, dept: '', active: '', category: '', cnh: '' };
    fillFilters(); renderTable();
  });
  document.getElementById('btn-new-drv').addEventListener('click', () => openDriverModal());
  document.getElementById('btn-export-drv').addEventListener('click', exportList);
  document.getElementById('btn-print-drv').addEventListener('click', printDrivers);
  document.getElementById('drv-card').addEventListener('click', (e) => {
    if (e.target.closest('[data-new]')) { openDriverModal(); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'edit') openDriverModal(b.dataset.id);
    else if (b.dataset.act === 'delete') deleteDriver(b.dataset.id);
  });
}

async function reload() {
  await loadAll();
  fillFilters(); renderStats(); renderTable();
}

// =============================================================================
// FORMULÁRIO
// =============================================================================
const field = (label, input, { cls = '', req = false, help = '', name = '' } = {}) => `
  <div class="field ${cls}">
    <label class="field-label">${label}${req ? ' <span class="req">*</span>' : ''}</label>
    ${input}
    ${help ? `<span class="field-help">${help}</span>` : ''}
    ${name ? `<span class="field-error" data-err="${name}" hidden></span>` : ''}
  </div>`;
const text = (name, v, extra = '') => `<input class="input" name="${name}" value="${esc(v ?? '')}" ${extra}>`;
const date = (name, v, extra = '') => `<input class="input" type="date" name="${name}" value="${esc(v ?? '')}" ${extra}>`;
const select = (name, v, options, empty = '— Não informado —') => `
  <select class="select" name="${name}">
    ${empty != null ? `<option value="">${empty}</option>` : ''}
    ${options.map(([val, lab]) => `<option value="${esc(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${esc(lab)}</option>`).join('')}
  </select>`;

function group(key, title, d, names, body, open = false) {
  const filled = names.some(n => d?.[n] != null && d[n] !== '');
  return `
    <details class="drv-group" data-group="${key}" ${open || filled ? 'open' : ''}>
      <summary><span class="drv-group-title">${title}</span><span class="drv-group-hint" data-hint="${key}"></span></summary>
      <div class="drv-group-body">${body}</div>
    </details>`;
}

function openDriverModal(id) {
  const d = id ? _items.find(x => x.id === id) : null;
  const today = localToday();
  const courseOf = (k) => (d?.courses || []).find(c => c.kind === k);
  // Usuário de secretaria só cadastra na sua ou sem secretaria
  const depts = _userDept ? _depts.filter(x => x.id === _userDept) : _depts;

  const body = `
    <form id="drv-form" autocomplete="off" novalidate>
      <div class="crlv-box" style="margin-bottom:var(--s-4)">
        <span class="crlv-icon">${icons.fileUp}</span>
        <div class="crlv-text">
          <strong>Preencher pela CNH Digital</strong>
          <span>Selecione o PDF da CNH Digital (app Carteira Digital de Trânsito ou gov.br). O arquivo é lido no próprio aparelho e não é enviado nem guardado.</span>
        </div>
        <label class="btn btn-outline btn-sm crlv-btn" id="cnh-btn">
          <span class="crlv-btn-label">Selecionar PDF</span>
          <input type="file" id="cnh-file" accept="application/pdf,.pdf" hidden>
        </label>
      </div>
      <div id="cnh-result"></div>
      <div class="drv-fields">
        ${field('Nome completo', text('full_name', d?.full_name, 'maxlength="120" required'), { cls: 'drv-col-2', req: true, name: 'full_name' })}
        ${field('CPF', text('cpf', d ? fmtCPF(d.cpf) : '', 'inputmode="numeric" maxlength="14" placeholder="000.000.000-00" required'), { req: true, name: 'cpf' })}
        ${field('Secretaria', select('department_id', d?.department_id, depts.map(x => [x.id, `${x.acronym} — ${x.name}`]), 'Todas (sem secretaria)'),
          { cls: 'drv-col-2', help: 'Motorista sem secretaria pode ser escolhido em qualquer uma.' })}
        ${field('Situação', select('active', d ? String(d.active) : 'true', [['true', 'Ativo'], ['false', 'Inativo']], null),
          { help: 'Inativo não aparece para escolha.' })}
      </div>

      ${group('cnh', 'CNH', d, ['cnh_number', 'cnh_category', 'cnh_expiry', 'cnh_first_issue', 'cnh_state', 'cnh_paid_activity', 'toxicology_expiry'], `
        <div class="drv-fields">
          ${field('Número do registro', text('cnh_number', d?.cnh_number, 'inputmode="numeric" maxlength="11" placeholder="11 dígitos"'), { name: 'cnh_number' })}
          ${field('Categoria', select('cnh_category', d?.cnh_category, CNH_CATEGORIES.map(c => [c, c])))}
          ${field('Validade', date('cnh_expiry', d?.cnh_expiry), { name: 'cnh_expiry' })}
          ${field('Primeira habilitação', date('cnh_first_issue', d?.cnh_first_issue, `max="${today}"`), { name: 'cnh_first_issue' })}
          ${field('UF emissora', select('cnh_state', d?.cnh_state, STATES.map(s => [s, s])))}
          ${field('Atividade remunerada (EAR)', select('cnh_paid_activity', d?.cnh_paid_activity == null ? '' : String(d.cnh_paid_activity), [['true', 'Sim'], ['false', 'Não']]))}
          ${field('Exame toxicológico: validade', date('toxicology_expiry', d?.toxicology_expiry), { help: 'Exigido nas categorias C, D e E.' })}
        </div>`, true)}

      <details class="drv-group" data-group="courses" ${(d?.courses || []).length ? 'open' : ''}>
        <summary><span class="drv-group-title">Cursos especializados</span><span class="drv-group-hint" data-hint="courses"></span></summary>
        <div class="drv-group-body drv-courses">
          <div class="drv-course drv-course-head"><span>Curso</span><span>Validade</span></div>
          ${Object.entries(COURSE_KINDS).map(([k, label]) => {
            const c = courseOf(k);
            return `
            <div class="drv-course">
              <label class="drv-course-check">
                <input type="checkbox" data-course="${k}" ${c ? 'checked' : ''}>
                <span>${esc(label)}</span>
              </label>
              <input class="input" type="date" data-course-expiry="${k}" value="${esc(c?.expiry || '')}"
                     ${c ? '' : 'disabled'} aria-label="Validade do curso ${esc(label)}" title="Validade do curso">
            </div>`;
          }).join('')}
        </div>
      </details>

      ${group('personal', 'Dados pessoais', d, ['rg', 'rg_issuer', 'birth_date', 'blood_type'], `
        <div class="drv-fields">
          ${field('RG', text('rg', d?.rg, 'maxlength="20"'))}
          ${field('Órgão emissor', text('rg_issuer', d?.rg_issuer, 'maxlength="20" placeholder="ex: SSP-PI"'))}
          ${field('Data de nascimento', date('birth_date', d?.birth_date, `max="${today}"`), { name: 'birth_date' })}
          ${field('Tipo sanguíneo', select('blood_type', d?.blood_type, BLOOD_TYPES.map(b => [b, b.replace('-', '−')])))}
        </div>`)}

      ${group('job', 'Vínculo', d, ['registration', 'job_title', 'employment_type', 'admission_date'], `
        <div class="drv-fields">
          ${field('Matrícula', text('registration', d?.registration, 'maxlength="30"'))}
          ${field('Cargo / função', text('job_title', d?.job_title, 'maxlength="80"'))}
          ${field('Vínculo', select('employment_type', d?.employment_type, Object.entries(EMPLOYMENT_TYPES)))}
          ${field('Data de admissão', date('admission_date', d?.admission_date, `max="${today}"`), { name: 'admission_date' })}
        </div>`)}

      ${group('contact', 'Contato e endereço', d, ['phone', 'phone2', 'email', 'address_street', 'address_number', 'address_district', 'address_city', 'address_zip', 'emergency_contact_name', 'emergency_contact_phone'], `
        <div class="drv-fields">
          ${field('Telefone', text('phone', d?.phone, 'type="tel" inputmode="tel" maxlength="15" placeholder="(00) 00000-0000"'), { name: 'phone' })}
          ${field('Telefone 2', text('phone2', d?.phone2, 'type="tel" inputmode="tel" maxlength="15" placeholder="(00) 00000-0000"'), { name: 'phone2' })}
          ${field('E-mail', text('email', d?.email, 'type="email" maxlength="120"'), { cls: 'drv-col-m', name: 'email' })}
          ${field('Endereço', text('address_street', d?.address_street, 'maxlength="120" placeholder="Rua, avenida…"'), { cls: 'drv-col-2' })}
          ${field('Número', text('address_number', d?.address_number, 'maxlength="10"'))}
          ${field('Bairro', text('address_district', d?.address_district, 'maxlength="80"'))}
          ${field('Cidade', text('address_city', d?.address_city, 'maxlength="80"'))}
          ${field('CEP', text('address_zip', d?.address_zip ? maskCEP(d.address_zip) : '', 'inputmode="numeric" maxlength="9" placeholder="00000-000"'), { name: 'address_zip' })}
          ${field('Contato de emergência', text('emergency_contact_name', d?.emergency_contact_name, 'maxlength="120" placeholder="Nome"'), { cls: 'drv-col-2' })}
          ${field('Telefone de emergência', text('emergency_contact_phone', d?.emergency_contact_phone, 'type="tel" inputmode="tel" maxlength="15" placeholder="(00) 00000-0000"'), { name: 'emergency_contact_phone' })}
        </div>`)}

      ${group('notes', 'Observações', d, ['notes'], `
        <div class="field">
          <textarea class="textarea" name="notes" rows="3" maxlength="500" aria-label="Observações">${esc(d?.notes || '')}</textarea>
        </div>`)}

      <div id="drv-error" class="login-error" style="display:none;margin-top:12px"></div>
    </form>`;

  const m = openModal({
    title: d ? 'Editar motorista' : 'Novo motorista',
    size: 'lg',
    body,
    footer: `<button class="btn btn-outline" data-cancel>Cancelar</button>
             <button class="btn btn-primary" id="drv-save">Salvar</button>`,
  });
  const form = m.querySelector('#drv-form');
  const el = (name) => form.querySelector(`[name="${name}"]`);

  // Máscaras
  const masks = { cpf: maskCPF, phone: maskPhone, phone2: maskPhone, emergency_contact_phone: maskPhone, address_zip: maskCEP, cnh_number: (v) => onlyDigits(v).slice(0, 11) };
  form.addEventListener('input', (e) => {
    const fn = masks[e.target.name];
    if (fn) e.target.value = fn(e.target.value);
    if (e.target.name) setError(e.target.name, '');
    e.target.classList?.remove('is-autofilled');   // campo vindo da CNH perde o destaque quando o usuário mexe
    hints();
  });

  // Preencher pela CNH Digital: lê o PDF no navegador e preenche o formulário.
  // Nada é salvo até o usuário clicar em Salvar.
  const cnhInput = m.querySelector('#cnh-file');
  cnhInput.addEventListener('change', async () => {
    const file = cnhInput.files?.[0];
    cnhInput.value = '';                  // permite escolher o mesmo arquivo de novo
    if (!file) return;
    const btn = m.querySelector('#cnh-btn'), label = btn.querySelector('.crlv-btn-label');
    const box = m.querySelector('#cnh-result');
    btn.classList.add('is-loading'); label.innerHTML = '<span class="spinner"></span> Lendo…';
    box.innerHTML = '';
    try {
      const data = await readCNH(file);
      if (!m.isConnected) return;
      box.innerHTML = applyCNH(data);
    } catch (e) {
      if (!m.isConnected) return;
      box.innerHTML = `<div class="nof-notice is-block crlv-result">
        <span class="nof-notice-icon">${icons.alert}</span>
        <div class="nof-notice-body"><strong>Não foi possível ler a CNH</strong><span>${esc(e?.message || String(e))}</span></div>
      </div>`;
    } finally {
      btn.classList.remove('is-loading'); label.textContent = 'Selecionar PDF';
    }
  });

  /** Preenche o formulário com o que foi lido e devolve o resumo (HTML). */
  function applyCNH(c) {
    const filledList = [], warnings = [];
    const set = (name, value, label, fmt = (v) => v) => {
      const input = el(name);
      if (!input || value == null || value === '') return;
      const val = String(fmt(value));
      if (input.tagName === 'SELECT' && ![...input.options].some(o => o.value === val)) return;
      input.value = val;
      input.classList.add('is-autofilled');
      setError(name, '');
      filledList.push(label);
    };
    if (d && c.cpf && d.cpf && c.cpf !== d.cpf) {
      warnings.push(`O CPF da CNH (${fmtCPF(c.cpf)}) é diferente do CPF deste cadastro (${fmtCPF(d.cpf)}). Confira se é a CNH da pessoa certa.`);
    }
    set('full_name', c.full_name, 'Nome');
    set('cpf', c.cpf, 'CPF', fmtCPF);
    set('cnh_number', c.cnh_number, 'Nº do registro');
    set('cnh_category', c.cnh_category, 'Categoria');
    set('cnh_expiry', c.cnh_expiry, 'Validade');
    set('cnh_first_issue', c.cnh_first_issue, 'Primeira habilitação');
    set('cnh_state', c.cnh_state, 'UF emissora');
    set('cnh_paid_activity', c.cnh_paid_activity == null ? '' : String(c.cnh_paid_activity), 'Atividade remunerada');
    set('birth_date', c.birth_date, 'Data de nascimento');
    set('rg', c.rg, 'RG');
    set('rg_issuer', c.rg_issuer, 'Órgão emissor');
    if (c.cnh_expiry && c.cnh_expiry < today) warnings.push(`CNH vencida em ${fmtDate(c.cnh_expiry)}.`);
    if (!c.cnh_number) warnings.push('Nº do registro não encontrado no PDF: preencha à mão.');
    // abre os grupos que receberam dados e atualiza "N preenchidos"
    ['cnh', 'personal'].forEach(k => { const g = form.querySelector(`[data-group="${k}"]`); if (g && [...g.querySelectorAll('.is-autofilled')].length) g.open = true; });
    hints();
    if (!filledList.length) {
      return `<div class="nof-notice is-block crlv-result">
        <span class="nof-notice-icon">${icons.alert}</span>
        <div class="nof-notice-body"><strong>Nenhum campo reconhecido</strong><span>O PDF foi lido, mas os campos da CNH não foram encontrados. Preencha à mão.</span></div>
      </div>`;
    }
    return `<div class="nof-notice is-ok crlv-result">
      <span class="nof-notice-icon">${icons.check}</span>
      <div class="nof-notice-body">
        <strong>${filledList.length} campo(s) preenchido(s) pela CNH</strong>
        <span>${esc(filledList.join(', '))}. Confira os campos destacados antes de salvar.</span>
        ${warnings.map(w => `<span class="crlv-warn">⚠️ ${esc(w)}</span>`).join('')}
      </div>
    </div>`;
  }
  form.addEventListener('change', (e) => {
    const k = e.target.dataset.course;
    if (k) {
      const exp = form.querySelector(`[data-course-expiry="${k}"]`);
      exp.disabled = !e.target.checked;
      if (!e.target.checked) exp.value = '';
    }
    hints();
  });

  function setError(name, msg) {
    const box = form.querySelector(`[data-err="${name}"]`);
    if (box) { box.textContent = msg; box.hidden = !msg; }
    el(name)?.classList.toggle('is-invalid', !!msg);
  }

  // "3 preenchidos" ao lado do título de cada grupo
  function hints() {
    form.querySelectorAll('.drv-group').forEach(g => {
      const key = g.dataset.group;
      let n;
      if (key === 'courses') n = form.querySelectorAll('[data-course]:checked').length;
      else n = [...g.querySelectorAll('[name]')].filter(i => i.value.trim() !== '').length;
      const label = key === 'courses' ? (n === 1 ? '1 curso' : `${n} cursos`) : (n === 1 ? '1 preenchido' : `${n} preenchidos`);
      g.querySelector('[data-hint]').textContent = n ? label : 'opcional';
    });
  }
  hints();

  function validate() {
    const errs = {};
    const v = (n) => el(n).value.trim();
    if (v('full_name').length < 3) errs.full_name = 'Informe o nome completo.';
    if (!v('cpf')) errs.cpf = 'Informe o CPF.';
    else if (!isValidCPF(v('cpf'))) errs.cpf = 'CPF inválido. Confira os números.';
    if (v('cnh_number') && v('cnh_number').length !== 11) errs.cnh_number = 'O registro da CNH tem 11 dígitos.';
    if (v('cnh_first_issue') && v('cnh_first_issue') > today) errs.cnh_first_issue = 'Não pode ser futura.';
    if (v('cnh_expiry') && v('cnh_first_issue') && v('cnh_expiry') < v('cnh_first_issue')) errs.cnh_expiry = 'Não pode ser anterior à primeira habilitação.';
    if (v('birth_date') && v('birth_date') > today) errs.birth_date = 'Não pode ser futura.';
    if (v('admission_date') && v('admission_date') > today) errs.admission_date = 'Não pode ser futura.';
    ['phone', 'phone2', 'emergency_contact_phone'].forEach(n => {
      const len = onlyDigits(v(n)).length;
      if (len && len !== 10 && len !== 11) errs[n] = 'Telefone com DDD: 10 ou 11 dígitos.';
    });
    if (v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) errs.email = 'E-mail inválido.';
    if (v('address_zip') && onlyDigits(v('address_zip')).length !== 8) errs.address_zip = 'O CEP tem 8 dígitos.';

    form.querySelectorAll('[data-err]').forEach(b => setError(b.dataset.err, errs[b.dataset.err] || ''));
    // abre todos os grupos com erro e leva o foco ao primeiro campo
    Object.keys(errs).forEach(n => { const g = el(n).closest('details'); if (g) g.open = true; });
    const first = Object.keys(errs)[0];
    if (first) {
      const input = el(first);
      input.focus();
      input.scrollIntoView({ block: 'center' });
    }
    return !first;
  }

  async function save() {
    const errBox = m.querySelector('#drv-error');
    errBox.style.display = 'none';
    if (!validate()) return;
    const v = (n) => el(n).value.trim();
    const bool = (n) => (v(n) === '' ? null : v(n) === 'true');
    const payload = {
      full_name: v('full_name'), cpf: onlyDigits(v('cpf')),
      rg: v('rg'), rg_issuer: v('rg_issuer'), birth_date: v('birth_date') || null, blood_type: v('blood_type') || null,
      registration: v('registration'), job_title: v('job_title'), employment_type: v('employment_type') || null,
      department_id: v('department_id') || null, admission_date: v('admission_date') || null,
      cnh_number: v('cnh_number') || null, cnh_category: v('cnh_category') || null,
      cnh_expiry: v('cnh_expiry') || null, cnh_first_issue: v('cnh_first_issue') || null,
      cnh_state: v('cnh_state') || null, cnh_paid_activity: bool('cnh_paid_activity'),
      toxicology_expiry: v('toxicology_expiry') || null,
      phone: v('phone'), phone2: v('phone2'), email: v('email'),
      address_street: v('address_street'), address_number: v('address_number'),
      address_district: v('address_district'), address_city: v('address_city'),
      address_zip: onlyDigits(v('address_zip')) || null,
      emergency_contact_name: v('emergency_contact_name'), emergency_contact_phone: v('emergency_contact_phone'),
      active: v('active') === 'true', notes: v('notes'),
    };
    const courses = [...form.querySelectorAll('[data-course]:checked')].map(c => ({
      kind: c.dataset.course,
      expiry: form.querySelector(`[data-course-expiry="${c.dataset.course}"]`).value || null,
    }));

    const btn = m.querySelector('#drv-save');
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando';
    let error = null;
    try {
      ({ error } = await withTimeout(supabase.rpc('save_driver', { p_id: d?.id || null, p_driver: payload, p_courses: courses })));
    } catch (e) { error = e; }
    if (error) {
      const msg = friendlyError(error);
      if (/CPF/.test(msg)) setError('cpf', msg);
      errBox.textContent = msg; errBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Salvar';
      errBox.scrollIntoView({ block: 'nearest' });
      return;
    }
    closeModal();
    toast(d ? 'Motorista atualizado.' : 'Motorista cadastrado.', 'success');
    await reload();
  }

  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#drv-save').addEventListener('click', save);
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

// =============================================================================
// EXCLUIR
// =============================================================================
async function deleteDriver(id) {
  const d = _items.find(x => x.id === id);
  if (!d) return;
  const ok = await confirmDialog({
    title: 'Excluir motorista',
    message: `Excluir ${d.full_name}? Esta ação não pode ser desfeita. Se o motorista já foi usado em alguma autorização, inative o cadastro em vez de excluir.`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.from('driver').delete().eq('id', id);
  if (error) { toast(friendlyError(error), 'error', 6000); return; }
  toast('Motorista excluído.', 'success');
  await reload();
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  if (isBillingMissing(err) && !/violates/.test(msg)) return 'Banco de dados ainda não atualizado. Execute o apply.sql no Supabase.';
  if (err?.code === '23505' || /ux_driver_cpf|duplicate key/i.test(msg)) return 'Já existe um motorista com este CPF.';
  if (err?.code === '23503' || /foreign key/i.test(msg)) return 'Este motorista já foi usado em autorização ou abastecimento e não pode ser excluído. Marque como Inativo.';
  if (/row-level security/i.test(msg)) return 'Você só pode cadastrar e alterar motoristas da sua secretaria ou sem secretaria.';
  if (/chk_driver_cpf/.test(msg)) return 'CPF inválido.';
  if (/chk_driver_cnh_number/.test(msg)) return 'O registro da CNH tem 11 dígitos.';
  if (/chk_driver_cnh_dates/.test(msg)) return 'A validade da CNH não pode ser anterior à primeira habilitação.';
  if (/chk_driver_zip/.test(msg)) return 'O CEP tem 8 dígitos.';
  if (/chk_driver_/.test(msg)) return 'Há um campo com valor inválido. Confira o formulário.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão. Verifique a internet e tente de novo.';
  return msg;
}

// =============================================================================
// EXCEL E IMPRESSÃO (respeitam busca e filtros)
// =============================================================================
const yesNo = (b) => (b == null ? '' : b ? 'Sim' : 'Não');
const courseText = (d) => (d.courses || [])
  .map(c => COURSE_KINDS[c.kind] + (c.expiry ? ` (até ${fmtDate(c.expiry)})` : '')).join(' | ');

function exportList() {
  const list = applyFilters();
  if (!list.length) { toast('Nenhum motorista para exportar com os filtros atuais.', 'warning'); return; }
  try {
    exportXLSX({
      filename: timestampFilename('motoristas'),
      sheetName: 'Motoristas',
      columns: ['Nome', 'CPF', 'RG', 'Órgão emissor', 'Nascimento', 'Tipo sanguíneo',
                'Matrícula', 'Cargo / função', 'Vínculo', 'Secretaria (sigla)', 'Secretaria (nome)', 'Admissão',
                'CNH nº', 'Categoria', 'Validade CNH', 'Situação da CNH', 'Primeira habilitação', 'UF', 'EAR', 'Toxicológico: validade',
                'Cursos', 'Telefone', 'Telefone 2', 'E-mail', 'Endereço', 'Número', 'Bairro', 'Cidade', 'CEP',
                'Contato de emergência', 'Telefone de emergência', 'Situação', 'Observações', 'ID'],
      rows: list.map(d => [
        d.full_name, fmtCPF(d.cpf), d.rg || '', d.rg_issuer || '', d.birth_date ? fmtDate(d.birth_date) : '', d.blood_type || '',
        d.registration || '', d.job_title || '', EMPLOYMENT_TYPES[d.employment_type] || '',
        d.department?.acronym || '', d.department?.name || '', d.admission_date ? fmtDate(d.admission_date) : '',
        d.cnh_number || '', d.cnh_category || '', d.cnh_expiry ? fmtDate(d.cnh_expiry) : '', CNH_STATUS[cnhStatus(d)].label,
        d.cnh_first_issue ? fmtDate(d.cnh_first_issue) : '', d.cnh_state || '', yesNo(d.cnh_paid_activity),
        d.toxicology_expiry ? fmtDate(d.toxicology_expiry) : '',
        courseText(d), d.phone || '', d.phone2 || '', d.email || '',
        d.address_street || '', d.address_number || '', d.address_district || '', d.address_city || '',
        d.address_zip ? maskCEP(d.address_zip) : '',
        d.emergency_contact_name || '', d.emergency_contact_phone || '',
        d.active ? 'Ativo' : 'Inativo', d.notes || '', d.id,
      ]),
    });
    toast(`${list.length} motorista(s) exportado(s).`, 'success');
  } catch (e) {
    toast('Erro ao exportar: ' + e.message, 'error');
  }
}

async function printDrivers() {
  const list = applyFilters();
  if (!list.length) { toast('Nenhum motorista para imprimir com os filtros atuais.', 'warning'); return; }
  await printList({
    title: 'Relação de Motoristas',
    filtersLabel: filtersLabel(),
    columns: ['Nome', 'Matrícula', 'CPF', 'Secretaria', 'Cargo / função', 'CNH nº', 'Cat.', 'Validade CNH', 'Situação da CNH', 'Cursos', 'Telefone', 'Situação'],
    colHints: ['', 'mono', 'mono', '', '', 'mono', '', '', '', 'wrap', '', ''],
    rows: list.map(d => [
      d.full_name, d.registration || '—', hideCPF(d.cpf), d.department?.acronym || 'Todas', d.job_title || '—',
      d.cnh_number || '—', d.cnh_category || '—', d.cnh_expiry ? fmtDate(d.cnh_expiry) : '—',
      CNH_STATUS[cnhStatus(d)].label + (toxicologyExpired(d) ? ' · toxicológico vencido' : ''),
      courseText(d) || '—', d.phone || '—', d.active ? 'Ativo' : 'Inativo',
    ]),
  });
}
