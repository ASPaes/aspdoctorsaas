-- DEM-0379 · Papel do responsável passa a seguir o setor da pessoa.
--
-- Problema: `transfer_onboarding_responsavel` grava o papel do novo responsável
-- com o slug fixo 'implantador'. Na Digi Office esse papel foi renomeado para
-- "Onboarding" (e o que eles chamam de "Implantador" é o slug 'especialista'),
-- então toda transferência jogava a pessoa em "Onboarding", fosse ela do setor
-- de Onboarding ou de Implantação. Medido em 09/09/2026: 88 participantes com
-- papel "Onboarding" sendo gente do setor Implantação.
--
-- O mapa pessoa -> setor já existe e está completo (`funcionarios.department_id`).
-- O que faltava era o elo setor -> papel, que entra aqui como uma coluna
-- opcional em `onboarding_participant_roles`. Sem mapeamento configurado, o
-- comportamento é exatamente o de hoje — os outros tenants não mudam nada.
--
-- Sem backfill: decisão do owner, vale só daqui pra frente.

-- ---------------------------------------------------------------- elo setor -> papel
ALTER TABLE public.onboarding_participant_roles
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES public.support_departments(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.onboarding_participant_roles.department_id IS
  'Setor cujos membros entram na jornada com este papel. NULL = papel nao e resolvido por setor.';

-- Um setor aponta para um papel só: senão a resolução seria ambígua.
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_participant_roles_tenant_dept_key
  ON public.onboarding_participant_roles (tenant_id, department_id)
  WHERE department_id IS NOT NULL;

-- ---------------------------------------------------------------- guarda do papel
-- Mesma função de antes, mais a checagem de que o setor escolhido é do próprio
-- tenant. Passa a valer também no INSERT — a FK sozinha aceitaria setor de outra
-- empresa.
CREATE OR REPLACE FUNCTION public.fn_guard_onboarding_participant_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.slug IS NOT NULL THEN
      RAISE EXCEPTION 'O papel padrão "%" não pode ser excluído.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.slug IS DISTINCT FROM NEW.slug THEN
      RAISE EXCEPTION 'O identificador interno do papel não pode ser alterado.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF OLD.slug IS NOT NULL AND NEW.ativo = false THEN
      RAISE EXCEPTION 'O papel padrão "%" não pode ser desativado.', OLD.nome
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.department_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.support_departments d
     WHERE d.id = NEW.department_id AND d.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'O setor escolhido não pertence a esta empresa.'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_onboarding_participant_role ON public.onboarding_participant_roles;
CREATE TRIGGER trg_guard_onboarding_participant_role
  BEFORE INSERT OR UPDATE OR DELETE ON public.onboarding_participant_roles
  FOR EACH ROW EXECUTE FUNCTION public.fn_guard_onboarding_participant_role();

-- ---------------------------------------------------------------- resolvedor
-- Papel da pessoa a partir do setor dela. NULL quando a pessoa não tem setor,
-- quando o setor não foi mapeado, ou quando o papel mapeado está inativo —
-- em todos esses casos quem chama decide o que fazer.
--
-- O setor sai de `funcionarios.department_id` (é onde a UI escreve) e cai para
-- `support_department_members` quando o perfil não tem funcionário vinculado.
CREATE OR REPLACE FUNCTION public.fn_onboarding_role_id_do_setor(
  p_tenant_id uuid,
  p_user_id   uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id
    FROM public.onboarding_participant_roles r
   WHERE r.tenant_id = p_tenant_id
     AND r.ativo
     AND r.department_id = COALESCE(
       (SELECT f.department_id
          FROM public.profiles p
          JOIN public.funcionarios f ON f.id = p.funcionario_id
         WHERE p.user_id = p_user_id AND p.tenant_id = p_tenant_id),
       (SELECT m.department_id
          FROM public.support_department_members m
         WHERE m.user_id = p_user_id AND m.tenant_id = p_tenant_id AND m.is_active
         ORDER BY m.created_at
         LIMIT 1)
     )
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fn_onboarding_role_id_do_setor(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_onboarding_role_id_do_setor(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_role_id_do_setor(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------- transferência
-- Base: definição de produção lida em 09/09/2026 (md5 cf212aab6fcf2953d7bc78bcc969c921).
-- Muda só o bloco do participante; o resto é idêntico.
CREATE OR REPLACE FUNCTION public.transfer_onboarding_responsavel(
  p_journey_id   uuid,
  p_novo_user_id uuid,
  p_motivo       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_ticket     uuid;
  v_atual      uuid;
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_nome_novo  text;
  v_nome_atual text;
  v_role_setor uuid;
  v_role_final uuid;
  v_role_slug  text;
  v_role_nome  text;
  v_role_antes text;
  v_qtd_linhas int;
  v_linha_id   uuid;
BEGIN
  SELECT j.tenant_id, j.ticket_id, j.responsavel_user_id
    INTO v_tenant, v_ticket, v_atual
    FROM public.onboarding_journeys j
   WHERE j.id = p_journey_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Jornada não encontrada.';
  END IF;

  IF NOT public.can_access_tenant_row(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta jornada.';
  END IF;

  IF v_motivo = '' THEN
    RAISE EXCEPTION 'O motivo da transferência é obrigatório.';
  END IF;

  IF p_novo_user_id IS NULL THEN
    RAISE EXCEPTION 'Informe o novo responsável.';
  END IF;

  IF p_novo_user_id = v_atual THEN
    RAISE EXCEPTION 'Este usuário já é o responsável pela jornada.';
  END IF;

  PERFORM 1 FROM public.profiles p
   WHERE p.user_id = p_novo_user_id AND p.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O usuário escolhido não pertence à empresa desta jornada.';
  END IF;

  SELECT f.nome INTO v_nome_novo
    FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE p.user_id = p_novo_user_id AND p.tenant_id = v_tenant;

  SELECT f.nome INTO v_nome_atual
    FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE p.user_id = v_atual AND p.tenant_id = v_tenant;

  -- fecha o período aberto (zero linhas se a jornada ainda não tinha responsável)
  UPDATE public.onboarding_responsavel_history
     SET ate = now()
   WHERE journey_id = p_journey_id AND ate IS NULL;

  INSERT INTO public.onboarding_responsavel_history
    (tenant_id, journey_id, user_id, de, motivo, transferido_por)
  VALUES
    (v_tenant, p_journey_id, p_novo_user_id, now(), v_motivo, auth.uid());

  UPDATE public.onboarding_journeys
     SET responsavel_user_id = p_novo_user_id,
         updated_at = now()
   WHERE id = p_journey_id;

  -- ---- papel do novo responsável (DEM-0379)
  v_role_setor := public.fn_onboarding_role_id_do_setor(v_tenant, p_novo_user_id);

  SELECT count(*) INTO v_qtd_linhas
    FROM public.onboarding_participants op
   WHERE op.ticket_id = v_ticket AND op.user_id = p_novo_user_id;

  IF v_qtd_linhas = 0 THEN
    -- Entra na equipe pelo papel do setor dela. Sem setor mapeado, cai no papel
    -- padrão de sempre.
    v_role_final := COALESCE(v_role_setor, public.fn_onboarding_role_id(v_tenant, 'implantador'));

    SELECT r.slug INTO v_role_slug
      FROM public.onboarding_participant_roles r WHERE r.id = v_role_final;

    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id, papel)
    VALUES (v_tenant, v_ticket, p_novo_user_id, v_role_final,
            CASE WHEN v_role_slug IS NULL THEN NULL
                 ELSE v_role_slug::public.onb_participante_papel END)
    ON CONFLICT DO NOTHING;

  ELSIF v_role_setor IS NOT NULL
    AND v_qtd_linhas = 1
    AND NOT EXISTS (
      SELECT 1 FROM public.onboarding_participants op
       WHERE op.ticket_id = v_ticket AND op.user_id = p_novo_user_id
         AND op.role_id = v_role_setor
    )
  THEN
    -- Já participava com outro papel: alinha ao setor. Só quando a pessoa tem
    -- UMA linha na jornada — quem acumula papéis foi arrumado a mão e não se
    -- mexe. E só quando o setor resolve: sem mapeamento, nada muda.
    SELECT op.id, r.nome INTO v_linha_id, v_role_antes
      FROM public.onboarding_participants op
      JOIN public.onboarding_participant_roles r ON r.id = op.role_id
     WHERE op.ticket_id = v_ticket AND op.user_id = p_novo_user_id
     LIMIT 1;

    SELECT r.nome, r.slug INTO v_role_nome, v_role_slug
      FROM public.onboarding_participant_roles r WHERE r.id = v_role_setor;

    IF v_linha_id IS NOT NULL THEN
      UPDATE public.onboarding_participants
         SET role_id = v_role_setor,
             papel   = CASE WHEN v_role_slug IS NULL THEN NULL
                            ELSE v_role_slug::public.onb_participante_papel END
       WHERE id = v_linha_id;

      INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
      VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_participante',
              'Papel ajustado pelo setor: ' || coalesce(v_nome_novo, 'usuário') ||
              ' · ' || coalesce(v_role_antes, '—') || ' → ' || v_role_nome);
    END IF;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (
    v_tenant, v_ticket, auth.uid(), 'onboarding_responsavel_transferido',
    'Responsável: ' || coalesce(v_nome_atual, 'sem responsável') ||
    ' → ' || coalesce(v_nome_novo, 'usuário') || ' · ' || v_motivo
  );

  RETURN jsonb_build_object(
    'ok', true,
    'responsavel_user_id', p_novo_user_id,
    'responsavel_nome', coalesce(v_nome_novo, 'usuário')
  );
END $$;

REVOKE ALL ON FUNCTION public.transfer_onboarding_responsavel(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_onboarding_responsavel(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_onboarding_responsavel(uuid, uuid, text) TO authenticated, service_role;
