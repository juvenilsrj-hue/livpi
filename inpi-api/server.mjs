// =============================================================================
// Servidor de TESTE da Busca de Marcas INPI (LIV)
//   GET /                         -> pagina de teste (HTML)
//   GET /api/buscar?marca=&classe=&exata=1  -> { sessao, total, ..., resultados[] }
//   GET /api/detalhe?sessao=&codPedido=     -> detalhe do processo
//
// Rodar:  node server.mjs   (porta 8787, ou PORT=xxxx)
// =============================================================================
import http from 'http';
import { buscar, detalhe, logo } from './inpi.mjs';

const PORT = Number(process.env.PORT) || 8787;

// guarda os cookies de cada busca. O CodPedido do detalhe e amarrado A SESSAO
// que o gerou; no modo "ambas" rodamos 2 buscas (2 cookies), entao cada
// resultado carrega `sub` = indice do cookie correto para puxar o detalhe.
const sessoes = new Map(); // id -> { subs:[cookie...], ts }
let seq = 0;
function novaSessao(subs) {
  const id = (++seq).toString(36) + '-' + Date.now().toString(36);
  sessoes.set(id, { subs, ts: Date.now() });
  for (const [k, v] of sessoes) if (Date.now() - v.ts > 6 * 60 * 1000) sessoes.delete(k);
  return id;
}

function json(res, code, obj) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGINA);
    }

    if (url.pathname === '/api/buscar') {
      const marca = (url.searchParams.get('marca') || '').trim();
      if (!marca) return json(res, 400, { erro: 'informe ?marca=' });
      const classe = (url.searchParams.get('classe') || '').trim();
      let modo = (url.searchParams.get('modo') || 'exata').toLowerCase();
      if (!['exata', 'radical', 'ambas'].includes(modo)) modo = 'exata';

      if (modo !== 'ambas') {
        const r = await buscar(marca, { classe, exata: modo === 'exata', porPagina: 50 });
        const resultados = r.resultados.map(x => ({ ...x, sub: 0, match: modo }));
        const sessao = novaSessao([r.cookie]);
        return json(res, 200, {
          sessao, marca, classe, modo,
          total: r.total, pagina: r.pagina, totalPaginas: r.totalPaginas, resultados,
        });
      }

      // modo "ambas": roda exata + radical e mescla por numero de processo
      const e = await buscar(marca, { classe, exata: true, porPagina: 50 });
      const r = await buscar(marca, { classe, exata: false, porPagina: 50 });
      const map = new Map();
      for (const x of e.resultados) map.set(x.numero, { ...x, sub: 0, match: 'exata' });
      for (const x of r.resultados) {
        if (map.has(x.numero)) map.get(x.numero).match = 'ambas';
        else map.set(x.numero, { ...x, sub: 1, match: 'radical' });
      }
      const resultados = [...map.values()];
      const sessao = novaSessao([e.cookie, r.cookie]);
      return json(res, 200, {
        sessao, marca, classe, modo,
        total: resultados.length, totalExata: e.total, totalRadical: r.total,
        pagina: 1, totalPaginas: 1, resultados,
      });
    }

    if (url.pathname === '/api/logo') {
      const sessao = url.searchParams.get('sessao') || '';
      const codPedido = url.searchParams.get('codPedido') || '';
      const sub = Number(url.searchParams.get('sub') || 0);
      const s = sessoes.get(sessao);
      const cookie = s && s.subs[sub];
      const img = cookie ? await logo(codPedido, cookie) : null;
      if (!img) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); return res.end(); }
      res.writeHead(200, {
        'Content-Type': img.contentType,
        'Cache-Control': 'max-age=600',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(img.buffer);
    }

    if (url.pathname === '/api/detalhe') {
      const sessao = url.searchParams.get('sessao') || '';
      const codPedido = url.searchParams.get('codPedido') || '';
      const sub = Number(url.searchParams.get('sub') || 0);
      const s = sessoes.get(sessao);
      const cookie = s && s.subs[sub];
      if (!cookie) return json(res, 410, { erro: 'sessao expirada — refaca a busca' });
      try {
        const d = await detalhe(codPedido, cookie);
        return json(res, 200, d);
      } catch (e) {
        return json(res, 410, { erro: String(e.message || e) });
      }
    }

    json(res, 404, { erro: 'rota inexistente' });
  } catch (e) {
    json(res, 500, { erro: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`INPI teste rodando em http://localhost:${PORT}`);
});

