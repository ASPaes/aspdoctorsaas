-- =============================================================================
-- Troca de licença do OEM: módulo VENDIDO vai junto para a licença nova
-- =============================================================================
-- Caso real (HEILIGE BREW PUB, 30/09/2026): o up-sell de Servidor Legal pela
-- calculadora foi aprovado e gravado na licença que estava na ficha (40256).
-- Nove minutos depois, a licença foi trocada para a certa (40520). O vínculo
-- espelha a licença nova, que não tinha o módulo, e o espelho DESATIVOU a linha
-- da ficha. Resultado: o cliente pagando (o upsell continuava no MRR), a ficha
-- dizendo "cancelado" e o módulo ligado na licença errada.
--
-- A trava de fila viva não pega isso: o pedido já estava `ok`.
--
-- O que muda: a troca fotografa, antes de soltar/vincular, os módulos ativos que
-- o cliente PAGA (valor na linha, ou upsell/cross-sell vigente amarrado a ela).
-- Os que o espelho da licença nova desativar voltam a ficar ativos e ganham um
-- pedido `ativar` na fila, para a licença nova, aguardando aprovação como
-- qualquer outro. Módulo sem valor e sem venda continua seguindo a licença nova:
-- esses vieram da licença antiga e é ela que estava errada.
--
-- O pedido vai com `vlr_mensal = 0` e `vlr_ativacao = 0`: a venda já está no
-- MRR. Na aprovação, `fn_oem_fila_aplicar` acha a linha ativa (não cria outra) e
-- sem valor não lança upsell.
--
-- Insert direto na fila, e não `fn_oem_enfileirar`: aquela exige admin/head, e a
-- troca é permitida a quem pode Bloquear/Desativar. Quem aprova o pedido
-- continua sendo admin/head, na aba Fila.
--
-- A licença antiga continua com o módulo ligado no parceiro: sem cliente na
-- ficha, não há linha pela qual enfileirar o cancelamento. O retorno lista os
-- módulos para a tela avisar que é preciso desligar no portal.
-- =============================================================================

begin;

