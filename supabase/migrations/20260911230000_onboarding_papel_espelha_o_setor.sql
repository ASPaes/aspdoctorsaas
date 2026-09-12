-- DEM-0379, parte 3. O papel do responsável passa a ser o setor da pessoa, sempre.
--
-- Por que mudou de novo: as partes 1 e 2 exigiam ligar cada setor a um papel na mão.
-- Medido em 11/09/2026, o mapa da Digi Office cobria 10 das 40 pessoas ativas; as
-- outras 30 (Comercial, Suporte, Suporte Gula, Diretoria, Administrativo) caíam no
-- papel padrão. Foi o que aconteceu na transferência do Vinicius para o Fabricio:
-- os dois são de Suporte Gula, setor sem papel, e o papel ficou "Onboarding".
-- No total eram 53 setores ativos sem papel, em 12 tenants.
--
-- Decisão do owner: acabar com a configuração. O papel do responsável é o setor
-- dele, e o papel nasce sozinho na primeira vez que alguém daquele setor recebe uma
-- jornada. Não existe mais estado "mapa vazio", que foi o que deixou a parte 1 no ar
-- e desligada.
--
-- Muda UMA função. `transfer_onboarding_responsavel` e `create_onboarding_journey`
-- continuam exatamente como estão: elas já chamam este resolvedor, e são as únicas
-- que chamam (conferido em pg_proc, 11/09/2026).
--
-- O que NÃO muda: quem entra por outros caminhos (vendedor em return_to_vendor,
-- especialista em create_onboarding_training) continua no papel fixo daquele
-- caminho. Só o responsável espelha setor.

-- De STABLE para VOLATILE: agora ela cria o papel que faltar.
CREATE OR REPLACE FUNCTION public.fn_onboarding_role_id_do_setor(
  p_tenant_id uuid,
  p_user_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dept uuid;
  v_nome text;
  v_role uuid;
BEGIN
  -- Setor da pessoa. `funcionarios.department_id` é onde a UI escreve; a lista de
  -- membros cobre perfil sem funcionário vinculado.
  SELECT COALESCE(
    (SELECT f.department_id
       FROM public.profiles p
       JOIN public.funcionarios f ON f.id = p.funcionario_id
      WHERE p.user_id = p_user_id AND p.tenant_id = p_tenant_id),
    (SELECT m.department_id
       FROM public.support_department_members m
      WHERE m.user_id = p_user_id AND m.tenant_id = p_tenant_id AND m.is_active
      ORDER BY m.created_at
      LIMIT 1)
  ) INTO v_dept;

  -- Sem setor no cadastro não há o que espelhar: quem chama usa o papel padrão.
  IF v_dept IS NULL THEN
    RETURN NULL;
  END IF;

  -- 1) Já existe papel para esse setor. É por aqui que passam os mapeamentos feitos
  --    a mão, como "Implantador" -> Implantação na Digi Office: o nome que o tenant
  --    escolheu é preservado, não viramos "Implantação" por cima dele.
  SELECT id INTO v_role
    FROM public.onboarding_participant_roles
   WHERE tenant_id = p_tenant_id AND department_id = v_dept AND ativo;
  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- Setor precisa ser deste tenant e estar ativo. Protege contra department_id
  -- órfão no cadastro do funcionário.
  SELECT d.name INTO v_nome
    FROM public.support_departments d
   WHERE d.id = v_dept AND d.tenant_id = p_tenant_id AND d.is_active;
  IF v_nome IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2) Existe papel com o mesmo nome do setor e ainda sem setor: adota em vez de
  --    criar um duplicado, que o índice de nome recusaria.
  UPDATE public.onboarding_participant_roles
     SET department_id = v_dept
   WHERE tenant_id = p_tenant_id
     AND lower(nome) = lower(v_nome)
     AND department_id IS NULL
     AND ativo
  RETURNING id INTO v_role;
  IF v_role IS NOT NULL THEN
    RETURN v_role;
  END IF;

  -- 3) Cria o papel espelhando o setor. slug fica NULL de propósito: não é papel de
  --    sistema, então a tela pode renomear, recolorir, desativar e excluir.
  INSERT INTO public.onboarding_participant_roles (tenant_id, nome, department_id, position)
  VALUES (
    p_tenant_id, v_nome, v_dept,
    COALESCE((SELECT max(position) FROM public.onboarding_participant_roles
               WHERE tenant_id = p_tenant_id), 0) + 1
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_role;

  -- Não inseriu: ou outra transação criou primeiro, ou o nome já pertence a um papel
  -- ligado a outro setor, ou o papel do setor existe mas está inativo. Nos dois
  -- últimos casos a releitura devolve NULL e quem chama usa o padrão, que é o
  -- comportamento correto: papel desativado de propósito não deve voltar sozinho.
  IF v_role IS NULL THEN
    SELECT id INTO v_role
      FROM public.onboarding_participant_roles
     WHERE tenant_id = p_tenant_id AND department_id = v_dept AND ativo;
  END IF;

  RETURN v_role;
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_role_id_do_setor(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_onboarding_role_id_do_setor(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_role_id_do_setor(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_onboarding_role_id_do_setor(uuid, uuid) IS
  'Papel do participante a partir do setor da pessoa, criando o papel se ainda nao existir. NULL quando a pessoa nao tem setor ou o papel do setor esta inativo.';

COMMENT ON COLUMN public.onboarding_participant_roles.department_id IS
  'Setor que este papel representa. Preenchido sozinho quando alguem do setor recebe uma jornada, ou a mao pela tela de Papeis.';
