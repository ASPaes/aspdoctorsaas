-- DEM-0456 - mostrar na caixa de entrada o e-mail sem vinculo com cliente
--
-- Hoje o robo so guarda o e-mail que ele sabe encaixar: resposta com token,
-- endereco que abre ticket ou remetente que esta na ficha de um cliente. O
-- resto e descartado na leitura, sem nem baixar o corpo. Esta chave manda
-- guardar tudo o que chegar nas caixas ja lidas, por tenant.
--
-- Vale para o que chegar depois de ligada: o que foi descartado antes nao foi
-- gravado em lugar nenhum e nao tem como voltar.
--
-- Quem le a chave e a edge function ler-emails-recebidos. Ela grava direto em
-- acao = 'registrado', sem passar por fn_email_processar_recebido, para que
-- este caminho nunca abra ticket nem encha a Triagem.
--
-- Continuam fora, mesmo com a chave ligada:
--   - propaganda e resposta automatica (protecao que ja existia);
--   - e-mail que sai das nossas proprias caixas;
--   - remetente bloqueado em Parametros de Recebidos.

alter table public.email_recebidos_parametros
  add column if not exists registrar_todos boolean not null default false;

comment on column public.email_recebidos_parametros.registrar_todos is
  'DEM-0456: guarda na caixa de entrada tambem o e-mail sem vinculo com cliente. Nao abre ticket.';
