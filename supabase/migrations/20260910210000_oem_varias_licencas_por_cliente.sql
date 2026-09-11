-- ============================================================================
-- Um cliente passa a poder carregar mais de uma licença do OEM.
--
-- O QUE BLOQUEAVA, E POR QUE NÃO ERA UMA RESTRIÇÃO DE MODELO.
--
-- `oem_gravar_codigos_no_produto` recusava quando o cliente tinha mais de uma
-- linha de produto ativa (`v_qtd > 1 -> return -1`) e, com uma só, gravava por
-- cima do que estivesse lá. As duas coisas juntas faziam com que um cliente
-- nunca tivesse duas licenças: vincular a segunda roubava o código da primeira,
-- e criar uma segunda linha de produto para a segunda loja piorava, porque aí
-- nenhuma das duas gravava.
--
-- Só que o modelo de dinheiro JÁ suporta N. `fn_sync_cliente_mensalidade` soma
-- as linhas ativas em dois campos separados:
--     clientes.mensalidade    = SUM(vlr_mensal)
--     clientes.custo_operacao = SUM(vlr_custo)
-- Uma segunda linha com `vlr_mensal = 0` e `vlr_custo` = o custo da segunda
-- licença deixa a mensalidade intacta e leva o custo para o lugar certo. Era a
-- guarda da função, não o modelo, que impedia.
--
-- COMO ELA ESCOLHE A LINHA AGORA.
--
-- Escolher "a linha livre" seria errado: dos 57 clientes com dois produtos
-- ativos, os pares são "PDV Legal + TEF" e "Xpert + TEF", ou seja, produtos
-- diferentes de fornecedores diferentes. Gravar o código do OEM na linha do TEF
-- é exatamente a divergência "Código da licença gravado num produto de outro
-- fornecedor" que a aba já aponta.
--
-- O de/para de produtos resolve: `oem_produto_vinculo` diz quais `produto_id`
-- são do OEM. Conferido em 10/09/2026: das 893 linhas que hoje têm código,
-- 893 são produto do OEM. Zero exceção, então o filtro não muda nada para quem
-- já funciona.
--
-- Tenant que ainda não ligou os produtos não tem linha nenhuma nessa tabela, e
-- aí o filtro deixaria a integração inteira sem gravar. Nesse caso, e só nele,
-- ela volta a considerar qualquer linha livre.
--
-- CÓDIGOS DE RETORNO (o -2 e o -3 são novos):
--    1  gravado, ou já estava gravado nesta ficha
--    0  o cliente não tem nenhuma linha de produto ativa
--   -1  mais de uma linha livre: não dá para saber em qual gravar
--   -2  todas as linhas de produto do OEM já estão com outra licença
--   -3  o cliente não tem linha de produto do OEM
--
-- O -2 é o caso das lojas, e é a diferença que interessa: antes ele passava
-- como sucesso, sobrescrevendo a licença da loja anterior em silêncio.
-- ============================================================================

create or replace function public.oem_gravar_codigos_no_produto(
  p_cliente_id uuid,
  p_grupo      text,
  p_filial     text
)
returns integer
language plpgsql security definer set search_path = public
as $fn$
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
     and (not v_tem_depara or exists (
           select 1 from public.oem_produto_vinculo v
            where v.tenant_id = cp.tenant_id and v.produto_id = cp.produto_id));
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
    if v_tem_depara and not v_tem_do_oem then return -3; end if;
    return -2;
  end if;
  if v_livres > 1 then return -1; end if;

  perform set_config('doctorsaas.skip_valor_sync', 'true', true);
  update public.cliente_produtos
     set oem_codigo_grupo = p_grupo, oem_codigo_filial = p_filial
   where id = v_ids[1];
  perform set_config('doctorsaas.skip_valor_sync', 'false', true);
  return 1;
end $fn$;

comment on function public.oem_gravar_codigos_no_produto(uuid, text, text) is
  'Grava empresa+filial do OEM na linha de produto LIVRE do cliente (produto do OEM quando o de/para existe). Nunca sobrescreve licenca de outra loja. 1=gravado, 0=sem produto ativo, -1=ambiguo, -2=nenhuma linha livre, -3=nenhum produto do OEM.';

