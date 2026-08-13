-- Regras 5 e 6: ticket em meu nome e jornada sob minha responsabilidade (13/08/2026).
--
-- Nenhuma das duas existia. O ticket de onboarding NUNCA tem responsavel_user_id
-- (0 de 177 em 30 dias) — quem tem é a jornada (109 de 109).
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/38_avisos_de_ticket_e_jornada.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_autor uuid; v_resp uuid; v_outro uuid;
  v_ticket uuid; v_ticket2 uuid; v_cliente uuid; v_journey uuid; v_n int; v_url text;
BEGIN
  -- ── fixture: tenant com 3 perfis ativos e um cliente
  SELECT p.tenant_id INTO v_tenant FROM public.profiles p
   WHERE p.access_status = 'active'
     AND EXISTS (SELECT 1 FROM public.clientes c WHERE c.tenant_id = p.tenant_id)
   GROUP BY p.tenant_id HAVING count(*) >= 3 LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: nenhum tenant com 3 perfis ativos e cliente'; END IF;

  SELECT user_id INTO v_autor FROM public.profiles
   WHERE tenant_id = v_tenant AND access_status='active' ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_resp FROM public.profiles
   WHERE tenant_id = v_tenant AND access_status='active' AND user_id <> v_autor
   ORDER BY user_id LIMIT 1;
  SELECT user_id INTO v_outro FROM public.profiles
   WHERE tenant_id = v_tenant AND access_status='active' AND user_id NOT IN (v_autor, v_resp)
   ORDER BY user_id LIMIT 1;

  SELECT id INTO v_cliente FROM public.clientes WHERE tenant_id = v_tenant LIMIT 1;

  -- ── regra 5: ticket criado com responsável DIFERENTE do autor → avisa
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, criado_por, responsavel_user_id, contexto)
  VALUES (v_tenant, v_cliente, 'Teste aviso ticket', v_autor, v_resp, 'suporte')
  RETURNING id INTO v_ticket;

  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='ticket_assigned' AND nr.user_id=v_resp
    AND n.metadata->>'ticket_id' = v_ticket::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TICKET: esperado 1 aviso ao responsavel, veio %', v_n; END IF;

  -- a URL tem que apontar para a tela de tickets com o id
  SELECT action_url INTO v_url FROM public.notifications
   WHERE type='ticket_assigned' AND metadata->>'ticket_id' = v_ticket::text;
  IF v_url <> '/tickets?ticket=' || v_ticket::text THEN
    RAISE EXCEPTION 'TICKET: action_url gravou %, esperado /tickets?ticket=%', v_url, v_ticket;
  END IF;

  -- ── autor = responsável → NÃO avisa
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, criado_por, responsavel_user_id, contexto)
  VALUES (v_tenant, v_cliente, 'Teste auto-atribuicao', v_autor, v_autor, 'suporte')
  RETURNING id INTO v_ticket2;

  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='ticket_assigned' AND nr.user_id=v_autor
    AND n.metadata->>'ticket_id' = v_ticket2::text;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TICKET: quem abriu para si mesmo nao pode ser avisado'; END IF;

  -- ── reatribuição avisa o novo
  UPDATE public.support_tickets SET responsavel_user_id = v_outro WHERE id = v_ticket2;
  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='ticket_assigned' AND nr.user_id=v_outro
    AND n.metadata->>'ticket_id' = v_ticket2::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TICKET: reatribuicao nao avisou o novo responsavel'; END IF;

  -- ── UPDATE que nao mexe no responsavel nao avisa de novo
  UPDATE public.support_tickets SET assunto = 'Assunto trocado' WHERE id = v_ticket2;
  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='ticket_assigned' AND nr.user_id=v_outro
    AND n.metadata->>'ticket_id' = v_ticket2::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TICKET: update sem trocar responsavel avisou de novo (%)', v_n; END IF;

  -- ── regra 6: jornada nasce com responsável → avisa
  INSERT INTO public.onboarding_journeys (tenant_id, ticket_id, cliente_id, situacao, responsavel_user_id)
  VALUES (v_tenant, v_ticket, v_cliente, 'em_andamento', v_resp)
  RETURNING id INTO v_journey;

  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='onboarding_journey_assigned' AND nr.user_id=v_resp
    AND n.metadata->>'journey_id' = v_journey::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'JORNADA: abertura nao avisou o responsavel, veio %', v_n; END IF;

  SELECT action_url INTO v_url FROM public.notifications
   WHERE type='onboarding_journey_assigned' AND metadata->>'journey_id' = v_journey::text;
  IF v_url <> '/onboarding-implantacao?journey=' || v_journey::text THEN
    RAISE EXCEPTION 'JORNADA: action_url gravou %', v_url;
  END IF;

  -- ── transferência avisa o novo
  UPDATE public.onboarding_journeys SET responsavel_user_id = v_outro WHERE id = v_journey;
  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='onboarding_journey_assigned' AND nr.user_id=v_outro
    AND n.metadata->>'journey_id' = v_journey::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'JORNADA: transferencia nao avisou o novo responsavel'; END IF;

  RAISE NOTICE 'SMOKE_OK: regras 5 e 6';
END $$;

ROLLBACK;
