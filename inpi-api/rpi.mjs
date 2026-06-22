// =============================================================================
// Leitor da RPI (Revista da Propriedade Industrial) — Seção V "Marcas" — LIV
//
// Fonte oficial: https://revistas.inpi.gov.br/rpi/
//   - Lista de revistas (numero + data) vem do HTML do indice.
//   - Cada revista tem o caderno de Marcas em 2 formatos:
//       PDF  : https://revistas.inpi.gov.br/pdf/Marcas{N}.pdf   (~150 MB, inviavel)
//       XML  : https://revistas.inpi.gov.br/txt/RM{N}.zip       (~9 MB zip / ~48 MB xml)
//   Usamos o XML: e DADO ESTRUTURADO (processo, despacho, titular, procurador,
//   classe), entao buscar por procurador/situacao e exato, nao regex em PDF.
//
// Sem dependencias: fetch nativo + zlib (inflate do zip) + fs (cache em disco).
// =============================================================================
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BASE = 'https://revistas.inpi.gov.br';
const CACHE = path.join(import.meta.dirname, '_cache');

// =============================================================================
// PARTE 1 — DICIONARIO DE CODIGOS DE DESPACHO (IPAS) DA SECAO DE MARCAS
//   Fonte: https://revistas.inpi.gov.br/rpi/download/despachos/300 (Marcas)
//   + o que aparece de fato no XML. tom: bom | ruim | alerta | neutro | chance
//   ("chance" = abre janela/oportunidade de atuacao — ex.: prazo de oposicao).
// =============================================================================
export const DICIONARIO = [
  // --- exame de pedido ---
  ['IPAS009', 'publicacao',    'chance',  'Publicação de pedido de registro para oposição (exame formal concluído)'],
  ['IPAS756', 'publicacao',    'chance',  'Publicação de pedido de registro para oposição (designação)'],
  ['IPAS029', 'deferimento',   'bom',     'Deferimento do pedido'],
  ['IPAS768', 'deferimento',   'bom',     'Deferimento de designação'],
  ['IPAS781', 'deferimento',   'bom',     'Deferimento parcial de designação'],
  ['IPAS024', 'indeferimento', 'ruim',    'Indeferimento do pedido'],
  ['IPAS774', 'indeferimento', 'ruim',    'Indeferimento de designação'],
  ['IPAS005', 'exigencia',     'alerta',  'Exigência formal'],
  ['IPAS113', 'arquivamento',  'ruim',    'Pedido considerado inexistente (exigência formal não cumprida)'],
  ['IPAS136', 'exigencia',     'alerta',  'Exigência de mérito'],
  ['IPAS772', 'exigencia',     'alerta',  'Exigência de mérito em designação'],
  ['IPAS362', 'exigencia',     'alerta',  'Exigência sobre alto renome'],
  ['IPAS142', 'sobrestamento', 'neutro',  'Sobrestamento do exame de mérito'],
  ['IPAS771', 'sobrestamento', 'neutro',  'Sobrestamento do exame de mérito de designação'],
  ['IPAS421', 'publicacao',    'neutro',  'Republicação de pedido'],
  ['IPAS135', 'publicacao',    'neutro',  'Republicação de pedido (por perda da prioridade)'],
  // --- registro / vigencia ---
  ['IPAS158', 'concessao',     'bom',     'Concessão de registro'],
  ['IPAS770', 'concessao',     'bom',     'Concessão de registro em designação'],
  ['IPAS161', 'extincao',      'ruim',    'Extinção de registro pela expiração do prazo de vigência'],
  ['IPAS304', 'caducidade',    'ruim',    'Extinção de registro pela caducidade'],
  ['IPAS409', 'extincao',      'ruim',    'Cancelamento de ofício de registro de marca'],
  ['IPAS579', 'administrativo','neutro',  'Emissão de segunda via de certificado de registro'],
  ['IPAS971', 'administrativo','neutro',  'Emissão de segunda via de certificado de registro em designação'],
  // --- oposicao ---
  ['IPAS423', 'oposicao',      'alerta',  'Notificação de oposição'],
  // --- recurso ---
  ['IPAS360', 'recurso',       'neutro',  'Notificação de recurso'],
  ['IPAS235', 'recurso',       'ruim',    'Recurso não provido (decisão mantida)'],
  ['IPAS237', 'recurso',       'bom',     'Recurso provido (decisão reformada para: Deferimento)'],
  ['IPAS975', 'recurso',       'bom',     'Recurso provido (reformada, com devolução dos autos à 1ª instância)'],
  // --- nulidade (PAN) ---
  ['IPAS400', 'nulidade',      'alerta',  'Notificação de instauração de processo de nulidade a requerimento'],
  ['IPAS437', 'nulidade',      'alerta',  'Notificação de instauração de processo de nulidade de ofício'],
  ['IPAS530', 'nulidade',      'ruim',    'Requerimento provido (nulo o registro)'],
  ['IPAS532', 'nulidade',      'bom',     'Requerimento não provido (mantida a concessão)'],
  ['IPAS533', 'nulidade',      'neutro',  'Requerimento não provido (outros)'],
  // --- caducidade ---
  ['IPAS338', 'caducidade',    'alerta',  'Notificação de caducidade'],
  ['IPAS669', 'caducidade',    'ruim',    'Deferimento da petição de caducidade'],
  // --- peticoes ---
  ['IPAS270', 'peticao',       'bom',     'Deferimento da petição'],
  ['IPAS349', 'peticao',       'bom',     'Deferimento parcial da petição'],
  ['IPAS271', 'peticao',       'ruim',    'Indeferimento da petição'],
  ['IPAS337', 'peticao',       'ruim',    'Indeferimento da petição por falta de legítimo interesse'],
  ['IPAS428', 'peticao',       'neutro',  'Decisão de não conhecer da petição'],
  ['IPAS267', 'exigencia',     'alerta',  'Exigência de mérito (em petição)'],
  ['IPAS089', 'exigencia',     'alerta',  'Exigência de pagamento (em petição)'],
  ['IPAS227', 'sobrestamento', 'neutro',  'Sobrestamento do exame de mérito (em petição)'],
  ['IPAS499', 'sobrestamento', 'neutro',  'Sobrestamento da instrução técnica'],
  ['IPAS566', 'peticao',       'bom',     'Petição de retificação atendida'],
  ['IPAS567', 'peticao',       'neutro',  'Petição de retificação não atendida'],
  ['IPAS699', 'peticao',       'neutro',  'Ato de prejudicar petição'],
  ['IPAS1054','peticao',       'neutro',  'Petição de trâmite prioritário atendida'],
  ['IPAS1055','peticao',       'neutro',  'Petição de trâmite prioritário não atendida'],
  ['IPAS1069','peticao',       'neutro',  'Petição de trâmite prioritário apta (aguardando prazo legal)'],
  // --- arquivamentos ---
  ['IPAS106', 'arquivamento',  'ruim',    'Arquivamento definitivo do pedido por falta de procuração'],
  ['IPAS139', 'arquivamento',  'ruim',    'Arquivamento definitivo por falta de cumprimento de exigência de mérito'],
  ['IPAS185', 'arquivamento',  'neutro',  'Arquivamento de petição por falta de procuração'],
  ['IPAS289', 'arquivamento',  'ruim',    'Arquivamento definitivo (marca de certificação, falta de documentos)'],
  ['IPAS773', 'arquivamento',  'ruim',    'Arquivamento de designação por falta de exigência de mérito'],
  ['IPAS780', 'arquivamento',  'ruim',    'Arquivamento de designação por falta de pagamento da 2ª retribuição'],
  // --- anotacoes / designacao (Protocolo de Madri) ---
  ['IPAS900', 'anotacao',      'neutro',  'Anotação de alteração de nome e/ou endereço em designação'],
  ['IPAS901', 'anotacao',      'neutro',  'Anotação de transferência de titularidade em designação'],
  ['IPAS902', 'anotacao',      'neutro',  'Anotação de cancelamento parcial de especificação em designação'],
  ['IPAS903', 'anotacao',      'neutro',  'Retificação de dados em designação'],
  ['IPAS797', 'madri',         'neutro',  'Pedido internacional certificado e enviado à Secretaria Internacional'],
  // --- judicial / administrativo ---
  ['IPAS462', 'judicial',      'alerta',  'Notificação de procedimento judicial'],
  ['IPAS639', 'judicial',      'neutro',  'Publicação de decisão judicial transitada em julgado'],
  ['IPAS402', 'administrativo','neutro',  'Anulação de despacho (em processo)'],
  ['IPAS403', 'administrativo','neutro',  'Anulação de despacho (em petição)'],
  ['IPAS523', 'administrativo','neutro',  'Emissão de Certidão de andamento'],
  ['IPAS576', 'administrativo','neutro',  'Emissão de cópia oficial de pedido de registro'],
];
// indice rapido codigo -> {categoria, tom, nome}
export const CODIGOS = Object.fromEntries(
  DICIONARIO.map(([c, categoria, tom, nome]) => [c, { categoria, tom, nome }])
);
const porCategoria = (cat) => new Set(DICIONARIO.filter(d => d[1] === cat).map(d => d[0]));

