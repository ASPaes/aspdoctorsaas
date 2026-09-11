-- ============================================================================
-- Mensagem agendada -- correcao do CHECK do anexo  (11/09/2026)
--
-- ACHADO NO TESTE LOCAL do motor, antes de ir para producao: a limpeza de
-- anexo orfao apagava o arquivo do Storage e depois nao conseguia zerar o
-- `storage_path` -- o CHECK original exigia `storage_path IS NOT NULL` para
-- toda linha de midia, inclusive a cancelada.
--
-- Consequencia se tivesse subido assim: a cada minuto o motor tentaria apagar
-- de novo os mesmos arquivos que ja nao existem, para sempre, e a linha
-- continuaria apontando para um arquivo fantasma. O erro do UPDATE era
-- engolido (a funcao nao lia o retorno) -- ninguem veria nada nos logs.
--
-- A regra certa: o anexo e obrigatorio enquanto a mensagem AINDA PODE SAIR
-- (pending/sending). Depois que ela morreu ou saiu, o arquivo pode ir embora
-- sem que a linha fique invalida. O historico de quem agendou o que continua
-- inteiro -- `media_file_name`, `media_mimetype` e `media_size_bytes` ficam.
--
-- A tabela esta vazia em producao, entao o ADD CONSTRAINT valida nada e sai
-- instantaneo.
-- ============================================================================
BEGIN;

ALTER TABLE public.whatsapp_scheduled_messages
  DROP CONSTRAINT IF EXISTS wa_sched_payload_chk;

ALTER TABLE public.whatsapp_scheduled_messages
  ADD CONSTRAINT wa_sched_payload_chk CHECK (
    (
      message_type = 'text'
      AND length(btrim(content)) > 0
      AND storage_path IS NULL
    )
    OR (
      message_type <> 'text'
      AND media_mimetype IS NOT NULL
      AND (storage_path IS NOT NULL OR status IN ('sent','canceled','failed'))
    )
  );

COMMENT ON COLUMN public.whatsapp_scheduled_messages.storage_path IS
  'Caminho do anexo no bucket whatsapp-media. Obrigatorio enquanto a mensagem pode sair (pending/sending); zerado pela limpeza de orfaos depois que ela e cancelada ou falha de vez.';

COMMIT;
