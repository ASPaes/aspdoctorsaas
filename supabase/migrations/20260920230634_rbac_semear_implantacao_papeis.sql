-- ============================================================================
-- RBAC — semeadura das 28 permissões da Implantação, Dashboard, Configurações
-- e Certificados. Parte 1 de 2: o valor por PAPEL.
--
-- POR QUE EXISTE, medido em 20/09/2026 antes de publicar: as 28 chaves estavam
-- com `role_permissions` VAZIO (nenhuma linha para admin/head/user) e com 42
-- linhas de grupo cujo valor NUNCA foi lido por ninguém — o padrão que a
-- semeadura por âncora deixou. Esse valor não corresponde ao sistema de hoje:
--
--   onb.mover · onb.golive · onb.criar_jornada · onb.treinos ·
--   onb.editar_jornada · onb.cfg.templates   ->  0 grupos com SIM, 42 com NÃO
--   nav.onboarding · dash.meu_painel · fin.bridge · onb.cfg.pipelines
--                                            -> 24 SIM, 18 NÃO
--   usuarios.desativar · usuarios.auditoria  -> 25 SIM, 17 NÃO
--   certificados.dashboard                   -> 26 SIM, 16 NÃO
--
-- Ligar o portão sem isto congelaria a Implantação inteira nas 14 empresas:
-- ninguém arrastaria cartão, criaria jornada, agendaria treino ou daria
-- go-live. É a armadilha R12 do plano, e é a terceira vez que ela aparece.
--
-- FICAM DE FORA, de propósito: `clientes.oem_aprovacao` (portão próprio no
-- banco, com exceção por pessoa), as 5 chaves de Super Admin (o super admin
-- passa por cima do RBAC por desenho), `cfg.whatsapp` (chave morta: nenhuma
-- tela aponta para ela) e `dash.valores_financeiros` (a função de esconder R$
-- não existe no código — semear prometeria o que a tela não faz).
-- ============================================================================

-- A. tela sem restrição hoje -> liga para os três papéis.
-- Confirmado no código: nenhuma destas tem checagem de papel. O módulo inteiro
-- é liberado por `tenants.onboarding_enabled`, que continua em série.
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select p.role, k.key, true, false, false, false
  from (values ('admin'),('head'),('user')) as p(role)
 cross join (values
   ('nav.onboarding'), ('onb.mover'), ('onb.criar_jornada'), ('onb.cancelar'),
   ('onb.reabrir'), ('onb.transferir'), ('onb.treinos'), ('onb.dashboard'),
   ('onb.cfg.jornadas'), ('onb.cfg.pipelines'), ('onb.cfg.checklists'),
   ('onb.cfg.distribuicao'), ('onb.cfg.motivos'), ('onb.cfg.demandas'),
   ('onb.cfg.tipos_treino'), ('onb.cfg.papeis'), ('onb.cfg.retornos'),
   ('onb.cfg.contabilidade'), ('onb.cfg.indicadores'),
   ('fin.bridge'), ('atend.macros'), ('usuarios.desativar'),
   ('certificados.dashboard')
 ) as k(key)
on conflict (role, resource_key) do nothing;

-- B. hoje é admin ou gestor (PAPEIS_LIBERADOS em src/lib/meuPainelAcesso.ts).
-- O piloto por empresa continua valendo em série, no frontend.
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select p.role, 'dash.meu_painel', p.role in ('admin','head'), false, false, false
  from (values ('admin'),('head'),('user')) as p(role)
on conflict (role, resource_key) do nothing;

-- C. hoje só admin
--   onb.editar_jornada -> JourneyDetailSheet: `isAdmin && !isTerminal`
--   onb.cfg.templates  -> OnboardingConfigPage: `canGenerateAI`
--   onb.golive         -> só o ATALHO (fora da etapa final / Acompanhamento);
--                         a saída normal, na etapa final, segue livre no código
--   usuarios.auditoria -> AcessosEquipeTab: botão Histórico
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select p.role, k.key, p.role = 'admin', false, false, false
  from (values ('admin'),('head'),('user')) as p(role)
 cross join (values
   ('onb.editar_jornada'), ('onb.cfg.templates'), ('onb.golive'), ('usuarios.auditoria')
 ) as k(key)
on conflict (role, resource_key) do nothing;