// conjuntos usados na classificacao (Parte 4)
const SET_INDEF   = porCategoria('indeferimento');               // pedido negado
const SET_OPOS    = porCategoria('oposicao');                    // oposicao apresentada
const SET_PUBOPOS = new Set(['IPAS009', 'IPAS756']);             // janela de oposicao aberta
const SET_EXIG    = porCategoria('exigencia');                   // exigencia pendente
const SET_DEFER   = porCategoria('deferimento');
const SET_CONC    = porCategoria('concessao');

export function descreverCodigo(codigo) {
  return CODIGOS[codigo] || { categoria: 'outros', tom: 'neutro', nome: codigo };
}

// =============================================================================
// utilitarios de texto
// =============================================================================
const decodeEnt = (s = '') => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/\s+/g, ' ').trim();

// minuscula + sem acento, p/ comparar nome de procurador de forma robusta
export const normalizar = (s = '') => String(s).toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// =============================================================================
// PARTE 2 — LISTAR REVISTAS (numero + data) a partir do indice do site
//   No HTML cada linha e:  <td>2893</td><td> 2026-06-16 </td><td>...links...</td>
// =============================================================================
export async function listarRevistas(qtd = 7) {
  const res = await fetch(`${BASE}/rpi/`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Falha ao abrir o índice da RPI: HTTP ${res.status}`);
  const html = await res.text();
  // a data vem ora em ISO (2026-06-16), ora em BR (16/06/2026) — aceitar ambas
  const re = /<td>\s*(\d{3,5})\s*<\/td>\s*<td>\s*(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})\s*<\/td>/g;
  const vistos = new Map();
  let m;
  while ((m = re.exec(html))) if (!vistos.has(m[1])) vistos.set(m[1], m[2]);
  const lista = [...vistos.entries()]
    .map(([numero, bruta]) => {
      const iso = bruta.includes('/') ? bruta.split('/').reverse().join('-') : bruta;
      const dataBR = iso.split('-').reverse().join('/');
      return {
        numero,
        data: iso,
        dataBR,
        marcasPdf: `${BASE}/pdf/Marcas${numero}.pdf`,
        marcasXml: `${BASE}/txt/RM${numero}.zip`,
      };
    })
    .sort((a, b) => +b.numero - +a.numero);
  if (!lista.length) throw new Error('Não consegui ler nenhuma revista do índice (HTML pode ter mudado).');
  return lista.slice(0, qtd);
}

// =============================================================================
// ZIP de UMA entrada (EOCD -> central dir -> local header -> inflateRaw)
// =============================================================================
function unzipPrimeiro(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP inválido: fim do diretório central não encontrado.');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('ZIP inválido: diretório central corrompido.');
  const method   = buf.readUInt16LE(cdOffset + 10);
  const compSize = buf.readUInt32LE(cdOffset + 20);
  const localOff = buf.readUInt32LE(cdOffset + 42);
  if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('ZIP inválido: cabeçalho local corrompido.');
  const nameLen  = buf.readUInt16LE(localOff + 26);
  const extraLen = buf.readUInt16LE(localOff + 28);
  const start    = localOff + 30 + nameLen + extraLen;
  const data     = buf.subarray(start, start + compSize);
  if (method === 0) return Buffer.from(data);          // STORED
  if (method === 8) return zlib.inflateRawSync(data);  // DEFLATE
  throw new Error(`Método de compressão não suportado no ZIP: ${method}`);
}

// =============================================================================
// DOWNLOAD + CACHE do XML de uma revista
// =============================================================================
const xmlPathDe = (numero) => path.join(CACHE, `RM${numero}.xml`);

// ja existe o XML descompactado em disco? (o download do INPI e lento ~15s/9MB,
// entao o disco e a fonte de verdade: so se baixa uma vez por revista, p/ sempre)
export function cacheadaEmDisco(numero) {
  const p = xmlPathDe(numero);
  return fs.existsSync(p) && fs.statSync(p).size > 0;
}

// baixa o zip do INPI e grava o XML em disco se ainda nao houver. NAO devolve o
// conteudo (48MB) — serve p/ pre-carregar em background sem ocupar memoria.
export async function garantirXML(numero) {
  fs.mkdirSync(CACHE, { recursive: true });
  if (cacheadaEmDisco(numero)) return xmlPathDe(numero);
  const url = `${BASE}/txt/RM${numero}.zip`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Falha ao baixar RM${numero}.zip: HTTP ${res.status}`);
  const xmlBuf = unzipPrimeiro(Buffer.from(await res.arrayBuffer()));
  fs.writeFileSync(xmlPathDe(numero), xmlBuf);
  return xmlPathDe(numero);
}

