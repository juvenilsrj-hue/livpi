// =============================================================================
// CRM / Kanban de prospecção da LIV — Fase B (núcleo)
//
// Importa os "leads quentes" da RPI (ver rpi.mjs), guarda num store, enriquece
// com dados públicos (BrasilAPI p/ CNPJ; reconstrói o CNPJ de MEI a partir da
// raiz que aparece no nome do titular) e organiza num funil de estágios.
//
// STORE: por padrão grava em _cache/crm.json (roda hoje, sem nuvem). Quando o
// Supabase estiver configurado (.env com SUPABASE_URL + SUPABASE_SERVICE_KEY),
// trocar p/ o adapter de store-supabase.mjs — a interface é a mesma.
// =============================================================================
import fs from 'fs';
import path from 'path';
import { analisar } from './rpi.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const CACHE = path.join(import.meta.dirname, '_cache');
const DB_PATH = path.join(CACHE, 'crm.json');

// =============================================================================
// ESTÁGIOS DO FUNIL
// =============================================================================
export const STAGES = [
  { key: 'novo',       label: 'Novo',              cor: '#7a7164' },
  { key: 'enriquecido',label: 'Enriquecido',       cor: '#2f6f9a' },
  { key: 'abordagem',  label: 'Abordagem enviada', cor: '#9a7b3f' },
  { key: 'respondeu',  label: 'Respondeu',         cor: '#b8995a' },
  { key: 'negociacao', label: 'Em negociação',     cor: '#9a6a18' },
  { key: 'ganho',      label: 'Ganho',             cor: '#1f7a4d' },
  { key: 'perdido',    label: 'Perdido',           cor: '#9a3b2f' },
];
const STAGE_KEYS = new Set(STAGES.map(s => s.key));

// =============================================================================
// STORE (JSON local)
// =============================================================================
function carregar() {
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return { leads: [], seq: 0 }; }
}
function salvar(db) {
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}
const agora = () => new Date().toISOString();

// =============================================================================
// CLASSIFICAÇÃO DO TITULAR (PF x PJ, extrai documento)
// =============================================================================
const soDig = (s = '') => String(s).replace(/\D/g, '');

export function classificarTitular(titular = '') {
  const t = String(titular).trim();
  // CNPJ completo (14 dígitos, com ou sem máscara)
  const cnpj = (t.match(/\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}/) || [])[0];
  if (cnpj && soDig(cnpj).length === 14) return { tipoPessoa: 'PJ', documento: soDig(cnpj), docTipo: 'CNPJ' };
  // CPF (11 dígitos, com ou sem máscara)
  const cpf = (t.match(/(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)/) || [])[0];
  if (cpf && soDig(cpf).length === 11) return { tipoPessoa: 'PF', documento: soDig(cpf), docTipo: 'CPF' };
  const cpf2 = (t.match(/(?<!\d)\d{11}(?!\d)/) || [])[0];
  if (cpf2) return { tipoPessoa: 'PF', documento: cpf2, docTipo: 'CPF' };
  // raiz de CNPJ (8 dígitos mascarados "XX.XXX.XXX") — típico de MEI / empresário individual
  const raiz = (t.match(/(?<!\d)\d{2}\.\d{3}\.\d{3}(?![\/\d])/) || [])[0];
  if (raiz) return { tipoPessoa: 'PJ', documento: null, docTipo: 'CNPJ_RAIZ', cnpjRaiz: soDig(raiz) };
  // sufixos/termos de empresa
  if (/\b(LTDA|EIRELI|EPP|MEI|S\/A|S\.A|ASSOCIA|INSTITUTO|COM[ÉE]RCIO|IND[ÚU]STRIA|SERVI[ÇC]OS?|COMPANY|SOCIEDADE|CONSTRUTORA|INCORPORADORA|EMPREEND|PRODU[ÇC][ÕO]ES|COMERCIAL)\b/i.test(t) || /\bME$/i.test(t))
    return { tipoPessoa: 'PJ', documento: null, docTipo: null };
  return { tipoPessoa: '?', documento: null, docTipo: null };
}

