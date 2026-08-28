-- ============================================================================
-- Aprovação OEM (passo 3 de 4): o pedido novo acende o sino do admin.
--
-- POR QUE EXISTE
-- A partir do passo 4, módulo adicionado por um head não entra na ficha nem vai
-- ao parceiro até um admin aprovar. Sem aviso, o pedido fica esperando alguém
-- lembrar de abrir a aba — que é exatamente o que a DEM-0237 mediu no Omie: um
-- upsell de R$ 30 parado 5 dias porque a única tela que mostrava era uma aba que
-- ninguém abre.
--
-- O CAMINHO JÁ EXISTE, ESTE ARQUIVO SÓ SE PENDURA NELE. Desde 23/08 todo evento
-- da categoria 'integracao' é entregue in-app a TODOS os admins do tenant, sem
-- depender de inscrição em Configurações › Notificações (notify_event chama
-- fn_notif_admins_do_tenant). É o comportamento que este evento precisa e não
-- há nada a configurar.
--
-- O TOAST FICA DESLIGADO, O SINO NÃO. `toast_somente_para: null` faz a
-- notificação existir no sino e no contador sem estourar um toast na tela de
-- todos os admins a cada módulo que alguém adiciona. É a mesma decisão já tomada
-- no watchdog de fila, pelo mesmo motivo: adição de módulo é rotina, não
-- incidente, e toast de rotina ensina a ignorar toast. Para ligar o toast para
-- quem pediu, é uma linha: trocar o null por `f.usuario_id`.
--
-- O aviso se RESOLVE sozinho na decisão (aprovada ou recusada), do mesmo jeito
-- que a fn_oem_sync_ok_resolve fecha o incidente de falha quando a linha vai.
-- Sem isso o sino acumularia pendência de coisa já resolvida.
--
-- Dois blocos, duas transações. O bloco 2 pega ACCESS EXCLUSIVE em
-- `oem_sync_fila`; misturar isso com escrita no catálogo de eventos na mesma
-- transação é a receita do deadlock de 23/08. Rode o arquivo inteiro: o SQL
-- Editor executa os dois na ordem.
-- ============================================================================


-- ############################################################################
-- BLOCO 1 - catálogo do evento e as funções. Não trava a fila.
-- ############################################################################
BEGIN;

INSERT INTO public.notification_event_types
  (key, label, descricao, categoria, default_severity, cooldown_minutes, ativo, whatsapp_extra_only)
VALUES (
  'oem_aprovacao_pendente',
  'Pedido do OEM aguardando aprovacao',
  'Alguem adicionou, alterou a quantidade ou cancelou um modulo de um cliente com licenca no OEM. '
  || 'Nada foi enviado ao parceiro e nada entrou na ficha: o pedido espera aprovacao de um admin em Clientes > Aprovacao OEM.',
  'integracao',
  -- 'info', não 'warning': é trabalho a fazer, não defeito. Warning aqui
  -- gastaria o vermelho do sino em fluxo normal.
  'info',
  -- A chave de dedupe é a própria linha da fila, então cada pedido é um
  -- incidente novo e o cooldown nunca cala um pedido diferente. Ele só existe
  -- para o caso degenerado de a mesma linha reentrar.
  60,
  true,
  false
)
ON CONFLICT (key) DO UPDATE
  SET label               = EXCLUDED.label,
      descricao           = EXCLUDED.descricao,
      categoria           = EXCLUDED.categoria,
      default_severity    = EXCLUDED.default_severity,
      cooldown_minutes    = EXCLUDED.cooldown_minutes,
      ativo               = EXCLUDED.ativo,
      whatsapp_extra_only = EXCLUDED.whatsapp_extra_only;


