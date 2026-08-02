import { pageRoot, pageHeader } from '../shell.js';
import { supabase } from '../supabase.js';
import { esc, fmtDate, toast, openModal, closeModal, confirmDialog, formValues } from '../ui.js';
import { icons } from '../icons.js';
import { getProfile } from '../auth.js';

const ROLE_LABEL = { admin: 'Administrador', usuario: 'Usuário', fornecedor: 'Fornecedor' };
const ROLE_BADGE = { admin: 'badge', usuario: 'badge badge-success', fornecedor: 'badge badge-warning' };

let _users = [];
let _suppliers = [];
let _searchTerm = '';

export async function renderUsuarios() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Usuários',
      subtitle: 'Gerencie quem acessa o sistema e suas permissões.',
      actionsHtml: `<button class="btn btn-primary" id="btn-new-user">
        <span style="width:16px;height:16px;display:inline-flex">${icons.plus}</span>
        Novo usuário
      </button>`,
    })}
    <div class="card">
      <div class="table-toolbar">
        <div class="search ${_searchTerm ? 'has-value' : ''}" id="users-search-box">
          ${icons.search}
          <input id="users-search" type="search" placeholder="Buscar por usuário, nome ou e-mail…"
                 autocomplete="off" value="${esc(_searchTerm)}">
          <button class="clear" id="users-search-clear" aria-label="Limpar busca">${icons.close}</button>
        </div>
        <div class="count" id="users-count"></div>
      </div>
      <div id="users-tablebox">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>
    </div>
  `;

  document.getElementById('btn-new-user').addEventListener('click', () => openUserModal());

  const input = document.getElementById('users-search');
  const clearBtn = document.getElementById('users-search-clear');
  const box = document.getElementById('users-search-box');
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

function matchesSearch(u, t) {
  if (!t) return true;
  const term = t.toLowerCase();
  return (u.username || '').toLowerCase().includes(term)
      || (u.full_name || '').toLowerCase().includes(term)
      || (u.email || '').toLowerCase().includes(term);
}

async function loadAll() {
  const [u, s] = await Promise.all([
    supabase.rpc('admin_list_users'),
    supabase.from('supplier').select('id, trade_name, legal_name').order('legal_name'),
  ]);
  if (u.error) { toast('Falha ao carregar usuários: ' + u.error.message, 'error'); _users = []; }
  else _users = u.data || [];
  _suppliers = s.data || [];
}

function renderTable() {
  const me = getProfile();
  const box = document.getElementById('users-tablebox');
  const countEl = document.getElementById('users-count');

  // estado completamente vazio (sem cadastros)
  if (!_users.length) {
    if (countEl) countEl.textContent = '';
    box.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.users}</div>
        <div class="empty-state-title">Nenhum usuário cadastrado</div>
        <p class="empty-state-text">Clique em "Novo usuário" para criar o primeiro acesso.</p>
      </div>`;
    return;
  }

  const filtered = _users.filter(u => matchesSearch(u, _searchTerm));
  if (countEl) {
    countEl.textContent = _searchTerm
      ? `${filtered.length} de ${_users.length} usuário(s)`
      : `${_users.length} usuário(s)`;
  }

  // busca sem resultado
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
            <th>Usuário</th>
            <th>Nome</th>
            <th>E-mail</th>
            <th>Perfil</th>
            <th>Status</th>
            <th>Acesso até</th>
            <th class="actions-col">Ações</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(u => userRow(u, me)).join('')}
        </tbody>
      </table>
    </div>
  `;
  box.querySelectorAll('[data-act="edit"]').forEach(b => b.addEventListener('click', () => openUserModal(b.dataset.id)));
  box.querySelectorAll('[data-act="toggle"]').forEach(b => b.addEventListener('click', () => toggleActive(b.dataset.id)));
  box.querySelectorAll('[data-act="password"]').forEach(b => b.addEventListener('click', () => openPasswordModal(b.dataset.id)));
  box.querySelectorAll('[data-act="delete"]').forEach(b => b.addEventListener('click', () => deleteUser(b.dataset.id)));
}

function userRow(u, me) {
  const isMe = me && u.id === me.id;
  const statusBadge = u.active
    ? `<span class="badge badge-success">Ativo</span>`
    : `<span class="badge badge-neutral">Inativo</span>`;
  return `
    <tr>
      <td data-label="Usuário"><strong>${esc(u.username)}</strong></td>
      <td data-label="Nome">${esc(u.full_name)}${isMe ? ' <span class="badge badge-neutral" style="margin-left:6px">você</span>' : ''}</td>
      <td data-label="E-mail" style="color:var(--text-soft);font-size:12.5px">${esc(u.email || '—')}</td>
      <td data-label="Perfil"><span class="${ROLE_BADGE[u.role] || 'badge'}">${esc(ROLE_LABEL[u.role] || u.role)}</span></td>
      <td data-label="Status">${statusBadge}</td>
      <td data-label="Acesso até">${u.access_end ? fmtDate(u.access_end) : '<span style="color:var(--text-muted)">sem limite</span>'}</td>
      <td class="actions-col">
        <div class="actions-row">
          <button class="btn btn-ghost btn-icon btn-sm" data-act="password" data-id="${u.id}" title="Redefinir senha">${icons.key}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="toggle" data-id="${u.id}" title="${u.active ? 'Desativar' : 'Ativar'}" ${isMe ? 'disabled' : ''}>${icons.power}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="edit" data-id="${u.id}" title="Editar">${icons.edit}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-act="delete" data-id="${u.id}" title="Excluir" style="color:var(--danger)" ${isMe ? 'disabled' : ''}>${icons.trash}</button>
        </div>
      </td>
    </tr>`;
}

function openUserModal(id) {
  const editing = !!id;
  const u = editing ? _users.find(x => x.id === id) : null;
  const supplierOptions = `
    <option value="">— Nenhum —</option>
    ${_suppliers.map(s => `<option value="${s.id}" ${u?.supplier_id === s.id ? 'selected' : ''}>${esc(s.trade_name || s.legal_name)}</option>`).join('')}
  `;
  const body = `
    <form id="user-form" autocomplete="off">
      <input type="text" name="fake-u" style="display:none" tabindex="-1" autocomplete="off">
      <input type="password" name="fake-p" style="display:none" tabindex="-1" autocomplete="off">
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Usuário (login) <span class="req">*</span></label>
          <input class="input" name="username" required minlength="3" maxlength="30"
                 pattern="[a-z0-9._\\-]+" value="${esc(u?.username || '')}"
                 autocomplete="off"
                 ${editing ? 'readonly' : 'placeholder="ex: joao.silva"'}>
          <span class="field-help">Só letras minúsculas, números, ponto, hífen e underline.</span>
        </div>
        <div class="field">
          <label class="field-label">Nome completo <span class="req">*</span></label>
          <input class="input" name="full_name" required value="${esc(u?.full_name || '')}" autocomplete="off">
        </div>
        ${editing ? `
        <div class="field col-full">
          <label class="field-label">E-mail</label>
          <input class="input" value="${esc(u?.email || '')}" readonly>
          <span class="field-help">Para alterar o e-mail, exclua e recadastre o usuário.</span>
        </div>
        ` : `
        <div class="field">
          <label class="field-label">E-mail <span class="req">*</span></label>
          <input class="input" name="email" type="email" required placeholder="usuario@dominio.com" autocomplete="off">
        </div>
        <div class="field">
          <label class="field-label">Senha inicial <span class="req">*</span></label>
          <input class="input" name="password" type="password" required minlength="6" placeholder="mínimo 6 caracteres" autocomplete="new-password">
        </div>
        `}
        <div class="field">
          <label class="field-label">Perfil <span class="req">*</span></label>
          <select class="select" name="role" required id="user-role-select">
            <option value="admin"      ${u?.role === 'admin' ? 'selected' : ''}>Administrador</option>
            <option value="usuario"    ${u?.role === 'usuario' ? 'selected' : ''}>Usuário</option>
            <option value="fornecedor" ${u?.role === 'fornecedor' ? 'selected' : ''}>Fornecedor</option>
          </select>
        </div>
        <div class="field" id="supplier-field" style="${u?.role === 'fornecedor' ? '' : 'display:none'}">
          <label class="field-label">Fornecedor vinculado <span class="req">*</span></label>
          <select class="select" name="supplier_id">${supplierOptions}</select>
          <span class="field-help">Obrigatório para perfil Fornecedor.</span>
        </div>
        <div class="field">
          <label class="field-label">Acesso a partir de</label>
          <input class="input" name="access_start" type="date" value="${u?.access_start || ''}">
        </div>
        <div class="field">
          <label class="field-label">Acesso até</label>
          <input class="input" name="access_end" type="date" value="${u?.access_end || ''}">
        </div>
        <div class="field col-full">
          <label class="field-label">Limite mensal de autorização (R$)</label>
          <input class="input" name="monthly_authorization_limit" type="number" min="0" step="0.01"
                 value="${u?.monthly_authorization_limit ?? 0}">
          <span class="field-help">0 = sem limite. Aplicável a autorizações emitidas no mês.</span>
        </div>
      </div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="user-save-btn">${editing ? 'Salvar alterações' : 'Criar usuário'}</button>
  `;
  const m = openModal({ title: editing ? 'Editar usuário' : 'Novo usuário', body, footer, size: 'lg' });

  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#user-role-select').addEventListener('change', (e) => {
    m.querySelector('#supplier-field').style.display = e.target.value === 'fornecedor' ? '' : 'none';
  });
  m.querySelector('#user-save-btn').addEventListener('click', () => saveUser(editing ? id : null));
}

async function saveUser(id) {
  const form = document.getElementById('user-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const v = formValues(form);
  v.username = (v.username || '').toLowerCase();
  v.monthly_authorization_limit = Number(v.monthly_authorization_limit || 0);
  v.access_start = v.access_start || null;
  v.access_end = v.access_end || null;
  v.supplier_id = v.role === 'fornecedor' ? (v.supplier_id || null) : null;
  if (v.role === 'fornecedor' && !v.supplier_id) {
    toast('Selecione um fornecedor para o perfil Fornecedor.', 'error'); return;
  }

  const btn = document.getElementById('user-save-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando...';

  try {
    if (id) {
      const { error } = await supabase.from('app_user').update({
        full_name: v.full_name,
        role: v.role,
        supplier_id: v.supplier_id,
        access_start: v.access_start,
        access_end: v.access_end,
        monthly_authorization_limit: v.monthly_authorization_limit,
      }).eq('id', id);
      if (error) throw error;
      toast('Usuário atualizado.', 'success');
    } else {
      const { error } = await supabase.rpc('admin_create_user', {
        p_email: v.email,
        p_password: v.password,
        p_username: v.username,
        p_full_name: v.full_name,
        p_role: v.role,
        p_supplier_id: v.supplier_id,
        p_access_start: v.access_start,
        p_access_end: v.access_end,
        p_monthly_authorization_limit: v.monthly_authorization_limit,
      });
      if (error) throw error;
      toast('Usuário criado com sucesso.', 'success');
    }
    closeModal();
    await loadAll(); renderTable();
  } catch (err) {
    toast(err.message || 'Erro ao salvar.', 'error');
    btn.disabled = false;
    btn.textContent = id ? 'Salvar alterações' : 'Criar usuário';
  }
}

async function toggleActive(id) {
  const u = _users.find(x => x.id === id);
  if (!u) return;
  const ok = await confirmDialog({
    title: u.active ? 'Desativar usuário' : 'Ativar usuário',
    message: `Confirma ${u.active ? 'desativar' : 'ativar'} o usuário "${u.username}"?`,
    confirmText: u.active ? 'Desativar' : 'Ativar',
    danger: u.active,
  });
  if (!ok) return;
  const { error } = await supabase.from('app_user').update({ active: !u.active }).eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Status atualizado.', 'success');
  await loadAll(); renderTable();
}

async function deleteUser(id) {
  const u = _users.find(x => x.id === id);
  if (!u) return;
  const ok = await confirmDialog({
    title: 'Excluir usuário',
    message: `Excluir definitivamente "${u.username}"? Esta ação não pode ser desfeita.`,
    confirmText: 'Excluir', danger: true,
  });
  if (!ok) return;
  const { error } = await supabase.rpc('admin_delete_user', { p_user_id: id });
  if (error) { toast(err_msg(error), 'error'); return; }
  toast('Usuário excluído.', 'success');
  await loadAll(); renderTable();
}

function openPasswordModal(id) {
  const u = _users.find(x => x.id === id);
  if (!u) return;
  const body = `
    <p style="font-size:13px;color:var(--text-soft);margin-bottom:var(--s-4)">
      Defina a nova senha para <strong>${esc(u.username)}</strong>. Anote e repasse ao usuário —
      por segurança, ela não é exibida novamente.
    </p>
    <form id="pwd-form" autocomplete="off">
      <input type="text" name="fake-u" style="display:none" tabindex="-1">
      <input type="password" name="fake-p" style="display:none" tabindex="-1">
      <div class="field">
        <label class="field-label">Nova senha <span class="req">*</span></label>
        <input class="input" name="password" type="password" required minlength="6"
               placeholder="mínimo 6 caracteres" autocomplete="new-password">
      </div>
      <div class="field" style="margin-top:var(--s-3)">
        <label class="field-label">Confirmar senha <span class="req">*</span></label>
        <input class="input" name="password2" type="password" required minlength="6" autocomplete="new-password">
      </div>
    </form>
  `;
  const footer = `
    <button class="btn btn-outline" data-cancel>Cancelar</button>
    <button class="btn btn-primary" id="pwd-save-btn">Definir senha</button>
  `;
  const m = openModal({ title: 'Redefinir senha', body, footer });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#pwd-save-btn').addEventListener('click', () => savePassword(id));
}

async function savePassword(id) {
  const form = document.getElementById('pwd-form');
  if (!form.checkValidity()) { form.reportValidity(); return; }
  const v = formValues(form);
  if (v.password !== v.password2) { toast('Senhas não coincidem.', 'error'); return; }
  const btn = document.getElementById('pwd-save-btn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Salvando...';
  const { error } = await supabase.rpc('admin_set_user_password', {
    p_user_id: id, p_new_password: v.password,
  });
  if (error) {
    toast(err_msg(error), 'error');
    btn.disabled = false; btn.textContent = 'Definir senha';
    return;
  }
  toast('Senha redefinida.', 'success');
  closeModal();
}

function err_msg(error) {
  return error?.message || 'Erro desconhecido';
}
