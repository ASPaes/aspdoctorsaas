-- Cor do produto no selo da lista de conversas do chat.
-- Escolhida em Configurações › Cadastros › Comercial › Produtos.
--
-- Guarda a CHAVE da paleta (ex.: 'verde'), não um hex: a paleta vive no
-- frontend (src/lib/produtoCores.ts) com um tom para o tema claro e outro para
-- o escuro. Hex livre deixaria o usuário escolher amarelo-claro no tema claro,
-- ilegível.
--
-- NULL = cor padrão (azul-claro), a que todo produto mostra hoje. Chave que o
-- frontend não conhece também cai no padrão, por isso não há CHECK: aumentar a
-- paleta não exige migration.
--
-- Nullable e sem default: só metadado, não reescreve a tabela.
alter table public.produtos add column if not exists cor text;

comment on column public.produtos.cor is
  'Chave da paleta de src/lib/produtoCores.ts para o selo do produto no chat. NULL = padrão (azul-claro).';
