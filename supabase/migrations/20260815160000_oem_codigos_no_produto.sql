-- ============================================================================
-- Os códigos do OEM passam a morar na linha de produto do cliente
--
-- Regra confirmada pelo Alexandre em 15/08/2026: **1 filial do OEM = 1 cadastro
-- de cliente no DoctorSaaS**. Cliente com 3 lojas são 3 clientes, 3 vínculos,
-- 3 licenças. Por isso um par (grupo, filial) por linha de produto basta — não
-- precisa de lista.
--
-- POR QUE NO PRODUTO E NÃO NO CLIENTE
-- É onde o custo já mora (cliente_produtos.vlr_custo) e é onde a pessoa olha
-- quando quer saber o que aquela licença é. Cliente pode ter produto que não
-- vem do OEM (certificado, outro fornecedor) — esses ficam sem código, e é
-- assim que se distingue um do outro.
--
-- ⚠️ O PERIGO DESTA TABELA
-- `trg_sync_cliente_mensalidade` dispara em QUALQUER update de
-- cliente_produtos, sem cláusula WHEN, e reescreve clientes.mensalidade e
-- clientes.custo_operacao com a soma das linhas ativas. Gravar dois campos de
-- texto recalcularia o faturamento de todo cliente tocado — e um backfill
-- passaria por centenas deles de uma vez.
--
-- O projeto já tem a válvula: a própria trigger sai fora quando
-- `doctorsaas.skip_valor_sync` = 'true'. Toda escrita daqui passa por ela, com
-- escopo LOCAL (terceiro argumento do set_config), então o efeito morre no fim
-- da transação e nada vaza para a sessão seguinte.
--
-- QUAL LINHA DE PRODUTO RECEBE O CÓDIGO
-- A que não deixa dúvida: quando o cliente tem UMA linha ativa, é ela. Com mais
-- de uma não dá para adivinhar qual é a do OEM, então nenhuma é escrita e o
-- caso fica visível em reconciliacao_oem.observacao em vez de virar palpite.
-- ============================================================================

begin;

alter table public.cliente_produtos
  add column if not exists oem_codigo_grupo  text,
  add column if not exists oem_codigo_filial text;

comment on column public.cliente_produtos.oem_codigo_grupo  is
  'codgrupo no OEM. Gravado pelo vínculo em Integrações › OEM, não à mão.';
comment on column public.cliente_produtos.oem_codigo_filial is
  'codfilial no OEM — é a chave da licença. Gravado pelo vínculo.';

-- "Que cliente é esta filial?" é a pergunta que a conferência vai fazer a cada
-- sincronização. Sem índice é varredura na tabela inteira.
create index if not exists idx_cliente_produtos_oem_filial
  on public.cliente_produtos (tenant_id, oem_codigo_filial)
  where oem_codigo_filial is not null;

