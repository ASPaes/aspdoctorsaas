# Prompt 2 para o Lovable — o que faltou no primeiro teste

> Cole este documento inteiro no Lovable do sistema de propostas (Calculadora).
> É a continuação do prompt anterior, que já foi implementado e publicado.
> Só o que está aqui precisa ser feito. Data: 03/09/2026.

---

## O que já funcionou — não mexer

O teste de 03/09 às 20h28 (`external_ticket_id`
`88a8bb3d-3dc1-4090-b53f-cd3715325053`) criou o cliente e o contrato no
DoctorSaaS com **14 dos 18 campos** que estavam em falta. Chegaram corretos:

- razão social da Receita **e** nome fantasia, em campos separados;
- data de cadastro, área de atuação, segmento, fone do contato;
- observação do cliente com a composição da mensalidade;
- telefone com o `55` na frente;
- vendedor, origem da venda, forma de pagamento da ativação e da mensalidade;
- recorrência, datas de venda e de ativação;
- **vigência em branco** e **próximo reajuste em 01/09/2027**, exatamente como
  vocês enviaram — o DoctorSaaS não recalculou nada.

Essa parte está fechada.

---

## Correção 1 — o aviso de razão social é falso alarme

Na tela apareceu:

> ⚠️ Cadastro incompleto no DoctorSaaS — sem razão social (consulta de CNPJ),
> custo operação.

**A razão social chegou.** O payload trazia `cliente.razao_social` preenchido e o
cadastro no DoctorSaaS ficou com `DIGI OFFICE INFORMATICA LTDA`, que é a razão
social correta da Receita. A parte de "custo operação" estava certa.

A validação de vocês está marcando a razão social como ausente quando ela existe.
Vale corrigir: um aviso que grita sem motivo treina todo mundo a ignorar o aviso
verdadeiro do lado dele.

---

## Tarefa A — os 4 campos que ainda não são enviados

Nenhum deles é problema do DoctorSaaS: simplesmente não vêm no payload.

| Campo | Onde | Observação |
|---|---|---|
| `fornecedor_id` | `produtos[]` | ID do catálogo `fornecedores`, já disponível no GET |
| `modelo_contrato_id` | `produtos[]` | ID do catálogo `modelos_contrato`, já disponível no GET |
| `vlr_custo` | `produtos[]` | é o "Custo Operação"; gravou 0 por ausência |
| anexo do contrato | `anexos[]` | ver Tarefa B |

Os catálogos `fornecedores` e `modelos_contrato` já estão no
`GET /onboarding-catalogo` desde 03/09 — não há mais bloqueio do nosso lado.
`areas_atuacao` também entrou, e vocês já estão usando.

---

## Tarefa B — o anexo do contrato

Vieram 4 anexos naquele teste, com estes rótulos:

```
"Resumo da venda"  ·  "Anexo Certificado Digital"
"Print Passagem Bastão"  ·  "Anexo produtos"
```

Os quatro entraram na aba de Anexos do ticket, corretamente. **Nenhum era o
contrato.**

Para o PDF assinado cair no campo "Anexo do contrato" da tela do produto, ele
precisa vir em `anexos[]` com o rótulo exato:

```json
{ "campo_label": "Contrato assinado",
  "nome_arquivo": "Contrato - <cliente>.pdf",
  "content_type": "application/pdf",
  "url": "<url que o DoctorSaaS baixe sem login>",
  "tamanho_bytes": 123456 }
```

A comparação ignora caixa, acento e espaço nas bordas — nada além disso.
Qualquer outro rótulo continua indo para o ticket.

Limites desse destino, mais estreitos que os do anexo comum: **até 10 MB** e
somente **PDF, JPG ou PNG**. Se alguma regra não bater, o arquivo **não se
perde**: vai para o ticket e a resposta traz `contrato_ficou_no_ticket` com o
motivo.

