// Entry point — verifica sessão, monta shell ou tela de login, e roteia.
import { loadSession, getSession, onAuthChange } from './auth.js';
import { renderLogin } from './pages/login.js';
import { renderShell, NAV, updateActiveNav, updateBreadcrumb } from './shell.js';
import { renderPlaceholder } from './pages/placeholder.js';
import { renderEntidade } from './pages/entidade.js';
import { renderUsuarios } from './pages/usuarios.js';
import { renderSecretarias } from './pages/secretarias.js';
import { renderVeiculos } from './pages/veiculos.js';
import { renderFornecedores } from './pages/fornecedores.js';
import { renderAutorizacoes } from './pages/autorizacoes_index.js';
import { renderAbastecimentos } from './pages/abastecimentos.js';
import { renderManutencoes } from './pages/manutencoes.js';
import { renderRelatorios } from './pages/relatorios.js';
import { renderExportacao } from './pages/exportacao.js';
import { renderDashboard } from './pages/dashboard.js';
import { register, navigate, setOnChange, start, currentPath } from './router.js';
import { toast } from './ui.js';
import { registerSW } from './pwa.js';

// Registra rotas. Páginas não-implementadas usam placeholder.
function registerRoutes() {
  register('/dashboard',      renderDashboard);
  register('/entidade',       renderEntidade);
  register('/usuarios',       renderUsuarios);
  register('/secretarias',    renderSecretarias);
  register('/veiculos',       renderVeiculos);
  register('/fornecedores',   renderFornecedores);
  register('/autorizacoes',   renderAutorizacoes);
  register('/abastecimentos', renderAbastecimentos);
  register('/manutencoes',    renderManutencoes);
  register('/relatorios',     renderRelatorios);
  register('/exportacao',     renderExportacao);
  register('*',               () => renderPlaceholder('Página não encontrada'));
}

// Quando navegar, atualiza barra de navegação ativa e breadcrumb
setOnChange((cur) => {
  if (getSession()) {
    updateActiveNav(cur.path);
    updateBreadcrumb(cur.path);
  }
});

function ensureHash() {
  if (!location.hash || location.hash === '#' || location.hash === '#/') {
    history.replaceState(null, '', location.pathname + location.search + '#/dashboard');
  }
}

async function boot() {
  registerRoutes();
  registerSW();
  await loadSession();

  if (!getSession()) {
    renderLogin();
  } else {
    await renderShell();
    ensureHash();
    start();
  }

  // Inputs date/month: força min/max nativo (1900-2100). O browser bloqueia
  // anos fora do range pelo próprio picker. NÃO validamos no blur pra não
  // interromper digitação — usuário pode pular pra outro campo antes de
  // completar o ano. Validação rigorosa fica nos pontos críticos (export TCE).
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'INPUT') return;
    if (el.type !== 'date' && el.type !== 'month') return;
    if (!el.hasAttribute('min')) el.min = el.type === 'date' ? '1900-01-01' : '1900-01';
    if (!el.hasAttribute('max')) el.max = el.type === 'date' ? '2100-12-31' : '2100-12';
  });

  // Refresh leve: ao voltar pra aba após ausência > 5s, re-roda a rota atual
  // pra garantir dados atualizados. Causa real do "tab freeze" foi resolvida
  // tirando o async do callback de onAuthStateChange (ver auth.js).
  let _lastHidden = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { _lastHidden = Date.now(); return; }
    if (document.visibilityState !== 'visible') return;
    if (!getSession()) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (Date.now() - _lastHidden < 5000) return;
    start();
  });

  // Reage a mudanças de auth (logout em outra aba, refresh token, etc).
  // O logout via UI já força reload, então aqui ignoramos SIGNED_OUT durante
  // o próprio fluxo (evita re-render concorrente). Tratamos só eventos vindos
  // de outras abas / expiração de token.
  onAuthChange(async (event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (event === 'SIGNED_IN' && session) {
      await renderShell();
      ensureHash();
      start();
    } else if (event === 'SIGNED_OUT' || !session) {
      // Se já está na tela de login (sem sidebar), não faz nada.
      if (document.querySelector('.login-page')) return;
      renderLogin();
    }
  });
}

boot().catch(err => {
  console.error('Boot error', err);
  document.getElementById('app-root').innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <h1 style="font-size:18px;font-weight:700;margin-bottom:8px">Erro ao iniciar</h1>
        <p style="font-size:13px;color:var(--text-soft)">${err.message || err}</p>
      </div>
    </div>`;
});