-- ------------------------------------------------------------- o gravador
-- Uma função só, usada pelo vínculo, pelo desvínculo e pelo backfill — para
-- que a proteção da trigger não dependa de ninguém lembrar dela.
-- Devolve: 1 gravou · 0 nenhuma linha ativa · -1 ambíguo (mais de uma linha).
create or replace function public.oem_gravar_codigos_no_produto(
  p_cliente_id uuid,
  p_grupo      text,
  p_filial     text
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_qtd int; v_id uuid;
begin
  select count(*) into v_qtd from public.cliente_produtos
   where cliente_id = p_cliente_id and ativo = true;

  -- Limpar (p_filial nulo) vale para todas as linhas do cliente: não sobra
  -- código órfão apontando para uma licença que já foi desvinculada.
  if p_filial is null then
    perform set_config('doctorsaas.skip_valor_sync', 'true', true);
    update public.cliente_produtos
       set oem_codigo_grupo = null, oem_codigo_filial = null
     where cliente_id = p_cliente_id
       and (oem_codigo_grupo is not null or oem_codigo_filial is not null);
    perform set_config('doctorsaas.skip_valor_sync', 'false', true);
    return 1;
  end if;

  if v_qtd = 0 then return 0; end if;
  if v_qtd > 1 then return -1; end if;

  select id into v_id from public.cliente_produtos
   where cliente_id = p_cliente_id and ativo = true;

  perform set_config('doctorsaas.skip_valor_sync', 'true', true);
  update public.cliente_produtos
     set oem_codigo_grupo = p_grupo, oem_codigo_filial = p_filial
   where id = v_id;
  perform set_config('doctorsaas.skip_valor_sync', 'false', true);
  return 1;
end $$;

revoke all on function public.oem_gravar_codigos_no_produto(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.oem_gravar_codigos_no_produto(uuid, text, text) to service_role;

-- ------------------------------------------- vincular passa a gravar o código
create or replace function public.vincular_filial_oem(
  p_recon_id   uuid,
  p_cliente_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid; v_cli record; v_rec record; v_res int;
begin
  select tenant_id, empresa_codigo, filial_codigo into v_rec
    from public.reconciliacao_oem where id = p_recon_id;
  if v_rec is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  v_tenant := v_rec.tenant_id;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  -- O cliente TEM que ser do mesmo tenant. Sem esta checagem a RPC seria um
  -- furo: ela roda como definer e enxerga a base inteira.
  select id, coalesce(nome_fantasia, razao_social) as nome, mensalidade, cancelado
    into v_cli
    from public.clientes
   where id = p_cliente_id and tenant_id = v_tenant;
  if not found then raise exception 'Cliente não pertence a esta empresa.'; end if;

  -- Um cliente por filial: se esta licença já estava em outro cliente, o código
  -- sai de lá antes de entrar aqui — senão dois cadastros diriam ser a mesma.
  perform public.oem_gravar_codigos_no_produto(r.ds_customer_id, null, null)
     from public.reconciliacao_oem r
    where r.id = p_recon_id and r.ds_customer_id is not null
      and r.ds_customer_id <> p_cliente_id;

  v_res := 0;
  if v_rec.filial_codigo is not null then
    v_res := public.oem_gravar_codigos_no_produto(
      p_cliente_id, v_rec.empresa_codigo, v_rec.filial_codigo);
  end if;

  update public.reconciliacao_oem
     set ds_customer_id      = v_cli.id,
         candidato_escolhido = v_cli.id,
         razao_ds            = v_cli.nome,
         mensalidade_ds      = v_cli.mensalidade,
         cancelado_ds        = v_cli.cancelado,
         estado_match        = case when filial_codigo is null then estado_match else 'CASADO' end,
         status_usuario      = 'vinculado',
         observacao          = case v_res
                                 when -1 then 'Cliente tem mais de um produto ativo — código do OEM não foi gravado em nenhum.'
                                 when  0 then 'Cliente não tem produto ativo — código do OEM não foi gravado.'
                                 else null end,
         resolvido_em        = now(),
         resolvido_por       = auth.uid()
   where id = p_recon_id;
end $$;

revoke all on function public.vincular_filial_oem(uuid, uuid) from public;
grant execute on function public.vincular_filial_oem(uuid, uuid) to authenticated, service_role;

-- ------------------------------------------ desvincular apaga o que gravou
create or replace function public.desvincular_filial_oem(p_recon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid; v_cliente uuid;
begin
  select tenant_id, ds_customer_id into v_tenant, v_cliente
    from public.reconciliacao_oem where id = p_recon_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  if v_cliente is not null then
    perform public.oem_gravar_codigos_no_produto(v_cliente, null, null);
  end if;

  update public.reconciliacao_oem
     set ds_customer_id      = null,
         candidato_escolhido = null,
         razao_ds            = null,
         mensalidade_ds      = null,
         cancelado_ds        = null,
         estado_match        = case when filial_codigo is null then estado_match
                                    when qtd_candidatos_ds > 1 then 'AMBIGUO'
                                    when qtd_candidatos_ds = 0 then 'SO_NO_OEM'
                                    else estado_match end,
         status_usuario      = 'novo',
         observacao          = null,
         resolvido_em        = null,
         resolvido_por       = null
   where id = p_recon_id;
end $$;

revoke all on function public.desvincular_filial_oem(uuid) from public;
grant execute on function public.desvincular_filial_oem(uuid) to authenticated, service_role;

-- ------------------------------------------------------------- o backfill
-- "Todos que já estão com o vínculo realizado precisam ficar registrados aqui."
-- Vale para o vínculo automático por CNPJ também, não só para o feito à mão.
--
-- ⚠️ O CASO QUE O LOOP INGÊNUO ERRARIA
-- A regra é 1 filial = 1 cliente, mas o dado pode não obedecer: quando um CNPJ
-- tem VÁRIAS filiais e UM só cliente ativo no DoctorSaaS, o casamento
-- automático apontou todas elas para esse mesmo cliente (é o `ativos.length
-- === 1` do oem-espelho-sync). Percorrer isso em ordem gravaria a filial A,
-- depois B por cima, depois C — e a última venceria em silêncio, deixando o
-- cadastro dizendo ser uma licença que não é.
--
-- Esses ficam de fora e viram pendência visível. Ou faltam cadastros de cliente
-- (a regra do Alexandre diz que deveriam existir), ou o vínculo automático
-- errou. Nos dois casos é decisão de gente, não de backfill.
do $$
declare r record; v_res int;
begin
  for r in
    select ro.ds_customer_id, ro.empresa_codigo, ro.filial_codigo
      from public.reconciliacao_oem ro
     where ro.ds_customer_id is not null
       and ro.filial_codigo  is not null
       and ro.ds_customer_id in (
             select ds_customer_id from public.reconciliacao_oem
              where ds_customer_id is not null and filial_codigo is not null
              group by 1 having count(distinct filial_codigo) = 1
           )
  loop
    v_res := public.oem_gravar_codigos_no_produto(
      r.ds_customer_id, r.empresa_codigo, r.filial_codigo);
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA — rodar DEPOIS, como consulta separada.
--
-- O SQL Editor do Supabase não mostra RAISE NOTICE, então o resultado do
-- backfill não sai por lá. Esta consulta reconstrói os números a partir do
-- dado, que é mais confiável do que um contador de dentro do loop:
--
--   select
--     count(*)                                        as vinculos_com_filial,
--     count(*) filter (where cp.oem_codigo_filial
--                         = ro.filial_codigo)         as gravados,
--     count(*) filter (where x.filiais_do_cliente > 1) as varias_filiais_mesmo_cliente,
--     count(*) filter (where x.filiais_do_cliente = 1
--                        and x.produtos_ativos > 1)   as mais_de_um_produto_ativo,
--     count(*) filter (where x.filiais_do_cliente = 1
--                        and x.produtos_ativos = 0)   as sem_produto_ativo
--   from public.reconciliacao_oem ro
--   join lateral (
--     select (select count(*) from public.cliente_produtos c
--              where c.cliente_id = ro.ds_customer_id and c.ativo) as produtos_ativos,
--            (select count(distinct r2.filial_codigo) from public.reconciliacao_oem r2
--              where r2.ds_customer_id = ro.ds_customer_id
--                and r2.filial_codigo is not null)                 as filiais_do_cliente
--   ) x on true
--   left join public.cliente_produtos cp
--     on cp.cliente_id = ro.ds_customer_id and cp.ativo
--   where ro.ds_customer_id is not null and ro.filial_codigo is not null;
--
-- Prova de que a mensalidade NÃO foi mexida — rodar ANTES e DEPOIS:
--   select sum(mensalidade) from public.clientes where cancelado = false;
-- ---------------------------------------------------------------------------
