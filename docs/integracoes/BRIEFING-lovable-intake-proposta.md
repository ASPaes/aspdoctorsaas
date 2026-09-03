# Briefing: integração com o DoctorSaaS (intake de proposta)

> Cole este documento inteiro no Lovable como contexto do projeto.
> Ele descreve uma integração que o seu sistema de propostas precisa construir.

---

## 1. O que precisa ser construído

Quando o vendedor clica em **"Finalizar Ticket"** no sistema de propostas, o sistema deve enviar
a venda para o **DoctorSaaS** (o sistema de gestão do cliente) através de um webhook HTTP.

Uma chamada bem-sucedida faz o DoctorSaaS criar, numa única transação:

1. o **cliente** — ou reaproveitar o existente, se o CNPJ já estiver cadastrado lá;
2. o **contrato** com os produtos e módulos vendidos, já ativos e faturáveis;
3. o **ticket de implantação**, com a proposta completa anexada para consulta.

Se qualquer parte falhar, **nada é criado** — não existe estado pela metade.

### Estado atual — 30/08/2026

**Os dois endpoints estão no ar e testados.** Pode desligar o modo de teste quando quiser.

| Endpoint | Situação |
|---|---|
| `GET /onboarding-catalogo` | no ar, respondendo com os 8 catálogos reais |
| `POST /onboarding-intake-webhook` | no ar, com os quatro modos funcionando |

Testado ponta a ponta do lado do DoctorSaaS: venda nova cria cliente + contrato + módulos +
ticket; up-sell e down-sell lançam movimento de MRR; cobrança avulsa não mexe na mensalidade;
demanda sem valor abre só o ticket. Erro de validação devolve todos os campos de uma vez.

Se o contrato mudar, sai uma versão nova deste documento. Nada muda em silêncio.

### ⚠️ "Tenant" significa coisas diferentes nos dois sistemas

Esta é a confusão mais provável do projeto. Leia com atenção.

No sistema de propostas, **tenant** é a linha de negócio — PDV Legal, Digi Up, Gula Digi, Nutrebem.

No DoctorSaaS, **tenant** é a empresa inteira: a Digi Office é **um** tenant, ao lado de outras
empresas que também usam o DoctorSaaS. O `tenant_id` do payload é uma **constante fixa**, sempre
a mesma, e **não** tem relação com o tenant selecionado na tela do vendedor.

```
tenant do sistema de propostas   →   unidade_base_id   (varia por proposta)
tenant do DoctorSaaS             →   tenant_id         (constante, nunca muda)
```

Mapear o tenant da tela para `tenant_id` faz a integração inteira falhar.

### Consequência que importa

A venda entra no faturamento do DoctorSaaS **no instante em que a chamada chega**.
O webhook só pode ser disparado quando a venda estiver **de fato fechada** — nunca ao apenas
enviar a proposta para o cliente avaliar.

---

## 2. Os dois endpoints

Base URL (produção):

```
https://vbngjzovjhkmietztffo.supabase.co/functions/v1/
```

| Método | Caminho | Quando é chamado |
|---|---|---|
| `GET` | `onboarding-catalogo` | Ao abrir a tela da proposta, para alimentar os selects |
| `POST` | `onboarding-intake-webhook` | No clique de "Finalizar Ticket" |

---

## 3. Autenticação

Ambas as chamadas exigem um segredo compartilhado no cabeçalho:

```
x-webhook-secret: <o segredo, entregue por canal separado>
Content-Type: application/json
```

### Requisito de segurança — não negociável

O segredo **não pode** viver no código do front-end nem em qualquer variável que chegue ao
navegador. Qualquer pessoa que abrisse o DevTools poderia criar clientes e contratos na base
do DoctorSaaS.

**As duas chamadas partem do servidor.** No Lovable: crie uma Edge Function (ou rota de servidor)
que leia o segredo dos *secrets* do projeto e faça a chamada. O front-end conversa apenas com
essa função interna.

Segredo errado ou ausente devolve `401` e nada é gravado.

---

## 4. Passo 1 — Buscar os catálogos

O DoctorSaaS e o sistema de propostas precisam enxergar as mesmas listas. O vendedor escolhe
pelo nome; o que trafega no payload é sempre o **ID**.

### Requisição

```http
GET /functions/v1/onboarding-catalogo?tenant_id=955178ba-b367-498d-8443-cc5b7d1ee163
x-webhook-secret: <segredo>
```

### Resposta `200` (abreviada)

