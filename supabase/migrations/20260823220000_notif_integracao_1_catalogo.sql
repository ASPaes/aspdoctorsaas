-- 23/08/2026 - Fila de integracao parada vira notificacao no sino, e o sino ganha a
-- categoria "integracao" (a terceira aba, so para admin).
--
-- POR QUE EXISTE
-- Linha morta na fila de sincronizacao so aparecia para quem abrisse a aba Fila. A DEM-0237
-- mediu o preco: um upsell de R$ 30 ficou 5 dias parado em 'invalido' sem avisar ninguem.
-- O Omie ganhou alerta em 12/08 ('omie_sync_falhou'), mas (a) in-app ele so chega a quem se
-- inscreveu em Configuracoes > Notificacoes e (b) o clique leva para a ficha do cliente, nao
-- para a linha da fila. O OEM, cuja fila nasceu em 21/08, nao tem alerta nenhum -- e a linha
-- morta some ate da ficha do cliente (fn_oem_pendencias_do_cliente nao lista 'invalido').
--
-- O QUE MUDA
--   1. notification_event_types.categoria aceita 'integracao'. E por ela que o sino monta a
--      terceira aba (Operacao | Sistema | Integracoes): o frontend le a categoria, nao uma
--      lista de chaves no codigo, entao evento novo de integracao cai na aba certa sozinho.
--   2. Todo evento dessa categoria e entregue in-app AOS ADMINS do tenant, sem inscricao.
--      Os admins entram POR CIMA da lista de inscritos, nao no lugar dela: quem ja recebia
--      (in-app ou WhatsApp) continua recebendo exatamente o que recebia.
--   3. O OEM ganha o gatilho de falha que o Omie ja tinha, e os dois ganham um watchdog de
--      fila que nao anda -- inclusive a linha zumbi em 'processando', que o proprio cron nao
--      enxerga (fn_oem_fila_claim marca 'processando' e nao mexe em proxima_tentativa_em; se
--      a edge function morrer no meio, a linha fica invisivel para todo mundo).
--   4. O clique na notificacao abre a fila certa, na linha do erro.
--
-- ATENCAO: AS DUAS FILAS USAM 'erro' COM SENTIDOS OPOSTOS (nao unificar sem ler isto)
--   omie_sync_fila: 'pendente' = vai tentar de novo | 'erro' e 'invalido' = TERMINAL.
--   oem_sync_fila:  'pendente' e 'erro' = vai tentar de novo | 'invalido' = TERMINAL.
--   Por isso o gatilho do OEM dispara so em 'invalido' e o do Omie continua disparando em
--   'erro'+'invalido'. Alertar no 'erro' do OEM seria avisar de algo que se conserta sozinho
--   2 minutos depois.
--
-- NAO MUDA: quiet hours, cooldown, dedupe, e o canal WhatsApp do Omie (fn_omie_wpp_extra
-- continua saindo pela lista de numeros da conta, sem passar por inscricao).
--
-- PARTE 1 - catalogo de eventos. Trava notification_event_types por instantes.
-- Parte 1 de 4. Rode este arquivo inteiro, sozinho, no SQL Editor.
-- O deadlock de 23/08 aconteceu por rodar tudo de uma vez: ver o cabecalho da parte 1.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) Categoria nova   [BLOCO 1 - trava notification_event_types por instantes]
-- ---------------------------------------------------------------------------
ALTER TABLE public.notification_event_types
  DROP CONSTRAINT IF EXISTS notification_event_types_categoria_check;

ALTER TABLE public.notification_event_types
  ADD CONSTRAINT notification_event_types_categoria_check
  CHECK (categoria = ANY (ARRAY['gestao'::text, 'sistema'::text, 'integracao'::text]));

-- ---------------------------------------------------------------------------
-- 2) Catalogo de eventos
-- ---------------------------------------------------------------------------

-- Os que ja existiam e sempre foram de integracao.
UPDATE public.notification_event_types
   SET categoria = 'integracao'
 WHERE key IN ('omie_sync_falhou', 'omie_vinculo_ambiguo', 'omie_sync_parado');

INSERT INTO public.notification_event_types
  (key, label, descricao, categoria, default_severity, cooldown_minutes, ativo)
VALUES
  ('oem_sync_falhou',
   'OEM nao sincronizou',
   'Uma alteracao de modulo (ativar, mudar quantidade ou cancelar) nao chegou ao OEM e a linha parou na fila. Enquanto isso, a licenca do cliente no parceiro esta diferente do que a ficha diz aqui.',
   'integracao', 'warning', 60, true),

  ('integracao_fila_parada',
   'Fila de integracao nao esta andando',
   'Ha registro esperando ha mais de 30 minutos numa fila de sincronizacao. Diferente de "deu erro": ninguem tentou. Normalmente e o processador parado ou uma linha que ficou presa em "enviando".',
   'integracao', 'warning', 720, true)
ON CONFLICT (key) DO UPDATE
  SET label            = EXCLUDED.label,
      descricao        = EXCLUDED.descricao,
      categoria        = EXCLUDED.categoria,
      default_severity = EXCLUDED.default_severity,
      cooldown_minutes = EXCLUDED.cooldown_minutes,
      ativo            = true;

COMMIT;
