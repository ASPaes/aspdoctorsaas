-- ============================================================================
-- A sincronização passa a gravar o código, não só o backfill
--
-- Flagrado pelo Alexandre em 16/08/2026: clicou em "Abrir ficha" no card
-- "cliente sem produto ativo" e o cliente tinha produto ativo, com custo e
-- contrato. O rótulo estava errado — mas a causa é mais funda.
--
-- O código só era gravado em dois lugares: no backfill da migration de 15/08
-- (uma vez) e no vínculo feito à mão. A SINCRONIZAÇÃO nunca gravou. Depois da
-- correção do CNPJ de grupo, centenas de vínculos automáticos novos nasceram
-- sem código — e sem código eles não aparecem na ficha do cliente, não entram
-- na conferência e não ganham a chave durável que protege o vínculo quando o
-- CNPJ muda de um lado. O par grupo+filial é a espinha do desenho e estava
-- sendo escrito uma vez só, na mão.
--
-- POR QUE UMA RPC DE LOTE E NÃO UMA CHAMADA POR LINHA
-- São centenas de linhas por carga. Uma chamada por linha seriam centenas de
-- idas ao banco dentro de uma função com 150s de parede — o mesmo teto que já
-- derrubou a carga do DoctorOEM antes. Aqui é uma chamada só por conta.
--
-- SÓ ESCREVE, NUNCA APAGA
-- O de/para é apagado e refeito a cada carga. Se o lote também limpasse, uma
-- filial que falhasse em casar numa carga perderia o código — justamente a
-- chave que existe para sobreviver a isso. Apagar continua sendo ato humano,
-- pelo desvincular.
--
-- E SÓ ONDE NÃO HÁ DÚVIDA: cliente com exatamente uma filial apontando para
-- ele e exatamente um produto ativo. As mesmas guardas do backfill, que
-- produziram 637 vínculos 1:1 sem um único conflito.
-- ============================================================================

begin;

create or replace function public.oem_gravar_codigos_em_lote(p_conta uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n int := 0; r record;
begin
  -- Sem isto, cada UPDATE dispara trg_sync_cliente_mensalidade e recalcula o
  -- faturamento do cliente. Centenas de vezes, a cada carga.
  perform set_config('doctorsaas.skip_valor_sync', 'true', true);

  for r in
    select ro.ds_customer_id, ro.empresa_codigo, ro.filial_codigo
      from public.reconciliacao_oem ro
     where ro.conta_integration_id = p_conta
       and ro.ds_customer_id is not null
       and ro.filial_codigo  is not null
       -- uma filial só apontando para este cliente
       and ro.ds_customer_id in (
             select ds_customer_id
               from public.reconciliacao_oem
              where conta_integration_id = p_conta
                and ds_customer_id is not null
                and filial_codigo  is not null
              group by 1 having count(distinct filial_codigo) = 1)
       -- e exatamente um produto ativo, senão não se sabe em qual gravar
       and (select count(*) from public.cliente_produtos cp
             where cp.cliente_id = ro.ds_customer_id and cp.ativo) = 1
  loop
    update public.cliente_produtos cp
       set oem_codigo_grupo  = r.empresa_codigo,
           oem_codigo_filial = r.filial_codigo
     where cp.cliente_id = r.ds_customer_id
       and cp.ativo
       and cp.oem_codigo_filial is distinct from r.filial_codigo;
    if found then v_n := v_n + 1; end if;
  end loop;

  perform set_config('doctorsaas.skip_valor_sync', 'false', true);
  return v_n;
end $$;

revoke all on function public.oem_gravar_codigos_em_lote(uuid)
  from public, anon, authenticated;
grant execute on function public.oem_gravar_codigos_em_lote(uuid) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura) — depois de "Atualizar espelho":
--
--   select count(*) as linhas_com_codigo
--     from public.cliente_produtos where oem_codigo_filial is not null;
--   -- tem que subir muito acima dos 637 do backfill de 15/08
--
--   -- e a mensalidade não pode ter se mexido:
--   select sum(mensalidade) from public.clientes where cancelado = false;
-- ---------------------------------------------------------------------------
