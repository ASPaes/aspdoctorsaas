-- DEM-0277: no maximo um resumo sendo gerado por grupo.
--
-- A summarize-whatsapp-group ja confere antes de gravar, mas entre a conferencia
-- e o INSERT ha uma janela de milissegundos: dois cliques juntos passariam e a
-- IA seria paga duas vezes. O indice fecha a janela; a function trata o 23505
-- como "ja existe um resumo sendo gerado".
--
-- Tabela nova e pequena: o indice e instantaneo e nao trava tabela quente.

begin;

set local lock_timeout = '5s';

create unique index if not exists uq_wa_group_summaries_one_generating
  on public.whatsapp_group_summaries (conversation_id)
  where status = 'generating';

commit;
