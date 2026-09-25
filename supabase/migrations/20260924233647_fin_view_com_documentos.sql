-- =============================================================================
-- A view tinha ficado para trás das colunas novas.
--
-- ERRO MEU, de 25/09/2026, e a ordem é que o causou: recriei
-- `vw_fin_titulos_abertos` com lista EXPLÍCITA de colunas numa migration, e na
-- migration SEGUINTE adicionei `origem_os_id`, `numero_nf`, `documentos` e
-- `documentos_em` à tabela. Coluna nova não entra sozinha numa view que lista
-- colunas uma a uma.
--
-- POR QUE ISSO NÃO ERA UM DETALHE: a `fin-segunda-via` lê os títulos DESTA view
-- e passou a pedir essas colunas. Coluna que não existe faz o PostgREST recusar
-- a consulta inteira — não é a nota que falharia, é a lista de faturas ficar
-- vazia e o cliente ouvir "não encontrei nenhuma fatura em aberto" tendo
-- faturas. O pior tipo de defeito: silencioso e verossímil.
--
-- ⚠️ `create or replace view` NÃO serve aqui: mudar a lista de colunas devolve
-- "cannot change name of view column". Tem que ser drop + create, e o drop leva
-- os grants junto — por isso eles são reemitidos no fim. Esquecer isso deixaria
-- a tela sem acesso à view e o erro apareceria como "nenhum título".
-- =============================================================================

drop view if exists public.vw_fin_titulos_abertos;

create view public.vw_fin_titulos_abertos
with (security_invoker = true) as
  select t.id, t.tenant_id, t.origem, t.origem_conta_id, t.origem_id,
         t.cliente_id, t.origem_cliente_id, t.cnpj_cpf_digits,
         t.numero_documento, t.parcela, t.emissao, t.vencimento, t.valor,
         t.valor_pago, t.pago_em, t.situacao, t.situacao_origem,
         t.link_boleto, t.boleto_gerado, t.codigo_barras, t.pix_copia_cola,
         t.link_nfse, t.visto_em, t.origem_atualizado_em, t.raw,
         t.criado_em, t.atualizado_em, t.link_boleto_expira_em, t.numero_boleto,
         -- As quatro que faltavam. `documentos` é o que evita uma segunda ida
         -- ao Omie para saber se há nota.
         t.origem_os_id, t.numero_nf, t.documentos, t.documentos_em,
         t.vencimento < current_date as vencido,
         greatest(0, current_date - t.vencimento) as dias_atraso
    from public.fin_titulos t
    join public.fin_sync_estado e
      on e.tenant_id = t.tenant_id and e.origem = t.origem
   where t.situacao = any (array['a_vencer','vence_hoje','atrasado'])
     and t.removido_na_origem_em is null
     and e.ultima_leitura_ok is not null
     and (
          (t.situacao = any (array['atrasado','vence_hoje'])
           and t.visto_em >= e.ultima_leitura_ok - interval '10 minutes')
       or (t.situacao = 'a_vencer'
           and t.visto_em >= e.ultima_leitura_ok - interval '7 days')
     );

-- O drop levou os grants. Reemitidos com o mesmo desenho do resto do módulo.
revoke all on public.vw_fin_titulos_abertos from anon, authenticated;
grant select on public.vw_fin_titulos_abertos to authenticated, service_role;
