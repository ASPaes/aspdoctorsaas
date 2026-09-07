-- DEM-0353 · Acompanhamento da pausa automática de inatividade
--
-- Mede pelas MENSAGENS, não pelas colunas novas: fn_clear_inactivity_hold_on_close
-- limpa inactivity_hold_until no fechamento, então o atendimento encerrado não
-- guarda rastro de ter sido pausado. Medir pela mensagem também é o que torna o
-- resultado comparável com a linha de base, que foi levantada do mesmo jeito
-- antes de a pausa existir.
--
-- LINHA DE BASE (30 dias até 07/09/2026, TODOS os tenants, pausa desligada),
-- medida com ESTA MESMA query, então é comparação direta:
--
--   grupo                    encerrados   voltou_2h   voltou_2h_pct
--   COM_AGUARDE (alvo)              126          40            31,7
--   SEM_AGUARDE (controle)        2.661         541            20,3
--
-- (Uma medição anterior deu 135/41/30,4% para o grupo alvo. A diferença é só o
-- padrão: aquela versão não tinha fronteira de palavra. Use os números acima.)
--
-- O que esperar se a pausa estiver funcionando: a coluna "voltou_2h_pct" da
-- linha COM_AGUARDE cai na direção da linha SEM_AGUARDE. Se ela não se mexer,
-- 30 min é pouco (ou o encerramento está vindo por outro caminho).
--
-- Ajuste as 2 primeiras linhas do WITH antes de rodar.
WITH parametros AS (
  SELECT
    now() - interval '7 days'  AS de,        -- início da janela
    now()                      AS ate,
    NULL::uuid                 AS p_tenant   -- NULL = todos; ou o id do tenant
),
fechados AS (
  SELECT a.id, a.conversation_id, a.closed_at, a.tenant_id
  FROM support_attendances a, parametros p
  WHERE a.closed_reason = 'inactivity'
    AND a.closed_at >= p.de AND a.closed_at < p.ate
    AND a.is_group = false
    AND (p.p_tenant IS NULL OR a.tenant_id = p.p_tenant)
),
-- Última mensagem visível da conversa antes do fechamento
ultima AS (
  SELECT f.id, f.tenant_id, f.conversation_id, f.closed_at,
         m.content, m.is_from_me, m.sent_by_user_id, m.metadata
  FROM fechados f
  LEFT JOIN LATERAL (
    SELECT m.* FROM whatsapp_messages m
    WHERE m.conversation_id = f.conversation_id
      AND m.timestamp <= f.closed_at
      AND m.deleted_at IS NULL
      AND COALESCE(m.message_type,'') NOT IN ('system','reaction','revoked')
      AND COALESCE(m.metadata->>'system','') <> 'true'
    ORDER BY m.timestamp DESC LIMIT 1
  ) m ON true
),
classificado AS (
  SELECT u.*,
    -- Mesma allowlist do gatilho: atendente pelo app OU pelo celular.
    --
    -- O padrão está INLINE, e não chamando fn_inactivity_autohold_match, de
    -- propósito: a função só tem EXECUTE para service_role, então a chamada
    -- falharia com "permission denied" em qualquer papel de leitura. A fonte de
    -- verdade continua sendo a função — se ela mudar, atualize aqui também,
    -- senão a medição deixa de refletir o que o gatilho faz.
    (u.is_from_me
     AND (u.sent_by_user_id IS NOT NULL OR u.metadata->>'source' = 'self_hosted')
     AND regexp_replace(lower(extensions.unaccent(COALESCE(u.content,''))), '\s+', ' ', 'g') ~
         '\yaguard|\y(um|so um|so)\s*(momento|momentinho|minuto|minutinho|instante|instantinho|segundo|segundinho)\y|\yja\s*(te\s*)?(retorno|retornamos|volto|respondo|verifico)\y|\y(vou|estou|tou?)\s+(verificar|verificando|checar|checando|analisar|analisando|consultar|consultando)\y'
    ) AS eh_aguarde,
    (SELECT min(m2.timestamp) FROM whatsapp_messages m2
      WHERE m2.conversation_id = u.conversation_id
        AND m2.timestamp > u.closed_at
        AND m2.deleted_at IS NULL
        AND COALESCE(m2.message_type,'') NOT IN ('system','reaction','revoked')
        AND COALESCE(m2.metadata->>'system','') <> 'true') AS voltou_em
  FROM ultima u
)
SELECT
  CASE WHEN eh_aguarde THEN 'COM_AGUARDE (alvo da feature)'
       ELSE 'SEM_AGUARDE (controle)' END AS grupo,
  count(*) AS encerrados,
  count(*) FILTER (WHERE voltou_em <= closed_at + interval '2 hours')  AS voltou_2h,
  round(100.0 * count(*) FILTER (WHERE voltou_em <= closed_at + interval '2 hours')
        / nullif(count(*),0), 1) AS voltou_2h_pct,
  count(*) FILTER (WHERE voltou_em <= closed_at + interval '30 min')   AS voltou_30min
FROM classificado
WHERE eh_aguarde IS NOT NULL
GROUP BY 1
ORDER BY 1;


-- ── Sinal ao vivo: a pausa está sendo aplicada? ─────────────────────────────
-- Rode logo depois de ligar o switch. Se vier vazio no meio do expediente, o
-- gatilho não está pegando (confira a flag do tenant e o horário).
--
-- SELECT t.nome AS tenant,
--        a.attendance_code,
--        a.inactivity_hold_reason AS motivo,
--        a.inactivity_hold_until  AS pausado_ate,
--        round(extract(epoch FROM (a.inactivity_hold_until - now()))/60.0, 1) AS faltam_min
-- FROM support_attendances a
-- JOIN tenants t ON t.id = a.tenant_id
-- WHERE a.inactivity_hold_until > now()
-- ORDER BY a.inactivity_hold_until;
