// =============================================================================
// FATURAMENTO — Ordem de Fornecimento e Termo de Recebimento (combustível)
// Entrada da página: abas conforme o perfil.
//   admin      → Ordens · Termos · Nova ordem · Configuração
//   usuario    → Ordens · Termos · Nova ordem
//   fornecedor → Ordens (só leitura)
// =============================================================================
import { pageRoot, pageHeader } from '../shell.js';
import { icons } from '../icons.js';
import { getProfile } from '../auth.js';
import { renderOrdersTab } from './faturamento_ordens.js';
import { renderNewOrderTab } from './faturamento_nova.js';
import { renderTermsTab } from './faturamento_termos.js';
import { renderConfigTab } from './faturamento_config.js';

const TABS = {
  orders: { label: 'Ordens de Fornecimento', icon: 'receipt', render: renderOrdersTab },
  terms:  { label: 'Termos de Recebimento',  icon: 'fileCheck', render: renderTermsTab },
  new:    { label: 'Nova ordem',             icon: 'plus',    render: renderNewOrderTab },
  config: { label: 'Configuração',           icon: 'shield',  render: renderConfigTab },
};

let _tab = 'orders';

/** Permite a outra página (ex.: aviso do painel) abrir direto em uma aba. */
export function openBillingTab(tab) { if (TABS[tab]) _tab = tab; }

// Qualquer link com data-billing-tab="new" abre o Faturamento já na aba indicada.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-billing-tab]');
  if (a) openBillingTab(a.dataset.billingTab);
}, true);

function allowedTabs() {
  const role = getProfile()?.role;
  if (role === 'admin') return ['orders', 'terms', 'new', 'config'];
  if (role === 'usuario') return ['orders', 'terms', 'new'];
  return ['orders'];
}

export async function renderFaturamento() {
  const tabs = allowedTabs();
  if (!tabs.includes(_tab)) _tab = tabs[0];
  const isSupplier = getProfile()?.role === 'fornecedor';

  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Faturamento',
      subtitle: isSupplier
        ? 'Ordens de Fornecimento emitidas para o seu posto. A nota fiscal deve seguir as quantidades da ordem.'
        : 'Ordem de Fornecimento de combustível por secretaria e contrato.',
    })}
    ${tabs.length > 1 ? `
    <div class="tab-bar" id="fat-tabs" role="tablist">
      ${tabs.map(k => `
        <button class="tab-btn ${_tab === k ? 'active' : ''}" data-tab="${k}" role="tab" aria-selected="${_tab === k}">
          <span style="width:16px;height:16px;display:inline-flex">${icons[TABS[k].icon]}</span>
          ${TABS[k].label}
        </button>`).join('')}
    </div>` : ''}
    <div id="fat-tab"></div>
  `;

  document.querySelectorAll('#fat-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.tab !== _tab) goTab(btn.dataset.tab); });
  });
  await mountTab();
}

async function goTab(tab) {
  if (!allowedTabs().includes(tab)) return;
  _tab = tab;
  document.querySelectorAll('#fat-tabs .tab-btn').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  await mountTab();
  window.scrollTo({ top: 0 });
}

async function mountTab() {
  const old = document.getElementById('fat-tab');
  if (!old) return;
  // Elemento novo a cada aba: os ouvintes de evento da aba anterior vão embora
  // junto com o elemento antigo (senão um clique dispararia a ação várias vezes).
  const container = document.createElement('div');
  container.id = 'fat-tab';
  old.replaceWith(container);
  container.innerHTML = `
    <div class="card">
      <div class="skeleton skeleton-line w-40"></div>
      <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
      <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
    </div>`;
  const mounted = _tab;
  await TABS[mounted].render(container, { goTab, allowedTabs });
}
