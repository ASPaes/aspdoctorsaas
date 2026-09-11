-- ============================================================================
-- "Remover vínculo" tira só a licença daquela filial, e "Desfazer" devolve o
-- código na linha exata de onde ele saiu.
--
-- 1. oem_remover_codigo_filial(cliente) chamava
--    oem_gravar_codigos_no_produto(cliente, null, null), que limpa TODAS as
--    linhas do cliente. Enquanto cada cliente tinha uma licença, dava no mesmo.
--    Desde 20260910210000 um cliente pode ter uma licença por loja, e o botão
--    (que existe para tirar o código de um produto de OUTRO fornecedor)
--    derrubaria junto as licenças certas das outras lojas.
--
--    A tela já sabe qual é a filial (codigoEmProdutoDeOutro guarda filial e
--    produto); agora ela manda. p_filial tem DEFAULT NULL de propósito: a tela
--    antiga continua chamando só com o cliente até o deploy. Para ela a função
--    faz o que sempre fez quando há uma licença só, e RECUSA quando há mais de
--    uma, em vez de apagar todas no escuro.
--
--    DROP + CREATE, e não sobrecarga: com (uuid) e (uuid, text default null)
--    convivendo, a chamada só com p_cliente_id fica ambígua e o PostgREST
--    devolve erro. O DROP leva os grants, então eles são refeitos no fim.
--
-- 2. oem_reverter_lote, ao desfazer 'codigo_filial', restaurava chamando
--    oem_gravar_codigos_no_produto e IGNORAVA o retorno. Desde que ela só grava
--    em linha livre de produto do OEM, desfazer a remoção de um código que
--    estava num produto de outro fornecedor não devolvia nada (-3), e mesmo
--    assim o log saía marcado como revertido. A linha está no próprio log:
--    agora o código volta nela, e quando não dá, conta como falha com motivo.
--    Cópia fiel da versão em produção (lida em 10/09/2026, md5 do corpo
--    f915584d620cdebda29c7829f08454a1); só o ramo 'codigo_filial' mudou.
-- ============================================================================

drop function if exists public.oem_remover_codigo_filial(uuid);

