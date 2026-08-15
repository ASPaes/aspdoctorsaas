-- Retenção de mídia do chat nasce LIGADA, em todos os tenants
--
-- Decisão do Alexandre em 14/08/2026, revendo a de algumas horas antes. A
-- 20260814120000_retencao_de_midia_do_chat criou a chave desligada de propósito,
-- para ligar setor a setor depois de conferir o primeiro lote. Ele preferiu
-- ligada em todo mundo desde o começo.
--
-- Ligar NÃO apaga nada por si: quem executa é a edge function purge-chat-media,
-- que só roda quando o pg_cron for agendado. Até lá, o efeito é o `dry_run`
-- passar a enxergar os candidatos reais.

ALTER TABLE public.support_departments
  ALTER COLUMN media_retention_enabled SET DEFAULT true;

-- Setor novo já nasce ligado pelo DEFAULT; os que existem hoje precisam do UPDATE.
UPDATE public.support_departments
   SET media_retention_enabled = true
 WHERE media_retention_enabled = false;

COMMENT ON COLUMN public.support_departments.media_retention_enabled IS
  'Liga a purga automática de mídia do chat deste setor. Nasce true (14/08/2026); '
  'desligar é por setor, na tela de Setores.';