Hoje o contrato chega só como texto, na resposta "Link D4Sign (contrato)", e esse
link exige login — o DoctorSaaS nunca consegue baixar. É preciso baixar o PDF do
D4Sign do lado de vocês e enviá-lo como anexo.

---

## Tarefa C — no up-sell, o produto vem do CLIENTE

**Esta é a mudança mais importante deste documento.** Os dois up-sells do teste
foram recusados:

| Cliente | Vocês mandaram | O cliente tem | Ticket |
|---|---|---|---|
| DEGUST BAR E RESTAURANTE | PDV Legal - **Servidor** (18) | PDV Legal - **Raspberry** (20) | `b25ddb7d-…` |
| CASCA BAR E RESTAURANTE | PDV **Legal** (13) | PDV Legal - **Servidor** (18) | `2692e000-…` |

O `produto_id` está saindo do campo "Produto" da proposta, que é a **linha
comercial**. Num up-sell o produto não é escolha — é o que o cliente **já
assinou**. Aplicar o acréscimo em outro produto cobraria de um contrato que não
existe, então a chamada é recusada inteira, e nada entra pela metade.

### O endpoint que resolve

O GET de catálogo aceita agora um `cnpj` opcional:

```http
GET /functions/v1/onboarding-catalogo?tenant_id=<o fixo de sempre>&cnpj=58692597000162
x-webhook-secret: <segredo>
```

Só com o `cnpj` presente, a resposta ganha um bloco `cliente`:

```json
"cliente": {
  "encontrado": true,
  "cliente_id": "34b6ca2c-…",
  "razao_social": "DEGUST BAR E RESTAURANTE LTDA",
  "nome_fantasia": "DEGUST CONCEITO",
  "cancelado": false,
  "produtos": [
    {
      "produto_id": 20,
      "nome": "PDV Legal - Raspberry",
      "modulos": [
        { "modulo_id": "92788bb9-…", "nome": "Licença PDV",   "quantidade": 5 },
        { "modulo_id": "1aba5c86-…", "nome": "Estoque",       "quantidade": 1 },
        { "modulo_id": "7dc2edb8-…", "nome": "Usuário Cloud", "quantidade": 1 }
      ]
    }
  ]
}
```

CNPJ que não existe volta `{ "encontrado": false, "cnpj": "…" }`.
Sem `?cnpj=`, a resposta é exatamente a de hoje — o bloco simplesmente não aparece.

⚠️ **`duplicados`**: existe CNPJ repetido no cadastro do DoctorSaaS (um deles tem
12 linhas). Quando `duplicados` vier maior que `1`, os produtos listados são só os
do cadastro **mais antigo** — **avisem na tela e não deixem seguir no automático**,
porque não dá para saber a qual dos cadastros a venda deveria ir. Com
`duplicados: 1`, segue normal.

### Como usar

Em **toda** proposta que não seja venda nova (up-sell, down-sell, cobrança
avulsa, demanda sem valor):

1. Assim que o CNPJ for informado, chame o catálogo com `?cnpj=`.
2. `encontrado: false` → avise na tela e **bloqueie o envio**. Esses modos exigem
   cliente já cadastrado; a chamada seria recusada com `cliente_nao_encontrado`.
3. O select de produto passa a listar **apenas** `cliente.produtos`. Havendo um
   só, use-o direto e nem mostre o select.
4. O select de módulo usa os módulos **daquele produto**. E `cliente.produtos[].modulos`
   já diz o que o cliente tem e **em que quantidade** — é o que faz o
   `quantidade_delta` ser calculável em vez de chutado.
5. Cache: trate como dado vivo. O bloco `cliente` **não** deve ser cacheado junto
   com os catálogos — ele muda a cada venda.

Enquanto isso não estiver pronto, o erro ficou útil: `produto_nao_contratado`
passa a devolver `produtos_do_cliente` com o que o cliente realmente tem, dando
para corrigir sem abrir o DoctorSaaS.