-- `or replace` para a migration poder rodar de novo: na segunda vez o DROP
-- acima não acha a versão antiga, e um `create` puro para com 42723 ("already
-- exists with same argument types"). Foi o que aconteceu em 10/09/2026.
create or replace function public.oem_remover_codigo_filial(
  p_cliente_id uuid,
  p_filial     text default null
)
returns integer
language plpgsql security definer set search_path = public
as $fn$
declare
  v_tenant uuid;
  v_qtd    int;
  v_linha  record;
  v_n      int := 0;
begin
  select tenant_id into v_tenant
    from public.clientes where id = p_cliente_id;
  if v_tenant is null then
    raise exception 'Cliente não encontrado.';
  end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  -- Sem filial é a tela antiga. Com uma licença só não há o que errar, e ela
  -- faz o que sempre fez. Com mais de uma, apagar todas era o bug: recusa e
  -- diz o que fazer.
  if p_filial is null then
    select count(*) into v_qtd
      from public.cliente_produtos
     where cliente_id = p_cliente_id and oem_codigo_filial is not null;
    if v_qtd > 1 then
      raise exception 'Este cliente tem % licenças do OEM na ficha. Recarregue a página para remover só a licença certa.', v_qtd;
    end if;
  end if;

  perform set_config('doctorsaas.skip_valor_sync', 'true', true);
  for v_linha in
    select id, oem_codigo_grupo, oem_codigo_filial
      from public.cliente_produtos
     where cliente_id = p_cliente_id
       and oem_codigo_filial is not null
       and (p_filial is null or oem_codigo_filial = p_filial)
  loop
    update public.cliente_produtos
       set oem_codigo_grupo = null, oem_codigo_filial = null
     where id = v_linha.id;

    -- Um registro por linha, e com a linha: é por ela que o Desfazer devolve.
    perform public.fn_oem_log_alteracao(
      p_tenant_id          => v_tenant,
      p_lote_id            => gen_random_uuid(),
      p_acao               => 'codigo_filial',
      p_cliente_id         => p_cliente_id,
      p_tabela             => 'cliente_produtos',
      p_registro_id        => v_linha.id,
      p_campo              => 'oem_codigo_filial',
      p_valor_antes        => jsonb_build_object('grupo', v_linha.oem_codigo_grupo,
                                                 'filial', v_linha.oem_codigo_filial),
      p_valor_depois       => NULL,
      p_cliente_produto_id => v_linha.id,
      p_filial_codigo      => v_linha.oem_codigo_filial);
    v_n := v_n + 1;
  end loop;
  perform set_config('doctorsaas.skip_valor_sync', 'false', true);

  return v_n;
end $fn$;

comment on function public.oem_remover_codigo_filial(uuid, text) is
  'Tira o codigo do OEM da linha que guarda p_filial. Sem p_filial (tela antiga): so age se o cliente tiver uma licenca; com mais de uma, recusa.';

revoke all on function public.oem_remover_codigo_filial(uuid, text) from public, anon;
grant execute on function public.oem_remover_codigo_filial(uuid, text) to authenticated, service_role;

-- ------------------------------------------ desfazer devolve na linha exata
create or replace function public.oem_reverter_lote(p_tenant_id uuid, p_lote_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $fn$
DECLARE
  l        record;
  v_voltou integer := 0;
  v_falhou jsonb   := '[]'::jsonb;
BEGIN
  -- coalesce POR FORA da expressão inteira: com os dois lados NULL, `NOT NULL`
  -- é NULL, o IF não dispara e o portão liberaria para quem não tem perfil.
  IF NOT coalesce(public.pode_decidir_oem(p_tenant_id), false) THEN
    RAISE EXCEPTION 'Sem permissão para desfazer alterações do OEM.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.oem_alteracao_log
                  WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id
                    AND revertido_em IS NULL AND reversivel) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Este lote já foi desfeito, ou não tem nada que dê para voltar.');
  END IF;

  FOR l IN
    SELECT * FROM public.oem_alteracao_log
     WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id AND revertido_em IS NULL
     ORDER BY feito_em DESC, id DESC
  LOOP
    BEGIN
      IF NOT l.reversivel THEN
        v_falhou := v_falhou || jsonb_build_object(
          'campo', l.acao, 'cliente', l.cliente_nome,
          'motivo', 'Esta ação não é desfeita por aqui.');
        CONTINUE;
      END IF;

      IF l.acao = 'custo' THEN
        UPDATE public.cliente_produtos
           SET vlr_custo = nullif(l.valor_antes #>> '{}', '')::numeric,
               updated_at = now()
         WHERE id = l.registro_id;

      ELSIF l.acao IN ('nome', 'cnpj') THEN
        -- O campo volta ao que era, e a fotografia da conferência acompanha:
        -- sem isso a linha continuaria na tela mostrando o valor novo.
        IF l.campo = 'nome_fantasia' THEN
          UPDATE public.clientes SET nome_fantasia = l.valor_antes #>> '{}', updated_at = now()
           WHERE id = l.registro_id;
          UPDATE public.reconciliacao_oem SET razao_ds = l.valor_antes #>> '{}'
           WHERE tenant_id = l.tenant_id AND ds_customer_id = l.cliente_id;
        ELSE
          UPDATE public.clientes SET cnpj = l.valor_antes #>> '{}', updated_at = now()
           WHERE id = l.registro_id;
          UPDATE public.reconciliacao_oem SET cnpj_ds = l.valor_antes #>> '{}'
           WHERE tenant_id = l.tenant_id AND ds_customer_id = l.cliente_id;
        END IF;

      ELSIF l.acao = 'codigo_filial' THEN
        -- Devolve empresa+filial à LINHA de produto de onde elas saíram.
        --
        -- Antes isto chamava oem_gravar_codigos_no_produto e ignorava o
        -- retorno. Desde que ela só grava em linha livre de produto do OEM,
        -- desfazer a remoção de um código que estava num produto de outro
        -- fornecedor não devolvia nada, e o log saía marcado como revertido.
        -- A linha está no próprio log; o código volta nela, e só se ela ainda
        -- estiver livre. Senão, vira falha com motivo, não sucesso falso.
        -- As chaves são `grupo` e `filial` porque foi assim que a remoção
        -- gravou; `oem_codigo_grupo` é o código da EMPRESA no OEM.
        PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);
        UPDATE public.cliente_produtos
           SET oem_codigo_grupo  = nullif(l.valor_antes->>'grupo', ''),
               oem_codigo_filial = nullif(l.valor_antes->>'filial', ''),
               updated_at        = now()
         WHERE id = coalesce(l.cliente_produto_id, l.registro_id)
           AND (oem_codigo_filial IS NULL
                OR oem_codigo_filial = nullif(l.valor_antes->>'filial', ''));
        IF NOT FOUND THEN
          PERFORM set_config('doctorsaas.skip_valor_sync', 'false', true);
          v_falhou := v_falhou || jsonb_build_object(
            'campo', l.acao, 'cliente', l.cliente_nome,
            'motivo', 'A linha de produto não existe mais, ou já está com outra licença.');
          CONTINUE;
        END IF;
        PERFORM set_config('doctorsaas.skip_valor_sync', 'false', true);

      ELSIF l.acao = 'vinculo' THEN
        -- Desfazer um vínculo é desvincular. Se a licença era de OUTRO cliente
        -- antes, ela volta para ele: `valor_antes` guarda quem era.
        PERFORM public.desvincular_filial_oem(l.recon_id);
        IF nullif(l.valor_antes->>'cliente_id', '') IS NOT NULL THEN
          PERFORM public.vincular_filial_oem(
            l.recon_id, (l.valor_antes->>'cliente_id')::uuid);
        END IF;

      ELSIF l.acao = 'desvinculo' THEN
        IF nullif(l.valor_antes->>'cliente_id', '') IS NOT NULL THEN
          PERFORM public.vincular_filial_oem(
            l.recon_id, (l.valor_antes->>'cliente_id')::uuid);
        ELSE
          v_falhou := v_falhou || jsonb_build_object(
            'campo', l.acao, 'cliente', l.cliente_nome,
            'motivo', 'A linha não tinha cliente antes: não há vínculo para devolver.');
          CONTINUE;
        END IF;

      -- Marcar como certa e trazer de volta são uma o inverso da outra, e as
      -- duas já existem como botão na aba. Desfazer aqui é chamar a irmã.
      -- `campo` guarda o tipo da divergência; a assinatura, que é o que o
      -- "ignorar" precisa para saber o que estava sendo comparado, vai no
      -- `valor_antes`.
      ELSIF l.acao = 'ignorar_divergencia' THEN
        PERFORM public.oem_reexibir_divergencia(
          l.campo,
          l.recon_id,
          nullif(l.valor_antes->>'cliente_id', '')::uuid,
          nullif(l.valor_antes->>'conta', '')::uuid);

      ELSIF l.acao = 'reexibir_divergencia' THEN
        PERFORM public.oem_ignorar_divergencia(
          l.campo,
          coalesce(nullif(l.valor_antes->>'assinatura', ''), l.campo),
          l.recon_id,
          nullif(l.valor_antes->>'cliente_id', '')::uuid,
          nullif(l.valor_antes->>'conta', '')::uuid);

      ELSE
        v_falhou := v_falhou || jsonb_build_object(
          'campo', l.acao, 'cliente', l.cliente_nome,
          'motivo', 'Ação sem caminho de volta conhecido.');
        CONTINUE;
      END IF;

      UPDATE public.oem_alteracao_log
         SET revertido_em = now(), revertido_por = public.fn_acting_user()
       WHERE id = l.id;
      v_voltou := v_voltou + 1;

    EXCEPTION WHEN others THEN
      v_falhou := v_falhou || jsonb_build_object(
        'campo', l.acao, 'cliente', l.cliente_nome, 'motivo', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'revertidos', v_voltou, 'falhas', v_falhou);
END;
$fn$;

-- O DROP acima tirou a função do cache do PostgREST; sem o aviso, a tela pode
-- responder "function not found" até a próxima recarga do esquema.
notify pgrst, 'reload schema';
