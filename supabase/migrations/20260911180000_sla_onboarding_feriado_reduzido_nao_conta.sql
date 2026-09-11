-- SLA do Onboarding/Implantacao: feriado em "horario reduzido" nao conta.
--
-- Relato DigiOffice (11/09/2026): 07/09 foi feriado e o SLA dos tickets de onboarding contou
-- o dia inteiro, como uma segunda normal.
--
-- Causa: a DigiOffice cadastrou os feriados de 01/01 a 07/09 como "Horario reduzido"
-- (is_closed=false, use_template=true -> plantao das 09h as 22h no WhatsApp).
-- segundos_uteis() so pula o dia quando is_closed=true; nos demais casos usa a grade
-- semanal normal, entao o feriado contou 08:00-18:00. Os outros tenants cadastraram 07/09
-- como "Fechado" e pausaram certo.
--
-- Regra: o horario reduzido de feriado e plantao de atendimento, nao expediente de
-- implantacao. Para o SLA de onboarding, feriado reduzido = dia fechado.
-- "Aberto" (is_closed=false, use_template=false) continua contando normalmente.
--
-- segundos_uteis() NAO muda: ela tambem mede o 1o tempo de resposta do WhatsApp e o
-- encerramento por falta de resposta do agente, onde o plantao e horario de trabalho.
-- Aqui so se desconta, do total, o que ela contou dentro de cada feriado reduzido.
-- Sem expediente configurado (fallback de tempo corrido) nada e descontado, igual ao
-- feriado fechado nesse modo.

CREATE OR REPLACE FUNCTION public.fn_onb_util_min(
  p_start timestamptz,
  p_end timestamptz,
  p_tenant_id uuid,
  p_department_id uuid
) RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH tz AS (
    SELECT COALESCE(
      (SELECT business_hours_timezone FROM public.configuracoes WHERE tenant_id = p_tenant_id),
      'America/Sao_Paulo') AS v
  ), tem_expediente AS (
    -- mesma cascata de segundos_uteis: setor -> global do tenant
    SELECT EXISTS (
             SELECT 1 FROM public.support_departments
              WHERE id = p_department_id AND tenant_id = p_tenant_id
                AND business_hours_enabled = true AND business_hours IS NOT NULL)
        OR EXISTS (
             SELECT 1 FROM public.configuracoes
              WHERE tenant_id = p_tenant_id
                AND business_hours_enabled = true AND business_hours IS NOT NULL) AS v
  ), reduzido AS (
    SELECT GREATEST(p_start, e.date::timestamp AT TIME ZONE tz.v)      AS ini,
           LEAST(p_end, (e.date + 1)::timestamp AT TIME ZONE tz.v)     AS fim
      FROM public.business_hours_exceptions e, tz, tem_expediente x
     WHERE x.v
       AND e.tenant_id = p_tenant_id
       AND e.use_template = true
       AND e.is_closed = false
       AND (e.department_id = p_department_id OR e.department_id IS NULL)
       AND e.date BETWEEN (p_start AT TIME ZONE tz.v)::date AND (p_end AT TIME ZONE tz.v)::date
  )
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN 0
    ELSE (GREATEST(0,
            public.segundos_uteis(p_start, p_end, p_tenant_id, p_department_id)
            - COALESCE((SELECT SUM(public.segundos_uteis(r.ini, r.fim, p_tenant_id, p_department_id))
                          FROM reduzido r), 0)
          ) / 60)::integer
  END;
$function$;

COMMENT ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid) IS
  'Minutos de expediente entre dois instantes, para o setor informado. 0 quando o intervalo e nulo ou invertido. Fallback de segundos_uteis: setor -> global do tenant -> tempo corrido. Feriado em horario reduzido (use_template) conta como fechado: plantao nao e expediente de onboarding.';

-- CREATE OR REPLACE preserva os grants; reafirmados por garantia.
REVOKE ALL ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_onb_util_min(timestamptz, timestamptz, uuid, uuid)
  TO authenticated, service_role;
