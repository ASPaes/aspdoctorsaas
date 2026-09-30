-- SALOMAO JORGE FILHO (cod 15959, Digi) — restaura a mensalidade sobrescrita
-- pelo Up-Sell de NFC-e da calculadora em 30/09/2026 15:46.
--
-- O que aconteceu: o produto PDV Legal - Servidor tinha a receita DIGITADA
-- (R$ 478,00, zero modulos). O intake inseriu o 1o modulo (NFCE R$ 36) e o
-- gatilho fn_sync_produto_valores, vendo "todos os modulos pagos", trocou a
-- receita do produto pela soma deles: 478 -> 36.
--
-- E a venda era repetida: o NFC-e ja estava lancado desde 31/08 como upsell
-- manual (R$ 36 mensal, R$ 200 setup) — a observacao do cliente registra
-- "CONTRATO PASSOU DE 478,00 PARA 514,00" e o Omie esta em 514.
--
-- Estado final: produto 478 + upsell NFC-e 36 = MRR 514 (= Omie).
-- O modulo NFCE fica na ficha como cadastro (valor 0); o dinheiro mora no
-- movimento de agosto, que passa a apontar para ele.
-- skip_valor_sync: o Omie ja esta certo, nada deve ser enfileirado.

begin;

select set_config('doctorsaas.skip_valor_sync', 'true', true);
select set_config('doctorsaas.motivo_valor',
  'Correcao: NFC-e ja lancado em 31/08 como upsell; valor fica no movimento', true);

do $$
begin
  if (select vlr_mensal from public.cliente_produtos
       where id = 'b08272ed-f696-4b18-819f-f2e0b3e100f4') <> 36 then
    raise exception 'estado mudou desde o diagnostico — nao aplicar';
  end if;
end $$;

update public.cliente_produto_modulos
   set vlr_mensal = 0, vlr_ativacao = 0, updated_at = now()
 where id = 'e6f80c25-a20d-4c95-8cd9-345a4ac1435f';

update public.movimentos_mrr
   set cliente_produto_modulo_id = 'e6f80c25-a20d-4c95-8cd9-345a4ac1435f',
       contrato_id               = '3e5e0cba-cccd-4934-ba57-b1b12d578d67'
 where id = '9585f841-5480-423e-a7fa-8c6ba9b8309b';

update public.cliente_produtos
   set vlr_mensal = 478, updated_at = now()
 where id = 'b08272ed-f696-4b18-819f-f2e0b3e100f4';

update public.contrato_itens
   set vlr_mensal = 478, vlr_ativacao = 1040
 where id = 'd10b61a8-1663-4b41-90f4-837937950317';

update public.contratos
   set vlr_total_mensal = 478, vlr_total_ativacao = 1040, updated_at = now()
 where id = '3e5e0cba-cccd-4934-ba57-b1b12d578d67';

update public.clientes
   set mensalidade = 478, updated_at = now()
 where id = '8941dd7c-493f-4da0-98ad-c14bad807a2c';

commit;

-- Conferencia: esperado produto 478, contrato 478/1040, MRR 514.
select cp.vlr_mensal produto, c.vlr_total_mensal contrato_mensal,
       c.vlr_total_ativacao contrato_ativacao, cl.mensalidade,
       public.fn_mrr_cliente_em(cp.tenant_id, cp.cliente_id, current_date) mrr
  from public.cliente_produtos cp
  join public.contratos c on c.id = '3e5e0cba-cccd-4934-ba57-b1b12d578d67'
  join public.clientes cl on cl.id = cp.cliente_id
 where cp.id = 'b08272ed-f696-4b18-819f-f2e0b3e100f4';