```json
{ "ok": false, "error": "produto_nao_contratado", "produto_id": 18,
  "detail": "o cliente nao tem esse produto ativo. Num up-sell o produto e o que o cliente ja tem contratado, nao o da linha comercial da proposta",
  "produtos_do_cliente": [ { "produto_id": 20, "nome": "PDV Legal - Raspberry" } ] }
```

---

## Tarefa D — item que não é módulo continua tendo valor

O envio foi bloqueado uma vez com:

> Itens sem mapeamento: Implantação Presencial (serviço).
> Soma do setup dos produtos (1300.00) difere do total da proposta (1550.00).

Vocês resolveram no envio final, que veio com os 1550 certos. A regra por trás,
para não voltar:

**Módulo diz *o que* foi vendido. Quem carrega preço é o produto.**

Um item da proposta que não corresponde a nenhum módulo do DoctorSaaS — um
serviço, uma implantação presencial, uma taxa — **não** entra em
`produtos[].modulos[]`, mas o valor dele **entra normalmente** em
`produtos[].vlr_mensal` e `produtos[].vlr_ativacao`.

Tirar o valor junto com o item é o que fez a soma dar 1300 contra 1550. A
conferência do DoctorSaaS compara a soma dos produtos com `comercial.vlr_mensal`
e `comercial.vlr_ativacao` — os dois lados têm que incluir esses itens.

O item não se perde: continua em `proposta.itens` e no PDF do resumo, que ficam
anexados ao ticket.

---

## Tarefa E — mostrar os avisos novos na tela

A resposta de sucesso pode trazer `avisos`. Dois são novos e precisam aparecer
para o vendedor:

| Aviso | O que significa |
|---|---|
| `contrato_incompleto` | o produto entrou sem fornecedor, modelo de contrato, recorrência ou custo — lista quais |
| `sem_contrato_assinado` | nenhum anexo veio com o rótulo `Contrato assinado`; o campo do contrato ficou vazio |
| `contrato_ficou_no_ticket` | o arquivo do contrato chegou mas não coube no campo do contrato — o motivo vem junto |
| `cadastro_incompleto` | o cliente foi criado sem algum dos campos do cadastro — lista quais |

Nenhum deles é erro: **a venda entrou**. São a lista do que alguém teria que
preencher à mão depois.

Detalhe que motivou o `contrato_incompleto`: o teste de 03/09 voltou com
**zero avisos** e mesmo assim faltavam quatro campos do contrato. O DoctorSaaS
não estava avisando, e a lacuna só apareceu quando alguém foi conferir no banco.
Corrigido do nosso lado — agora avisa.

---

## Como verificar que ficou pronto

1. **Primeiro**, um `GET /onboarding-catalogo?tenant_id=<fixo>&cnpj=58692597000162`
   com o segredo. Tem que voltar `200` com o bloco `cliente` trazendo o produto
   20. Se voltar `401`, o segredo não está indo no cabeçalho.
2. Um **up-sell** nesse mesmo cliente, agora com `produto_id: 20`. Tem que voltar
   `ok: true` com um `ticket_code`.
3. Uma **venda nova** com os 4 campos da Tarefa A e o anexo da Tarefa B. Tem que
   voltar `ok: true` e **`avisos` vazio** — é isso que fecha os 18 campos.

---

## O que **não** mudou

- O segredo continua obrigatório e continua tendo que sair de um servidor.
- Os quatro modos (`produtos[]`, `alteracao`, `avulso`, nenhum bloco) são os mesmos.
- Módulo continua **sem preço**: nunca envie `vlr_mensal` ou `vlr_ativacao` dentro
  de `produtos[].modulos[]`.
- Catálogo é sempre **ID numérico**, data é sempre `AAAA-MM-DD`, número é sempre
  com ponto decimal e sem separador de milhar.
- `tenant_id` continua sendo a constante fixa; o tenant do seletor da tela
  continua virando `unidade_base_id`.
