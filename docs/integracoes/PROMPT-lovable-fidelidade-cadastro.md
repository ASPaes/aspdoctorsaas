# Prompt para o Lovable — completar o payload do intake de proposta

> Cole este documento inteiro no Lovable do sistema de propostas (Calculadora).
> Ele é um **pedido de mudança** sobre a integração que já existe e está no ar.
> O contrato completo continua em `BRIEFING-lovable-intake-proposta.md`; aqui está
> só o que muda. Data desta versão: 03/09/2026.

---

## Contexto

A integração com o DoctorSaaS funciona: a venda entra, cria cliente, contrato e
ticket de implantação. O problema é outro — **o cadastro chega incompleto**. Quem
recebe a venda do outro lado precisa preencher à mão, todas as vezes, uma lista
de campos que o sistema de propostas **já tem na tela**.

Em 03/09/2026 o DoctorSaaS foi ajustado para gravar **fiel** o que o payload
manda: ele não deriva, não compõe e não normaliza mais nada por conta própria.
Campo que não vem fica em branco, e a resposta passa a trazer um aviso
`cadastro_incompleto` dizendo exatamente o que faltou.

Ou seja: **agora tudo depende do que vocês enviam.** Os campos abaixo são todos
aceitos e gravados hoje mesmo (exceto os três marcados como bloqueados).

Nada aqui quebra o que já funciona. Todos os campos novos são **opcionais** no
protocolo e **aditivos**: o payload de hoje continua sendo aceito exatamente como
está.

---

## Resultado do primeiro teste — 03/09/2026, 20h28

**A venda nova passou.** O cliente foi criado com razão social da Receita e nome
fantasia separados, data de cadastro, área de atuação, segmento, fone do contato
e a observação com a composição da mensalidade. O contrato entrou com a vigência
em branco e o próximo reajuste em 01/09/2027, exatamente como enviado. Telefone
chegou com o `55`. **14 dos 18 campos.**

Dois acertos importantes de vocês: o aviso que apareceu na tela dizendo "sem
razão social (consulta de CNPJ)" era **falso alarme** — a razão social chegou
correta e completa. E o bloqueio de "Itens sem mapeamento: Implantação Presencial
(serviço) · soma do setup 1300 ≠ total 1550" foi resolvido no envio final, que
veio com os 1550 certos. Ver a regra na Tarefa 7 para não voltar.

**Falta o seguinte** (nenhum é problema do DoctorSaaS, simplesmente não vem no
payload):

| Campo | Onde |
|---|---|
| `fornecedor_id` | `produtos[]` |
| `modelo_contrato_id` | `produtos[]` |
| `vlr_custo` | `produtos[]` — gravou 0 |
| anexo com `campo_label: "Contrato assinado"` | `anexos[]` — vieram 4 anexos, nenhum com esse rótulo |

**Os dois up-sells foram recusados.** Causa na Tarefa 6 — é a mudança mais
importante desta versão.

---

## Tarefa 1 — enviar o ID dos campos que a tela já pergunta

Estas quatro perguntas já existem no formulário e a resposta já vai no bloco
`proposta.respostas_ticket` **como texto**. O payload manda `null` nos campos
correspondentes. Passem a mandar o **ID do catálogo**.

| Pergunta na tela | Campo do payload | Catálogo do GET |
|---|---|---|
| Segmento | `cliente.segmento_id` | `segmentos` |
| Origem da venda | `comercial.origem_venda_id` | `origens_venda` |
| Vendedor | `comercial.funcionario_id` | `vendedores` |
| Forma pg Setup | `comercial.forma_pagamento_ativacao_id` | `formas_pagamento` |

Sobre o vendedor: nos payloads de up-sell vocês **já mandam** `funcionario_id`
(153, 148). Na venda nova de 31/08 veio `null` com a resposta "Vendedor"
preenchida. O de-para existe e falhou nesse caminho — vale conferir por quê.

Sobre a forma de pagamento: a resposta é `"Cartão 12x"`. O DoctorSaaS só tem a
forma (`Cartão`), não o número de parcelas. Mandem o ID da forma; o "12x", se
quiserem preservar, cabe em `produtos[].observacoes_contratuais`.

