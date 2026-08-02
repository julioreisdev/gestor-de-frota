import { pageRoot, pageHeader } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, toast, openModal, closeModal, confirmDialog, formValues } from '../ui.js';
import { icons } from '../icons.js';
import { isAdmin } from '../auth.js';

let _items = [];
let _users = [];  // usuários com role='usuario' (candidatos a responsáveis)
let _searchTerm = '';

export async function renderSecretarias() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Secretarias',
      subtitle: 'Órgãos e secretarias da entidade.',
      actionsHtml: `<button class="btn btn-primary" id="btn-new-dept">
        <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span>
        Nova secretaria
      </button>`,
    })}
    <div class="card">
      <div class="table-toolbar">
        <div class="search ${_searchTerm ? 'has-value' : ''}" id="dept-search-box">
          ${icons.search}
          <input id="dept-search" type="search"
                 placeholder="Buscar por sigla, nome, responsável…"
                 autocomplete="off" value="${esc(_searchTerm)}">
          <button class="clear" id="dept-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="dept-count"></div>
      </div>
      <div id="dept-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  document.getElementById('btn-new-dept').addEventListener('click', () => openDeptModal());

  const input = document.getElementById('dept-search');
  const clearBtn = document.getElementById('dept-search-clear');
  const box = document.getElementById('dept-search-box');
  input.addEventListener('input', (e) => {
    _searchTerm = e.target.value || '';
    box.classList.toggle('has-value', !!_searchTerm);
    renderTable();
  });
  clearBtn.addEventListener('click', () => {
    _searchTerm = '';
    input.value = '';
    box.classList.remove('has-value');
    renderTable();
    input.focus();
  });

  await loadAll();
  renderTable();
}

async function loadAll() {
  const [d, u] = await Promise.all([
    supabase.from('department')
      .select('id, name, acronym, cost_center, responsible_name, phone, email, created_at, responsible_user_id')
      .order('acronym'),
    // Lista de candidatos a responsável (usuários ativos com role 'usuario' ou 'admin').
    // Usa RPC admin_list_users pois só admin acessa essa página.
    supabase.rpc('admin_list_users'),
  ]);
  if (d.error) { toast('Falha ao carregar secretarias: ' + d.error.message, 'error'); _items = []; }
  else _items = d.data || [];
  if (u.error) { _users = []; }
  else _users = (u.data || []).filter(x => x.active && (x.role === 'usuario' || x.role === 'admin'));
}

function matchesSearch(d, t) {
  if (!t) return true;
  const term = t.toLowerCase();
  return (d.acronym || '').toLowerCase().includes(term)
      || (d.name || '').toLowerCase().includes(term)
      || (d.responsible_name || '').toLowerCase().includes(term)
      || (d.cost_center || '').toLowerCase().includes(term)
      || (d.email || '').toLowerCase().includes(term);
}

function renderTable() {
  const box = document.getElementById('dept-tablebox');
  const countEl = document.getElementById('dept-count');

  if (!_items.length) {
    if (countEl) countEl.textContent = '';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.briefcase}</div>
        <div class="empty-state-title">Nenhuma secretaria cadastrada</div>
        <p class="empty-state-text">Clique em "Nova secretaria" para criar a primeira.</p>
      </div>`;
    return;
  }

  const filtered = _items.filter(d => matchesSearch(d, _searchTerm));
  if (countEl) {
    countEl.textContent = _searchTerm
      ? `${filtered.length} de ${_items.length} secretaria(s)`
      : `${_items.length} secretaria(s)`;
  }

  if (!filtered.length) {
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.search}</div>
        <div class="empty-state-title">Nenhum resultado</div>
        <p class="empty-state-text">Nada encontrado para "<strong>${esc(_searchTerm)}</strong>".</p>
      </div>`;
    return;
  }

  box.innerHTML = `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            <th>Sigla</th>
            <th>Nome</th>
            <th>Centro de custo</th>
            <th>Responsável</th>
            <th>Contato</th>
            <th class="actions-col">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(deptRow).join('')}
        </tbody>
      </table>
    </div>
  `;
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openDeptModal(b.dataset.id)));
  box.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteDept(b.dataset.id)));
}

function deptRow(d) {
  const phoneHtml = d.phone
    ? `<span>${esc(d.phone)}</span>`
    : '';
  const emailHtml = d.email
    ? `<a href="mailto:${esc(d.email)}" style="color:var(--primary);text-decoration:none">${esc(d.email)}</a>`
    : '';
  const contato = (phoneHtml || emailHtml)
    ? `<div class="cell-stack">${phoneHtml}${emailHtml}</div>`
    : '<span style="color:var(--text-muted)">—</span>';
  return `
    <tr>
      <td data-label="Sigla"><span class="badge">${esc(d.acronym)}</span></td>
      <td data-label="Nome">${esc(d.name)}</td>
      <td data-label="Centro de custo" style="color:var(--text-soft)">${esc(d.cost_center || '—')}</td>
      <td data-label="Responsável">${esc(d.responsible_name || '—')}</td>
      <td data-label="Contato" style="font-size:12.5px;color:var(--text-soft)">${contato}</td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" data-id="${d.id}" title="Editar">${icons.edit}</button>
          ${isAdmin() ? `<button class="btn btn-ghost btn-icon btn-sm" data-act="delete" data-id="${d.id}" title="Excluir" style="color:var(--danger)">${icons.trash}</button>` : ''}
        </div>
      </td>
    </tr>`;
}

