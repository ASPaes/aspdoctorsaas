-- =============================================================================
-- Nota fiscal e ordem de serviço do título.
--
-- Pedido do Alexandre em 25/09/2026: o cliente não pede só boleto. Ele pede a
-- nota fiscal, e quando aquele título não tem nota de serviço emitida, o que
-- vale é a ordem de serviço.
--
-- O QUE JÁ EXISTIA E SE PERDIA NO CAMINHO: o espelho do Omie traz `nCodOS` em
-- 18.590 dos 18.889 títulos e `numero_documento_fiscal` em 10.772 (nos do tipo
-- NFS, 1.436 de 1.436). Nada disso chegava aqui — a listagem não repassava.
--
-- O QUE NÃO EXISTE EM LUGAR NENHUM: o link do PDF. A `chave_nfe` vem vazia em
-- 100% dos títulos (nota de serviço não usa chave como a NF-e) e a OS espelhada
-- traz `DetalhesNfse.Eventos` vazio nas 15.623. O link sai de duas chamadas ao
-- Omie, e é por isso que ele é guardado aqui em vez de buscado toda vez.
-- =============================================================================

alter table public.fin_titulos
  -- Código da OS no Omie. É a chave de tudo: com ele se pega o PDF da OS
  -- direto, e a nota por tabela (lista a NFS-e pela OS, pega o id interno dela,
  -- e só então o PDF).
  add column if not exists origem_os_id text null,
  add column if not exists numero_nf text null,

  -- Os endereços dos documentos, guardados juntos porque são buscados juntos:
  -- pdf_nfse, xml_nfse, url_oficial, pdf_os, portal.
  --
  -- Em jsonb e não em cinco colunas porque nenhum deles é filtrado ou ordenado
  -- — são endereços que a tela abre e a mensagem manda. Coluna por endereço
  -- seria cinco migrations toda vez que o Omie devolvesse mais um.
  add column if not exists documentos jsonb null,
  add column if not exists documentos_em timestamptz null;

comment on column public.fin_titulos.origem_os_id is
  'Código da ordem de serviço na origem (nCodOS no Omie). É por ele que se chega ao PDF da OS e, por tabela, ao da nota.';
comment on column public.fin_titulos.numero_nf is
  'Número da nota fiscal do título, como a origem informa. Serve para o cliente reconhecer o documento; o link mora em `documentos`.';
comment on column public.fin_titulos.documentos is
  'Endereços dos documentos deste título: pdf_nfse, xml_nfse, url_oficial, pdf_os, portal. Buscados juntos no Omie e guardados juntos.';
comment on column public.fin_titulos.documentos_em is
  'Quando os endereços foram buscados. ⚠️ Trate-os como perecíveis: o link de boleto do Omie morre em 24h e ainda não sabemos se estes expiram. Errar para o lado seguro custa uma chamada; errar para o outro entrega link quebrado ao cliente.';

-- Quem tem OS pode ter documento. É a pergunta que a tela e a 2ª via fazem.
create index if not exists idx_fin_titulos_com_os
  on public.fin_titulos (tenant_id, origem_os_id)
  where origem_os_id is not null;
