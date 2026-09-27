-- ==============================================================================
-- MINERAÍ - ESQUEMA DE BANCO DE DADOS POSTGRESQL (SUPABASE)
-- ==============================================================================
-- Estado FINAL do banco, já com as correções de segurança da migração
-- supabase/migrations/002_security_fixes.sql. Serve para instalar do zero.
-- Em um banco que já existe, rode a migração 002 em vez deste arquivo.
--
-- Premissa de segurança: a chave anon é pública (fica no bundle do front e na
-- extensão). Tudo que protege dados está aqui: RLS, privilégios de coluna,
-- constraints e funções SECURITY DEFINER com search_path fixo.
--
-- Configurações que ficam FORA do SQL (painel do Supabase):
--   * Authentication -> Providers -> Email -> "Confirm email" LIGADO
--   * Authentication -> URL Configuration -> Site URL e Redirect URLs
--     (https://mineraiofertas.vercel.app, .../redefinir-senha, localhost)
--   * Project Settings -> Auth -> SMTP próprio (o SMTP padrão tem limite baixo)
-- ==============================================================================

create extension if not exists pgcrypto;

-- ==============================================================================
-- TABELAS
-- ==============================================================================

-- 1. PERFIS DE USUÁRIOS
--    plan/active/trial_ends_at são controlados só pelo servidor (service_role).
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  email text not null,
  cpf_cnpj text,
  plan text not null default 'trial', -- 'trial', 'monthly', 'annual', 'lifetime'
  active boolean not null default true,
  trial_ends_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.profiles add column if not exists trial_ends_at timestamp with time zone;

-- 2. ABAS / CATEGORIAS
create table if not exists public.tabs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. OFERTAS GARIMPADAS
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
  funnel_notes text,        -- anotações + bloco [[minerai:{...}]] de metadados
  status text not null default 'testing', -- 'testing', 'pre_scaling', 'scaling', 'winner', 'paused'
  niche text not null default 'Geral',
  avatar_url text,          -- https://... ou data:image/...
  creative_thumb text,      -- miniatura do criativo como data:image/... (<= 400 KB)
  history jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.offers add column if not exists creative_thumb text;

-- 4. COMPARTILHAMENTOS PÚBLICOS (somente leitura, por token, expiram em 30 dias)
create table if not exists public.shares (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  share_token text unique not null default encode(gen_random_bytes(24), 'hex'),
  tab_id uuid references public.tabs(id) on delete cascade,
  tab_name text not null,
  snapshot jsonb not null default '[]'::jsonb,
  expires_at timestamp with time zone default (timezone('utc'::text, now()) + interval '30 days') not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.shares alter column share_token set default encode(gen_random_bytes(24), 'hex');

-- ==============================================================================
-- CONSTRAINTS DE TAMANHO E DE VALORES (NOT VALID: não travam linhas antigas)
-- ==============================================================================
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('public.profiles', 'profiles_plan_check',
       $c$ plan in ('trial', 'monthly', 'annual', 'lifetime') $c$),
      ('public.profiles', 'profiles_name_len',
       $c$ char_length(name) between 1 and 120 $c$),
      ('public.profiles', 'profiles_cpf_cnpj_len',
       $c$ cpf_cnpj is null or char_length(cpf_cnpj) <= 20 $c$),
      ('public.tabs', 'tabs_name_len',
       $c$ char_length(name) between 1 and 80 $c$),
      ('public.offers', 'offers_status_check',
       $c$ status in ('testing', 'pre_scaling', 'scaling', 'winner', 'paused') $c$),
      ('public.offers', 'offers_name_len',
       $c$ char_length(name) between 1 and 200 $c$),
      ('public.offers', 'offers_page_id_len',
       $c$ char_length(page_id) <= 64 $c$),
      ('public.offers', 'offers_niche_len',
       $c$ char_length(niche) <= 80 $c$),
      ('public.offers', 'offers_ads_count_range',
       $c$ ads_count between 0 and 10000000 $c$),
      ('public.offers', 'offers_library_url_check',
       $c$ library_url is null or library_url = '' or (char_length(library_url) <= 2048 and library_url ~* '^https?://') $c$),
      ('public.offers', 'offers_landing_page_check',
       $c$ landing_page is null or landing_page = '' or (char_length(landing_page) <= 2048 and landing_page ~* '^https?://') $c$),
      ('public.offers', 'offers_affiliate_link_check',
       $c$ affiliate_link is null or affiliate_link = '' or (char_length(affiliate_link) <= 2048 and affiliate_link ~* '^https?://') $c$),
      ('public.offers', 'offers_funnel_notes_len',
       $c$ funnel_notes is null or char_length(funnel_notes) <= 10000 $c$),
      ('public.offers', 'offers_creative_thumb_check',
       $c$ creative_thumb is null or (char_length(creative_thumb) <= 400000 and creative_thumb like 'data:image/%') $c$),
      ('public.offers', 'offers_avatar_url_check',
       $c$ avatar_url is null or avatar_url = '' or (char_length(avatar_url) <= 200000 and (avatar_url ~* '^https://' or avatar_url like 'data:image/%')) $c$),
      ('public.offers', 'offers_history_check',
       $c$ jsonb_typeof(history) = 'array' and pg_column_size(history) <= 262144 $c$),
      ('public.shares', 'shares_tab_name_len',
       $c$ char_length(tab_name) between 1 and 80 $c$),
      ('public.shares', 'shares_token_len',
       $c$ char_length(share_token) between 20 and 128 $c$),
      ('public.shares', 'shares_snapshot_size',
       $c$ jsonb_typeof(snapshot) = 'array' and pg_column_size(snapshot) <= 8388608 $c$)
    ) as t(tbl, cname, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.cname) then
      execute format('alter table %s add constraint %I check (%s) not valid', c.tbl, c.cname, c.expr);
    end if;
  end loop;
end $$;

-- ==============================================================================
-- PRIVILÉGIOS DE TABELA
-- ==============================================================================
-- anon não toca em tabela nenhuma: a única leitura pública é a RPC de share.
revoke all on table public.profiles from anon;
revoke all on table public.tabs from anon;
revoke all on table public.offers from anon;
revoke all on table public.shares from anon;

-- Perfil: o usuário só atualiza name e cpf_cnpj. Criação é pelo trigger.
revoke insert, update, delete on table public.profiles from anon, authenticated;
grant update (name, cpf_cnpj, updated_at) on table public.profiles to authenticated;

-- ==============================================================================
-- FUNÇÕES
-- ==============================================================================

-- Plano ativo = fonte única de verdade para as policies de escrita.
-- O parâmetro existe só por compatibilidade de assinatura: a função responde
-- SEMPRE sobre o usuário do JWT, para ninguém consultar o plano de terceiros.
create or replace function public.has_active_plan(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.active
      and (
        p.plan <> 'trial'
        or coalesce(p.trial_ends_at, 'epoch'::timestamptz) > timezone('utc'::text, now())
      )
  );
$$;

revoke all on function public.has_active_plan(uuid) from public, anon;
grant execute on function public.has_active_plan(uuid) to authenticated, service_role;

-- Recusa alteração dos campos de assinatura vinda de JWT de usuário
-- (SECURITY INVOKER de propósito: auth.role() precisa refletir quem chama).
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if new.id            is distinct from old.id
       or new.email         is distinct from old.email
       or new.plan          is distinct from old.plan
       or new.active        is distinct from old.active
       or new.trial_ends_at is distinct from old.trial_ends_at
       or new.created_at    is distinct from old.created_at then
      raise exception 'Os dados de assinatura só podem ser alterados pelo servidor.'
        using errcode = '42501';
    end if;
  end if;
  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists profiles_protect_columns on public.profiles;
create trigger profiles_protect_columns
  before update on public.profiles
  for each row execute procedure public.protect_profile_columns();

-- Cria perfil + aba "Geral" no cadastro. Regra de negócio do plano inicial aqui.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_name text;
  -- >>> REGRA DE NEGÓCIO DO CADASTRO <<<
  NEW_USER_PLAN       constant text    := 'trial';
  NEW_USER_ACTIVE     constant boolean := true;
  NEW_USER_TRIAL_DAYS constant integer := 7;
begin
  user_name := left(
    coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1)),
    120
  );

  insert into public.profiles (id, name, email, plan, active, trial_ends_at)
  values (
    new.id,
    user_name,
    new.email,
    NEW_USER_PLAN,
    NEW_USER_ACTIVE,
    case when NEW_USER_PLAN = 'trial'
         then timezone('utc'::text, now()) + make_interval(days => NEW_USER_TRIAL_DAYS)
         else null end
  )
  on conflict (id) do update set
    name  = excluded.name,
    email = excluded.email;

  insert into public.tabs (user_id, name)
  values (new.id, 'Geral')
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- profiles.email acompanha auth.users.email
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set email = new.email
   where id = new.id
     and email is distinct from new.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute procedure public.sync_profile_email();