export async function baixarXML(numero) {
  await garantirXML(numero);
  return fs.readFileSync(xmlPathDe(numero), 'utf8');
}

// =============================================================================
// PARSER dos processos do XML
// =============================================================================
function parseProcesso(b) {
  const num = (b.match(/<processo numero="([^"]*)"/) || [])[1] || null;
  const attr = (re) => (b.match(re) || [])[1] || null;

  const despachos = [...b.matchAll(/<despacho codigo="([^"]*)" nome="([^"]*)"/g)]
    .map(m => ({ codigo: m[1], nome: decodeEnt(m[2]) }));

  const titulares = [...b.matchAll(/<titular\b([^>]*?)\/?>/g)].map(m => {
    const s = m[1];
    return {
      nome: decodeEnt((s.match(/nome-razao-social="([^"]*)"/) || [])[1] || ''),
      pais: (s.match(/pais="([^"]*)"/) || [])[1] || null,
      uf: (s.match(/uf="([^"]*)"/) || [])[1] || null,
    };
  }).filter(t => t.nome);

  let marca = null;
  const mt = b.match(/<marca\b([^>]*)>/);
  if (mt) {
    marca = {
      nome: decodeEnt((b.match(/<nome>([\s\S]*?)<\/nome>/) || [])[1] || '') || null,
      apresentacao: (mt[1].match(/apresentacao="([^"]*)"/) || [])[1] || null,
      natureza: (mt[1].match(/natureza="([^"]*)"/) || [])[1] || null,
    };
  }

  const classes = [...b.matchAll(/<classe-nice codigo="([^"]*)">([\s\S]*?)<\/classe-nice>/g)].map(m => ({
    codigo: m[1],
    status: decodeEnt((m[2].match(/<status>([\s\S]*?)<\/status>/) || [])[1] || '') || null,
  }));

  const procurador = decodeEnt((b.match(/<procurador>([\s\S]*?)<\/procurador>/) || [])[1] || '') || null;

  return {
    numero: num,
    dataDeposito: attr(/data-deposito="([^"]*)"/),
    dataConcessao: attr(/data-concessao="([^"]*)"/),
    dataVigencia: attr(/data-vigencia="([^"]*)"/),
    despachos, titulares, marca, classes, procurador,
  };
}

