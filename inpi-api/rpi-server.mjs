// =============================================================================
// Servidor do Monitor da RPI (INPI) — Seção V "Marcas" — LIV
//   GET /                              -> pagina
//   GET /api/revistas                  -> ultimas 7 revistas (numero + data)
//   GET /api/codigos                   -> dicionario de codigos de despacho
//   GET /api/analise?revista=N&procurador=Nome  -> analise completa da revista
//
// Rodar:  node rpi-server.mjs   (porta 8788, ou PORT=xxxx)
// =============================================================================
import http from 'http';
import { listarRevistas, analisar, garantirXML, cacheadaEmDisco, DICIONARIO } from './rpi.mjs';

const PORT = Number(process.env.PORT) || 8788;

// estado de pre-carga das ultimas revistas: numero -> 'baixando'|'pronta'|'erro'
const prep = new Map();
let revistasCache = [];

// ao subir, lista as 7 revistas e baixa o XML de cada uma em background
// (sequencial, p/ nao martelar o INPI). Download e lento (~15s/9MB), mas so 1x.
async function preCarregar() {
  try {
    revistasCache = await listarRevistas(7);
    for (const r of revistasCache) prep.set(r.numero, cacheadaEmDisco(r.numero) ? 'pronta' : 'fila');
    for (const r of revistasCache) {
      if (prep.get(r.numero) === 'pronta') continue;
      prep.set(r.numero, 'baixando');
      try {
        await garantirXML(r.numero);
        prep.set(r.numero, 'pronta');
        console.log(`  ✓ RPI ${r.numero} pronta`);
      } catch (e) {
        prep.set(r.numero, 'erro');
        console.log(`  ✗ RPI ${r.numero}: ${e.message}`);
      }
    }
    console.log('Pré-carga concluída.');
  } catch (e) {
    console.log('Pré-carga falhou:', e.message);
  }
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
    if (url.pathname === '/api/revistas') {
      const revistas = revistasCache.length ? revistasCache : await listarRevistas(7);
      return json(res, 200, { revistas, prep: Object.fromEntries(prep) });
    }
    if (url.pathname === '/api/status') {
      return json(res, 200, { prep: Object.fromEntries(prep) });
    }
    if (url.pathname === '/api/codigos') {
      return json(res, 200, {
        codigos: DICIONARIO.map(([codigo, categoria, tom, nome]) => ({ codigo, categoria, tom, nome })),
      });
    }
    if (url.pathname === '/api/analise') {
      const revista = (url.searchParams.get('revista') || '').trim();
      if (!/^\d+$/.test(revista)) return json(res, 400, { erro: 'informe ?revista=NUMERO' });
      const procurador = (url.searchParams.get('procurador') || 'Camila de Liz').trim();
      const t0 = Date.now();
      const a = await analisar(revista, { procurador });
      return json(res, 200, { ...a, ms: Date.now() - t0 });
    }
    json(res, 404, { erro: 'rota inexistente' });
  } catch (e) {
    json(res, 500, { erro: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`Monitor RPI rodando em http://localhost:${PORT}`);
  console.log('Pré-carregando as últimas 7 revistas em background…');
  preCarregar();
});

