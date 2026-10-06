// Leitura da CNH Digital (PDF) para preencher o cadastro de motorista.
// Tudo acontece no navegador: o arquivo não é enviado a servidor nem guardado.
//
// O PDF exportado da Carteira Digital de Trânsito reproduz a carteira: cada
// rótulo (ex.: "Nº REGISTRO") em letra pequena e o valor logo abaixo, como no
// CRLV. A leitura de PDF e a busca "valor abaixo do rótulo" são as do crlv.js;
// aqui ficam só os rótulos da CNH e a conferência dos formatos.
import { readItems, valueBelowItem } from './crlv.js';
import { isValidCPF } from './ui.js';
import { CNH_CATEGORIES, STATES } from './drivers.js';

/** Chave de comparação de rótulo: só letras e dígitos, sem acento, caixa alta
 *  ("Nº REGISTRO", "N° REGISTRO" e "No. Registro" dão a mesma chave). */
const key = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[ºª°]/g, '').replace(/[^A-Z0-9]/g, '');

const filled = (s) => !!s && !/^[*\s/.-]*$/.test(s);

/** Primeiro item cujo texto é um dos rótulos (a CNH tem versões com
 *  rótulos um pouco diferentes). */
function findLabel(items, labels) {
  const keys = labels.map(key);
  return items.find(i => keys.includes(key(i.text)));
}

/** Valor do rótulo: abaixo dele (padrão da carteira) ou, se não houver, à
 *  direita na mesma linha. */
function valueOf(items, labels) {
  const lab = findLabel(items, labels);
  if (!lab) return '';
  const below = valueBelowItem(items, lab);
  if (filled(below)) return below;
  const right = items
    .filter(i => i !== lab && Math.abs(i.y - lab.y) < 2 && i.x > lab.x + lab.w - 1 && i.x - (lab.x + lab.w) < 40)
    .sort((a, b) => a.x - b.x)[0];
  return filled(right?.text) ? right.text : '';
}

/** "dd/mm/aaaa" → "aaaa-mm-dd", ou '' se não for data válida. */
export function isoDate(s) {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(String(s || ''));
  if (!m) return '';
  const [, d, mo, y] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  if (dt.getUTCFullYear() !== +y || dt.getUTCMonth() !== +mo - 1 || dt.getUTCDate() !== +d) return '';
  if (+y < 1900 || +y > 2100) return '';
  return `${y}-${mo}-${d}`;
}

/** "1234567 SSP PI" → { rg, issuer, state }. */
export function parseIdentity(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return {};
  const m = /^([A-Z0-9.\-/]+)\s+([A-Z][A-Z\-/.]*(?:\s[A-Z][A-Z\-/.]*)*?)\s+([A-Z]{2})$/i.exec(t);
  if (m && STATES.includes(m[3].toUpperCase())) {
    return { rg: m[1], issuer: m[2].toUpperCase(), state: m[3].toUpperCase() };
  }
  const parts = t.split(' ');
  return { rg: parts[0], issuer: parts.slice(1).join(' ').toUpperCase() || undefined };
}

/** Categoria do campo "CAT. HAB." → uma das categorias do cadastro. */
export function categoryOf(text) {
  const t = String(text || '').toUpperCase().replace(/[^A-E]/g, '');
  if (!t) return null;
  if (CNH_CATEGORIES.includes(t)) return t;
  // "A/B", "A B" → AB
  const sorted = [...new Set(t.split(''))].sort().join('');
  return CNH_CATEGORIES.includes(sorted) ? sorted : null;
}

/**
 * Lê a CNH Digital. Devolve os dados encontrados, no formato do cadastro:
 * { full_name, cpf, birth_date, rg, rg_issuer, cnh_number, cnh_category,
 *   cnh_expiry, cnh_first_issue, cnh_state, cnh_paid_activity, issue_date }
 * Campos não encontrados ficam ausentes. Lança Error com mensagem para o usuário.
 */
