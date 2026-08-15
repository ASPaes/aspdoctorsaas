-- ============================================================================
-- Integração OEM — fase 3: a decisão humana do vínculo
--
-- As fases 1 e 2 trouxeram o espelho e o de/para, mas a tela só sabia LISTAR o
-- que precisava de decisão: "a escolha do cliente ainda não é feita por aqui".
-- Estas três RPCs são a decisão.
--
-- POR QUE RPC E NÃO UPDATE DIRETO
-- A policy de update em reconciliacao_oem já existia, então a tela conseguiria
-- gravar sozinha. Mas quem grava precisa carimbar resolvido_por = auth.uid() e
-- copiar razao/mensalidade/cancelado do cliente escolhido — três campos que a
-- tela erraria em silêncio se esquecesse. E o de/para é apagado e refeito a
-- cada sincronização: a linha só sobrevive porque status_usuario <> 'novo'
-- (ver oem-espelho-sync, passo 4). Deixar isso numa função é o que garante que
-- a escolha não evapore na próxima carga.
--
-- POR QUE EXISTE DESVINCULAR
-- Escolher entre 38 filiais do mesmo CNPJ é onde o erro humano mora. Sem o
-- caminho de volta, um clique errado vira vínculo permanente — a sincronização
-- preserva a decisão errada para sempre, exatamente como preservaria a certa.
-- ============================================================================

begin;

-- Quem pode decidir: admin ou head do tenant, e o super admin por cima.
--
-- O coalesce não é enfeite. `is_super_admin()` é `select ... from profiles
-- where user_id = auth.uid()` — sem linha, ela devolve NULL, não false. Aí
-- `NULL or false` é NULL, e o `if not <NULL> then raise` NUNCA dispara: o
-- portão deixa passar em silêncio quem não tem perfil nenhum. Em policy de RLS
-- isso seria inofensivo (NULL no USING esconde a linha); dentro de plpgsql é o
-- contrário — é justamente o caminho que libera.
create or replace function public.pode_decidir_oem(p_tenant_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.is_super_admin(), false)
      or exists (select 1 from public.profiles p
                  where p.user_id = auth.uid()
                    and p.tenant_id = p_tenant_id
                    and p.role in ('admin','head'));
$$;

revoke all on function public.pode_decidir_oem(uuid) from public;
grant execute on function public.pode_decidir_oem(uuid) to authenticated, service_role;

