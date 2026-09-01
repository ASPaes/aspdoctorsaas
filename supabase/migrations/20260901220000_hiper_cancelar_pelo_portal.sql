-- Cancelar aqui o que já saiu no Hiper, com a data real da saída.
--
-- São 19 clientes ativos no DoctorSaaS e inativos no portal, somando
-- R$ 4.665,97 de MRR contado como receita viva — alguns desde dezembro. O
-- portal tem a data em 17 deles.
--
-- Decisão do dono (31/08/2026): o churn entra no MÊS EM QUE O CLIENTE SAIU, não
-- no de hoje. O MRR de cada mês passa a contar certo e a ponte fecha; em troca,
-- o histórico dos meses afetados muda. Foi escolhido com esse efeito à vista.
create or replace function public.hiper_cancelar_pelo_portal(
  p_tenant_id  uuid,
  p_recon_id   uuid,
  p_motivo_id  bigint,
  p_observacao text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.reconciliacao_hiper%rowtype;
  v_forn   bigint;
  v_produtos bigint[];
  v_cp     record;
  v_lote   uuid := gen_random_uuid();
  v_feitos jsonb := '[]'::jsonb;
  v_data   date;
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
    return jsonb_build_object('ok', false, 'erro', 'Conta sem cliente vinculado aqui.');
  end if;

  -- Só cancela o que o portal diz que saiu. Sem esta guarda, um clique errado
  -- na tela cancelaria cliente vivo.
  if coalesce(r.situacao_hiper, '') not in ('inativo') then
    return jsonb_build_object('ok', false,
      'erro', format('A conta está "%s" no Hiper. Só quem saiu de lá pode ser cancelado por aqui.', r.situacao_hiper));
  end if;
  if r.cancelada_em is null then
    return jsonb_build_object('ok', false,
      'erro', 'O portal não informou a data de saída desta conta. Cancele pela ficha do cliente, escolhendo a data.');
  end if;
  if p_motivo_id is null then
    return jsonb_build_object('ok', false, 'erro', 'Escolha o motivo do cancelamento.');
  end if;

  v_data := r.cancelada_em;
  select fornecedor_id into v_forn from public.hiper_integration where tenant_id = p_tenant_id;
  select coalesce(array_agg(distinct produto_id) filter (where produto_id is not null), '{}')
    into v_produtos
  from public.hiper_catalogo_vinculo where tenant_id = p_tenant_id and tipo = 'plano';

  for v_cp in
    select cp.id, cp.vlr_mensal, cp.vlr_custo, pr.nome as produto
    from public.cliente_produtos cp
    join public.produtos pr on pr.id = cp.produto_id
    where cp.cliente_id = r.ds_cliente_id and cp.ativo
      and (cp.fornecedor_id = v_forn or cp.produto_id = any(v_produtos))
  loop
    -- A trilha vem ANTES: depois do cancelamento o valor antigo não existe mais.
    insert into public.hiper_alteracao_log
      (tenant_id, lote_id, recon_id, cliente_id, cliente_produto_id, codigo_sequencial,
       cliente_nome, acao, tabela, registro_id, campo, valor_antes, valor_depois, feito_por)
    values (p_tenant_id, v_lote, p_recon_id, r.ds_cliente_id, v_cp.id, r.codigo_sequencial_ds,
            r.razao_social_ds, 'cancelamento', 'cliente_produtos', v_cp.id, v_cp.produto,
            jsonb_build_object('ativo', true, 'vlr_mensal', v_cp.vlr_mensal, 'vlr_custo', v_cp.vlr_custo),
            jsonb_build_object('ativo', false, 'data_cancelamento', v_data), auth.uid());

    perform public.cancel_cliente_produto(
      v_cp.id, p_motivo_id,
      coalesce(nullif(btrim(coalesce(p_observacao, '')), ''),
               format('Inativo no Hiper desde %s (%s)', to_char(v_data, 'DD/MM/YYYY'),
                      coalesce(r.cancelada_por, 'portal'))),
      v_data);

    v_feitos := v_feitos || jsonb_build_object('produto', v_cp.produto, 'mrr', v_cp.vlr_mensal);
  end loop;

  if jsonb_array_length(v_feitos) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'O cliente não tem contrato ativo com o fornecedor Hiper.');
  end if;

  perform public.hiper_reconciliar(p_tenant_id);

  return jsonb_build_object('ok', true, 'lote_id', v_lote, 'data', v_data, 'cancelados', v_feitos);
end;
$$;

revoke all on function public.hiper_cancelar_pelo_portal(uuid, uuid, bigint, text) from public;
grant execute on function public.hiper_cancelar_pelo_portal(uuid, uuid, bigint, text) to authenticated, service_role;