-- ----------------------------------------------------------------------------
-- O texto do aviso. Ele diz o que vai acontecer com o DINHEIRO se for aprovado,
-- porque é isso que se está aprovando — o efeito no OEM é consequência.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_notificar(p_fila_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  f          record;
  v_cli      text;
  v_cli_id   uuid;
  v_produto  text;
  v_modulo   text;
  v_pediu    text;
  v_qtd_hoje numeric;
  v_titulo   text;
  v_corpo    text;
  v_efeito   text;
  v_mensal   numeric;
  v_ativacao numeric;
  v_downsell numeric;
BEGIN
  SELECT * INTO f FROM public.oem_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mesmo caminho de join da fn_oem_aprovacao_listar, para o aviso falar o
  -- mesmo nome que a aba mostra.
  SELECT coalesce(c.nome_fantasia, c.razao_social), c.id, pr.nome
    INTO v_cli, v_cli_id, v_produto
    FROM public.cliente_produtos cp
    LEFT JOIN public.clientes c   ON c.id  = cp.cliente_id
    LEFT JOIN public.produtos  pr ON pr.id = cp.produto_id
   WHERE cp.id = f.cliente_produto_id;

  -- No 'ativar' a linha da ficha ainda não existe: o nome vem do catálogo.
  SELECT coalesce(
           (SELECT pm.nome FROM public.produto_modulos pm WHERE pm.id = f.modulo_catalogo_id),
           (SELECT pm.nome FROM public.cliente_produto_modulos cpm
              JOIN public.produto_modulos pm ON pm.id = cpm.modulo_id
             WHERE cpm.id = f.modulo_linha_id))
    INTO v_modulo;

  SELECT fu.nome INTO v_pediu
    FROM public.profiles p
    LEFT JOIN public.funcionarios fu ON fu.id = p.funcionario_id
   WHERE p.user_id = f.usuario_id;

  SELECT cpm.quantidade INTO v_qtd_hoje
    FROM public.cliente_produto_modulos cpm WHERE cpm.id = f.modulo_linha_id;

  v_mensal   := nullif(f.payload->>'vlr_mensal', '')::numeric;
  v_ativacao := coalesce(nullif(f.payload->>'vlr_ativacao', '')::numeric,
                         nullif(f.payload->>'vlr_ativacao_somar', '')::numeric);
  v_downsell := nullif(f.payload->>'valor_downsell', '')::numeric;

  v_titulo := 'Aprovação OEM: '
           || CASE f.acao
                WHEN 'ativar'     THEN 'ativar ' || coalesce(v_modulo, 'módulo')
                WHEN 'quantidade' THEN coalesce(v_modulo, 'módulo')
                                       || ' para ' || coalesce(f.quantidade::text, '?')
                WHEN 'cancelar'   THEN 'cancelar ' || coalesce(v_modulo, 'módulo')
                ELSE coalesce(f.acao, 'alteração')
              END
           || coalesce(' · ' || v_cli, '');

  -- `fmt_brl` devolve "R$ 0,00" para NULL, não NULL. Então cada valor é testado
  -- antes de entrar no texto: sem isso, módulo sem valor mensal anunciaria
  -- "soma R$ 0,00/mês no MRR", que parece número conferido e não é.
  v_efeito := CASE f.acao
    WHEN 'ativar' THEN
      'ativa o módulo na licença do parceiro'
      || CASE WHEN coalesce(v_mensal, 0) > 0
              THEN ' e soma ' || public.fmt_brl(v_mensal * greatest(coalesce(f.quantidade, 1), 1))
                   || '/mês no MRR do cliente'
              ELSE ' (sem valor mensal informado: não mexe no MRR)' END
      || CASE WHEN coalesce(v_ativacao, 0) > 0
              THEN ', com ' || public.fmt_brl(v_ativacao) || ' de ativação'
              ELSE '' END
    WHEN 'quantidade' THEN
      'muda a quantidade na licença de ' || coalesce(v_qtd_hoje::text, '?')
      || ' para ' || coalesce(f.quantidade::text, '?')
      || CASE WHEN coalesce(v_mensal, 0) > 0
                   AND coalesce(f.quantidade, 0) > coalesce(v_qtd_hoje, 0)
              THEN ', somando ' || public.fmt_brl(v_mensal * (f.quantidade - coalesce(v_qtd_hoje, 0)))
                   || '/mês no MRR do cliente'
              ELSE '' END
      || CASE WHEN coalesce(v_ativacao, 0) > 0
              THEN ', com ' || public.fmt_brl(v_ativacao) || ' de ativação'
              ELSE '' END
    WHEN 'cancelar' THEN
      'dá baixa de ' || coalesce(nullif(f.payload->>'quantidade_cancelar', ''), '1')
      || CASE WHEN coalesce(nullif(f.payload->>'quantidade_cancelar', '')::numeric, 1) > 1
              THEN ' unidades' ELSE ' unidade' END
      -- No cancelamento, f.quantidade é o que SOBRA na licença, não o que sai.
      || CASE WHEN coalesce(f.quantidade, 0) > 0
              THEN ' (sobram ' || f.quantidade::text || ' na licença)'
              ELSE ' (zera o módulo na licença)' END
      || CASE WHEN coalesce(v_downsell, 0) > 0
              THEN ' e tira ' || public.fmt_brl(v_downsell) || '/mês do MRR (downsell)'
              ELSE ' e NÃO mexe no MRR (baixa informada: zero)' END
    ELSE 'aplica a alteração no parceiro'
  END;

  v_corpo := coalesce(v_pediu, 'Alguém') || ' pediu '
          || CASE f.acao
               WHEN 'ativar'     THEN 'a ativação de '
               WHEN 'quantidade' THEN 'a alteração de quantidade de '
               WHEN 'cancelar'   THEN 'o cancelamento de '
               ELSE 'uma alteração em '
             END
          || coalesce(v_modulo, 'um módulo')
          || coalesce(' no produto ' || v_produto, '')
          || coalesce(', para ' || v_cli, '') || '.'
          || E'\n\nSe aprovado: ' || v_efeito || '.'
          || coalesce(E'\nMotivo informado: ' || nullif(f.payload->>'motivo',''), '')
          || E'\n\nNada foi enviado ao OEM e nada entrou na ficha do cliente ainda.'
          || E'\n\n👉 O que fazer: abra Clientes › Aprovação OEM e aprove ou recuse. '
          || 'Recusar exige motivo e fica no histórico.';

  PERFORM public.notify_event(
    f.tenant_id,
    'oem_aprovacao_pendente',
    'fila:' || f.id::text,
    v_titulo,
    v_corpo,
    jsonb_build_object(
      'fila_id',            f.id,
      'cliente_id',         v_cli_id,
      'cliente_produto_id', f.cliente_produto_id,
      'modulo_linha_id',    f.modulo_linha_id,
      'acao',               f.acao,
      'sistema',            'oem',
      -- Chave presente com null = sino e contador sim, toast não. Ver o
      -- cabeçalho: rotina não interrompe tela.
      'toast_somente_para', NULL),
    '/clientes?tab=aprovacao-oem&fila=' || f.id::text);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) TO service_role;