// =============================================================================
// Pagina de teste (HTML/JS embutido)
// =============================================================================
const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LIV · Consulta de Marca no INPI (teste)</title>
<style>
  :root{ --bg:#f7f3ec; --card:#fffdf8; --ink:#22201c; --muted:#7a7164; --line:#e7dfd1;
         --brass:#9a7b3f; --brass2:#b8995a; --ok:#1f7a4d; --warn:#9a6a18; --bad:#9a3b2f; }
  *{ box-sizing:border-box }
  body{ margin:0; font-family:'Plus Jakarta Sans',system-ui,Segoe UI,Roboto,sans-serif;
        background:var(--bg); color:var(--ink); }
  .wrap{ max-width:880px; margin:0 auto; padding:32px 20px 80px; }
  .badge-test{ display:inline-block; font-size:11px; letter-spacing:.12em; text-transform:uppercase;
        color:var(--brass); border:1px solid var(--line); border-radius:999px; padding:4px 10px; }
  h1{ font-size:26px; margin:14px 0 4px; font-weight:700 }
  p.sub{ color:var(--muted); margin:0 0 22px; font-size:14px }
  form{ display:flex; gap:10px; flex-wrap:wrap; background:var(--card); border:1px solid var(--line);
        border-radius:14px; padding:14px; box-shadow:0 1px 0 rgba(0,0,0,.02) }
  input[type=text]{ flex:1; min-width:200px; padding:12px 14px; border:1px solid var(--line);
        border-radius:10px; font-size:15px; background:#fff; color:var(--ink) }
  input.classe{ flex:0 0 110px; min-width:90px }
  select.modo{ padding:12px 12px; border:1px solid var(--line); border-radius:10px; font-size:14px;
        background:#fff; color:var(--ink); cursor:pointer }
  button{ padding:12px 20px; border:0; border-radius:10px; background:var(--brass); color:#fff;
        font-weight:600; font-size:15px; cursor:pointer }
  button:hover{ background:#85692f }
  label.exata{ display:flex; align-items:center; gap:6px; color:var(--muted); font-size:13px }
  .status{ margin:18px 2px; color:var(--muted); font-size:14px; min-height:20px }
  .item{ background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px;
        margin:10px 0; cursor:pointer; transition:.12s; }
  .item:hover{ border-color:var(--brass2); transform:translateY(-1px) }
  .item .top{ display:flex; justify-content:space-between; gap:12px; align-items:baseline }
  .item .marca{ font-weight:700; font-size:16px }
  .item .meta{ color:var(--muted); font-size:13px; margin-top:4px }
  .pill{ font-size:12px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap }
  .pill.ok{ background:#e6f2eb; color:var(--ok) } .pill.warn{ background:#f6efdd; color:var(--warn) }
  .pill.bad{ background:#f4e6e3; color:var(--bad) } .pill.neu{ background:#eee9df; color:var(--muted) }
  .tag{ font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:.04em;
        padding:2px 7px; border-radius:6px; vertical-align:middle; margin-left:2px }
  .tag.tboth{ background:#ece4d2; color:var(--brass) }
  .tag.trad{ background:#e9eef3; color:#4a647a }
  .tag.tex{ background:#e6f2eb; color:var(--ok) }
  .thumb{ width:36px; height:36px; object-fit:contain; border:1px solid var(--line); border-radius:6px;
        background:#fff; vertical-align:middle; margin-right:9px }
  .det{ margin-top:10px; border-top:1px dashed var(--line); padding-top:10px; font-size:14px; display:none }
  .det.show{ display:block }
  .det .row{ display:flex; gap:8px; padding:3px 0 } .det .k{ color:var(--muted); flex:0 0 150px }
  .logo-wrap{ text-align:center; margin:2px 0 12px }
  .logo-big{ max-width:220px; max-height:220px; border:1px solid var(--line); border-radius:10px;
        background:#fff; padding:8px }
  .foot{ margin-top:30px; color:var(--muted); font-size:12px; line-height:1.6 }
  .spin{ opacity:.6 }
</style>
</head>
<body>
<div class="wrap">
  <span class="badge-test">Ambiente de teste · LIV</span>
  <h1>Consulta de Marca no INPI</h1>
  <p class="sub">Digite o nome da marca. Dados direto da Busca pública do INPI (pePI).</p>

  <form id="f">
    <input type="text" id="marca" placeholder="Ex.: NIKE, AÇAÍ, sua marca..." autocomplete="off" autofocus>
    <input type="text" id="classe" class="classe" placeholder="Classe (opc.)" inputmode="numeric">
    <select id="modo" class="modo" title="Tipo de pesquisa">
      <option value="exata">Exata</option>
      <option value="radical">Radical</option>
      <option value="ambas">Exata + Radical</option>
    </select>
    <button type="submit">Pesquisar</button>
  </form>

  <div class="status" id="status"></div>
  <div id="lista"></div>

  <div class="foot">
    Teste provisório · sem garantia de disponibilidade. O INPI não tem API oficial;
    isto lê a busca pública e pode variar conforme o site deles. Não substitui a análise jurídica da LIV.
  </div>
</div>

<script>
const $ = s => document.querySelector(s);
let SESSAO = null;

function pill(sit){
  const s = (sit||'').toLowerCase();
  if(/em vigor|registro de marca em vigor/.test(s)) return 'ok';
  if(/exame|aguarda|sobrestad|oposi|public|recurso|exig/.test(s)) return 'warn';
  if(/extint|arquiv|indefer|nulidad|cancel|cadu/.test(s)) return 'bad';
  return 'neu';
}

$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const marca = $('#marca').value.trim();
  if(!marca) return;
  const classe = $('#classe').value.trim();
  const modo = $('#modo').value;
  $('#status').textContent = 'Consultando o INPI'+(modo==='ambas'?' (exata + radical)':'')+'...';
  $('#lista').innerHTML = '';
  try{
    const q = new URLSearchParams({marca, classe, modo});
    const r = await fetch('/api/buscar?'+q).then(x=>x.json());
    if(r.erro){ $('#status').textContent = 'Erro: '+r.erro; return; }
    SESSAO = r.sessao;
    let info = '<b>'+r.total+'</b> resultado(s) para "'+esc(marca)+'"';
    if(modo==='exata')   info += ' · pesquisa exata';
    if(modo==='radical') info += ' · pesquisa radical';
    if(modo==='ambas')   info += ' · exata ('+r.totalExata+') + radical ('+r.totalRadical+'), unificados';
    $('#status').innerHTML = info;
    render(r.resultados, modo);
  }catch(err){ $('#status').textContent = 'Falha de conexão: '+err.message; }
});

function tagMatch(m){
  if(m==='ambas')   return '<span class="tag tboth">exata + radical</span>';
  if(m==='radical') return '<span class="tag trad">radical</span>';
  return '<span class="tag tex">exata</span>';
}

function render(rows, modo){
  const box = $('#lista'); box.innerHTML='';
  if(!rows.length){ box.innerHTML='<div class="item" style="cursor:default">Nenhum registro/pedido para esse nome.</div>'; return; }
  for(const it of rows){
    const sub = it.sub||0;
    const temFig = it.apresentacao && it.apresentacao!=='Nominativa';
    const thumb = temFig
      ? '<img class="thumb" loading="lazy" alt="logo" src="/api/logo?'
        + new URLSearchParams({sessao:SESSAO, codPedido:it.codPedido, sub}) + '" onerror="this.remove()">'
      : '';
    const el = document.createElement('div'); el.className='item';
    el.innerHTML =
      '<div class="top"><span class="marca">'+thumb+esc(it.marca||'—')
      + (modo==='ambas'? ' '+tagMatch(it.match):'')+'</span>'
      + '<span class="pill '+pill(it.situacao)+'">'+esc(it.situacao||it.situacaoImagem||'?')+'</span></div>'
      + '<div class="meta">Processo '+esc(it.numero)+' · '+esc(it.apresentacao||'?')
      + ' · classe '+esc(it.classe||'?')+' · '+esc(it.titular||'')+'</div>'
      + '<div class="det"></div>';
    el.addEventListener('click', ()=>verDetalhe(el, it));
    box.appendChild(el);
  }
}

async function verDetalhe(el, it){
  const det = el.querySelector('.det');
  if(det.classList.contains('show')){ det.classList.remove('show'); return; }
  const sub = it.sub||0;
  det.classList.add('show','spin'); det.innerHTML='Carregando detalhe...';
  try{
    const q = new URLSearchParams({sessao:SESSAO, codPedido:it.codPedido, sub});
    const d = await fetch('/api/detalhe?'+q).then(x=>x.json());
    det.classList.remove('spin');
    if(d.erro){ det.innerHTML='<span style="color:#9a3b2f">'+esc(d.erro)+'</span>'; return; }
    const logoUrl = '/api/logo?'+new URLSearchParams({sessao:SESSAO, codPedido:it.codPedido, sub});
    const logoBox = d.temLogo
      ? '<div class="logo-wrap"><img class="logo-big" alt="logo da marca" src="'+logoUrl+'" onerror="this.remove()"></div>'
      : '';
    const cls = (d.classes||[]).map(c=>c.classe+(c.subclasse?(' : '+c.subclasse):'')).join(', ') || it.classe || '';
    det.innerHTML = logoBox
      + row('Titular', d.titular) + row('Procurador', d.procurador)
      + row('Natureza', d.natureza) + row('Apresentação', d.apresentacao)
      + row('Classe', cls)
      + rowRaw('Especificação', d.especificacao ? esc(d.especificacao).replace(/\\n/g,'<br>') : '')
      + row('Depósito', d.dataDeposito) + row('Concessão', d.dataConcessao) + row('Vigência até', d.dataVigencia);
  }catch(err){ det.classList.remove('spin'); det.innerHTML='Falha: '+esc(err.message); }
}

const row = (k,v)=> v? '<div class="row"><span class="k">'+k+'</span><span>'+esc(v)+'</span></div>':'';
const rowRaw = (k,html)=> html? '<div class="row"><span class="k">'+k+'</span><span>'+html+'</span></div>':'';
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
</script>
</body>
</html>`;
