-- =============================================================================
-- Financeiro — a trava de frescor passa a ser por situação.
--
-- POR QUE MUDA. A trava original era uma só: "o título tem de ter sido
-- reconfirmado pela origem na última leitura". Ela depende de a origem varrer
-- aquele conjunto inteiro a cada ciclo — e o leitor do Omie varre `ATRASADO` e
-- `VENCE HOJE`, mas não `A VENCER`. O incremental só reconfirma o que mudou,
-- então todo título a vencer ficava invisível: a régua não teria como mandar
-- lembrete de pré-vencimento, que é a primeira etapa de qualquer régua.
--
-- Tentamos incluir `A VENCER` na varredura do leitor em 22/09/2026 e o Omie
-- recusa a primeira página, de forma reproduzível, com "Já existe uma requisição
-- desse método sendo executada" — enquanto o mesmo pedido, feito por fora,
-- responde 200. Três publicações depois, sem causa encontrada, a decisão passou
-- a ser esta, que não depende daquilo.
--
-- A REGRA NOVA, e o raciocínio de risco por trás dela:
--   • vencido e vence hoje  -> trava RÍGIDA (reconfirmado na última leitura).
--     É aqui que o estrago mora: cobrar alguém por documento que o ERP apagou.
--     Medido em produção no mesmo dia: 10 títulos fantasma, R$ 3.633,38, que
--     esta trava barrou.
--   • a vencer              -> trava FROUXA (visto nos últimos 7 dias).
--     O pior caso é um lembrete de pré-vencimento para um título que acabou de
--     ser apagado no ERP. Chato, e muito menos grave que cobrar dívida
--     inexistente. E no dia em que ele vence, a trava rígida volta a valer.
-- =============================================================================

-- DROP antes de criar, e não `create or replace`: a view usa `t.*` e a tabela
-- ganhou colunas depois que ela nasceu (link_boleto_expira_em, numero_boleto).
-- O `replace` não aceita mudança na lista de colunas e falha com "cannot change
-- name of view column". Como o DROP leva os grants junto, eles voltam no fim.
drop view if exists public.vw_fin_titulos_abertos;

create view public.vw_fin_titulos_abertos
with (security_invoker = true) as
select
  t.*,
  (t.vencimento < current_date) as vencido,
  greatest(0, current_date - t.vencimento) as dias_atraso
from public.fin_titulos t
join public.fin_sync_estado e
  on e.tenant_id = t.tenant_id
 and e.origem = t.origem
where t.situacao in ('a_vencer', 'vence_hoje', 'atrasado')
  and e.ultima_leitura_ok is not null
  and (
    -- A margem de 10 minutos existe porque a leitura demora: o título lido no
    -- começo de uma varredura de 4 minutos tem carimbo anterior ao fim dela.
    (
      t.situacao in ('atrasado', 'vence_hoje')
      and t.visto_em >= e.ultima_leitura_ok - interval '10 minutes'
    )
    or (
      t.situacao = 'a_vencer'
      and t.visto_em >= e.ultima_leitura_ok - interval '7 days'
    )
  );

comment on view public.vw_fin_titulos_abertos is
  'Títulos em aberto que a régua pode cobrar. Vencido e vence hoje só entram se a origem reconfirmou na última leitura (é o que impede cobrar por documento apagado no ERP); a vencer entra se foi visto nos últimos 7 dias, porque a origem não varre esse conjunto inteiro a cada ciclo.';

-- Grants de volta (o DROP levou os antigos). `authenticated` só lê; quem escreve
-- é o conector, com service_role. Revogar de `authenticated` de forma explícita:
-- revogar de PUBLIC não restringe nada neste projeto.
revoke all on public.vw_fin_titulos_abertos from anon, authenticated;
grant select on public.vw_fin_titulos_abertos to authenticated, service_role;