export function parseRevista(xml) {
  const rm = xml.match(/<revista numero="([^"]*)" data="([^"]*)"/);
  const blocks = xml.match(/<processo\b[\s\S]*?<\/processo>/g) || [];
  return {
    numero: rm ? rm[1] : null,
    data: rm ? rm[2] : null,
    processos: blocks.map(parseProcesso),
  };
}

// memoria de processo (LRU pequeno): parse de 48MB so na 1a vez por revista.
// limite baixo porque cada revista parseada ocupa muita RAM (~30 mil objetos).
const _memo = new Map();
const MEMO_MAX = 3;
export async function getRevista(numero) {
  if (_memo.has(numero)) {                       // touch (LRU): move p/ o fim
    const v = _memo.get(numero);
    _memo.delete(numero); _memo.set(numero, v);
    return v;
  }
  const rev = parseRevista(await baixarXML(numero));
  _memo.set(numero, rev);
  while (_memo.size > MEMO_MAX) _memo.delete(_memo.keys().next().value);
  return rev;
}

// =============================================================================
// PARTES 3 e 4 — ANALISE
// =============================================================================
function resumo(p) {
  const d = p.despachos[0] || {};
  return {
    numero: p.numero,
    marca: p.marca?.nome || null,
    apresentacao: p.marca?.apresentacao || null,
    titular: p.titulares[0]?.nome || null,
    uf: p.titulares[0]?.uf || null,
    classes: p.classes.map(c => c.codigo).filter((v, i, a) => a.indexOf(v) === i).join(', ') || null,
    despachoCodigo: d.codigo || null,
    despacho: d.nome || null,
    tom: d.codigo ? descreverCodigo(d.codigo).tom : 'neutro',
    despachos: p.despachos,
    procurador: p.procurador || null,
    semProcurador: !p.procurador,
  };
}

