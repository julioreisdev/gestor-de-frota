// Helpers de UI: toast, modal, confirm, escape, format.
import { icons } from './icons.js';

// =================== ESCAPE / FORMAT ===================
export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s + (s.length === 10 ? 'T00:00' : ''));
  return d.toLocaleDateString('pt-BR');
};
export const fmtMoney = (n) => 'R$ ' + Number(n || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

// Placa: armazena sempre sem hífen; exibe com hífen quando é formato antigo.
export const cleanPlate = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export function formatPlate(s) {
  const c = cleanPlate(s);
  if (/^[A-Z]{3}[0-9]{4}$/.test(c)) return c.slice(0, 3) + '-' + c.slice(3);
  return c; // Mercosul (ABC1D23) ou inválido — devolve cru
}

/** Label rico para options/dropdowns de fornecedor.
 *  Depois que passamos a permitir mesmo CNPJ em secretarias diferentes,
 *  a listagem ficava com nomes idênticos ("POSTO B & B LTDA" 4×) sem forma
 *  de distinguir. Este helper adiciona sigla da secretaria e nº do contrato
 *  entre parênteses, quando disponíveis, pra o usuário identificar de bate-pronto.
 *
 *  Espera receber o objeto supplier com pelo menos:
 *    { trade_name, legal_name, department:{acronym}?, contract_number? }
 *  O join `department:department_id(acronym)` da query Supabase já entrega
 *  esse shape.
 */
export function supplierOptionLabel(s) {
  const nome = s?.trade_name || s?.legal_name || '—';
  const sec = s?.department?.acronym || null;
  const contrato = (s?.contract_number || '').trim() || null;
  const parts = [];
  if (sec) parts.push(sec);
  if (contrato) parts.push('nº ' + contrato);
  return parts.length ? `${nome} (${parts.join(' · ')})` : nome;
}

/** HTML seguro para célula de tabela de fornecedor.
 *  Linha 1: nome do fornecedor (do snapshot ou do supplier atual — nesta ordem).
 *  Linha 2 (só se disponível): "SIGLA · nº contrato" em fonte menor/cor suave.
 *  Usa .cell-stack para se comportar bem em mobile (vira card).
 *
 *  @param {string} snapshotName  — nome já gravado na tabela (fallback confiável)
 *  @param {object|null} supplier — objeto supplier com department + contract_number,
 *    quando disponível pra enriquecer com a secretaria/contrato atuais
 */
export function supplierCellHTML(snapshotName, supplier) {
  const nome = snapshotName || supplier?.trade_name || supplier?.legal_name || '—';
  const sec = supplier?.department?.acronym || null;
  const contrato = (supplier?.contract_number || '').trim() || null;
  const parts = [];
  if (sec) parts.push(sec);
  if (contrato) parts.push('nº ' + contrato);
  if (!parts.length) return esc(nome);
  return `<div class="cell-stack">
    <span style="font-size:12.5px">${esc(nome)}</span>
    <span style="font-size:11px;color:var(--text-muted);line-height:1.35">${esc(parts.join(' · '))}</span>
  </div>`;
}

// =================== TOAST ===================
let toastSeq = 0;
export function toast(message, type = 'info', ms = 3500) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const id = 'toast-' + (++toastSeq);
  const cls = type === 'success' ? 'toast-success'
            : type === 'error'   ? 'toast-error'
            : type === 'warning' ? 'toast-warning' : '';
  const el = document.createElement('div');
  el.className = `toast ${cls}`;
  el.id = id;
  el.innerHTML = esc(message);
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 200);
  }, ms);
}

// =================== MODAL ===================
let openModalEl = null;
export function openModal({ title, body, size = '', footer = '', onClose }) {
  closeModal();
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${size === 'lg' ? 'modal-lg' : ''}" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h2 class="modal-title">${esc(title)}</h2>
        <button class="modal-close" aria-label="Fechar" data-close>${icons.close}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
    </div>`;
  root.appendChild(wrap);
  openModalEl = wrap;
  // close handlers — só fecha pelo botão X ou Cancelar (cliente pediu pra não
  // fechar ao clicar fora nem ao apertar Esc, evita fechamento acidental
  // por usuário menos experiente que perde dados do formulário).
  const close = () => { closeModal(); onClose && onClose(); };
  wrap.querySelector('[data-close]').addEventListener('click', close);
  wrap._closeFn = close;
  // foco no primeiro input
  setTimeout(() => {
    const f = wrap.querySelector('input,select,textarea,button:not(.modal-close)');
    f && f.focus();
  }, 50);
  return wrap;
}
export function closeModal() {
  if (!openModalEl) return;
  openModalEl.remove();
  openModalEl = null;
}

// =================== CONFIRM ===================
export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const footer = `
      <button class="btn btn-outline" data-cancel>${esc(cancelText)}</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmText)}</button>`;
    const m = openModal({
      title, body: `<p style="color:var(--text-soft);font-size:13.5px;line-height:1.55">${esc(message)}</p>`,
      footer, onClose: () => resolve(false),
    });
    m.querySelector('[data-cancel]').addEventListener('click', () => { closeModal(); resolve(false); });
    m.querySelector('[data-ok]').addEventListener('click', () => { closeModal(); resolve(true); });
  });
}

// =================== HELPERS DOM ===================
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

/** Pega valores de um form como objeto */
export function formValues(form) {
  const data = {};
  for (const [k, v] of new FormData(form).entries()) data[k] = v;
  return data;
}
