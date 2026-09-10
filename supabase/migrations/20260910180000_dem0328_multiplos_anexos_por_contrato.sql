-- ============================================================================
-- DEM-0328 -- multiplos documentos por contrato (contrato + termos aditivos)
--
-- O QUE FORCAVA UM SO: o indice unico parcial contrato_anexos_um_ativo_por_contrato
--   (contrato_id) WHERE ativo. A tabela ja nasceu preparada para N linhas -- tem
--   ativo, substituido_em, hash e fila propria por linha -- e o cron
--   ds-omie-anexo-enviar ja trabalha POR LINHA (fase 1 le a fila inteira, fase 2
--   limpa cada orfao com seu proprio omie_id_anexo). Ou seja: o modelo suportava
--   varios; so o indice e as duas RPCs e que impunham "um".
--
-- CONSEQUENCIA NO OMIE: cada linha tem cod_int_anexo proprio (ds<uuid>), entao dois
--   anexos ativos no mesmo contrato viram duas chamadas IncluirAnexo com chaves
--   distintas. Nao ha caminho novo de erro silencioso: se o Omie recusar, a linha
--   cai em 'erro'/'invalido' com a mensagem gravada, como qualquer outra.
--
-- SEGURANCA: as duas RPCs novas sao SECURITY INVOKER de proposito, igual as antigas.
--   Quem barra quem escreve e a RLS da contrato_anexos (is_admin_or_head + tenant).
--   Um SECURITY DEFINER aqui passaria por cima desse portao.
--
-- As RPCs antigas (contrato_anexo_substituir / contrato_anexo_remover) ficam de pe
--   nesta migration: enquanto o frontend novo nao esta publicado, o antigo continua
--   funcionando. Derrubar as duas e um passo separado, depois do deploy.
-- ============================================================================

-- 1. o portao de "um anexo por contrato"
drop index if exists public.contrato_anexos_um_ativo_por_contrato;

-- 2. tipo do documento (contrato, aditivo, outro)
alter table public.contrato_anexos
  add column if not exists tipo text not null default 'contrato';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.contrato_anexos'::regclass
      and conname  = 'contrato_anexos_tipo_ck'
  ) then
    alter table public.contrato_anexos
      add constraint contrato_anexos_tipo_ck
      check (tipo in ('contrato', 'aditivo', 'outro'));
  end if;
end $$;

-- 3. listagem: N ativos por contrato, mais novo primeiro
create index if not exists contrato_anexos_ativos_por_contrato
  on public.contrato_anexos (contrato_id, created_at desc)
  where ativo;

-- ============================================================================
-- 4. adicionar documento (sem desativar os anteriores)
--
-- Devolve jsonb {id, duplicado}. O 'duplicado' existe porque o arquivo ja subiu
-- para o Storage antes desta chamada: sem ele, o frontend nao teria como saber que
-- deve apagar o blob recem-enviado e o bucket acumularia copia orfa a cada tentativa
-- de anexar o mesmo arquivo duas vezes.
-- ============================================================================
create or replace function public.contrato_anexo_adicionar(
  p_contrato_id   uuid,
  p_storage_path  text,
  p_nome_original text,
  p_nome_omie     text,
  p_mime_type     text,
  p_tamanho_bytes bigint,
  p_hash_sha256   text,
  p_tipo          text default 'contrato'
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_tenant   uuid;
  v_id_atual uuid;
  v_novo     uuid;
  v_base     text;
  v_ext      text;
  v_nome     text;
  v_seq      int := 1;
begin
  select c.tenant_id into v_tenant
  from public.contratos c
  where c.id = p_contrato_id;

  if v_tenant is null then
    raise exception 'contrato % nao encontrado ou sem permissao', p_contrato_id;
  end if;

  if p_tipo is null or p_tipo not in ('contrato', 'aditivo', 'outro') then
    raise exception 'tipo de documento invalido: %', coalesce(p_tipo, '(nulo)');
  end if;

  -- mesmo arquivo, mesmo contrato: devolve o que ja esta anexado em vez de duplicar
  select a.id into v_id_atual
  from public.contrato_anexos a
  where a.contrato_id = p_contrato_id
    and a.ativo
    and a.hash_sha256 = p_hash_sha256
  limit 1;

  if v_id_atual is not null then
    return jsonb_build_object('id', v_id_atual, 'duplicado', true);
  end if;

  -- Dois documentos DIFERENTES com o mesmo nome no mesmo contrato: no DS eles se
  -- distinguem pela linha, mas no Omie virariam dois anexos de nome igual pendurados
  -- no mesmo contrato de servico -- impossivel de distinguir na tela de la. O
  -- nome_original (o que aparece aqui) fica intacto; so o nome que vai para o Omie
  -- ganha sufixo. O regex do CHECK permite base de ate 80 chars e um ponto so.
  v_base := split_part(p_nome_omie, '.', 1);
  v_ext  := split_part(p_nome_omie, '.', 2);
  v_nome := p_nome_omie;

  while v_seq < 50 and exists (
    select 1 from public.contrato_anexos a
    where a.contrato_id = p_contrato_id and a.ativo and a.nome_omie = v_nome
  ) loop
    v_seq  := v_seq + 1;
    v_nome := left(v_base, 80 - length('_' || v_seq)) || '_' || v_seq || '.' || v_ext;
  end loop;

  insert into public.contrato_anexos (
    tenant_id, contrato_id, storage_path, nome_original, nome_omie,
    mime_type, tamanho_bytes, hash_sha256, tipo, criado_por
  )
  values (
    v_tenant, p_contrato_id, p_storage_path, p_nome_original, v_nome,
    p_mime_type, p_tamanho_bytes, p_hash_sha256, p_tipo, auth.uid()
  )
  returning id into v_novo;

  return jsonb_build_object('id', v_novo, 'duplicado', false);
end;
$function$;

revoke all on function public.contrato_anexo_adicionar(uuid, text, text, text, text, bigint, text, text) from public;
grant execute on function public.contrato_anexo_adicionar(uuid, text, text, text, text, bigint, text, text) to authenticated, service_role;

-- ============================================================================
-- 5. excluir UM documento (a antiga so sabia "o anexo ativo do contrato")
--
-- omie_id_anexo fica INTACTO, mesma razao da contrato_anexo_remover: e por ele que
-- a fase 2 do cron acha o que ainda precisa sair do Omie.
-- ============================================================================
create or replace function public.contrato_anexo_excluir(p_anexo_id uuid)
returns uuid
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
begin
  update public.contrato_anexos
     set ativo = false,
         substituido_em = now()
   where id = p_anexo_id
     and ativo
  returning id into v_id;

  if v_id is null then
    raise exception 'anexo % nao encontrado, ja removido ou sem permissao', p_anexo_id;
  end if;

  return v_id;
end;
$function$;

revoke all on function public.contrato_anexo_excluir(uuid) from public;
grant execute on function public.contrato_anexo_excluir(uuid) to authenticated, service_role;
