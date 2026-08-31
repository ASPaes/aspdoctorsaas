-- Vínculo de módulo passa a ser POR PRODUTO.
--
-- O desenho original tinha chave única (tenant, tipo, chave): um app do Hiper
-- apontava para UM módulo. Mas o mesmo app aparece nos dois planos — 11 dos 14
-- estão também em contas Hiper Mini (47 ocorrências) — e o módulo do
-- DoctorSaaS pertence a um produto só. Com uma chave única por nome, o app
-- apontaria para o módulo de Hiper Gestão e toda conta Mini cairia em "sem
-- produto no contrato" na importação.
--
-- Correção do desenho, não escopo novo.

alter table public.hiper_catalogo_vinculo
  drop constraint if exists hiper_catalogo_vinculo_alvo;

alter table public.hiper_catalogo_vinculo
  add constraint hiper_catalogo_vinculo_alvo check (
       (tipo = 'plano'    and produto_id is not null and modulo_id is null)
    or (tipo = 'modulo'   and modulo_id  is not null and produto_id is not null)
    or (tipo = 'contrato' and modelo_contrato_id is not null)
  );

drop index if exists public.hiper_catalogo_vinculo_unico;

-- Plano e tipo de contrato continuam com um alvo só por chave.
create unique index if not exists hiper_catalogo_vinculo_unico
  on public.hiper_catalogo_vinculo (tenant_id, tipo, chave)
  where tipo in ('plano', 'contrato');

-- Módulo: um alvo por app POR PRODUTO.
create unique index if not exists hiper_catalogo_vinculo_modulo_unico
  on public.hiper_catalogo_vinculo (tenant_id, chave, produto_id)
  where tipo = 'modulo';

comment on column public.hiper_catalogo_vinculo.produto_id is
  'Em tipo=plano é o alvo. Em tipo=modulo é o produto DONO do módulo: o mesmo app do Hiper existe nos dois planos e precisa de um módulo em cada produto.';
