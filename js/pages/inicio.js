// Início (tablet e celular): a tela de entrada do aplicativo, com um bloco para
// cada página que o perfil pode abrir, nos mesmos grupos do menu. No computador
// a rota também funciona, mas a entrada é o Dashboard.
import { pageRoot, NAV, getEntity } from '../shell.js';
import { getProfile } from '../auth.js';
import { icons } from '../icons.js';
import { esc } from '../ui.js';

const SUBTITLE = {
  '/dashboard': 'Indicadores e alertas',
  '/entidade': 'Dados da instituição',
  '/usuarios': 'Acessos e perfis',
  '/secretarias': 'Unidades gestoras',
  '/veiculos': 'Frota cadastrada',
  '/motoristas': 'CNH e cursos',
  '/fornecedores': 'Postos e mecânicas',
  '/autorizacoes': 'Emitir e consultar',
  '/abastecimentos': 'Registrar consumo',
  '/manutencoes': 'Serviços e oficinas',
  '/faturamento': 'Ordens e termos',
  '/relatorios': 'Análises e totais',
  '/exportacao': 'Arquivos do TCE-PI',
};

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

export async function renderInicio() {
  const profile = getProfile();
  const role = profile?.role || 'usuario';
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0] || 'Olá';
  const entity = await getEntity().catch(() => null);

  const groups = [];
  NAV.forEach(i => {
    if (i.group) { groups.push({ label: i.group, items: [] }); return; }
    if (!i.roles.includes(role)) return;
    if (!groups.length) groups.push({ label: '', items: [] });
    groups.at(-1).items.push(i);
  });

  pageRoot().innerHTML = `
    <div class="home">
      <header class="home-head">
        <div class="home-greeting">${esc(greeting())}, ${esc(firstName)}</div>
        ${entity ? `<div class="home-entity">${esc(entity.organ_name)}</div>` : ''}
      </header>
      ${groups.filter(g => g.items.length).map(g => `
        ${g.label ? `<h2 class="home-group">${esc(g.label)}</h2>` : ''}
        <div class="home-tiles">
          ${g.items.map(i => `
            <a href="#${i.path}" class="home-tile">
              <span class="home-tile-icon">${icons[i.icon] || ''}</span>
              <span class="home-tile-label">${esc(i.label)}</span>
              <span class="home-tile-sub">${esc(SUBTITLE[i.path] || '')}</span>
            </a>`).join('')}
        </div>`).join('')}
    </div>`;
}
