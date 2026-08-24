-- ============================================================================
-- Vincular uma licença apaga o aviso "Cliente sem licença no OEM" na hora
--
-- O QUE ACONTECIA
-- A reconciliação tem duas espécies de linha: a da LICENÇA (tem filial) e a do
-- CLIENTE SEM LICENÇA (não tem). `vincular_filial_oem` mexe só na primeira, que
-- é a que recebe o vínculo. A segunda continuava lá dizendo que o cliente não
-- tem licença nenhuma — logo depois de alguém ter acabado de dar uma a ele.
--
-- A carga do espelho conserta isso sozinha, mas ela roda de 6 em 6 horas: até
-- lá, a divergência resolvida seguia na tela, e a pessoa que acabou de resolver
-- não tem como saber que o que ela vê é um retrato velho. Alarme que não some
-- quando o problema some é o que ensina a ignorar a tela.
--
-- O QUE MUDA
-- No fim do vínculo, some a linha "só no DS" daquele cliente NESTA conta. Ela
-- não guarda decisão nenhuma (é retrato da carga, sempre `status_usuario` =
-- 'novo' e sem `resolvido_em`), então apagar não perde histórico — e a próxima
-- carga só a recria se o cliente realmente ficar sem licença de novo.
--
-- Corpo copiado da função QUE ESTÁ EM PRODUÇÃO (dump de 23/08/2026). A única
-- alteração é o DELETE do fim.
-- ============================================================================

begin;

create or replace function public.vincular_filial_oem(
  p_recon_id   uuid,
  p_cliente_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_tenant uuid; v_cli record; v_rec record; v_res int;
begin
  select tenant_id, empresa_codigo, filial_codigo, conta_integration_id into v_rec
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

  -- Se esta licença estava em outro cliente, o código sai de lá antes de entrar
  -- aqui — senão dois cadastros diriam ser a mesma filial.
  perform public.oem_gravar_codigos_no_produto(r.ds_customer_id, null, null)
     from public.reconciliacao_oem r
    where r.id = p_recon_id and r.ds_customer_id is not null
      and r.ds_customer_id <> p_cliente_id;

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
end $$;

alter function public.vincular_filial_oem(uuid, uuid) owner to postgres;
revoke all on function public.vincular_filial_oem(uuid, uuid) from public;
revoke all on function public.vincular_filial_oem(uuid, uuid) from anon;
grant execute on function public.vincular_filial_oem(uuid, uuid) to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura), depois de vincular uma licença pela tela:
--   select count(*) from public.reconciliacao_oem
--    where ds_customer_id = '<cliente>' and filial_codigo is null;  -- espera 0
-- ---------------------------------------------------------------------------
