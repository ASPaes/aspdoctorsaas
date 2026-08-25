-- Espelha fn_instante_fora_expediente, mas contra a janela COMERCIAL e com
-- tolerância padrão de 5 min (os 30 min da outra existem para uma janela de
-- disponibilidade difusa; aqui apagariam o plantão das 18h).
-- Aritmética em SEGUNDOS com clamp em [0, 86399]: '23:45'::time + 30min daria a
-- volta em 00:15 e marcaria o dia inteiro como fora.
CREATE OR REPLACE FUNCTION public.fn_instante_fora_comercial(
  p_tenant_id      uuid,
  p_at             timestamptz,
  p_tolerancia_min integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tz  text;
  v_j   record;
  v_sec numeric;
  v_ini numeric;
  v_fim numeric;
BEGIN
  IF p_at IS NULL THEN RETURN false; END IF;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo') INTO v_tz
  FROM public.configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  SELECT abre, fecha INTO v_j
  FROM public.fn_janela_comercial_do_dia(p_tenant_id, p_at);

  IF v_j.abre IS NULL THEN RETURN true; END IF;

  v_sec := extract(epoch from (p_at AT TIME ZONE v_tz)::time);
  v_ini := greatest(0,    extract(epoch from v_j.abre)  - (p_tolerancia_min * 60));
  v_fim := least  (86399, extract(epoch from v_j.fecha) + (p_tolerancia_min * 60));

  RETURN v_sec < v_ini OR v_sec > v_fim;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_instante_fora_comercial(uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_instante_fora_comercial(uuid, timestamptz, integer) TO authenticated, service_role;
