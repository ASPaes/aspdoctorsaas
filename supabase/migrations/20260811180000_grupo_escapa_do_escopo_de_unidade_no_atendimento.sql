-- 11/08/2026 -- terceiro e ultimo degrau do "grupo em atendimento aparece como
-- encerrado para quem nao e do setor".
--
-- O 20260811170000 deu ao atendimento a mesma excecao de grupo que a conversa
-- tem na policy PERMISSIVA. Nao bastou: support_attendances tem tambem as
-- policies RESTRITIVAS de unidade, e restritiva e AND -- ela anula a perna nova
-- para todo usuario com unidade restrita.
--
-- Medido em producao (11/08/2026): dos 26 atendimentos ativos em conversa de
-- grupo, TODOS os 26 estao com unidade_base_id preenchida. A hipotese de que
-- grupo nao teria unidade (por nao ter cliente vinculado) estava errada.
--
-- whatsapp_conversations ja resolve isso ha tempos -- as policies de unidade
-- dela comecam com "is_group OR". As de support_attendances nao. Mesma
-- assimetria da anterior, um andar abaixo.
--
-- SELECT e UPDATE juntos, de proposito: so o SELECT entregaria a UI quebrada --
-- o operador passa a VER o atendimento do grupo e continua sem conseguir
-- assumir ou encerrar, porque a escrita cai na restritiva de UPDATE. "O botao
-- nao faz nada" e pior que "nao aparece".
--
-- DELETE fica de fora: a policy permissiva de delete ja exige admin/head, entao
-- a restritiva nao e o que segura ninguem ali.
--
-- As duas expressoes abaixo sao as de producao (conferidas em 11/08/2026) com
-- "is_group OR" na frente -- exatamente a forma que whatsapp_conversations usa.

ALTER POLICY unidade_scope_select ON public.support_attendances
  USING (
    is_group
    OR (
      (
        (SELECT public.is_super_admin())
        OR ((SELECT public.user_allowed_unidades()) IS NULL)
        OR (unidade_base_id IS NULL)
        OR (unidade_base_id = ANY ((SELECT public.user_allowed_unidades())::bigint[]))
      )
      AND (
        ((SELECT public.user_view_unidades()) IS NULL)
        OR (unidade_base_id IS NULL)
        OR (unidade_base_id = ANY ((SELECT public.user_view_unidades())::bigint[]))
      )
    )
  );

ALTER POLICY unidade_scope_update ON public.support_attendances
  USING       (is_group OR public.unidade_allowed(unidade_base_id))
  WITH CHECK  (is_group OR public.unidade_allowed(unidade_base_id));

-- Quantos usuarios a restritiva realmente prendia.
--
-- user_allowed_unidades() so devolve NULL (= sem restricao) quando
-- profiles.acesso_todas_unidades e true. Com false ela devolve o ARRAY de
-- profile_unidades -- e se esse array estiver VAZIO, nenhuma comparacao casa e o
-- usuario nao ve atendimento nenhum com unidade preenchida. Por isso a conta e
-- por acesso_todas_unidades, nao por "tem linha em profile_unidades".
SELECT
  count(*) FILTER (WHERE COALESCE(p.acesso_todas_unidades, false) = false)
    AS usuarios_com_unidade_restrita,
  count(*) FILTER (
    WHERE COALESCE(p.acesso_todas_unidades, false) = false
      AND NOT EXISTS (SELECT 1 FROM public.profile_unidades u WHERE u.user_id = p.user_id)
  ) AS destes_sem_nenhuma_unidade_atribuida,
  count(*) AS total_profiles
FROM public.profiles p;
