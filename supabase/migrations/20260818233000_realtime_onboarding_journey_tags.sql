-- Tag de jornada no quadro de Implantação em tempo real.
--
-- O quadro (Onboarding / Implantação / Acompanhamento) já se atualiza sozinho
-- ouvindo support_tickets e support_ticket_events, que toda RPC do quadro grava.
-- Tag é a única exceção: a tela escreve direto em onboarding_journey_tags, que
-- não está na publication — então a tag que outro usuário colocou só aparecia
-- quando chegava algum outro evento do tenant.
--
-- REPLICA IDENTITY FULL não é enfeite: sem ela o payload de DELETE traz só a PK,
-- o filtro server-side `tenant_id=eq.<x>` do assinante não casa e REMOVER uma tag
-- não chegaria a ninguém. A tabela é pequena e de escrita rara, então o WAL extra
-- é irrelevante.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'onboarding_journey_tags'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.onboarding_journey_tags;
    RAISE NOTICE 'onboarding_journey_tags adicionada a supabase_realtime';
  ELSE
    RAISE NOTICE 'onboarding_journey_tags ja estava na publication';
  END IF;
END $$;

ALTER TABLE public.onboarding_journey_tags REPLICA IDENTITY FULL;

-- Conferência (deve voltar 1 linha, com relreplident = 'f'):
--   SELECT t.tablename, c.relreplident
--     FROM pg_publication_tables t
--     JOIN pg_class c ON c.relname = t.tablename
--    WHERE t.pubname = 'supabase_realtime'
--      AND t.tablename = 'onboarding_journey_tags';
