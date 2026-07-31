-- Uma linha por cartão de treinamento do quadro da Implantação.
--
-- Etapa 4 de 7 do design em
-- docs/superpowers/specs/2026-07-31-onboarding-subtickets-treinamento-por-responsavel-design.md
--
-- security_invoker = true é obrigatório e precisa estar EM TODO CREATE OR REPLACE:
-- recriar a view sem a cláusula descarta a opção em silêncio e a view passa a rodar
-- com os direitos do dono, furando o RLS por tenant.

CREATE OR REPLACE VIEW public.vw_onboarding_training_cards
WITH (security_invoker = true) AS
SELECT
  t.id                                        AS training_id,
  t.tenant_id,
  t.journey_id,
  t.ticket_id,
  tk.ticket_code,
  tk.sub_seq,
  pai.id                                      AS parent_ticket_id,
  pai.ticket_code                             AS parent_ticket_code,
  t.titulo,
  t.status::text                              AS status,
  t.agendado_para,
  t.realizado_em,
  t.tentativas,
  t.no_show,
  t.is_retreinamento,
  t.link_agendamento,
  t.current_stage_id,
  t.conduzido_por,
  f.nome                                      AS conduzido_por_nome,
  t.training_type_id,
  tt.nome                                     AS training_type_nome,
  j.cliente_id,
  COALESCE(c.nome_fantasia, c.razao_social)   AS cliente_nome,
  c.unidade_base_id                           AS cliente_unidade_id,
  j.situacao::text                            AS journey_situacao,
  j.demand_type_id,
  dt.nome                                     AS demand_type_nome,
  dt.cor                                      AS demand_type_cor,
  h.entrou_em                                 AS etapa_entrou_em,
  t.created_at
FROM public.onboarding_training_sessions t
JOIN public.support_tickets tk               ON tk.id = t.ticket_id
LEFT JOIN public.support_tickets pai         ON pai.id = tk.parent_ticket_id
JOIN public.onboarding_journeys j            ON j.id = t.journey_id
LEFT JOIN public.clientes c                  ON c.id = j.cliente_id
LEFT JOIN public.onboarding_training_types tt ON tt.id = t.training_type_id
LEFT JOIN public.onboarding_demand_types dt  ON dt.id = j.demand_type_id
LEFT JOIN public.profiles p                  ON p.user_id = t.conduzido_por
LEFT JOIN public.funcionarios f              ON f.id = p.funcionario_id
LEFT JOIN LATERAL (
  SELECT hh.entrou_em
    FROM public.onboarding_training_stage_history hh
   WHERE hh.training_id = t.id AND hh.saiu_em IS NULL
   ORDER BY hh.entrou_em DESC
   LIMIT 1
) h ON true
WHERE t.deleted_at IS NULL;

COMMENT ON VIEW public.vw_onboarding_training_cards IS
  'Cartões do quadro da Implantação: um por sub-ticket de treinamento vivo, com código derivado, responsável que conduz, tipo, cliente e etapa atual.';

GRANT SELECT ON public.vw_onboarding_training_cards TO authenticated, service_role;
