-- Título opcional do anexo. Usado na seção Anexos da jornada de onboarding para
-- descrever o conteúdo e permitir a busca por título/nome/extensão.
-- Nullable e sem backfill: NULL = "ainda sem título", o que a UI sinaliza com um selo.
ALTER TABLE public.support_ticket_attachments ADD COLUMN IF NOT EXISTS title text;
