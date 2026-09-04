# Prompt 4 para o Lovable — três pendências

> Cole este documento inteiro no Lovable do sistema de propostas (Calculadora).
> Continuação dos prompts 1, 2 e 3. **São só três itens.** Data: 04/09/2026.

---

## Antes: o teste de ontem à noite falhou por culpa do DoctorSaaS, não de vocês

No teste das 23h51 (`88a8bb3d-…`), vocês enviaram **corretamente**:

- `data_proximo_reajuste: "2027-10-01"` — dia 01 do 13º mês, como pedido;
- `recorrencia: "mensal"`;
- `data_ativacao` igual a `data_venda`;
- `Licença PDV` com quantidade **14** (o ponto embutido no Essencial entrou);
- `secao` nas 52 respostas do formulário.

Nada disso apareceu no DoctorSaaS porque, no momento exato daquela chamada, uma
versão antiga da função estava no ar do nosso lado. Já foi corrigido e conferido
reprocessando o **payload de vocês**: agora grava tudo certo.

**Não procurem bug nesses campos.** Estão certos. O prompt 3 está fechado, menos
a parte que virou o item A abaixo.

---

## Item A — `modelo_contrato_id`

Não veio no payload. É o único campo do prompt 2 que ainda falta.

```json
"produtos": [ { "modelo_contrato_id": 12, "...": "..." } ]
```

O ID sai do catálogo `modelos_contrato`, que o `GET /onboarding-catalogo` já
devolve. Para a Digi Office hoje são três opções: `Cobrança Direta` (12),
`Cobrança Fornecedor` (11) e `Padrão` (9).

---

## Item B — `vlr_custo` está chegando como zero

Vocês enviam o campo, mas com valor `0`:

```json
"produtos": [ { "vlr_custo": 0 } ]
```

**Zero é um valor válido, não é "vazio".** O DoctorSaaS grava 0 e não avisa nada,
porque não tem como distinguir "custo zero" de "ninguém preencheu".

É o campo **Custo Operação** da ficha do produto. Duas possibilidades, e vocês
sabem qual é:

- se a pergunta existe no formulário e o vendedor não preencheu, **tornem-na
  obrigatória** — é um número que o financeiro usa;
- se a pergunta ainda não existe, ela é a que falta criar.

Se o custo for realmente zero em alguma venda, mandem `0` mesmo — aí está certo.

---

## Item C — o anexo do contrato assinado

Continua sem vir. Os quatro anexos daquele teste chegaram com estes rótulos:

```
"Resumo da venda" · "Anexo Certificado Digital"
"Print Passagem Bastão" · "Anexo produtos"
```

Falta um quinto, com o rótulo **exato**:

```json
{ "campo_label": "Contrato assinado",
  "nome_arquivo": "Contrato - <cliente>.pdf",
  "content_type": "application/pdf",
  "url": "<url que o DoctorSaaS baixe sem login>",
  "tamanho_bytes": 123456 }
```

É esse rótulo que manda o arquivo para o campo **"Anexo do contrato"** da ficha
do produto, em vez da aba de Anexos do ticket. Aceita **PDF, JPG ou PNG** e vai
até **10 MB**.

O contrato hoje chega só como texto, na resposta "Link D4Sign (contrato)", e esse
link exige login — o DoctorSaaS nunca consegue baixar. É preciso baixar o PDF
assinado do D4Sign do lado de vocês e enviá-lo como anexo.

Se alguma regra não bater, o arquivo **não se perde**: vai para o ticket e a
resposta traz `contrato_ficou_no_ticket` com o motivo.

---

## Saiu da lista: fornecedor

**Não precisam mais enviar `fornecedor_id`.** O DoctorSaaS passou a preencher o
fornecedor sozinho. Se vocês já tinham implementado, pode deixar como está — só
não é mais requisito, e não é mais motivo para segurar uma venda.

---

## Como saber que fechou

Numa venda nova de teste, a resposta do DoctorSaaS tem que vir com:

```json
{ "ok": true, "ticket_code": "TK-2026-….", "avisos": [] }
```

**`avisos` vazio é o critério.** Enquanto faltar qualquer um dos três itens, ele
vem preenchido dizendo exatamente qual:

| Aviso | Falta |
|---|---|
| `contrato_incompleto` | `modelo_contrato_id` (lista os campos) |
| `sem_contrato_assinado` | o anexo do item C |
| `cadastro_incompleto` | algum campo do cadastro do cliente |

---

## O que **não** mudou

- Segredo no servidor, nunca no navegador.
- Catálogo é sempre **ID numérico**; data é sempre `AAAA-MM-DD`; número é sempre
  com ponto decimal e sem separador de milhar.
- Módulo continua **sem preço** — nunca enviem `vlr_mensal` ou `vlr_ativacao`
  dentro de `produtos[].modulos[]`.
- Item que não é módulo (serviço, taxa) continua **sem** entrar em `modulos[]`,
  mas com o valor dentro de `produtos[].vlr_mensal` / `vlr_ativacao`.
- No up-sell, o produto continua vindo de `GET /onboarding-catalogo?cnpj=`.
- `secao` nas respostas: já está certo, mantenham.
