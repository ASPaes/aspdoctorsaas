-- ============================================================================
-- Acerta o único evento de histórico que ficou com o total em vez do delta.
--
-- O gatilho passou a gravar o delta em 20260822090000, mas o registro anterior
-- não tem como ser recalculado: o evento não guarda a quantidade que existia
-- antes. Este caso é a exceção porque a gente sabe de fora — o Usuário Cloud
-- do CAMPINA VERDE foi de 2 para 3 em 21/08/2026, então o lançamento foi 1.
--
-- Só esta linha. Os outros 19 eventos de quantidade são de 19/08, gerados pela
-- carga do espelho do OEM (sem usuário), e para eles não existe o número
-- anterior em lugar nenhum — reescrever seria inventar.
--
-- O WHERE repete os quatro sinais da linha (id, ação, módulo e o valor errado)
-- para o UPDATE não acertar outra coisa caso rode fora de contexto.
-- ============================================================================
DO $corrige$
DECLARE
  v_n int;
BEGIN
  UPDATE public.cliente_produto_modulo_eventos
     SET quantidade = 1
   WHERE id = 'eef58306-2104-4fdc-bf8d-fc1722d5bc85'
     AND acao = 'quantidade'
     AND modulo_nome = 'Usuário Cloud'
     AND quantidade = 3;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE NOTICE 'nada a corrigir: a linha já está certa ou não existe mais';
  ELSE
    RAISE NOTICE 'evento corrigido: quantidade 3 -> 1';
  END IF;
END
$corrige$;