```json
{
  "produtos": [
    { "id": 18, "nome": "PDV Legal - Servidor" },
    { "id": 14, "nome": "Gula" }
  ],
  "modulos": [
    { "id": "630f1a44-a8c8-4a9c-a8c6-458c87be1dd6", "nome": "Licença PDV",   "produto_id": 18 },
    { "id": "796a0815-a8c2-4118-829c-7945fc22cd91", "nome": "Usuário Cloud", "produto_id": 18 }
  ],
  "segmentos":        [ { "id": 73,  "nome": "Bar" } ],
  "origens_venda":    [ { "id": 21,  "nome": "Já cliente" } ],
  "formas_pagamento": [ { "id": 15,  "nome": "Cartão" } ],
  "vendedores":       [ { "id": 175, "nome": "Gabriela P" } ],
  "unidades_base":    [ { "id": 6,   "nome": "Digi Office" } ],
  "demand_types":     [ { "id": "cc28a94c-72d7-426f-9dc7-e6ba017d41b7", "nome": "Novo Cliente" } ]
}
```

**Atenção aos tipos:** produtos, segmentos, origens, formas de pagamento, vendedores e unidades
usam **ID numérico**. Módulos e tipos de demanda usam **UUID (texto)**. Guarde exatamente como
vier; não converta.

**Cache:** 5 a 15 minutos. Não cacheie por dias — módulo novo cadastrado no DoctorSaaS precisa
aparecer para o vendedor no mesmo dia.

### 4.1 · O bloco CLASSIFICAÇÃO precisa carregar IDs, não nomes

A tela de "Ticket de Implantação" já tem os três campos de que a integração precisa. Cada um
corresponde a um catálogo:

| Campo na tela | Campo no payload | Catálogo de origem | Tipo |
|---|---|---|---|
| Unidade | `unidade_base_id` | `unidades_base` | inteiro |
| Tipo de Demanda | `demand_type_id` | `demand_types` | uuid |
| Produto | `produtos[].produto_id` | `produtos` | inteiro |

**Requisito, decidido pela Digi Office:** os três campos são alimentados pelo **GET de catálogo**
descrito na seção 4. Nada de lista fixa no código, nada de texto digitado.

A tela mostra o nome; o registro guarda e o payload envia o **ID**. Isso vale mesmo quando o
campo é derivado automaticamente e o vendedor não pode editá-lo — a origem da derivação tem de
ser o catálogo.

Guardar o nome em vez do ID faz a integração parecer correta e quebrar em silêncio no dia em que
alguém renomear um produto no DoctorSaaS. É a mesma razão da armadilha nº 4.

Se algum dos três estiver vazio ou sem ID correspondente, **bloqueie o envio** e avise na tela.
Não envie chutando um valor.

### 4.2 · Sobre o tenant da tela

O seletor de tenant do topo (PDV Legal, Digi Up, Gula Digi, Nutrebem) **não** entra no payload.
Ele pode continuar servindo para sugerir a Unidade por padrão, mas o que vale é o campo Unidade
do bloco CLASSIFICAÇÃO.

Correspondência atual, se for usada como valor padrão:

| Tenant | Unidade | `unidade_base_id` |
|---|---|---|
| PDV Legal | Digi Office | `6` |
| Digi Up | Digi Up | `10` |
| Nutrebem | Nutrebem | `11` |

A unidade `Teste` (`12`) existe no cadastro mas não deve ser usada em produção.

---

## 5. Passo 2 — Montar o payload

### Raiz

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `external_ticket_id` | texto | **sim** | ID do ticket no sistema de propostas. É a chave que impede duplicata. |
| `tenant_id` | uuid | **sim** | Fixo por instalação. Digi Office: `955178ba-b367-498d-8443-cc5b7d1ee163` |
| `demand_type_id` | uuid | **sim** | Do catálogo. Venda nova = "Novo Cliente". |
| `unidade_base_id` | inteiro | **sim** | Do catálogo `unidades_base`. É para onde o tenant da tela do vendedor deve ser traduzido — ver a seção 4.1. Aplicada ao cliente, e só quando o cliente é novo. |
| `assunto` | texto | não | Título do ticket. Sem ele, usa o nome do cliente. |

### O que o payload faz: quatro modos

**A jornada de implantação é criada sempre, nos 9 tipos de demanda.** O lado financeiro é decidido
por **qual bloco você envia** — não pelo tipo de demanda. Isso importa porque o mesmo tipo pode ter
consequências financeiras diferentes: uma Mudança de CNPJ pode ser cobrança avulsa numa venda e
acréscimo de mensalidade em outra.

