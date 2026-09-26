-- =============================================================================
-- A reconciliação marcava "resolvido" sem gravar o contrato escolhido.
--
-- ACHADO EM 25/09/2026, puxando o fio de "por que o cliente 29.802.678/0001-70
-- não tem boleto nenhum". A RPC `recon_marcar_candidatos_resolvidos` grava a
-- escolha da pessoa em `candidato_escolhido`, marca `status_usuario` e carimba
-- quem e quando — e **nunca escreve `codigo_contrato_omie`**, que é a coluna
-- que todo o resto lê.
--
-- Resultado: 211 linhas `AMBIGUO / resolvido`, algumas desde julho, com a
-- escolha certa guardada num campo que ninguém consulta. O Financeiro deixou
-- 547 títulos sem cliente por causa disso; a conferência de valor com o Omie,
-- que alimenta o MRR, também não fecha sem esse vínculo.
--
-- ⚠️ NÃO HOUVE PERDA DE DADO. O de/para de verdade está salvo no DoctorOMIE
-- (`contracts_mapping`, 1.054 vínculos de contrato contra 791 refletidos aqui).
-- O que estava errado era só a cópia local — e é ela que as telas leem.
--
-- Duas partes, e as duas são necessárias: a RPC passa a gravar (para o futuro),
-- e as linhas antigas recebem o que já está em `candidato_escolhido` (para o
-- passado).
-- =============================================================================

create or replace function public.recon_marcar_candidatos_resolvidos(
  p_pares jsonb,
  p_por uuid,
  p_tenant uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  perform public.assert_tenant_scope(p_tenant);

  update reconciliacao_cadastro r
     set candidato_escolhido = e.codigo_contrato_omie,
         -- ⚠️ A LINHA QUE FALTAVA. Sem ela a escolha fica só em
         -- `candidato_escolhido`, e quem lê o vínculo lê esta coluna.
         codigo_contrato_omie = e.codigo_contrato_omie,
         status_usuario      = 'resolvido',
         resolvido_em        = now(),
         resolvido_por       = p_por
    from jsonb_to_recordset(p_pares) as e(ds_contract_id uuid, codigo_contrato_omie bigint)
   where r.tenant_id      = p_tenant
     and r.ds_contract_id = e.ds_contract_id
     and r.acao_sugerida  = 'escolher_candidato';

  get diagnostics n = row_count;
  return n;
end;
$function$;

comment on function public.recon_marcar_candidatos_resolvidos(jsonb, uuid, uuid) is
  'Marca as linhas da reconciliação resolvidas pela escolha da pessoa. Grava o contrato escolhido em codigo_contrato_omie E em candidato_escolhido: até 25/09/2026 só gravava o segundo, e 211 linhas ficaram com o vínculo invisível para quem lê a primeira.';

-- ── O passado ────────────────────────────────────────────────────────────
--
-- Só onde houve DECISÃO HUMANA. `candidato_escolhido` sem `resolvido`/
-- `vinculado` é sugestão do sistema, e sugestão não vira vínculo.
--
-- `is distinct from` e não `<>` de propósito: comparar com NULL devolve NULL e
-- a linha não entraria no update — que é justamente a linha que precisa entrar.
update public.reconciliacao_cadastro
   set codigo_contrato_omie = candidato_escolhido
 where candidato_escolhido is not null
   and codigo_contrato_omie is distinct from candidato_escolhido
   and codigo_contrato_omie is null
   and status_usuario in ('resolvido', 'vinculado');
