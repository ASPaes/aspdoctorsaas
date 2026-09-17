-- ============================================================================
-- Trocar a licença do OEM de um cliente numa operação só.
--
-- O problema: cliente vinculado à licença errada. Tudo o que se faz na ficha
-- (ativar, somar, cancelar módulo) vai para a licença de OUTRO cliente no
-- parceiro, e a ficha não tinha como corrigir o vínculo.
--
-- O diálogo de troca já existia (Divergências › baixa programada), mas fazia
-- DUAS chamadas do navegador: `desvincular_filial_oem` e depois
-- `vincular_filial_oem`. Três jeitos de dar errado, todos calados:
--
--   1. A segunda chamada falha → o cliente fica sem licença nenhuma.
--   2. `vincular_filial_oem` devolve void mesmo quando o código NÃO coube na
--      ficha (retorno -1/-2/-3/0 de `oem_gravar_codigos_no_produto` vira só
--      uma `observacao`). A tela dizia "Licença vinculada".
--   3. `oem_sync_fila` guarda `filial_codigo` e `cliente_produto_id` no
--      ENFILEIRAMENTO. Pedido vivo da licença antiga continuaria indo para ela
--      depois da troca.
--
-- Esta função faz as duas coisas na mesma transação, recusa com fila viva e
-- desfaz tudo se a licença nova não entrar na ficha. As duas RPCs antigas
-- continuam existindo e continuam gravando a trilha (`fn_oem_log_alteracao`):
-- são elas que esta chama, para não haver uma terceira cópia da regra.
--
-- Nada é enviado ao parceiro. Os módulos da ficha passam a ser os da licença
-- nova pelo gatilho `trg_oem_espelhar_ao_vincular_upd`.
-- ============================================================================

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

  -- `coalesce` por FORA: NULL no portão libera (ver auditoria is_super_admin).
  if not coalesce(public.pode_decidir_oem(v_nova.tenant_id), false) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
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

  -- Soltar antes de vincular: libera a linha de produto que vai receber o
  -- código novo. Na ordem inversa, `oem_gravar_codigos_no_produto` não acharia
  -- linha livre (-2).
  if p_recon_antiga is not null then
    perform public.desvincular_filial_oem(p_recon_antiga);
  end if;

  perform public.vincular_filial_oem(p_recon_nova, p_cliente_id);

  -- A prova é o código na ficha, não o retorno: `vincular_filial_oem` é void e
  -- só deixa o motivo na `observacao`. Faltou → exception → rollback de tudo,
  -- inclusive do desvínculo acima.
  if not exists (
    select 1 from public.cliente_produtos
     where cliente_id = p_cliente_id and oem_codigo_filial = v_nova.filial_codigo
  ) then
    select observacao into v_obs from public.reconciliacao_oem where id = p_recon_nova;
    raise exception 'Nada foi alterado. %',
      coalesce(v_obs, 'O código da licença não coube em nenhuma linha de produto do cliente.');
  end if;

  return jsonb_build_object(
    'cliente',          v_cli.nome,
    'filial_nova',      v_nova.filial_codigo,
    'filial_antiga',    v_filial_antiga,
    'dono_anterior',    case when v_nova.ds_customer_id is distinct from p_cliente_id
                             then v_nova.razao_ds end
  );
end $$;

comment on function public.trocar_filial_oem(uuid, uuid, uuid) is
  'Vincula a licenca nova ao cliente e solta a antiga na mesma transacao. Recusa com fila viva, sem leitura da licenca nova ou se o codigo nao couber na ficha.';

-- REVOKE FROM PUBLIC sozinho não tira `authenticated` (ver memória).
revoke all on function public.trocar_filial_oem(uuid, uuid, uuid) from public, anon;
grant execute on function public.trocar_filial_oem(uuid, uuid, uuid) to authenticated, service_role;

commit;
