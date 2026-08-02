// =============================================================================
// Impressão térmica + helpers comuns de impressão.
//
// O DESAFIO DA IMPRESSÃO TÉRMICA EM CELULAR
// -----------------------------------------
// Impressoras térmicas Bluetooth (GoldenSky etc) imprimem via APP intermediário
// no celular ("Thermal Printer"). Esse app recebe um PDF e tipicamente:
//   - IGNORA o `@page { size: 58mm auto }` do CSS;
//   - Trata o PDF como página ISO/A4 padrão;
//   - Mostra o conteúdo minúsculo no canto da bobina.
//
// SOLUÇÃO: gerar um PDF programático cujas DIMENSÕES FÍSICAS do documento
// já sejam exatamente 58mm × N (ou 80mm × N) — apps de impressora térmica
// respeitam o tamanho declarado do PDF e usam a folha inteira.
//
// Para isso usamos:
//   - html2canvas: renderiza o HTML em um <canvas> de alta resolução
//   - jsPDF: empacota o canvas como PDF com dimensões físicas exatas
// =============================================================================
import { openModal, closeModal, esc } from './ui.js';
import { icons } from './icons.js';
import html2canvas from 'https://esm.sh/html2canvas@1.4.1';
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1';

const WIDTH_KEY = 'gf-thermal-width'; // '58' | '80'

export function getThermalWidth() {
  try { return localStorage.getItem(WIDTH_KEY) || '58'; } catch { return '58'; }
}
export function setThermalWidth(v) {
  try { localStorage.setItem(WIDTH_KEY, v === '80' ? '80' : '58'); } catch {}
}
export function hasChosenThermalWidth() {
  try { return localStorage.getItem(WIDTH_KEY) != null; } catch { return false; }
}

/** Modal de escolha da largura da bobina (58/80mm). Retorna a escolha ou null. */
export function askThermalWidth() {
  return new Promise((resolve) => {
    const current = getThermalWidth();
    const body = `
      <p style="font-size:13px;color:var(--text-soft);margin-bottom:var(--s-4)">
        Selecione a largura da bobina da sua impressora térmica.
        A escolha fica gravada — você pode trocar depois no botão "⚙️ Bobina".
      </p>
      <div style="display:flex;gap:var(--s-3);flex-wrap:wrap">
        <label class="thermal-pick ${current === '58' ? 'sel' : ''}">
          <input type="radio" name="tw" value="58" ${current === '58' ? 'checked' : ''} style="display:none">
          <div class="thermal-pick-icon">🧾</div>
          <div class="thermal-pick-title">58 mm</div>
          <div class="thermal-pick-sub">Bobina padrão pequena</div>
        </label>
        <label class="thermal-pick ${current === '80' ? 'sel' : ''}">
          <input type="radio" name="tw" value="80" ${current === '80' ? 'checked' : ''} style="display:none">
          <div class="thermal-pick-icon">🧾</div>
          <div class="thermal-pick-title">80 mm</div>
          <div class="thermal-pick-sub">Bobina padrão grande</div>
        </label>
      </div>`;
    const footer = `
      <button class="btn btn-outline" data-cancel>Cancelar</button>
      <button class="btn btn-primary" id="tw-ok">Imprimir</button>
    `;
    const m = openModal({ title: 'Tamanho da bobina', body, footer });
    let chosen = current;
    m.querySelectorAll('.thermal-pick').forEach(el => {
      el.addEventListener('click', () => {
        m.querySelectorAll('.thermal-pick').forEach(x => x.classList.remove('sel'));
        el.classList.add('sel');
        chosen = el.querySelector('input').value;
      });
    });
    m.querySelector('[data-cancel]').addEventListener('click', () => { closeModal(); resolve(null); });
    m.querySelector('#tw-ok').addEventListener('click', () => {
      setThermalWidth(chosen);
      closeModal();
      resolve(chosen);
    });
  });
}

/** Abre HTML em nova aba (Blob URL). Funciona bem em iOS (mostra "Concluído").
 *  Continua sendo usado pelos PDFs A4 do sistema (que vão pra impressora normal,
 *  não térmica). */