| Envie este bloco | O DoctorSaaS faz | Modo |
|---|---|---|
| `produtos[]` | cria contrato com os módulos, entra no MRR | **A · Venda nova** |
| `alteracao` | lança movimento de MRR e ajusta módulos, se houver | **B · Alteração** |
| `avulso` | lança cobrança única, **não** mexe na mensalidade | **C · Avulso** |
| *nenhum dos três* | só abre o ticket de implantação | **D · Só jornada** |

Envie **no máximo um** dos três. Nenhum também é resposta válida.

#### O que cada tipo de demanda aceita

| Tipo | Bloco esperado |
|---|---|
| Novo Cliente · Novo Cliente - Nutrebem | `produtos[]` — **obrigatório** |
| Up-Sell | `alteracao` com `valor_delta` **positivo** |
| Down-Sell | `alteracao` com `valor_delta` **negativo** |
| Mudança Regime Fiscal · Mudança de CNPJ | `avulso`, ou `alteracao` quando virar acréscimo de mensalidade |
| Troca de adquirente · Mudança Servidor · Treinamento Extra | `avulso` quando houver cobrança; **nenhum bloco** quando não envolver valor |

#### O cliente precisa existir, exceto na venda nova

Nos modos **B, C e D** o cliente já tem que estar cadastrado no DoctorSaaS. Basta o `cnpj` no bloco
`cliente` — os demais campos são ignorados, porque cadastro existente nunca é sobrescrito. CNPJ não
encontrado devolve `cliente_nao_encontrado`.

No modo A o bloco `cliente` vai completo.

#### Bloco `alteracao` — modo B

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `produto_id` | inteiro | **sim** | Qual produto do cliente está sendo alterado. |
| `valor_delta` | decimal | **sim** | A **variação** da mensalidade, nunca o novo total. Positivo no Up-Sell, negativo no Down-Sell. |
| `vlr_ativacao` | decimal | não | Setup cobrado na alteração. |
| `descricao` | texto | **sim** | O que mudou, em uma linha. Aparece no extrato do cliente. |
| `modulos` | lista | não | **Opcional.** Só quando o contrato muda de composição. |
| `modulos[].modulo_id` | uuid | — | Do catálogo. |
| `modulos[].quantidade_delta` | inteiro | — | Positivo entra ou aumenta, negativo sai ou reduz. Nunca o total novo. |

**Os três casos de Up-Sell, e como enviar cada um:**

| Caso | Como enviar |
|---|---|
| Aumentou a quantidade de um módulo que o cliente já tem | `modulos` com o `modulo_id` e `quantidade_delta` positivo |
| Entrou um módulo novo | igual — mesmo formato, mesmo campo |
| Só aumentou o valor, sem mexer em módulo | **omita `modulos`**; mande só `valor_delta` |

O DoctorSaaS decide sozinho se é módulo novo ou aumento de quantidade: se o `modulo_id` já está no
contrato ativo do cliente, soma a quantidade; se não está, entra como módulo novo. **O vendedor não
precisa escolher.** O terceiro caso — só valor — é o mais comum na base atual.

O Down-Sell é o espelho: `valor_delta` negativo, e `quantidade_delta` negativo quando um módulo sai.

```json
"alteracao": {
  "produto_id": 18,
  "valor_delta": 120.00,
  "vlr_ativacao": 200.00,
  "descricao": "Mais 3 pontos de venda",
  "modulos": [
    { "modulo_id": "630f1a44-a8c8-4a9c-a8c6-458c87be1dd6", "quantidade_delta": 3 }
  ]
}
```

#### Bloco `avulso` — modo C

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `valor` | decimal | **sim** | Cobrança única. **Não entra no MRR** e não altera a mensalidade. |
| `descricao` | texto | **sim** | O que está sendo cobrado. |
| `produto_id` | inteiro | não | Quando a cobrança se refere a um produto específico. |

```json
"avulso": { "valor": 350.00, "descricao": "Troca de adquirente para Stone" }
```

#### Modo D — quando não há valor nenhum

Demanda sem cobrança (um Treinamento Extra de cortesia, uma Mudança de Servidor incluída) vai
**sem** `produtos[]`, **sem** `alteracao` e **sem** `avulso`. O DoctorSaaS abre o ticket de
implantação e não toca em nada financeiro.

Não mande `avulso` com `valor: 0` para representar isso — bloco ausente e bloco zerado são coisas
diferentes, e o zerado é recusado.

#### A venda não aparece no Omie na hora

Por decisão da Digi Office, toda venda que entra por esta integração fica **retida antes do
Omie**: ela é criada no DoctorSaaS normalmente, mas a sincronização com o Omie só acontece
quando alguém confere e libera na tela da jornada.

Isso não muda nada no que você envia — é só para que ninguém estranhe a venda não aparecer no
Omie imediatamente.

