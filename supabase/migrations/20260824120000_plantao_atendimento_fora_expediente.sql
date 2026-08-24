-- ============================================================================
-- Plantão: identificar atendimento em que ALGUÉM TRABALHOU fora do expediente
--
-- Regra decidida pelo Alexandre em 24/08/2026, depois de medir três leituras
-- contra a base real (7 tenants com horário configurado, 20.361 atendimentos
-- em 90 dias):
--
--   A) abriu fora E fechou fora  ......  285 casos
--      76 deles (27%) são chat PARADO atravessando o fim de semana, com
--      ninguém trabalhando — duração média 37,7h. E perde 278 casos em que
--      um agente realmente atuou fora do horário. Mede quando o chat
--      EXISTIU, não quando alguém TRABALHOU. Descartada.
--
--   B) assumed_at / first_human_response_at fora  ......  487 casos
--      Sem falso positivo, mas enxerga metade: não vê o agente que assumiu
--      de dia e seguiu trabalhando às 22h.
--
--   C) B + qualquer mensagem enviada por usuário fora  ....  ESCOLHIDA
--      Na Digi Office (o exemplo que o Alexandre deu): 237 atendimentos e
--      664 mensagens fora do expediente em 90 dias. Só 21 no fim de semana —
--      o grosso é dia útil depois das 18h. A regra A pegaria 32 desses 237.
--
-- TOLERÂNCIA (30 min, padrão): sem ela o número é inútil. Medido na Digi
-- Office: dos 237, a maior parte é gente encostando na borda — a Amanda
-- Ferrari tem 183 mensagens "fora" que são 08:10 e 18:44 (janela 08:30–18:00).
-- Com 30 min de tolerância sobram 66 atendimentos; com 60 min, 44. É o Caua
-- às 23:16 e as 48 mensagens dele em fim de semana que a gente quer ver.
--
-- A tolerância vale sobre a JANELA DO DIA (primeiro início → último fim), não
-- sobre cada slot. Se valesse por slot, o intervalo de almoço da ASP
-- (12:00–13:30) viraria plantão no miolo: 12:45 está a mais de 30 min das duas
-- bordas internas. Trabalhar no almoço não é plantão.
--
-- Tenant SEM horário configurado nunca tem plantão — decisão explícita do
-- Alexandre. É o mesmo contrato de is_within_business_hours, que devolve true
-- quando o controle está desligado nos dois níveis.
--
-- is_within_business_hours NÃO é tocada: ela classifica tipo_horario dos
-- tickets e mexer nela reclassificaria ticket em produção.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1) Janela do dia: primeiro início e último fim do expediente naquela data
-- ----------------------------------------------------------------------------
-- Mesma cascata de is_within_business_hours (override de setor > global,
-- feriado com template > feriado fechado > dia normal), mas devolvendo as
-- BORDAS do dia em vez de um booleano — é o que permite aplicar tolerância.
--
-- (NULL, NULL) = dia sem expediente (fim de semana, feriado fechado).
-- ('00:00', '23:59:59') = controle desligado; o dia inteiro conta como dentro.
CREATE OR REPLACE FUNCTION public.fn_expediente_janela_do_dia(
  p_tenant_id     uuid,
  p_department_id uuid,
  p_at            timestamptz
) RETURNS TABLE (abre time, fecha time)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz           text;
  v_enabled      boolean;
  v_hours        jsonb;
  v_dept_enabled boolean := false;
  v_dept_hours   jsonb;
  v_local_date   date;
  v_local_dow    int;
  v_day_key      text;
  v_day          jsonb;
  v_exc          record;
  v_tpl          record;
