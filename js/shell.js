// Shell autenticado: sidebar + topbar + breadcrumb + area de conteúdo.
import { icons, iconSpan } from './icons.js';
import { logout, getProfile } from './auth.js';
import { APP_NAME } from './config.js';
import { navigate, currentPath } from './router.js';
import { esc, confirmDialog } from './ui.js';
import { supabase } from './supabase.js';
import { canInstall, install, onInstallStateChange } from './pwa.js';

const APP_ICON = 'assets/icons/icon-192.png';

/** Tablet e celular (≤ 900px): sem sidebar; barra inferior e página Início. */
export const isMobile = () => window.matchMedia('(max-width: 900px)').matches;

// Catálogo de páginas — único lugar onde definir nav + permissões + breadcrumb
export const NAV = [
  { path: '/dashboard',      label: 'Dashboard',        icon: 'dashboard',  roles: ['admin','usuario','fornecedor'] },
  { group: 'Cadastros' },
  { path: '/entidade',       label: 'Entidade',         icon: 'shield',     roles: ['admin','usuario'] },
  { path: '/usuarios',       label: 'Usuários',         icon: 'users',      roles: ['admin'] },
  { path: '/secretarias',    label: 'Secretarias',      icon: 'briefcase',  roles: ['admin'] },
  { path: '/veiculos',       label: 'Veículos',         icon: 'car',        roles: ['admin','usuario'] },
  { path: '/motoristas',     label: 'Motoristas',       icon: 'idCard',     roles: ['admin','usuario'] },
  { path: '/fornecedores',   label: 'Fornecedores',     icon: 'store',      roles: ['admin','usuario'] },
  { group: 'Operação' },
  { path: '/autorizacoes',   label: 'Autorizações',     icon: 'clipboard',  roles: ['admin','usuario','fornecedor'] },
  { path: '/abastecimentos', label: 'Abastecimentos',   icon: 'droplet',    roles: ['admin','usuario'] },
  { path: '/manutencoes',    label: 'Manutenções',      icon: 'wrench',     roles: ['admin','usuario'] },
  { path: '/faturamento',    label: 'Faturamento',      icon: 'receipt',    roles: ['admin','usuario','fornecedor','faturamento'] },
  { group: 'Análise' },
  { path: '/relatorios',     label: 'Relatórios',       icon: 'barChart',   roles: ['admin','usuario'] },
  { path: '/exportacao',     label: 'Exportação TCE',   icon: 'download',   roles: ['admin','usuario'] },
];

// Barra inferior (tablet e celular), por perfil. "Mais" entra sempre no fim.
const MOBILE_BAR = {
  admin:       ['/inicio', '/autorizacoes', '/abastecimentos', '/relatorios'],
  usuario:     ['/inicio', '/autorizacoes', '/abastecimentos', '/relatorios'],
  fornecedor:  ['/inicio', '/autorizacoes', '/faturamento'],
  faturamento: ['/inicio', '/faturamento'],
};
const HOME_ITEM = { path: '/inicio', label: 'Início', icon: 'home' };
// Rótulos curtos para caber em cinco posições num celular estreito
const BAR_LABEL = { '/autorizacoes': 'Autorizar', '/abastecimentos': 'Abastecer' };
const ROLE_LABEL = { admin: 'Administrador', usuario: 'Usuário', fornecedor: 'Fornecedor', faturamento: 'Faturamento' };

/** Páginas que o perfil pode abrir (sem o Início). */
export function pagesForRole(role) {
  return NAV.filter(i => i.path && i.roles.includes(role));
}
/** O perfil pode abrir esta rota? */
export function canAccess(path, role) {
  if (path === '/inicio') return true;
  return NAV.some(i => i.path === path && i.roles.includes(role));
}
/** Rota de entrada: celular → Início; computador → Dashboard (faturamento → Faturamento). */
export function defaultPath(role) {
  if (isMobile()) return '/inicio';
  return canAccess('/dashboard', role) ? '/dashboard' : (pagesForRole(role)[0]?.path || '/inicio');
}

