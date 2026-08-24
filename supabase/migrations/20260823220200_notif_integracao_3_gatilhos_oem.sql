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
-- PARTE 3 - os 2 gatilhos na fila do OEM. Trava oem_sync_fila por instantes.
-- Parte 3 de 4. Rode este arquivo inteiro, sozinho, no SQL Editor.
-- O deadlock de 23/08 aconteceu por rodar tudo de uma vez: ver o cabecalho da parte 1.

-- [BLOCO 3 - trava oem_sync_fila por instantes. Se der lock_timeout, a fila estava
-- ocupada: rode SO este bloco de novo.]
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_oem_sync_falhou_notify ON public.oem_sync_fila;
CREATE TRIGGER trg_oem_sync_falhou_notify
  AFTER UPDATE ON public.oem_sync_fila
  FOR EACH ROW
  -- So 'invalido'. No OEM, 'erro' e retentativa com backoff 2/5/15/60 min: avisar ali seria
  -- avisar de algo que se conserta sozinho.
  WHEN (NEW.status = 'invalido' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.fn_oem_sync_falhou_notify();

DROP TRIGGER IF EXISTS trg_oem_sync_ok_resolve ON public.oem_sync_fila;
CREATE TRIGGER trg_oem_sync_ok_resolve
  AFTER UPDATE ON public.oem_sync_fila
  FOR EACH ROW
  WHEN (NEW.status = 'ok' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.fn_oem_sync_ok_resolve();

COMMIT;
