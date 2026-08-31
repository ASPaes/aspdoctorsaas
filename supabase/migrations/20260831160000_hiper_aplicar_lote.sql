-- Aplicar a correção no cadastro: parcial, em lote, e com trilha.
--
-- Parcial: cada ação é avaliada por si. Num contrato que não aceita o valor, a
-- recusa do dinheiro não derruba junto o tipo de contrato e a razão social.
--
-- Em lote: aceita várias linhas, com a reconciliação recalculada UMA vez no fim.
--
-- Com trilha: cada campo alterado vira uma linha em hiper_alteracao_log com o
-- valor ANTIGO. É ela que permite desfazer um erro de análise do operador.

drop function if exists public.hiper_aplicar_uma(uuid, uuid, text[]);
drop function if exists public.hiper_aplicar_uma(uuid, uuid, text[], uuid);

create or replace function public.hiper_aplicar_uma(
  p_tenant_id uuid,
  p_recon_id  uuid,
  p_acoes     text[],
  p_lote_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.reconciliacao_hiper%rowtype;
  v_forn    bigint;
  v_cp_id   uuid;
  v_cp_qtd  integer;
  v_recorr  text;
  v_modelo  bigint;
  v_antes   numeric;
  v_txt     text;
  v_mod     jsonb;
  v_ok      jsonb := '[]'::jsonb;
  v_nao     jsonb := '[]'::jsonb;
  v_motivo  text;
begin
  select * into r from public.reconciliacao_hiper
   where id = p_recon_id and tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('aplicado', '[]'::jsonb,
      'recusado', jsonb_build_array(jsonb_build_object('motivo', 'Divergência não encontrada.')));
  end if;

  if r.ds_cliente_id is null then
    return jsonb_build_object('aplicado', '[]'::jsonb,
      'recusado', jsonb_build_array(jsonb_build_object(
        'cliente', r.razao_social_hiper, 'motivo', 'Conta sem cliente vinculado aqui.')));
  end if;

  select fornecedor_id into v_forn from public.hiper_integration where tenant_id = p_tenant_id;

  select count(*), min(cp.id::text)::uuid, min(cp.recorrencia::text)
    into v_cp_qtd, v_cp_id, v_recorr
  from public.cliente_produtos cp
  where cp.cliente_id = r.ds_cliente_id and cp.fornecedor_id = v_forn and cp.ativo;

  -- ── tipo de contrato ──────────────────────────────────────────────────────
  if 'tipo_contrato' = any(p_acoes) then
    select modelo_contrato_id into v_modelo
    from public.hiper_catalogo_vinculo
    where tenant_id = p_tenant_id and tipo = 'contrato' and chave = r.responsavel_tipo;

    if v_modelo is null then
      v_nao := v_nao || jsonb_build_object('acao', 'tipo_contrato', 'cliente', r.razao_social_ds,
        'motivo', format('O tipo "%s" do portal não está mapeado na aba Módulos.', r.responsavel_tipo));
    elsif v_cp_qtd = 0 then
      v_nao := v_nao || jsonb_build_object('acao', 'tipo_contrato', 'cliente', r.razao_social_ds,
        'motivo', 'Sem contrato ativo com o fornecedor Hiper.');
    else
      -- O log vem ANTES do update: é agora que o valor antigo ainda existe.
      insert into public.hiper_alteracao_log
        (tenant_id, lote_id, recon_id, cliente_id, cliente_produto_id, codigo_sequencial,
         cliente_nome, acao, tabela, registro_id, campo, valor_antes, valor_depois, feito_por)
      select p_tenant_id, p_lote_id, p_recon_id, r.ds_cliente_id, cp.id, r.codigo_sequencial_ds,
             r.razao_social_ds, 'tipo_contrato', 'cliente_produtos', cp.id, 'modelo_contrato_id',
             to_jsonb(cp.modelo_contrato_id), to_jsonb(v_modelo), auth.uid()
      from public.cliente_produtos cp
      where cp.cliente_id = r.ds_cliente_id and cp.fornecedor_id = v_forn and cp.ativo
        and cp.modelo_contrato_id is distinct from v_modelo;

      update public.cliente_produtos
         set modelo_contrato_id = v_modelo, updated_at = now()
       where cliente_id = r.ds_cliente_id and fornecedor_id = v_forn and ativo
         and modelo_contrato_id is distinct from v_modelo;

      if found then
        v_ok := v_ok || jsonb_build_object('acao', 'tipo_contrato', 'cliente', r.razao_social_ds,
          'de', r.modelo_contrato_ds,
          'para', (select nome from public.modelos_contrato where id = v_modelo));
      end if;
    end if;
  end if;

  -- ── dinheiro ──────────────────────────────────────────────────────────────
  -- Mesmo motivo para custo e mensalidade, avaliado uma vez só.
  v_motivo := case
    when v_cp_qtd = 0 then 'Sem contrato ativo com o fornecedor Hiper.'
    when v_cp_qtd > 1 then 'Mais de um contrato Hiper ativo: o valor do portal é da conta inteira e não dá para saber em qual linha entra.'
  end;

  if 'custo' = any(p_acoes) then
    if v_motivo is not null then
      v_nao := v_nao || jsonb_build_object('acao', 'custo', 'cliente', r.razao_social_ds, 'motivo', v_motivo);
    elsif r.custo_hiper is null then
      v_nao := v_nao || jsonb_build_object('acao', 'custo', 'cliente', r.razao_social_ds,
        'motivo', 'O portal não tem custo apurado para esta conta.');
    else
      select vlr_custo into v_antes from public.cliente_produtos where id = v_cp_id;
      -- Só grava e só reporta quando MUDA: listar "51,09 -> 51,09" como aplicado
      -- faz o operador achar que corrigiu algo que já estava certo.
      if abs(coalesce(v_antes, 0) - r.custo_hiper) > 0.01 then
        insert into public.hiper_alteracao_log
          (tenant_id, lote_id, recon_id, cliente_id, cliente_produto_id, codigo_sequencial,
           cliente_nome, acao, tabela, registro_id, campo, valor_antes, valor_depois, feito_por)
        values (p_tenant_id, p_lote_id, p_recon_id, r.ds_cliente_id, v_cp_id, r.codigo_sequencial_ds,
                r.razao_social_ds, 'custo', 'cliente_produtos', v_cp_id, 'vlr_custo',
                to_jsonb(v_antes), to_jsonb(r.custo_hiper), auth.uid());

        update public.cliente_produtos set vlr_custo = r.custo_hiper, updated_at = now()
         where id = v_cp_id;

        v_ok := v_ok || jsonb_build_object('acao', 'custo', 'cliente', r.razao_social_ds,
          'de', v_antes, 'para', r.custo_hiper);
      end if;
    end if;
  end if;

  if 'mrr' = any(p_acoes) then
    if v_motivo is not null then
      v_nao := v_nao || jsonb_build_object('acao', 'mrr', 'cliente', r.razao_social_ds, 'motivo', v_motivo);
    elsif r.mrr_hiper is null then
      v_nao := v_nao || jsonb_build_object('acao', 'mrr', 'cliente', r.razao_social_ds,
        'motivo', 'No Hiperador o portal não conhece o preço — só você define a mensalidade.');
    else
      select vlr_mensal into v_antes from public.cliente_produtos where id = v_cp_id;
      if abs(coalesce(v_antes, 0) - r.mrr_hiper) > 0.01 then
        insert into public.hiper_alteracao_log
          (tenant_id, lote_id, recon_id, cliente_id, cliente_produto_id, codigo_sequencial,
           cliente_nome, acao, tabela, registro_id, campo, valor_antes, valor_depois, feito_por)
        values (p_tenant_id, p_lote_id, p_recon_id, r.ds_cliente_id, v_cp_id, r.codigo_sequencial_ds,
                r.razao_social_ds, 'mrr', 'cliente_produtos', v_cp_id, 'vlr_mensal',
                to_jsonb(v_antes), to_jsonb(r.mrr_hiper), auth.uid());

        update public.cliente_produtos set vlr_mensal = r.mrr_hiper, updated_at = now()
         where id = v_cp_id;

        v_ok := v_ok || jsonb_build_object('acao', 'mrr', 'cliente', r.razao_social_ds,
          'de', v_antes, 'para', r.mrr_hiper);
      end if;
    end if;
  end if;

  -- ── módulos ───────────────────────────────────────────────────────────────
  -- A mesma lógica do lote da aba Módulos, para um cliente só: insere o que
  -- falta (addon do portal e módulo que o plano implica) e acerta quantidade e
  -- custo do que já existe. Ela grava a própria trilha.
  if 'modulos' = any(p_acoes) then
    if v_cp_qtd = 0 then
      v_nao := v_nao || jsonb_build_object('acao', 'modulos', 'cliente', r.razao_social_ds,
        'motivo', 'Sem contrato ativo com o fornecedor Hiper.');
    else
      v_mod := public.hiper_importar_modulos(p_tenant_id, false, p_recon_id, p_lote_id);
      if coalesce((v_mod->>'inseridos')::integer, 0)
       + coalesce((v_mod->>'ajustados')::integer, 0) > 0 then
        v_ok := v_ok || jsonb_build_object('acao', 'modulos', 'cliente', r.razao_social_ds,
          'de', format('%s no contrato', coalesce((v_mod->>'ja_conferiam')::integer, 0)),
          'para', format('%s inseridos, %s ajustados',
                         coalesce((v_mod->>'inseridos')::integer, 0),
                         coalesce((v_mod->>'ajustados')::integer, 0)));
      elsif coalesce((v_mod->>'sem_produto_no_contrato')::integer, 0) > 0 then
        v_nao := v_nao || jsonb_build_object('acao', 'modulos', 'cliente', r.razao_social_ds,
          'motivo', 'O produto do módulo não está no contrato do cliente.');
      end if;
    end if;
  end if;

  -- ── razão social ──────────────────────────────────────────────────────────
  if 'razao_social' = any(p_acoes) then
    if coalesce(btrim(r.razao_social_hiper), '') = '' then
      v_nao := v_nao || jsonb_build_object('acao', 'razao_social', 'cliente', r.razao_social_ds,
        'motivo', 'O portal não tem razão social para esta conta.');
    else
      select razao_social into v_txt from public.clientes where id = r.ds_cliente_id;
      if v_txt is distinct from r.razao_social_hiper then
        insert into public.hiper_alteracao_log
          (tenant_id, lote_id, recon_id, cliente_id, cliente_produto_id, codigo_sequencial,
           cliente_nome, acao, tabela, registro_id, campo, valor_antes, valor_depois, feito_por)
        values (p_tenant_id, p_lote_id, p_recon_id, r.ds_cliente_id, v_cp_id, r.codigo_sequencial_ds,
                r.razao_social_ds, 'razao_social', 'clientes', r.ds_cliente_id, 'razao_social',
                to_jsonb(v_txt), to_jsonb(r.razao_social_hiper), auth.uid());

        update public.clientes set razao_social = r.razao_social_hiper, updated_at = now()
         where id = r.ds_cliente_id and tenant_id = p_tenant_id;

        v_ok := v_ok || jsonb_build_object('acao', 'razao_social', 'cliente', r.razao_social_ds,
          'de', v_txt, 'para', r.razao_social_hiper);
      end if;
    end if;
  end if;

  -- ── contrato ──────────────────────────────────────────────────────────────
  -- O contrato acompanha o produto. Sem isto a ficha abre com "os valores dos
  -- contratos divergem dos produtos" logo depois de a tela dizer que atualizou.
  -- Não derruba o lote: a guarda dela é por auth.uid(), então um chamador sem
  -- sessão faria 500 clientes falharem por causa do primeiro.
  if jsonb_array_length(v_ok) > 0 and v_cp_id is not null
     and (p_acoes && array['mrr', 'tipo_contrato', 'modulos']) then
    begin
      perform public.sync_cliente_produto_to_contract(v_cp_id);
    exception when others then
      v_nao := v_nao || jsonb_build_object('acao', 'contrato', 'cliente', r.razao_social_ds,
        'motivo', format('Valor atualizado, mas o contrato não sincronizou: %s', sqlerrm));
    end;
  end if;

  return jsonb_build_object('aplicado', v_ok, 'recusado', v_nao);
end;
$$;

revoke all on function public.hiper_aplicar_uma(uuid, uuid, text[], uuid) from public;
grant execute on function public.hiper_aplicar_uma(uuid, uuid, text[], uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Uma linha ou mil, num lote só.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hiper_aplicar_correcao(
  p_tenant_id uuid,
  p_recon_ids uuid[],
  p_acoes     text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id       uuid;
  v_r        jsonb;
  v_ok       jsonb := '[]'::jsonb;
  v_nao      jsonb := '[]'::jsonb;
  v_clientes integer := 0;
  v_lote     uuid := gen_random_uuid();
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  if p_recon_ids is null or array_length(p_recon_ids, 1) is null then
    return jsonb_build_object('ok', false, 'erro', 'Nenhuma divergência selecionada.');
  end if;
  if array_length(p_recon_ids, 1) > 500 then
    return jsonb_build_object('ok', false,
      'erro', 'Máximo de 500 clientes por vez. Use os filtros para dividir o lote.');
  end if;

  foreach v_id in array p_recon_ids loop
    v_r := public.hiper_aplicar_uma(p_tenant_id, v_id, p_acoes, v_lote);
    if jsonb_array_length(v_r->'aplicado') > 0 then v_clientes := v_clientes + 1; end if;
    v_ok  := v_ok  || (v_r->'aplicado');
    v_nao := v_nao || (v_r->'recusado');
  end loop;

  -- Uma vez só, no fim. Recalcular por cliente faria 500 varreduras da carteira.
  if jsonb_array_length(v_ok) > 0 then
    perform public.hiper_reconciliar(p_tenant_id);
  end if;

  return jsonb_build_object(
    'ok', true,
    'lote_id', case when jsonb_array_length(v_ok) > 0 then v_lote end,
    'clientes', v_clientes,
    'aplicado', v_ok,
    'recusado', v_nao,
    -- Agrupa os motivos: numa lista de 200, ver "180x recorrência anual" é o que
    -- informa, não 180 linhas iguais.
    'motivos', (
      select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'qt', qt)), '[]'::jsonb)
      from (select x->>'motivo' as motivo, count(*) as qt
            from jsonb_array_elements(v_nao) x group by 1 order by 2 desc) g
    )
  );
end;
$$;

revoke all on function public.hiper_aplicar_correcao(uuid, uuid[], text[]) from public;
grant execute on function public.hiper_aplicar_correcao(uuid, uuid[], text[]) to authenticated, service_role;
