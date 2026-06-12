import { pageRoot, pageHeader, getEntity } from '../shell.js';
import { esc, fmtDate } from '../ui.js';
import { supabase } from '../supabase.js';
import { icons } from '../icons.js';

export async function renderEntidade() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Entidade',
      subtitle: 'Dados cadastrais da instituição. Somente leitura — alterações são feitas no banco.',
    })}
    <div class="card" id="entidade-card">
      <div class="skeleton skeleton-line w-40"></div>
      <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
      <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
    </div>
  `;

  const entity = await getEntity();
  if (!entity) {
    document.getElementById('entidade-card').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">${icons.alert}</div>
        <div class="empty-state-title">Entidade não encontrada</div>
        <p class="empty-state-text">Nenhum registro foi encontrado na tabela <code>entity</code>.</p>
      </div>`;
    return;
  }

  // busca município pra mostrar nome (não só código)
  const { data: muni } = await supabase
    .from('ibge_municipality')
    .select('name')
    .eq('code', entity.ibge_code)
    .maybeSingle();

  const logoBlock = entity.coat_of_arms_url
    ? `<img src="${esc(entity.coat_of_arms_url)}" alt="Brasão">`
    : `<div style="color:var(--text-muted)">${icons.shield}</div>`;

  document.getElementById('entidade-card').innerHTML = `
    <div class="entity-card">
      <div class="entity-logo">${logoBlock}</div>
      <div>
        <div class="entity-name">${esc(entity.organ_name)}</div>
        <div class="entity-type">${esc(entity.entity_type)}</div>
      </div>
    </div>
    <div class="entity-fields">
      <div class="field-readonly">
        <span class="field-readonly-label">Município</span>
        <span class="field-readonly-value">${esc(muni?.name || '—')}</span>
      </div>
      <div class="field-readonly">
        <span class="field-readonly-label">Código IBGE</span>
        <span class="field-readonly-value" style="font-family:ui-monospace,monospace">${esc(entity.ibge_code)}</span>
      </div>
      <div class="field-readonly">
        <span class="field-readonly-label">Mês de Referência Padrão</span>
        <span class="field-readonly-value">${esc(entity.default_ref_month || '—')}</span>
      </div>
    </div>
    <p style="margin-top:var(--s-6);font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px">
      <span style="display:inline-flex;width:14px;height:14px;color:var(--text-muted)">${icons.info}</span>
      Para alterar os dados da entidade, contate o administrador do sistema.
    </p>
  `;
}
