-- fn_acompanhamento_first_stage nasceu aberta para authenticated — fecha.
--
-- Ela é SECURITY DEFINER e recebe p_tenant_id sem nenhuma guarda: qualquer operador logado
-- poderia passar o UUID de outra empresa e ler a etapa inicial dela. É o mesmo padrão do
-- vazamento cross-tenant mapeado em 31/07, e o teste 20_guarda_escopo_tenant pegou.
--
-- Não leva guarda por dentro porque não precisa ser chamável pelo front: quem usa é
-- fn_create_acompanhamento_ticket, que já roda como SECURITY DEFINER e valida o tenant.

REVOKE EXECUTE ON FUNCTION public.fn_acompanhamento_first_stage(uuid) FROM authenticated;
