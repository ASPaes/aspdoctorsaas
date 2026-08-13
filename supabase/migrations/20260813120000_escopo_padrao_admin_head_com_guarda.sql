-- Escopo padrão por papel + guarda de último recurso (13/08/2026).
--
-- Medido em 7 dias: 70% do que admin/head recebem é trabalho deles (chat próprio
-- e fila do setor em que estão inscritos). O que sobra de ruído é a fila dos
-- outros. Quem nunca configurou notification_scope caía em 'all'; passa a cair em
-- 'mine_only' se for admin/head.
--
-- A GUARDA existe porque a mudança sozinha abre um buraco: 16 setores ativos são
-- compostos SÓ de admin/head e ficariam com zero destinatário de fila — entre eles
-- CTM "Suporte SG/RJK/RHID" (403 atendimentos/30d), Digi Office "Onboarding" (565),
-- ASP "Financeiro" (308). Medido por support_attendances.queued_at (o status não
-- serve, quem foi atendido não está mais 'waiting'): 225 atendimentos em 30 dias
-- passaram pela fila nesses setores.
--
-- Regra: a preferência nunca pode zerar a fila. Se o filtro deixar o degrau vazio,
-- o filtro é ignorado NAQUELE degrau. Por degrau, não global — setor com operador
-- não desce para o fallback só porque os admins dele estão em mine_only.
--
-- Mudança estrutural em relação ao corpo anterior: os degraus de setor e de
-- fallback passam a terminar com RETURN explícito. Antes o último degrau vivia
-- dentro de um ELSE; agora ele é o caminho de saída comum, e sem o RETURN a
-- função devolveria o tenant inteiro junto com o setor.
--
-- ETAPA 2 (monitores) fica intacta: lá o mine_only já significa "só me mostre o
-- que é meu" e não há fila para zerar.
CREATE OR REPLACE FUNCTION public.get_message_notification_recipients_v2(p_conversation_id uuid)
 RETURNS TABLE(user_id uuid, silent_mode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_assigned_to uuid;
  v_department_id uuid;
  v_fallback_dept_id uuid;
  v_count int;
  v_scoped int;
BEGIN
  SELECT conv.tenant_id, conv.assigned_to, conv.department_id
    INTO v_tenant_id, v_assigned_to, v_department_id
  FROM public.whatsapp_conversations conv
  WHERE conv.id = p_conversation_id;

  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- ETAPA 1: recipients OPERACIONAIS (silent_mode = false)
  IF v_assigned_to IS NOT NULL THEN
    -- Chat com dono: só ele. Escopo não entra aqui — o próprio chat nunca é
    -- silenciado por preferência de fila.
    RETURN QUERY SELECT v_assigned_to, false;

  ELSIF v_department_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM public.support_department_members
    WHERE department_id = v_department_id AND is_active = true;

    IF v_count > 0 THEN
      SELECT COUNT(*) INTO v_scoped
      FROM public.support_department_members sdm
      JOIN public.profiles p ON p.user_id = sdm.user_id
      LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
      WHERE sdm.department_id = v_department_id AND sdm.is_active = true
        AND COALESCE(up.notification_scope,
              CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

      RETURN QUERY
      SELECT sdm.user_id, false
      FROM public.support_department_members sdm
      JOIN public.profiles p ON p.user_id = sdm.user_id
      LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
      WHERE sdm.department_id = v_department_id AND sdm.is_active = true
        AND (v_scoped = 0  -- guarda: ninguém sobrou, o filtro é ignorado
             OR COALESCE(up.notification_scope,
                  CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');
      RETURN;
    END IF;

    SELECT id INTO v_fallback_dept_id
    FROM public.support_departments
    WHERE tenant_id = v_tenant_id AND is_default_fallback = true AND is_active = true
    LIMIT 1;

    IF v_fallback_dept_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_count
      FROM public.support_department_members
      WHERE department_id = v_fallback_dept_id AND is_active = true;

      IF v_count > 0 THEN
        SELECT COUNT(*) INTO v_scoped
        FROM public.support_department_members sdm
        JOIN public.profiles p ON p.user_id = sdm.user_id
        LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
        WHERE sdm.department_id = v_fallback_dept_id AND sdm.is_active = true
          AND COALESCE(up.notification_scope,
                CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

        RETURN QUERY
        SELECT sdm.user_id, false
        FROM public.support_department_members sdm
        JOIN public.profiles p ON p.user_id = sdm.user_id
        LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
        WHERE sdm.department_id = v_fallback_dept_id AND sdm.is_active = true
          AND (v_scoped = 0
               OR COALESCE(up.notification_scope,
                    CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Último degrau: tenant inteiro. É ele que produz o estouro medido (34
  -- notificações para 17 pessoas em 7 dias). Mantido como rede de segurança por
  -- decisão de 13/08; encolher esse degrau é entrega futura.
  SELECT COUNT(*) INTO v_scoped
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('user','head','admin') AND p.access_status = 'active'
    AND COALESCE(up.notification_scope,
          CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

  RETURN QUERY
  SELECT p.user_id, false
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('user','head','admin') AND p.access_status = 'active'
    AND (v_scoped = 0
         OR COALESCE(up.notification_scope,
              CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');

  -- ETAPA 2: MONITORES (silent_mode = true) — inalterada
  RETURN QUERY
  SELECT p.user_id, true
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('admin','head') AND p.access_status = 'active'
    AND p.user_id NOT IN (
      SELECT u FROM (
        SELECT v_assigned_to AS u WHERE v_assigned_to IS NOT NULL
        UNION
        SELECT sdm.user_id FROM public.support_department_members sdm
         WHERE sdm.department_id = v_department_id AND sdm.is_active = true
        UNION
        SELECT sdm.user_id FROM public.support_department_members sdm
         WHERE sdm.department_id = v_fallback_dept_id AND sdm.is_active = true
           AND v_fallback_dept_id IS NOT NULL
      ) sub
    )
    AND (
      COALESCE(up.notification_scope, 'all') = 'all'
      OR (COALESCE(up.notification_scope, 'all') = 'my_departments'
          AND v_department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.support_department_members sdm2
            WHERE sdm2.user_id = p.user_id AND sdm2.department_id = v_department_id
              AND sdm2.is_active = true))
      OR (COALESCE(up.notification_scope, 'all') = 'mine_only' AND v_assigned_to = p.user_id)
    );
END;
$function$;
