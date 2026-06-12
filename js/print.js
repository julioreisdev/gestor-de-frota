// Geração e abertura de relatórios para impressão.
// Abre uma nova janela com layout A4 paisagem, cabeçalho institucional,
// tabela e auto-disparo de window.print().
import { esc } from './ui.js';
import { getEntity } from './shell.js';
import { APP_NAME } from './config.js';

/**
 * @param {object} opts
 * @param {string} opts.title      - Título do relatório (ex.: "Relação de Veículos")
 * @param {string[]} opts.columns  - Nomes das colunas
 * @param {Array<Array<string|number>>} opts.rows - Linhas (mesma ordem das colunas)
 * @param {string} [opts.filtersLabel] - Descrição dos filtros aplicados (vai no cabeçalho)
 * @param {string[]} [opts.colHints]   - Classes opcionais por coluna: "num" (right-aligned), "mono" (monospace), "wrap" (quebra livre)
 */
export async function printList({ title, columns, rows, filtersLabel = '', colHints = [] }) {
  const entity = await getEntity();
  const orgao = entity?.organ_name || 'Prefeitura Municipal';
  const tipo = entity?.entity_type || '';
  const logoUrl = new URL('logo.png', location.href).href;
  const ibge = entity?.ibge_code || '';
  const now = new Date().toLocaleString('pt-BR');
  const total = rows.length;

  const w = window.open('', '_blank', 'width=1200,height=800');
  if (!w) {
    alert('O navegador bloqueou a janela de impressão. Permita popups deste site e tente novamente.');
    return;
  }

  const tHead = columns.map((c, i) =>
    `<th class="${esc(colHints[i] || '')}">${esc(c)}</th>`
  ).join('');
  const tBody = rows.map(r =>
    `<tr>${r.map((v, i) => `<td class="${esc(colHints[i] || '')}">${esc(v ?? '')}</td>`).join('')}</tr>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<title>${esc(title)} — ${esc(orgao)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Arial, sans-serif;
    color: #1A2A3A;
    margin: 0; padding: 0;
    font-size: 10px;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .hdr {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 0;
    border-bottom: 2px solid #217AD8;
    margin-bottom: 12px;
  }
  .hdr-logo {
    width: 56px; height: 56px;
    object-fit: contain;
    flex-shrink: 0;
    border-radius: 4px;
  }
  .hdr-info { flex: 1; min-width: 0; }
  .hdr-org { font-size: 11px; color: #475569; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .hdr-title { font-size: 17px; font-weight: 700; color: #0F172A; margin-top: 2px; }
  .hdr-meta { font-size: 10px; color: #64748B; margin-top: 6px; display: flex; gap: 14px; flex-wrap: wrap; }
  .hdr-meta b { color: #1A2A3A; font-weight: 600; }
  .filters {
    font-size: 10px;
    color: #475569;
    background: #EAF2FB;
    border-left: 3px solid #217AD8;
    padding: 5px 10px;
    margin-bottom: 10px;
    border-radius: 0 4px 4px 0;
  }
  .filters b { color: #1A65B5; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.5px;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th {
    background: #1A65B5;
    color: #fff;
    text-align: left;
    padding: 5px 6px;
    font-weight: 600;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: .02em;
    border-right: 1px solid #1A4F8F;
  }
  th:last-child { border-right: 0; }
  td {
    padding: 4px 6px;
    border-bottom: 1px solid #E5E9F0;
    vertical-align: top;
    word-break: break-word;
  }
  tr:nth-child(even) td { background: #F8FAFC; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  th.mono, td.mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 9px; }
  td.wrap { white-space: normal; }
  .footer {
    margin-top: 10px;
    padding-top: 6px;
    border-top: 1px solid #E5E9F0;
    font-size: 8.5px;
    color: #94A3B8;
    text-align: center;
  }
  .footer b { color: #475569; font-weight: 600; }
  .empty {
    padding: 60px 20px;
    text-align: center;
    color: #94A3B8;
    border: 1px dashed #CBD5E1;
    border-radius: 8px;
  }
  @media print {
    .no-print { display: none !important; }
    body { font-size: 9.5px; }
  }
</style>
</head>
<body>
  <div class="hdr">
    ${logoUrl ? `<img class="hdr-logo" src="${esc(logoUrl)}" alt="">` : ''}
    <div class="hdr-info">
      <div class="hdr-org">${esc(tipo)} ${esc(orgao).replace(esc(tipo), '').trim() === '' ? '' : '— ' + esc(orgao)}</div>
      <div class="hdr-title">${esc(title)}</div>
      <div class="hdr-meta">
        <span><b>Gerado em:</b> ${esc(now)}</span>
        <span><b>Total:</b> ${total} registro(s)</span>
        ${ibge ? `<span><b>IBGE:</b> ${esc(ibge)}</span>` : ''}
      </div>
    </div>
  </div>

  ${filtersLabel
    ? `<div class="filters"><b>Filtros aplicados:</b> ${esc(filtersLabel)}</div>`
    : ''}

  ${rows.length
    ? `<table><thead><tr>${tHead}</tr></thead><tbody>${tBody}</tbody></table>`
    : `<div class="empty">Nenhum registro para imprimir com os filtros atuais.</div>`}

  <div class="footer">
    Relatório gerado por <b>${esc(APP_NAME)}</b> · ${esc(now)}
  </div>

  <script>
    window.onload = function () {
      setTimeout(function () {
        try { window.focus(); window.print(); } catch (e) {}
      }, 300);
    };
  </script>
</body>
</html>`;

  w.document.open();
  w.document.write(html);
  w.document.close();
}

/** Constrói descrição amigável dos filtros ativos pra cabeçalho do relatório. */
export function buildFiltersLabel(parts) {
  // parts = [{ label: 'Secretaria', value: 'SMS' }, ...]
  const active = parts.filter(p => p.value);
  if (!active.length) return 'nenhum';
  return active.map(p => `${p.label}: ${p.value}`).join(' • ');
}