#### O bloco `comercial` fora do modo A

Continua útil (`funcionario_id`, `origem_venda_id`), mas `vlr_mensal` e `vlr_ativacao` deixam de ser
obrigatórios — os valores vêm de `alteracao` ou `avulso`, ou não existem.

### Bloco `cliente`

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `cnpj` | texto | **sim** | **Só dígitos**, sem pontuação. É a chave de identificação: se já existir, o cliente é reaproveitado. Aceita CPF (11 dígitos). |
| `razao_social` | texto | **sim** | Nome do cliente. Também aceito como `nome`. Faltando, o DoctorSaaS busca pelo CNPJ. |
| `nome_fantasia` | texto | não | Faltando, o DoctorSaaS busca pelo CNPJ. |
| `tipo` | texto | não | `PJ` ou `PF`. |
| `email` | texto | não | |
| `telefone` | texto | não | Só dígitos, **com** o `55` na frente: `55` + DDD + número. Corrigido em 03/09/2026 — este campo pedia o contrário. A base tem 1.533 clientes com o `55` contra 25 sem, e o DoctorSaaS não normaliza: o que você mandar é o que fica gravado. |
| `contato_fone` | texto | não | O telefone de quem fala pelo cliente, mesmo formato. Campo separado do `telefone`. |
| `data_cadastro` | data | não | `AAAA-MM-DD`. |
| `observacao_cliente` | texto | não | Texto livre. Serve para o detalhamento da mensalidade; monte pronto — o DoctorSaaS não compõe. |
| `area_atuacao_id` | inteiro | não | Do catálogo `areas_atuacao`. |
| `contato_nome` | texto | não | Quem fala pelo cliente. Também aceito como `nome_responsavel`. |
| `segmento_id` | inteiro | não | Do catálogo. |
| `endereco`, `numero`, `bairro`, `complemento`, `cep` | texto | não | CEP só dígitos. `endereco` também aceito como `logradouro`. |
| `cidade_id` | inteiro | não | Da tabela de cidades do DoctorSaaS. Se você não tiver esse dado, **omita** e mande a cidade por texto dentro de `proposta`. |

### Bloco `comercial`

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `funcionario_id` | inteiro | não | O vendedor, do catálogo. |
| `origem_venda_id` | inteiro | não | Do catálogo. |
| `forma_pagamento_ativacao_id` | inteiro | não | Como o setup será pago. |
| `forma_pagamento_mensalidade_id` | inteiro | não | Como a mensalidade será paga. |
| `vlr_mensal` | decimal | **sim** | Mensalidade total da proposta. Serve de **conferência**: se não bater com a soma dos módulos, a chamada é recusada. |
| `vlr_ativacao` | decimal | **sim** | Setup total, mesma conferência. |
| `data_inicio_prevista` | data | não | `AAAA-MM-DD`. Planeja a implantação; **não** adia o faturamento. |
| `prazo_meses`, `dia_vencimento` | inteiro | não | Vigência em branco é o padrão da Digi Office: **não** mande `prazo_meses` fixo. |

### Bloco `produtos` — lista, mínimo 1

**O valor do contrato vai aqui, no produto.** Os módulos dizem *o que* foi contratado; eles não
carregam preço. Ver a armadilha nº 1.

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `produto_id` | inteiro | **sim** | Do catálogo. Define qual sistema foi vendido. |
| `vlr_mensal` | decimal | **sim** | **A mensalidade deste produto.** É o valor que vira MRR. |
| `vlr_ativacao` | decimal | **sim** | O setup deste produto. Pode ser `0`. |
| `modulos` | lista | recomendado | A lista do que o cliente contratou. Pode vir vazia — a venda passa com aviso. |
| `modulos[].modulo_id` | uuid | **sim** | Do catálogo, e precisa pertencer ao `produto_id` acima. |
| `modulos[].quantidade` | inteiro | **sim** | Mínimo 1. |
| `modulos[].vlr_mensal` | decimal | **não enviar** | Deixe de fora. Ver armadilha nº 1 — mandar preço aqui **sobrescreve** o valor do contrato. |
| `modulos[].vlr_ativacao` | decimal | **não enviar** | Mesma regra. |
| `vlr_custo` | decimal | não | O "Custo Operação" da tela do produto. |
| `data_venda` | data | não | `AAAA-MM-DD`. Faltando, o DoctorSaaS usa a data de hoje. |
| `data_ativacao` | data | não | `AAAA-MM-DD`. É dela que saem as datas derivadas do contrato. |
| `data_fim` | data | não | `AAAA-MM-DD`. Normalmente vazio. |
| `data_proximo_reajuste` | data | não | `AAAA-MM-DD`. **Informada, vence o cálculo automático.** |
| `recorrencia` | texto | não | `mensal`, `anual`, `semestral` ou `semanal`. Lista fixa, sem catálogo. |
| `fornecedor_id` | inteiro | não | Do catálogo `fornecedores`. |
| `codigo_fornecedor`, `link_portal_fornecedor` | texto | não | |
| `modelo_contrato_id` | inteiro | não | Do catálogo `modelos_contrato`. |
| `observacoes_contratuais` | texto | não | |