-- ----------------------------------------------------------------------------
-- Os dois gatilhos. O aviso NUNCA pode derrubar o enfileiramento: se a
-- notificação falhar, o pedido tem que existir do mesmo jeito. Daí o
-- BEGIN/EXCEPTION, igual ao da fn_oem_sync_falhou_notify.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_pendente_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.fn_oem_aprovacao_notificar(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_oem_aprovacao_pendente_notify: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_decidida_resolve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.resolve_notification_incident(
      NEW.tenant_id, 'oem_aprovacao_pendente', 'fila:' || NEW.id::text);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_oem_aprovacao_decidida_resolve: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

COMMIT;


-- ############################################################################
-- BLOCO 2 - os gatilhos na fila. Trava oem_sync_fila por instantes.
-- Se der lock_timeout, a fila estava ocupada: rode SÓ este bloco de novo.
-- ############################################################################
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_oem_aprovacao_pendente ON public.oem_sync_fila;
CREATE TRIGGER trg_oem_aprovacao_pendente
  AFTER INSERT ON public.oem_sync_fila
  FOR EACH ROW
  -- Só o pedido que nasce esperando gente. Linha que nasce 'pendente' (cliente
  -- sem licença no OEM não passa por aqui, mas o reprocessamento devolve a
  -- 'pendente') não avisa nada: ela já foi aprovada uma vez.
  WHEN (NEW.status = 'aguardando_aprovacao')
  EXECUTE FUNCTION public.fn_oem_aprovacao_pendente_notify();

DROP TRIGGER IF EXISTS trg_oem_aprovacao_decidida ON public.oem_sync_fila;
CREATE TRIGGER trg_oem_aprovacao_decidida
  AFTER UPDATE ON public.oem_sync_fila
  FOR EACH ROW
  -- Saiu de "esperando", por aprovação ou por recusa: o sino não tem mais o que
  -- cobrar. TG_OP não existe em WHEN e OLD não pode ser citado num WHEN de
  -- INSERT — por isso são dois gatilhos e não um.
  WHEN (OLD.status = 'aguardando_aprovacao' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.fn_oem_aprovacao_decidida_resolve();

COMMIT;