export function openPrintTab(html, { title = 'Impressão', autoPrint = true } = {}) {
  let finalHTML = html;
  if (autoPrint && !/window\.print\(\)/.test(html)) {
    finalHTML = html.replace(
      '</body>',
      `<script>window.onload = () => setTimeout(() => { try { window.focus(); window.print(); } catch(e){} }, 350);</script></body>`
    );
  }
  const blob = new Blob([finalHTML], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return win;
}

/** Layout (fontes/medidas) por largura de bobina. Em mm e px. */
export function thermalLayout(widthMM) {
  if (widthMM === '80') {
    return {
      widthMM: 80,
      fontBase: 13, fontLabel: 12, fontVal: 16, fontValMd: 13,
      fontNum: 22, fontHead: 14, fontHeadSub: 11, fontDate: 12,
      fontHint: 11, fontSign: 11, fontFooter: 11,
      qrSize: '60mm', gridGap: '10px',
    };
  }
  return {
    widthMM: 58,
    fontBase: 12, fontLabel: 11, fontVal: 14, fontValMd: 12,
    fontNum: 18, fontHead: 12, fontHeadSub: 10, fontDate: 11,
    fontHint: 10, fontSign: 10, fontFooter: 10,
    qrSize: '44mm', gridGap: '6px',
  };
}

/** CSS comum (mesmo do HTML "print preview"). */
export function thermalCSS(L) {
  // Padding lateral pequeno; bordas físicas da impressora já têm margem.
  return `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family:'Consolas','Monaco','Courier New',monospace;
      color:#000; margin:0; padding:2mm 3mm;
      font-size:${L.fontBase}px; line-height:1.5;
      width:${L.widthMM}mm; word-break:break-word;
      background:#fff;
    }
    .center { text-align:center; }
    .bold { font-weight:700; }
    .sep { border-top:1px dashed #000; margin:6px 0; }
    .head-title { font-size:${L.fontHead}px; font-weight:700; }
    .head-sub { font-size:${L.fontHeadSub}px; margin-top:2px; }
    .num { font-size:${L.fontNum}px; font-weight:700; letter-spacing:1px; margin:3px 0; }
    .date-line { font-size:${L.fontDate}px; }
    .cancel { border:2px solid #000; padding:5px; margin:6px 0; font-weight:900; font-size:${L.fontVal}px; letter-spacing:2px; text-align:center; }
    img.qr { width:${L.qrSize}; height:${L.qrSize}; margin:8px auto 4px; display:block; background:#fff; padding:2mm; }
    .qr-hint { text-align:center; font-size:${L.fontHint}px; margin-bottom:2px; }
    .lbl { color:#000; font-weight:700; display:block; font-size:${L.fontLabel}px; }
    .val { display:block; font-size:${L.fontVal}px; font-weight:700; margin-top:1px; word-break:break-word; }
    .val-md { display:block; font-size:${L.fontValMd}px; margin-top:1px; word-break:break-word; }
    .row { margin-bottom:5px; }
    .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:${L.gridGap}; margin-top:4px; }
    .service { background:#000; color:#fff; padding:5px 8px; margin:6px 0; font-weight:700; font-size:${L.fontVal - 1}px; text-align:center; letter-spacing:1px; }
    .sign-block { margin-top:24px; border-top:1px solid #000; padding-top:4px; text-align:center; font-size:${L.fontSign}px; }
    .rubrica { margin-top:14px; border-top:1px solid #000; padding-top:3px; text-align:center; font-size:${L.fontHint}px; }
    .footer { text-align:center; font-size:${L.fontFooter}px; font-weight:700; margin-top:12px; }
  `;
}

/** Renderiza o HTML offscreen, captura como canvas e gera PDF programático
 *  com dimensões físicas exatas da bobina térmica.
 *  Mostra o resultado em MODAL DENTRO do app, com botões "Imprimir" e
 *  "Compartilhar" (Web Share API → menu nativo de apps de impressora).
 *
 *  Por que PDF programático: apps de impressora térmica Bluetooth ignoram
 *  @page CSS. Tratam o PDF como ISO/A4 e imprimem o conteúdo minúsculo.
 *  Com PDF programático, o tamanho da página vai EXATO na metadata e os apps
 *  respeitam — usando toda a folha térmica disponível.
 */
export async function openThermalPDF(bodyHTML, { title = 'Impressão', width } = {}) {
  const widthChoice = width || getThermalWidth();
  const L = thermalLayout(widthChoice);
  const css = thermalCSS(L);

  // 1. Abre modal de loading IMEDIATAMENTE (feedback visual instantâneo)
  const loadingBody = `
    <div class="thermal-loading" style="text-align:center;padding:var(--s-6) var(--s-4)">
      <div class="spinner-lg"></div>
      <p style="margin-top:var(--s-4);color:var(--text-soft);font-size:13px">
        Gerando recibo térmico (${L.widthMM}mm)...
      </p>
    </div>`;
  const m = openModal({ title, body: loadingBody, size: 'lg', footer: '' });

  // 2. Render offscreen em iframe isolado
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${L.widthMM}mm;height:10mm;border:0;background:#fff;`;
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${bodyHTML}</body></html>`);
  doc.close();

  // Aguarda o QR (img base64) decodificar antes de capturar
  try {
    await Promise.all(
      Array.from(doc.images || []).map(img => img.complete
        ? Promise.resolve()
        : new Promise(r => { img.onload = img.onerror = r; })
      )
    );
  } catch {}
  iframe.style.height = doc.body.scrollHeight + 'px';

  let blob, pdfUrl, dataUrl;
  try {
    // 3. Captura como canvas. scale:2 é nítido o suficiente e ~2x mais rápido
    //    que scale:3 em iPhones. JPEG quality 0.9 reduz o PDF em ~70%.
    const canvas = await html2canvas(doc.body, {
      scale: 2,
      backgroundColor: '#ffffff',
      width: doc.body.scrollWidth,
      height: doc.body.scrollHeight,
      windowWidth: doc.body.scrollWidth,
      windowHeight: doc.body.scrollHeight,
      logging: false,
    });

    const heightMM = (canvas.height * L.widthMM) / canvas.width;
    dataUrl = canvas.toDataURL('image/jpeg', 0.9);

    const pdf = new jsPDF({
      unit: 'mm',
      format: [L.widthMM, heightMM],
      orientation: 'portrait',
      compress: true,
    });
    pdf.addImage(dataUrl, 'JPEG', 0, 0, L.widthMM, heightMM);
    blob = pdf.output('blob');
    pdfUrl = URL.createObjectURL(blob);
  } catch (err) {
    document.body.removeChild(iframe);
    const body = m.querySelector('.modal-body');
    if (body) body.innerHTML = `<p style="color:var(--danger);text-align:center;padding:var(--s-4)">Falha ao gerar o recibo: ${esc(err.message || err)}</p>`;
    return;
  }
  document.body.removeChild(iframe);

  // 4. Substitui o conteúdo do modal por preview + ações
  const body = m.querySelector('.modal-body');
  if (!body) { URL.revokeObjectURL(pdfUrl); return; } // modal foi fechado durante a geração

  const hasShare = typeof navigator.share === 'function';
  body.innerHTML = `
    <div class="thermal-preview-wrap">
      <div class="thermal-preview-paper">
        <img src="${dataUrl}" alt="Pré-visualização" class="thermal-preview-img">
      </div>
      <p class="thermal-hint">
        Toque em <b>Imprimir</b> para enviar à impressora térmica${hasShare ? ' ou <b>Compartilhar</b> com o app da sua impressora' : ''}.
      </p>
    </div>`;
  // Footer: insere se não existir, ou atualiza
  let foot = m.querySelector('.modal-footer');
  if (!foot) {
    foot = document.createElement('div');
    foot.className = 'modal-footer';
    m.querySelector('.modal').appendChild(foot);
  }
  foot.innerHTML = `
    <button class="btn btn-outline" data-close-th>Fechar</button>
    ${hasShare ? `<button class="btn btn-outline" data-share-th>${icons?.share || '📤'} Compartilhar</button>` : ''}
    <button class="btn btn-primary" data-print-th>${icons?.printer || '🖨️'} Imprimir</button>
  `;

  const cleanup = () => { URL.revokeObjectURL(pdfUrl); };
  foot.querySelector('[data-close-th]').addEventListener('click', () => { cleanup(); closeModal(); });
  foot.querySelector('[data-print-th]').addEventListener('click', () => {
    // Abre o PDF em nova aba — no iPhone aparece o viewer com botão Compartilhar.
    // No Android Chrome, o viewer também tem botão Imprimir.
    window.open(pdfUrl, '_blank');
  });
  const shareBtn = foot.querySelector('[data-share-th]');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      try {
        const file = new File([blob], `${title.replace(/[^\w-]/g,'_')}.pdf`, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title });
        } else if (navigator.share) {
          // Fallback: compartilha só o título (sem arquivo) — raro
          await navigator.share({ title, text: title });
        } else {
          window.open(pdfUrl, '_blank');
        }
      } catch (err) {
        // User cancelou — ignora
        if (err?.name !== 'AbortError') console.warn('share error:', err);
      }
    });
  }
}

