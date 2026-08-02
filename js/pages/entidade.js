import { pageRoot, pageHeader, getEntity, invalidateEntityCache } from '../shell.js';
import { esc, toast } from '../ui.js';
import { supabase } from '../supabase.js';
import { isAdmin } from '../auth.js';
import { icons } from '../icons.js';

export async function renderEntidade() {
  pageRoot().innerHTML = `
    ${pageHeader({
      title: 'Entidade',
      subtitle: 'Dados cadastrais da instituição. Apenas administradores editam as preferências de relatório.',
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

  const { data: muni } = await supabase
    .from('ibge_municipality')
    .select('name')
    .eq('code', entity.ibge_code)
    .maybeSingle();

  const logoBlock = entity.coat_of_arms_url
    ? `<img src="${esc(entity.coat_of_arms_url)}" alt="Brasão">`
    : `<div style="color:var(--text-muted)">${icons.shield}</div>`;

  const admin = isAdmin();
  const useLogo = entity.use_logo_in_reports !== false; // default true
  const hasCoat = !!entity.coat_of_arms_url;

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

    <h3 class="entity-section-title">Preferências dos Relatórios</h3>
    <div class="entity-pref" id="pref-use-logo">
      <label class="pref-row ${admin ? '' : 'is-readonly'}">
        <input type="checkbox" id="chk-use-logo" ${useLogo ? 'checked' : ''} ${admin ? '' : 'disabled'}>
        <div class="pref-text">
          <div class="pref-title">Usar logo da instituição nos relatórios</div>
          <div class="pref-help">
            Quando ativo, os PDFs de relatório usam o brasão desta entidade.
            ${hasCoat ? '' : '<span class="pref-warning">Nenhum brasão cadastrado — mesmo ativo, o sistema usará a logo padrão do Gerir Frota.</span>'}
          </div>
        </div>
        <span class="pref-saving" id="pref-saving" hidden>
          <span class="spinner"></span>
        </span>
      </label>
    </div>

    <p class="entity-footnote">
      <span style="display:inline-flex;width:14px;height:14px;color:var(--text-muted)">${icons.info}</span>
      Dados cadastrais são fixados pelo administrador do sistema.
      ${admin ? '' : 'Somente administradores alteram preferências de relatório.'}
    </p>
  `;

  if (admin) {
    const chk = document.getElementById('chk-use-logo');
    const saving = document.getElementById('pref-saving');
    chk.addEventListener('change', async () => {
      const newVal = chk.checked;
      chk.disabled = true;
      saving.hidden = false;
      let error = null;
      try {
        // .select() garante que o Postgres devolve o registro atualizado,
        // detectando silenciosamente se RLS bloqueou (data vazio) ou coluna
        // inexistente (error). Sem .select() o supabase-js pode "resolver"
        // sem retorno claro.
        // Timeout defensivo: se a rede pendurar, libera a UI em 10s.
        const req = supabase
          .from('entity')
          .update({ use_logo_in_reports: newVal })
          .eq('id', 1)
          .select('id, use_logo_in_reports')
          .maybeSingle();
        const timeout = new Promise((_, rej) =>
          setTimeout(() => rej(new Error('Tempo esgotado. Verifique sua conexão.')), 10000)
        );
        const res = await Promise.race([req, timeout]);
        if (res?.error) error = res.error;
        else if (res?.data && res.data.use_logo_in_reports !== newVal) {
          error = { message: 'Preferência não persistiu (verifique RLS).' };
        }
      } catch (e) {
        error = { message: e?.message || String(e) };
      } finally {
        chk.disabled = false;
        saving.hidden = true;
      }
      if (error) {
        chk.checked = !newVal;
        if (/use_logo_in_reports/i.test(error.message || '')) {
          toast('Rode o apply.sql no Supabase antes de usar esta preferência.', 'warning', 6000);
        } else {
          toast('Erro ao salvar: ' + error.message, 'error');
        }
        return;
      }
      invalidateEntityCache();
      toast(newVal ? 'Relatórios agora usam a logo da instituição.' : 'Relatórios agora usam a logo do Gerir Frota.', 'success');
    });
  }
}
