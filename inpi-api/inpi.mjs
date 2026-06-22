// =============================================================================
// Cliente da Busca de Marcas do INPI (sistema pePI) — para a LIV
//
// NAO existe API oficial do INPI. Isto consome a busca publica em
// busca.inpi.gov.br/pePI fazendo: login anonimo -> busca -> detalhe.
//
// Pontos que descobrimos validando ao vivo:
//  - O site responde em ISO-8859-1 (latin1). Precisa decodificar certo p/ acento.
//  - O login anonimo cria uma SESSAO (cookie JSESSIONID). Sem isso, nada funciona.
//  - O "CodPedido" do detalhe e VINCULADO A SESSAO da busca (nao e id global).
//    Ou seja: o detalhe so abre na MESMA sessao que rodou a busca.
//    Por isso buscar() devolve o `cookie`, que voce repassa para detalhe().
//  - A sessao expira em poucos minutos. Se expirar, refaca a busca.
// =============================================================================

const BASE = 'https://busca.inpi.gov.br/pePI';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// --- encoding (a pagina e latin1) -------------------------------------------
const decodeLatin1 = (buf) => new TextDecoder('latin1').decode(buf);

// percent-encode em latin1 (ex.: "AÇAÍ" -> "A%C7A%CD")
function encLatin1(str) {
  let out = '';
  for (const ch of String(str)) {
    const code = ch.charCodeAt(0);
    if (/[A-Za-z0-9_.~-]/.test(ch)) out += ch;
    else if (code <= 0xff) out += '%' + code.toString(16).toUpperCase().padStart(2, '0');
    else out += encodeURIComponent(ch); // fora do latin1: fallback utf-8
  }
  return out;
}
const form = (obj) =>
  Object.entries(obj).map(([k, v]) => `${encLatin1(k)}=${encLatin1(v)}`).join('&');

// tira tags/entidades e normaliza espacos
const strip = (html = '') =>
  html.replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim();

// --- cookies ----------------------------------------------------------------
// junta o cookie anterior com os Set-Cookie da resposta (jar simples)
function mergeCookies(res, prev = '') {
  const jar = new Map();
  prev.split(';').map(s => s.trim()).filter(Boolean).forEach(p => {
    const i = p.indexOf('='); jar.set(p.slice(0, i), p.slice(i + 1));
  });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of set) {
    const first = c.split(';')[0];
    const i = first.indexOf('=');
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

// =============================================================================
// 1) LOGIN ANONIMO -> devolve a string de cookie da sessao
// =============================================================================
export async function login() {
  const res = await fetch(`${BASE}/servlet/LoginController?action=login`, {
    headers: { 'User-Agent': UA },
  });
  await res.arrayBuffer();
  return mergeCookies(res);
}

// =============================================================================
// 2) BUSCA por marca -> { cookie, total, pagina, totalPaginas, resultados[] }
//    O `cookie` retornado deve ser passado p/ detalhe() e proximaPagina().
// =============================================================================
export async function buscar(marca, { classe = '', exata = true, porPagina = 20, cookie } = {}) {
  if (!cookie) cookie = await login();
  const body = form({
    buscaExata: exata ? 'sim' : 'nao',
    marca,
    classeInter: classe,
    registerPerPage: porPagina,
    txt: exata ? 'Pesquisa Exata' : 'Pesquisa Radical',
    Action: 'searchMarca',
    tipoPesquisa: 'BY_MARCA_CLASSIF_BASICA',
  });
  const res = await fetch(`${BASE}/servlet/MarcasServletController`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookie,
      'Referer': `${BASE}/jsp/marcas/Pesquisa_classe_basica.jsp`,
    },
    body,
  });
  const html = decodeLatin1(await res.arrayBuffer());
  return { cookie: mergeCookies(res, cookie), ...parseLista(html) };
}

// paginas seguintes (mesma sessao): Action=nextPageMarca&page=N
export async function proximaPagina(page, cookie) {
  const res = await fetch(`${BASE}/servlet/MarcasServletController?Action=nextPageMarca&page=${page}`, {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Referer': `${BASE}/servlet/MarcasServletController` },
  });
  const html = decodeLatin1(await res.arrayBuffer());
  return { cookie: mergeCookies(res, cookie), ...parseLista(html) };
}

