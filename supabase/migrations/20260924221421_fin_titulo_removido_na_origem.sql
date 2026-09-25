-- =============================================================================
-- Título que sumiu do ERP: carimbar em vez de esconder.
--
-- O DEFEITO, medido em 25/09/2026 na Digi Office: título apagado no Omie ganha
-- `excluido_em` no espelho do DoctorOMIE, e a `ds-omie-titulos-listar` PULA a
-- linha excluída. O conector nunca mais a vê, e o que nunca mais chega fica
-- parado em `fin_titulos` para sempre — com a situação, o vencimento e o boleto
-- do dia em que sumiu. Eram **218 zumbis**: a tabela tinha 1.120 títulos em
-- aberto e a view, 902.
--
-- Por que CARIMBAR e não apagar (decisão do Alexandre em 25/09): apagar deixa a
-- tabela limpa mas perde a resposta para "esse cliente tinha uma fatura que
-- sumiu do ERP em 23/09". O carimbo mantém o rastro; quem protege quem lê é a
-- view.
--
-- ⚠️ ORDEM DE ENTREGA: esta migration e o conector vão PRIMEIRO. Se a listagem
-- do DoctorOMIE passar a devolver os excluídos antes de o conector saber
-- tratá-los, ele os grava como ativos e ressuscita os zumbis com carimbo novo.
-- =============================================================================

alter table public.fin_titulos
  add column if not exists removido_na_origem_em timestamptz null;

comment on column public.fin_titulos.removido_na_origem_em is
  'Quando a origem informou que este título não existe mais no ERP. Preenchido = não cobre, não mostre como aberto. A linha fica para o histórico responder o que sumiu e quando.';

-- Índice parcial: a pergunta corrente é "quais NÃO foram removidos", e a
-- minoria removida é o que vale indexar.
create index if not exists idx_fin_titulos_removidos
  on public.fin_titulos (tenant_id, removido_na_origem_em)
  where removido_na_origem_em is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- A view passa a barrar o removido explicitamente
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Hoje ela já os exclui por acidente feliz: sem releitura, `visto_em` envelhece
-- e a guarda de idade os derruba. Mas isso é efeito colateral, não intenção —
-- e a partir de agora o removido volta a chegar com `visto_em` novo, então a
-- guarda de idade deixaria de pegá-lo. Sem esta linha, o conserto do zumbi
-- criaria um zumbi pior: recente, confirmado e inexistente.
--
-- `create or replace` funciona porque as colunas não mudam. Trocar a lista de
-- colunas exigiria drop + create e a re-emissão dos grants.
create or replace view public.vw_fin_titulos_abertos
with (security_invoker = true) as
  select t.id, t.tenant_id, t.origem, t.origem_conta_id, t.origem_id,
         t.cliente_id, t.origem_cliente_id, t.cnpj_cpf_digits,
         t.numero_documento, t.parcela, t.emissao, t.vencimento, t.valor,
         t.valor_pago, t.pago_em, t.situacao, t.situacao_origem,
         t.link_boleto, t.boleto_gerado, t.codigo_barras, t.pix_copia_cola,
         t.link_nfse, t.visto_em, t.origem_atualizado_em, t.raw,
         t.criado_em, t.atualizado_em, t.link_boleto_expira_em, t.numero_boleto,
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