---

## Tarefa 2 — campos novos no payload, com dado que vocês já têm

### 2.1 · Razão social e nome fantasia são **dois campos separados**

Este é o item mais importante da lista.

Hoje existe uma pergunta só, "Nome do cliente", e a resposta dela vai em
`cliente.razao_social`. Só que o que o vendedor digita ali é o **nome fantasia**.
Resultado: a razão social do cadastro fica errada e o nome fantasia fica vazio.

O que fazer:

- `cliente.razao_social` → a razão social **da consulta de CNPJ**, feita do lado
  de vocês. Não digitada.
- `cliente.nome_fantasia` → o que hoje é a pergunta "Nome do cliente".

Na venda de 31/08 a Receita tinha a razão social correta e o nome fantasia
vazio. O DoctorSaaS consulta o CNPJ por conta própria **apenas quando o campo
chega em branco** — ele nunca corrige um campo que veio preenchido, e não vai
passar a corrigir. Quem manda o dado certo é o sistema de propostas.

### 2.2 · Bloco `cliente`

| Campo | Tipo | De onde tirar |
|---|---|---|
| `data_cadastro` | `AAAA-MM-DD` | pergunta nova (ver Tarefa 3) |
| `contato_fone` | só dígitos | a resposta "Telefone proprietário (cobrança)" |
| `observacao_cliente` | texto livre | o detalhamento da mensalidade, item por item |

Sobre `observacao_cliente`: o texto esperado é a composição da mensalidade, uma
linha por item mais o total — exatamente o que vocês já têm em
`proposta.itens` (nome, quantidade, mrr). Montem o texto **do lado de vocês** e
mandem pronto. O DoctorSaaS não compõe esse texto: é conteúdo, não formatação.

### 2.3 · Bloco `produtos[]`

| Campo | Tipo | Observação |
|---|---|---|
| `data_venda` | `AAAA-MM-DD` | sem ela o DoctorSaaS usa a data de hoje |
| `data_ativacao` | `AAAA-MM-DD` | é dela que saem as datas derivadas do contrato |
| `data_proximo_reajuste` | `AAAA-MM-DD` | ver abaixo |
| `data_fim` | `AAAA-MM-DD` | opcional; normalmente vazio |
| `vlr_custo` | decimal | é o campo "Custo Operação" da tela do produto |
| `recorrencia` | `mensal` \| `anual` \| `semestral` \| `semanal` | lista fixa, não precisa de catálogo |
| `codigo_fornecedor` | texto | opcional |
| `link_portal_fornecedor` | texto | opcional |
| `observacoes_contratuais` | texto | opcional |

**`data_proximo_reajuste` resolve uma queixa aberta.** O reclame era que o
DoctorSaaS gravou 31/08/2027 quando o correto seria 01/09/2027. Quando o campo
vem no payload, é ele que vale — o cálculo automático só entra se o campo chegar
vazio. Mandem a data que vocês consideram correta e não há mais discussão.

Os campos de contrato podem ir em `produtos[]` **ou** em `comercial`. Se vierem
nos dois, o do produto vence. Prefiram `produtos[]`: são valores por produto.

---

## Tarefa 3 — perguntas novas no formulário

Estes dados não existem em lugar nenhum do payload nem das respostas, e o
DoctorSaaS **não tem como derivar** nenhum deles. Precisam de campo novo na tela.

| Pergunta nova | Campo do payload | Tipo |
|---|---|---|
| Data de cadastro do cliente | `cliente.data_cadastro` | data |
| Forma de pagamento da **mensalidade** | `comercial.forma_pagamento_mensalidade_id` | select do catálogo `formas_pagamento` |
| Custo Operação | `produtos[].vlr_custo` | decimal |
| Recorrência | `produtos[].recorrencia` | select de 4 valores fixos |
| Área de atuação | `cliente.area_atuacao_id` | select do catálogo `areas_atuacao` — **bloqueado, ver abaixo** |
| Fornecedor | `produtos[].fornecedor_id` | select do catálogo `fornecedores` — **bloqueado** |
| Modelo de contrato | `produtos[].modelo_contrato_id` | select do catálogo `modelos_contrato` — **bloqueado** |

