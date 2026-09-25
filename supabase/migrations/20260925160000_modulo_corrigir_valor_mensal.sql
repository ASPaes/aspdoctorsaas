-- ============================================================================
-- Corrigir o valor mensal de um módulo do cliente (25/09/2026)
--
-- Caso que motivou: PDV Legal - Servidor da Digi Office, módulo "Gestao"
-- digitado com o valor errado na venda inicial, sem caminho na tela para
-- acertar — a linha é do OEM, e a ficha só oferece cancelamento nela.
--
-- Decisões do Alexandre (25/09):
--   · É CORREÇÃO, não venda: muda a base retroativamente e NÃO grava movimento
--     de MRR (upsell/downsell inflariam o Net New com algo que não aconteceu).
--   · Na Digi o contrato vai para o Omie com o valor certo — pelo gatilho que
--     já existe (`valor_modulo_enfileirar_omie`, em UPDATE OF vlr_mensal).
--   · Módulo com movimento de MRR amarrado fica BLOQUEADO: o valor dele mora
--     também no movimento, e corrigir só a linha deixaria os dois discordando.
--
-- O espelho do OEM não desfaz a correção: `fn_oem_espelhar_modulos_no_contrato`
-- escreve quantidade e custo na linha, nunca `vlr_mensal`.
--
-- Partes:
--   1. Coluna `vlr_mensal_anterior` no histórico.
--   2. Chave RBAC `clientes.modulos_valor` — nasce só para admin.
--   3. O gatilho do histórico passa a registrar mudança de valor mensal.
--   4. A RPC `fn_corrigir_valor_modulo`, único caminho da tela.
-- ============================================================================

-- ------------------------------------------------------------------ 1) coluna
ALTER TABLE public.cliente_produto_modulo_eventos
  ADD COLUMN IF NOT EXISTS vlr_mensal_anterior numeric;

-- ----------------------------------------------------------------- 2) chave
-- Copiada da linha inteira de `clientes.modulos`: `resources` em produção tem
-- colunas do RBAC v2 (module_id NOT NULL sem default, nivel, acoes...) que o
-- local não tem.
INSERT INTO public.resources
  (key, module, label, description, parent_key, display_order, hidden,
   is_navigation, where_it_appears, module_id, nivel, acoes, secao, grupo, grupo_ordem)
SELECT 'clientes.modulos_valor', r.module, 'Corrigir valor do módulo',
       'Corrige o valor mensal de um módulo digitado errado. Muda o MRR sem lançar upsell/downsell e fica no Histórico de módulos.',
       'clientes.modulos', r.display_order + 1, false,
       false, 'Ficha do cliente › Produtos & Módulos › valor mensal do módulo',
       r.module_id, (r.nivel + 1)::smallint, r.acoes, 'acao', r.grupo, r.grupo_ordem
  FROM public.resources r
 WHERE r.key = 'clientes.modulos'
ON CONFLICT (key) DO NOTHING;

-- Global: só admin. Serve às empresas no RBAC v1 e é o fundo da cadeia do v2.
INSERT INTO public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
SELECT p.role, 'clientes.modulos_valor', p.role = 'admin', false, false, false
  FROM (VALUES ('admin'), ('head'), ('user')) AS p(role)
ON CONFLICT (role, resource_key) DO NOTHING;

-- Grupos do v2: mesmo critério pelo nível base, para a tela de permissões já
-- mostrar o estado real em vez de um vazio.
INSERT INTO public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
SELECT g.id, 'clientes.modulos_valor', g.nivel_base = 'admin', false, false, false
  FROM public.permission_groups g
ON CONFLICT (group_id, resource_key) DO NOTHING;

-- ------------------------------------------------------- 3) histórico: valor
-- Corpo de PRODUÇÃO de 25/09 + o ramo de `vlr_mensal`. Vem antes do ramo de
-- custo: numa edição que mexe nos dois, o que muda o MRR é o que a pessoa
-- procura no histórico.
CREATE OR REPLACE FUNCTION public.trg_log_cliente_produto_modulo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_acao      text;
  v_row       public.cliente_produto_modulos;
  v_qtd       numeric;
  v_motivo    text;
  v_nome      text;
  v_custo_ant numeric;
  v_total_ant numeric;
  v_mensal_ant numeric;
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
    ELSIF NEW.vlr_mensal IS DISTINCT FROM OLD.vlr_mensal THEN
      -- Valor mensal (unitário) mudou. O motivo vem da RPC de correção, que o
      -- deixa na transação; outra escrita qualquer registra sem motivo.
      v_acao := 'valor';
      v_row := NEW; v_qtd := NEW.quantidade;
      v_mensal_ant := OLD.vlr_mensal;
      v_motivo := nullif(current_setting('doctorsaas.motivo_valor', true), '');
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
     vlr_mensal, vlr_mensal_anterior, origem, usuario_id, usuario_nome, motivo, fonte)
  VALUES
    (v_row.tenant_id, v_row.cliente_produto_id, v_row.modulo_id,
     coalesce(v_nome, '(módulo sem cadastro)'), v_acao, v_qtd,
     v_row.vlr_custo, v_custo_ant, v_row.vlr_custo_total, v_total_ant,
     v_row.vlr_mensal, v_mensal_ant, coalesce(v_row.origem, 'manual'),
     v_uid, v_usuario, v_motivo, v_fonte);

  RETURN NULL;
