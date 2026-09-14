-- ============================================================
-- Chatbot de Mapeamento - Getnet
-- Schema Supabase (Postgres)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Dados de dominio: mapeamento de terminais
-- ------------------------------------------------------------

create table if not exists public.mapeamentos (
  id uuid primary key default gen_random_uuid(),
  codigo_terminal text not null unique,
  nome_estabelecimento text not null,
  status text not null check (status in ('pendente', 'em_andamento', 'instalado', 'concluido', 'cancelado')),
  endereco text,
  cidade text,
  estado text,
  responsavel text,
  data_solicitacao date,
  data_prevista date,
  data_conclusao date,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mapeamentos_codigo_terminal on public.mapeamentos (codigo_terminal);
create index if not exists idx_mapeamentos_status on public.mapeamentos (status);

-- pendencias podem ser varias por terminal
create table if not exists public.mapeamentos_pendencias (
  id uuid primary key default gen_random_uuid(),
  mapeamento_id uuid not null references public.mapeamentos(id) on delete cascade,
  descricao text not null,
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_pendencias_mapeamento_id on public.mapeamentos_pendencias (mapeamento_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_mapeamentos_updated_at
before update on public.mapeamentos
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Memoria de conversa do chatbot (por sessionId)
-- ------------------------------------------------------------

create table if not exists public.chatbot_getnet_sessions (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  user_id text,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chatbot_sessions_session_id_created_at
  on public.chatbot_getnet_sessions (session_id, created_at);

-- ------------------------------------------------------------
-- 3. RLS
-- Sem policies = so a service_role key acessa (bypassa RLS).
-- Configure o node Supabase do n8n com a service_role key, nao a anon key.
-- ------------------------------------------------------------

alter table public.mapeamentos enable row level security;
alter table public.mapeamentos_pendencias enable row level security;
alter table public.chatbot_getnet_sessions enable row level security;

-- ------------------------------------------------------------
-- 4. Dado de exemplo para testar o fluxo antes de ter dados reais
-- ------------------------------------------------------------

insert into public.mapeamentos (codigo_terminal, nome_estabelecimento, status, cidade, estado, responsavel, data_solicitacao, data_prevista)
values ('TRM-0001', 'Mercado Exemplo Ltda', 'em_andamento', 'Sao Paulo', 'SP', 'Ana Souza', current_date - interval '5 days', current_date + interval '3 days')
on conflict (codigo_terminal) do nothing;

insert into public.mapeamentos_pendencias (mapeamento_id, descricao)
select id, 'Aguardando confirmacao de endereco pelo cliente'
from public.mapeamentos where codigo_terminal = 'TRM-0001'
on conflict do nothing;
