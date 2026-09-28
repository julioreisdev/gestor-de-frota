// =============================================================================
// FATURAMENTO › Termo de Recebimento Definitivo
// Gerado a partir de uma Ordem de Fornecimento emitida, quando a nota chega.
// A tela calcula só para mostrar; quem calcula e grava é o banco.
// =============================================================================
import { supabase } from '../supabase.js';
import { esc, toast, fmtDate, openModal, closeModal } from '../ui.js';
import { icons } from '../icons.js';
import {
  fmtLiters, fmtPrice, fmtInt, fmtAmount, fmtCents, localToday, billingError, withTimeout,
  priceToMilli, toCenti, amountCents, TERM_STATUS,
} from '../billing.js';
import { printReceiptTerm } from '../billing_docs.js';

const ico = (name, size = 16) => `<span style="width:${size}px;height:${size}px;display:inline-flex">${icons[name]}</span>`;

function orderSummaryHTML(o) {
  return `
    <div class="of-summary trm-summary">
      <div><span>Ordem</span><strong class="of-mono">${esc(o.number)}</strong></div>
      <div><span>Secretaria</span><strong>${esc(o.department_acronym_snapshot)}</strong></div>
      <div><span>Fornecedor</span><strong>${esc(o.supplier_name_snapshot)}</strong></div>
      <div><span>Contrato</span><strong>${esc(o.contract_number_snapshot || '—')}</strong></div>
      <div><span>Período</span><strong>${esc(fmtDate(o.period_start))} a ${esc(fmtDate(o.period_end))}</strong></div>
      <div><span>Quantidade</span><strong>${fmtLiters(o.total_liters)} L · ${fmtInt(o.total_fuelings)} abast.</strong></div>
    </div>`;
}

