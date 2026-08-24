-- ============================================================================
-- Tirar da ficha o código de filial do OEM, pela tela
--
-- O QUE FALTAVA
-- A divergência "Código da licença gravado num produto de outro fornecedor"
-- tinha saída só quando existia linha de reconciliação para aquele cliente:
-- o botão chamava `desvincular_filial_oem`, que recebe o id da LINHA. Depois de
-- 24/08/2026 esses clientes deixaram de casar com filial nenhuma (o casamento
-- passou a exigir produto do parceiro), então a linha não existe mais — e a
-- divergência ficou sem nenhum caminho de saída a não ser "Ignorar", que
-- esconde em vez de resolver.
--
-- Esta RPC é o caminho direto: limpa o código na ficha do cliente, sem
-- depender de reconciliação.
--
-- POR QUE NÃO CHAMAR `oem_gravar_codigos_no_produto(cliente, null, null)`
-- Ela faz o serviço, mas não pergunta quem está mandando: é SECURITY DEFINER e
-- existe para ser chamada por outras funções do servidor. Exposta ao navegador,
-- qualquer usuário logado poderia limpar o vínculo de qualquer cliente. Aqui o
-- portão é o mesmo de vincular e desvincular: `pode_decidir_oem`.
--
-- ⚠️ `doctorsaas.skip_valor_sync` é obrigatório: `cliente_produtos` tem gatilho
-- que recalcula `clientes.mensalidade` a cada UPDATE. Sem a trava, mexer numa
-- coluna de código mexeria no MRR do cliente. Quem cuida disso é a própria
-- `oem_gravar_codigos_no_produto`, e é por isso que ela é chamada por dentro em
-- vez de o UPDATE ser repetido aqui.
-- ============================================================================

begin;

create or replace function public.oem_remover_codigo_filial(
  p_cliente_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant
    from public.clientes where id = p_cliente_id;
  if v_tenant is null then
    raise exception 'Cliente não encontrado.';
  end if;
  if not public.pode_decidir_oem(v_tenant) then
    raise exception 'Sem permissão para decidir vínculos do OEM.';
  end if;

  -- Limpa o código de TODAS as linhas de produto do cliente: é o mesmo
  -- comportamento do Desfazer da fila, e o cliente que chega aqui tem o número
  -- num produto só.
  return public.oem_gravar_codigos_no_produto(p_cliente_id, null, null);
end $$;

alter function public.oem_remover_codigo_filial(uuid) owner to postgres;
revoke all on function public.oem_remover_codigo_filial(uuid) from public;
revoke all on function public.oem_remover_codigo_filial(uuid) from anon;
grant execute on function public.oem_remover_codigo_filial(uuid) to authenticated, service_role;

comment on function public.oem_remover_codigo_filial(uuid) is
  'Tira o código de filial do OEM da ficha do cliente. Usada pela aba Divergências quando o código está num produto que não é do parceiro.';

commit;

-- ---------------------------------------------------------------------------
-- LIMPEZA DOS CASOS QUE EXISTEM HOJE (8 clientes do Gula Menu).
--
-- Eles já tinham sido limpos em 24/08 e VOLTARAM: a carga seguinte ainda os
-- casava por CNPJ/nome, e `oem_gravar_codigos_em_lote` regrava o código de todo
-- vínculo casado. Com o casamento agora exigindo produto do parceiro, isto não
-- se repete.
--
--   select cp.cliente_id,
--          public.oem_remover_codigo_filial(cp.cliente_id) as limpou
--     from public.cliente_produtos cp
--    where cp.oem_codigo_filial is not null
--      and not exists (
--        select 1 from public.oem_produto_vinculo v
--          join public.oem_integration oi on oi.id = v.conta_integration_id
--         where oi.tenant_id = cp.tenant_id and v.produto_id = cp.produto_id);
--
-- (No SQL Editor a função roda como `postgres`, e `pode_decidir_oem` devolve
-- false sem usuário — por isso a limpeza em massa continua usando o caminho de
-- `oem_gravar_codigos_no_produto`, no script de scripts/.)
-- ---------------------------------------------------------------------------
