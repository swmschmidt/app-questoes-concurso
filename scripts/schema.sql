create table if not exists public.avaliacoes (
  questao_id text primary key,
  nota smallint not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint avaliacoes_nota_valida check (nota between 1 and 5)
);

create index if not exists avaliacoes_nota_idx on public.avaliacoes (nota);

create table if not exists public.reportes (
  id bigserial primary key,
  questao_id text not null,
  descricao text,
  criado_em timestamptz not null default now()
);

create index if not exists reportes_questao_id_idx on public.reportes (questao_id);
create index if not exists reportes_criado_em_idx on public.reportes (criado_em desc);

create table if not exists public.anotacoes (
  questao_id text primary key,
  texto text not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists anotacoes_atualizado_em_idx on public.anotacoes (atualizado_em desc);

create table if not exists public.usuarios (
  id bigserial primary key,
  email text not null,
  nome text,
  firebase_uid text,
  criado_em timestamptz not null default now(),
  ultimo_acesso_em timestamptz
);

create unique index if not exists usuarios_email_idx on public.usuarios (lower(email));
create unique index if not exists usuarios_firebase_uid_idx on public.usuarios (firebase_uid) where firebase_uid is not null;

create table if not exists public.sessoes (
  id bigserial primary key,
  usuario_id bigint not null references public.usuarios (id) on delete cascade,
  token_hash text not null unique,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogado_em timestamptz,
  user_agent text
);

create index if not exists sessoes_usuario_idx on public.sessoes (usuario_id);

create table if not exists public.respostas (
  id bigserial primary key,
  usuario_id bigint not null references public.usuarios (id) on delete cascade,
  questao_id text not null,
  escolha text,
  acerto boolean not null default false,
  criado_em timestamptz not null default now()
);

create index if not exists respostas_usuario_questao_idx on public.respostas (usuario_id, questao_id);
create index if not exists respostas_usuario_criado_idx on public.respostas (usuario_id, criado_em desc);
create index if not exists respostas_usuario_acerto_idx on public.respostas (usuario_id, acerto);

alter table public.anotacoes add column if not exists usuario_id bigint references public.usuarios (id) on delete cascade;
alter table public.anotacoes drop constraint if exists anotacoes_pkey;
create unique index if not exists anotacoes_usuario_questao_idx
  on public.anotacoes (usuario_id, questao_id) nulls not distinct;
create index if not exists anotacoes_usuario_idx on public.anotacoes (usuario_id, atualizado_em desc);

create table if not exists public.questoes (
  id text primary key,
  prova_slug text,
  banca text,
  orgao text,
  ano smallint,
  cargo text,
  disciplina text,
  numero smallint,
  enunciado text not null,
  enunciado_busca text,
  alternativas jsonb not null,
  gabarito text,
  status text,
  extracao jsonb,
  fonte jsonb,
  importado_em timestamptz not null default now()
);

alter table public.questoes add column if not exists enunciado_busca text;

create index if not exists questoes_disciplina_idx on public.questoes (disciplina);
create index if not exists questoes_banca_idx on public.questoes (banca);
create index if not exists questoes_prova_slug_idx on public.questoes (prova_slug);
create index if not exists questoes_status_idx on public.questoes (status);
create index if not exists questoes_ano_idx on public.questoes (ano);

create table if not exists public.topicos (
  id text primary key,
  nome text not null,
  grupo text,
  n integer not null default 0,
  n_corretas integer not null default 0,
  bruto numeric,
  bonus numeric,
  score numeric,
  score_norm numeric,
  tier text,
  por_ano jsonb not null default '{}'::jsonb,
  top_bancas jsonb not null default '[]'::jsonb,
  termos jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);

create table if not exists public.subtopicos (
  topico_id text not null,
  id text not null,
  nome text not null,
  n integer not null default 0,
  n_corretas integer not null default 0,
  score numeric,
  tier text,
  por_ano jsonb not null default '{}'::jsonb,
  top_bancas jsonb not null default '[]'::jsonb,
  termos jsonb not null default '[]'::jsonb,
  ids_exemplo jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (topico_id, id)
);

create table if not exists public.questoes_classificacao (
  questao_id text primary key references public.questoes (id) on delete cascade,
  banca_canonica text,
  uf text,
  disciplina_analise text,
  topico text,
  subtopico text,
  subtopico_nome text,
  tipo_formato text,
  tipo_comando text,
  incidencia_score numeric,
  incidencia_tier text,
  alta_incidencia boolean not null default false,
  atualizado_em timestamptz not null default now()
);

create index if not exists classificacao_topico_idx on public.questoes_classificacao (topico);
create index if not exists classificacao_subtopico_idx on public.questoes_classificacao (topico, subtopico);
create index if not exists classificacao_disciplina_idx on public.questoes_classificacao (disciplina_analise);
create index if not exists classificacao_banca_idx on public.questoes_classificacao (banca_canonica);
create index if not exists classificacao_tier_idx on public.questoes_classificacao (incidencia_tier);
create index if not exists classificacao_alta_idx on public.questoes_classificacao (alta_incidencia);
create index if not exists classificacao_formato_idx on public.questoes_classificacao (tipo_formato);

alter table public.avaliacoes enable row level security;
alter table public.questoes enable row level security;
alter table public.reportes enable row level security;
alter table public.anotacoes enable row level security;
alter table public.topicos enable row level security;
alter table public.subtopicos enable row level security;
alter table public.questoes_classificacao enable row level security;
alter table public.usuarios enable row level security;
alter table public.sessoes enable row level security;
alter table public.respostas enable row level security;

do $$
declare
  tabela text;
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    foreach tabela in array array['avaliacoes', 'questoes', 'reportes', 'anotacoes', 'topicos',
                                   'subtopicos', 'questoes_classificacao', 'usuarios', 'sessoes', 'respostas'] loop
      execute format('revoke all on table public.%I from anon', tabela);
    end loop;
    revoke all on sequence public.reportes_id_seq from anon;
    revoke all on sequence public.usuarios_id_seq from anon;
    revoke all on sequence public.sessoes_id_seq from anon;
    revoke all on sequence public.respostas_id_seq from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    foreach tabela in array array['avaliacoes', 'questoes', 'reportes', 'anotacoes', 'topicos',
                                   'subtopicos', 'questoes_classificacao', 'usuarios', 'sessoes', 'respostas'] loop
      execute format('revoke all on table public.%I from authenticated', tabela);
    end loop;
    revoke all on sequence public.reportes_id_seq from authenticated;
    revoke all on sequence public.usuarios_id_seq from authenticated;
    revoke all on sequence public.sessoes_id_seq from authenticated;
    revoke all on sequence public.respostas_id_seq from authenticated;
  end if;
end $$;
