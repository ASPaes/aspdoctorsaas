-- ============================================================================
-- Módulo que entra pela fila nasce com o custo que o parceiro cobra.
--
-- O Estoque das Sorvetes Real ficou com **Vlr Custo R$ 0,00** na ficha enquanto
-- o OEM cobra **R$ 3,00**. A causa: a `fn_oem_fila_aplicar` grava o custo do
-- `payload->>'vlr_custo'`, e a calculadora não manda custo — quem manda é o
-- diálogo da tela, que já preenche o campo com o preço do parceiro.
--
-- ⚠️ **E a carga do espelho NÃO conserta isso sozinha.** Eu disse que
-- consertaria e estava errado: `trg_oem_espelhar_modulos` tem
-- `IF NEW.modulos IS NOT DISTINCT FROM OLD.modulos THEN RETURN NULL`. Ela só
-- roda quando a lista de módulos do parceiro MUDA. Medido: o espelho da filial
-- 23272 foi relido em 04/09 00:17 com o Estoque a R$ 3,00 e as linhas da ficha
-- continuaram intocadas, com `updated_at` de 03/09 23:41. Uma linha fora de
-- passo com um espelho que não muda fica fora de passo para sempre.
--
-- `fn_oem_custo_do_modulo` repete a mesma régua do diálogo da tela, na mesma
-- ordem e pelo mesmo motivo:
--
--   1. **A licença primeiro** — o que o parceiro cobra DESTE cliente vale mais
--      que o preço de lista, porque o OEM dá unidade grátis e crédito. Cobrança
--      total zero é custo zero, mesmo com unitário preenchido: mostrar o
--      unitário faria a ficha cobrar um custo que o parceiro não cobra de nós.
--   2. **A tabela como reserva** — módulo que ainda não está ativo na licença
--      não aparece no passo 1, e o preço de lista é o que ele vai passar a
--      custar. Casa por **código**, nunca por nome: o OEM chama o mesmo módulo
--      de dois jeitos entre a licença e a grade.
--
-- Quem já manda `vlr_custo` no payload não é afetado — a tela continua mandando
-- o que está no campo, inclusive zero quando o módulo não é do parceiro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_oem_custo_do_modulo(
  p_tenant_id uuid,
  p_cliente_produto_id uuid,
  p_modulo_codigo integer
) RETURNS numeric
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_filial   text;
  v_produto  bigint;
  v_modulos  jsonb;
  v_princ    text;
  v_conta    uuid;
  v_codigo   text;
  v_unit     numeric;
  v_total    numeric;
  v_valor    numeric;
BEGIN
  IF p_modulo_codigo IS NULL THEN RETURN NULL; END IF;

  SELECT cp.oem_codigo_filial, cp.produto_id
    INTO v_filial, v_produto
    FROM public.cliente_produtos cp WHERE cp.id = p_cliente_produto_id;
  IF v_filial IS NULL THEN RETURN NULL; END IF;

  ------------------------------------------------------------------ licença
  SELECT ef.modulos, ef.produto_principal
    INTO v_modulos, v_princ
    FROM public.oem_espelho_filial ef
   WHERE ef.tenant_id = p_tenant_id
     AND ef.filial_codigo = v_filial
   ORDER BY ef.atualizado_em DESC
   LIMIT 1;

  IF jsonb_typeof(v_modulos) = 'array' THEN
    SELECT coalesce(x.valor_unitario, x."valorUnitario", 0),
           coalesce(x.valor_total, x."valorTotal", x.total, 0)
      INTO v_unit, v_total
      FROM jsonb_to_recordset(v_modulos)
             AS x(codigo int, ativo boolean,
                  valor_unitario numeric, "valorUnitario" numeric,
                  valor_total numeric, "valorTotal" numeric, total numeric)
     WHERE x.codigo = p_modulo_codigo
       AND coalesce(x.ativo, true) = true
     LIMIT 1;

    IF FOUND THEN
      RETURN CASE WHEN coalesce(v_total,0) = 0 THEN 0 ELSE coalesce(v_unit,0) END;
    END IF;
  END IF;

  ------------------------------------------------------------------- tabela
  -- Um produto do DoctorSaaS pode estar vinculado a mais de uma coluna do
  -- parceiro. Desempata pelo produto principal da filial, e sem resposta fica
  -- a primeira — a mesma que a tela de Produtos & Módulos abre por padrão.
  SELECT v.conta_integration_id, v.produto_codigo
    INTO v_conta, v_codigo
    FROM public.oem_produto_vinculo v
   WHERE v.produto_id = v_produto
   ORDER BY (public.fn_norm_nome_modulo(coalesce(v_princ,'')) <> ''
             AND (public.fn_norm_nome_modulo(v.produto_codigo) = public.fn_norm_nome_modulo(v_princ)
               OR public.fn_norm_nome_modulo(coalesce(v.produto_nome,'')) = public.fn_norm_nome_modulo(v_princ))) DESC,
            v.criado_em
   LIMIT 1;

  IF v_conta IS NULL THEN RETURN NULL; END IF;

  SELECT p.valor_unitario INTO v_valor
    FROM public.oem_espelho_modulo_preco p
   WHERE p.conta_integration_id = v_conta
     AND p.produto_codigo = v_codigo
     AND p.modulo_codigo = p_modulo_codigo
   LIMIT 1;

  RETURN v_valor;
END;
$$;

ALTER FUNCTION public.fn_oem_custo_do_modulo(uuid, uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_custo_do_modulo(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_custo_do_modulo(uuid, uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_oem_custo_do_modulo(uuid, uuid, integer) IS
'Quanto o parceiro cobra por uma unidade de um modulo naquela licenca: a licenca primeiro (oem_espelho_filial.modulos, cobranca total zero = custo zero), a grade de precos como reserva (oem_espelho_modulo_preco, casada por codigo). Mesma regua do dialogo de Adicionar Modulo. NULL quando o modulo nao e do parceiro.';