// =============================================================================
// PAGINA (HTML/CSS/JS embutido) — paleta LIV (latao/creme)
// =============================================================================
const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LIV · Monitor da RPI (INPI) — Marcas</title>
<style>
  :root{ --bg:#f7f3ec; --card:#fffdf8; --ink:#22201c; --muted:#7a7164; --line:#e7dfd1;
         --brass:#9a7b3f; --brass2:#b8995a; --ok:#1f7a4d; --warn:#9a6a18; --bad:#9a3b2f; --chance:#2f6f9a; }
  *{ box-sizing:border-box }
  body{ margin:0; font-family:'Plus Jakarta Sans',system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  .wrap{ max-width:1040px; margin:0 auto; padding:28px 20px 90px; }
  .badge{ display:inline-block; font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--brass); border:1px solid var(--line); border-radius:999px; padding:4px 10px; }
  h1{ font-size:25px; margin:14px 0 4px; font-weight:700 }
  p.sub{ color:var(--muted); margin:0 0 22px; font-size:14px; max-width:680px }
  .panel{ background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin:14px 0; }
  .panel h2{ font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--brass); margin:0 0 12px; font-weight:700 }
  .ctrl{ display:flex; gap:10px; flex-wrap:wrap; align-items:center }
  label.lbl{ font-size:13px; color:var(--muted) }
  input[type=text]{ padding:10px 12px; border:1px solid var(--line); border-radius:10px; font-size:14px; background:#fff; color:var(--ink); min-width:240px }
  /* chips de revista */
  .chips{ display:flex; gap:8px; flex-wrap:wrap; margin-top:10px }
  .chip{ border:1px solid var(--line); background:#fff; border-radius:10px; padding:8px 12px; cursor:pointer; transition:.12s; text-align:center; line-height:1.2 }
  .chip:hover{ border-color:var(--brass2); transform:translateY(-1px) }
  .chip.sel{ border-color:var(--brass); background:#f3ead7; box-shadow:0 0 0 2px rgba(154,123,63,.15) }
  .chip .n{ font-weight:700; font-size:15px } .chip .d{ font-size:11px; color:var(--muted) }
  .chip .st{ display:block; font-size:10px; margin-top:3px; color:var(--muted) }
  .chip .st.ok{ color:var(--ok) } .chip .st.load{ color:var(--chance) } .chip .st.err{ color:var(--bad) }
  .chip.naopronta{ opacity:.7 }
  /* stats */
  .stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:10px }
  .stat{ border:1px solid var(--line); border-radius:10px; padding:10px 12px; background:#fff }
  .stat b{ display:block; font-size:22px } .stat span{ font-size:12px; color:var(--muted) }
  /* lista de processos */
  .item{ border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin:8px 0; background:#fff }
  .item .top{ display:flex; justify-content:space-between; gap:10px; align-items:baseline }
  .item .marca{ font-weight:700; font-size:15px } .item .meta{ color:var(--muted); font-size:12.5px; margin-top:3px }
  .pill{ font-size:11px; font-weight:700; padding:3px 9px; border-radius:999px; white-space:nowrap }
  .pill.bom{ background:#e6f2eb; color:var(--ok) } .pill.ruim{ background:#f4e6e3; color:var(--bad) }
  .pill.alerta{ background:#f6efdd; color:var(--warn) } .pill.neutro{ background:#eee9df; color:var(--muted) }
  .pill.chance{ background:#e4eef5; color:var(--chance) }
  .destaque{ border-color:var(--brass); box-shadow:0 0 0 2px rgba(154,123,63,.12) }
  .lead{ border-left:4px solid var(--bad) }
  .grid2{ display:grid; grid-template-columns:1fr 1fr; gap:14px } @media(max-width:760px){ .grid2{ grid-template-columns:1fr } }
  .count{ font-size:12px; color:var(--muted); font-weight:600 }
  .more{ font-size:12px; color:var(--brass); margin-top:6px }
  .status{ color:var(--muted); font-size:14px; margin:8px 2px; min-height:20px }
  .tabs{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px }
  .tab{ font-size:12px; padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; cursor:pointer }
  .tab.sel{ background:#f3ead7; border-color:var(--brass) }
  table.cod{ width:100%; border-collapse:collapse; font-size:12.5px }
  table.cod th,table.cod td{ text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top }
  table.cod th{ color:var(--muted); font-weight:600 }
  .foot{ margin-top:26px; color:var(--muted); font-size:12px; line-height:1.6 }
  details summary{ cursor:pointer; font-weight:700; color:var(--brass) }
  a{ color:var(--brass) }
</style>
</head>
<body>
<div class="wrap">
  <span class="badge">Ambiente de teste · LIV</span>
  <h1>Monitor da RPI — Seção V (Marcas)</h1>
  <p class="sub">Lê o caderno de Marcas da Revista da Propriedade Industrial (INPI) direto do XML oficial.
     Escolha uma das últimas 7 edições para ver os processos do procurador-alvo e o panorama de indeferidos, oposições e quem está como "o próprio".</p>

  <div class="panel">
    <h2>1 · Revista e procurador</h2>
    <div class="ctrl">
      <label class="lbl" for="proc">Procurador-alvo:</label>
      <input type="text" id="proc" value="Camila de Liz" autocomplete="off">
    </div>
    <div class="chips" id="chips"><span class="status">carregando revistas…</span></div>
  </div>

  <div class="status" id="status"></div>
  <div id="resultado"></div>

  <details class="panel" id="painelCodigos">
    <summary>Códigos e abreviações de despachos (Seção V — Marcas)</summary>
    <div id="codigos" style="margin-top:12px">carregando…</div>
  </details>

  <div class="foot">
    Fonte: <a href="https://revistas.inpi.gov.br/rpi/" target="_blank" rel="noopener">revistas.inpi.gov.br/rpi</a> ·
    dados do XML oficial da RPI. Não substitui a análise jurídica da LIV. Ambiente de teste, sem garantia de disponibilidade.
  </div>
</div>

<script>
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmt = n => Number(n).toLocaleString('pt-BR');
let REVISTAS=[], SEL=null;

function pillCls(tom){ return ['bom','ruim','alerta','chance','neutro'].includes(tom)?tom:'neutro'; }

function itemHTML(p, opts={}){
  const cls = 'item'+(opts.lead?' lead':'');
  return '<div class="'+cls+'">'
    + '<div class="top"><span class="marca">'+esc(p.marca||'— (nominativa s/ figura)')+'</span>'
    + '<span class="pill '+pillCls(p.tom)+'">'+esc(p.despacho||'?')+'</span></div>'
    + '<div class="meta">Processo '+esc(p.numero)
    + (p.apresentacao?(' · '+esc(p.apresentacao)):'')
    + (p.classes?(' · classe '+esc(p.classes)):'')
    + ' · <b>'+esc(p.titular||'—')+'</b>'+(p.uf?(' / '+esc(p.uf)):'')
    + (opts.mostrarProc&&p.procurador?(' · proc.: '+esc(p.procurador)):'')
    + (p.semProcurador&&!opts.lead?' · <i>o próprio</i>':'')
    + '</div></div>';
}

function bloco(titulo, dados, opts={}){
  if(!dados) return '';
  const lista = (dados.amostra||[]).map(p=>itemHTML(p,opts)).join('') || '<div class="count">'+(opts.vazio||'nenhum')+'</div>';
  const more = dados.total>(dados.amostra||[]).length
    ? '<div class="more">+ '+fmt(dados.total-dados.amostra.length)+' não exibidos (mostrando os primeiros '+dados.amostra.length+')</div>' : '';
  return '<div class="panel'+(opts.destaque?' destaque':'')+'">'
    + '<h2>'+esc(titulo)+' <span class="count">· '+fmt(dados.total)+'</span></h2>'
    + lista + more + '</div>';
}

let PREP={};
const stLabel = s => s==='pronta'?'<span class="st ok">● pronta</span>'
  : s==='baixando'?'<span class="st load">● baixando…</span>'
  : s==='erro'?'<span class="st err">● erro</span>'
  : '<span class="st">○ na fila</span>';

function pintarChips(){
  $('#chips').innerHTML = REVISTAS.map(rv=>{
    const s=PREP[rv.numero];
    return '<div class="chip'+(rv.numero===SEL?' sel':'')+(s&&s!=='pronta'?' naopronta':'')+'" data-n="'+rv.numero+'">'
      +'<div class="n">RPI '+rv.numero+'</div><div class="d">'+rv.dataBR+'</div>'+stLabel(s)+'</div>';
  }).join('');
  document.querySelectorAll('.chip').forEach(c=> c.onclick=()=>selecionar(c.dataset.n));
}

async function carregarRevistas(){
  try{
    const r = await fetch('/api/revistas').then(x=>x.json());
    REVISTAS = r.revistas||[]; PREP = r.prep||{};
    pintarChips(); pollStatus();
    // auto-abre a edição mais recente que já está pronta (sem esperar clique)
    const pronta = REVISTAS.find(rv=> PREP[rv.numero]==='pronta');
    if(pronta) selecionar(pronta.numero);
  }catch(e){ $('#chips').innerHTML='<span class="status">falha ao listar revistas: '+esc(e.message)+'</span>'; }
}

const todasProntas = ()=> REVISTAS.length && REVISTAS.every(rv=> ['pronta','erro'].includes(PREP[rv.numero]));
async function pollStatus(){
  if(todasProntas()) return;
  try{ const r = await fetch('/api/status').then(x=>x.json()); PREP = r.prep||PREP; pintarChips(); }catch(e){}
  if(!todasProntas()) setTimeout(pollStatus, 2500);
}

async function selecionar(numero){
  SEL = numero; pintarChips();
  const proc = $('#proc').value.trim() || 'Camila de Liz';
  const pronta = PREP[numero]==='pronta';
  $('#status').textContent = pronta
    ? 'Lendo a RPI '+numero+'…'
    : 'A RPI '+numero+' ainda está baixando do INPI (o servidor deles é lento, ~15s por edição). Abro assim que terminar…';
  $('#resultado').innerHTML='';
  try{
    const q = new URLSearchParams({revista:numero, procurador:proc});
    const a = await fetch('/api/analise?'+q).then(x=>x.json());
    if(a.erro){ $('#status').textContent='Erro: '+a.erro; return; }
    render(a);
  }catch(e){ $('#status').textContent='Falha: '+esc(e.message); }
}

function render(a){
  const s=a.stats;
  $('#status').innerHTML = 'RPI <b>'+a.revista.numero+'</b> · '+a.revista.dataBR+' · '+fmt(s.total)+' processos analisados em '+a.ms+'ms';
  const stat=(v,l)=> '<div class="stat"><b>'+fmt(v)+'</b><span>'+l+'</span></div>';
  let html = '<div class="panel"><h2>2 · Panorama da edição</h2><div class="stats">'
    + stat(s.concedidos,'Concessões') + stat(s.deferidos,'Deferimentos')
    + stat(s.publicadosParaOposicao,'Publicados p/ oposição') + stat(s.indeferidos,'Indeferidos')
    + stat(s.oposicoes,'Oposições') + stat(s.exigencias,'Exigências')
    + stat(s.semProcurador,'O próprio (s/ procurador)') + stat(s.comProcurador,'Com procurador')
    + '</div></div>';

  // Parte 3 — procurador-alvo
  html += bloco('3 · Processos de "'+esc(a.procuradorAlvo)+'"', a.camila,
    {destaque:true, vazio:'Nenhum processo deste procurador nesta edição.'});

  // LEAD QUENTE
  html += bloco('★ Leads quentes — "o próprio" que travou (indeferido / oposição / exigência)', a.leadsQuentes, {destaque:true, lead:true});

  // Parte 4 — em colunas
  html += '<div class="grid2">'
    + bloco('4a · Indeferidos', a.indeferidos)
    + bloco('4b · Oposições no processo', a.oposicoes)
    + '</div>';
  html += bloco('4c · "O próprio" (sem procurador)', a.oproprio);

  $('#resultado').innerHTML = html;
}

async function carregarCodigos(){
  try{
    const r = await fetch('/api/codigos').then(x=>x.json());
    const linhas = (r.codigos||[]).map(c=>
      '<tr><td><code>'+esc(c.codigo)+'</code></td>'
      +'<td><span class="pill '+pillCls(c.tom)+'">'+esc(c.categoria)+'</span></td>'
      +'<td>'+esc(c.nome)+'</td></tr>').join('');
    $('#codigos').innerHTML = '<table class="cod"><thead><tr><th>Código</th><th>Categoria</th><th>Significado</th></tr></thead><tbody>'+linhas+'</tbody></table>';
  }catch(e){ $('#codigos').textContent='falha: '+e.message; }
}

$('#proc').addEventListener('keydown', e=>{ if(e.key==='Enter' && SEL) selecionar(SEL); });
carregarRevistas();
carregarCodigos();
</script>
</body>
</html>`;
