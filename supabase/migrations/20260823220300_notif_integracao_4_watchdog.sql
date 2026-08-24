-- 23/08/2026 - Fila de integracao parada vira notificacao no sino, e o sino ganha a
-- categoria "integracao" (a terceira aba, so para admin).
--
-- POR QUE EXISTE
-- Linha morta na fila de sincronizacao so aparecia para quem abrisse a aba Fila. A DEM-0237
-- mediu o preco: um upsell de R$ 30 ficou 5 dias parado em 'invalido' sem avisar ninguem.
-- O Omie ganhou alerta em 12/08 ('omie_sync_falhou'), mas (a) in-app ele so chega a quem se
-- inscreveu em Configuracoes > Notificacoes e (b) o clique leva para a ficha do cliente, nao
-- para a linha da fila. O OEM, cuja fila nasceu em 21/08, nao tem alerta nenhum -- e a linha
-- morta some ate da ficha do cliente (fn_oem_pendencias_do_cliente nao lista 'invalido').
--
-- O QUE MUDA
--   1. notification_event_types.categoria aceita 'integracao'. E por ela que o sino monta a
--      terceira aba (Operacao | Sistema | Integracoes): o frontend le a categoria, nao uma
--      lista de chaves no codigo, entao evento novo de integracao cai na aba certa sozinho.
--   2. Todo evento dessa categoria e entregue in-app AOS ADMINS do tenant, sem inscricao.
--      Os admins entram POR CIMA da lista de inscritos, nao no lugar dela: quem ja recebia
--      (in-app ou WhatsApp) continua recebendo exatamente o que recebia.
--   3. O OEM ganha o gatilho de falha que o Omie ja tinha, e os dois ganham um watchdog de
--      fila que nao anda -- inclusive a linha zumbi em 'processando', que o proprio cron nao
--      enxerga (fn_oem_fila_claim marca 'processando' e nao mexe em proxima_tentativa_em; se
--      a edge function morrer no meio, a linha fica invisivel para todo mundo).
--   4. O clique na notificacao abre a fila certa, na linha do erro.
--
-- ATENCAO: AS DUAS FILAS USAM 'erro' COM SENTIDOS OPOSTOS (nao unificar sem ler isto)
--   omie_sync_fila: 'pendente' = vai tentar de novo | 'erro' e 'invalido' = TERMINAL.
--   oem_sync_fila:  'pendente' e 'erro' = vai tentar de novo | 'invalido' = TERMINAL.
--   Por isso o gatilho do OEM dispara so em 'invalido' e o do Omie continua disparando em
--   'erro'+'invalido'. Alertar no 'erro' do OEM seria avisar de algo que se conserta sozinho
--   2 minutos depois.
--
-- NAO MUDA: quiet hours, cooldown, dedupe, e o canal WhatsApp do Omie (fn_omie_wpp_extra
-- continua saindo pela lista de numeros da conta, sem passar por inscricao).
--
-- PARTE 4 - watchdog, agendamento e a consulta de conferencia.
-- Parte 4 de 4. Rode este arquivo inteiro, sozinho, no SQL Editor.
-- O deadlock de 23/08 aconteceu por rodar tudo de uma vez: ver o cabecalho da parte 1.

BEGIN;

