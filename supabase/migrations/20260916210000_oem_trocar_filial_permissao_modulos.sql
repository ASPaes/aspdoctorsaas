-- ============================================================================
-- Trocar licença pela ficha segue a MESMA permissão de Bloquear/Desativar.
--
-- Decisão do Alexandre (16/09/2026): quem pode ligar, desligar e bloquear a
-- licença pode trocá-la. Essa régua é a chave `clientes.modulos` (can_view) +
-- mesmo tenant, conferida em `oem-licenca-estado` via `get_my_permissions`.
--
-- `trocar_filial_oem` (20260916200000) usava `pode_decidir_oem` (admin/head),
-- e pior: chamava `vincular_filial_oem` e `desvincular_filial_oem`, que
-- conferem `pode_decidir_oem` de novo por dentro. Trocar só o portão de fora
-- deixaria o operador com a permissão ver o botão e ser recusado lá dentro.
--
-- Por isso as duas viram PORTÃO + MIOLO (o mesmo desenho da fila do OEM):
--   - `oem_vincular_filial_aplicar` / `oem_desvincular_filial_aplicar`: o corpo
--     de produção lido em 16/09/2026 (hash inalterado desde a leitura), sem a
--     checagem de permissão. Só `service_role`: sem portão, não pode ser
--     chamado do navegador.
--   - `vincular_filial_oem` / `desvincular_filial_oem`: mesma assinatura, mesma
--     permissão de sempre (Divergências não muda), chamando o miolo.
--   - `trocar_filial_oem`: portão `pode_mexer_licenca_oem`, chamando os miolos.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- o portão
-- Espelho de `oem-licenca-estado`: `get_my_permissions` já resolve super
-- admin, rbac desligado, papel e exceção por usuário. Reimplementar a régua
-- criaria uma segunda verdade. Ela não recebe tenant, por isso o tenant é
-- conferido à parte: sozinha, liberaria mexer na licença de outra empresa.
create or replace function public.pode_mexer_licenca_oem(p_tenant_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.is_super_admin(), false)
      or (
        exists (select 1 from public.get_my_permissions() gp
                 where gp.resource_key = 'clientes.modulos' and gp.can_view = true)
        and exists (select 1 from public.profiles p
                     where p.user_id = auth.uid() and p.tenant_id = p_tenant_id)
      );
$$;

comment on function public.pode_mexer_licenca_oem(uuid) is
  'Mesma regua de Bloquear/Desativar licenca: clientes.modulos (can_view) no mesmo tenant, ou super admin.';

revoke all on function public.pode_mexer_licenca_oem(uuid) from public, anon;
grant execute on function public.pode_mexer_licenca_oem(uuid) to authenticated, service_role;

-- ------------------------------------------------------ miolo do vínculo
create or replace function public.oem_vincular_filial_aplicar(
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
end $$;

revoke all on function public.oem_vincular_filial_aplicar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.oem_vincular_filial_aplicar(uuid, uuid) to service_role;

-- ---------------------------------------------------- miolo do desvínculo
create or replace function public.oem_desvincular_filial_aplicar(p_recon_id uuid)
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

revoke all on function public.oem_desvincular_filial_aplicar(uuid) from public, anon, authenticated;
grant execute on function public.oem_desvincular_filial_aplicar(uuid) to service_role;

-- ------------------------------------- as RPCs de Divergências: portão só
-- Mesma assinatura, mesma permissão (admin/head) e mesmas mensagens de antes.
-- `create or replace` mantém os GRANTs existentes.
create or replace function public.vincular_filial_oem(
  p_recon_id   uuid,
  p_cliente_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.reconciliacao_oem where id = p_recon_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not coalesce(public.pode_decidir_oem(v_tenant), false) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;
  perform public.oem_vincular_filial_aplicar(p_recon_id, p_cliente_id);
end $$;

create or replace function public.desvincular_filial_oem(p_recon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.reconciliacao_oem where id = p_recon_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not coalesce(public.pode_decidir_oem(v_tenant), false) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;
  perform public.oem_desvincular_filial_aplicar(p_recon_id);
end $$;

-- ------------------------------------------------------------- a troca
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

  return jsonb_build_object(
    'cliente',          v_cli.nome,
    'filial_nova',      v_nova.filial_codigo,
    'filial_antiga',    v_filial_antiga,
    'dono_anterior',    case when v_nova.ds_customer_id is distinct from p_cliente_id
                             then v_nova.razao_ds end
  );
end $$;

commit;
