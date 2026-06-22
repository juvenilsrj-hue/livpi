-- =============================================================================
-- LIV · CRM/Kanban de prospecção (RPI/INPI) — schema do Supabase
-- Rode no SQL Editor do seu projeto Supabase. Espelha o store local (crm.json).
-- =============================================================================

create table if not exists leads (
  id              text primary key,            -- 'rpi-<numero do processo>'
  numero          text not null,
  titular         text,
  uf              text,
  marca           text,
  apresentacao    text,
  classes         text,
  despacho        text,
  despacho_codigo text,
  tom             text,
  tipo_problema   text,                         -- indeferido | oposicao | exigencia | outro
  tipo_pessoa     text,                         -- PJ | PF | ?
  documento       text,
  doc_tipo        text,                         -- CNPJ | CPF | CNPJ_RAIZ
  cnpj_raiz       text,
  revista         text,
  data_evento     text,
  origem          text,
  estagio         text not null default 'novo', -- novo|enriquecido|abordagem|respondeu|negociacao|ganho|perdido
  enriquecimento  jsonb,                        -- {status, razaoSocial, telefone, email, ...}
  criado_em       timestamptz default now(),
  atualizado_em   timestamptz default now()
);
create index if not exists leads_estagio_idx     on leads(estagio);
create index if not exists leads_tipo_pessoa_idx  on leads(tipo_pessoa);
create index if not exists leads_uf_idx           on leads(uf);

create table if not exists interacoes (
  id        bigint generated always as identity primary key,
  lead_id   text references leads(id) on delete cascade,
  tipo      text,                               -- mover | nota | email_enviado | resposta
  estagio   text,
  nota      text,
  quando    timestamptz default now()
);
create index if not exists interacoes_lead_idx on interacoes(lead_id);

-- RLS: o backend escreve com a service_role key (que ignora RLS). Habilitamos
-- RLS para que NENHUM acesso anônimo leia/escreva direto. Quando houver um app
-- cliente com login, criar policies por usuário autenticado.
alter table leads      enable row level security;
alter table interacoes enable row level security;