// =============================================================================
// GERAR TERMO
// =============================================================================
export async function openTermModal(order, onDone) {
  const m = openModal({
    title: 'Gerar Termo de Recebimento',
    size: 'lg',
    body: `
      ${orderSummaryHTML(order)}
      <div id="trm-body">
        <div class="skeleton skeleton-line w-40"></div>
        <div class="skeleton skeleton-line w-80" style="margin-top:12px"></div>
        <div class="skeleton skeleton-line w-60" style="margin-top:8px"></div>
      </div>`,
    footer: `<button class="btn btn-outline" data-cancel>Cancelar</button>
             <button class="btn btn-primary" id="trm-emit" disabled>Emitir termo</button>`,
  });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  const body = m.querySelector('#trm-body');

  let items, sup, fuels, lines;
  try {
    const [i, s, f, l] = await withTimeout(Promise.all([
      supabase.from('supply_order_item')
        .select('id, fuel_type_code, fuel_subtype_id, fuel_label, fuelings_count, liters')
        .eq('supply_order_id', order.id),
      supabase.from('supplier')
        .select('id, price_type, fiscal_name, fiscal_registration, fiscal_ordinance')
        .eq('id', order.supplier_id).maybeSingle(),
      supabase.from('supplier_fuel')
        .select('fuel_type_code, fuel_subtype_id, unit_price')
        .eq('supplier_id', order.supplier_id),
      supabase.rpc('supply_order_fuelings', { p_order: order.id }),
    ]));
    const err = i.error || s.error || f.error || l.error;
    if (err) throw err;
    items = [...(i.data || [])].sort((a, b) => String(a.fuel_label).localeCompare(String(b.fuel_label)));
    sup = s.data || {}; fuels = f.data || []; lines = l.data || [];
  } catch (e) {
    if (!body.isConnected) return;
    body.innerHTML = `<div class="nof-notice is-block"><span class="nof-notice-icon">${icons.alert}</span>
      <div class="nof-notice-body"><strong>Não foi possível carregar a ordem</strong><span>${esc(billingError(e))}</span></div></div>`;
    return;
  }
  if (!body.isConnected) return;

  const fixed = sup.price_type !== 'desconto_bomba';
  const today = localToday();
  const sameFuel = (a, b) => a.fuel_type_code === b.fuel_type_code && (a.fuel_subtype_id ?? null) === (b.fuel_subtype_id ?? null);

  // Preço sugerido (só contrato de preço fixo) e preços lançados nos abastecimentos
  const initialPrice = (it) => {
    if (!fixed) return '';
    const c = fuels.find(f => sameFuel(f, it) && Number(f.unit_price) > 0)
           || fuels.find(f => f.fuel_type_code === it.fuel_type_code && f.fuel_subtype_id == null && Number(f.unit_price) > 0);
    return c ? Number(c.unit_price).toFixed(3) : '';
  };
  const divergent = items.map(it => {
    const ps = [...new Set(lines.filter(l => sameFuel(l, it) && Number(l.unit_price) > 0).map(l => Number(l.unit_price).toFixed(3)))].sort();
    return ps.length > 1 ? { label: it.fuel_label, prices: ps } : null;
  }).filter(Boolean);

  body.innerHTML = `
    <form id="trm-form" autocomplete="off" novalidate>
      <div class="trm-section">Nota fiscal e empenho</div>
      <div class="trm-fields">
        <div class="field">
          <label class="field-label" for="trm-nf">Nota fiscal nº <span class="req">*</span></label>
          <input class="input" id="trm-nf" maxlength="30" placeholder="ex: 4.512">
        </div>
        <div class="field">
          <label class="field-label" for="trm-series">Série <span class="nof-opt">(opcional)</span></label>
          <input class="input" id="trm-series" maxlength="10" placeholder="ex: 1">
        </div>
        <div class="field">
          <label class="field-label" for="trm-nfdate">Data da nota <span class="req">*</span></label>
          <input class="input" type="date" id="trm-nfdate" min="${esc(order.period_end)}" max="${today}">
          <span class="field-error" id="trm-nfdate-err" hidden></span>
        </div>
        <div class="field">
          <label class="field-label" for="trm-nfamount">Valor da nota (R$) <span class="nof-opt">(opcional)</span></label>
          <input class="input" type="number" inputmode="decimal" step="0.01" min="0.01" id="trm-nfamount" placeholder="para conferência">
        </div>
        <div class="field">
          <label class="field-label" for="trm-commitment">Nota de empenho nº <span class="req">*</span></label>
          <input class="input" id="trm-commitment" maxlength="30" value="${esc(order.commitment_number || '')}" placeholder="ex: 2026/000123">
        </div>
        <div class="field">
          <label class="field-label" for="trm-issue">Data do termo <span class="req">*</span></label>
          <input class="input" type="date" id="trm-issue" value="${today}" min="${esc(order.issue_date)}" max="${today}">
          <span class="field-error" id="trm-issue-err" hidden></span>
        </div>
      </div>

      <div class="trm-section">Preço por litro</div>
      <p class="trm-hint">${fixed
        ? 'Contrato de preço fixo: o preço vem do cadastro do contrato. Confira com a nota fiscal e ajuste se for preciso.'
        : 'Contrato por desconto sobre o preço de bomba: informe o preço líquido que consta na nota fiscal.'}</p>
      <div class="table-wrap">
        <table class="table nof-table trm-table">
          <thead><tr>
            <th>Combustível</th><th class="num">Abast.</th><th class="num">Litros</th>
            <th class="num">Preço (R$/L) <span class="req">*</span></th><th class="num">Valor (R$)</th>
          </tr></thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td data-label="Combustível"><strong>${esc(it.fuel_label)}</strong></td>
                <td data-label="Abast." class="num">${fmtInt(it.fuelings_count)}</td>
                <td data-label="Litros" class="num">${fmtLiters(it.liters)}</td>
                <td data-label="Preço (R$/L)" class="num">
                  <input class="input trm-price" type="number" inputmode="decimal" step="0.001" min="0.001" max="99999.999"
                         data-price="${it.id}" value="${initialPrice(it)}" placeholder="0,000"
                         aria-label="Preço por litro de ${esc(it.fuel_label)}">
                </td>
                <td data-label="Valor (R$)" class="num"><span data-amount="${it.id}">—</span></td>
              </tr>`).join('')}
            <tr class="nof-total">
              <td data-label="Combustível">Total</td>
              <td data-label="Abast." class="num">${fmtInt(order.total_fuelings)}</td>
              <td data-label="Litros" class="num">${fmtLiters(order.total_liters)}</td>
              <td data-label="Preço (R$/L)" class="num trm-blank"></td>
              <td data-label="Valor (R$)" class="num"><span id="trm-total">—</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      ${divergent.length ? `
        <div class="nof-warn">
          <span class="nof-warn-icon">${icons.alert}</span>
          <div>Os abastecimentos desta ordem foram lançados com preços diferentes:
            ${divergent.map(d => `<strong>${esc(d.label)}</strong> a ${d.prices.map(p => 'R$ ' + fmtPrice(p)).join(' e ')}`).join('; ')}.
            O termo usa um preço só por combustível: o da nota fiscal.</div>
        </div>` : ''}
      <div id="trm-diff"></div>

      <div class="trm-section">Fiscal do contrato</div>
      <div class="trm-fields">
        <div class="field trm-col-2">
          <label class="field-label" for="trm-fiscal">Nome <span class="req">*</span></label>
          <input class="input" id="trm-fiscal" maxlength="150" value="${esc(sup.fiscal_name || '')}">
        </div>
        <div class="field">
          <label class="field-label" for="trm-fiscal-reg">Matrícula</label>
          <input class="input" id="trm-fiscal-reg" maxlength="30" value="${esc(sup.fiscal_registration || '')}">
        </div>
        <div class="field trm-col-3">
          <label class="field-label" for="trm-fiscal-ord">Portaria de designação</label>
          <input class="input" id="trm-fiscal-ord" maxlength="150" value="${esc(sup.fiscal_ordinance || '')}" placeholder="ex: Portaria nº 015/2026">
          ${sup.fiscal_name ? '' : '<span class="field-help">Para vir preenchido nos próximos termos, cadastre o fiscal no contrato (Faturamento › Configuração).</span>'}
        </div>
      </div>

      <div class="trm-missing" id="trm-missing"></div>
      <div id="trm-error" class="login-error" style="display:none;margin-top:12px"></div>
    </form>`;

  const $ = (id) => m.querySelector('#' + id);
  const emitBtn = $('trm-emit');
  const val = (id) => $(id).value.trim();
  let confirmDiff = false;

  const setFieldError = (id, msg) => {
    const e = $(id + '-err');
    e.textContent = msg || ''; e.hidden = !msg;
    $(id).classList.toggle('is-invalid', !!msg);
  };

  function compute() {
    let total = 0, allPriced = true;
    const prices = {};
    items.forEach(it => {
      const input = m.querySelector(`[data-price="${it.id}"]`);
      const milli = priceToMilli(input.value);
      const out = m.querySelector(`[data-amount="${it.id}"]`);
      if (milli && milli > 0) {
        const c = amountCents(it.liters, milli);
        total += c; prices[it.id] = milli / 1000;
        out.textContent = fmtCents(c);
      } else { allPriced = false; out.textContent = '—'; }
    });
    $('trm-total').textContent = allPriced ? fmtCents(total) : '—';
    return { total, allPriced, prices };
  }

  function refresh() {
    const { total, allPriced, prices } = compute();
    const missing = [];
    if (!val('trm-nf')) missing.push('nº da nota fiscal');

    const nfDate = val('trm-nfdate'), issue = val('trm-issue');
    let nfErr = '', issueErr = '';
    if (!nfDate) missing.push('data da nota');
    else if (nfDate < order.period_end) nfErr = `Não pode ser anterior ao fim do período (${fmtDate(order.period_end)}).`;
    else if (nfDate > today) nfErr = 'Não pode ser futura.';
    if (!issue) missing.push('data do termo');
    else if (issue > today) issueErr = 'Não pode ser futura.';
    else if (issue < order.issue_date) issueErr = `Não pode ser anterior à emissão da ordem (${fmtDate(order.issue_date)}).`;
    else if (nfDate && !nfErr && issue < nfDate) issueErr = 'Não pode ser anterior à data da nota.';
    setFieldError('trm-nfdate', nfErr); setFieldError('trm-issue', issueErr);

    if (!val('trm-commitment')) missing.push('empenho');
    items.forEach(it => { if (!prices[it.id]) missing.push(`preço de ${it.fuel_label}`); });
    if (!val('trm-fiscal')) missing.push('nome do fiscal');

    // Conferência com o valor da nota
    const nfRaw = val('trm-nfamount');
    const nfCents = nfRaw ? toCenti(nfRaw) : null;
    let nfAmountErr = false, needConfirm = false;
    const diffBox = $('trm-diff');
    if (nfRaw && (!nfCents || nfCents <= 0)) { nfAmountErr = true; diffBox.innerHTML = ''; }
    else if (nfCents && allPriced && nfCents !== total) {
      needConfirm = true;
      const d = nfCents - total;
      diffBox.innerHTML = `
        <div class="nof-warn trm-diff">
          <span class="nof-warn-icon">${icons.alert}</span>
          <div>
            <div>A nota fiscal (<strong>R$ ${fmtCents(nfCents)}</strong>) está
              <strong>R$ ${fmtCents(Math.abs(d))} ${d > 0 ? 'acima' : 'abaixo'}</strong> do total calculado
              (<strong>R$ ${fmtCents(total)}</strong>). Confira os preços por litro.</div>
            <label class="trm-check">
              <input type="checkbox" id="trm-confirm" ${confirmDiff ? 'checked' : ''}>
              <span>Emitir mesmo assim, pelo total calculado</span>
            </label>
          </div>
        </div>`;
    } else if (nfCents && allPriced) {
      diffBox.innerHTML = `
        <div class="nof-warn trm-diff is-ok">
          <span class="nof-warn-icon">${icons.check}</span>
          <div>O total calculado confere com o valor da nota fiscal.</div>
        </div>`;
    } else diffBox.innerHTML = '';
    if (!needConfirm) confirmDiff = false;
    $('trm-nfamount').classList.toggle('is-invalid', nfAmountErr);

    const blocked = missing.length || nfErr || issueErr || nfAmountErr || (needConfirm && !confirmDiff);
    emitBtn.disabled = !!blocked;
    const box = $('trm-missing');
    if (missing.length) box.textContent = 'Falta informar: ' + missing.join(', ') + '.';
    else if (nfAmountErr) box.textContent = 'O valor da nota fiscal deve ser maior que zero.';
    else if (nfErr || issueErr) box.textContent = 'Corrija as datas destacadas.';
    else if (needConfirm && !confirmDiff) box.textContent = 'Confirme a emissão com a diferença ou corrija os preços.';
    else box.textContent = '';
    return { total, prices };
  }

  const form = $('trm-form');
  form.addEventListener('input', (e) => {
    if (e.target.id === 'trm-confirm') return;
    // mudou preço ou valor da nota: a diferença é outra, a confirmação anterior não vale
    if (e.target.id === 'trm-nfamount' || e.target.dataset.price) confirmDiff = false;
    refresh();
  });
  form.addEventListener('change', (e) => {
    if (e.target.id === 'trm-confirm') confirmDiff = e.target.checked;
    refresh();
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); if (!emitBtn.disabled) emit(); });
  emitBtn.addEventListener('click', emit);
  refresh();

  async function emit() {
    const { total, prices } = refresh();
    if (emitBtn.disabled) return;
    const errBox = $('trm-error');
    errBox.style.display = 'none';
    emitBtn.disabled = true; emitBtn.innerHTML = '<span class="spinner"></span> Emitindo';
    const nfRaw = val('trm-nfamount');
    let res;
    try {
      res = await withTimeout(supabase.rpc('emit_receipt_term', {
        p_order: order.id,
        p_invoice_number: val('trm-nf'),
        p_invoice_date: val('trm-nfdate'),
        p_prices: prices,
        p_fiscal_name: val('trm-fiscal'),
        p_invoice_series: val('trm-series') || null,
        p_invoice_amount: nfRaw ? toCenti(nfRaw) / 100 : null,
        p_issue_date: val('trm-issue'),
        p_commitment: val('trm-commitment'),
        p_fiscal_registration: val('trm-fiscal-reg') || null,
        p_fiscal_ordinance: val('trm-fiscal-ord') || null,
      }), 30000);
    } catch (e) { res = { error: e }; }
    if (!m.isConnected) { if (!res.error) onDone?.(); return; }
    if (res.error) {
      errBox.textContent = billingError(res.error); errBox.style.display = 'block';
      emitBtn.textContent = 'Emitir termo';
      refresh();
      errBox.scrollIntoView({ block: 'nearest' });
      return;
    }
    const termId = res.data;
    // O PDF abre por clique do usuário: aberto sozinho, o navegador bloquearia a aba.
    m.querySelector('.modal-title').textContent = 'Termo de Recebimento emitido';
    m.querySelector('.modal-body').innerHTML = `
      <div class="nof-notice is-ok">
        <span class="nof-notice-icon">${icons.check}</span>
        <div class="nof-notice-body">
          <strong>Termo de Recebimento ${esc(order.number)} emitido</strong>
          <span>Total de R$ ${fmtCents(total)} · nota fiscal nº ${esc(val('trm-nf'))}. A ordem passou a Faturada.</span>
        </div>
      </div>
      <p class="of-modal-text" style="margin-top:var(--s-4)">
        Abra o PDF para imprimir e colher as assinaturas do fiscal e do gestor. O termo também fica disponível na lista de ordens.
      </p>`;
    m.querySelector('.modal-footer').innerHTML = `
      <button class="btn btn-outline" data-cancel>Fechar</button>
      <button class="btn btn-primary" id="trm-open-pdf">${ico('printer')} Abrir PDF do termo</button>`;
    m.querySelector('[data-cancel]').addEventListener('click', closeModal);
    const pdfBtn = m.querySelector('#trm-open-pdf');
    pdfBtn.addEventListener('click', async () => {
      pdfBtn.disabled = true;
      try { await printReceiptTerm(termId); } finally { pdfBtn.disabled = false; }
    });
    toast(`Termo ${order.number} emitido.`, 'success');
    onDone?.();
  }
}

// =============================================================================
// CANCELAR TERMO
// =============================================================================
export function openCancelTermModal(order, term, onDone) {
  const m = openModal({
    title: 'Cancelar Termo de Recebimento',
    body: `
      <div class="of-summary">
        <div><span>Termo</span><strong class="of-mono">${esc(term.number)}</strong></div>
        <div><span>Secretaria</span><strong>${esc(order.department_acronym_snapshot)}</strong></div>
        <div><span>Nota fiscal</span><strong>${esc(term.invoice_number)} · ${esc(fmtDate(term.invoice_date))}</strong></div>
        <div><span>Valor</span><strong>R$ ${fmtAmount(term.total_amount)}</strong></div>
      </div>
      <p class="of-modal-text">
        A ordem <strong>${esc(order.number)}</strong> volta a Emitida e os ${fmtInt(order.total_fuelings)} abastecimentos
        voltam ao preço que tinham antes do termo. Depois disso, um novo termo pode ser gerado, por exemplo
        quando o posto substitui a nota fiscal.
      </p>
      <div class="field">
        <label class="field-label" for="trm-cancel-reason">Justificativa <span class="req">*</span></label>
        <textarea class="textarea" id="trm-cancel-reason" rows="3" maxlength="300"
                  placeholder="ex: nota fiscal substituída pelo posto"></textarea>
      </div>
      <div id="trm-cancel-error" class="login-error" style="display:none;margin-top:12px"></div>`,
    footer: `<button class="btn btn-outline" data-cancel>Voltar</button>
             <button class="btn btn-danger" id="trm-cancel-ok">Cancelar o termo</button>`,
  });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelector('#trm-cancel-ok').addEventListener('click', async () => {
    const btn = m.querySelector('#trm-cancel-ok'), errBox = m.querySelector('#trm-cancel-error');
    const reason = m.querySelector('#trm-cancel-reason').value.trim();
    errBox.style.display = 'none';
    if (reason.length < 5) {
      errBox.textContent = 'Informe a justificativa do cancelamento.'; errBox.style.display = 'block';
      m.querySelector('#trm-cancel-reason').focus();
      return;
    }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Cancelando';
    let error = null;
    try {
      ({ error } = await withTimeout(supabase.rpc('cancel_receipt_term', { p_term: term.id, p_reason: reason })));
    } catch (e) { error = e; }
    if (error) {
      errBox.textContent = billingError(error); errBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Cancelar o termo';
      return;
    }
    closeModal();
    toast(`Termo ${term.number} cancelado. A ordem voltou a Emitida.`, 'success');
    onDone?.();
  });
}

// =============================================================================
// TERMOS DA ORDEM (inclui os cancelados, para consulta)
// =============================================================================
export function openTermHistoryModal(order) {
  const terms = [...(order.terms || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const m = openModal({
    title: `Termos da ordem ${order.number}`,
    body: `
      <p class="of-modal-text">Todos os termos já gerados para esta ordem. Os cancelados continuam disponíveis para consulta.</p>
      <div class="trm-history">
        ${terms.map(t => {
          const st = TERM_STATUS[t.status] || TERM_STATUS.emitido;
          return `
          <div class="trm-history-row">
            <div class="trm-history-main">
              <div class="trm-history-top">
                <span class="${st.badge}">${st.label}</span>
                <strong>NF ${esc(t.invoice_number)}${t.invoice_series ? ' · série ' + esc(t.invoice_series) : ''}</strong>
                <span class="of-sub">${esc(fmtDate(t.invoice_date))}</span>
              </div>
              <div class="of-sub">R$ ${fmtAmount(t.total_amount)} · termo de ${esc(fmtDate(t.issue_date))}${t.fiscal_name ? ' · fiscal ' + esc(t.fiscal_name) : ''}</div>
              ${t.status === 'cancelado' && t.cancel_reason ? `<div class="of-sub">Motivo: ${esc(t.cancel_reason)}</div>` : ''}
            </div>
            <button class="btn btn-outline btn-sm" data-term-pdf="${t.id}">${ico('printer', 14)} PDF</button>
          </div>`;
        }).join('')}
      </div>`,
    footer: `<button class="btn btn-outline" data-cancel>Fechar</button>`,
  });
  m.querySelector('[data-cancel]').addEventListener('click', closeModal);
  m.querySelectorAll('[data-term-pdf]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await printReceiptTerm(b.dataset.termPdf); } finally { b.disabled = false; }
  }));
}