// Breadcrumb por rota
const BREADCRUMB = {
  '/inicio':         [{ label: 'Início' }],
  '/dashboard':      [{ label: 'Dashboard' }],
  '/entidade':       [{ label: 'Cadastros' }, { label: 'Entidade' }],
  '/usuarios':       [{ label: 'Cadastros' }, { label: 'Usuários' }],
  '/secretarias':    [{ label: 'Cadastros' }, { label: 'Secretarias' }],
  '/veiculos':       [{ label: 'Cadastros' }, { label: 'Veículos' }],
  '/motoristas':     [{ label: 'Cadastros' }, { label: 'Motoristas' }],
  '/fornecedores':   [{ label: 'Cadastros' }, { label: 'Fornecedores' }],
  '/autorizacoes':   [{ label: 'Operação' }, { label: 'Autorizações' }],
  '/abastecimentos': [{ label: 'Operação' }, { label: 'Abastecimentos' }],
  '/manutencoes':    [{ label: 'Operação' }, { label: 'Manutenções' }],
  '/faturamento':    [{ label: 'Operação' }, { label: 'Faturamento' }],
  '/relatorios':     [{ label: 'Análise' }, { label: 'Relatórios' }],
  '/exportacao':     [{ label: 'Análise' }, { label: 'Exportação TCE' }],
};

let _entityCache = null;

export async function getEntity() {
  if (_entityCache) return _entityCache;
  // Query com a coluna nova. Se o SQL ainda não foi aplicado no banco
  // (coluna use_logo_in_reports inexistente), o Supabase retorna 400.
  // Fallback pra query sem essa coluna → app continua funcionando; a flag
  // fica implícita como true (default do schema).
  const withNew = await supabase
    .from('entity')
    .select('id, entity_type, ibge_code, organ_name, coat_of_arms_url, default_ref_month, use_logo_in_reports')
    .maybeSingle();
  if (!withNew.error) {
    _entityCache = withNew.data;
    return withNew.data;
  }
  const legacy = await supabase
    .from('entity')
    .select('id, entity_type, ibge_code, organ_name, coat_of_arms_url, default_ref_month')
    .maybeSingle();
  _entityCache = legacy.data ? { ...legacy.data, use_logo_in_reports: true } : null;
  return _entityCache;
}

/** Força reload da entidade (usar após update de flag/logo). */
export function invalidateEntityCache() { _entityCache = null; }

/** Retorna a URL de logo pra usar nos relatórios PDF.
 *  Se a entidade tem brasão e a flag "usar logo da instituição" está ativa,
 *  usa o brasão. Caso contrário, cai pra logo do Gerir Frota (local).
 */