Só existe pergunta de **Forma pg Setup**. A forma da mensalidade é outra coisa e
é a que define como o cliente é cobrado todo mês — sem ela o cadastro fica sem a
informação mais usada pelo financeiro.

Sobre o Custo Operação: não tente calcular a partir dos módulos. Conferimos — a
soma do custo de catálogo dos módulos vendidos dá um valor diferente do que o
time da Digi Office lança à mão. É um dado de negócio, tem que ser digitado.

---

## Tarefa 4 — três defeitos no payload atual

### 4.1 · `prazo_meses` está fixo em 12

Os cinco payloads que chegaram até agora mandam `"prazo_meses": 12`. O padrão da
Digi Office é deixar a vigência **em branco**. Parem de enviar o campo, ou
enviem só quando houver prazo de verdade.

Observação técnica: apagar o prazo **não** muda a data de reajuste. Quem manda na
data é `data_proximo_reajuste` (Tarefa 2.3).

### 4.2 · `cliente.telefone` vem de outro campo

Na venda de 31/08 (`external_ticket_id` `56badb88-4ef3-49cf-a9e6-741d52b3cfcb`):

- `cliente.telefone` no payload terminava em **…4439**
- a resposta "Telefone" da própria proposta terminava em **…3854**

São números diferentes, e o correto era o da resposta — foi ele que acabou
gravado à mão no DoctorSaaS. O payload está lendo de outro lugar.

Dois pontos a mais:

- **Mandem com o `55` na frente** (`55` + DDD + número, só dígitos). O briefing
  antigo pedia o contrário, e está corrigido: a base do DoctorSaaS tem 1.533
  clientes com o `55` contra 25 sem. Como não normalizamos mais nada, o formato
  que vocês mandarem é o que fica gravado — e telefone fora do padrão quebra a
  busca e o vínculo com o WhatsApp.
- A máscara de exibição de vocês está errada para celular de 9 dígitos: imprime
  `(31) 8 9328-3854` em vez de `(31) 9 8328-3854`. Aparece nas respostas do
  ticket.

### 4.3 · `data_inicio_prevista` não é a data da resposta

Mesmo ticket: `comercial.data_inicio_prevista` veio `2026-09-25`, enquanto a
resposta "Data prevista de início" dizia `2026-09-07`. Parece estar derivada do
dia de vencimento. É essa data que planeja a implantação no DoctorSaaS — 18 dias
de erro no planejamento. Usem a resposta.

---

## Tarefa 5 — anexar o contrato assinado

Hoje o contrato chega como **texto**, na resposta "Link D4Sign (contrato)". Esse
link exige login, então o DoctorSaaS nunca consegue baixar o arquivo — e o campo
"Anexo do contrato" da tela do produto fica vazio.

Os outros quatro anexos daquela venda (resumo da venda, certificado, print e
planilha de produtos) chegaram e entraram corretamente. O problema é só o
contrato.

O que fazer: baixar o PDF assinado do D4Sign e enviá-lo em `anexos[]`, como os
outros, com:

```json
{ "campo_label": "Contrato assinado",
  "nome_arquivo": "Contrato - <cliente>.pdf",
  "content_type": "application/pdf",
  "url": "<url que o DoctorSaaS baixe sem login>",
  "tamanho_bytes": 123456 }
```

**O rótulo `campo_label` tem que ser exatamente `Contrato assinado`.** É ele que
manda o arquivo para o campo "Anexo do contrato" do produto em vez da aba de
Anexos do ticket. A comparação ignora caixa, acento e espaço nas bordas, e nada
mais — qualquer outro rótulo continua indo para o ticket.

Restrições desse destino, diferentes das do anexo comum:

- **até 10 MB** (o anexo de ticket aceita 25 MB);
- somente **PDF, JPG ou PNG**;
- o nome do arquivo precisa ter extensão e ao menos uma letra ou número — o
  DoctorSaaS normaliza acento, espaço e parêntese sozinho.

Um arquivo de 12 MB como o "Resumo da venda" não caberia ali. Por isso é um
anexo à parte, e não o mesmo.

