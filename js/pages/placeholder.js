import { pageRoot, pageHeader } from '../shell.js';
import { icons } from '../icons.js';
import { esc } from '../ui.js';

export function renderPlaceholder(title) {
  pageRoot().innerHTML = `
    ${pageHeader({ title, subtitle: 'Esta funcionalidade ainda será implementada.' })}
    <div class="card">
      <div class="empty-state">
        <div class="empty-state-icon">${icons.wrench}</div>
        <div class="empty-state-title">Em construção</div>
        <p class="empty-state-text">
          O módulo <strong>${esc(title)}</strong> está no roadmap e será entregue
          nas próximas iterações.
        </p>
      </div>
    </div>
  `;
}
