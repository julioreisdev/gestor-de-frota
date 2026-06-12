// Shell autenticado: sidebar + topbar + breadcrumb + area de conteúdo.
import { icons, iconSpan } from './icons.js';
import { logout, getProfile } from './auth.js';
import { APP_NAME, APP_FAVICON } from './config.js';
import { navigate, currentPath } from './router.js';
import { esc, confirmDialog } from './ui.js';
import { supabase } from './supabase.js';
import { canInstall, install, onInstallStateChange } from './pwa.js';

// Catálogo de páginas — único lugar onde definir nav + permissões + breadcrumb
export const NAV = [
  { path: '/dashboard',      label: 'Dashboard',        icon: 'dashboard',  roles: ['admin','usuario','fornecedor'] },
  { group: 'Cadastros' },
  { path: '/entidade',       label: 'Entidade',         icon: 'shield',     roles: ['admin','usuario'] },
  { path: '/usuarios',       label: 'Usuários',         icon: 'users',      roles: ['admin'] },
  { path: '/secretarias',    label: 'Secretarias',      icon: 'briefcase',  roles: ['admin'] },
  { path: '/veiculos',       label: 'Veículos',         icon: 'car',        roles: ['admin','usuario'] },
  { path: '/fornecedores',   label: 'Fornecedores',     icon: 'store',      roles: ['admin','usuario'] },
  { group: 'Operação' },
  { path: '/autorizacoes',   label: 'Autorizações',     icon: 'clipboard',  roles: ['admin','usuario','fornecedor'] },
  { path: '/abastecimentos', label: 'Abastecimentos',   icon: 'droplet',    roles: ['admin','usuario'] },
  { path: '/manutencoes',    label: 'Manutenções',      icon: 'wrench',     roles: ['admin','usuario'] },
  { group: 'Análise' },
  { path: '/relatorios',     label: 'Relatórios',       icon: 'barChart',   roles: ['admin','usuario'] },
  { path: '/exportacao',     label: 'Exportação TCE',   icon: 'download',   roles: ['admin','usuario'] },
];

// Breadcrumb por rota
const BREADCRUMB = {
  '/dashboard':      [{ label: 'Dashboard' }],
  '/entidade':       [{ label: 'Cadastros' }, { label: 'Entidade' }],
  '/usuarios':       [{ label: 'Cadastros' }, { label: 'Usuários' }],
  '/secretarias':    [{ label: 'Cadastros' }, { label: 'Secretarias' }],
  '/veiculos':       [{ label: 'Cadastros' }, { label: 'Veículos' }],
  '/fornecedores':   [{ label: 'Cadastros' }, { label: 'Fornecedores' }],
  '/autorizacoes':   [{ label: 'Operação' }, { label: 'Autorizações' }],
  '/abastecimentos': [{ label: 'Operação' }, { label: 'Abastecimentos' }],
  '/manutencoes':    [{ label: 'Operação' }, { label: 'Manutenções' }],
  '/relatorios':     [{ label: 'Análise' }, { label: 'Relatórios' }],
  '/exportacao':     [{ label: 'Análise' }, { label: 'Exportação TCE' }],
};

let _entityCache = null;

export async function getEntity() {
  if (_entityCache) return _entityCache;
  const { data } = await supabase
    .from('entity')
    .select('id, entity_type, ibge_code, organ_name, coat_of_arms_url, default_ref_month')
    .maybeSingle();
  _entityCache = data;
  return data;
}

function userInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[parts.length - 1]?.[0] || '')).toUpperCase();
}

