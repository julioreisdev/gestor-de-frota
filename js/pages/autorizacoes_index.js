import { pageRoot, pageHeader } from '../shell.js';
import { renderFuelingTab } from './autorizacoes.js';
import { renderServiceTab } from './autorizacoes_service.js';
import { icons } from '../icons.js';
import { getProfile } from '../auth.js';
import { supabase } from '../supabase.js';

let _currentTab = 'fueling'; // 'fueling' | 'service'
let _availableTabs = null;    // null = ainda não resolvido

/** Resolve quais tabs o usuário pode ver:
 *  - admin / usuario: ambas
 *  - fornecedor com kind=posto:    só 'fueling'
 *  - fornecedor com kind=mecanica: só 'service'
 *  - fornecedor com kind=ambos:    ambas
 */
async function resolveAvailableTabs() {
  const me = getProfile();
  if (me?.role !== 'fornecedor') return ['fueling', 'service'];
  if (!me.supplier_id) return ['fueling', 'service']; // segurança: sem supplier_id, deixa ver as 2
  const { data } = await supabase.from('supplier').select('kind').eq('id', me.supplier_id).maybeSingle();
  const kind = data?.kind;
  if (kind === 'posto') return ['fueling'];
  if (kind === 'mecanica') return ['service'];
  return ['fueling', 'service'];
}

export async function renderAutorizacoes() {
  _availableTabs = await resolveAvailableTabs();
  if (!_availableTabs.includes(_currentTab)) _currentTab = _availableTabs[0];

  const tabHTML = (key, icon, label) => _availableTabs.includes(key)
    ? `<button class="tab-btn ${_currentTab === key ? 'active' : ''}" data-tab="${key}" role="tab">
         <span style="width:16px;height:16px;display:inline-flex">${icon}</span>
         ${label}
       </button>`
    : '';

  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Autorizações',
      subtitle: _availableTabs.length > 1
        ? 'Gerencie autorizações de abastecimento e de manutenção.'
        : (_availableTabs[0] === 'fueling'
            ? 'Autorizações de abastecimento vinculadas a você.'
            : 'Autorizações de manutenção vinculadas a você.'),
    })}
    ${_availableTabs.length > 1 ? `
    <div class="tab-bar" id="aut-tabs" role="tablist">
      ${tabHTML('fueling', icons.droplet, 'Abastecimento')}
      ${tabHTML('service', icons.wrench, 'Manutenção')}
    </div>` : ''}
    <div id="aut-tab-content"></div>
  `;
  document.querySelectorAll('#aut-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tab = btn.dataset.tab;
      if (tab === _currentTab) return;
      _currentTab = tab;
      document.querySelectorAll('#aut-tabs .tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      await mountTab();
    });
  });
  await mountTab();
}

async function mountTab() {
  const container = document.getElementById('aut-tab-content');
  if (!container) return;
  container.innerHTML = `
    <div class="card">
      <div class="skeleton skeleton-line w-40"></div>
      <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
      <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
    </div>`;
  if (_currentTab === 'service') {
    await renderServiceTab(container);
  } else {
    await renderFuelingTab(container);
  }
}
