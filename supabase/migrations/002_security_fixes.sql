-- ==============================================================================
-- MINERAÍ — MIGRAÇÃO 002: CORREÇÕES DE SEGURANÇA
-- ==============================================================================
-- Idempotente: pode ser executada mais de uma vez sem efeito colateral.
-- Não apaga dados. Constraints de tamanho entram como NOT VALID: valem para
-- escritas novas e não travam linhas antigas que por acaso excedam o limite.
--
-- Premissa: a chave anon fica no bundle do front e na extensão, então TODA a
-- segurança precisa estar no Postgres (RLS, privilégios e funções).
--
-- Regra de negócio de novos cadastros: ajuste NEW_USER_PLAN / NEW_USER_ACTIVE /
-- NEW_USER_TRIAL_DAYS dentro de handle_new_user (seção 4).
-- ==============================================================================

begin;

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------------------
-- 1. REMOVE quick_reset_password (account takeover: trocava senha só pelo e-mail)
-- ------------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'quick_reset_password'
  ) then
    revoke all on function public.quick_reset_password(text, text) from public, anon, authenticated;
    drop function public.quick_reset_password(text, text);
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 2. REMOVE auto-confirmação de e-mail (confirmava cadastro sem posse do e-mail)
--    Usuários já confirmados continuam confirmados: nada é revertido.
-- ------------------------------------------------------------------------------
drop trigger if exists on_auth_user_auto_confirm on auth.users;
drop function if exists public.auto_confirm_user();

-- ------------------------------------------------------------------------------
-- 3. PROFILES: usuário só edita name e cpf_cnpj. plan/active/trial_ends_at são
--    exclusivos do service_role (webhook de pagamento) e do painel do Supabase.
-- ------------------------------------------------------------------------------
alter table public.profiles add column if not exists trial_ends_at timestamp with time zone;

-- Ninguém autenticado pela chave anon insere/apaga perfil (só o trigger cria).
revoke insert, update, delete on table public.profiles from anon, authenticated;
revoke all on table public.profiles from anon;
grant update (name, cpf_cnpj, updated_at) on table public.profiles to authenticated;

-- Segunda barreira, independente dos privilégios de coluna: mesmo que alguém
-- reabra o grant por engano, o trigger recusa mudança dos campos de assinatura
-- vinda de um JWT de usuário. Roda como SECURITY INVOKER de propósito, para
-- auth.role() refletir quem está chamando.
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

drop policy if exists "Usuários podem atualizar seu próprio perfil" on public.profiles;
create policy "Usuários podem atualizar seu próprio perfil"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Usuários podem ver seu próprio perfil" on public.profiles;
create policy "Usuários podem ver seu próprio perfil"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- ------------------------------------------------------------------------------
-- 4. NOVO CADASTRO não nasce com plano pago
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 5. SHARES: sem SELECT anônimo na tabela. Leitura pública só por token, via RPC.
-- ------------------------------------------------------------------------------
drop policy if exists "Acesso público anônimo a links de compartilhamento ativos" on public.shares;
drop policy if exists "Usuários podem gerenciar seus compartilhamentos" on public.shares;
drop policy if exists "Usuários podem ver seus compartilhamentos" on public.shares;
drop policy if exists "Usuários podem criar compartilhamentos" on public.shares;
drop policy if exists "Usuários podem atualizar seus compartilhamentos" on public.shares;
drop policy if exists "Usuários podem excluir seus compartilhamentos" on public.shares;
revoke all on table public.shares from anon;

-- Token forte gerado no banco quando o cliente não manda um.
alter table public.shares alter column share_token set default encode(gen_random_bytes(24), 'hex');

create policy "Usuários podem ver seus compartilhamentos"
  on public.shares for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Usuários podem criar compartilhamentos"
  on public.shares for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

create policy "Usuários podem atualizar seus compartilhamentos"
  on public.shares for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