-- ------------------------------------- os motivos novos chegam a quem decide
-- Cópia fiel da versão em produção (lida em 10/09/2026). A única mudança é o
-- `case` da observação, que ganhou o -2 e o -3.
create or replace function public.vincular_filial_oem(
  p_recon_id   uuid,
  p_cliente_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $fn$
declare v_tenant uuid; v_cli record; v_rec record; v_res int;
        v_dono_antes uuid; v_nome_antes text;
begin
  select tenant_id, empresa_codigo, filial_codigo, conta_integration_id, ds_customer_id
    into v_rec
    from public.reconciliacao_oem where id = p_recon_id;
  if v_rec is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  v_tenant := v_rec.tenant_id;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  select id, coalesce(nome_fantasia, razao_social) as nome, mensalidade, cancelado
    into v_cli
    from public.clientes
   where id = p_cliente_id and tenant_id = v_tenant;
  if not found then raise exception 'Cliente não pertence a esta empresa.'; end if;

  v_dono_antes := v_rec.ds_customer_id;
  if v_dono_antes is not null then
    select coalesce(nullif(btrim(nome_fantasia), ''), razao_social)
      into v_nome_antes from public.clientes where id = v_dono_antes;
  end if;

  -- Se esta licença estava em outro cliente, o código sai de lá antes de entrar
  -- aqui: senão dois cadastros diriam ser a mesma filial.
  --
  -- POR FILIAL, e não o cliente inteiro. O dono antigo pode ter outras lojas no
  -- OEM: limpar tudo tirava da ficha dele o vínculo de licenças que continuam
  -- sendo dele, trocando uma divergência por outra.
  if v_dono_antes is not null and v_dono_antes <> p_cliente_id then
    perform public.oem_limpar_codigo_da_filial(v_dono_antes, v_rec.filial_codigo);
  end if;

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
                                 when -1 then 'Cliente tem mais de uma linha de produto livre — código do OEM não foi gravado em nenhuma.'
                                 when -2 then 'As linhas de produto deste cliente já estão com outras licenças. Para esta loja entrar na ficha, ela precisa de uma linha de produto própria, com mensalidade zero e o custo da licença, ou de cadastro de cliente separado.'
                                 when -3 then 'O cliente não tem linha de produto do OEM na ficha — código do OEM não foi gravado.'
                                 when  0 then 'Cliente não tem produto ativo — código do OEM não foi gravado.'
                                 else null end,
         resolvido_em        = now(),
         resolvido_por       = auth.uid()
   where id = p_recon_id;

  -- O cliente acabou de ganhar licença: a linha que dizia "só no DS" virou
  -- mentira. Some agora em vez de esperar a próxima carga. Só sai a linha SEM
  -- filial: as com filial são licenças e nenhuma delas é retrato descartável.
  if v_rec.filial_codigo is not null then
    delete from public.reconciliacao_oem
     where tenant_id            = v_tenant
       and conta_integration_id = v_rec.conta_integration_id
       and ds_customer_id       = p_cliente_id
       and filial_codigo is null;
  end if;

  perform public.fn_oem_log_alteracao(
    p_tenant_id            => v_tenant,
    p_lote_id              => gen_random_uuid(),
    p_acao                 => 'vinculo',
    p_cliente_id           => p_cliente_id,
    p_tabela               => 'reconciliacao_oem',
    p_registro_id          => p_recon_id,
    p_campo                => 'ds_customer_id',
    p_valor_antes          => jsonb_build_object('cliente_id', v_dono_antes, 'cliente_nome', v_nome_antes),
    p_valor_depois         => jsonb_build_object('cliente_id', p_cliente_id, 'cliente_nome', v_cli.nome),
    p_recon_id             => p_recon_id,
    p_filial_codigo        => v_rec.filial_codigo,
    p_conta_integration_id => v_rec.conta_integration_id);
end $fn$;
