-- 11/08/2026 -- grupo EM ATENDIMENTO aparecia como "Encerrado" / "Sem atendimento"
-- para quem nao e do setor do grupo.
--
-- Mesma familia do 20260811160000 (conversa sem setor + atendimento com setor),
-- mas por um caminho que aquele fix nao cobre -- e nem deveria: em grupo a
-- conversa TEM setor (fn_group_conversation_department copia de
-- whatsapp_groups.department_id). O problema esta nas policies:
--
--   whatsapp_conversations_select -> ... OR (tenant_id = meu AND is_group = true)
--   support_attendances_select    -> nao tem essa terceira perna
--
-- Ou seja: a conversa de grupo e visivel para o TENANT INTEIRO e o atendimento
-- dela so para o setor do grupo. Como whatsapp_list_conversations e SECURITY
-- INVOKER, o LATERAL do atendimento volta vazio para os demais, sa.status fica
-- NULL e wa_conversation_bucket carimba 'closed' numa conversa 'active'.
--
-- Medido em producao (11/08/2026): 26 atendimentos ativos em conversa de grupo,
-- dos quais 5 com department_id preenchido -- todos na Digi Office. Os outros 21
-- estao com department_id NULL, que a policy ja libera para o tenant inteiro,
-- entao nao sofriam o defeito.
--
-- Correcao: dar ao atendimento a MESMA excecao de grupo que a conversa ja tem.
-- Principio: quem enxerga a conversa tem de enxergar o atendimento dela, senao
-- ausencia de permissao vira "encerrado" na tela.

-- 1) Flag is_group nos atendimentos ativos ---------------------------------
-- A policy abaixo le support_attendances.is_group (coluna da propria tabela, sem
-- subquery -- EXISTS na conversa dentro de RLS seria avaliado por linha, que e o
-- padrao que ja transformou uma RPC de 32 ms em 4,11 s). Entao a flag precisa
-- estar certa antes da policy valer.
--
-- So os ATIVOS: em atendimento encerrado a flag errada nao causa o defeito (o
-- bucket ja e 'closed' para todo mundo) e mexer no historico dispararia
-- fn_track_awaiting_agent e fn_reset_inactivity_warning em centenas de linhas
-- por nada. Medido: 3 linhas ativas sem a flag.
--
-- O SQL Editor nao mostra contagem de UPDATE; o RETURNING devolve o numero.
WITH upd AS (
  UPDATE public.support_attendances s
  SET is_group = true
  FROM public.whatsapp_conversations c
  WHERE c.id = s.conversation_id
    AND c.is_group   = true
    AND s.is_group  IS NOT TRUE
    AND s.status IN ('waiting', 'in_progress')
  RETURNING 1
)
SELECT count(*) AS flags_corrigidas FROM upd;

-- 2) Policy -----------------------------------------------------------------
-- ALTER, nao DROP + CREATE: sem policy permissiva a tabela nega TUDO, e um
-- DROP/CREATE em statements separados no SQL Editor abre exatamente essa janela
-- (cada statement e sua propria transacao). O ALTER troca a expressao sem
-- momento nenhum de tabela descoberta.
--
-- A expressao abaixo e a de producao (conferida em 11/08/2026) mais a terceira
-- perna, escrita na mesma forma de whatsapp_conversations_select para as duas
-- serem reconheciveis lado a lado.
ALTER POLICY support_attendances_select ON public.support_attendances
  USING (
    (SELECT public.is_admin_or_head())
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND (
        department_id = (SELECT public.current_user_department_id())
        OR department_id IS NULL
      )
    )
    OR (
      tenant_id = (SELECT public.current_tenant_id())
      AND is_group = true
    )
  );

COMMENT ON POLICY support_attendances_select ON public.support_attendances IS
  'Espelha whatsapp_conversations_select: setor, setor NULL, ou grupo. A perna de '
  'grupo existe porque a conversa de grupo e visivel ao tenant inteiro; sem ela o '
  'atendimento sumia para os outros setores e wa_conversation_bucket carimbava '
  'closed numa conversa ativa (11/08/2026).';

-- 3) Medicao do degrau seguinte, NAO corrigido aqui --------------------------
-- support_attendances tem tambem a policy RESTRITIVA unidade_scope_select, e ela
-- NAO tem a excecao de grupo que a versao de whatsapp_conversations tem
-- ("is_group OR (...)"). Restritiva e AND: se sobrar atendimento de grupo com
-- unidade_base_id preenchida, ele continua escondido mesmo com a perna acima.
--
-- Em tese nao morde: unidade_base_id vem do cliente (trg_sync_unidade_from_cliente)
-- e grupo normalmente nao tem cliente vinculado. Em tese. O numero manda.
SELECT count(*) AS grupos_ativos_ainda_presos_pela_unidade
FROM public.support_attendances s
JOIN public.whatsapp_conversations c ON c.id = s.conversation_id
WHERE c.is_group = true
  AND s.status IN ('waiting', 'in_progress')
  AND s.unidade_base_id IS NOT NULL;
