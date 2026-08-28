-- ============================================================================
-- Aprovação OEM (passo 1 de 4): o estado novo na fila de sincronização.
--
-- POR QUE EXISTE
-- Hoje, adicionar um módulo na aba Produtos & Módulos de um cliente COM licença
-- no OEM manda o pedido ao parceiro na hora: `fn_oem_enfileirar_novo` grava em
-- `oem_sync_fila` já como 'pendente', o próprio clique chama a
-- `oem-sync-processar`, e a `fn_oem_fila_aplicar` cria a linha na ficha e o
-- upsell no MRR. Ninguém confere nada antes. Vale igual para somar quantidade
-- (pelo Adicionar e pelo lápis) e para o cancelamento, que ainda lança downsell.
--
-- Decisão do Alexandre em 27/08/2026: tudo isso passa a esperar aprovação de um
-- admin, numa aba nova em Clientes.
--
-- O DESENHO: a aprovação NÃO é uma segunda fila, é um estado ANTES da que já
-- existe. Aprovar = mudar o status para 'pendente', que é exatamente onde a
-- linha nasceria hoje. Daí para frente o caminho é o mesmo, sem uma linha nova:
-- `fn_oem_fila_claim`, `fn_oem_fila_aplicar`, o backoff 2/5/15/60, o cron e o
-- painel de Sincronização continuam intocados. Uma fila paralela obrigaria a
-- duplicar payload, de-para, guarda de pedido duplicado e o selo da ficha.
--
-- ESTE ARQUIVO NÃO MUDA COMPORTAMENTO NENHUM. Ele só abre espaço: enquanto
-- ninguém gravar 'aguardando_aprovacao', a fila roda como rodava. Quem liga a
-- trava é o passo 4.
--
-- POR QUE O RESTO DO MOTOR NÃO PRECISA SABER DISSO
--   fn_oem_fila_claim       status IN ('pendente','erro')                -> não reivindica
--   fn_oem_fila_status      conta pendente/processando/erro/invalido/ok  -> não conta
--   fn_vigia_filas_paradas  status IN ('pendente','erro','processando')  -> não alarma
-- As três ignoram o estado novo sem alteração nenhuma. É de propósito: alarme
-- que dispara com tudo certo ensina a ignorar.
--
-- A ÚNICA que enxerga demais é a `fn_oem_fila_listar`, que devolve a fila
-- inteira do tenant para o painel de Sincronização. Ela é ajustada no passo 4,
-- junto com a virada — até lá não há o que ela possa listar.
--
-- Arquivo sozinho de propósito: ele pega ACCESS EXCLUSIVE em `oem_sync_fila`
-- para trocar o CHECK. Misturar DDL de tabela quente com DDL de outra foi o que
-- causou o deadlock de 23/08.
-- ============================================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- -------------------------------------------------------------------- colunas
-- Nullable e sem DEFAULT: em Postgres 11+ é só metadado, não reescreve a tabela.
ALTER TABLE public.oem_sync_fila
  ADD COLUMN IF NOT EXISTS decidido_por  uuid,
  ADD COLUMN IF NOT EXISTS decidido_em   timestamptz,
  ADD COLUMN IF NOT EXISTS motivo_recusa text;

COMMENT ON COLUMN public.oem_sync_fila.decidido_por IS
  'Quem aprovou ou recusou (auth.users.id). NULL = ainda não decidido, ou linha anterior a 27/08/2026, quando não existia aprovação.';
COMMENT ON COLUMN public.oem_sync_fila.decidido_em IS
  'Quando foi aprovada ou recusada. É por este carimbo que a aba Aprovação OEM monta o histórico do que já foi decidido.';
COMMENT ON COLUMN public.oem_sync_fila.motivo_recusa IS
  'Obrigatório na recusa. Sem ele ninguém descobre depois por que o módulo não entrou — que é o defeito que a fila existe para não repetir.';

-- --------------------------------------------------------------------- CHECK
-- Só acrescenta valores, então a validação não tem como falhar em linha
-- nenhuma que já esteja lá. DROP + ADD porque CHECK não se altera no lugar.
--
--   aguardando_aprovacao = pedido feito, nada saiu daqui, esperando um admin
--   recusado             = TERMINAL. Nada foi ao parceiro e nada entrou na ficha.
ALTER TABLE public.oem_sync_fila DROP CONSTRAINT IF EXISTS chk_oem_sync_status;
ALTER TABLE public.oem_sync_fila
  ADD CONSTRAINT chk_oem_sync_status CHECK (
    status IN (
      'aguardando_aprovacao', 'recusado',
      'pendente', 'processando', 'ok', 'erro', 'invalido', 'ignorado'
    )
  );

COMMENT ON COLUMN public.oem_sync_fila.status IS
  'aguardando_aprovacao = esperando um admin, nada foi enviado · recusado = admin negou, terminal · pendente/processando = em curso no parceiro · ok = gravado no OEM · erro = falhou e vai tentar de novo · invalido = desistiu · ignorado = não havia o que mandar.';

-- ------------------------------------------------------------------- índices
-- Os dois recortes da aba nova. Parciais porque a fila acumula histórico ('ok'
-- fica para sempre) e nenhum dos dois precisa enxergar isso: o primeiro só tem
-- linha enquanto ela espera decisão, e some assim que é aprovada.
CREATE INDEX IF NOT EXISTS idx_oem_sync_fila_aprovacao
  ON public.oem_sync_fila (tenant_id, enfileirado_em)
  WHERE status = 'aguardando_aprovacao';

CREATE INDEX IF NOT EXISTS idx_oem_sync_fila_decidido
  ON public.oem_sync_fila (tenant_id, decidido_em DESC)
  WHERE decidido_em IS NOT NULL;

COMMIT;
