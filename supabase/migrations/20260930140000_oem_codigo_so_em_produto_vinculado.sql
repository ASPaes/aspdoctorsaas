-- ============================================================================
-- Código de licença do OEM só em produto VINCULADO ao OEM.
--
-- 30/09/2026: a primeira atualização do espelho da Delvale, com a conta ainda
-- sem nenhum vínculo de produto, casou 9 clientes pelo CNPJ e gravou o código
-- da licença no único produto deles — W. Desk, W. Web e Rhid. Em seguida
-- fn_oem_espelhar_modulos_no_contrato copiou os módulos da licença para essas
-- fichas, criou 17 módulos falsos no catálogo e o gatilho de valores
-- reescreveu o custo das 9 linhas (valor digitado à mão, perdido).
--
-- Três travas, da mais específica à que não deixa passar nada:
--   1. oem_gravar_codigos_em_lote: o produto único do cliente tem que ser do OEM.
--   2. oem_gravar_codigos_no_produto: vínculo exigido sempre (antes, tenant sem
--      vínculo nenhum aceitava qualquer produto).
--   3. Gatilho em cliente_produtos: o banco recusa código de licença em produto
--      não vinculado, venha de onde vier (espelho, ficha, fila, SQL).
--
-- Conferido em produção antes de escrever: 0 linhas violam a regra hoje, então
-- o gatilho entra sem quebrar nada existente.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.oem_gravar_codigos_em_lote(p_conta uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int := 0; r record;
begin
  -- Sem isto, cada UPDATE dispara trg_sync_cliente_mensalidade e recalcula o
  -- faturamento do cliente. Centenas de vezes, a cada carga.
  perform set_config('doctorsaas.skip_valor_sync', 'true', true);

  for r in
    select ro.ds_customer_id, ro.empresa_codigo, ro.filial_codigo
      from public.reconciliacao_oem ro
     where ro.conta_integration_id = p_conta
       and ro.ds_customer_id is not null
       and ro.filial_codigo  is not null
       and ro.ds_customer_id in (
             select ds_customer_id
               from public.reconciliacao_oem
              where conta_integration_id = p_conta
                and ds_customer_id is not null
                and filial_codigo  is not null
              group by 1 having count(distinct filial_codigo) = 1)
       and (select count(*) from public.cliente_produtos cp
             where cp.cliente_id = ro.ds_customer_id and cp.ativo) = 1
       -- 30/09/2026: e esse produto único tem que ser do OEM. Sem isto, com a
       -- conta ainda sem vínculo de produto, o código ia para o W. Desk ou o
       -- Rhid de quem casou pelo CNPJ (9 fichas da Delvale, módulos copiados).
       and exists (
             select 1 from public.cliente_produtos cp
               join public.oem_produto_vinculo v
                 on v.tenant_id = cp.tenant_id and v.produto_id = cp.produto_id
              where cp.cliente_id = ro.ds_customer_id and cp.ativo)
  loop
    update public.cliente_produtos cp
       set oem_codigo_grupo  = r.empresa_codigo,
           oem_codigo_filial = r.filial_codigo
     where cp.cliente_id = r.ds_customer_id
       and cp.ativo
       and cp.oem_codigo_filial is distinct from r.filial_codigo;
    if found then v_n := v_n + 1; end if;
  end loop;

  perform set_config('doctorsaas.skip_valor_sync', 'false', true);
  return v_n;
end $function$
;

CREATE OR REPLACE FUNCTION public.oem_gravar_codigos_no_produto(p_cliente_id uuid, p_grupo text, p_filial text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant     uuid;
  v_ativos     int;
  v_tem_depara boolean;
  v_tem_do_oem boolean;
  v_livres     int;
  -- Array, e não `min(id)`: não existe `min(uuid)` no Postgres, e juntar as
  -- candidatas numa lista deixa a contagem e a escolha saírem da mesma
  -- varredura — duas queries com o mesmo predicado divergem na primeira
  -- edição que só lembrar de uma delas.
  v_ids        uuid[];
begin
  -- Limpar (p_filial nulo) continua valendo para TODAS as linhas do cliente:
  -- é o que `oem_remover_codigo_filial` usa, e ela não sabe de qual filial se
  -- trata. Quem tem a filial em mãos usa `oem_limpar_codigo_da_filial`.
  if p_filial is null then
    perform set_config('doctorsaas.skip_valor_sync', 'true', true);
    update public.cliente_produtos
       set oem_codigo_grupo = null, oem_codigo_filial = null
     where cliente_id = p_cliente_id
       and (oem_codigo_grupo is not null or oem_codigo_filial is not null);
    perform set_config('doctorsaas.skip_valor_sync', 'false', true);
    return 1;
  end if;

  -- Idempotência antes de qualquer contagem: esta licença já está nesta ficha,
  -- não há o que decidir. Sem isto, revincular a mesma filial ao mesmo cliente
  -- (que é como se regrava um código perdido) cairia em "nenhuma linha livre".
  -- Vale para linha inativa também: produto cancelado não desfaz o vínculo.
  if exists (
    select 1 from public.cliente_produtos
     where cliente_id = p_cliente_id and oem_codigo_filial = p_filial
  ) then
    return 1;
  end if;

  select count(*) into v_ativos
    from public.cliente_produtos
   where cliente_id = p_cliente_id and ativo = true;
  if v_ativos = 0 then return 0; end if;

  select tenant_id into v_tenant from public.clientes where id = p_cliente_id;
  select exists (select 1 from public.oem_produto_vinculo where tenant_id = v_tenant)
    into v_tem_depara;

  -- As candidatas: ativas, SEM código, e do OEM quando o de/para existe.
  --
  -- "sem código" é o que substitui a sobrescrita. Uma linha que já carrega uma
  -- licença é a loja de outra filial, e passar por cima dela era o bug que
  -- fazia o alerta pular de uma filial para a irmã sem nunca ser resolvido.
  select array_agg(cp.id) into v_ids
    from public.cliente_produtos cp
   where cp.cliente_id = p_cliente_id
     and cp.ativo = true
     and cp.oem_codigo_filial is null
     -- 30/09/2026: o vínculo é exigido SEMPRE. Antes, tenant sem vínculo
     -- nenhum aceitava qualquer produto, e a licença ia parar no W. Desk.
     and exists (
           select 1 from public.oem_produto_vinculo v
            where v.tenant_id = cp.tenant_id and v.produto_id = cp.produto_id);
  v_livres := coalesce(array_length(v_ids, 1), 0);

  if v_livres = 0 then
    -- Separar os dois zeros: "todas as linhas do OEM já têm licença" pede uma
    -- linha nova para esta loja; "não tem linha do OEM" pede o produto certo na
    -- ficha. São conversas diferentes com quem vai resolver.
    select exists (
      select 1 from public.cliente_produtos cp
       where cp.cliente_id = p_cliente_id and cp.ativo = true
         and exists (select 1 from public.oem_produto_vinculo v
                      where v.tenant_id = cp.tenant_id and v.produto_id = cp.produto_id)
    ) into v_tem_do_oem;
    if not v_tem_do_oem then return -3; end if;
    return -2;
  end if;
  if v_livres > 1 then return -1; end if;

  perform set_config('doctorsaas.skip_valor_sync', 'true', true);
  update public.cliente_produtos
     set oem_codigo_grupo = p_grupo, oem_codigo_filial = p_filial
   where id = v_ids[1];
  perform set_config('doctorsaas.skip_valor_sync', 'false', true);
  return 1;
end $function$
;

CREATE OR REPLACE FUNCTION public.trg_oem_codigo_so_em_produto_vinculado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- SECURITY DEFINER: a trava lê oem_produto_vinculo e produtos. Rodando como o
-- usuário logado, um RLS que esconda o vínculo recusaria gravação legítima.
declare
  v_produto text;
begin
  if new.oem_codigo_filial is null then
    return new;
  end if;
  -- Só confere quando o código ou o produto mudou: linha antiga intocada
  -- não deve travar uma edição de mensalidade, por exemplo.
  if tg_op = 'UPDATE'
     and new.oem_codigo_filial is not distinct from old.oem_codigo_filial
     and new.produto_id is not distinct from old.produto_id then
    return new;
  end if;

  if exists (
    select 1 from public.oem_produto_vinculo v
     where v.tenant_id = new.tenant_id and v.produto_id = new.produto_id
  ) then
    return new;
  end if;

  select nome into v_produto from public.produtos where id = new.produto_id;
  raise exception 'O produto "%" não está vinculado ao OEM, então não pode receber a licença %. Vincule o produto em Configurações › Integrações › OEM › Módulos, ou grave a licença no produto do parceiro.',
    coalesce(v_produto, new.produto_id::text), new.oem_codigo_filial
    using errcode = '23514';
end;
$function$;

REVOKE ALL ON FUNCTION public.trg_oem_codigo_so_em_produto_vinculado() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_oem_codigo_so_em_produto_vinculado ON public.cliente_produtos;
CREATE TRIGGER trg_oem_codigo_so_em_produto_vinculado
  BEFORE INSERT OR UPDATE OF oem_codigo_filial, produto_id ON public.cliente_produtos
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_oem_codigo_so_em_produto_vinculado();