function openDeptModal(id) {
  const editing = !!id;
  const d = editing ? _items.find(x => x.id === id) : null;
  const body = `
    <form id="dept-form" autocomplete="off">
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Sigla <span class="req">*</span></label>
          <input class="input" name="acronym" required minlength="2" maxlength="10"
                 pattern="[A-Z0-9]+" value="${esc(d?.acronym || '')}"
                 placeholder="ex: SMS"
                 oninput="this.value=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')">
          <span class="field-help">2 a 10 caracteres maiúsculos ou números.</span>
        </div>
        <div class="field">
          <label class="field-label">Centro de custo</label>
          <input class="input" name="cost_center" value="${esc(d?.cost_center || '')}"
                 placeholder="ex: 02.001">
        </div>
        <div class="field col-full">
          <label class="field-label">Nome <span class="req">*</span></label>
          <input class="input" name="name" required minlength="3" maxlength="120"
                 value="${esc(d?.name || '')}"
                 placeholder="ex: Secretaria Municipal de Saúde">
        </div>
        <div class="field">
          <label class="field-label">Responsável</label>
          <input class="input" name="responsible_name" value="${esc(d?.responsible_name || '')}"
                 placeholder="Nome do gestor">
        </div>
        <div class="field">
          <label class="field-label">Telefone</label>
          <input class="input" name="phone" type="tel" value="${esc(d?.phone || '')}"
                 placeholder="(89) 3456-7890">
        </div>
        <div class="field col-full">
          <label class="field-label">E-mail</label>
          <input class="input" name="email" type="email" value="${esc(d?.email || '')}"
                 placeholder="saude@municipio.pi.gov.br">
        </div>
        <div class="field col-full">
          <label class="field-label">Usuário responsável (login)</label>
          <select class="select" name="responsible_user_id">
            <option value="">— Sem responsável vinculado —</option>
            ${_users.map(u => `<option value="${u.id}" ${d?.responsible_user_id === u.id ? 'selected' : ''}>${esc(u.full_name)} (${esc(u.username)})</option>`).join('')}
          </select>
          <span class="field-help">Quando vinculado, esse usuário só verá os veículos/abastecimentos/manutenções desta secretaria. Admin sempre vê tudo.</span>
        </div>
      </div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="dept-save-btn">${editing ? 'Salvar alterações' : 'Criar secretaria'}</button>
  `;
  const m = openModal({
    title: editing ? 'Editar secretaria' : 'Nova secretaria',
    body, footer, size: 'lg',
  });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#dept-save-btn').addEventListener('click', () => saveDept(editing ? id : null));
}

async function saveDept(id) {
  const form = document.getElementById('dept-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const v = formValues(form);
  const payload = {
    acronym: (v.acronym || '').trim().toUpperCase(),
    name: (v.name || '').trim(),
    cost_center: (v.cost_center || '').trim() || null,
    responsible_name: (v.responsible_name || '').trim() || null,
    phone: (v.phone || '').trim() || null,
    email: (v.email || '').trim() || null,
  };

  const btn = document.getElementById('dept-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    let error;
    let resultId = id;
    if (id) {
      ({ error } = await supabase.from('department').update(payload).eq('id', id));
    } else {
      const { data, error: insErr } = await supabase.from('department').insert(payload).select('id').single();
      error = insErr;
      resultId = data?.id;
    }
    if (error) throw error;

    // Vincula responsável (RPC sincroniza dos 2 lados: department.responsible_user_id
    // e app_user.department_id). Roda mesmo quando user vazio (pra desvincular).
    const respUserId = v.responsible_user_id || null;
    if (resultId) {
      const { error: rpcErr } = await supabase.rpc('admin_set_department_responsible', {
        p_dept_id: resultId,
        p_user_id: respUserId,
      });
      if (rpcErr) throw rpcErr;
    }

    toast(id ? 'Secretaria atualizada.' : 'Secretaria criada.', 'success');
    closeModal();
    await loadAll();
    renderTable();
  } catch (err) {
    toast(friendlyError(err), 'error');
    btn.disabled = false;
    btn.textContent = id ? 'Salvar alterações' : 'Criar secretaria';
  }
}

async function deleteDept(id) {
  const d = _items.find(x => x.id === id);
  if (!d) return;
  const ok = await confirmDialog({
    title: 'Excluir secretaria',
    message: `Excluir "${d.acronym} — ${d.name}"? Esta ação não pode ser desfeita.`,
    confirmText: 'Excluir',
    danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.from('department').delete().eq('id', id);
  if (error) { toast(friendlyError(error), 'error'); return; }
  toast('Secretaria excluída.', 'success');
  await loadAll();
  renderTable();
}

function friendlyError(err) {
  const msg = err?.message || String(err);
  // unique violation no acronym (chave composta única)
  if (err?.code === '23505' || /duplicate key|already exists|unique/i.test(msg)) {
    return 'Já existe uma secretaria com essa sigla.';
  }
  // foreign key violation (veículos/fornecedores vinculados)
  if (err?.code === '23503' || /foreign key|violates/i.test(msg)) {
    return 'Não é possível excluir: há veículos ou fornecedores vinculados a esta secretaria.';
  }
  return msg;
}