// reconstrói o CNPJ completo (matriz 0001) a partir da raiz de 8 dígitos (MEI)
export function cnpjDeRaiz(raiz8) {
  const base = raiz8 + '0001';
  const dv = (nums, pesos) => {
    let s = 0; for (let i = 0; i < pesos.length; i++) s += (+nums[i]) * pesos[i];
    const r = s % 11; return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return base + d1 + '' + d2;
}

const tipoProblema = (codigo) =>
  /IPAS024|IPAS774/.test(codigo) ? 'indeferido' :
  /IPAS423/.test(codigo) ? 'oposicao' :
  /IPAS005|IPAS136|IPAS089|IPAS267|IPAS772|IPAS362/.test(codigo) ? 'exigencia' : 'outro';

// =============================================================================
// IMPORTAR leads de uma revista (default: os "leads quentes")
// =============================================================================
export async function importarDaRevista(numero, { procurador = 'Camila de Liz', balde = 'leadsQuentes' } = {}) {
  const a = await analisar(numero, { procurador, limite: 5000 });
  const fonte = a[balde];
  if (!fonte) throw new Error(`balde inválido: ${balde}`);
  const db = carregar();
  const existentes = new Set(db.leads.map(l => l.id));
  let importados = 0, jaExistiam = 0;

  for (const p of fonte.amostra) {
    const id = 'rpi-' + p.numero;
    if (existentes.has(id)) { jaExistiam++; continue; }
    const cls = classificarTitular(p.titular);
    db.leads.push({
      id,
      numero: p.numero,
      titular: p.titular,
      uf: p.uf,
      marca: p.marca,
      apresentacao: p.apresentacao,
      classes: p.classes,
      despacho: p.despacho,
      despachoCodigo: p.despachoCodigo,
      tom: p.tom,
      tipoProblema: tipoProblema(p.despachoCodigo || ''),
      tipoPessoa: cls.tipoPessoa,
      documento: cls.documento,
      docTipo: cls.docTipo,
      cnpjRaiz: cls.cnpjRaiz || null,
      revista: a.revista.numero,
      dataEvento: a.revista.dataBR,
      origem: `rpi-${balde}`,
      estagio: 'novo',
      enriquecimento: null,
      interacoes: [],
      criadoEm: agora(),
      atualizadoEm: agora(),
    });
    existentes.add(id);
    importados++;
  }
  salvar(db);
  return { importados, jaExistiam, total: db.leads.length };
}

// =============================================================================
// LISTAR / MOVER / INTERAÇÃO
// =============================================================================
export function listar() {
  const db = carregar();
  return { stages: STAGES, leads: db.leads };
}

export function mover(id, estagio) {
  if (!STAGE_KEYS.has(estagio)) throw new Error(`estágio inválido: ${estagio}`);
  const db = carregar();
  const lead = db.leads.find(l => l.id === id);
  if (!lead) throw new Error('lead não encontrado');
  lead.estagio = estagio;
  lead.atualizadoEm = agora();
  lead.interacoes.push({ tipo: 'mover', estagio, quando: agora() });
  salvar(db);
  return lead;
}

export function registrarInteracao(id, { tipo, nota }) {
  const db = carregar();
  const lead = db.leads.find(l => l.id === id);
  if (!lead) throw new Error('lead não encontrado');
  lead.interacoes.push({ tipo: tipo || 'nota', nota: nota || '', quando: agora() });
  lead.atualizadoEm = agora();
  salvar(db);
  return lead;
}

// =============================================================================
// ENRIQUECER (BrasilAPI; reconstrói CNPJ de MEI a partir da raiz)
// =============================================================================
async function brasilapiCNPJ(cnpj) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`CNPJ não encontrado (HTTP ${res.status})`);
  return res.json();
}

function montaEndereco(d) {
  const p = [d.logradouro, d.numero, d.bairro, d.municipio, d.uf, d.cep].filter(Boolean);
  return p.join(', ') || null;
}

export async function enriquecer(id) {
  const db = carregar();
  const lead = db.leads.find(l => l.id === id);
  if (!lead) throw new Error('lead não encontrado');

  let cnpj = null;
  if (lead.docTipo === 'CNPJ' && lead.documento?.length === 14) cnpj = lead.documento;
  else if (lead.cnpjRaiz) cnpj = cnpjDeRaiz(lead.cnpjRaiz);

  if (cnpj) {
    try {
      const d = await brasilapiCNPJ(cnpj);
      lead.enriquecimento = {
        status: 'ok', fonte: 'BrasilAPI', cnpj,
        razaoSocial: d.razao_social || null,
        nomeFantasia: d.nome_fantasia || null,
        situacao: d.descricao_situacao_cadastral || null,
        abertura: d.data_inicio_atividade || null,
        cnae: d.cnae_fiscal_descricao || null,
        endereco: montaEndereco(d),
        telefone: d.ddd_telefone_1 || null,
        email: d.email || null,
        socios: (d.qsa || []).map(s => s.nome_socio).filter(Boolean).slice(0, 5),
        atualizadoEm: agora(),
      };
      if (lead.estagio === 'novo') lead.estagio = 'enriquecido';
    } catch (e) {
      lead.enriquecimento = { status: 'nao_encontrado', fonte: 'BrasilAPI', cnpjTentado: cnpj, msg: String(e.message || e), atualizadoEm: agora() };
    }
  } else if (lead.tipoPessoa === 'PF') {
    lead.enriquecimento = { status: 'pf_protegido', nota: 'Pessoa física — sem contato público (protegido por LGPD).', atualizadoEm: agora() };
  } else {
    lead.enriquecimento = { status: 'precisa_busca_nome', nota: 'Empresa sem CNPJ no nome — precisa da busca por nome (fonte a definir).', atualizadoEm: agora() };
  }
  lead.atualizadoEm = agora();
  salvar(db);
  return lead;
}

// =============================================================================
// RUNNER DE TESTE:  node crm.mjs [revista]
// =============================================================================
const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (entry && import.meta.url.endsWith(entry.split('/').pop())) {
  const numero = process.argv[2] || '2893';
  console.log(`\n== Importando leads quentes da RPI ${numero} ==`);
  const r = await importarDaRevista(numero);
  console.log(r);
  const { leads } = listar();
  console.log(`\nPor tipo de pessoa:`,
    leads.reduce((a, l) => (a[l.tipoPessoa] = (a[l.tipoPessoa] || 0) + 1, a), {}));
  const mei = leads.find(l => l.cnpjRaiz);
  if (mei) {
    console.log(`\n== Enriquecendo um MEI (${mei.titular}) — CNPJ reconstruído: ${cnpjDeRaiz(mei.cnpjRaiz)} ==`);
    const e = await enriquecer(mei.id);
    console.log(JSON.stringify(e.enriquecimento, null, 2));
  }
}
