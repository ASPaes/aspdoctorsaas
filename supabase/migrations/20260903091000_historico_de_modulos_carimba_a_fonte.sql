-- ============================================================================
-- O gatilho passa a gravar a fonte, e o passado ganha a dele.
--
-- Só muda uma linha do corpo: `v_fonte := public.fn_acting_source()`, e a
-- coluna no INSERT. O resto é o texto que já estava em produção.
--
-- O backfill não inventa nada. Ele tem duas régua, as duas verificáveis:
--
--   1. linha com `origem = 'intake'` — só a integração de propostas grava esse
--      valor;
--   2. evento sem usuário cujo `created_at` cai DENTRO da janela de uma linha
--      processada da `onboarding_intake_log` (entre `created_at` e
--      `updated_at`, que a edge function carimba logo depois da RPC voltar),
--      num produto do cliente daquela proposta.
--
-- A régua 2 é a que alcança o que a 1 não vê: quantidade somada e módulo
-- cancelado pela calculadora numa linha que o espelho tinha criado, onde
-- `origem` continua sendo 'oem' e sempre vai continuar.
--
-- Medido contra a produção antes de escrever: as duas réguas juntas marcam
-- exatamente 10 eventos, das 5 propostas processadas entre 31/08 e 01/09, e
-- deixam de fora as reversões do espelho de 01/09 00:17 e 02/09 18:17 — que
-- foram, essas sim, a máquina copiando o parceiro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_log_cliente_produto_modulo() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_acao      text;
  v_row       public.cliente_produto_modulos;
  v_qtd       numeric;
  v_motivo    text;
  v_nome      text;
  v_custo_ant numeric;
  v_total_ant numeric;
  -- Escrita vinda da edge function roda como service_role e nao tem auth.uid():
  -- o historico ficava sem dono e a tela dizia "Sincronização OEM" para uma
  -- acao que uma pessoa mandou fazer. fn_acting_user() devolve quem enfileirou.
  v_uid     uuid := public.fn_acting_user();
  -- E quando nao houve pessoa nenhuma, fn_acting_source() diz qual integracao
  -- pediu. Sem ela, uma venda da calculadora numa linha do espelho aparecia
  -- como carga da maquina.
  v_fonte   text := public.fn_acting_source();
  v_usuario text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_acao := 'adicionado'; v_row := NEW; v_qtd := NEW.quantidade;
  ELSIF TG_OP = 'DELETE' THEN
    v_acao := 'removido';   v_row := OLD; v_qtd := OLD.quantidade;
  ELSE
    v_custo_ant := OLD.vlr_custo;
    v_total_ant := OLD.vlr_custo_total;
    IF NEW.cancelado_em IS DISTINCT FROM OLD.cancelado_em AND NEW.cancelado_em IS NOT NULL THEN
      v_acao := 'cancelado';
      v_row := NEW;
      v_motivo := NEW.cancelamento_motivo;
      -- No evento, `quantidade` é QUANTO FOI CANCELADO, não o que sobrou:
      -- "Cancelado · 1" numa linha que tinha 2 é o que a pessoa procura.
      v_qtd := CASE
                 WHEN NEW.ativo = false THEN coalesce(OLD.quantidade, 0)
                 ELSE greatest(coalesce(OLD.quantidade, 0) - coalesce(NEW.quantidade, 0), 0)
               END;
    ELSIF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
      v_acao := CASE WHEN NEW.ativo THEN 'reativado' ELSE 'cancelado' END;
      v_row := NEW; v_qtd := NEW.quantidade; v_motivo := NEW.cancelamento_motivo;
    ELSIF NEW.quantidade IS DISTINCT FROM OLD.quantidade THEN
      v_acao := 'quantidade';
      v_row := NEW;
      -- Mesma régua do cancelamento: o evento diz o que MUDOU. "Quantidade · 1"
      -- numa linha que foi de 2 para 3 é o que a pessoa procura; o total de 3
      -- ela já lê na ficha.
      v_qtd := coalesce(NEW.quantidade, 0) - coalesce(OLD.quantidade, 0);
    ELSIF NEW.vlr_custo IS DISTINCT FROM OLD.vlr_custo
       OR (NEW.vlr_custo_total IS DISTINCT FROM OLD.vlr_custo_total
           AND OLD.vlr_custo_total IS NOT NULL
           AND NEW.vlr_custo_total IS NOT NULL) THEN
      -- O que o parceiro cobra mudou. Pode ser o preço por licença (reajuste)
      -- ou só o total (a cortesia que acabou, o crédito que saiu): os dois
      -- mexem no custo do cliente e os dois têm que aparecer.
      --
      -- `quantidade` aqui é o TOTAL da linha, não um delta: é por ela que a
      -- view multiplica a diferença quando não há custo total gravado.
      v_acao := 'preco';
      v_row := NEW; v_qtd := NEW.quantidade;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  SELECT m.nome INTO v_nome FROM public.produto_modulos m WHERE m.id = v_row.modulo_id;

  IF v_uid IS NOT NULL THEN
    SELECT f.nome INTO v_usuario
      FROM public.profiles p
      LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
     WHERE p.user_id = v_uid
     LIMIT 1;
  END IF;

  INSERT INTO public.cliente_produto_modulo_eventos
    (tenant_id, cliente_produto_id, modulo_id, modulo_nome, acao, quantidade,
     vlr_custo, vlr_custo_anterior, vlr_custo_total, vlr_custo_total_anterior,
     vlr_mensal, origem, usuario_id, usuario_nome, motivo, fonte)
  VALUES
    (v_row.tenant_id, v_row.cliente_produto_id, v_row.modulo_id,
     coalesce(v_nome, '(módulo sem cadastro)'), v_acao, v_qtd,
     v_row.vlr_custo, v_custo_ant, v_row.vlr_custo_total, v_total_ant,
     v_row.vlr_mensal, coalesce(v_row.origem, 'manual'),
     v_uid, v_usuario, v_motivo, v_fonte);

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.trg_log_cliente_produto_modulo() OWNER TO postgres;

-- ─────────────────────────────────────────────────────────────── backfill
-- Régua 1: a linha carrega a marca da integração.
UPDATE public.cliente_produto_modulo_eventos e
   SET fonte = 'calculadora'
 WHERE e.fonte IS NULL
   AND e.origem = 'intake';

-- Régua 2: evento sem dono dentro da janela de uma proposta processada.
UPDATE public.cliente_produto_modulo_eventos e
   SET fonte = 'calculadora'
  FROM public.onboarding_intake_log l
  JOIN public.cliente_produtos cp ON cp.cliente_id = l.cliente_id
 WHERE e.cliente_produto_id = cp.id
   AND e.fonte IS NULL
   AND e.usuario_id IS NULL
   AND l.status = 'processado'
   AND l.cliente_id IS NOT NULL
   AND e.created_at >= l.created_at
   AND e.created_at <= l.updated_at;