create policy "Usuários podem excluir seus compartilhamentos"
  on public.shares for delete
  to authenticated
  using (auth.uid() = user_id);

-- Remove do retrato público o que é privado do dono (link de afiliado e
-- anotações). Também vale para shares criados antes desta migração.
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

-- ------------------------------------------------------------------------------
-- 6. search_path fixo em toda função SECURITY DEFINER: aplicado acima em
--    handle_new_user, has_active_plan, get_share_by_token e sync_profile_email.
-- ------------------------------------------------------------------------------

-- ------------------------------------------------------------------------------
-- 7. OFFERS / TABS: dono do tab_id validado e plano ativo exigido para escrever.
--    Leitura e exclusão continuam livres para o dono (exportar/limpar acervo).
-- ------------------------------------------------------------------------------
revoke all on table public.offers from anon;
revoke all on table public.tabs from anon;

drop policy if exists "Usuários podem criar ofertas" on public.offers;
create policy "Usuários podem criar ofertas"
  on public.offers for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

drop policy if exists "Usuários podem atualizar suas próprias ofertas" on public.offers;
create policy "Usuários podem atualizar suas próprias ofertas"
  on public.offers for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = auth.uid()))
  );

drop policy if exists "Usuários podem ver suas próprias ofertas" on public.offers;
create policy "Usuários podem ver suas próprias ofertas"
  on public.offers for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Usuários podem excluir suas próprias ofertas" on public.offers;
create policy "Usuários podem excluir suas próprias ofertas"
  on public.offers for delete to authenticated using (auth.uid() = user_id);

drop policy if exists "Usuários podem criar abas" on public.tabs;
create policy "Usuários podem criar abas"
  on public.tabs for insert
  to authenticated
  with check (auth.uid() = user_id and public.has_active_plan());

drop policy if exists "Usuários podem atualizar suas próprias abas" on public.tabs;
create policy "Usuários podem atualizar suas próprias abas"
  on public.tabs for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_active_plan());

drop policy if exists "Usuários podem ver suas próprias abas" on public.tabs;
create policy "Usuários podem ver suas próprias abas"
  on public.tabs for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Usuários podem excluir suas próprias abas" on public.tabs;
create policy "Usuários podem excluir suas próprias abas"
  on public.tabs for delete to authenticated using (auth.uid() = user_id);

-- ------------------------------------------------------------------------------
-- 8. LIMITES DE TAMANHO E VALORES PERMITIDOS (NOT VALID: só escritas novas)
-- ------------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      -- profiles
      ('public.profiles', 'profiles_plan_check',
       $c$ plan in ('trial', 'monthly', 'annual', 'lifetime') $c$),
      ('public.profiles', 'profiles_name_len',
       $c$ char_length(name) between 1 and 120 $c$),
      ('public.profiles', 'profiles_cpf_cnpj_len',
       $c$ cpf_cnpj is null or char_length(cpf_cnpj) <= 20 $c$),
      -- tabs
      ('public.tabs', 'tabs_name_len',
       $c$ char_length(name) between 1 and 80 $c$),
      -- offers
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
      -- shares
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

-- ------------------------------------------------------------------------------
-- 9. profiles.email acompanha auth.users.email
-- ------------------------------------------------------------------------------
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

-- Corrige os perfis que já estavam dessincronizados.
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

-- ------------------------------------------------------------------------------
-- 10. Funções internas não são chamáveis pela API
-- ------------------------------------------------------------------------------
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.sync_profile_email() from public, anon, authenticated;
revoke all on function public.protect_profile_columns() from public, anon, authenticated;

-- Função utilitária criada pelo painel do Supabase que ficava exposta como RPC.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke all on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 11. Índice para a listagem paginada do painel (user_id + created_at desc)
-- ------------------------------------------------------------------------------
create index if not exists idx_offers_user_created on public.offers(user_id, created_at desc);

commit;

-- O PostgREST precisa recarregar o cache para enxergar a RPC nova.
notify pgrst, 'reload schema';
