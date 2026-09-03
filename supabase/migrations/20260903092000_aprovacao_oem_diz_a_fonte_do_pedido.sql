-- ============================================================================
-- A fila de aprovação passa a devolver a fonte do pedido.
--
-- `pedido_por` sai de `profiles → funcionarios` pelo `usuario_id` da linha.
-- Pedido vindo da calculadora não tem usuário, então a aba mostraria
-- "Pedido por —" para justamente o tipo de pedido que ninguém da casa digitou.
--
-- A função devolve o FATO (`fonte`); o rótulo fica na tela, junto dos outros.
-- Só isso muda: uma chave a mais no jsonb_build_object.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_listar(
  p_tenant_id uuid DEFAULT NULL::uuid,
  p_unidades bigint[] DEFAULT NULL::bigint[],
  p_limite integer DEFAULT 200,
  p_historico integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
BEGIN
  IF NOT public.fn_oem_aprovacao_pode(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    WITH linhas AS (
      SELECT
        f.id,
        f.acao,
        f.status,
        f.quantidade,
        f.enfileirado_em,
        f.decidido_em,
        f.motivo_recusa,
        f.ultimo_erro,
        f.payload,
        f.cliente_produto_id,
        cp.cliente_id,
        coalesce(c.nome_fantasia, c.razao_social)                    AS cliente,
        -- Os três separados, para a tela poder mostrar o de baixo sem repetir o
        -- de cima e sem ninguém precisar abrir a ficha para conferir quem é.
        c.razao_social,
        c.nome_fantasia,
        c.cnpj,
        c.unidade_base_id,
        ub.nome                                                      AS unidade,
        pr.nome                                                      AS produto,
        coalesce(pm_cat.nome, pm_linha.nome)                         AS modulo,
        -- Só faz sentido em 'quantidade': é o "de" do "de 2 para 5".
        cpm.quantidade                                               AS quantidade_atual,
        -- O "de" de quem JÁ foi aplicado. Ver o aviso no cabeçalho: aqui a
        -- linha do módulo já mudou, e `quantidade_atual` diria o número novo.
        coalesce(
          nullif(f.resposta->'ficha'->'ficha'->>'quantidade_antes', ''),
          nullif(f.resposta->'oem'->'conferencia'->>'antes', ''),
          nullif(f.resposta->'conferencia'->>'antes', '')
        )::numeric                                                   AS quantidade_antes,
        fp.nome                                                      AS pedido_por,
        fd.nome                                                      AS decidido_por,
        CASE WHEN f.status = 'aguardando_aprovacao' THEN 0 ELSE 1 END AS ordem
      FROM public.oem_sync_fila f
      LEFT JOIN public.cliente_produtos cp        ON cp.id = f.cliente_produto_id
      LEFT JOIN public.clientes c                 ON c.id  = cp.cliente_id
      LEFT JOIN public.unidades_base ub           ON ub.id = c.unidade_base_id
      LEFT JOIN public.produtos pr                ON pr.id = cp.produto_id
      LEFT JOIN public.produto_modulos pm_cat     ON pm_cat.id = f.modulo_catalogo_id
      LEFT JOIN public.cliente_produto_modulos cpm ON cpm.id = f.modulo_linha_id
      LEFT JOIN public.produto_modulos pm_linha   ON pm_linha.id = cpm.modulo_id
      LEFT JOIN public.profiles prof_p            ON prof_p.user_id = f.usuario_id
      LEFT JOIN public.funcionarios fp            ON fp.id = prof_p.funcionario_id
      LEFT JOIN public.profiles prof_d            ON prof_d.user_id = f.decidido_por
      LEFT JOIN public.funcionarios fd            ON fd.id = prof_d.funcionario_id
      WHERE f.tenant_id = v_tenant
        AND (f.status = 'aguardando_aprovacao' OR f.decidido_em IS NOT NULL)
        AND (p_unidades IS NULL
             OR c.unidade_base_id IS NULL
             OR c.unidade_base_id = ANY(p_unidades))
    ),
    recorte AS (
      (SELECT * FROM linhas WHERE ordem = 0
        ORDER BY enfileirado_em
        LIMIT greatest(coalesce(p_limite, 200), 1))
      UNION ALL
      (SELECT * FROM linhas WHERE ordem = 1
        ORDER BY decidido_em DESC
        LIMIT greatest(coalesce(p_historico, 30), 0))
    )
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',                 r.id,
               'acao',               r.acao,
               'status',             r.status,
               -- O que a tela precisa dizer em uma palavra. 'aprovado' cobre a
               -- linha que já foi ao parceiro e a que ele recusou: o resultado
               -- do envio vai em `status`/`ultimo_erro`, separado da decisão de
               -- quem aprovou. Misturar os dois faria uma recusa do OEM parecer
               -- recusa do admin.
               'situacao',           CASE WHEN r.status = 'aguardando_aprovacao' THEN 'aguardando'
                                          WHEN r.status = 'recusado'             THEN 'recusado'
                                          ELSE 'aprovado' END,
               'cliente_id',         r.cliente_id,
               'cliente',            r.cliente,
               'razao_social',       r.razao_social,
               'nome_fantasia',      r.nome_fantasia,
               'cnpj',               r.cnpj,
               'unidade_base_id',    r.unidade_base_id,
               'unidade',            r.unidade,
               'produto',            r.produto,
               'modulo',             r.modulo,
               'quantidade',         r.quantidade,
               'quantidade_atual',   r.quantidade_atual,
               'quantidade_antes',   r.quantidade_antes,
               'quantidade_cancelar',nullif(r.payload->>'quantidade_cancelar','')::numeric,
               'vlr_mensal',         nullif(r.payload->>'vlr_mensal','')::numeric,
               'vlr_custo',          nullif(r.payload->>'vlr_custo','')::numeric,
               'vlr_ativacao',       coalesce(nullif(r.payload->>'vlr_ativacao','')::numeric,
                                              nullif(r.payload->>'vlr_ativacao_somar','')::numeric),
               'valor_downsell',     nullif(r.payload->>'valor_downsell','')::numeric,
               'motivo',             r.payload->>'motivo',
               'pedido_por',         r.pedido_por,
               -- Pedido sem usuário não é anônimo: veio de uma integração, e a
               -- tela precisa poder dizer qual.
               'fonte',              nullif(r.payload->>'fonte',''),
               'enfileirado_em',     r.enfileirado_em,
               'decidido_por',       r.decidido_por,
               'decidido_em',        r.decidido_em,
               'motivo_recusa',      r.motivo_recusa,
               'ultimo_erro',        r.ultimo_erro
             )
             -- Aguardando primeiro, do mais antigo para o mais novo (FIFO: quem
             -- pediu antes espera menos). O histórico embaixo, do mais recente.
             ORDER BY r.ordem,
                      CASE WHEN r.ordem = 0 THEN r.enfileirado_em END ASC,
                      r.decidido_em DESC
           )
      FROM recorte r
  ), '[]'::jsonb);
END;
$$;

ALTER FUNCTION public.fn_oem_aprovacao_listar(uuid, bigint[], integer, integer) OWNER TO postgres;
