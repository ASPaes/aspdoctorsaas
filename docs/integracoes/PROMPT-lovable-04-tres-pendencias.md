# Prompt 4 para o Lovable — duas pendências (revisado em 04/09)

> Cole este documento inteiro no Lovable do sistema de propostas (Calculadora).
> Continuação dos prompts 1, 2 e 3. **São dois itens** — o terceiro foi cancelado,
> ver o Item B. Revisado em 04/09/2026.

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

## Item B — ~~`vlr_custo`~~ · **CANCELADO**

> **Correção de 04/09/2026.** A versão anterior deste documento pedia para tornar
> o **Custo Operação** um campo obrigatório no formulário. **Ignorem esse pedido.**

O Custo Operação **não** é responsabilidade de vocês: ele é informado depois, por
outro caminho, dentro do DoctorSaaS. Não criem campo obrigatório, não segurem
venda por causa dele e não peçam esse número ao vendedor.

Podem continuar enviando `produtos[].vlr_custo` quando tiverem o valor. Se não
tiverem, **omitam o campo** — não mandem `0` para dizer "não sei", porque zero é
um valor válido e o DoctorSaaS vai gravar zero.

Desculpem o vai-e-vem.

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

| Aviso | Falta |
|---|---|
| `contrato_incompleto` | lista os campos do contrato que ficaram em branco |
| `sem_contrato_assinado` | o anexo do item C |
| `cadastro_incompleto` | algum campo do cadastro do cliente |

**Só dois avisos dependem de vocês:** `contrato_incompleto` citando
`modelo_contrato_id` (item A) e `sem_contrato_assinado` (item C).

Se o `contrato_incompleto` citar **`fornecedor_id`** ou **`vlr_custo`**,
**ignorem** — esses dois são preenchidos do lado do DoctorSaaS e o aviso está
sendo ajustado aqui para parar de citá-los.

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