Os campos de contrato acima também são aceitos em `comercial`. Vindo nos dois, o
do produto vence.

A soma dos `produtos[].vlr_mensal` tem que bater com `comercial.vlr_mensal`, e a soma dos
`vlr_ativacao` com `comercial.vlr_ativacao`. Se não bater, a chamada é recusada.

**Um produto por `produto_id`, nunca repetido.** Cada item da venda é um **módulo** do produto,
não um produto novo. Mandar o mesmo `produto_id` duas vezes é recusado com `produto_repetido` —
no DoctorSaaS um cliente tem uma linha por produto, e repetir criaria estrutura que não existe
na base (conferido: 0 de 1.067 contratos ativos).

Se a venda tiver itens de produtos diferentes, aí sim são entradas separadas — uma por produto.

**Produto sem módulo passa, mas avisa.** Nem todo produto tem catálogo de módulos completo (o
Gula tem 2 contra 20 do PDV Legal, e 55 dos seus 63 contratos ativos não têm módulo nenhum).
A venda é criada e a resposta traz `avisos` com os produtos que entraram sem registrar o que foi
vendido. Mostre esse aviso na tela — não é erro, mas alguém precisa saber.

### Blocos `anexos` e `proposta`

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `anexos[].nome` | texto | não | Nome do arquivo com extensão. |
| `anexos[].url` | texto | não | URL que o DoctorSaaS consiga baixar **sem login**. Ver armadilha nº 3. |
| `anexos[].tipo` | texto | não | MIME, ex. `application/pdf`. |
| `proposta` | objeto | não | **Tudo o mais que o vendedor levantou**, do jeito que estiver. Vira a aba "Proposta" do ticket. Campo novo aqui nunca quebra a integração. |

---

## 6. Payload de exemplo

IDs de catálogo são reais (Digi Office); os dados do cliente são fictícios.

```json
{
  "external_ticket_id": "TCK-2026-0819-001",
  "tenant_id": "955178ba-b367-498d-8443-cc5b7d1ee163",
  "demand_type_id": "cc28a94c-72d7-426f-9dc7-e6ba017d41b7",
  "unidade_base_id": 6,
  "assunto": "Implantação — Boteco Exemplo",

  "cliente": {
    "cnpj": "11222333000181",
    "razao_social": "BOTECO EXEMPLO LTDA",
    "tipo": "PJ",
    "email": "contato@botecoexemplo.com.br",
    "telefone": "92982810000",
    "contato_nome": "Paulo",
    "segmento_id": 73,
    "endereco": "Rua Conceição do Norte",
    "numero": "58",
    "bairro": "Flores",
    "cep": "69058105"
  },

  "comercial": {
    "funcionario_id": 175,
    "origem_venda_id": 21,
    "forma_pagamento_ativacao_id": 15,
    "forma_pagamento_mensalidade_id": 15,
    "vlr_mensal": 539.00,
    "vlr_ativacao": 1200.00,
    "data_inicio_prevista": "2026-08-25"
  },

  "produtos": [
    {
      "produto_id": 18,
      "vlr_mensal": 539.00,
      "vlr_ativacao": 1200.00,
      "modulos": [
        { "modulo_id": "630f1a44-a8c8-4a9c-a8c6-458c87be1dd6", "quantidade": 10 },
        { "modulo_id": "796a0815-a8c2-4118-829c-7945fc22cd91", "quantidade": 1  },
        { "modulo_id": "fee750a6-4178-4de2-857a-c86f835eec24", "quantidade": 1  }
      ]
    }
  ],

  "anexos": [
    { "nome": "resumo-implantacao.pdf",
      "url": "https://.../resumo.pdf?token=...",
      "tipo": "application/pdf" }
  ],

  "proposta": {
    "adquirente": "Stone",
    "homologadas": "L4 - Positivo",
    "tipo_operacao": ["Mesa", "Ficha", "Balcão"],
    "multilojas": false,
    "servidor_nuvem": true,
    "formato_treinamento": "Remoto",
    "configuracao_rede": "Será feita por um técnico",
    "impressora_producao": "Bematech MP 4200",
    "menos_de_250_produtos": true,
    "ja_utilizava_sistema": "PDV Legal, depois voltou para o manual",
    "sobre_o_cliente": "Bar/restaurante. De dia, mesa com pagamento no final...",
    "o_que_e_sucesso": "Rodar as duas operações, comanda e ficha, dentro do sistema.",
    "observacoes_internas": "Cliente leigo, ter calma. Subir planilha do cadastro antigo.",
    "link_d4sign": "https://secure.d4sign.com.br/desk/viewblob/...",
    "forma_pg_setup_parcelas": "Cartão 12x"
  }
}
```