Se alguma dessas regras não bater, **o arquivo não se perde**: ele vai para a
aba de Anexos do ticket e a resposta traz o aviso `contrato_ficou_no_ticket`
com o motivo. Mostrem esse aviso na tela.

Só a **venda nova** aceita contrato por esse caminho. Em up-sell, down-sell e
cobrança avulsa o arquivo iria substituir o contrato assinado que o cliente já
tem — então ele fica no ticket, com o mesmo aviso.

---

## Tarefa 6 — no up-sell, o produto vem do CLIENTE

Os dois up-sells do teste foram recusados com `produto_nao_contratado`:

| Cliente | Vocês mandaram | O cliente tem |
|---|---|---|
| DEGUST BAR E RESTAURANTE | PDV Legal - **Servidor** (18) | PDV Legal - **Raspberry** (20) |
| CASCA BAR E RESTAURANTE | PDV **Legal** (13) | PDV Legal - **Servidor** (18) |

O `produto_id` está saindo do campo "Produto" da proposta, que é a linha
comercial. **Num up-sell o produto não é escolha** — é o que o cliente já
assinou. Aplicar o acréscimo no produto errado cobraria de um contrato que não
existe, então a chamada é recusada inteira.

### O endpoint que resolve

O GET de catálogo aceita agora um `cnpj` opcional:

```http
GET /functions/v1/onboarding-catalogo?tenant_id=<fixo>&cnpj=58692597000162
x-webhook-secret: <segredo>
```

A resposta ganha um bloco `cliente` (só quando o `cnpj` é enviado):

```json
"cliente": {
  "encontrado": true,
  "cliente_id": "…",
  "razao_social": "DEGUST BAR E RESTAURANTE LTDA",
  "nome_fantasia": "DEGUST CONCEITO",
  "cancelado": false,
  "produtos": [
    { "produto_id": 20, "nome": "PDV Legal - Raspberry",
      "modulos": [ { "modulo_id": "…", "nome": "Licença PDV", "quantidade": 2 } ] }
  ]
}
```

CNPJ que não existe volta `{ "encontrado": false, "cnpj": "…" }`.

**Como usar**, em qualquer proposta que não seja venda nova:

1. Ao informar o CNPJ, chame o catálogo com `?cnpj=`.
2. Se `encontrado` for `false`, avise na tela — modos de up-sell, down-sell e
   cobrança avulsa **exigem** cliente já cadastrado, e a chamada seria recusada
   com `cliente_nao_encontrado`.
3. O select de produto do up-sell passa a listar **apenas** `cliente.produtos`.
   Se houver só um, use-o direto.
4. O select de módulo passa a usar os módulos **daquele produto**, e `modulos`
   dentro do bloco `cliente` já diz quais o cliente tem e em que quantidade —
   é o que faz o `quantidade_delta` fazer sentido.

Enquanto isso não estiver pronto, o erro ficou útil: `produto_nao_contratado`
passa a devolver `produtos_do_cliente` com o que o cliente realmente tem, então
dá para corrigir na hora sem abrir o DoctorSaaS.

---

## Tarefa 7 — item que não é módulo continua tendo valor

O bloqueio "Itens sem mapeamento: Implantação Presencial (serviço)" apontou uma
regra que vale fixar.

**Módulo diz *o que* foi vendido. Quem carrega preço é o produto.** Um item da
proposta que não corresponde a nenhum módulo do DoctorSaaS — um serviço, uma
implantação presencial, uma taxa — **não** entra em `produtos[].modulos[]`, mas o
valor dele **entra normalmente** em `produtos[].vlr_mensal` e
`produtos[].vlr_ativacao`.

Tirar o valor junto com o item é o que fez a soma dar 1300 contra 1550 de total.
A conferência do DoctorSaaS compara a soma dos produtos com `comercial.vlr_mensal`
e `comercial.vlr_ativacao`: os dois lados têm que incluir esses itens.

O item não se perde: ele continua aparecendo em `proposta.itens` e no PDF do
resumo, que ficam anexados ao ticket.

---

## Regras de validação — o que agora **recusa** a chamada