export async function renderShell() {
  const root = document.getElementById('app-root');
  const profile = getProfile();
  const entity = await getEntity();

  const userName = profile?.full_name || 'Usuário';
  const userRole = profile?.role || '';
  const allowedRoles = profile?.role || 'admin';

  const navItems = NAV.map(item => {
    if (item.group) {
      // só renderiza grupo se houver pelo menos 1 item visível pra esse role abaixo
      return `<div class="nav-group-label">${esc(item.group)}</div>`;
    }
    if (!item.roles.includes(allowedRoles)) return '';
    return `
      <a href="#${item.path}" class="nav-item" data-path="${item.path}">
        ${iconSpan(item.icon)}
        <span>${esc(item.label)}</span>
      </a>`;
  }).join('');

  const logoHTML = `<img src="${APP_FAVICON}" alt="${esc(APP_NAME)}">`;

  root.innerHTML = `
    <div class="app" id="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-logo">${logoHTML}</div>
          <div style="min-width:0">
            <div class="sidebar-title">${esc(APP_NAME)}</div>
            ${entity ? `<div class="sidebar-subtitle">${esc(entity.organ_name)}</div>` : ''}
          </div>
        </div>
        <nav class="sidebar-nav" id="sidebar-nav">${navItems}</nav>
        <div class="sidebar-footer">
          <div class="sidebar-user">
            <div class="user-avatar">${esc(userInitials(userName))}</div>
            <div class="user-info">
              <div class="user-name">${esc(userName)}</div>
              <div class="user-role">${esc(userRole)}</div>
            </div>
          </div>
          <button class="logout-btn" id="logout-btn" title="Sair">${icons.logout}</button>
        </div>
      </aside>
      <div class="sidebar-overlay" id="sidebar-overlay"></div>
      <div class="main">
        <header class="topbar">
          <button class="topbar-toggle" id="topbar-toggle" aria-label="Menu">${icons.menu}</button>
          <div class="breadcrumb" id="breadcrumb"></div>
          <button class="topbar-install" id="topbar-install" hidden aria-label="Instalar aplicativo">
            ${icons.download}
            <span>Instalar app</span>
          </button>
          <img class="topbar-logo" src="${APP_FAVICON}" alt="${esc(APP_NAME)}">
        </header>
        <main class="page" id="page-content">
          <div class="card">
            <div class="skeleton skeleton-line w-40"></div>
            <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
            <div class="skeleton skeleton-line w-80" style="margin-top:8px"></div>
          </div>
        </main>
      </div>
    </div>
  `;

  setupShellEvents();
  updateBreadcrumb(currentPath());
  updateActiveNav(currentPath());
}

function setupShellEvents() {
  const shell = document.getElementById('app-shell');
  const toggle = document.getElementById('topbar-toggle');
  const overlay = document.getElementById('sidebar-overlay');
  const logoutBtn = document.getElementById('logout-btn');
  const installBtn = document.getElementById('topbar-install');

  // Botão Instalar: aparece quando PWA é elegível, dispara prompt nativo
  // (Chrome/Edge/Android) ou instruções iOS Safari.
  if (installBtn) {
    installBtn.addEventListener('click', () => install());
    onInstallStateChange((ok) => {
      installBtn.hidden = !ok;
    });
  }

  toggle?.addEventListener('click', () => {
    // Mobile: abre/fecha drawer. Desktop: colapsa/expande.
    if (window.innerWidth <= 900) {
      shell.classList.toggle('sidebar-open');
    } else {
      shell.classList.toggle('sidebar-collapsed');
    }
  });

  overlay?.addEventListener('click', () => shell.classList.remove('sidebar-open'));

  // fecha drawer ao navegar no mobile
  document.getElementById('sidebar-nav')?.addEventListener('click', () => {
    if (window.innerWidth <= 900) shell.classList.remove('sidebar-open');
  });

  logoutBtn?.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Sair do sistema',
      message: 'Deseja realmente encerrar sua sessão?',
      confirmText: 'Sair',
    });
    if (!ok) return;
    try { await logout(); } catch (e) { console.warn('logout', e); }
    // limpeza paranoica de qualquer storage residual do Supabase
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('sb-') || k.includes('supabase')) localStorage.removeItem(k);
      });
    } catch {}
    // remove hash sem disparar router, recarrega limpo → boot vê sessão nula
    history.replaceState(null, '', window.location.pathname + window.location.search);
    window.location.reload();
  });
}

export function updateActiveNav(path) {
  document.querySelectorAll('#sidebar-nav .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });
}

export function updateBreadcrumb(path) {
  const el = document.getElementById('breadcrumb');
  if (!el) return;
  const crumbs = BREADCRUMB[path];
  if (!crumbs) { el.innerHTML = ''; return; }
  const parts = [
    `<a href="#/dashboard">${esc(APP_NAME)}</a>`,
    ...crumbs.map((c, i) => {
      const sep = `<span class="crumb-sep">${icons.chevronRight}</span>`;
      const isLast = i === crumbs.length - 1;
      const text = isLast
        ? `<span class="crumb-current">${esc(c.label)}</span>`
        : `<span>${esc(c.label)}</span>`;
      return sep + text;
    }),
  ];
  el.innerHTML = parts.join('');
}

export function pageRoot() {
  return document.getElementById('page-content');
}

/** Renderiza um cabeçalho de página padrão (título + ações opcionais) */
export function pageHeader({ title, subtitle, actionsHtml = '' }) {
  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">${esc(title)}</h1>
        ${subtitle ? `<p class="page-subtitle">${esc(subtitle)}</p>` : ''}
      </div>
      ${actionsHtml ? `<div class="page-actions">${actionsHtml}</div>` : ''}
    </div>
  `;
}
