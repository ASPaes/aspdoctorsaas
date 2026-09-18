-- ============================================================================
-- CATÁLOGO DE CLIENTES — revisão com o owner (18/09/2026)
--
-- O que motivou: a tela oferecia I/E/X em linhas que não têm essas ações, e
-- escondia os I/E/X que decidem de verdade. O owner leu a linha "Dados
-- cadastrais" como se ela fosse o cadastro inteiro — e estava certo: quem
-- controla incluir/editar/excluir cliente é a chave do módulo, `clientes`.
--
-- Decisões (todas dele):
--   · O cadastro é UMA linha, a entrada: V abre · I inclui · E edita · X exclui.
--     Saem "Abrir a ficha", "Dados cadastrais" e "Excluir tudo".
--   · "Contatos adicionais" mantém ações próprias — é a única sub-seção com
--     gravação independente do botão Salvar.
--   · "Filiais" sai: é lista de leitura que some sozinha quando não há filial.
--   · "Financeiro" vira seção própria, com "Custos e Margens" DENTRO dela.
--     Nasce com o valor de hoje (só quem tinha Custos e Margens), para a
--     reorganização não dar acesso a dinheiro sozinha.
--   · Chip só aparece se o código consulta aquela ação. No módulo Clientes
--     isso apaga 24 chips decorativos.
-- ============================================================================
begin;

-- ------------------------------------------- a entrada carrega o cadastro
update public.resources
   set label = 'Clientes',
       description = 'V abre o módulo e a ficha · I inclui cliente · E edita o cadastro (é o que libera o botão Salvar) · X exclui tudo do cliente.',
       where_it_appears = 'Menu › Clientes',
       acoes = '{view,insert,update,delete}'
 where key = 'clientes';

-- Filhos pendurados nas chaves que vão sumir passam para a entrada.
update public.resources set parent_key = 'clientes'
 where parent_key in ('clientes.ficha','clientes.dados');

-- ------------------------------------ Financeiro vira seção, custos dentro
update public.resources
   set label = 'Financeiro', secao = 'aba', grupo = 'Ficha do cliente', grupo_ordem = 20,
       parent_key = 'clientes', display_order = 119, acoes = '{view}',
       description = 'Mensalidade, faturamento e composição do valor do cliente.',
       where_it_appears = 'Ficha do cliente › Financeiro'
 where key = 'clientes.financeiro';

update public.resources
   set label = 'Custos e Margens', parent_key = 'clientes.financeiro', display_order = 120,
       acoes = '{view}',
       description = 'Custo de operação, impostos e margem. Fica dentro do Financeiro.',
       where_it_appears = 'Ficha do cliente › Financeiro › Custos e Margens'
 where key = 'clientes.custos';

-- ------------------------------------------------- saem do catálogo (4)
-- O CASCADE de resource_key leva as regras de grupo junto. `clientes.purge`
-- some porque virou a ação EXCLUIR da entrada, que já responde igual hoje
-- (admin sim, gestor e operador não).
delete from public.resources
 where key in ('clientes.ficha','clientes.dados','clientes.filiais','clientes.purge');

-- ------------------------------- chip só existe se o código consulta a ação
update public.resources set acoes = '{view}'
 where module_id = 'clientes' and key not in ('clientes','clientes.contatos');

update public.resources
   set acoes = '{view,insert,delete}',
       description = 'Telefones e e-mails das pessoas do cliente. Incluir e excluir gravam na hora, fora do botão Salvar.'
 where key = 'clientes.contatos';

-- O V desta chave é que libera GRAVAR módulo e mexer na licença OEM — o texto
-- precisa dizer isso, senão o admin lê "ver" e desliga achando que esconde.
update public.resources
   set description = 'Ligado, a pessoa pode alterar os produtos e módulos do cliente e mexer na licença OEM.'
 where key = 'clientes.modulos';

commit;