-- ---------------------------------------------------------------------------
-- 7) Watchdog: a fila que NAO ANDA   [BLOCO 4 - so codigo]
--
-- Isto nao e "deu erro" -- e "ninguem tentou". Cobre os tres jeitos de uma linha ficar
-- invisivel:
--   a) processador parado (o cron nao dispara, ou dispara e a function nao responde);
--   b) linha em 'erro'/'pendente' cuja hora ja passou e ninguem reivindicou;
--   c) a zumbi: fn_oem_fila_claim marca 'processando' ANTES de chamar o parceiro e nao
--      mexe em proxima_tentativa_em. Se a edge function morrer no meio, a linha nao volta
--      para a fila, nao vira erro e nao aparece em alarme nenhum. So o relogio a denuncia.
--
-- Terminal ('invalido' no OEM, 'erro'/'invalido' no Omie) NAO entra aqui de proposito: ja
-- tem gatilho proprio, que avisa no instante em que acontece. Repetir de 12 em 12h um
-- backlog velho e como se ensina a ignorar alarme.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_integracao_fila_watchdog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_title text; v_body text; v_url text; v_rotulo text;
  v_vistos text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    WITH paradas AS (
      -- Omie: 'erro' e terminal, entao so 'pendente'/'processando' contam como "nao andou".
      SELECT 'omie'::text AS sistema, tenant_id, proxima_tentativa_em
        FROM public.omie_sync_fila
       WHERE status IN ('pendente', 'processando')
         AND proxima_tentativa_em <= now() - interval '30 minutes'
      UNION ALL
      -- OEM: 'erro' e retentativa, entao ele conta.
      SELECT 'oem'::text, tenant_id, proxima_tentativa_em
        FROM public.oem_sync_fila
       WHERE status IN ('pendente', 'erro', 'processando')
         AND proxima_tentativa_em <= now() - interval '30 minutes'
    )
    SELECT sistema, tenant_id, count(*) AS qtd, min(proxima_tentativa_em) AS mais_antiga
      FROM paradas
     GROUP BY sistema, tenant_id
  LOOP
    v_vistos := v_vistos || (r.tenant_id::text || '|' || r.sistema);
    v_rotulo := CASE r.sistema WHEN 'omie' THEN 'Omie' ELSE 'OEM' END;
    v_url := CASE r.sistema
               WHEN 'omie' THEN '/configuracoes?section=integracoes-omie&aba=conferencia'
               ELSE '/configuracoes?section=integracoes-oem&aba=fila'
             END;

    v_title := 'Fila do ' || v_rotulo || ' não está andando: ' || r.qtd || ' registro(s) esperando';
    v_body  := r.qtd || ' registro(s) na fila de sincronização do ' || v_rotulo
             || ' passaram da hora de serem enviados. O mais antigo espera desde '
             || to_char(r.mais_antiga AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.'
             || E'\n\nIsso não é erro de conteúdo: ninguém tentou enviar. Normalmente é o processador parado, '
             || 'ou uma linha que ficou presa em "enviando" quando o envio anterior morreu no meio.'
             || E'\n\n👉 O que fazer: abra a fila e use "Rodar agora". Se as linhas continuarem paradas, '
             || 'o processador não está sendo chamado.';

    PERFORM public.notify_event(
      r.tenant_id, 'integracao_fila_parada', r.sistema, v_title, v_body,
      jsonb_build_object('sistema', r.sistema, 'qtd', r.qtd, 'mais_antiga', r.mais_antiga),
      v_url);
  END LOOP;

  -- Fecha o incidente do que voltou a andar. Sem isto, o alerta so sumiria do painel de
  -- incidentes quando alguem o resolvesse na mao, e a proxima parada de verdade cairia no
  -- cooldown de um incidente velho -- ou seja, nao avisaria.
  FOR r IN
    SELECT i.tenant_id, i.dedupe_key
      FROM public.notification_incidents i
     WHERE i.event_type_key = 'integracao_fila_parada'
       AND i.resolved_at IS NULL
       AND NOT ((i.tenant_id::text || '|' || i.dedupe_key) = ANY(v_vistos))
  LOOP
    PERFORM public.resolve_notification_incident(r.tenant_id, 'integracao_fila_parada', r.dedupe_key);
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_integracao_fila_watchdog() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_integracao_fila_watchdog() TO service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- 8) Agendamento (fora da transacao de proposito: cron.schedule nao pertence ao schema
--    public e nao deve arrastar o resto no rollback se o pg_cron reclamar).
--    A cada 15 min. O limiar de 30 min esta dentro da funcao, entao mexer na cadencia
--    aqui nao muda o que conta como "parado".
-- ---------------------------------------------------------------------------
SELECT cron.schedule('integracao-fila-watchdog', '*/15 * * * *',
                     'SELECT public.fn_integracao_fila_watchdog();')
 WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'integracao-fila-watchdog');

-- ---------------------------------------------------------------------------
-- 9) Conferencia. Ultimo statement de proposito: e o resultado que o SQL Editor mostra.
--    Olhe o cooldown dos 3 eventos que ja existiam -- eles nasceram fora do repo e agora
--    passam a chegar a TODO admin. Cooldown curto num digest (omie_vinculo_ambiguo) vira
--    repeticao no sino de quem nunca pediu para receber.
-- ---------------------------------------------------------------------------
SELECT key,
       categoria,
       cooldown_minutes,
       ativo,
       whatsapp_extra_only,
       (SELECT count(*) FROM public.notification_subscriptions s
         WHERE s.event_type_key = t.key AND s.ativo) AS inscritos_hoje
  FROM public.notification_event_types t
 WHERE categoria = 'integracao'
 ORDER BY key;