END;
$function$;

-- ------------------------------------------------------------------ 4) RPC
CREATE OR REPLACE FUNCTION public.fn_corrigir_valor_modulo(
  p_modulo_linha_id uuid,
  p_novo_valor      numeric,
  p_motivo          text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_m       public.cliente_produto_modulos;
  v_role    text;
  v_super   boolean;
  v_tenant  uuid;
  v_rbac    boolean;
  v_motivo  text := btrim(coalesce(p_motivo, ''));
  v_total   numeric;
BEGIN
  SELECT * INTO v_m FROM public.cliente_produto_modulos WHERE id = p_modulo_linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Portão. `coalesce` no super admin: NULL não pode abrir nem fechar portão
  -- por acidente (ver a auditoria de is_super_admin() de set/2026).
  SELECT p.role, coalesce(p.is_super_admin, false), p.tenant_id
    INTO v_role, v_super, v_tenant
    FROM public.profiles p
   WHERE p.user_id = auth.uid()
   LIMIT 1;

  IF NOT coalesce(v_super, false) THEN
    IF v_role IS NULL OR v_tenant IS NULL OR v_tenant <> v_m.tenant_id THEN
      RAISE EXCEPTION 'Sem permissão para corrigir o valor do módulo.' USING ERRCODE = '42501';
    END IF;

    SELECT t.rbac_enabled INTO v_rbac FROM public.tenants t WHERE t.id = v_tenant;

    -- Empresa sem RBAC: `has_perm` libera tudo para todos ali. Para uma ação
    -- que muda MRR, a regra nessas empresas é só admin.
    IF coalesce(v_rbac, false) THEN
      IF NOT public.has_perm('clientes.modulos_valor', 'view') THEN
        RAISE EXCEPTION 'Sem permissão para corrigir o valor do módulo.' USING ERRCODE = '42501';
      END IF;
    ELSIF v_role <> 'admin' THEN
      RAISE EXCEPTION 'Sem permissão para corrigir o valor do módulo.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_novo_valor IS NULL OR p_novo_valor < 0 THEN
    RAISE EXCEPTION 'Informe um valor válido.' USING ERRCODE = '22023';
  END IF;
  IF v_motivo = '' THEN
    RAISE EXCEPTION 'Informe o motivo da correção.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_m.ativo THEN
    RAISE EXCEPTION 'Módulo cancelado não pode ter o valor corrigido.' USING ERRCODE = '22023';
  END IF;
  IF round(p_novo_valor, 2) = round(coalesce(v_m.vlr_mensal, 0), 2) THEN
    RAISE EXCEPTION 'O valor informado é igual ao atual.' USING ERRCODE = '22023';
  END IF;

  -- Movimento amarrado = parte do valor mora no movimento. Corrigir só a linha
  -- deixaria os dois discordando. Qualquer status conta: um downsell de
  -- cancelamento parcial também foi calculado sobre o valor antigo.
  IF EXISTS (SELECT 1 FROM public.movimentos_mrr mv WHERE mv.cliente_produto_modulo_id = v_m.id) THEN
    RAISE EXCEPTION 'Este módulo tem movimento de MRR (upsell, downsell ou reajuste) ligado a ele. A correção direta ainda não cobre esse caso.'
      USING ERRCODE = '22023';
  END IF;

  -- O gatilho do histórico lê o motivo daqui (só nesta transação).
  PERFORM set_config('doctorsaas.motivo_valor', v_motivo, true);

  -- Sem skip_valor_sync, de propósito: é para o produto recalcular o MRR e o
  -- contrato ir ao Omie com o valor certo.
  UPDATE public.cliente_produto_modulos
     SET vlr_mensal = round(p_novo_valor, 2),
         updated_at = now()
   WHERE id = v_m.id;

  PERFORM set_config('doctorsaas.motivo_valor', '', true);

  SELECT cp.vlr_mensal INTO v_total FROM public.cliente_produtos cp WHERE cp.id = v_m.cliente_produto_id;

  RETURN jsonb_build_object(
    'anterior',       v_m.vlr_mensal,
    'novo',           round(p_novo_valor, 2),
    'produto_mensal', v_total
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_corrigir_valor_modulo(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_corrigir_valor_modulo(uuid, numeric, text) TO authenticated, service_role;
