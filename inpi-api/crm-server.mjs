// =============================================================================
// Servidor do Kanban de prospecção da LIV — Fase B
//   GET /                                  -> board (HTML)
//   GET /api/stages                        -> estágios do funil
//   GET /api/leads                         -> todos os leads
//   GET /api/importar?revista=N&balde=...  -> importa leads da RPI
//   GET /api/mover?id=&estagio=            -> move card de estágio
//   GET /api/enriquecer?id=                -> enriquece (BrasilAPI)
//   GET /api/interacao?id=&tipo=&nota=     -> registra nota/interação
//
// Rodar:  node crm-server.mjs   (porta 8789, ou PORT=xxxx)
// =============================================================================
import http from 'http';
import { STAGES, listar, importarDaRevista, mover, enriquecer, registrarInteracao } from './crm.mjs';
import { listarRevistas } from './rpi.mjs';

const PORT = Number(process.env.PORT) || 8789;

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const q = u.searchParams;
  try {
    if (u.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGINA);
    }
    if (u.pathname === '/api/stages') return json(res, 200, { stages: STAGES });
    if (u.pathname === '/api/revistas') return json(res, 200, { revistas: await listarRevistas(7) });
    if (u.pathname === '/api/leads') return json(res, 200, listar());
    if (u.pathname === '/api/importar') {
      const revista = (q.get('revista') || '').trim();
      if (!/^\d+$/.test(revista)) return json(res, 400, { erro: 'informe ?revista=NUMERO' });
      const balde = q.get('balde') || 'leadsQuentes';
      const r = await importarDaRevista(revista, { balde });
      return json(res, 200, r);
    }
    if (u.pathname === '/api/mover') return json(res, 200, mover(q.get('id'), q.get('estagio')));
    if (u.pathname === '/api/enriquecer') return json(res, 200, await enriquecer(q.get('id')));
    if (u.pathname === '/api/interacao')
      return json(res, 200, registrarInteracao(q.get('id'), { tipo: q.get('tipo'), nota: q.get('nota') }));
    json(res, 404, { erro: 'rota inexistente' });
  } catch (e) {
    json(res, 500, { erro: String(e.message || e) });
  }
});
server.listen(PORT, () => console.log(`CRM/Kanban LIV rodando em http://localhost:${PORT}`));

