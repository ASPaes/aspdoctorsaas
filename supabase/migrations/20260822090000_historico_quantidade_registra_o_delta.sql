-- ============================================================================
-- No histórico de módulos, "Quantidade" passa a registrar QUANTO FOI LANÇADO,
-- não o total depois da mudança.
--
-- O gatilho gravava `NEW.quantidade`. Somar 1 unidade num módulo que tinha 2
-- virava a linha "Quantidade · 3" — o número certo do estado atual, e a
-- resposta errada para a pergunta que o histórico existe para responder:
-- *o que aconteceu aqui?*
--
-- O próprio gatilho já fazia isso certo no cancelamento, com o comentário
-- explicando: "no evento, quantidade é QUANTO FOI CANCELADO, não o que sobrou".
-- A alteração de quantidade tinha ficado de fora da mesma regra.
--
-- Nada é reescrito: o evento antigo não guarda a quantidade anterior, então não
-- há como recalcular o delta do histórico. Só o registro novo sai certo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_log_cliente_produto_modulo() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acao    text;
  v_row     public.cliente_produto_modulos;
  v_qtd     numeric;
  v_motivo  text;
  v_nome    text;
  v_uid     uuid := auth.uid();
  v_usuario text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_acao := 'adicionado'; v_row := NEW; v_qtd := NEW.quantidade;
  ELSIF TG_OP = 'DELETE' THEN
    v_acao := 'removido';   v_row := OLD; v_qtd := OLD.quantidade;
  ELSE
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
     vlr_custo, vlr_mensal, origem, usuario_id, usuario_nome, motivo)
  VALUES
    (v_row.tenant_id, v_row.cliente_produto_id, v_row.modulo_id,
     coalesce(v_nome, '(módulo sem cadastro)'), v_acao, v_qtd,
     v_row.vlr_custo, v_row.vlr_mensal, coalesce(v_row.origem, 'manual'),
     v_uid, v_usuario, v_motivo);

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.trg_log_cliente_produto_modulo() OWNER TO postgres;
