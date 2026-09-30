-- DEM-0507 (30/09/2026): dados do CORUJAO CONVENIENCIA (Digi Office).
-- O pedido 95706281 da fila do OEM (ponto adicional, 2 -> 3) nasceu com 248 de
-- ativacao: 100 do ponto + 148 da troca de adquirente. Ainda nao foi aprovado.
--   1. o pedido fica so com os 100 do ponto (a tela le vlr_ativacao; a
--      aprovacao soma vlr_ativacao_somar);
--   2. os 148 da troca de adquirente viram venda avulsa propria, com a data e o
--      vendedor da proposta de 29/09.
-- Guardas: so mexe se o pedido ainda estiver aguardando e com os 248; so lanca
-- a avulsa se nao houver outra de 148 para o cliente.
with ped as (
  update oem_sync_fila
     set payload = payload || '{"vlr_ativacao": 100, "vlr_ativacao_somar": 100}'::jsonb
   where id = '95706281-9956-4c08-82c8-832a64fa3662'
     and status = 'aguardando_aprovacao'
     and (payload->>'vlr_ativacao')::numeric = 248
  returning id, cliente_produto_id, tenant_id
), alvo as (
  select cp.cliente_id, ped.tenant_id,
         (select ci.contrato_id from contrato_itens ci
            join contratos c on c.id = ci.contrato_id and c.status = 'ativo'
           where ci.cliente_produto_id = ped.cliente_produto_id limit 1) as contrato_id
    from ped join cliente_produtos cp on cp.id = ped.cliente_produto_id
), mov as (
  insert into movimentos_mrr (
    cliente_id, tenant_id, tipo, data_movimento, valor_delta, valor_venda_avulsa, vlr_ativacao,
    descricao, funcionario_id, contrato_id, status
  )
  select alvo.cliente_id, alvo.tenant_id, 'venda_avulsa'::movimento_mrr_tipo, date '2026-09-29', 0, 148, 148,
         'Setup de servico: Troca de Adquirente (serviço) x2 · Troca de adquirente - CORUJAO CONVENIENCIA',
         153, alvo.contrato_id, 'ativo'
    from alvo
   where not exists (select 1 from movimentos_mrr m
                      where m.cliente_id = alvo.cliente_id and m.tipo = 'venda_avulsa'
                        and m.valor_venda_avulsa = 148)
  returning id, cliente_id, contrato_id, valor_venda_avulsa
)
select (select count(*) from ped) as pedido_corrigido,
       (select jsonb_agg(to_jsonb(mov)) from mov) as avulsa_lancada;