O DoctorSaaS ficou mais rígido, de propósito: antes esses casos entravam pela
metade ou voltavam erro genérico sem dizer o que estava errado.

| Situação | Resposta |
|---|---|
| Nome no lugar do ID (`"Restaurante"` em vez de `74`) | `422 id_invalido` |
| ID que pertence a outra empresa | `422 nao_existe_no_tenant` |
| Data em `DD/MM/AAAA`, ou data impossível (`2027-02-31`) | `422 data_invalida` |
| Número com vírgula ou separador de milhar (`1.234,00`) | `422 numero_invalido` |
| `recorrencia` fora dos 4 valores | `422 valor_invalido` |
| Venda nova sem `unidade_base_id` | `422 obrigatorio_no_modo_venda_nova` |

Três coisas importantes sobre isso:

1. **Todos os erros vêm de uma vez**, cada um com o nome do campo. Não é um por
   chamada.
2. **Recusa é tudo ou nada.** Nada é criado pela metade — o payload pode ser
   corrigido e reenviado com o mesmo `external_ticket_id`.
3. Data é sempre `AAAA-MM-DD`. Número é sempre com **ponto** decimal e sem
   separador de milhar.

E a resposta de sucesso pode trazer `avisos`. O novo é `cadastro_incompleto`, que
lista os campos do cliente que não vieram. **Mostrem esse aviso na tela para o
vendedor** — não é erro, a venda entrou, mas alguém vai ter que completar à mão.

---

## Bloqueado do nosso lado — não implementem ainda

Três selects dependem de listas que o `GET /onboarding-catalogo` ainda não
devolve:

- `areas_atuacao`
- `fornecedores`
- `modelos_contrato`

Sem elas vocês não têm o ID para enviar, e mandar o nome é recusado. Essas listas
entram na próxima entrega do DoctorSaaS e eu aviso quando estiverem no ar. Todo o
resto deste documento pode ser feito **hoje**.

`recorrencia` **não** é bloqueado: são 4 valores fixos, podem deixar no código.

---

## Como saber que funcionou

Enviem uma venda de teste e confiram na resposta:

1. `ok: true` e um `ticket_code` no formato `TK-2026-NNNN`.
2. `avisos` **vazio** — se vier `cadastro_incompleto`, o campo listado ali é o
   que ainda falta no payload.
3. Nenhum `422`.

Do lado do DoctorSaaS o time da Digi Office confere na ficha do cliente: os
campos Razão Social, Nome Fantasia, Data Cadastro, Área de Atuação, Segmento,
Observação do Cliente e Fone do Contato preenchidos; e na tela do produto,
Fornecedor, Custo Operação, as duas Formas de Pagamento, Modelo de Contrato,
Recorrência, Vendedor, Origem da Venda, Próximo Reajuste e o Anexo do contrato.

Essa é literalmente a lista de campos que hoje é preenchida à mão em toda venda.

---

## Segurança — um item fora do escopo, mas urgente

O certificado digital A1 está chegando pela integração com **a senha em texto
claro no nome do arquivo** (padrão `<RAZÃO SOCIAL>_<CNPJ> senha <SENHA>.pfx`), e
existe também uma resposta de formulário chamada "Senha Certificado" com a senha
em claro. Os dois ficam guardados no DoctorSaaS junto do ticket.

Isso é um certificado digital com poder de assinar em nome do cliente, com a
senha ao lado. Vale tratar independente desta lista: no mínimo, parar de embutir
a senha no nome do arquivo.

---

## O que **não** mudar

- O segredo `x-webhook-secret` continua obrigatório e continua tendo que sair de
  um servidor, nunca do navegador.
- Os quatro modos (`produtos[]`, `alteracao`, `avulso`, nenhum bloco) não mudaram.
- **Módulo continua sem preço.** Nunca envie `vlr_mensal` ou `vlr_ativacao` dentro
  de `produtos[].modulos[]` — isso sobrescreve o valor do contrato. O preço vai no
  produto. Essa regra não mudou e continua sendo recusada.
- `tenant_id` continua sendo a constante fixa da instalação, e o tenant do
  seletor da tela continua virando `unidade_base_id`.
- Um `produto_id` por venda, nunca repetido.