-- Retrato público sem os campos privados do dono.
create or replace function public.sanitize_share_snapshot(snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(
    jsonb_agg(elem - 'affiliate_link' - 'funnel_notes' - 'notes' - 'user_id'),
    '[]'::jsonb
  )
  from jsonb_array_elements(
    case when jsonb_typeof(snapshot) = 'array' then snapshot else '[]'::jsonb end
  ) as elem
  where jsonb_typeof(elem) = 'object';
$$;

-- Única porta pública: devolve SÓ o share daquele token, se não expirou.
create or replace function public.get_share_by_token(token text)
returns table (
  share_token text,
  tab_name text,
  snapshot jsonb,
  created_at timestamp with time zone,
  expires_at timestamp with time zone,
  owner_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.share_token,
    s.tab_name,
    public.sanitize_share_snapshot(s.snapshot),
    s.created_at,
    s.expires_at,
    split_part(coalesce(p.name, ''), ' ', 1) as owner_name
  from public.shares s
  left join public.profiles p on p.id = s.user_id
  where char_length(coalesce(token, '')) between 20 and 128
    and s.share_token = token
    and s.expires_at > timezone('utc'::text, now())
  limit 1;
$$;

revoke all on function public.sanitize_share_snapshot(jsonb) from public;
revoke all on function public.get_share_by_token(text) from public;
grant execute on function public.get_share_by_token(text) to anon, authenticated, service_role;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_profile_email() from public, anon, authenticated;
revoke all on function public.protect_profile_columns() from public, anon, authenticated;

-- Função utilitária criada pelo painel do Supabase que fica exposta como RPC.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- ==============================================================================
-- ROW LEVEL SECURITY
-- ==============================================================================

alter table public.profiles enable row level security;
alter table public.tabs enable row level security;
alter table public.offers enable row level security;
alter table public.shares enable row level security;

-- Profiles
drop policy if exists "Usuários podem ver seu próprio perfil" on public.profiles;
create policy "Usuários podem ver seu próprio perfil"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

drop policy if exists "Usuários podem atualizar seu próprio perfil" on public.profiles;
create policy "Usuários podem atualizar seu próprio perfil"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Tabs (escrita exige plano ativo)
drop policy if exists "Usuários podem ver suas próprias abas" on public.tabs;
create policy "Usuários podem ver suas próprias abas"
  on public.tabs for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Usuários podem criar abas" on public.tabs;
create policy "Usuários podem criar abas"
  on public.tabs for insert to authenticated
  with check (auth.uid() = user_id and public.has_active_plan());

drop policy if exists "Usuários podem atualizar suas próprias abas" on public.tabs;
create policy "Usuários podem atualizar suas próprias abas"
  on public.tabs for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_active_plan());

drop policy if exists "Usuários podem excluir suas próprias abas" on public.tabs;
create policy "Usuários podem excluir suas próprias abas"
  on public.tabs for delete to authenticated
  using (auth.uid() = user_id);

-- Offers (escrita exige plano ativo e tab_id do próprio usuário)
drop policy if exists "Usuários podem ver suas próprias ofertas" on public.offers;
create policy "Usuários podem ver suas próprias ofertas"
  on public.offers for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Usuários podem criar ofertas" on public.offers;
create policy "Usuários podem criar ofertas"
  on public.offers for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

drop policy if exists "Usuários podem atualizar suas próprias ofertas" on public.offers;
create policy "Usuários podem atualizar suas próprias ofertas"
  on public.offers for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

drop policy if exists "Usuários podem excluir suas próprias ofertas" on public.offers;
create policy "Usuários podem excluir suas próprias ofertas"
  on public.offers for delete to authenticated
  using (auth.uid() = user_id);

-- Shares (sem leitura anônima direta; público só via get_share_by_token)
drop policy if exists "Acesso público anônimo a links de compartilhamento ativos" on public.shares;
drop policy if exists "Usuários podem gerenciar seus compartilhamentos" on public.shares;

drop policy if exists "Usuários podem ver seus compartilhamentos" on public.shares;
create policy "Usuários podem ver seus compartilhamentos"
  on public.shares for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Usuários podem criar compartilhamentos" on public.shares;
create policy "Usuários podem criar compartilhamentos"
  on public.shares for insert to authenticated
  with check (
    auth.uid() = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

drop policy if exists "Usuários podem atualizar seus compartilhamentos" on public.shares;
create policy "Usuários podem atualizar seus compartilhamentos"
  on public.shares for update to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

drop policy if exists "Usuários podem excluir seus compartilhamentos" on public.shares;
create policy "Usuários podem excluir seus compartilhamentos"
  on public.shares for delete to authenticated
  using (auth.uid() = user_id);

-- ==============================================================================
-- ÍNDICES
-- ==============================================================================

create index if not exists idx_offers_user_id on public.offers(user_id);
create index if not exists idx_offers_tab_id on public.offers(tab_id);
create index if not exists idx_offers_user_created on public.offers(user_id, created_at desc);
create index if not exists idx_tabs_user_id on public.tabs(user_id);
create index if not exists idx_shares_token on public.shares(share_token);

notify pgrst, 'reload schema';
