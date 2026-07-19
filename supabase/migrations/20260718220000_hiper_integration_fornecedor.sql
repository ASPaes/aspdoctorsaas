-- Escopo da reconciliação PortalHiper: qual fornecedor (na base do tenant)
-- representa o Hiper. A reconciliação só toca clientes com
-- cliente_produtos.fornecedor_id = este valor — nem todo cliente é Hiper.
alter table public.hiper_integration
  add column if not exists fornecedor_id bigint
    references public.fornecedores (id) on delete set null;

comment on column public.hiper_integration.fornecedor_id is
  'Fornecedor (na base do tenant) que representa o Hiper; escopo da reconciliação.';