// =============================================================================
// PAGINA
// =============================================================================
const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LIV · Kanban de Prospecção (RPI)</title>
<style>
  :root{ --bg:#f7f3ec; --card:#fffdf8; --ink:#22201c; --muted:#7a7164; --line:#e7dfd1;
         --brass:#9a7b3f; --brass2:#b8995a; --ok:#1f7a4d; --warn:#9a6a18; --bad:#9a3b2f; --info:#2f6f9a; }
  *{ box-sizing:border-box }
  body{ margin:0; font-family:'Plus Jakarta Sans',system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--ink); }
  header{ padding:16px 20px; border-bottom:1px solid var(--line); background:var(--card); position:sticky; top:0; z-index:5 }
  h1{ font-size:18px; margin:0 0 2px; font-weight:700 } .sub{ color:var(--muted); font-size:12.5px }
  .bar{ display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:10px }
  select,input,button{ font-family:inherit; font-size:13px; padding:7px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink) }
  button{ background:var(--brass); color:#fff; border:0; font-weight:600; cursor:pointer }
  button.ghost{ background:#fff; color:var(--brass); border:1px solid var(--line) }
  button:hover{ filter:brightness(.96) }
  .status{ color:var(--muted); font-size:12.5px; margin-left:4px }
  .board{ display:flex; gap:12px; padding:16px 20px 60px; overflow-x:auto; align-items:flex-start; min-height:70vh }
  .col{ flex:0 0 268px; background:#f1ece1; border:1px solid var(--line); border-radius:12px; display:flex; flex-direction:column; max-height:82vh }
  .col h2{ font-size:12px; text-transform:uppercase; letter-spacing:.06em; margin:0; padding:11px 13px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line) }
  .col h2 .c{ font-weight:700; color:var(--muted); font-size:12px; background:#fff; border-radius:999px; padding:1px 8px }
  .col .body{ padding:10px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; flex:1 }
  .col.drag{ outline:2px dashed var(--brass2); outline-offset:-4px }
  .lead{ background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px; cursor:grab; }
  .lead:active{ cursor:grabbing }
  .lead .nome{ font-weight:700; font-size:13.5px; line-height:1.25 }
  .lead .meta{ color:var(--muted); font-size:11.5px; margin-top:4px; line-height:1.4 }
  .tags{ display:flex; gap:5px; flex-wrap:wrap; margin-top:6px }
  .tag{ font-size:10px; font-weight:700; padding:2px 7px; border-radius:999px }
  .tag.indeferido{ background:#f4e6e3; color:var(--bad) } .tag.oposicao{ background:#f6efdd; color:var(--warn) }
  .tag.exigencia{ background:#f6efdd; color:var(--warn) } .tag.outro{ background:#eee9df; color:var(--muted) }
  .tag.PJ{ background:#e4eef5; color:var(--info) } .tag.PF{ background:#eee9df; color:var(--muted) }
  .tag.q{ background:#eee9df; color:var(--muted) }
  .enr{ margin-top:8px; border-top:1px dashed var(--line); padding-top:7px; font-size:11.5px }
  .enr .k{ color:var(--muted) }
  .enr.ok{ color:var(--ink) } .enr.warn{ color:var(--warn) } .enr.bad{ color:var(--bad) }
  .row{ display:flex; gap:6px; margin-top:8px }
  .row button{ font-size:11px; padding:5px 8px; flex:1 }
  a{ color:var(--brass) }
</style>
</head>
<body>
<header>
  <h1>Kanban de Prospecção · LIV</h1>
  <div class="sub">Leads da RPI (INPI) → enriquecimento → funil de vendas. Arraste os cards entre as colunas.</div>
  <div class="bar">
    <label class="status">Importar da</label>
    <select id="revista"></select>
    <select id="balde">
      <option value="leadsQuentes">Leads quentes (o próprio + travou)</option>
      <option value="indeferidos">Indeferidos</option>
      <option value="oposicoes">Oposições</option>
      <option value="oproprio">O próprio (sem procurador)</option>
    </select>
    <button id="btImportar">Importar</button>
    <span style="width:14px"></span>
    <label class="status">Filtros:</label>
    <select id="fPessoa"><option value="">Pessoa: todas</option><option value="PJ">PJ</option><option value="PF">PF</option><option value="?">A classificar</option></select>
    <select id="fProblema"><option value="">Problema: todos</option><option value="indeferido">Indeferido</option><option value="oposicao">Oposição</option><option value="exigencia">Exigência</option></select>
    <input id="fUF" placeholder="UF" style="width:64px">
    <input id="fTexto" placeholder="buscar titular…" style="width:150px">
    <button class="ghost" id="btEnriqPJ">Enriquecer PJ visíveis</button>
    <span class="status" id="status"></span>
  </div>
</header>

<div class="board" id="board"></div>

<script>
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let STAGES=[], LEADS=[];

function filtros(){
  return { pessoa:$('#fPessoa').value, problema:$('#fProblema').value,
           uf:$('#fUF').value.trim().toUpperCase(), texto:$('#fTexto').value.trim().toLowerCase() };
}
function passa(l, f){
  if(f.pessoa && l.tipoPessoa!==f.pessoa) return false;
  if(f.problema && l.tipoProblema!==f.problema) return false;
  if(f.uf && (l.uf||'')!==f.uf) return false;
  if(f.texto && !(l.titular||'').toLowerCase().includes(f.texto)) return false;
  return true;
}

function enrHTML(l){
  const e=l.enriquecimento; if(!e) return '';
  if(e.status==='ok'){
    const linhas=[];
    if(e.razaoSocial) linhas.push('<div><span class="k">Empresa:</span> '+esc(e.nomeFantasia||e.razaoSocial)+'</div>');
    if(e.telefone) linhas.push('<div><span class="k">Tel:</span> '+esc(e.telefone)+'</div>');
    if(e.email) linhas.push('<div><span class="k">E-mail:</span> '+esc(e.email)+'</div>');
    if(e.situacao) linhas.push('<div><span class="k">Situação:</span> '+esc(e.situacao)+'</div>');
    return '<div class="enr ok">'+linhas.join('')+'</div>';
  }
  if(e.status==='pf_protegido') return '<div class="enr warn">Pessoa física — sem contato público (LGPD)</div>';
  if(e.status==='precisa_busca_nome') return '<div class="enr warn">Empresa sem CNPJ no nome — precisa busca por nome</div>';
  if(e.status==='nao_encontrado') return '<div class="enr bad">CNPJ não encontrado na base</div>';
  return '';
}

function cardHTML(l){
  const t = l.tipoProblema||'outro';
  return '<div class="lead" draggable="true" data-id="'+esc(l.id)+'">'
    + '<div class="nome">'+esc(l.titular||'—')+'</div>'
    + '<div class="tags"><span class="tag '+t+'">'+esc(t)+'</span>'
    + '<span class="tag '+(l.tipoPessoa==='?'?'q':esc(l.tipoPessoa))+'">'+esc(l.tipoPessoa)+'</span></div>'
    + '<div class="meta">'+esc(l.marca||'(nominativa s/ figura)')+'<br>'
    + 'proc. '+esc(l.numero)+(l.classes?(' · cl. '+esc(l.classes)):'')+(l.uf?(' · '+esc(l.uf)):'')
    + ' · '+esc(l.dataEvento)+'<br>'+esc(l.despacho||'')+'</div>'
    + enrHTML(l)
    + '<div class="row"><button class="ghost bt-enr" data-id="'+esc(l.id)+'">Enriquecer</button></div>'
    + '</div>';
}

function render(){
  const f=filtros();
  const vis = LEADS.filter(l=>passa(l,f));
  const board=$('#board'); board.innerHTML='';
  for(const s of STAGES){
    const doS = vis.filter(l=>l.estagio===s.key);
    const col=document.createElement('div'); col.className='col'; col.dataset.estagio=s.key;
    const mostra = doS.slice(0,60);
    col.innerHTML='<h2 style="color:'+s.cor+'">'+esc(s.label)+'<span class="c">'+doS.length+'</span></h2>'
      +'<div class="body">'+mostra.map(cardHTML).join('')
      +(doS.length>mostra.length?('<div class="status">+ '+(doS.length-mostra.length)+' (filtre para ver)</div>'):'')+'</div>';
    board.appendChild(col);
  }
  ligarDnD();
  $('#status').textContent = vis.length+' de '+LEADS.length+' leads';
}

function ligarDnD(){
  document.querySelectorAll('.lead').forEach(c=>{
    c.addEventListener('dragstart',e=>{ e.dataTransfer.setData('text/plain', c.dataset.id); });
  });
  document.querySelectorAll('.bt-enr').forEach(b=>{
    b.addEventListener('click', async e=>{ e.stopPropagation(); await enriquecer(b.dataset.id, b); });
  });
  document.querySelectorAll('.col').forEach(col=>{
    col.addEventListener('dragover',e=>{ e.preventDefault(); col.classList.add('drag'); });
    col.addEventListener('dragleave',()=> col.classList.remove('drag'));
    col.addEventListener('drop', async e=>{
      e.preventDefault(); col.classList.remove('drag');
      const id=e.dataTransfer.getData('text/plain'); const estagio=col.dataset.estagio;
      const lead=LEADS.find(l=>l.id===id); if(!lead||lead.estagio===estagio) return;
      lead.estagio=estagio; render();
      try{ await fetch('/api/mover?'+new URLSearchParams({id,estagio})); }catch(_){ }
    });
  });
}

async function enriquecer(id, btn){
  if(btn){ btn.textContent='…'; btn.disabled=true; }
  try{
    const l=await fetch('/api/enriquecer?'+new URLSearchParams({id})).then(x=>x.json());
    const i=LEADS.findIndex(x=>x.id===id); if(i>=0) LEADS[i]=l;
    render();
  }catch(e){ if(btn){ btn.textContent='erro'; } }
}

async function carregar(){
  const [st, lv, rv] = await Promise.all([
    fetch('/api/stages').then(x=>x.json()),
    fetch('/api/leads').then(x=>x.json()),
    fetch('/api/revistas').then(x=>x.json()).catch(()=>({revistas:[]})),
  ]);
  STAGES=st.stages; LEADS=lv.leads||[];
  $('#revista').innerHTML=(rv.revistas||[]).map(r=>'<option value="'+r.numero+'">RPI '+r.numero+' · '+r.dataBR+'</option>').join('');
  render();
}

$('#btImportar').addEventListener('click', async ()=>{
  const revista=$('#revista').value, balde=$('#balde').value;
  $('#status').textContent='importando…';
  const r=await fetch('/api/importar?'+new URLSearchParams({revista,balde})).then(x=>x.json());
  if(r.erro){ $('#status').textContent='erro: '+r.erro; return; }
  $('#status').textContent='importados '+r.importados+' (já existiam '+r.jaExistiam+')';
  const lv=await fetch('/api/leads').then(x=>x.json()); LEADS=lv.leads||[]; render();
});

$('#btEnriqPJ').addEventListener('click', async ()=>{
  const f=filtros();
  const alvos=LEADS.filter(l=>passa(l,f) && (l.docTipo==='CNPJ'||l.cnpjRaiz) && (!l.enriquecimento||l.enriquecimento.status!=='ok'));
  if(!alvos.length){ $('#status').textContent='nenhum PJ enriquecível visível'; return; }
  for(let i=0;i<alvos.length;i++){
    $('#status').textContent='enriquecendo '+(i+1)+'/'+alvos.length+'…';
    await enriquecer(alvos[i].id);
    await new Promise(r=>setTimeout(r,1200)); // espaça p/ não estourar a BrasilAPI
  }
  $('#status').textContent='enriquecimento concluído';
});

['fPessoa','fProblema','fUF','fTexto'].forEach(id=> $('#'+id).addEventListener('input', render));
carregar();
</script>
</body>
</html>`;
