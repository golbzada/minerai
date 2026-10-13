-- ==============================================================================
-- MINERAÍ — MIGRAÇÃO 003: MENOS PRIVILÉGIO E POLICIES MAIS RÁPIDAS
-- ==============================================================================
-- Idempotente: pode rodar mais de uma vez. Não apaga dados e não muda o que o
-- painel ou a extensão fazem: tudo que é revogado aqui nunca foi usado pela API.
--
-- O que muda:
--   1. anon/authenticated perdem TRUNCATE, REFERENCES e TRIGGER nas tabelas
--      (vinham do GRANT ALL padrão do Supabase; a API REST nunca os usa).
--   2. id, user_id e created_at viram colunas imutáveis em offers e tabs:
--      o UPDATE só é concedido nas colunas que o painel e a extensão escrevem.
--   3. shares não tem mais UPDATE: um link público é gerado e revogado, nunca
--      editado — ninguém estende prazo nem troca o retrato depois de publicar.
--   4. sanitize_share_snapshot deixa de ser chamável como RPC.
--   5. Função nova criada em `public` não nasce exposta à API: quem criar uma
--      RPC precisa dar GRANT EXECUTE de propósito.
--   6. Policies usam (select auth.uid()), avaliado uma vez por consulta em vez
--      de uma vez por linha (aviso de performance do Supabase).
--   7. Índices nas chaves estrangeiras de shares.
-- ==============================================================================

begin;

-- ------------------------------------------------------------------------------
-- 1. Privilégios de tabela que a API nunca usa
-- ------------------------------------------------------------------------------
revoke truncate, references, trigger
  on table public.profiles, public.tabs, public.offers, public.shares
  from anon, authenticated;

-- ------------------------------------------------------------------------------
-- 2. Colunas imutáveis em offers e tabs (UPDATE só nas colunas editáveis)
-- ------------------------------------------------------------------------------
revoke update on table public.offers from authenticated;
grant update (
  name, page_id, ads_count, library_url, landing_page, affiliate_link,
  funnel_notes, status, niche, avatar_url, creative_thumb, history, tab_id, updated_at
) on table public.offers to authenticated;

revoke update on table public.tabs from authenticated;
grant update (name) on table public.tabs to authenticated;

-- ------------------------------------------------------------------------------
-- 3. Share: só criar, ver e revogar
-- ------------------------------------------------------------------------------
revoke update on table public.shares from authenticated;
drop policy if exists "Usuários podem atualizar seus compartilhamentos" on public.shares;

-- ------------------------------------------------------------------------------
-- 4. Função interna não é RPC
-- ------------------------------------------------------------------------------
revoke execute on function public.sanitize_share_snapshot(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 5. Função nova em public não nasce exposta
-- ------------------------------------------------------------------------------
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- ------------------------------------------------------------------------------
-- 6. Policies com (select auth.uid())
-- ------------------------------------------------------------------------------

-- Profiles
drop policy if exists "Usuários podem ver seu próprio perfil" on public.profiles;
create policy "Usuários podem ver seu próprio perfil"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Usuários podem atualizar seu próprio perfil" on public.profiles;
create policy "Usuários podem atualizar seu próprio perfil"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Tabs
drop policy if exists "Usuários podem ver suas próprias abas" on public.tabs;
create policy "Usuários podem ver suas próprias abas"
  on public.tabs for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Usuários podem criar abas" on public.tabs;
create policy "Usuários podem criar abas"
  on public.tabs for insert to authenticated
  with check ((select auth.uid()) = user_id and public.has_active_plan());

drop policy if exists "Usuários podem atualizar suas próprias abas" on public.tabs;
create policy "Usuários podem atualizar suas próprias abas"
  on public.tabs for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.has_active_plan());

drop policy if exists "Usuários podem excluir suas próprias abas" on public.tabs;
create policy "Usuários podem excluir suas próprias abas"
  on public.tabs for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Offers
drop policy if exists "Usuários podem ver suas próprias ofertas" on public.offers;
create policy "Usuários podem ver suas próprias ofertas"
  on public.offers for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Usuários podem criar ofertas" on public.offers;
create policy "Usuários podem criar ofertas"
  on public.offers for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = (select auth.uid())))
  );

drop policy if exists "Usuários podem atualizar suas próprias ofertas" on public.offers;
create policy "Usuários podem atualizar suas próprias ofertas"
  on public.offers for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = (select auth.uid())))
  );

drop policy if exists "Usuários podem excluir suas próprias ofertas" on public.offers;
create policy "Usuários podem excluir suas próprias ofertas"
  on public.offers for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Shares
drop policy if exists "Usuários podem ver seus compartilhamentos" on public.shares;
create policy "Usuários podem ver seus compartilhamentos"
  on public.shares for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Usuários podem criar compartilhamentos" on public.shares;
create policy "Usuários podem criar compartilhamentos"
  on public.shares for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and public.has_active_plan()
    and (tab_id is null or exists (select 1 from public.tabs t where t.id = tab_id and t.user_id = (select auth.uid())))
  );

drop policy if exists "Usuários podem excluir seus compartilhamentos" on public.shares;
create policy "Usuários podem excluir seus compartilhamentos"
  on public.shares for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ------------------------------------------------------------------------------
-- 7. Índices das chaves estrangeiras de shares
-- ------------------------------------------------------------------------------
create index if not exists idx_shares_user_id on public.shares(user_id);
create index if not exists idx_shares_tab_id on public.shares(tab_id);

commit;

notify pgrst, 'reload schema';
