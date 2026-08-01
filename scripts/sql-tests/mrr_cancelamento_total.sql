-- Teste rollback-safe do cancelamento total de MRR.
-- Roda tudo dentro de um DO e sai por RAISE EXCEPTION: o banco local não muda.
--   docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres \
--     < scripts/sql-tests/mrr_cancelamento_total.sql
--
-- Cenário = o do BECO LANCHES: contrato + upsell lançado solto (contrato_id NULL).
-- Esperado:
--   saldo antes      = contrato + upsell
--   churn gravado    = saldo antes   (antes do fix era só o valor do contrato)
--   saldo depois     = 0             (antes do fix era negativo)
--   saldo reativado  = saldo antes   (upsell volta junto)

DO $$
DECLARE
  v_cli uuid;
  v_ten uuid;
  v_ct  uuid;
  v_admin uuid;
  v_antes numeric;
  v_depois numeric;
  v_reativado numeric;
  v_churn numeric;
  v_react numeric;
  v_res jsonb;
  v_res_r jsonb;
  v_cp_ativos int;
  v_movs_vivos int;
  v_ontem numeric;
  v_movs_status_ativo int;
  v_erros text := '';
BEGIN
  SELECT c.id, c.tenant_id, ct.id
    INTO v_cli, v_ten, v_ct
  FROM clientes c
  JOIN contratos ct ON ct.cliente_id = c.id AND ct.status = 'ativo'
  WHERE c.cancelado IS NOT TRUE
    AND (SELECT count(*) FROM contratos x WHERE x.cliente_id = c.id AND x.status = 'ativo') = 1
    AND EXISTS (SELECT 1 FROM movimentos_mrr m
                 WHERE m.cliente_id = c.id AND m.tipo = 'upsell' AND m.status = 'ativo'
                   AND m.contrato_id IS NULL
                   AND m.estornado_por IS NULL AND m.estorno_de IS NULL)
  LIMIT 1;

  IF v_cli IS NULL THEN RAISE EXCEPTION 'SEM_CANDIDATO'; END IF;

  SELECT p.user_id INTO v_admin FROM profiles p WHERE p.is_super_admin = true LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_antes := public.fn_mrr_cliente_em(v_ten, v_cli, current_date);

  v_res := public.cancelar_contrato(v_ct, NULL, 'teste automatizado');
  v_depois := public.fn_mrr_cliente_em(v_ten, v_cli, current_date);

  SELECT ABS(valor_delta) INTO v_churn FROM movimentos_mrr
   WHERE contrato_id = v_ct AND tipo = 'churn' ORDER BY criado_em DESC LIMIT 1;

  SELECT count(*) INTO v_cp_ativos FROM cliente_produtos WHERE cliente_id = v_cli AND ativo;
  SELECT count(*) INTO v_movs_vivos FROM movimentos_mrr
   WHERE cliente_id = v_cli AND tipo IN ('upsell','cross_sell','downsell','reajuste')
     AND status = 'ativo' AND encerrado_em IS NULL;

  -- O passado NÃO pode ser reescrito: na véspera o cliente ainda valia o saldo cheio.
  v_ontem := public.fn_mrr_cliente_em(v_ten, v_cli, current_date - 1);
  -- E o movimento continua 'ativo' — é assim que ele segue no Net New do mês em
  -- que ocorreu, no dashboard e em get_mrr_bridge, que filtram por status.
  SELECT count(*) INTO v_movs_status_ativo FROM movimentos_mrr
   WHERE cliente_id = v_cli AND tipo IN ('upsell','cross_sell','downsell','reajuste')
     AND status = 'ativo';

  v_res_r := public.reativar_contrato(v_ct, 'teste automatizado');
  v_reativado := public.fn_mrr_cliente_em(v_ten, v_cli, current_date);
  SELECT valor_delta INTO v_react FROM movimentos_mrr
   WHERE contrato_id = v_ct AND tipo = 'reactivation' ORDER BY criado_em DESC LIMIT 1;

  IF v_churn    IS DISTINCT FROM v_antes THEN v_erros := v_erros || ' churn<>saldo_antes;'; END IF;
  IF v_depois   <> 0                     THEN v_erros := v_erros || ' saldo_pos_cancel<>0;'; END IF;
  IF v_cp_ativos <> 0                    THEN v_erros := v_erros || ' sobrou_produto_ativo;'; END IF;
  IF v_movs_vivos <> 0                   THEN v_erros := v_erros || ' sobrou_movimento_vivo;'; END IF;
  IF v_reativado IS DISTINCT FROM v_antes THEN v_erros := v_erros || ' reativado<>saldo_antes;'; END IF;
  IF v_react    IS DISTINCT FROM v_antes THEN v_erros := v_erros || ' reactivation<>saldo_antes;'; END IF;
  IF v_ontem    IS DISTINCT FROM v_antes THEN v_erros := v_erros || ' PASSADO_REESCRITO;'; END IF;
  IF v_movs_status_ativo = 0             THEN v_erros := v_erros || ' movimento_sumiu_do_net_new;'; END IF;

  RAISE EXCEPTION 'RESULTADO|saldo_antes=%|churn=%|saldo_depois=%|saldo_ONTEM=%|cp_ativos=%|movs_vivos=%|movs_status_ativo=%|saldo_reativado=%|reactivation=%|movs_encerrados=%|movs_reabertos=%|VEREDITO=%',
    v_antes, v_churn, v_depois, v_ontem, v_cp_ativos, v_movs_vivos, v_movs_status_ativo, v_reativado, v_react,
    v_res->>'movimentos_encerrados', v_res_r->>'movimentos_reabertos',
    CASE WHEN v_erros = '' THEN 'PASSOU' ELSE 'FALHOU:' || v_erros END;
END $$;
