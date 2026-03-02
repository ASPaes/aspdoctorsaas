
-- Rodada 1: Adicionar 5 colunas em cs_tickets para Items 3 e 7
ALTER TABLE public.cs_tickets
  ADD COLUMN IF NOT EXISTS contato_externo_nome text,
  ADD COLUMN IF NOT EXISTS oport_valor_previsto_ativacao numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oport_valor_previsto_mrr numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS oport_data_prevista date,
  ADD COLUMN IF NOT EXISTS oport_resultado text;
