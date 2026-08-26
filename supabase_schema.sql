-- ==============================================================================
-- MINERAÍ - ESQUEMA DE BANCO DE DADOS POSTGRESQL (SUPABASE)
-- ==============================================================================
-- Execute este script completo no SQL Editor do seu painel Supabase
-- para criar todas as tabelas, índices, regras de segurança (RLS) e triggers.

-- 1. TABELA DE PERFIS DE USUÁRIOS (PROFILES)
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  email text not null,
  cpf_cnpj text,
  plan text not null default 'annual', -- 'annual', 'monthly', 'lifetime', 'trial'
  active boolean not null default true,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. TABELA DE ABAS / CATEGORIAS (TABS)
create table if not exists public.tabs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. TABELA DE OFERTAS GARIMPADAS (OFFERS)
create table if not exists public.offers (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  tab_id uuid references public.tabs(id) on delete set null,
  name text not null,
  page_id text not null,
  ads_count integer not null default 0,
  library_url text,
  landing_page text,
  affiliate_link text,
  funnel_notes text,
  status text not null default 'testing', -- 'testing', 'scaling', 'winner', 'analyzing', 'discarded'
  niche text not null default 'Geral',
  avatar_url text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 4. TABELA DE COMPARTILHAMENTOS PÚBLICOS (SHARES)
create table if not exists public.shares (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  share_token text unique not null,
  tab_id uuid references public.tabs(id) on delete cascade,
  tab_name text not null,
  snapshot jsonb not null default '[]'::jsonb,
  expires_at timestamp with time zone default (timezone('utc'::text, now()) + interval '30 days') not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- ==============================================================================
-- SEGURANÇA E ISOLAMENTO MULTI-TENANT (ROW LEVEL SECURITY - RLS)
-- ==============================================================================

alter table public.profiles enable row level security;
alter table public.tabs enable row level security;
alter table public.offers enable row level security;
alter table public.shares enable row level security;

-- Políticas para Profiles
create policy "Usuários podem ver seu próprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Usuários podem atualizar seu próprio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- Políticas para Tabs
create policy "Usuários podem ver suas próprias abas"
  on public.tabs for select
  using (auth.uid() = user_id);

create policy "Usuários podem criar abas"
  on public.tabs for insert
  with check (auth.uid() = user_id);

create policy "Usuários podem atualizar suas próprias abas"
  on public.tabs for update
  using (auth.uid() = user_id);

create policy "Usuários podem excluir suas próprias abas"
  on public.tabs for delete
  using (auth.uid() = user_id);

-- Políticas para Offers
create policy "Usuários podem ver suas próprias ofertas"
  on public.offers for select
  using (auth.uid() = user_id);

create policy "Usuários podem criar ofertas"
  on public.offers for insert
  with check (auth.uid() = user_id);

create policy "Usuários podem atualizar suas próprias ofertas"
  on public.offers for update
  using (auth.uid() = user_id);

create policy "Usuários podem excluir suas próprias ofertas"
  on public.offers for delete
  using (auth.uid() = user_id);

-- Políticas para Shares
create policy "Usuários podem gerenciar seus compartilhamentos"
  on public.shares for all
  using (auth.uid() = user_id);

create policy "Acesso público anônimo a links de compartilhamento ativos"
  on public.shares for select
  to anon, authenticated
  using (expires_at > timezone('utc'::text, now()));

-- ==============================================================================
-- TRIGGER AUTOMÁTICO: CRIAÇÃO DE PERFIL E ABA PADRÃO NO CADASTRO
-- ==============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  user_name text;
begin
  user_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));

  -- 1. Cria o perfil do usuário
  insert into public.profiles (id, name, email, plan, active)
  values (new.id, user_name, new.email, 'annual', true);

  -- 2. Cria a aba padrão "Geral" para o novo usuário
  insert into public.tabs (user_id, name)
  values (new.id, 'Geral');

  return new;
end;
$$ language plpgsql security definer;

-- Remove o trigger antigo se existir e recria
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==============================================================================
-- ÍNDICES PARA ALTA PERFORMANCE
-- ==============================================================================

create index if not exists idx_offers_user_id on public.offers(user_id);
create index if not exists idx_offers_tab_id on public.offers(tab_id);
create index if not exists idx_tabs_user_id on public.tabs(user_id);
create index if not exists idx_shares_token on public.shares(share_token);