-- --------------------------------------------------------------- vincular
create or replace function public.vincular_filial_oem(
  p_recon_id   uuid,
  p_cliente_id uuid
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid; v_cli record;
begin
  select tenant_id into v_tenant from public.reconciliacao_oem where id = p_recon_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  -- O cliente TEM que ser do mesmo tenant. Sem esta checagem a RPC seria um
  -- furo: ela roda como definer e enxerga a base inteira.
  select id, coalesce(nome_fantasia, razao_social) as nome, mensalidade, cancelado
    into v_cli
    from public.clientes
   where id = p_cliente_id and tenant_id = v_tenant;
  if not found then raise exception 'Cliente não pertence a esta empresa.'; end if;

  update public.reconciliacao_oem
     set ds_customer_id      = v_cli.id,
         candidato_escolhido = v_cli.id,
         razao_ds            = v_cli.nome,
         mensalidade_ds      = v_cli.mensalidade,
         cancelado_ds        = v_cli.cancelado,
         estado_match        = case when filial_codigo is null then estado_match else 'CASADO' end,
         status_usuario      = 'vinculado',
         resolvido_em        = now(),
         resolvido_por       = auth.uid()
   where id = p_recon_id;
end $$;

revoke all on function public.vincular_filial_oem(uuid, uuid) from public;
grant execute on function public.vincular_filial_oem(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- ignorar
-- Filial que não deve virar cliente (teste, cadastro duplicado, licença de
-- demonstração). Sai da fila sem inventar vínculo.
create or replace function public.ignorar_filial_oem(
  p_recon_id   uuid,
  p_observacao text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.reconciliacao_oem where id = p_recon_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  update public.reconciliacao_oem
     set status_usuario = 'ignorado',
         observacao     = nullif(trim(coalesce(p_observacao, '')), ''),
         resolvido_em   = now(),
         resolvido_por  = auth.uid()
   where id = p_recon_id;
end $$;

revoke all on function public.ignorar_filial_oem(uuid, text) from public;
grant execute on function public.ignorar_filial_oem(uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------- desvincular
-- Volta a linha para 'novo'. A próxima sincronização deixa de preservá-la e o
-- casamento automático por CNPJ volta a valer.
create or replace function public.desvincular_filial_oem(p_recon_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.reconciliacao_oem where id = p_recon_id;
  if v_tenant is null then raise exception 'Linha de conciliação não encontrada.'; end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
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
end $$;

revoke all on function public.desvincular_filial_oem(uuid) from public;
grant execute on function public.desvincular_filial_oem(uuid) to authenticated, service_role;

-- ------------------------------------------- o mesmo furo em salvar_chave_oem
-- Ela tem exatamente o `if not (public.is_super_admin() or exists ...)` que
-- deixa passar quem não tem perfil. Corpo idêntico ao de 14/08, só com o
-- coalesce — é a função que grava a chave de integração no Vault.
create or replace function public.salvar_chave_oem(
  p_tenant_id uuid,
  p_unidades  bigint[],
  p_chave     text,
  p_api_url   text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_sid uuid; v_nome text;
begin
  if not public.pode_decidir_oem(p_tenant_id) then
    raise exception 'Apenas administradores podem configurar a integração OEM.';
  end if;
  if coalesce(trim(p_chave), '') = '' then
    raise exception 'Chave vazia.';
  end if;

  -- Uma unidade não pode estar em duas contas: o espelho ficaria ambíguo.
  select id into v_id from public.oem_integration
   where tenant_id = p_tenant_id and unidades_base_ids && p_unidades limit 1;

  v_nome := 'oem_api_key_' || p_tenant_id::text || '_' || coalesce(p_unidades[1], 0)::text;
  begin
    v_sid := public.vault_get_secret_id_by_name(v_nome);
  exception when others then v_sid := null;
  end;
  if v_sid is null then
    v_sid := public.vault_create_secret(trim(p_chave), v_nome);
  else
    perform public.vault_update_secret(v_sid, trim(p_chave));
  end if;

  if v_id is null then
    insert into public.oem_integration
      (tenant_id, unidades_base_ids, vault_secret_id, chave_prefixo, api_url, criado_por)
    values (p_tenant_id, p_unidades, v_sid, left(trim(p_chave), 17),
            coalesce(p_api_url, 'https://furohpfhukwajhvnnbiw.functions.supabase.co'), auth.uid())
    returning id into v_id;
  else
    update public.oem_integration
       set unidades_base_ids = p_unidades,
           vault_secret_id   = v_sid,
           chave_prefixo     = left(trim(p_chave), 17),
           api_url           = coalesce(p_api_url, api_url),
           ultimo_status     = 'nao_testado'
     where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function public.salvar_chave_oem(uuid, bigint[], text, text) from public;
grant execute on function public.salvar_chave_oem(uuid, bigint[], text, text) to authenticated, service_role;

-- Card do cliente: "quais licenças OEM são deste cliente?". Sem índice isso é
-- varredura em ~3.000 linhas a cada abertura de ficha.
create index if not exists idx_recon_oem_cliente_filial
  on public.reconciliacao_oem (ds_customer_id)
  where ds_customer_id is not null;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--
--   select p.proname,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('pode_decidir_oem','vincular_filial_oem',
--                        'ignorar_filial_oem','desvincular_filial_oem');
--
--   select status_usuario, estado_match, count(*)
--     from public.reconciliacao_oem group by 1,2 order by 3 desc;
-- ---------------------------------------------------------------------------
