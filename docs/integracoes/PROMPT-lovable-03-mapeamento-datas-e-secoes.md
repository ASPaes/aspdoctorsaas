# Prompt 3 para o Lovable — de-para, datas e seções das respostas

> Cole este documento inteiro no Lovable do sistema de propostas (Calculadora).
> É a continuação dos prompts 1 e 2, que já foram implementados.
> São **quatro** mudanças. Data: 03/09/2026.

---

## Antes de tudo: de onde vem esta lista

A Digi Office revisou o cadastro gerado pelo teste de 03/09 às **20h28** e mandou
uma lista de correções. Esse teste é **anterior** ao prompt 2 — nenhuma proposta
nova foi enviada depois dele.

Então, da lista que vocês podem ter recebido:

- **Fornecedor, Modelo de contrato, Custo operação e o anexo do contrato** já são
  o prompt 2. Se aquilo foi publicado, essa parte se resolve no próximo envio.
  Não refaçam.
- **Vários outros itens são do DoctorSaaS, não de vocês** — a lista mais abaixo
  diz quais, para ninguém gastar tempo neles.
- **Quatro itens são de vocês** e estão descritos aqui.

---

## Tarefa 1 — o Essencial já embute um ponto de venda

No teste, o DoctorSaaS registrou **Licença PDV = 13**. O correto é **14**.

O item **"Essencial (Cloud + 1 PDV)"** inclui uma licença de PDV no próprio
pacote. Hoje o de-para trata só os "Ponto adicional" (13 deles) e o ponto que já
vem dentro do Essencial se perde.

**A regra:** ao mapear o item "Essencial (Cloud + 1 PDV)", além do que ele já
gera hoje, some **+1 na quantidade do módulo `Licença PDV`**.

Confira se existem outros itens combo com a mesma característica — pacote que
embute algo que também é vendido avulso. A conta que vale é sempre **o total que
o cliente vai usar**, não o número de linhas da proposta.

---

## Tarefa 2 — Data de Ativação é igual à Data da Venda

No teste a `data_venda` veio certa e a `data_ativacao` não.

**A regra é simples:** `produtos[].data_ativacao` = `produtos[].data_venda`.

Mandem as duas, com o mesmo valor. Não deduzam a ativação de outro campo e não
deixem em branco — sem ela o DoctorSaaS usa a data de hoje, e é dela que saem
as datas derivadas do contrato.

---

## Tarefa 3 — Próximo reajuste: dia 01 do 13º mês após a venda

Esta é uma regra de negócio da Digi Office, e o valor tem que vir **calculado por
vocês** em `produtos[].data_proximo_reajuste`. Quando o campo vem preenchido, é
ele que o DoctorSaaS grava — nenhum cálculo nosso interfere.

**A fórmula:** some 13 meses à Data da Venda e use o **dia 1** desse mês.

| Data da Venda | Próximo reajuste |
|---|---|
| 03/09/2026 | **01/10/2027** |
| 15/01/2027 | 01/02/2028 |
| 31/12/2026 | 01/01/2028 |

Repare que o dia da venda **não** entra na conta — só o mês. Sempre dia 01.

Formato, como todas as datas: `AAAA-MM-DD`. No exemplo de cima, `2027-10-01`.

---

## Tarefa 4 — dizer a que seção pertence cada resposta

Hoje `proposta.respostas_ticket` chega assim:

```json
{ "pergunta": "Adquirente", "resposta": "Caixa (Azulzinha)" }
```

O DoctorSaaS vai passar a exibir todas essas respostas na tela do ticket — hoje
elas chegam e ficam escondidas, e é por isso que a Digi Office reclamou que
Segmento, Instagram, Adquirente, Homologadas e os campos de implantação "não
foram puxados". Eles **foram**; só não estavam sendo mostrados.

Para exibi-las agrupadas — e para criar o bloco **"Resumo Implantação"** que a
Digi Office pediu — falta uma informação que só vocês têm: **a que seção do
formulário cada pergunta pertence.**

O formulário de vocês já é dividido em seções (dá para ver "DADOS CONTABILIDADE"
na tela). Acrescentem esse nome em cada resposta:

```json
{ "secao": "Dados Contabilidade",
  "pergunta": "Adquirente",
  "resposta": "Caixa (Azulzinha)" }
```

**Requisitos:**

- `secao` é o **nome da seção como aparece na tela de vocês**. Não inventem uma
  taxonomia nova, não traduzam, não abreviem — o objetivo é o especialista de
  implantação ver a mesma organização que o vendedor preencheu.
- Mantenham `pergunta` e `resposta` exatamente como estão. É acréscimo, não troca.
- Resposta sem seção definida pode vir sem o campo; ela cai num bloco "Outras
  informações" e não se perde.
- A **ordem do array** é respeitada dentro de cada seção. Se a ordem hoje é
  aleatória, mandem na ordem em que os campos aparecem no formulário — isso
  sozinho já melhora muito a leitura do outro lado.

Sem isso, a alternativa seria o DoctorSaaS adivinhar a seção pelo texto da
pergunta, o que quebra silenciosamente no dia em que alguém renomear um campo.

---

## O que **não** é de vocês

Estes itens da lista da Digi Office são do DoctorSaaS e já estão sendo tratados
aqui. Não mexam:

| Item da lista | Por quê |
|---|---|
| Tag "Pendente Faturamento" sempre preenchida | a jornada nasce sem tag; é o DoctorSaaS que aplica |
| "Dados da contabilidade" em branco na aba Atividade | as respostas chegam; o DoctorSaaS é que não as gravava nos campos |
| "Módulos da jornada" não vem lançado | o DoctorSaaS é que não preenchia essa lista |
| Primeira movimentação da Timeline | texto do evento de criação, do lado do DoctorSaaS |
| Datas aparecendo como `2026-09-03` no Resumo | formatação de tela do DoctorSaaS |
| Segmento, Instagram, Adquirente, Homologadas, Vendedor, Origem da venda, Já utiliza sistema, Qual sistema e os campos de Implantação "faltando" no Resumo | **chegaram todos**; a tela do DoctorSaaS os escondia |

O único ponto em que vocês entram nessa última linha é a **Tarefa 4** — sem a
seção, dá para mostrar tudo, mas não dá para agrupar.

---

## Como verificar

Numa venda nova de teste, depois de publicar:

1. `produtos[].data_ativacao` igual a `produtos[].data_venda` no payload enviado.
2. `produtos[].data_proximo_reajuste` no dia 01, 13 meses depois da venda.
3. Quantidade de `Licença PDV` = pontos adicionais **+ 1** quando houver Essencial.
4. Toda resposta de `respostas_ticket` com o campo `secao`.
5. A resposta do DoctorSaaS voltando `ok: true` e **`avisos` vazio**.

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