export async function readCNH(file) {
  if (!file) throw new Error('Nenhum arquivo selecionado.');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf) throw new Error('Selecione o arquivo PDF da CNH Digital.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Arquivo grande demais para uma CNH (acima de 15 MB).');

  const items = await readItems(file, 3);
  if (!items.length) {
    throw new Error('Este PDF não tem texto: parece uma foto ou digitalização. Use a CNH Digital exportada do app Carteira Digital de Trânsito ou do gov.br, ou preencha os campos à mão.');
  }
  const all = key(items.map(i => i.text).join(' '));
  if (!all.includes('HABILITACAO') && !all.includes('REGISTRO')) {
    throw new Error('Este PDF não parece ser uma CNH Digital. Confira o arquivo.');
  }

  const get = (...labels) => { const v = valueOf(items, labels); return filled(v) ? v.replace(/\s+/g, ' ').trim() : ''; };
  const out = {};

  const name = get('NOME E SOBRENOME', 'NOME');
  if (name.length >= 3 && /^[A-ZÀ-Ü' .-]+$/i.test(name)) out.full_name = name.slice(0, 120);

  // CPF: pelo rótulo; sem rótulo, o único CPF válido do texto
  let cpf = get('CPF').replace(/\D/g, '');
  if (cpf.length !== 11) {
    const found = [...new Set((items.map(i => i.text).join(' ').match(/\d{3}\.\d{3}\.\d{3}-\d{2}/g) || []).map(s => s.replace(/\D/g, '')))];
    cpf = found.length === 1 ? found[0] : '';
  }
  if (cpf.length === 11 && isValidCPF(cpf)) out.cpf = cpf;

  const birth = isoDate(get('DATA NASCIMENTO', 'DATA DE NASCIMENTO'));
  if (birth) out.birth_date = birth;

  const id = parseIdentity(get('DOC. IDENTIDADE / ÓRG. EMISSOR / UF', 'DOC. IDENTIDADE/ÓRG. EMISSOR/UF', 'DOC. IDENTIDADE / ORG. EMISSOR / UF', 'DOC IDENTIDADE ORG EMISSOR UF'));
  if (id.rg && /\d/.test(id.rg)) out.rg = id.rg.slice(0, 20);
  if (id.issuer) out.rg_issuer = (id.issuer + (id.state ? '-' + id.state : '')).slice(0, 20);

  // Registro: 11 dígitos pelo rótulo; sem rótulo, o único número de 11 dígitos
  // que não é o CPF (a CNH tem outros números: espelho, RENACH, segurança)
  let reg = get('Nº REGISTRO', 'N REGISTRO', 'NO REGISTRO', 'NUMERO REGISTRO', 'REGISTRO').replace(/\D/g, '');
  if (reg.length !== 11) {
    const nums = [...new Set(items.map(i => i.text.replace(/\D/g, '')).filter(d => d.length === 11 && d !== cpf))];
    reg = nums.length === 1 ? nums[0] : '';
  }
  if (reg.length === 11) out.cnh_number = reg;

  const cat = categoryOf(get('CAT. HAB.', 'CAT HAB', 'CATEGORIA'));
  if (cat) out.cnh_category = cat;

  const expiry = isoDate(get('VALIDADE'));
  if (expiry) out.cnh_expiry = expiry;
  const first = isoDate(get('1ª HABILITAÇÃO', '1A HABILITAÇÃO', 'PRIMEIRA HABILITAÇÃO'));
  if (first) out.cnh_first_issue = first;
  const issue = isoDate(get('DATA EMISSÃO', 'DATA DE EMISSÃO'));
  if (issue) out.issue_date = issue;

  // UF emissora: no campo "LOCAL" ("TERESINA, PI"); senão a UF do documento de identidade
  const local = get('LOCAL');
  const uf = /([A-Z]{2})\s*$/i.exec(local)?.[1]?.toUpperCase();
  if (uf && STATES.includes(uf)) out.cnh_state = uf;
  else if (id.state) out.cnh_state = id.state;

  // Atividade remunerada: "EAR" ou "EXERCE ATIVIDADE REMUNERADA" nas observações
  const obs = key(get('OBSERVAÇÕES', 'OBSERVACOES'));
  if (obs) out.cnh_paid_activity = /EAR|ATIVIDADEREMUNERADA/.test(obs);

  if (!out.cpf && !out.cnh_number && !out.full_name) {
    throw new Error('Não foi possível ler nome, CPF nem registro deste PDF. Confira se é a CNH Digital, ou preencha à mão.');
  }
  return out;
}
