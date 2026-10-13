-- ==============================================================================
-- MINERAÍ — MIGRAÇÃO 004: LIMITES POR USUÁRIO (abuso de requisições)
-- ==============================================================================
-- Idempotente: pode rodar mais de uma vez. Não apaga nem altera dados.
--
-- Guia KipperDev, risco 09 (DoS / abuso): a API do Supabase não tem limite
-- de linhas por conta. Uma conta válida (ou um token roubado) podia inserir
-- ofertas sem parar e esgotar o espaço do plano gratuito. Aqui o banco impõe
-- tetos por usuário, no mesmo lugar onde já ficam as outras regras (RLS):
--   - offers: até 5000 por conta (o painel já lê no máximo 5000);
--   - tabs:   até 50 por conta;
--   - shares: até 100 por conta, e validade entre 1 e 90 dias (o painel
--             oferece 7, 30 e 90).
-- Quem passa do teto recebe o erro 23514 (o painel mostra "Algum campo
-- ultrapassa o tamanho permitido ou tem um valor inválido").
-- ==============================================================================

begin;

create or replace function public.limitar_linhas_por_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  teto integer := tg_argv[0]::integer;
  atual integer;
begin
  -- Trava a contagem por usuário para dois inserts ao mesmo tempo não passarem do teto juntos.
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.user_id::text));
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name)
    into atual using new.user_id;
  if atual >= teto then
    raise exception 'Limite de % registros por conta atingido em %.', teto, tg_table_name
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.limitar_linhas_por_usuario() from public, anon, authenticated;

drop trigger if exists offers_limite_por_usuario on public.offers;
create trigger offers_limite_por_usuario
  before insert on public.offers
  for each row execute procedure public.limitar_linhas_por_usuario('5000');

drop trigger if exists tabs_limite_por_usuario on public.tabs;
create trigger tabs_limite_por_usuario
  before insert on public.tabs
  for each row execute procedure public.limitar_linhas_por_usuario('50');

drop trigger if exists shares_limite_por_usuario on public.shares;
create trigger shares_limite_por_usuario
  before insert on public.shares
  for each row execute procedure public.limitar_linhas_por_usuario('100');

-- Validade do link público: entre 1 e 90 dias a partir da criação.
-- NOT VALID: vale só para linhas novas (links antigos não são tocados).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shares_expires_at_range') then
    alter table public.shares add constraint shares_expires_at_range
      check (expires_at > created_at and expires_at <= created_at + interval '91 days') not valid;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
