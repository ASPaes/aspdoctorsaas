-- Modulo novo nao apaga a receita digitada no produto.
--
-- Caso: SALOMAO JORGE FILHO (Digi), 30/09/2026. Produto com receita DIGITADA
-- (R$ 478, zero modulos). O Up-Sell da calculadora inseriu o 1o modulo (NFC-e
-- R$ 36); fn_sync_produto_valores viu "todos os modulos ativos tem valor" e
-- trocou a receita do produto pela soma deles: 478 -> 36. E como
-- fn_receita_vem_dos_modulos passou a dizer "sim", ninguem lancou o upsell.
-- O mesmo buraco existia na tela (ModuloDialog) e na fila do OEM: todos
-- medem a regra DEPOIS de gravar.
--
-- A regra "todos pagos" nao tem memoria: ela nao distingue "a receita sempre
-- foi a soma dos modulos" de "o produto tinha valor digitado e acabou de
-- ganhar o 1o modulo". A correcao da memoria as duas pontas:
--
-- 1) fn_receita_vem_dos_modulos: alem de todos pagos, exige que o valor do
--    produto SEJA a soma dos modulos. Receita digitada que nao bate com a soma
--    e digitada — o modulo novo vira upsell (valor no movimento).
-- 2) fn_sync_produto_valores: so reescreve o produto com a soma quando, ANTES
--    desta escrita, a receita ja vinha dos modulos (ou o produto estava em 0,
--    que e o produto sendo montado pelos modulos). Senao preserva o digitado.
--
-- Medido em prod 30/09: 4 produtos tem receita dos modulos; 3 continuam
-- iguais. J. BIASOLI (CTM, 1752,46 x soma 1753,46 desde jun/2026) passa a ser
-- tratado como digitado: modulo novo nele vira movimento, nao reescrita.
-- Nenhum valor gravado muda com esta migration.

CREATE OR REPLACE FUNCTION public.fn_receita_vem_dos_modulos(p_cliente_produto_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT count(*) > 0
        AND bool_and(coalesce(m.vlr_mensal, 0) > 0)
        AND sum(coalesce(m.vlr_mensal, 0) * m.quantidade)
            = (SELECT coalesce(cp.vlr_mensal, 0) FROM public.cliente_produtos cp
                WHERE cp.id = p_cliente_produto_id)
       FROM public.cliente_produto_modulos m
      WHERE m.cliente_produto_id = p_cliente_produto_id
        AND m.ativo = true),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_produto_valores()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente_produto_id uuid;
  v_soma_mensal numeric;
  v_soma_custo numeric;
  v_count_ativos integer;
  v_tem_oem boolean;
  v_todos_pagos boolean;
  v_prod_mensal numeric;
  v_n_antes integer;
  v_pagos_antes boolean;
  v_soma_antes numeric;
  v_era_dos_modulos boolean;
BEGIN
  IF current_setting('doctorsaas.skip_valor_sync', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_cliente_produto_id := OLD.cliente_produto_id;
  ELSE
    v_cliente_produto_id := NEW.cliente_produto_id;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(vlr_mensal, 0) * quantidade), 0),
    -- O total do parceiro manda no custo; sem ele, multiplica.
    COALESCE(SUM(COALESCE(vlr_custo_total, COALESCE(vlr_custo, 0) * quantidade)), 0),
    COUNT(*),
    COALESCE(bool_or(origem = 'oem'), false),
    COALESCE(bool_and(COALESCE(vlr_mensal, 0) > 0), false)
  INTO v_soma_mensal, v_soma_custo, v_count_ativos, v_tem_oem, v_todos_pagos
  FROM cliente_produto_modulos
  WHERE cliente_produto_id = v_cliente_produto_id
    AND ativo = true;

  -- Sem módulo ativo não há de onde tirar número: preserva o que está gravado.
  IF v_count_ativos = 0 THEN
    UPDATE cliente_produtos SET updated_at = now() WHERE id = v_cliente_produto_id;
    RETURN NULL;
  END IF;

  -- Como estavam os módulos ANTES desta escrita: os de agora sem a linha
  -- tocada, mais a versão antiga dela. O gatilho é AFTER, então a linha nova
  -- já está na tabela e precisa sair da conta. O produto ainda não foi
  -- reescrito (este gatilho é quem reescreve), então o valor dele é o de antes.
  -- Em DELETE o NEW é nulo (a linha já saiu da tabela): o `TG_OP = 'DELETE' OR`
  -- é o que mantém as outras linhas.
  SELECT count(*),
         coalesce(bool_and(coalesce(x.vlr_mensal, 0) > 0), false),
         coalesce(sum(coalesce(x.vlr_mensal, 0) * x.quantidade), 0)
    INTO v_n_antes, v_pagos_antes, v_soma_antes
    FROM (
      SELECT m.vlr_mensal, m.quantidade
        FROM cliente_produto_modulos m
       WHERE m.cliente_produto_id = v_cliente_produto_id
         AND m.ativo = true
         AND (TG_OP = 'DELETE' OR m.id <> NEW.id)
      UNION ALL
      SELECT OLD.vlr_mensal, OLD.quantidade
       WHERE TG_OP <> 'INSERT'
         AND OLD.ativo = true
         AND OLD.cliente_produto_id = v_cliente_produto_id
    ) x;

  SELECT coalesce(vlr_mensal, 0) INTO v_prod_mensal
    FROM cliente_produtos WHERE id = v_cliente_produto_id;

  -- Produto em 0 = sendo montado pelos módulos. Fora isso, a receita só era
  -- dos módulos se todos tinham valor E o produto valia exatamente a soma.
  v_era_dos_modulos := v_prod_mensal = 0
                    OR (v_n_antes > 0 AND v_pagos_antes AND v_prod_mensal = v_soma_antes);

  -- A receita só é dos módulos quando TODOS têm valor — e já era antes desta
  -- escrita. Sem a 2ª condição, o 1º módulo pago de um produto com receita
  -- digitada substituía a receita inteira pela dele (SALOMAO, 30/09/2026).
  IF v_todos_pagos AND v_soma_mensal <> 0 AND v_era_dos_modulos THEN
    UPDATE cliente_produtos
       SET vlr_mensal = v_soma_mensal,
           vlr_custo  = v_soma_custo,
           updated_at = now()
     WHERE id = v_cliente_produto_id;
    RETURN NULL;
  END IF;

  -- Receita é a digitada no produto. O custo, quando vem do parceiro, continua
  -- seguindo os módulos: quem dá unidade grátis é o OEM, e é ele quem sabe.
  IF v_tem_oem THEN
    UPDATE cliente_produtos
       SET vlr_custo  = v_soma_custo,
           updated_at = now()
     WHERE id = v_cliente_produto_id;
  ELSE
    UPDATE cliente_produtos SET updated_at = now() WHERE id = v_cliente_produto_id;
  END IF;

  RETURN NULL;
END;
$function$;