function parseLista(html) {
  const total = (html.match(/Foram encontrados\s+(\d+)\s+processos/i) || [])[1];
  const semResultado = /N.o foi encontrado|nenhum processo/i.test(html);
  const pag = html.match(/Mostrando p.gina\s+(\d+)\s+de\s+(\d+)/i);

  const resultados = [];
  const partes = html.split('Action=detail&CodPedido=');
  for (let i = 1; i < partes.length; i++) {
    const seg = partes[i];
    const link = seg.match(/^(\d+)'[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    resultados.push({
      codPedido: link[1],
      numero: strip(link[2]),
      prioridade: (seg.match(/(\d{2}\/\d{2}\/\d{4})/) || [])[1] || null,
      apresentacao: (seg.match(/alt="Marca (Nominativa|Mista|Figurativa|Tridimensional)"/i) || [])[1] || null,
      marca: strip((seg.match(/<b>([\s\S]*?)<\/b>/) || [])[1] || '') || null,
      situacao: strip((seg.match(/padding-5[^>]*>\s*<font[^>]*>([\s\S]*?)<\/font>/i) || [])[1] || '') || null,
      situacaoImagem: (seg.match(/src="[^"]*registro[^"]*"[^>]*alt="([^"]+)"/i) || [])[1] || null,
      classe: strip((seg.match(/titulo-marcas">([\s\S]*?)<\/font>/i) || [])[1] || '') || null,
      titular: strip((seg.match(/titular-marcas">([\s\S]*?)<\/font>/i) || [])[1] || '') || null,
    });
  }
  return {
    total: total ? +total : (semResultado ? 0 : resultados.length),
    pagina: pag ? +pag[1] : 1,
    totalPaginas: pag ? +pag[2] : 1,
    resultados,
  };
}

// =============================================================================
// 3) DETALHE de um processo (mesma sessao da busca)
// =============================================================================
export async function detalhe(codPedido, cookie) {
  const res = await fetch(`${BASE}/servlet/MarcasServletController?Action=detail&CodPedido=${codPedido}`, {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Referer': `${BASE}/servlet/MarcasServletController` },
  });
  const html = decodeLatin1(await res.arrayBuffer());
  if (/Pedido inexistente/i.test(html)) {
    throw new Error('Sessao expirada ou CodPedido invalido — refaca a busca para gerar novos CodPedido.');
  }
  return parseDetalhe(html, codPedido);
}

// pega o valor da celula seguinte a um rotulo "Label:</font> ... <font>VALOR</font>"
// (exige os dois-pontos p/ nao casar rotulos de cabecalho como a aba "Marca")
function campo(html, label) {
  const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
    '\\s*:\\s*</font>[\\s\\S]{0,200}?<font[^>]*>([\\s\\S]*?)</font>', 'i');
  const m = html.match(re);
  return m ? (strip(m[1]) || null) : null;
}

function parseDetalhe(html, codPedido) {
  // especificacao COMPLETA: o texto integral fica nos divs de hover #txtEspecificacao
  // (na celula branca); o que aparece na tabela vem truncado com "..."
  const espDivs = [...html.matchAll(/id="txtEspecificacao"[\s\S]*?bgColor="#ffffff"[^>]*>\s*<font[^>]*>([\s\S]*?)<\/font>/gi)]
    .map(m => strip(m[1])).filter(Boolean);

  // classes (classe : subclasse) — melhor esforco a partir da tabela
  const classes = [];
  const secao = (html.match(/Classe (?:Nacional|NCL)[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i) || [])[1] || '';
  for (const tr of secao.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const nums = (tr.match(/<font[^>]*>\s*(\d{1,3})\s*<\/font>/gi) || [])
      .map(s => (s.match(/(\d{1,3})/) || [])[1]);
    if (nums.length) classes.push({ classe: nums[0], subclasse: nums[1] || null });
  }

  // datas: valores ficam no <tbody> apos o </thead> do cabecalho de datas
  // (cuidado: ha um popup de ajuda com tabela aninhada entre o cabecalho e os valores)
  const datasBloco = (html.match(/Data de Dep[\s\S]*?<\/thead>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i) || [])[1] || '';
  const datas = [...datasBloco.matchAll(/(\d{2}\/\d{2}\/\d{4})/g)].map(m => m[1]);

  return {
    codPedido,
    numeroProcesso: (html.match(/name="numeroProcesso"\s+value\s*="?([^"]+)"/i) || [])[1] || campo(html, 'Nº do Processo'),
    marca: campo(html, 'Marca'),
    situacao: campo(html, 'Situação'),
    apresentacao: campo(html, 'Apresentação'),
    natureza: campo(html, 'Natureza'),
    titular: campo(html, 'Titular(1)') || campo(html, 'Nome do Titular') || campo(html, 'Titular'),
    procurador: campo(html, 'Procurador'),
    classes,
    especificacao: espDivs.join('\n') || null,
    temLogo: /LogoMarcasServletController\?Action=image/i.test(html),
    dataDeposito: datas[0] || null,
    dataConcessao: datas[1] || null,
    dataVigencia: datas[2] || null,
  };
}

// =============================================================================
// 4) LOGO da marca (so existe p/ Figurativa/Mista/Tridimensional)
//    A imagem tambem e amarrada A SESSAO da busca (precisa do mesmo cookie).
// =============================================================================
export async function logo(codPedido, cookie) {
  const res = await fetch(`${BASE}/servlet/LogoMarcasServletController?Action=image&codProcesso=${codPedido}`, {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Referer': `${BASE}/servlet/MarcasServletController` },
  });
  const ct = res.headers.get('content-type') || '';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!res.ok || buffer.length < 100 || /text\/html/i.test(ct)) return null; // sem logo
  return { contentType: /image/i.test(ct) ? ct : 'image/jpeg', buffer };
}

// =============================================================================
// RUNNER DE TESTE:  node inpi.mjs "NOME DA MARCA" [classe]
// =============================================================================
const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
const isMain = entry !== '' && import.meta.url.endsWith(entry.split('/').pop());
if (isMain) {
  const marca = process.argv[2] || 'NIKE';
  const classe = process.argv[3] || '';
  console.log(`\n>> Buscando marca: "${marca}"${classe ? ` (classe ${classe})` : ''}\n`);

  const t0 = Date.now();
  const r = await buscar(marca, { classe, porPagina: 20 });
  console.log(`Encontrados: ${r.total} processos | pagina ${r.pagina}/${r.totalPaginas} | ${Date.now() - t0}ms\n`);

  console.log('--- LISTA (primeiros) ---');
  for (const it of r.resultados.slice(0, 8)) {
    console.log(`[${it.numero}] ${it.marca}  ·  ${it.apresentacao || '?'}  ·  ${it.situacao || it.situacaoImagem || '?'}  ·  cl.${it.classe || '?'}  ·  ${it.titular || ''}`);
  }

  if (r.resultados.length) {
    const alvo = r.resultados.find(x => /registro/i.test(x.situacao || '')) || r.resultados[0];
    console.log(`\n--- DETALHE (sob demanda) do processo ${alvo.numero} ---`);
    const d = await detalhe(alvo.codPedido, r.cookie);
    console.log(JSON.stringify(d, null, 2));
  }
}
