// Exportação para XLSX usando SheetJS (community edition).
// Reutilizável por qualquer página: passa colunas, linhas e dispara download.
import * as XLSX from 'https://esm.sh/xlsx@0.18.5';

/**
 * Exporta uma planilha XLSX.
 * @param {object} opts
 * @param {string} opts.filename    Nome do arquivo (sem extensão; .xlsx é adicionado)
 * @param {string} [opts.sheetName] Nome da aba (default "Dados", máx 31 chars)
 * @param {string[]} opts.columns   Cabeçalhos
 * @param {Array<Array<any>>} opts.rows  Linhas (mesma ordem das colunas)
 * @param {number[]} [opts.colWidths]    Largura em caracteres por coluna (auto se omitido)
 */
export function exportXLSX({ filename, sheetName = 'Dados', columns, rows, colWidths }) {
  const data = [columns, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);

  // Larguras de coluna (cálculo automático se não fornecido)
  ws['!cols'] = (colWidths && colWidths.length === columns.length)
    ? colWidths.map(w => ({ wch: w }))
    : columns.map((c, i) => {
        const headLen = String(c).length;
        const maxLen = rows.reduce((m, r) => {
          const v = r[i];
          if (v == null) return m;
          return Math.max(m, String(v).length);
        }, headLen);
        return { wch: Math.min(Math.max(maxLen + 2, 10), 60) };
      });

  // Congela linha do cabeçalho
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName).slice(0, 31));
  const safeName = (filename || 'export').replace(/[\\/:*?"<>|]+/g, '_');
  XLSX.writeFile(wb, `${safeName}.xlsx`);
}

/** Helper: nome do arquivo com timestamp ISO. */
export function timestampFilename(prefix) {
  const ts = new Date().toISOString().slice(0, 10);
  return `${prefix}_${ts}`;
}
