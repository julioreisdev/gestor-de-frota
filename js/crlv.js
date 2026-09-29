// Leitura do CRLV Digital (PDF) para preencher o cadastro de veículo.
// Tudo acontece no navegador: o arquivo não é enviado a servidor nem guardado.
//
// O CRLV Digital (gov.br / Carteira Digital de Trânsito / Detran) tem texto no
// PDF: cada rótulo (ex.: "CÓDIGO RENAVAM") fica em letra pequena e o valor logo
// abaixo, na mesma coluna, em letra maior. A leitura usa essa posição, e as
// regras de formato (11 dígitos, placa, chassi) conferem o que foi lido.

// pdf.js 3.x: funciona em navegadores mais antigos (iPhone sem iOS 17.4).
// isEvalSupported:false fecha a falha de segurança conhecida dessa versão.
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let _pdfjs = null;
function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = new Promise((resolve, reject) => {
    if (globalThis.pdfjsLib) { resolve(globalThis.pdfjsLib); return; }
    const s = document.createElement('script');
    s.src = PDFJS_URL;
    s.async = true;
    const timer = setTimeout(() => reject(new Error('Tempo esgotado ao carregar o leitor de PDF. Verifique a internet.')), 20000);
    s.onload = () => {
      clearTimeout(timer);
      const lib = globalThis.pdfjsLib;
      if (!lib) { reject(new Error('Não foi possível carregar o leitor de PDF.')); return; }
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(lib);
    };
    s.onerror = () => { clearTimeout(timer); reject(new Error('Não foi possível carregar o leitor de PDF. Verifique a internet.')); };
    document.head.appendChild(s);
  }).catch((e) => { _pdfjs = null; throw e; });
  return _pdfjs;
}

/** Texto em caixa alta, sem acento e com espaços simples. */
export const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/\s+/g, ' ').trim();

/** Valor preenchido de verdade (o CRLV usa asteriscos para campo vazio). */
const filled = (s) => !!s && !/^[*\s/.-]*$/.test(s);

// ---------------------------------------------------------------------------
// Leitura do PDF
// ---------------------------------------------------------------------------
/** Itens de texto da 1ª página, com posição (y cresce para baixo). */
async function readItems(file) {
  const lib = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    pdf = await lib.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error('O PDF está protegido por senha. Baixe o CRLV de novo sem senha.');
    throw new Error('Não foi possível abrir o arquivo. Confira se é um PDF válido.');
  }
  const page = await pdf.getPage(1);
  const h = page.getViewport({ scale: 1 }).height;
  const content = await page.getTextContent();
  const items = content.items
    .filter(i => i.str && i.str.trim())
    .map(i => ({
      text: i.str.trim(),
      x: i.transform[4],
      y: h - i.transform[5],
      w: i.width || 0,
      size: Math.abs(i.transform[3]) || i.height || 0,
    }));
  pdf.destroy();
  return items;
}

