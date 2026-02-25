-- Input validation constraints (excluding percentage fields that have legacy data issues)
ALTER TABLE public.clientes
ADD CONSTRAINT mensalidade_non_negative CHECK (mensalidade IS NULL OR mensalidade >= 0),
ADD CONSTRAINT valor_ativacao_non_negative CHECK (valor_ativacao IS NULL OR valor_ativacao >= 0),
ADD CONSTRAINT custo_operacao_non_negative CHECK (custo_operacao IS NULL OR custo_operacao >= 0),
ADD CONSTRAINT razao_social_length CHECK (razao_social IS NULL OR length(razao_social) <= 500),
ADD CONSTRAINT nome_fantasia_length CHECK (nome_fantasia IS NULL OR length(nome_fantasia) <= 500),
ADD CONSTRAINT email_length CHECK (email IS NULL OR length(email) <= 255),
ADD CONSTRAINT cnpj_length CHECK (cnpj IS NULL OR length(cnpj) <= 20);

ALTER TABLE public.movimentos_mrr
ADD CONSTRAINT descricao_length CHECK (descricao IS NULL OR length(descricao) <= 2000);

ALTER TABLE public.cs_tickets
ADD CONSTRAINT assunto_length CHECK (length(assunto) <= 500),
ADD CONSTRAINT descricao_curta_length CHECK (length(descricao_curta) <= 2000);

ALTER TABLE public.cliente_contatos
ADD CONSTRAINT contato_nome_length CHECK (length(nome) <= 300),
ADD CONSTRAINT contato_email_length CHECK (email IS NULL OR length(email) <= 255);