-- DEM-0489: Movimentos MRR ignorava o filtro de unidade.
--
-- A view é security_invoker e faz LEFT JOIN em clientes. O RLS de clientes tem
-- policy RESTRICTIVE de unidade (unidade_scope_select: unidades permitidas ao
-- usuário + unidades selecionadas no filtro global); movimentos_mrr não tem.
-- O movimento passava, o cliente era escondido e a linha saía sem nome.
-- Medido em 28/09/2026 (Digi Office, setembro): filtro em Digi Up mostrava
-- 155 movimentos, dos quais 144 eram da Digi Office.
--
-- Correção: movimento com cliente que o RLS escondeu não aparece. Movimento
-- sem cliente_id (hoje 0 linhas) continua visível.
--
-- ATENÇÃO: o WITH (security_invoker = true) é obrigatório. CREATE OR REPLACE
-- VIEW sem ele zera o reloption e a view passa a rodar como dono, ignorando o
-- RLS de todos os tenants.

CREATE OR REPLACE VIEW public.vw_movimentos_mrr
WITH (security_invoker = true)
AS
SELECT m.id,
    m.cliente_id,
    m.tipo,
    m.data_movimento,
    m.valor_delta,
    m.custo_delta,
    m.valor_venda_avulsa,
    m.origem_venda,
    m.descricao,
    m.funcionario_id,
    m.status,
    m.estorno_de,
    m.estornado_por,
    m.inativado_em,
    m.inativado_por_id,
    m.criado_em,
    m.tenant_id,
    m.cliente_produto_modulo_id,
    m.contrato_id,
    m.fornecedor_id,
    COALESCE(m.fornecedor_id, fp.fornecedor_id) AS fornecedor_efetivo,
    c.razao_social AS cliente_razao_social,
    c.nome_fantasia AS cliente_nome_fantasia,
    f.nome AS funcionario_nome,
    m.vlr_ativacao
   FROM movimentos_mrr m
     LEFT JOIN clientes c ON c.id = m.cliente_id
     LEFT JOIN funcionarios f ON f.id = m.funcionario_id
     LEFT JOIN LATERAL ( SELECT cp.fornecedor_id
           FROM cliente_produtos cp
          WHERE cp.cliente_id = m.cliente_id AND cp.fornecedor_id IS NOT NULL
          ORDER BY cp.ativo DESC, cp.created_at DESC, cp.id DESC
         LIMIT 1) fp ON true
  WHERE m.cliente_id IS NULL OR c.id IS NOT NULL;