Repare que os módulos trazem só `modulo_id` e `quantidade` — **nenhum valor**. Os R$ 539,00 e os
R$ 1.200,00 estão no produto, uma única vez. Isso é a armadilha nº 1.

---

## 7. Passo 3 — Enviar

```http
POST /functions/v1/onboarding-intake-webhook
x-webhook-secret: <segredo>
Content-Type: application/json

<o payload acima>
```

A resposta chega em segundos. Não há poll nem callback.

---

## 8. Passo 4 — Tratar a resposta

### Sucesso `200`

```json
{
  "ok": true,
  "cliente_id": "...",
  "contrato_id": "...",
  "journey_id": "...",
  "ticket_numero": "TK-2026-0142",
  "cliente_reusado": true,
  "avisos": [],
  "anexos_falhos": []
}
```

Grave `journey_id` e `ticket_numero` junto ao ticket local e **mostre-os ao vendedor** — é a
prova de que a venda chegou.

`cliente_reusado: true` significa que o CNPJ já existia no DoctorSaaS e o cadastro **não** foi
alterado. Vale avisar na tela.

### Recusa `422` — IDs inválidos

```json
{
  "ok": false,
  "error": "ids_invalidos",
  "invalidos": [
    { "campo": "produtos[0].modulos[1].modulo_id",
      "valor": "...",
      "motivo": "nao_existe_no_tenant" }
  ]
}
```

A lista vem **completa** — todos os problemas de uma vez, não um por chamada.
Renderize cada erro ao lado do campo correspondente, em português.

### Reenvio é seguro, inclusive depois de erro

Rede caiu, vendedor clicou duas vezes, precisa retentar: **reenvie o mesmo `external_ticket_id`**.

- Tentativa anterior **falhou** → nada foi criado, então o reenvio **reprocessa** com o payload novo. É assim que se corrige um ticket recusado: ajusta e fecha de novo, com o mesmo id.
- Tentativa anterior **deu certo** e o conteúdo é **idêntico** → `200` com os mesmos IDs e `ja_processado: true`. Retentativa pura, nada é criado de novo.
- Tentativa anterior **deu certo** e o conteúdo **mudou** → `409 ticket_ja_processado_com_alteracao`. A venda já está registrada e **a alteração não é aplicada**; a resposta traz o `journey_id` e o `ticket_code` para o ajuste ser feito no DoctorSaaS.

O terceiro caso existe para não mentir: responder `200` a uma venda editada faria o vendedor acreditar que a correção chegou, e ela não chega.

### O que registrar do lado de vocês

Guarde no ticket o resultado do envio e mostre antes de reenviar:

- `doctorsaas_status` (`enviado` · `simulado` · `pendente` · `erro`), `doctorsaas_sent_at`, `doctorsaas_journey_id`, `doctorsaas_ticket_numero`.
- Ao finalizar um ticket que já está `enviado`, **peça confirmação**: *"Este ticket já foi enviado ao DoctorSaaS em <data> (TK-XXXX). Reenviar não altera o que já foi criado lá. Deseja reenviar mesmo assim?"*
- Se o reenvio voltar `409 ticket_ja_processado_com_alteracao`, mostre que a alteração **não** foi aplicada e ofereça o link do ticket no DoctorSaaS.

**O outro lado disso:** gerar um `external_ticket_id` novo para a mesma venda cria um segundo
cliente e um segundo contrato, e o faturamento conta em dobro. O ID tem que ser **estável e vir
do banco**, nunca um `uuid()` gerado na hora do envio.

### 8.1 · Quando a falha bloqueia a finalização do ticket

Falhar não é uma coisa só. São duas, e o tratamento é oposto:

| Resposta | Bloqueia "Finalizar Ticket"? | Por quê |
|---|---|---|
| `422` — dado errado | **Sim** | Só o vendedor pode corrigir, e ele está na tela. Deixar passar significa uma venda que nunca chega ao DoctorSaaS. |
| `400` — campo obrigatório | **Sim** | Idem. |
| `500`, timeout, rede | **Não** | É falha do nosso lado. O vendedor não pode ficar impedido de fechar a venda dele porque o DoctorSaaS caiu. |
| `401` — segredo inválido | **Não** | Erro de configuração. Bloquear o vendedor não resolve; alertar quem administra, sim. |

Quando não bloqueia, o envio **não pode sumir**:

1. o ticket finaliza normalmente;
2. fica marcado com o estado do envio — **enviado**, **pendente** ou **erro**;
3. existe um jeito de retentar, manual ou automático.

Retentar é seguro por causa do `external_ticket_id`: o DoctorSaaS reconhece o ticket já
processado e devolve os mesmos IDs sem criar nada de novo. É exatamente para isso que a chave
de idempotência existe.

Silêncio é o único desfecho inaceitável: venda finalizada que nunca chegou, e ninguém sabe.

### 8.2 · Convivência com o webhook que já existe

Se o "Finalizar Ticket" já dispara outro webhook (`TICKET_WEBHOOK_URL`), a decisão depende de
para onde ele aponta hoje — o que precisa ser verificado antes de escolher:

| Se o webhook antigo… | Decisão |
|---|---|
| não tem mais consumidor | Substituir pelo DoctorSaaS |
| faz outra coisa (notificação, automação, planilha) | Manter os dois, sem que um bloqueie o outro |
| faz o que o DoctorSaaS vai passar a fazer | Substituir — senão o cliente é criado duas vezes |

Em nenhum cenário os dois devem bloquear em conjunto: somar dois pontos de falha na finalização
faz a venda parar por motivo que não é do vendedor.

---

## 9. As 4 armadilhas

### 1 · O preço vai no produto, nunca no módulo

Esta é a regra mais importante do documento, e a que contraria o que parece intuitivo.

No DoctorSaaS, **módulo não tem preço**. Medido na base da Digi Office: dos **4.682 módulos
ativos, nenhum** carrega valor, e o campo de preço do catálogo de módulos está vazio nos 205.
A receita vive no produto — nos 1.058 produtos ativos, todos com valor.

O módulo responde *"o que o cliente contratou"*. O produto responde *"quanto ele paga"*.

> Se o payload mandar preço nos módulos, um gatilho do DoctorSaaS **sobrescreve** o valor do
> contrato pela soma `vlr_mensal × quantidade` dos módulos. Uma linha de "9 pontos adicionais"
> com o total de R$ 360,00 viraria **R$ 3.240,00** de mensalidade — e seria faturada assim.

Por isso `modulos[].vlr_mensal` e `modulos[].vlr_ativacao` **não devem ser enviados**.
Omita os dois campos.

### 2 · Item sem mensalidade não é problema

Serviços avulsos (Alteração de CNPJ, Troca de Regime, Troca de Adquirente, Implantação
Presencial), isenções e itens de moeda de troca **não exigem tratamento especial**. Como módulo
nenhum carrega valor, um item sem mensalidade é simplesmente mais um módulo na lista.

Onde cada valor entra:

| Situação | Como enviar |
|---|---|
| Venda com mensalidade e setup | `produtos[].vlr_mensal` e `vlr_ativacao` preenchidos |
| Serviço avulso, só setup | `produtos[].vlr_mensal: 0` e `vlr_ativacao` com o valor |
| Isenção / moeda de troca | O módulo entra na lista normalmente; o desconto já está refletido no `vlr_mensal` do produto |
| Item cortesia | Idem — entra como módulo, sem valor nenhum |

O que precisa bater é só o **total**: soma dos produtos = `comercial.vlr_mensal`.

### 3 · A URL do anexo precisa abrir sozinha

O DoctorSaaS baixa o arquivo **pelo servidor**. URL que exige login, cookie de sessão, ou que
expira em poucos minutos, não funciona. Link assinado: gere com validade de **1 hora ou mais**.

| Limite | Valor |
|---|---|
| Tamanho por arquivo | 25 MB |
| Tempo de download | 30 s |
| Arquivos por proposta | 10 |

Anexo que estoura o limite é ignorado e volta em `anexos_falhos`. **A venda é criada
normalmente** — anexo nunca derruba a proposta.

### 4 · Texto não identifica nada

Mandar `"modulo": "Ponto adicional"` em vez do UUID não funciona.

Não é rigidez da API: dos três itens do resumo real da Digi Office, **nenhum** existe com esse
nome no cadastro do DoctorSaaS. "Essencial (Cloud + 1 PDV)" lá são dois módulos separados;
"Servidor Nuvem" chama-se "Servidor Legal".