create or replace function public.trocar_filial_oem(
  p_cliente_id    uuid,
  p_recon_nova    uuid,
  p_recon_antiga  uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_nova    record;
  v_antiga  record;
  v_cli     record;
  v_vivos   int;
  v_obs     text;
  -- Texto, e não campo do record: record nunca atribuído quebra ao ser lido.
  v_filial_antiga text;
  v_vendidos  uuid[];
  v_l         record;
  v_conta     uuid;
  v_fila      uuid;
  v_reenviados jsonb := '[]'::jsonb;
begin
  select id, tenant_id, filial_codigo, ds_customer_id, razao_ds
    into v_nova
    from public.reconciliacao_oem where id = p_recon_nova;
  if v_nova.id is null then
    raise exception 'Licença não encontrada. Recarregue a tela.';
  end if;
  if nullif(btrim(v_nova.filial_codigo), '') is null then
    raise exception 'Esta linha não é uma licença do OEM (não tem filial).';
  end if;

  -- A mesma permissão de Bloquear/Desativar. `coalesce` por FORA: NULL no
  -- portão libera (ver auditoria is_super_admin).
  if not coalesce(public.pode_mexer_licenca_oem(v_nova.tenant_id), false) then
    raise exception 'Sem permissão para alterar a licença deste cliente no OEM.';
  end if;

  select id, coalesce(nullif(btrim(nome_fantasia), ''), razao_social) as nome
    into v_cli
    from public.clientes
   where id = p_cliente_id and tenant_id = v_nova.tenant_id;
  if v_cli.id is null then
    raise exception 'Cliente não pertence a esta empresa.';
  end if;

  if p_recon_antiga is not null then
    if p_recon_antiga = p_recon_nova then
      raise exception 'A licença escolhida é a mesma que já está no cliente.';
    end if;
    select id, tenant_id, filial_codigo, ds_customer_id
      into v_antiga
      from public.reconciliacao_oem where id = p_recon_antiga;
    -- A tela pode estar velha: alguém já trocou por outro caminho. Soltar uma
    -- licença que não é mais deste cliente tiraria a de outra pessoa.
    if v_antiga.id is null
       or v_antiga.tenant_id <> v_nova.tenant_id
       or v_antiga.ds_customer_id is distinct from p_cliente_id then
      raise exception 'A licença atual não está mais vinculada a este cliente. Recarregue a tela.';
    end if;
    v_filial_antiga := v_antiga.filial_codigo;
  end if;

  -- Fila viva em qualquer das duas filiais: o pedido carrega a filial e a
  -- linha de produto de quando foi feito, e iria para o lugar errado depois
  -- da troca. `erro` conta porque o processador ainda vai tentar de novo.
  select count(*) into v_vivos
    from public.oem_sync_fila f
   where f.tenant_id = v_nova.tenant_id
     and f.status in ('aguardando_aprovacao', 'pendente', 'processando', 'erro')
     and f.filial_codigo in (v_nova.filial_codigo, v_filial_antiga);
  if v_vivos > 0 then
    raise exception 'Há % pedido(s) na fila do OEM para estas licenças. Resolva a fila (Configurações › Integrações › OEM › Fila) antes de trocar.', v_vivos;
  end if;

  -- Sem leitura da licença nova, o gatilho não tem módulos para espelhar e a
  -- ficha ficaria com os módulos e o custo da licença ERRADA com o código da
  -- certa, que é pior do que não trocar.
  if not exists (
    select 1 from public.oem_espelho_filial ef
     where ef.tenant_id = v_nova.tenant_id
       and ef.filial_codigo = v_nova.filial_codigo
       and jsonb_typeof(ef.modulos) = 'array'
  ) then
    raise exception 'A licença % ainda não foi lida do OEM. Aguarde a próxima sincronização e tente de novo.', v_nova.filial_codigo;
  end if;

  -- Fotografia ANTES do espelho: o que o cliente paga. Valor na linha, ou venda
  -- posterior que mora no movimento (o preço de up-sell não fica na linha).
  select coalesce(array_agg(m.id), '{}')
    into v_vendidos
    from public.cliente_produto_modulos m
    join public.cliente_produtos cp on cp.id = m.cliente_produto_id
   where cp.cliente_id = p_cliente_id
     and m.ativo
     and (coalesce(m.vlr_mensal, 0) > 0
          or exists (
            select 1 from public.movimentos_mrr mv
             where mv.cliente_produto_modulo_id = m.id
               and mv.tipo in ('upsell', 'cross_sell')
               and mv.status = 'ativo'
               and mv.encerrado_em is null
               and mv.estornado_por is null
               and mv.estorno_de is null));

  -- Soltar antes de vincular: libera a linha de produto que vai receber o
  -- código novo. Na ordem inversa, `oem_gravar_codigos_no_produto` não acharia
  -- linha livre (-2). Os MIOLOS, e não as RPCs de Divergências: aquelas
  -- conferem admin/head, e a permissão desta troca já foi conferida acima.
  if p_recon_antiga is not null then
    perform public.oem_desvincular_filial_aplicar(p_recon_antiga);
  end if;

  perform public.oem_vincular_filial_aplicar(p_recon_nova, p_cliente_id);

  -- A prova é o código na ficha, não o retorno: o vínculo é void e só deixa o
  -- motivo na `observacao`. Faltou → exception → rollback de tudo, inclusive
  -- do desvínculo acima.
  if not exists (
    select 1 from public.cliente_produtos
     where cliente_id = p_cliente_id and oem_codigo_filial = v_nova.filial_codigo
  ) then
    select observacao into v_obs from public.reconciliacao_oem where id = p_recon_nova;
    raise exception 'Nada foi alterado. %',
      coalesce(v_obs, 'O código da licença não coube em nenhuma linha de produto do cliente.');
  end if;

  -- O espelho deixou `skip_valor_sync` ligado até o fim da transação. Desligado
  -- aqui, a reativação recalcula o custo do produto (senão ficaria sem o módulo).
  perform set_config('doctorsaas.skip_valor_sync', 'false', true);
  perform set_config('doctorsaas.acting_source', 'troca_licenca', true);

  for v_l in
    select m.id, m.modulo_id, m.quantidade, m.vlr_custo, m.tenant_id,
           cp.id as cp_id, cp.oem_codigo_grupo, cp.oem_codigo_filial,
           coalesce(m.oem_modulo_codigo, pm.oem_modulo_codigo) as codigo,
           pm.nome
      from public.cliente_produto_modulos m
      join public.cliente_produtos cp on cp.id = m.cliente_produto_id
      left join public.produto_modulos pm on pm.id = m.modulo_id
     where m.id = any (v_vendidos)
       and not m.ativo
       and not m.cancelado_manual
       and cp.oem_codigo_filial = v_nova.filial_codigo
  loop
    v_conta := public.fn_oem_conta_da_licenca(
      v_l.tenant_id, v_l.oem_codigo_filial, v_l.oem_codigo_grupo, p_cliente_id);
    if v_conta is null then
      raise exception 'Nada foi alterado. O módulo % é pago pelo cliente e não existe na licença %, mas não dá para saber por qual conta do OEM enviá-lo.',
        coalesce(v_l.nome, 'vendido'), v_nova.filial_codigo;
    end if;

    update public.cliente_produto_modulos
       set ativo = true, data_inativacao = null, updated_at = now()
     where id = v_l.id;

    insert into public.oem_sync_fila (
      tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id, modulo_catalogo_id,
      acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
      quantidade, valor_unitario, payload, usuario_id, status
    ) values (
      v_l.tenant_id, v_conta, v_l.cp_id, v_l.id, v_l.modulo_id,
      'ativar', v_l.oem_codigo_grupo, v_l.oem_codigo_filial, v_l.codigo,
      greatest(coalesce(v_l.quantidade, 1), 1), v_l.vlr_custo,
      jsonb_build_object(
        'fonte', 'troca_licenca',
        'vlr_mensal', 0,
        'vlr_ativacao', 0,
        'filial_antiga', v_filial_antiga,
        'obs', 'Módulo pago pelo cliente e ausente na licença nova; a venda já está no MRR.'),
      public.fn_acting_user(),
      'aguardando_aprovacao'
    )
    returning id into v_fila;

    v_reenviados := v_reenviados || jsonb_build_object('modulo', v_l.nome, 'fila_id', v_fila);
  end loop;

  return jsonb_build_object(
    'cliente',          v_cli.nome,
    'filial_nova',      v_nova.filial_codigo,
    'filial_antiga',    v_filial_antiga,
    'dono_anterior',    case when v_nova.ds_customer_id is distinct from p_cliente_id
                             then v_nova.razao_ds end,
    'reenviados',       v_reenviados
  );
end $$;

revoke all on function public.trocar_filial_oem(uuid, uuid, uuid) from public, anon;
grant execute on function public.trocar_filial_oem(uuid, uuid, uuid) to authenticated, service_role;

commit;
