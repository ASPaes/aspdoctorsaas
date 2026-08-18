-- ============================================================================
-- Integração OEM — HISTÓRICO da tabela de preços dos módulos
--
-- POR QUE NO BANCO E NÃO NA EDGE FUNCTION
-- A `oem_espelho_modulo_preco` é reescrita inteira a cada carga (upsert das
-- ~107 linhas + limpeza do que saiu do catálogo). Quem sabe o que mudou é o
-- próprio UPDATE, não a função: comparar no TypeScript exigiria ler a tabela
-- antes de escrever e duplicar a regra em todo lugar que um dia escrever ali.
-- O gatilho registra a mudança de onde ela acontece, e a carga não muda em
-- nada — nenhuma edge function precisa de deploy por causa disto.
--
-- SÓ MUDANÇA ENTRA, NÃO LEITURA
-- A carga roda a cada 6 horas e mexe em TODAS as linhas (o `atualizado_em`
-- muda sempre). Gravar cada passagem daria ~430 linhas por dia dizendo que
-- nada aconteceu. O gatilho só escreve quando o VALOR é diferente — em regime,
-- este histórico fica parado por semanas, e é isso que se quer: cada linha
-- aqui é um preço que o OEM mexeu.
--
-- SEM ALERTA, POR DECISÃO
-- Decidido com o Alexandre em 18/08/2026: por ora só registrar, para poder
-- pesquisar e analisar depois. Avisar alguém quando um custo sobe é outra
-- entrega, e ela vai poder ser construída em cima desta tabela.
-- ============================================================================

begin;

create table if not exists public.oem_preco_modulo_historico (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  conta_integration_id uuid not null references public.oem_integration(id) on delete cascade,

  produto_codigo       text    not null,
  produto_nome         text    not null,
  modulo_codigo        integer not null,
  modulo_nome          text    not null,

  -- entrou  = o par produto×módulo passou a existir no catálogo
  -- alterou = mudou de preço
  -- saiu    = o par deixou de existir no catálogo do parceiro
  evento               text    not null check (evento in ('entrou', 'alterou', 'saiu')),
  valor_anterior       numeric(12,2),
  valor_novo           numeric(12,2),
  -- A diferença fica calculada: é por ela que se procura "o que subiu" sem
  -- refazer a conta em toda consulta.
  variacao             numeric(12,2) generated always as
                         (coalesce(valor_novo, 0) - coalesce(valor_anterior, 0)) stored,

  ocorrido_em          timestamptz not null default now()
);

-- Duas perguntas que esta tabela existe para responder, e um índice para cada:
-- "o que mudou no último mês?" e "qual a linha do tempo deste módulo?".
create index if not exists idx_oem_preco_hist_tenant
  on public.oem_preco_modulo_historico (tenant_id, ocorrido_em desc);
create index if not exists idx_oem_preco_hist_modulo
  on public.oem_preco_modulo_historico
     (conta_integration_id, produto_codigo, modulo_codigo, ocorrido_em desc);

-- ------------------------------------------------------------------ gatilho
--
-- SECURITY DEFINER de propósito: hoje só o service_role escreve na tabela de
-- preços e ele ignora RLS, mas o histórico não pode depender disso. Se um dia
-- outra coisa escrever ali, o registro tem que sair do mesmo jeito — histórico
-- que falha em silêncio é pior que não ter histórico.
create or replace function public.fn_oem_registrar_mudanca_preco()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.oem_preco_modulo_historico (
      tenant_id, conta_integration_id, produto_codigo, produto_nome,
      modulo_codigo, modulo_nome, evento, valor_anterior, valor_novo)
    values (
      new.tenant_id, new.conta_integration_id, new.produto_codigo, new.produto_nome,
      new.modulo_codigo, new.modulo_nome, 'entrou', null, new.valor_unitario);
    return new;

  elsif tg_op = 'UPDATE' then
    -- `is distinct from` e não `<>`: com NULL de um dos lados o `<>` devolve
    -- NULL, o if não dispara e a mudança passaria batida.
    if new.valor_unitario is distinct from old.valor_unitario then
      insert into public.oem_preco_modulo_historico (
        tenant_id, conta_integration_id, produto_codigo, produto_nome,
        modulo_codigo, modulo_nome, evento, valor_anterior, valor_novo)
      values (
        new.tenant_id, new.conta_integration_id, new.produto_codigo, new.produto_nome,
        new.modulo_codigo, new.modulo_nome, 'alterou', old.valor_unitario, new.valor_unitario);
    end if;
    return new;

  else
    insert into public.oem_preco_modulo_historico (
      tenant_id, conta_integration_id, produto_codigo, produto_nome,
      modulo_codigo, modulo_nome, evento, valor_anterior, valor_novo)
    values (
      old.tenant_id, old.conta_integration_id, old.produto_codigo, old.produto_nome,
      old.modulo_codigo, old.modulo_nome, 'saiu', old.valor_unitario, null);
    return old;
  end if;
end;
$$;

drop trigger if exists trg_oem_registrar_mudanca_preco on public.oem_espelho_modulo_preco;
create trigger trg_oem_registrar_mudanca_preco
  after insert or update or delete on public.oem_espelho_modulo_preco
  for each row execute function public.fn_oem_registrar_mudanca_preco();

-- ------------------------------------------------------- marco zero
--
-- As ~107 linhas já carregadas entraram ANTES do gatilho existir e não
-- disparariam 'entrou' nenhum. Sem esta carga o histórico começaria mudo: a
-- primeira alteração registraria "de 15,00 para 18,00" sem que 15,00 estivesse
-- em lugar nenhum como ponto de partida. `on conflict` não cabe aqui — o que
-- protege de rodar duas vezes é o `not exists`.
insert into public.oem_preco_modulo_historico (
  tenant_id, conta_integration_id, produto_codigo, produto_nome,
  modulo_codigo, modulo_nome, evento, valor_anterior, valor_novo, ocorrido_em)
select p.tenant_id, p.conta_integration_id, p.produto_codigo, p.produto_nome,
       p.modulo_codigo, p.modulo_nome, 'entrou', null, p.valor_unitario, p.atualizado_em
  from public.oem_espelho_modulo_preco p
 where not exists (
   select 1 from public.oem_preco_modulo_historico h
    where h.conta_integration_id = p.conta_integration_id
      and h.produto_codigo       = p.produto_codigo
      and h.modulo_codigo        = p.modulo_codigo);

-- ------------------------------------------------------------------ RLS
alter table public.oem_preco_modulo_historico enable row level security;

grant select on public.oem_preco_modulo_historico to authenticated;
grant all    on public.oem_preco_modulo_historico to service_role;

drop policy if exists oem_preco_hist_select on public.oem_preco_modulo_historico;
create policy oem_preco_hist_select on public.oem_preco_modulo_historico for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--
-- Marco zero — deve bater com as linhas da tabela de preços:
--   select evento, count(*) from public.oem_preco_modulo_historico group by 1;
--
-- O que o OEM mexeu no último mês:
--   select ocorrido_em, produto_nome, modulo_nome, valor_anterior, valor_novo, variacao
--     from public.oem_preco_modulo_historico
--    where evento <> 'entrou' and ocorrido_em > now() - interval '30 days'
--    order by ocorrido_em desc;
--
-- A linha do tempo de um módulo:
--   select ocorrido_em, evento, valor_anterior, valor_novo
--     from public.oem_preco_modulo_historico
--    where modulo_nome ilike '%Delivery Legal%'
--    order by ocorrido_em;
-- ---------------------------------------------------------------------------
