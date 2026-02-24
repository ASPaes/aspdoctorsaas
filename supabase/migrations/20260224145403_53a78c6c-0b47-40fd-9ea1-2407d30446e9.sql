
-- 1. Adicionar campos de certificado na tabela clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cert_a1_vencimento date,
  ADD COLUMN IF NOT EXISTS cert_a1_ultima_venda_em date,
  ADD COLUMN IF NOT EXISTS cert_a1_ultimo_vendedor_id bigint REFERENCES funcionarios(id);

-- 2. Criar tabela certificado_a1_vendas
CREATE TABLE IF NOT EXISTS certificado_a1_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  data_venda date NOT NULL,
  valor_venda numeric,
  vendedor_id bigint REFERENCES funcionarios(id),
  observacao text,
  status text NOT NULL DEFAULT 'ganho' CHECK (status IN ('ganho', 'perdido_terceiro')),
  data_base_renovacao date,
  motivo_perda text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE certificado_a1_vendas ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'certificado_a1_vendas' AND policyname = 'auth_read_certificado_a1_vendas') THEN
    CREATE POLICY "auth_read_certificado_a1_vendas" ON certificado_a1_vendas FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'certificado_a1_vendas' AND policyname = 'auth_write_certificado_a1_vendas') THEN
    CREATE POLICY "auth_write_certificado_a1_vendas" ON certificado_a1_vendas FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Trigger para atualizar campos do cliente ao registrar venda
CREATE OR REPLACE FUNCTION public.trg_cert_a1_venda_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  novo_vencimento date;
BEGIN
  IF NEW.status = 'perdido_terceiro' AND NEW.data_base_renovacao IS NOT NULL THEN
    novo_vencimento := NEW.data_base_renovacao + interval '12 months';
  ELSE
    novo_vencimento := NEW.data_venda + interval '12 months';
  END IF;

  UPDATE clientes SET
    cert_a1_vencimento = novo_vencimento,
    cert_a1_ultima_venda_em = NEW.data_venda,
    cert_a1_ultimo_vendedor_id = NEW.vendedor_id
  WHERE id = NEW.cliente_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cert_a1_venda_after_insert ON certificado_a1_vendas;
CREATE TRIGGER cert_a1_venda_after_insert
  AFTER INSERT ON certificado_a1_vendas
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_cert_a1_venda_after_insert();

-- 4. Recriar view com novos campos
DROP VIEW IF EXISTS vw_clientes_financeiro;

CREATE VIEW vw_clientes_financeiro AS
SELECT c.id,
    c.data_cadastro,
    c.razao_social,
    c.nome_fantasia,
    c.cnpj,
    c.email,
    c.telefone_contato,
    c.telefone_whatsapp,
    c.observacao_cliente,
    c.estado_id,
    c.cidade_id,
    c.area_atuacao_id,
    c.segmento_id,
    c.vertical_id,
    c.data_venda,
    c.funcionario_id,
    c.origem_venda,
    c.recorrencia,
    c.observacao_negociacao,
    c.produto_id,
    c.valor_ativacao,
    c.forma_pagamento_ativacao_id,
    c.mensalidade,
    c.forma_pagamento_mensalidade_id,
    c.custo_operacao,
    c.imposto_percentual,
    c.custo_fixo_percentual,
    c.cancelado,
    c.data_cancelamento,
    c.motivo_cancelamento_id,
    c.observacao_cancelamento,
    c.created_at,
    c.updated_at,
    c.cert_a1_vencimento,
    c.cert_a1_ultima_venda_em,
    c.cert_a1_ultimo_vendedor_id,
    c.mensalidade - c.custo_operacao AS valor_repasse,
    c.mensalidade * c.imposto_percentual AS impostos_rs,
    c.mensalidade * c.custo_fixo_percentual AS fixos_rs,
    c.mensalidade - c.custo_operacao - c.mensalidade * c.imposto_percentual AS lucro_bruto,
    CASE
        WHEN c.mensalidade IS NULL OR c.mensalidade = 0::numeric THEN NULL::numeric
        ELSE (c.mensalidade - c.custo_operacao - c.mensalidade * c.imposto_percentual) / c.mensalidade * 100::numeric
    END AS margem_bruta_percent,
    CASE
        WHEN c.custo_operacao IS NULL OR c.custo_operacao = 0::numeric THEN NULL::numeric
        ELSE (c.mensalidade / c.custo_operacao - 1::numeric) * 100::numeric
    END AS markup_cogs_percent,
    CASE
        WHEN c.custo_operacao IS NULL OR c.custo_operacao = 0::numeric THEN NULL::numeric
        ELSE c.mensalidade / c.custo_operacao
    END AS fator_preco_cogs_x,
    c.mensalidade - c.custo_operacao - c.mensalidade * c.imposto_percentual - c.mensalidade * c.custo_fixo_percentual AS margem_contribuicao,
    c.mensalidade - c.custo_operacao - c.mensalidade * c.imposto_percentual - c.mensalidade * c.custo_fixo_percentual AS lucro_real
   FROM clientes c;
