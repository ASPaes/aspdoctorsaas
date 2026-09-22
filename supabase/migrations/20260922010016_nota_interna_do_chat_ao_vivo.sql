-- Fecho do DEM-0429 | A nota interna passa a aparecer ao vivo no chat.
--
-- useConversationNotes assina postgres_changes em whatsapp_conversation_notes
-- desde que existe, mas a tabela NUNCA esteve na publication supabase_realtime
-- (conferido em 22/09/2026: lá estavam whatsapp_instances,
-- whatsapp_conversations, whatsapp_messages e whatsapp_reactions, entre outras
-- 13, e esta não). A assinatura existia e não recebia nada: a nota só aparecia
-- no refetch, quando alguém abria o chat. Valia para nota escrita à mão e passou
-- a valer para a nota que a automação escreve.
--
-- REPLICA IDENTITY FULL é o que faz o DELETE chegar. O hook filtra por
-- `conversation_id=eq.<id>`, e com a identidade default o evento de DELETE
-- carrega só a PK — sem conversation_id no payload, o filtro não casa e a nota
-- excluída por um agente continuaria na tela do outro. whatsapp_messages já usa
-- FULL pelo mesmo motivo.
--
-- Custo: 349 notas no total, 154 nos últimos 30 dias (~5/dia), 192 kB de tabela
-- e 2 linhas editadas na história inteira. O WAL extra do FULL é sobre UPDATE e
-- DELETE, que aqui quase não acontecem.
--
-- A publication é do papel `postgres`, então o SQL Editor tem permissão.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- Banco local montado sem a stack de Realtime: nada a fazer.
    RAISE NOTICE '[realtime] publication supabase_realtime nao existe aqui; ADD TABLE ignorado';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_publication_tables
     WHERE pubname    = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename  = 'whatsapp_conversation_notes'
  ) THEN
    RAISE NOTICE '[realtime] whatsapp_conversation_notes ja esta na publication';
    RETURN;
  END IF;

  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversation_notes';
  RAISE NOTICE '[realtime] whatsapp_conversation_notes adicionada a publication';
END $$;

-- Idempotente: repetir não muda nada.
ALTER TABLE public.whatsapp_conversation_notes REPLICA IDENTITY FULL;