export async function analisar(numero, { procurador = 'Camila de Liz', limite = 60 } = {}) {
  const rev = await getRevista(numero);
  const alvo = normalizar(procurador);

  const camila = [], oproprio = [], indeferidos = [], oposicoes = [], leadsQuentes = [];
  const stats = {
    total: rev.processos.length, comProcurador: 0, semProcurador: 0,
    deferidos: 0, concedidos: 0, indeferidos: 0, oposicoes: 0,
    publicadosParaOposicao: 0, exigencias: 0,
  };

  for (const p of rev.processos) {
    const cods = p.despachos.map(d => d.codigo);
    const tem = (set) => cods.some(c => set.has(c));
    const f = {
      semProc: !p.procurador,
      indef: tem(SET_INDEF),
      opos: tem(SET_OPOS),
      pubOpos: tem(SET_PUBOPOS),
      exig: tem(SET_EXIG),
      defer: tem(SET_DEFER),
      conc: tem(SET_CONC),
    };
    p.procurador ? stats.comProcurador++ : stats.semProcurador++;
    if (f.defer) stats.deferidos++;
    if (f.conc) stats.concedidos++;
    if (f.indef) stats.indeferidos++;
    if (f.opos) stats.oposicoes++;
    if (f.pubOpos) stats.publicadosParaOposicao++;
    if (f.exig) stats.exigencias++;

    if (alvo && p.procurador && normalizar(p.procurador).includes(alvo)) camila.push(p);
    if (f.semProc) oproprio.push(p);
    if (f.indef) indeferidos.push(p);
    if (f.opos) oposicoes.push(p);
    // LEAD QUENTE p/ a LIV: tentou sozinho (o proprio) e algo deu errado
    if (f.semProc && (f.indef || f.opos || f.exig)) leadsQuentes.push(p);
  }

  const pack = (arr) => ({ total: arr.length, amostra: arr.slice(0, limite).map(resumo) });
  return {
    revista: { numero: rev.numero, data: rev.data, dataBR: rev.data?.split('-').reverse().join('/') },
    procuradorAlvo: procurador,
    stats,
    camila: { total: camila.length, amostra: camila.map(resumo) }, // alvo costuma ser pequeno: manda tudo
    oproprio: pack(oproprio),
    indeferidos: pack(indeferidos),
    oposicoes: pack(oposicoes),
    leadsQuentes: pack(leadsQuentes),
  };
}

// =============================================================================
// RUNNER DE TESTE:  node rpi.mjs [numeroRevista] ["Nome do Procurador"]
// =============================================================================
const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (entry && import.meta.url.endsWith(entry.split('/').pop())) {
  const t0 = Date.now();
  const revs = await listarRevistas(7);
  console.log('\n== ULTIMAS 7 REVISTAS (Seção V — Marcas) ==');
  for (const r of revs) console.log(`  RPI ${r.numero}  ·  ${r.dataBR}`);

  const numero = process.argv[2] || revs[0].numero;
  const proc = process.argv[3] || 'Camila de Liz';
  console.log(`\n== Analisando RPI ${numero} (procurador alvo: "${proc}") ==`);
  const a = await analisar(numero, { procurador: proc });
  console.log(`processos: ${a.stats.total} | ${Date.now() - t0}ms`);
  console.log('stats:', a.stats);
  console.log(`\n-- "${proc}" (${a.camila.total}) --`);
  for (const p of a.camila.amostra)
    console.log(`  ${p.numero} · ${p.marca || '(nominativa s/ nome)'} · ${p.titular} (${p.uf}) · ${p.despacho}`);
  console.log(`\n-- o próprio / sem procurador: ${a.oproprio.total}`);
  console.log(`-- indeferidos: ${a.indeferidos.total}`);
  console.log(`-- oposições (apresentadas): ${a.oposicoes.total}`);
  console.log(`-- LEADS QUENTES (o próprio + deu errado): ${a.leadsQuentes.total}`);
  for (const p of a.leadsQuentes.amostra.slice(0, 8))
    console.log(`     ${p.numero} · ${p.titular} (${p.uf}) · ${p.despacho}`);
}