Por isso o vendedor escolhe num select alimentado pelo catálogo, e o que trafega é sempre o ID.

---

## 10. Tabela de erros

| HTTP | `error` | Significa | O que fazer |
|---|---|---|---|
| 401 | `unauthorized` | Segredo errado ou ausente. | Conferir o secret do servidor. Não é erro do vendedor. |
| 400 | `invalid_json` | Corpo malformado. | Erro de código. Logar e alertar. |
| 400 | `campo_obrigatorio` | Falta um campo obrigatório. | Validar no formulário antes de enviar. |
| 404 | `tenant_not_found` | `tenant_id` não existe. | Erro de configuração. Conferir a constante. |
| 422 | `ids_invalidos` | Um ou mais IDs não existem nesse tenant. | Recarregar o catálogo e pedir ao vendedor que reescolha. Mostrar a lista `invalidos`. |
| 422 | `modulo_com_valor` | Módulo veio com preço. | Remover `vlr_mensal`/`vlr_ativacao` dos módulos — o valor é do produto. |
| 422 | `produto_repetido` | O mesmo `produto_id` aparece mais de uma vez. | Enviar UM produto com o valor total e cada item da venda como módulo dele. |
| 422 | `produto_sem_valor` | Produto sem `vlr_mensal` ou `vlr_ativacao`. | Preencher os dois no produto (podem ser `0`). |
| 422 | `total_nao_confere` | Soma dos produtos ≠ `comercial.vlr_mensal`. | A resposta traz os dois valores. |
| 422 | `cliente_nao_encontrado` | Modo B, C ou D com CNPJ que não existe no DoctorSaaS. | Só venda nova cria cliente. Conferir o CNPJ. |
| 422 | `blocos_conflitantes` | Veio mais de um entre `produtos`, `alteracao` e `avulso`. | Enviar no máximo um. |
| 422 | `valor_zerado` | `avulso.valor` ou `alteracao.valor_delta` igual a zero. | Se não há valor, omita o bloco inteiro (modo D). |
| 422 | `cliente_doc_invalido` | CNPJ/CPF com menos de 11 dígitos. | Validar o documento no formulário. |
| 200 | — | `external_ticket_id` já processado com sucesso. | Nada. Devolve os IDs originais mais `ja_processado: true`. Reenvio é seguro. |

| 500 | `internal_error` | Falhou no DoctorSaaS. **Nada foi criado.** | Retentar mais tarde com o mesmo `external_ticket_id`. |

**Regra geral:** qualquer resposta diferente de `200` significa que **nada foi criado no
DoctorSaaS**. Não existe meio-termo, e por isso retentar nunca gera sujeira.

---

## 11. Definição de pronto

A integração só está entregue quando todos estes itens forem verdadeiros:

- [ ] O segredo vive nos secrets do servidor e **nunca** chega ao navegador.
- [ ] Os selects do vendedor são alimentados pelo GET de catálogo, não por listas fixas no código.
- [ ] Unidade, Tipo de Demanda e Produto do bloco CLASSIFICAÇÃO vêm do GET e guardam o ID, não o nome.
- [ ] `tenant_id` é a constante do DoctorSaaS — **não** o tenant selecionado na tela.
- [ ] Cada tenant do sistema de propostas tem um `unidade_base_id` configurado, e o envio é bloqueado quando falta.
- [ ] O que trafega no payload é sempre ID — nenhum nome de módulo, produto ou vendedor.
- [ ] Os módulos vão **sem valor** — só `modulo_id` e `quantidade`.
- [ ] `vlr_mensal` e `vlr_ativacao` estão no **produto**, e a soma bate com o total da proposta.
- [ ] Serviço avulso vai como produto com `vlr_mensal: 0` e setup preenchido.
- [ ] `external_ticket_id` vem do banco e é estável entre tentativas.
- [ ] O botão "Finalizar Ticket" fica travado durante o envio e não permite duplo clique.
- [ ] Erro `422` é mostrado campo a campo, em português, na tela do vendedor.
- [ ] `journey_id` e `ticket_numero` são gravados e exibidos após o sucesso.
- [ ] Anexos têm URL pública ou assinada com validade de 1 hora ou mais.
- [ ] Tudo que o vendedor levanta e não tem campo aqui vai dentro de `proposta`.
- [ ] Testado com um CNPJ que já existe no DoctorSaaS e com um novo.

---

*DoctorSaaS · Intake de proposta · Versão 1 · 27/08/2026*
*Dúvida sobre o contrato, campo que falta, ou comportamento não descrito aqui: pergunte antes de assumir.*