BEGIN
  SELECT business_hours_timezone, business_hours_enabled, business_hours
    INTO v_tz, v_enabled, v_hours
  FROM public.configuracoes
  WHERE tenant_id = p_tenant_id;

  v_tz    := COALESCE(v_tz, 'America/Sao_Paulo');
  v_hours := COALESCE(v_hours, '{}'::jsonb);

  IF p_department_id IS NOT NULL THEN
    SELECT business_hours_enabled, business_hours
      INTO v_dept_enabled, v_dept_hours
    FROM public.support_departments
    WHERE id = p_department_id;

    IF COALESCE(v_dept_enabled, false) THEN
      v_hours := COALESCE(v_dept_hours, '{}'::jsonb);
    END IF;
  END IF;

  -- Controle desligado nos dois níveis: dia inteiro é "dentro", nunca plantão.
  IF NOT COALESCE(v_enabled, false) AND NOT COALESCE(v_dept_enabled, false) THEN
    RETURN QUERY SELECT '00:00'::time, '23:59:59'::time;
    RETURN;
  END IF;

  v_local_date := (p_at AT TIME ZONE v_tz)::date;
  v_local_dow  := extract(dow from (p_at AT TIME ZONE v_tz))::int;
  v_day_key    := (ARRAY['sun','mon','tue','wed','thu','fri','sat'])[v_local_dow + 1];

  SELECT is_closed, use_template
    INTO v_exc
  FROM public.business_hours_exceptions
  WHERE tenant_id = p_tenant_id
    AND date = v_local_date
    AND (department_id = p_department_id OR department_id IS NULL)
  ORDER BY (department_id IS NOT NULL) DESC
  LIMIT 1;

  IF COALESCE(v_exc.use_template, false) THEN
    SELECT open_at, close_at INTO v_tpl
    FROM public.tenant_holiday_template
    WHERE tenant_id = p_tenant_id;

    IF v_tpl.open_at IS NOT NULL AND v_tpl.close_at IS NOT NULL THEN
      RETURN QUERY SELECT v_tpl.open_at, v_tpl.close_at;
      RETURN;
    END IF;
  END IF;

  IF COALESCE(v_exc.is_closed, false) AND NOT COALESCE(v_exc.use_template, false) THEN
    RETURN QUERY SELECT NULL::time, NULL::time;
    RETURN;
  END IF;

  v_day := v_hours -> v_day_key;
  IF v_day IS NULL OR NOT COALESCE((v_day ->> 'active')::boolean, false) THEN
    RETURN QUERY SELECT NULL::time, NULL::time;
    RETURN;
  END IF;

  IF (v_day ? 'slots') AND jsonb_typeof(v_day -> 'slots') = 'array' THEN
    RETURN QUERY
      SELECT min((s ->> 'start')::time), max((s ->> 'end')::time)
      FROM jsonb_array_elements(v_day -> 'slots') s
      WHERE (s ->> 'start') IS NOT NULL AND (s ->> 'end') IS NOT NULL;
    RETURN;
  END IF;

  IF (v_day ? 'start') AND (v_day ? 'end') THEN
    RETURN QUERY SELECT (v_day ->> 'start')::time, (v_day ->> 'end')::time;
    RETURN;
  END IF;

  RETURN QUERY SELECT NULL::time, NULL::time;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_expediente_janela_do_dia(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_expediente_janela_do_dia(uuid, uuid, timestamptz)
  TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 2) Um instante caiu fora do expediente, além da tolerância?
-- ----------------------------------------------------------------------------
-- Aritmética em segundos e não em `time` de propósito: `'23:45'::time + 30min`
-- dá a volta em 00:15 e a comparação passa a marcar o dia inteiro como fora.
-- O clamp em [0, 86399] mata isso.
CREATE OR REPLACE FUNCTION public.fn_instante_fora_expediente(
  p_tenant_id      uuid,
  p_department_id  uuid,
  p_at             timestamptz,
  p_tolerancia_min int DEFAULT 30
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz    text;
  v_j     record;
  v_sec   numeric;
  v_ini   numeric;
  v_fim   numeric;
BEGIN
  IF p_at IS NULL THEN RETURN false; END IF;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo') INTO v_tz
  FROM public.configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  SELECT abre, fecha INTO v_j
  FROM public.fn_expediente_janela_do_dia(p_tenant_id, p_department_id, p_at);

  -- Dia sem expediente (fim de semana, feriado fechado): qualquer hora é fora.
  IF v_j.abre IS NULL THEN RETURN true; END IF;

  v_sec := extract(epoch from (p_at AT TIME ZONE v_tz)::time);
  v_ini := greatest(0,     extract(epoch from v_j.abre)  - (p_tolerancia_min * 60));
  v_fim := least  (86399,  extract(epoch from v_j.fecha) + (p_tolerancia_min * 60));

  RETURN v_sec < v_ini OR v_sec > v_fim;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_instante_fora_expediente(uuid, uuid, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_instante_fora_expediente(uuid, uuid, timestamptz, int)
  TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 3) A coluna
-- ----------------------------------------------------------------------------
-- NULL = ainda não avaliado (atendimento aberto, ou anterior ao backfill).
-- Não é `NOT NULL DEFAULT false` de propósito: false diria "não foi plantão",
-- que é afirmação diferente de "não sei".
ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS plantao boolean;

COMMENT ON COLUMN public.support_attendances.plantao IS
  'true = houve trabalho de agente fora do expediente (regra C, tolerância 30min). '
  'NULL = não avaliado. Gravado no fechamento por trg_zz_set_plantao. '
  'Tenant sem horário configurado nunca é plantão.';


-- ----------------------------------------------------------------------------
-- 4) Avaliação de um atendimento
-- ----------------------------------------------------------------------------
-- Recebe os campos soltos (e não o id) para servir tanto ao trigger — que tem
-- NEW.* na mão e não deve re-SELECTar a própria linha em BEFORE UPDATE —
-- quanto ao backfill.
--
-- A varredura de mensagens usa EXISTS: para na primeira que estiver fora, não
-- conta o total. Medido: ~0,5ms por atendimento.
CREATE OR REPLACE FUNCTION public.fn_atendimento_teve_plantao(
  p_tenant_id       uuid,
  p_department_id   uuid,
  p_conversation_id uuid,
  p_opened_at       timestamptz,
  p_closed_at       timestamptz,
  p_assumed_at      timestamptz,
  p_first_human_at  timestamptz,
  p_tolerancia_min  int DEFAULT 30
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_assumed_at, p_tolerancia_min)
  THEN RETURN true; END IF;

  IF public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_first_human_at, p_tolerancia_min)
  THEN RETURN true; END IF;

  IF p_conversation_id IS NULL OR p_opened_at IS NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.timestamp >= p_opened_at
      AND m.timestamp <= COALESCE(p_closed_at, now())
      AND m.sent_by_user_id IS NOT NULL
      AND public.fn_instante_fora_expediente(p_tenant_id, p_department_id, m.timestamp, p_tolerancia_min)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_atendimento_teve_plantao(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_atendimento_teve_plantao(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, int)
  TO authenticated, service_role;


-- ----------------------------------------------------------------------------
-- 5) Trigger: carimba no fechamento
-- ----------------------------------------------------------------------------
-- BEFORE UPDATE e não AFTER: AFTER precisaria de um UPDATE na própria tabela,
-- que dispararia os outros 26 triggers de support_attendances de novo.
--
-- O EXCEPTION é inegociável: fechar atendimento é caminho crítico do produto.
-- Se a avaliação falhar por qualquer motivo, a coluna fica NULL e o
-- fechamento segue. Um relatório nunca pode impedir um operador de fechar
-- um chat.
--
-- Nome com prefixo zz para rodar depois de trg_sync_attendance_department,
-- que ainda pode mudar NEW.department_id — e o setor decide qual horário vale.
--
-- Só 'closed': o CHECK support_attendances_status_check aceita apenas
-- waiting | in_progress | closed. 'inactive_closed' é de whatsapp_conversations;
-- vários triggers desta tabela repetem esse engano herdado e a cláusula fica
-- morta. Peguei isso no smoke test, quando o CHECK barrou a simulação.
CREATE OR REPLACE FUNCTION public.trg_set_attendance_plantao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    NEW.plantao := public.fn_atendimento_teve_plantao(
      NEW.tenant_id, NEW.department_id, NEW.conversation_id,
      NEW.opened_at, COALESCE(NEW.closed_at, now()),
      NEW.assumed_at, NEW.first_human_response_at
    );
  EXCEPTION WHEN OTHERS THEN
    NEW.plantao := NULL;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zz_set_plantao ON public.support_attendances;