export function reportLogoUrl(entity) {
  const fallback = new URL('logo.png', location.href).href;
  const useCoat = entity?.use_logo_in_reports !== false; // default true
  if (useCoat && entity?.coat_of_arms_url) return entity.coat_of_arms_url;
  return fallback;
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

  const navItems = NAV.map((item, idx) => {
    if (item.group) {
      // só renderiza o grupo se houver pelo menos 1 item visível pra esse perfil abaixo dele
      const next = NAV.slice(idx + 1);
      const end = next.findIndex(i => i.group);
      const inGroup = end === -1 ? next : next.slice(0, end);
      if (!inGroup.some(i => i.roles.includes(allowedRoles))) return '';
      return `<div class="nav-group-label">${esc(item.group)}</div>`;
    }
    if (!item.roles.includes(allowedRoles)) return '';
    return `
      <a href="#${item.path}" class="nav-item" data-path="${item.path}">
        ${iconSpan(item.icon)}
        <span>${esc(item.label)}</span>
      </a>`;
  }).join('');

  // Em tamanho pequeno entra o símbolo (ícone do app); a logo completa fica no login e nos impressos
  const logoHTML = `<img src="${APP_ICON}" alt="${esc(APP_NAME)}">`;

  // Barra inferior e folha "Mais" (tablet e celular)
  const barPaths = MOBILE_BAR[allowedRoles] || MOBILE_BAR.usuario;
  const barItems = barPaths.map(p => (p === '/inicio' ? HOME_ITEM : NAV.find(i => i.path === p))).filter(Boolean);
  const morePages = pagesForRole(allowedRoles).filter(i => !barPaths.includes(i.path));
  const bottomNavHTML = `
    <nav class="bottom-nav" id="bottom-nav" aria-label="Navegação">
      ${barItems.map(i => `
        <a href="#${i.path}" class="bn-item" data-path="${i.path}">
          ${iconSpan(i.icon, 'bn-icon')}<span>${esc(BAR_LABEL[i.path] || i.label)}</span>
        </a>`).join('')}
      <button type="button" class="bn-item" id="bn-more" data-more>
        ${iconSpan('menu', 'bn-icon')}<span>Mais</span>
      </button>
    </nav>`;
  const moreGroups = [];
  NAV.forEach(i => {
    if (i.group) { moreGroups.push({ label: i.group, items: [] }); return; }
    if (!morePages.includes(i)) return;
    if (!moreGroups.length) moreGroups.push({ label: '', items: [] });
    moreGroups.at(-1).items.push(i);
  });
  const moreSheetHTML = `
    <div class="more-backdrop" id="more-backdrop"></div>
    <div class="more-sheet" id="more-sheet" role="dialog" aria-modal="true" aria-label="Mais opções">
      <div class="more-handle"></div>
      <div class="more-user">
        <div class="user-avatar">${esc(userInitials(userName))}</div>
        <div class="more-user-info">
          <div class="user-name">${esc(userName)}</div>
          <div class="user-role">${esc(ROLE_LABEL[userRole] || userRole)}${entity ? ' · ' + esc(entity.organ_name) : ''}</div>
        </div>
      </div>
      ${moreGroups.filter(g => g.items.length).map(g => `
        ${g.label ? `<div class="more-group">${esc(g.label)}</div>` : ''}
        ${g.items.map(i => `
          <a href="#${i.path}" class="more-item" data-path="${i.path}">
            ${iconSpan(i.icon, 'more-icon')}<span>${esc(i.label)}</span>${icons.chevronRight}
          </a>`).join('')}`).join('')}
      <div class="more-actions">
        <button type="button" class="btn btn-outline" id="more-install" hidden>${icons.download}<span>Instalar aplicativo</span></button>
        <button type="button" class="btn btn-outline more-logout" id="more-logout">${icons.logout}<span>Sair</span></button>
      </div>
    </div>`;

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
          <a href="#/inicio" class="topbar-brand" aria-label="Início">
            <img src="${APP_ICON}" alt="">
            <span>${esc(APP_NAME)}</span>
          </a>
          <div class="breadcrumb" id="breadcrumb"></div>
          <button class="topbar-install" id="topbar-install" hidden aria-label="Instalar aplicativo">
            ${icons.download}
            <span>Instalar app</span>
          </button>
          <img class="topbar-logo" src="${APP_ICON}" alt="${esc(APP_NAME)}">
        </header>
        <main class="page" id="page-content">
          <div class="card">
            <div class="skeleton skeleton-line w-40"></div>
            <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
            <div class="skeleton skeleton-line w-80" style="margin-top:8px"></div>
          </div>
        </main>
        ${bottomNavHTML}
      </div>
      ${moreSheetHTML}
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

  // Folha "Mais" (tablet e celular)
  const sheet = document.getElementById('more-sheet');
  const backdrop = document.getElementById('more-backdrop');
  const moreBtn = document.getElementById('bn-more');
  const moreInstall = document.getElementById('more-install');
  const setMore = (open) => {
    shell.classList.toggle('more-open', open);
    moreBtn?.setAttribute('aria-expanded', String(open));
    sheet?.setAttribute('aria-hidden', String(!open));
  };
  moreBtn?.addEventListener('click', () => setMore(!shell.classList.contains('more-open')));
  backdrop?.addEventListener('click', () => setMore(false));
  sheet?.addEventListener('click', (e) => { if (e.target.closest('a[href]')) setMore(false); });
  window.addEventListener('hashchange', () => setMore(false));
  if (moreInstall) {
    moreInstall.addEventListener('click', () => { setMore(false); install(); });
    onInstallStateChange((ok) => { moreInstall.hidden = !ok; });
  }
  document.getElementById('more-logout')?.addEventListener('click', () => { setMore(false); doLogout(); });

  logoutBtn?.addEventListener('click', doLogout);
  async function doLogout() {
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
  }
}

export function updateActiveNav(path) {
  document.querySelectorAll('#sidebar-nav .nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path === path);
  });
  // Barra inferior: "Mais" fica ativo quando a página aberta está na folha
  const inBar = [...document.querySelectorAll('#bottom-nav .bn-item[data-path]')].some(el => el.dataset.path === path);
  document.querySelectorAll('#bottom-nav .bn-item').forEach(el => {
    el.classList.toggle('active', el.dataset.path ? el.dataset.path === path : (!inBar && path !== '/inicio'));
  });
  document.querySelectorAll('#more-sheet .more-item').forEach(el => {
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
