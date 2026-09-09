-- Candidatos de cliente por telefone: passar a considerar a variante com/sem o 9
-- do celular BR (fn_wa_phone_variants), em vez de comparar so os 10 ultimos digitos.
--
-- Motivo: contato 5531 9524-8354 (12 digitos) nao casava com o cliente cujo
-- telefone_whatsapp esta como 5531 99524-8354 (13 digitos), porque right(...,10)
-- devolve '3195248354' de um lado e '1995248354' do outro. Na pratica, telefone
-- compartilhado por duas empresas do mesmo grupo mostrava so uma delas no seletor.
--
-- Assinatura, volatilidade e grants preservados (CREATE OR REPLACE).
-- fn_wa_phone_variants ja tem EXECUTE para authenticated e service_role, que sao
-- os papeis que alcancam esta funcao pelo app e pelas edge functions.

CREATE OR REPLACE FUNCTION public.get_clientes_candidatos_by_phone(p_tenant_id uuid, p_phone text)
 RETURNS TABLE(cliente_id uuid, codigo_sequencial integer, razao_social text, nome_fantasia text, fornecedor_nome text, cancelado boolean, fonte_match text, telefone_whatsapp text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH normalized AS (
    SELECT (
      SELECT array_agg(DISTINCT right(v, 10))
      FROM unnest(public.fn_wa_phone_variants(p_phone)) AS v
      WHERE length(v) >= 10
    ) AS last10s
  ),
  match_estabelecimento AS (
    SELECT c.id AS cliente_id, 'telefone_whatsapp'::text AS fonte
    FROM clientes c, normalized n
    WHERE c.tenant_id = p_tenant_id
      AND coalesce(c.cancelado, false) = false
      AND n.last10s IS NOT NULL
      AND right(regexp_replace(coalesce(c.telefone_whatsapp, ''), '\D', '', 'g'), 10) = ANY (n.last10s)
  ),
  match_contatos AS (
    SELECT DISTINCT cc.cliente_id, 'cliente_contatos'::text AS fonte
    FROM cliente_contatos cc, normalized n
    WHERE cc.tenant_id = p_tenant_id
      AND n.last10s IS NOT NULL
      AND right(regexp_replace(coalesce(cc.fone, ''), '\D', '', 'g'), 10) = ANY (n.last10s)
  ),
  unioned AS (
    SELECT * FROM match_estabelecimento
    UNION ALL
    SELECT * FROM match_contatos
  ),
  deduplicated AS (
    SELECT cliente_id, string_agg(DISTINCT fonte, ',' ORDER BY fonte) AS fonte_agg
    FROM unioned
    GROUP BY cliente_id
  )
  SELECT
    c.id,
    c.codigo_sequencial,
    c.razao_social,
    c.nome_fantasia,
    f.nome AS fornecedor_nome,
    coalesce(c.cancelado, false) AS cancelado,
    d.fonte_agg,
    c.telefone_whatsapp
  FROM deduplicated d
  JOIN clientes c ON c.id = d.cliente_id
  LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
  WHERE c.tenant_id = p_tenant_id
    AND coalesce(c.cancelado, false) = false
  ORDER BY c.codigo_sequencial NULLS LAST, c.nome_fantasia NULLS LAST;
$function$;