CREATE TRIGGER trg_zz_set_plantao
  BEFORE UPDATE OF status ON public.support_attendances
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION public.trg_set_attendance_plantao();


-- ----------------------------------------------------------------------------
-- 6) Backfill — só as linhas true, de propósito
-- ----------------------------------------------------------------------------
-- support_attendances está na publication supabase_realtime: um UPDATE nas
-- 28.656 linhas viraria 28.656 eventos de fanout. E `session_replication_role`
-- é negado para o papel do MCP, então não dá para desligar os outros 26
-- triggers durante a carga.
--
-- Gravar só as 395 linhas `true` resolve os dois problemas de uma vez. Para o
-- filtro do dash, NULL e false se comportam igual ("não é plantão"); daqui pra
-- frente o gatilho grava os dois valores explicitamente.
--
-- As 208 linhas com department_id NULL cuja conversa AINDA tem setor ficam de
-- fora: nelas, sync_attendance_department (BEFORE UPDATE, sem lista de colunas)
-- herdaria o setor da conversa e mudaria a atribuição histórica do atendimento
-- em silêncio. Auditados os 26 triggers: os outros 25 são no-op num UPDATE que
-- só toca `plantao` (todos guardados por mudança de status, de cliente_id ou de
-- last_*_message_at), e trg_set_frt_business_seconds não recalcularia nenhuma
-- linha (0 casos com frt > 0 e first_response_business_seconds NULL).
WITH alvo AS (
  SELECT sa.id
  FROM public.support_attendances sa
  LEFT JOIN public.whatsapp_conversations c ON c.id = sa.conversation_id
  WHERE NOT (sa.department_id IS NULL AND c.department_id IS NOT NULL)
    AND public.fn_atendimento_teve_plantao(
          sa.tenant_id, sa.department_id, sa.conversation_id,
          sa.opened_at, sa.closed_at, sa.assumed_at, sa.first_human_response_at)
)
UPDATE public.support_attendances s
SET plantao = true
FROM alvo a
WHERE s.id = a.id AND s.plantao IS DISTINCT FROM true;


-- ----------------------------------------------------------------------------
-- 7) Índice para o filtro do dash
-- ----------------------------------------------------------------------------
-- Parcial: só as linhas de plantão (395 de 28.656 = 1,4%). O índice fica em
-- 32 kB e o custo de escrita é desprezível.
--
-- NÃO roda aqui: CREATE INDEX CONCURRENTLY não funciona dentro de transação.
-- Aplicado em produção via execute_sql em 24/08/2026:
--
--   create index concurrently if not exists idx_support_attendances_plantao
--     on public.support_attendances (tenant_id, opened_at)
--     where plantao;