/** Valor que fica logo abaixo do rótulo, na mesma coluna. */
function valueBelow(items, label) {
  const target = norm(label);
  const lab = items.find(i => norm(i.text) === target);
  if (!lab) return '';
  const cand = items
    .filter(i => i !== lab && i.size > lab.size + 1 && Math.abs(i.x - lab.x) <= 6 && i.y > lab.y && i.y - lab.y < 32)
    .sort((a, b) => a.y - b.y);
  const first = cand[0];
  if (!first) return '';
  // O mesmo valor pode vir partido em mais de um pedaço na mesma linha
  const line = items
    .filter(i => Math.abs(i.y - first.y) < 1.5 && i.size > lab.size + 1 && i.x >= first.x - 0.5)
    .sort((a, b) => a.x - b.x);
  let text = '', end = first.x;
  for (const it of line) {
    if (it.x - end > 15) break;
    text += (text && it.x - end > 1 ? ' ' : '') + it.text;
    end = it.x + it.w;
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Tradução para os códigos do sistema (tabelas oficiais do TCE-PI)
// ---------------------------------------------------------------------------
/** Combustível do CRLV → tipoCombustivel (1 Gasolina, 2 Álcool, 3 Eletricidade,
 *  4 Diesel, 5 Flex, 6 GNV, 7 Híbrido). null se não reconhecer. */
export function fuelCode(text) {
  const t = norm(text);
  if (!t) return null;
  const has = (k) => t.includes(k);
  const eletrico = has('ELETRIC'), gasolina = has('GASOLINA'), alcool = has('ALCOOL') || has('ETANOL');
  if (eletrico && (gasolina || alcool)) return 7;
  if (eletrico) return 3;
  if (has('DIESEL')) return 4;
  if (gasolina && alcool) return 5;
  if ((has('GAS NATURAL') || has('GNV') || has('METANO')) && !gasolina && !alcool) return 6;
  if (gasolina) return 1;
  if (alcool) return 2;
  return null;
}

/** Espécie/tipo do CRLV → tipoVeiculo. Nunca devolve 99 (Outros tem regras
 *  próprias de placa e RENAVAM): o que não for reconhecido fica para o usuário. */
export function vehicleTypeCode(text) {
  const t = norm(text);
  if (!t) return null;
  if (t.includes('MICROONIBUS') || t.includes('MICRO-ONIBUS') || t.includes('MICRO ONIBUS')) return 3;
  if (t.includes('ONIBUS')) return 2;
  if (t.includes('CAMINHONETE')) return 5;
  if (t.includes('CAMINHAO')) return 4;          // inclui caminhão trator (cavalo mecânico)
  if (t.includes('CAMIONETA')) return 6;
  if (t.includes('UTILITARIO')) return 7;
  if (/MOTOCICLETA|MOTONETA|CICLOMOTOR/.test(t)) return 8;
  if (t.includes('TRATOR')) return 9;
  if (t.includes('AUTOMOVEL')) return 1;
  return null;
}

/** Marca a partir do texto do CRLV: "M.BENZ/ATRON 2729 K 6X4" → "M.BENZ";
 *  importado, "I/TOYOTA COROLLA XEI" → "TOYOTA". */
export function brandOf(model) {
  const m = String(model || '').trim();
  const imported = /^I\s*\//i.test(m);
  const rest = m.replace(/^I\s*\//i, '').trim();
  const i = rest.indexOf('/');
  if (i > 0) return rest.slice(0, i).trim();
  return imported ? (rest.split(' ')[0] || '') : '';
}

// ---------------------------------------------------------------------------
// Ponto de entrada
// ---------------------------------------------------------------------------
/**
 * Lê o CRLV. Devolve os dados encontrados, no formato do cadastro de veículo:
 * { plate, renavam, chassis, model, brand, year_manufacture, year_model,
 *   vehicle_type_code, vehicle_type_text, fuel_type_code, fuel_text,
 *   category, owner_name, owner_doc, color }
 * Campos não encontrados ficam ausentes. Lança Error com mensagem para o usuário.
 */
export async function readCRLV(file) {
  if (!file) throw new Error('Nenhum arquivo selecionado.');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  if (!isPdf) throw new Error('Selecione o arquivo PDF do CRLV Digital.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Arquivo grande demais para um CRLV (acima de 15 MB).');

  const items = await readItems(file);
  if (!items.length) {
    throw new Error('Este PDF não tem texto: parece uma foto ou digitalização. Use o CRLV Digital baixado do gov.br ou da Carteira Digital de Trânsito, ou preencha os campos à mão.');
  }
  const all = norm(items.map(i => i.text).join(' '));
  if (!all.includes('RENAVAM')) {
    throw new Error('Este PDF não parece ser um CRLV Digital. Confira o arquivo.');
  }

  const get = (label) => { const v = valueBelow(items, label); return filled(v) ? v : ''; };
  const out = {};

  // RENAVAM: 11 dígitos (os antigos com menos dígitos são completados com zeros)
  // (sem "chute" no resto do texto: o CRLV tem outros números de 11 dígitos)
  const renavam = get('CÓDIGO RENAVAM').replace(/\D/g, '');
  if (/^\d{9,11}$/.test(renavam)) out.renavam = renavam.padStart(11, '0');

  // Placa: antiga (ABC1234) ou Mercosul (ABC1D23)
  const plateRe = /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/;
  const plate = norm(get('PLACA')).replace(/[^A-Z0-9]/g, '');
  if (plateRe.test(plate)) out.plate = plate;

  // Chassi: 17 caracteres, sem I, O e Q
  const chassis = norm(get('CHASSI')).replace(/[^A-Z0-9]/g, '');
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(chassis)) out.chassis = chassis;

  const year = (s) => { const n = Number(String(s).replace(/\D/g, '')); return n >= 1900 && n <= new Date().getFullYear() + 1 ? n : null; };
  const yf = year(get('ANO FABRICAÇÃO')), ym = year(get('ANO MODELO'));
  if (yf) out.year_manufacture = yf;
  if (ym) out.year_model = ym;

  const model = get('MARCA / MODELO / VERSÃO').replace(/\s+/g, ' ');
  if (model.length >= 3) {
    out.model = model.slice(0, 120);
    const brand = brandOf(model);
    if (brand) out.brand = brand;
  }

  const especie = get('ESPÉCIE / TIPO');
  if (especie) {
    out.vehicle_type_text = especie;
    const t = vehicleTypeCode(especie);
    if (t) out.vehicle_type_code = t;
  }

  const fuel = get('COMBUSTÍVEL');
  if (fuel) {
    out.fuel_text = fuel;
    const f = fuelCode(fuel);
    if (f) out.fuel_type_code = f;
  }

  const category = get('CATEGORIA');
  if (category) out.category = category;
  const owner = get('NOME');
  if (owner) out.owner_name = owner;
  const doc = get('CPF / CNPJ').replace(/\D/g, '');
  if (doc.length === 11 || doc.length === 14) out.owner_doc = doc;
  const color = get('COR PREDOMINANTE');
  if (color) out.color = color;

  if (!out.plate && !out.renavam && !out.chassis) {
    throw new Error('Não foi possível ler placa, RENAVAM nem chassi deste PDF. Confira se é o CRLV Digital, ou preencha à mão.');
  }
  return out;
}
