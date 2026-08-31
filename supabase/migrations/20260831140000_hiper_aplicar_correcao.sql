-- Aplica no cadastro do DoctorSaaS o que o portal diz, para UM cliente e só as
-- famílias escolhidas na tela. Nunca em lote: cada linha é uma decisão.
--
-- O que cada ação dispara, medido nos gatilhos:
--   tipo_contrato → só modelo_contrato_id. Nenhum efeito colateral.
--   custo         → vlr_custo; fn_sync_cliente_mensalidade atualiza
--                   clientes.custo_operacao. NÃO enfileira Omie.
--   razao_social  → clientes.razao_social; enfileira sync de cadastro no Omie.
--   mrr           → vlr_mensal; atualiza clientes.mensalidade e enfileira o
--                   Omie (que fatura o cliente). NÃO cria movimento_mrr, então
--                   a base muda sem um movimento explicando — decisão do dono
--                   em 31/08/2026, tomada com esse efeito à vista.
create or replace function public.hiper_aplicar_correcao(
  p_tenant_id uuid,
  p_recon_id  uuid,
  p_acoes     text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r            public.reconciliacao_hiper%rowtype;
  v_forn       bigint;
  v_cp_id      uuid;
  v_cp_qtd     integer;
  v_recorr     text;
  v_modelo     bigint;
  v_feito      jsonb := '[]'::jsonb;
  v_antes      numeric;
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  select * into r from public.reconciliacao_hiper
   where id = p_recon_id and tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('ok', false, 'erro', 'Divergência não encontrada.');
  end if;
  if r.ds_cliente_id is null then
    return jsonb_build_object('ok', false, 'erro', 'Esta conta ainda não tem cliente vinculado aqui.');
  end if;

  select fornecedor_id into v_forn from public.hiper_integration where tenant_id = p_tenant_id;

  -- Qual linha de contrato recebe o valor. Com mais de uma, o número do portal
  -- é da CONTA inteira e não há como saber em qual delas ele cai — melhor não
  -- gravar do que rachar por conta própria.
  select count(*), min(cp.id::text)::uuid, min(cp.recorrencia::text)
    into v_cp_qtd, v_cp_id, v_recorr
  from public.cliente_produtos cp
  where cp.cliente_id = r.ds_cliente_id and cp.fornecedor_id = v_forn and cp.ativo;

  if v_cp_qtd = 0 then
    return jsonb_build_object('ok', false, 'erro', 'O cliente não tem contrato ativo com o fornecedor Hiper.');
  end if;

  -- ── tipo de contrato ──────────────────────────────────────────────────────
  if 'tipo_contrato' = any(p_acoes) then
    select modelo_contrato_id into v_modelo
    from public.hiper_catalogo_vinculo
    where tenant_id = p_tenant_id and tipo = 'contrato' and chave = r.responsavel_tipo;

    if v_modelo is null then
      return jsonb_build_object('ok', false,
        'erro', format('O tipo "%s" do portal não está mapeado na aba Módulos.', r.responsavel_tipo));
    end if;

    update public.cliente_produtos
       set modelo_contrato_id = v_modelo, updated_at = now()
     where cliente_id = r.ds_cliente_id and fornecedor_id = v_forn and ativo
       and modelo_contrato_id is distinct from v_modelo;

    v_feito := v_feito || jsonb_build_object('acao', 'tipo_contrato',
      'de', r.modelo_contrato_ds, 'para', (select nome from public.modelos_contrato where id = v_modelo));
  end if;

  -- ── dinheiro: custo e MRR ─────────────────────────────────────────────────
  if ('custo' = any(p_acoes) or 'mrr' = any(p_acoes)) then
    if v_cp_qtd > 1 then
      return jsonb_build_object('ok', false,
        'erro', 'O cliente tem mais de um contrato ativo com a Hiper. O valor do portal é da conta inteira e não dá para saber em qual contrato ele entra — ajuste na ficha do cliente.');
    end if;
    -- O portal informa valor MENSAL. Num contrato anual o campo daqui guarda o
    -- valor do período, e gravar o do portal deixaria a mensalidade 12x menor.
    if coalesce(v_recorr, 'mensal') <> 'mensal' then
      return jsonb_build_object('ok', false,
        'erro', format('Contrato com recorrência "%s". O portal informa valor mensal e gravá-lo aqui distorceria o valor do período — ajuste na ficha do cliente.', v_recorr));
    end if;
  end if;

  if 'custo' = any(p_acoes) and r.custo_hiper is not null then
    select vlr_custo into v_antes from public.cliente_produtos where id = v_cp_id;
    update public.cliente_produtos
       set vlr_custo = r.custo_hiper, updated_at = now()
     where id = v_cp_id;
    v_feito := v_feito || jsonb_build_object('acao', 'custo', 'de', v_antes, 'para', r.custo_hiper);
  end if;

  if 'mrr' = any(p_acoes) and r.mrr_hiper is not null then
    select vlr_mensal into v_antes from public.cliente_produtos where id = v_cp_id;
    update public.cliente_produtos
       set vlr_mensal = r.mrr_hiper, updated_at = now()
     where id = v_cp_id;
    v_feito := v_feito || jsonb_build_object('acao', 'mrr', 'de', v_antes, 'para', r.mrr_hiper);
  end if;

  -- ── razão social ──────────────────────────────────────────────────────────
  if 'razao_social' = any(p_acoes) and coalesce(btrim(r.razao_social_hiper), '') <> '' then
    update public.clientes
       set razao_social = r.razao_social_hiper, updated_at = now()
     where id = r.ds_cliente_id and tenant_id = p_tenant_id;
    v_feito := v_feito || jsonb_build_object('acao', 'razao_social',
      'de', r.razao_social_ds, 'para', r.razao_social_hiper);
  end if;

  if jsonb_array_length(v_feito) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'Nada a aplicar nesta divergência.');
  end if;

  -- Recalcula para a linha refletir o cadastro novo na hora. Sem isso o
  -- operador clica, nada muda na tela, e ele clica de novo.
  perform public.hiper_reconciliar(p_tenant_id);

  return jsonb_build_object('ok', true, 'aplicado', v_feito);
end;
$$;

revoke all on function public.hiper_aplicar_correcao(uuid, uuid, text[]) from public;
grant execute on function public.hiper_aplicar_correcao(uuid, uuid, text[]) to authenticated, service_role;
