-- ============================================================================
-- Tirar UMA filial do cliente não pode apagar o código das IRMÃS.
--
-- `oem_gravar_codigos_no_produto(cliente, null, null)` limpa TODAS as linhas de
-- produto do cliente. Isso funciona enquanto o cliente tem uma licença só, que
-- é o caso de quase todos. Não funciona para quem tem duas ou três lojas no
-- OEM: mover a filial 13988 para outro cadastro apagava junto o código da
-- 18743, que continua sendo daquele cliente, e criava uma divergência nova no
-- lugar da que acabou de ser resolvida.
--
-- Medido em 10/09/2026, na conta da Digi Office: 5 clientes com 2 ou 3 filiais
-- no OEM e UMA linha de produto na ficha (ALENTO SORVETES, PAROQUIA N. S. DO
-- CARMO, RESERVA BAMBU, DORIAN CACAO VENEZUELA, BERNINI SORVETES). São 6
-- licenças, R$ 522,90/mês de custo, que não entram na margem de ficha nenhuma
-- porque cada produto guarda um código só. Todas as 6 já tinham sido decididas
-- à mão, algumas mais de uma vez: vincular a órfã roubava o código da irmã e o
-- alerta voltava na outra filial. É o "passa de mão em mão e nada resolve".
--
-- A limpeza passa a ser POR FILIAL. Quem chama sabe qual licença está saindo;
-- é essa linha de produto que perde o código, e só ela.
--
-- Fora do alcance desta migration, de propósito: `oem_remover_codigo_filial`
-- recebe só o cliente e não tem como saber de qual filial se trata, e a
-- sobrescrita silenciosa (vincular uma segunda filial ao mesmo cliente troca o
-- código do produto sem avisar) é decisão de produto, não conserto de bug.
-- ============================================================================

create or replace function public.oem_limpar_codigo_da_filial(
  p_cliente_id uuid,
  p_filial     text
)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_qtd int;
begin
  -- Linha de conciliação sem filial nunca gravou código nenhum. Sem esta
  -- saída, desvincular uma delas caía no `where oem_codigo_filial = null`, que
  -- não casa com nada, mas a intenção fica explícita aqui.
  if p_cliente_id is null or nullif(btrim(p_filial), '') is null then
    return 0;
  end if;

  -- O mesmo guarda-chuva da função irmã: escrever em `cliente_produtos` acorda
  -- os gatilhos que recalculam valor e mandam contrato para o Omie, e tirar um
  -- código do OEM não é mudança de preço.
  perform set_config('doctorsaas.skip_valor_sync', 'true', true);
  update public.cliente_produtos
     set oem_codigo_grupo = null, oem_codigo_filial = null
   where cliente_id = p_cliente_id
     and oem_codigo_filial = p_filial;
  -- Imediatamente depois do UPDATE: qualquer comando no meio zera o row_count.
  get diagnostics v_qtd = row_count;
  perform set_config('doctorsaas.skip_valor_sync', 'false', true);

  return v_qtd;
end $$;

comment on function public.oem_limpar_codigo_da_filial(uuid, text) is
  'Tira o codigo do OEM da linha de produto que guarda ESTA filial. As outras licencas do mesmo cliente nao sao tocadas.';

revoke all on function public.oem_limpar_codigo_da_filial(uuid, text)
  from public, anon, authenticated;
grant execute on function public.oem_limpar_codigo_da_filial(uuid, text) to service_role;

-- ------------------------------------- mover a licença não derruba as irmãs
-- Cópia fiel da versão em produção (lida em 10/09/2026). A única mudança é o
-- bloco que limpa o cliente antigo.
create or replace function public.vincular_filial_oem(
  p_recon_id   uuid,
  p_cliente_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
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
                                 when -1 then 'Cliente tem mais de um produto ativo — código do OEM não foi gravado em nenhum.'
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
end $$;

-- ------------------------------------ desfazer uma não desfaz as outras
-- Cópia fiel da versão em produção (lida em 10/09/2026). A única mudança é o
-- bloco que limpa o código.
create or replace function public.desvincular_filial_oem(p_recon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid; v_cliente uuid; v_rec record;
begin
  select tenant_id, ds_customer_id, filial_codigo, conta_integration_id
    into v_rec
    from public.reconciliacao_oem where id = p_recon_id;
  v_tenant := v_rec.tenant_id;
  v_cliente := v_rec.ds_customer_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  -- Só o código DESTA filial. Cliente com duas lojas no OEM perdia o vínculo
  -- das duas quando alguém desfazia o de uma — e a linha sem filial (o
  -- "cliente sem licença") chegava a limpar o código de uma licença real.
  if v_cliente is not null then
    perform public.oem_limpar_codigo_da_filial(v_cliente, v_rec.filial_codigo);
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

  -- Sem cliente antes não houve desvínculo nenhum: a linha já estava solta.
  -- Registrar seria encher a trilha de nada.
  if v_cliente is not null then
    perform public.fn_oem_log_alteracao(
      p_tenant_id            => v_tenant,
      p_lote_id              => gen_random_uuid(),
      p_acao                 => 'desvinculo',
      p_cliente_id           => v_cliente,
      p_tabela               => 'reconciliacao_oem',
      p_registro_id          => p_recon_id,
      p_campo                => 'ds_customer_id',
      p_valor_antes          => jsonb_build_object('cliente_id', v_cliente),
      p_valor_depois         => NULL,
      p_recon_id             => p_recon_id,
      p_filial_codigo        => v_rec.filial_codigo,
      p_conta_integration_id => v_rec.conta_integration_id);
  end if;
end $$;
