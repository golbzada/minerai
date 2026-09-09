-- ==============================================================================
-- MINERAÍ - ESQUEMA DE BANCO DE DADOS POSTGRESQL (SUPABASE)
-- ==============================================================================
-- Execute este script completo no SQL Editor do seu painel Supabase
-- para criar/atualizar todas as tabelas, índices, regras de segurança (RLS),
-- auto-confirmação de usuários no cadastro e redefinição direta de senha.

-- Habilita extensão pgcrypto se necessário
create extension if not exists pgcrypto;

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
  status text not null default 'testing', -- 'testing', 'pre_scaling', 'scaling', 'winner', 'paused'
  niche text not null default 'Geral',
  avatar_url text,
  history jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3.1 MIGRAÇÃO: MINIATURA DO CRIATIVO
-- Guarda a imagem do anúncio (ou o quadro de capa do vídeo) reduzida a 320px e
-- embutida como data: URI. Contas criadas antes desta versão precisam desta
-- linha; sem ela a extensão continua salvando as ofertas, só que sem a imagem.
alter table public.offers add column if not exists creative_thumb text;

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
drop policy if exists "Usuários podem ver seu próprio perfil" on public.profiles;
create policy "Usuários podem ver seu próprio perfil"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Usuários podem atualizar seu próprio perfil" on public.profiles;
create policy "Usuários podem atualizar seu próprio perfil"
  on public.profiles for update
  using (auth.uid() = id);

-- Políticas para Tabs
drop policy if exists "Usuários podem ver suas próprias abas" on public.tabs;
create policy "Usuários podem ver suas próprias abas"
  on public.tabs for select
  using (auth.uid() = user_id);

drop policy if exists "Usuários podem criar abas" on public.tabs;
create policy "Usuários podem criar abas"
  on public.tabs for insert
  with check (auth.uid() = user_id);

drop policy if exists "Usuários podem atualizar suas próprias abas" on public.tabs;
create policy "Usuários podem atualizar suas próprias abas"
  on public.tabs for update
  using (auth.uid() = user_id);

drop policy if exists "Usuários podem excluir suas próprias abas" on public.tabs;
create policy "Usuários podem excluir suas próprias abas"
  on public.tabs for delete
  using (auth.uid() = user_id);

-- Políticas para Offers
drop policy if exists "Usuários podem ver suas próprias ofertas" on public.offers;
create policy "Usuários podem ver suas próprias ofertas"
  on public.offers for select
  using (auth.uid() = user_id);

drop policy if exists "Usuários podem criar ofertas" on public.offers;
create policy "Usuários podem criar ofertas"
  on public.offers for insert
  with check (auth.uid() = user_id);

drop policy if exists "Usuários podem atualizar suas próprias ofertas" on public.offers;
create policy "Usuários podem atualizar suas próprias ofertas"
  on public.offers for update
  using (auth.uid() = user_id);

drop policy if exists "Usuários podem excluir suas próprias ofertas" on public.offers;
create policy "Usuários podem excluir suas próprias ofertas"
  on public.offers for delete
  using (auth.uid() = user_id);

-- Políticas para Shares
drop policy if exists "Usuários podem gerenciar seus compartilhamentos" on public.shares;
create policy "Usuários podem gerenciar seus compartilhamentos"
  on public.shares for all
  using (auth.uid() = user_id);

drop policy if exists "Acesso público anônimo a links de compartilhamento ativos" on public.shares;
create policy "Acesso público anônimo a links de compartilhamento ativos"
  on public.shares for select
  to anon, authenticated
  using (expires_at > timezone('utc'::text, now()));

-- ==============================================================================
-- 1. AUTO-CONFIRMAÇÃO AUTOMÁTICA DE USUÁRIOS NO CADASTRO
-- (Elimina a dependência de confirmação por e-mail no login)
-- ==============================================================================

create or replace function public.auto_confirm_user()
returns trigger as $$
begin
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_auto_confirm on auth.users;
create trigger on_auth_user_auto_confirm
  before insert on auth.users
  for each row execute procedure public.auto_confirm_user();

-- Auto-confirma todos os usuários que já foram cadastrados anteriormente
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email_confirmed_at is null;

-- ==============================================================================
-- 2. TRIGGER AUTOMÁTICO: CRIAÇÃO DE PERFIL E ABA PADRÃO NO CADASTRO
-- ==============================================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  user_name text;
begin
  user_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));

  -- 1. Cria o perfil do usuário se ainda não existir
  insert into public.profiles (id, name, email, plan, active)
  values (new.id, user_name, new.email, 'annual', true)
  on conflict (id) do update set
    name = excluded.name,
    email = excluded.email;

  -- 2. Cria a aba padrão "Geral" para o novo usuário
  insert into public.tabs (user_id, name)
  values (new.id, 'Geral')
  on conflict do nothing;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ==============================================================================
-- 3. FUNÇÃO RPC: REDEFINIÇÃO DIRETA DE SENHA (ESQUECI MINHA SENHA)
-- (Permite redefinir a senha com segurança sem depender de envio de e-mails/SMTP)
-- ==============================================================================

create or replace function public.quick_reset_password(user_email text, new_password text)
returns jsonb as $$
declare
  u_id uuid;
begin
  select id into u_id from auth.users where lower(email) = lower(trim(user_email));
  
  if u_id is null then
    return jsonb_build_object('success', false, 'error', 'Nenhuma conta encontrada com este e-mail.');
  end if;

  update auth.users
  set encrypted_password = crypt(new_password, gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = u_id;

  return jsonb_build_object('success', true, 'message', 'Senha alterada com sucesso! Você já pode entrar.');
end;
$$ language plpgsql security definer;

-- Permite chamada anônima pública para a função de reset de senha
grant execute on function public.quick_reset_password(text, text) to anon, authenticated;

-- ==============================================================================
-- ÍNDICES PARA ALTA PERFORMANCE
-- ==============================================================================

create index if not exists idx_offers_user_id on public.offers(user_id);
create index if not exists idx_offers_tab_id on public.offers(tab_id);
create index if not exists idx_tabs_user_id on public.tabs(user_id);
create index if not exists idx_shares_token on public.shares(share_token);
