-- ============================================================================
-- Botão "Atualizar DS" da aba Integrações › OEM › Custos
--
-- Traz o custo FATURADO da licença (reconciliacao_oem.custo_oem) para o
-- cadastro do produto do cliente (cliente_produtos.vlr_custo). Medido em
-- 18/08/2026: 687 dos 727 clientes com vínculo confirmado tinham os dois
-- valores diferentes.
--
-- POR QUE UMA RPC E NÃO UPDATE PELO FRONTEND
--   "Atualizar todos" são 687 linhas. Pelo PostgREST seriam 687 requisições,
--   cada uma disparando o gatilho que recalcula o cliente. Aqui é uma só.
--
-- O QUE ESTA ESCRITA DISPARA (verificado nos gatilhos de cliente_produtos)
--   * `valor_produto_enfileirar_omie` é AFTER UPDATE **OF vlr_mensal, ativo** —
--     mexer em vlr_custo NÃO enfileira nada para o Omie.
--   * `fn_sync_cliente_mensalidade` recalcula `clientes.custo_operacao` a
--     partir dos produtos ativos. É desejado: é esse campo que alimenta a
--     margem na ficha do cliente. `mensalidade` sai do vlr_mensal, que não é
--     tocado aqui, então ela não se move.
--
-- TRÊS COISAS QUE ELA SE RECUSA A FAZER
--   1. Gravar custo ZERO. Licença ativa sem custo no OEM é dado faltando, não
--      licença de graça — e zerar custo infla margem em silêncio. São contadas
--      e devolvidas como `sem_custo_no_oem`.
--   2. Escrever quando a filial cai em mais de um produto ativo. A regra é
--      1 filial = 1 cliente; havendo dúvida, os dois receberiam o mesmo custo
--      e o total do cliente dobraria. Devolvidas como `ambiguos`.
--   3. Tocar em licença desativada no OEM ou cliente cancelado — não há custo
--      corrente a espelhar.
-- ============================================================================

create or replace function public.atualizar_custo_ds_oem(
  p_tenant_id uuid,
  p_filiais   text[] default null   -- null = todas as elegíveis do tenant
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_res jsonb;
begin
  if not public.pode_decidir_oem(p_tenant_id) then
    raise exception 'Sem permissão para atualizar custos do OEM.';
  end if;

  -- Tudo numa consulta só. Sem tabela temporária de propósito: o pooler deste
  -- projeto troca de conexão entre statements, e temp table já mordeu aqui.
  with alvo as (
    -- Quem está vivo dos dois lados e tem vínculo confirmado na ficha.
    select r.filial_codigo,
           r.custo_oem,
           (select count(*) from public.cliente_produtos cp
             where cp.tenant_id = p_tenant_id
               and cp.oem_codigo_filial = r.filial_codigo
               and cp.ativo) as produtos_ativos
      from public.reconciliacao_oem r
     where r.tenant_id = p_tenant_id
       and r.status_oem = 'Ativo'
       and coalesce(r.cancelado_ds, false) = false
       and r.filial_codigo is not null
       and (p_filiais is null or r.filial_codigo = any(p_filiais))
  ),
  feito as (
    update public.cliente_produtos cp
       set vlr_custo  = a.custo_oem,
           updated_at = now()
      from alvo a
     where cp.tenant_id = p_tenant_id
       and cp.oem_codigo_filial = a.filial_codigo
       and cp.ativo
       and a.produtos_ativos = 1
       and coalesce(a.custo_oem, 0) > 0
       -- Já igual não vira escrita: sem isto, 687 clientes ganhariam
       -- updated_at novo a cada clique e o gatilho rodaria à toa.
       and cp.vlr_custo is distinct from a.custo_oem
    returning 1
  )
  select jsonb_build_object(
    'atualizados',      (select count(*) from feito),
    'sem_custo_no_oem', (select count(*) from alvo
                          where produtos_ativos = 1 and coalesce(custo_oem, 0) <= 0),
    'ambiguos',         (select count(*) from alvo where produtos_ativos > 1)
  ) into v_res;

  return v_res;
end $fn$;

-- `revoke from public` sozinho não restringe: o privilégio padrão já concede
-- EXECUTE a `authenticated`. Os revokes vão por papel, e a permissão de fato
-- é a `pode_decidir_oem` lá dentro.
revoke all on function public.atualizar_custo_ds_oem(uuid, text[]) from public;
revoke all on function public.atualizar_custo_ds_oem(uuid, text[]) from anon;
grant execute on function public.atualizar_custo_ds_oem(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ENSAIO SEGURO — roda de verdade e NAO grava (a excecao provoca rollback).
--
-- Duas coisas que separam validar de levar susto:
--
--   * O tenant e o DONO DA CONTA OEM, que e a **Digi Office**
--     (955178ba-b367-498d-8443-cc5b7d1ee163), nao a ASP. Confira com:
--         select tenant_id from public.oem_integration where ativo;
--
--   * No SQL Editor NAO existe usuario logado: auth.uid() e nulo, a
--     pode_decidir_oem devolve falso e a funcao barra com "Sem permissao" —
--     o que parece defeito e nao e. O set_config abaixo apresenta um admin
--     (ou super admin) so para esta transacao. Monte o claim com
--     json_build_object: JSON colado com aspas perde as aspas no caminho.
--
--   do $$
--   declare r jsonb;
--   begin
--     perform set_config('request.jwt.claims',
--       json_build_object('sub', '<user_id de um admin>',
--                         'role', 'authenticated')::text, true);
--     r := public.atualizar_custo_ds_oem(
--            '955178ba-b367-498d-8443-cc5b7d1ee163'::uuid, array['13250']);
--     raise exception 'SMOKE_OK|%', r::text;
--   end $$;
--
-- Medido em 18/08/2026, com o rollback conferido depois (o vlr_custo da 13250
-- continuou 1.037,84 e o updated_at continuou de 07/08):
--   SMOKE_OK|{"atualizados": 1, "ambiguos": 0, "sem_custo_no_oem": 0}
-- ---------------------------------------------------------------------------
