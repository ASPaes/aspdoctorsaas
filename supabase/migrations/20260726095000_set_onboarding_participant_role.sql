-- Trocar o papel de um participante da jornada depois de inserido.
--
-- Quem pode (regra do owner, 26/07/2026): o responsável pela jornada, ou
-- admin/head do tenant. Super admin passa por bypass, como no resto do sistema.
-- A checagem vive aqui, não só na UI: a policy de UPDATE da tabela libera
-- qualquer membro do tenant, então gate só no front não seria gate nenhum.

CREATE OR REPLACE FUNCTION public.set_onboarding_participant_role(
  p_participant_id uuid,
  p_role_id        uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_ticket     uuid;
  v_user       uuid;
  v_role_atual uuid;
  v_journey    uuid;
  v_resp       uuid;
  v_role_nome  text;
  v_role_slug  text;
  v_role_ativo boolean;
  v_nome_antes text;
  v_nome_pessoa text;
  v_meu_role   text;
BEGIN
  SELECT op.tenant_id, op.ticket_id, op.user_id, op.role_id
    INTO v_tenant, v_ticket, v_user, v_role_atual
    FROM public.onboarding_participants op
   WHERE op.id = p_participant_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Participante não encontrado.';
  END IF;

  IF NOT public.can_access_tenant_row(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta jornada.';
  END IF;

  SELECT j.id, j.responsavel_user_id INTO v_journey, v_resp
    FROM public.onboarding_journeys j WHERE j.ticket_id = v_ticket;

  SELECT p.role INTO v_meu_role
    FROM public.profiles p WHERE p.user_id = auth.uid();

  IF NOT (
       public.is_super_admin()
    OR (v_resp IS NOT NULL AND v_resp = auth.uid())
    OR coalesce(v_meu_role, '') IN ('admin', 'head')
  ) THEN
    RAISE EXCEPTION 'Só o responsável pela jornada, um admin ou um head podem mudar o papel de um participante.';
  END IF;

  SELECT r.nome, r.slug, r.ativo INTO v_role_nome, v_role_slug, v_role_ativo
    FROM public.onboarding_participant_roles r
   WHERE r.id = p_role_id AND r.tenant_id = v_tenant;

  IF v_role_nome IS NULL THEN
    RAISE EXCEPTION 'Papel não encontrado nesta empresa.';
  END IF;
  IF NOT v_role_ativo THEN
    RAISE EXCEPTION 'O papel "%" está inativo e não pode ser atribuído.', v_role_nome;
  END IF;

  IF v_role_atual = p_role_id THEN
    RETURN jsonb_build_object('ok', true, 'inalterado', true, 'papel_nome', v_role_nome);
  END IF;

  -- A mesma pessoa não pode ocupar dois papéis na mesma jornada.
  IF EXISTS (
    SELECT 1 FROM public.onboarding_participants outra
     WHERE outra.ticket_id = v_ticket
       AND outra.user_id = v_user
       AND outra.role_id = p_role_id
  ) THEN
    RAISE EXCEPTION 'Esta pessoa já participa da jornada como "%".', v_role_nome;
  END IF;

  SELECT r.nome INTO v_nome_antes
    FROM public.onboarding_participant_roles r WHERE r.id = v_role_atual;

  -- `papel` (coluna legada) acompanha: enquanto ela existir para rollback,
  -- não pode contradizer o role_id.
  UPDATE public.onboarding_participants
     SET role_id = p_role_id,
         papel   = CASE WHEN v_role_slug IS NULL THEN NULL
                        ELSE v_role_slug::public.onb_participante_papel END
   WHERE id = p_participant_id;

  SELECT f.nome INTO v_nome_pessoa
    FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE p.user_id = v_user AND p.tenant_id = v_tenant;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_participante',
          'Papel alterado: ' || coalesce(v_nome_pessoa, 'usuário') ||
          ' · ' || coalesce(v_nome_antes, '—') || ' → ' || v_role_nome);

  RETURN jsonb_build_object('ok', true, 'inalterado', false, 'papel_nome', v_role_nome);
END $$;

REVOKE ALL ON FUNCTION public.set_onboarding_participant_role(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_onboarding_participant_role(uuid, uuid) TO authenticated, service_role;
