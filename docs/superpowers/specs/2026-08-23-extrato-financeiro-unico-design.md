# Extrato financeiro único — o MRR passa a ser saldo de lançamento

**Data:** 23/08/2026
**Autor:** Alexandre (ASP) + Claude
**Status:** desenho aprovado nos 3 blocos. **Nada implementado. Nada aplicado em produção.**

---

## 1. O problema, medido

Não é "entrada de dados desorganizada". São **dois motores com verdades diferentes** para a mesma pergunta, e um deles tem buraco.

- **Estado** — `cliente_produtos` / `cliente_produto_modulos`: o que o cliente tem.
- **Extrato** — `movimentos_mrr`: o que aconteceu.

### 1.1. O extrato não registra venda nova nem churn total

O enum de `movimentos_mrr.tipo` tem 7 valores: `upsell, cross_sell, downsell, venda_avulsa, churn, reactivation, reajuste`. **Não existe `venda_nova`.**

O `get_mrr_bridge` *deduz* a venda nova de `data_venda_efetiva` cruzando a borda da janela, e deduz o churn total de quem estava dentro e saiu. Para a ponte fechar, a RPC precisa de dois ajustes de correção — `mov_de_quem_saiu` e `churn_parcial` — que existem só para desfazer a dupla contagem que a dedução cria.

Volume medido em 23/08/2026:

| Tabela | Linhas |
|---|---|
| `clientes` | 4.994 |
| `contratos` (4.105 ativos) | 5.000 |
| `cliente_produtos` | 4.990 |
| `cliente_produto_modulos` | 4.060 |
| **`movimentos_mrr`** | **1.708** |

| `tipo` | Linhas | Σ `valor_delta` |
|---|---|---|
| churn | 887 | −286.901,67 |
| reajuste | 358 | 12.555,38 |
| upsell | 248 | 20.841,80 |
| downsell | 103 | −17.785,06 |
| venda_avulsa | 75 | 0,00 (usa outra coluna) |
| cross_sell | 21 | 1.370,10 |
| reactivation | 16 | 4.402,97 |

### 1.2. A ativação está em 6 lugares, com 3 totais diferentes

| Onde | Linhas com valor | Total |
|---|---|---|
| `cliente_produtos.vlr_ativacao` | 673 | **R$ 289.528,86** |
| `contrato_itens.vlr_ativacao` | 667 | **R$ 284.668,86** |
| `contratos.vlr_total_ativacao` | 667 | R$ 284.668,86 |
| `clientes.valor_ativacao` (legado) | 501 | **R$ 156.118,82** |
| `cliente_produto_modulos.vlr_ativacao` | 0 | — |
| `movimentos_mrr.vlr_ativacao` | 0 | — |

R$ 4.860,00 de divergência entre produto e contrato. Nenhum dashboard mostra ativação.

**Consequência que decide o desenho:** ativação hoje é *estado* (um campo no produto), não *evento*. Por isso **upsell com ativação é impossível de registrar** — o produto tem um único campo `vlr_ativacao`; a segunda ativação sobrescreve a primeira.

### 1.3. Quando entrou receita nova, nasceu tabela nova

- **Certificado Digital** → tabela própria `certificado_a1_vendas` (116 vendas, R$ 7.690,20, 2 tenants) + hook próprio `useCertA1Data.ts`.
- **Venda avulsa** → dentro de `movimentos_mrr`, mas com **coluna paralela** `valor_venda_avulsa` (75 lançamentos, R$ 18.198,38). Nunca usa `valor_delta`.

Duas fontes de receita, dois formatos diferentes. A terceira repetiria o padrão.

### 1.4. O extrato não sabe a que se refere

| `tipo` | Linhas | Com vínculo de módulo |
|---|---|---|
| upsell | 248 | 3 |
| downsell | 103 | 1 |
| demais | 1.357 | 0 |

**4 de 372** upsell/downsell sabem o que mudou. 245 upsells são valores soltos.

### 1.5. Um `IF` escondido decide se o upsell conta uma ou duas vezes

`fn_sync_produto_valores` só sobrescreve `cliente_produtos.vlr_mensal` com a soma dos módulos **se todos os módulos ativos forem pagos** (`v_todos_pagos AND v_soma_mensal <> 0`).

Medido: dos **770** produtos com módulo ativo, **2** têm todos os módulos pagos.

Ou seja: em 768 produtos, adicionar um módulo pago **não** mexe na base (e o upsell precisa ser lançado à mão); nos outros 2, mexe (e o lançamento duplica). Mesmo gesto, dois resultados, sem nada na tela indicando qual.

### 1.6. As abas do dashboard não fecham entre si — hoje

| Função / aba | Lê extrato | Lê produtos | Lê `mensalidade` |
|---|---|---|---|
| `get_mrr_bridge` (Crescimento) | ✅ | ✅ | — |
| `get_mrr_monthly_snapshots` (Visão Geral, Crescimento) | ✅ | ✅ | ✅ |
| `fn_cohort_revenue` (Cohort) | ✅ | ✅ | ✅ |
| `fn_cohort_logos` (Cohort) | ❌ | ✅ | — |
| `fn_cohort_saldo_forecast` (Cohort) | ❌ | ✅ | — |
| `get_carteira_churn` (Cancelamentos) | ❌ | ✅ | — |
| `get_churn_detalhe_uf` (Cancelamentos) | ❌ | ✅ | — |
| `get_tenure_medio_meses` (Visão Geral) | ❌ | ✅ | — |
| `fn_mrr_por_cliente_em` | ❌ | ❌ | ✅ |

Cinco funções não enxergam upsell, downsell nem reajuste. `fn_mrr_por_cliente_em` usa `clientes.mensalidade`, régua que o próprio `src/lib/mrrRuler.ts` documenta como proibida.

Divergência medida em 23/08/2026, mesmo instante, mesmos clientes ativos:

| Tenant | Régua das abas cegas | Régua canônica | Diferença |
|---|---|---|---|
| Digi Office | R$ 416.716,12 | R$ 426.805,33 | **+R$ 10.089,21** |
| ASP | R$ 182.422,04 | R$ 182.411,92 | −R$ 10,12 |
| Delvale | R$ 304.772,93 | R$ 304.772,93 | 0 (sem movimento) |

**Por isso "fechar exatamente como funciona hoje" não é uma meta atingível:** hoje Cancelamentos mostra R$ 416.716 para a Digi Office enquanto Crescimento mostra R$ 426.805. Qualquer unificação muda o número de alguma aba.

**Requisito que substitui a paridade:** nenhum número muda sem relatório prévio, aba por aba, com o motivo e o valor antes/depois. Aprovação do Alexandre por aba.

### 1.7. Escrita direta aberta

`anon` **e** `authenticated` têm `INSERT`/`UPDATE`/`DELETE` diretos em `movimentos_mrr`, `cliente_produtos`, `cliente_produto_modulos`, `contratos` e `certificado_a1_vendas`. Só o RLS segura. Sem `REVOKE`, "porta única" é convenção, não regra — e o Lovable escreve na mesma `main`.

---

## 2. Decisões tomadas

| # | Decisão | Quem decidiu |
|---|---|---|
| D1 | **Um livro só.** Receita recorrente e pontual na mesma tabela, classificadas. Não haverá livro irmão. | Alexandre |
| D2 | **Porta única de escrita.** Toda mudança financeira passa por uma RPC que grava extrato + estado na mesma transação. | Alexandre |
| D3 | **Backfill completo com prova.** O extrato passa a conter o passado inteiro. Sem corte de data. | Alexandre |
| D4 | **Cada lançamento carrega dois valores** — recorrente e pontual — no mesmo registro. | Alexandre (correção sobre a proposta inicial) |
| D5 | **O contrato NÃO é excluído.** Sai da tela, vira vínculo de faturamento. Mas o **reajuste deixa de ser dele** e passa para o produto (§6). | Claude, revisado após objeção do Alexandre |
| D6 | **MRR atual = saldo do extrato.** `cliente_produtos.vlr_mensal` vira valor contratado de referência. | Alexandre |
| D7 | **Downsell não toca no produto.** Ajuste só por lançamento. | Alexandre |
| D8 | `certificado_a1_vendas` migra por último, depois que o livro provar que funciona. | Claude, aceito |

### Por que o contrato fica (D5)

O desenho original pedia excluí-lo. 97% dos contratos são `is_implicit = true` (3.986 de 4.105 ativos), sem arquivo anexado — parecem burocracia. Objeção levantada pelo Alexandre em 23/08: a data do próximo reajuste vive nele, e o reajuste é por produto, não por contrato. **A objeção procede e mudou o desenho** (§6) — mas não a ponto de excluir a entidade.

O que o contrato ainda carrega depois de perder o reajuste:

- **Omie**: `enfileirar_sync_omie(contrato_id, origem)`, `montar_payload_contrato_omie(p_contrato_id, …)`, `omie_sync_fila.contrato_id`.
- **Cancelamento**: `cancelado_em`, `motivo_cancelamento`, `contrato_eventos`.
- **Faturamento**: `dia_vencimento` (1.486 preenchidos), `forma_pagamento_mensalidade_id`.
- **Documentos**: `contrato_anexos`, `modelo_contrato_id` (que também é o portão do sync — `modelos_contrato.sincroniza_omie`).

**O argumento decisivo:** `reconciliacao_cadastro` tem **1.015 contratos já espelhados com `ds_contract_id`**. O ID do contrato não é chave só nossa — está gravado dentro do ERP do cliente. Excluir a entidade exige re-vincular 1.015 registros no Omie, com risco de faturamento errado, para ganhar zero em usabilidade (a tela some de qualquer jeito).

**Posição:** ele deixa de ser conceito de negócio e vira **vínculo de faturamento** — invisível no cadastro. Os 141 contratos não implícitos ganham uma aba "Documentos". Se o Alexandre ainda quiser excluí-lo, isso vira um projeto próprio, com plano de re-vinculação do Omie, e não entra aqui.

### O que o Omie já suporta (verificado)

`montar_payload_contrato_omie` envia `valor_mensal = calcular_mrr_cliente(cliente, tenant)`, que é *produtos ativos + movimentos*. **O caso do downsell (D7) já chega correto no Omie hoje** — R$ 350, não R$ 450. Não há quebra.

Limitações pré-existentes da integração, **fora do escopo deste plano**: recusa contrato com mais de 1 item e cliente com mais de 1 contrato ativo.

---

## 3. O modelo

### 3.1. A tabela

Mantém o nome físico `movimentos_mrr`. Renomear custaria ~20 arquivos do front, os tipos gerados, 10 RPCs e a EF do Omie, sem ganho funcional. O conceito muda; o nome não.

**Cada lançamento carrega dois valores, sempre:**

| Campo | Significado |
|---|---|
| `valor_delta` | impacto **recorrente** no MRR, com sinal. Pode ser 0. |
| `valor_pontual` | **entrada única** do mesmo lançamento. Pode ser 0. |
| `categoria_receita_id` | o que é a entrada (Ativação, Certificado Digital, Consultoria, Setup…) |

Exemplos:

| Caso | `tipo` | `valor_delta` | `valor_pontual` | categoria |
|---|---|---|---|---|
| Venda nova R$ 899 + R$ 299/mês | `venda_nova` | 299,00 | 899,00 | Ativação |
| Upsell módulo R$ 39,90 com setup R$ 150 | `upsell` | 39,90 | 150,00 | Ativação |
| Certificado A1 | `venda_avulsa` | 0 | 66,00 | Certificado Digital |
| Downsell 450 → 350 | `downsell` | −100,00 | 0 | — |

**`valor_pontual` consolida `vlr_ativacao` + `valor_venda_avulsa` num campo só.** É a coluna paralela que precisa morrer; senão a próxima fonte de receita ganha a terceira.

### 3.2. Colunas

**Entram:**

| Campo | Tipo | Por quê |
|---|---|---|
| `tipo = 'venda_nova'` | valor no enum | Fecha o buraco. `ADD VALUE` é aditivo e **irreversível** — não existe `DROP VALUE`. |
| `valor_pontual` | `numeric NOT NULL DEFAULT 0` | Entrada única no mesmo lançamento. |
| `categoria_receita_id` | `uuid` → `categorias_receita` | **Nova fonte de receita = uma linha no cadastro.** Nunca coluna, tabela ou hook novo. |
| `cliente_produto_id` | `uuid` | Hoje só existe vínculo com *módulo*. Venda nova e churn são no nível do produto. |
| `origem_registro` | `text` (`manual` / `backfill` / `integracao`) | Sem isso o backfill fica indistinguível de lançamento humano e a auditoria morre. |

**Renomeia:** `vlr_ativacao` → `valor_pontual`, absorvendo também `valor_venda_avulsa`.
*(Correção registrada: a primeira proposta era `DROP vlr_ativacao` por estar zerada em 1.708 linhas. Leitura errada — está zerada porque a UI nunca escreveu ali, não porque não serve.)*

**Não entra:** coluna `natureza`. É derivável (`valor_delta <> 0` → recorrente; `valor_pontual <> 0` → entrada; ambos → misto). Coluna redundante é onde nasce divergência.

**Fica como está:** `custo_delta` (margem), `encerrado_em` (a régua de baixa), `estorno_de` / `estornado_por`, `fornecedor_id`, `contrato_id`.

### 3.3. Cadastro novo: `categorias_receita`

Por tenant. Campos mínimos: `nome`, `slug` imutável, `recorrente boolean` (default esperado), `ativo`, `ordem`. Seed: Mensalidade, Ativação, Certificado Digital, Serviço Avulso.

É este cadastro que responde ao pedido original — *"quando precisarmos iniciar uma nova fonte de receita, não fique bagunçado"*.

### 3.4. Semântica final dos valores

| Campo | Antes | Depois |
|---|---|---|
| `cliente_produtos.vlr_mensal` | soma do MRR | **valor contratado de referência** (não somado) |
| `cliente_produtos.vlr_ativacao` | digitável | **derivado** — soma dos lançamentos |
| `contrato_itens.vlr_ativacao` | digitável | derivado |
| `contratos.vlr_total_ativacao` | digitável | derivado |
| `clientes.mensalidade` | verdade | **cache/projeção do extrato** (ver §5.3) |
| `clientes.valor_ativacao` | legado | permanece deprecated, não lido |

**MRR atual do cliente = Σ `valor_delta` dos lançamentos recorrentes vigentes.**
`venda_nova + upsell + cross_sell − downsell + reajuste − churn + reactivation`

Isso resolve a regra "nunca zerar `mensalidade` no cancelamento": o churn zera o saldo e o histórico continua inteiro, porque os lançamentos ficam.

---

## 4. A jornada de lançamento

**Princípio:** produto/módulo = o que foi vendido (definição, congelada). Extrato = todo o dinheiro. **Valor não se edita no produto.**

### Caso 1 — Cliente novo

Tela única: cliente → produto → módulos → MRR → ativação. Ao salvar, `registrar_movimento_receita` grava na mesma transação:

- **estado**: `cliente_produtos` + `cliente_produto_modulos` (quais módulos, quantidade — a definição)
- **extrato**: **um** lançamento `venda_nova`, `valor_delta = 299,00`, `valor_pontual = 899,00`, categoria Ativação, com `cliente_produto_id`

Automático, **pela RPC — não por gatilho**. Gatilho não distingue "venda nova" de "correção de digitação de ontem".

### Caso 2 — Upsell 6 meses depois

Mesma RPC, `tipo = 'upsell'`. Ao adicionar o módulo ela pede data e valor do incremento:

- **estado**: insere o módulo (definição do que o cliente passou a ter)
- **extrato**: `upsell +39,90` (+ pontual se houver), amarrado ao `cliente_produto_modulo_id`

**Correção obrigatória junto:** o valor do módulo entra como definição e **não pode somar na base**. Hoje isso depende do `IF` de §1.5. A RPC passa a gravar módulo sempre com `doctorsaas.skip_valor_sync = true`, e `fn_sync_produto_valores` deixa de decidir valor.

### Caso 3 — Downsell 450 → 350

Lança `downsell −100,00`. Produto e módulos **intactos**. O produto continua registrando que foi vendido por 450; o cliente vale 350.

É o caso que menos muda de motor — e o desejo fica mais protegido do que hoje, porque a edição de valor no produto passa a ser bloqueada por `REVOKE`.

### Estorno

`estornar_movimento(p_id, p_motivo)` desfaz os dois lados na mesma transação, gravando `estorno_de` / `estornado_por`. Nunca `DELETE`.

---

## 5. Como o dashboard passa a buscar

### 5.1. Duas primitivas, seis abas

| Primitiva | Devolve | Quem usa |
|---|---|---|
| `fn_mrr_saldo_em(p_tenant, p_data)` | saldo por cliente na data + dimensões (unidade, fornecedor, UF, segmento, mês de entrada) | Visão Geral, Distribuição, Cohort, Tenure |
| `fn_mrr_extrato(p_tenant, p_ini, p_fim)` | lançamentos do período por tipo, com `valor_delta` e `valor_pontual` | Crescimento (ponte), Cancelamentos, Vendas |

**Nada de RPC por aba. Aba nova = novo recorte, nunca nova fórmula.** É o que impede a sétima régua de nascer.

### 5.2. Requisito de performance (fase 5)

Medido em 23/08/2026 (Digi Office, 1.032 lançamentos):

| Consulta | Hoje |
|---|---|
| Saldo de todos os clientes | **1,7 ms** (index scan + hash aggregate) |
| 24 cortes mensais × todos os clientes | **41 ms** (nested loop, 24 × varredura) |

Pós-backfill o extrato da Digi Office quadruplica. O nested loop escala linear → estimativa ~150–200 ms.

**`fn_mrr_saldo_em` deve ser escrita como soma corrente (window function) em uma passada, com índice `(tenant_id, data_movimento)`** — custo praticamente independente do número de cortes. Isto é requisito da fase 5, não otimização posterior.

### 5.3. `clientes.mensalidade` vira cache

A lista de clientes filtra e ordena por coluna; não dá para ordenar 4.994 clientes por uma soma. Então:

- passa a ser **projeção do extrato**, gravada pela mesma RPC que lança;
- ganha um **conferidor periódico** (cron) que compara cache × extrato e acusa divergência.

Sem o conferidor, voltam a existir duas verdades — que é exatamente o problema de hoje.

### 5.4. Ganho colateral

`valor_pontual` faz a aba Vendas passar a mostrar ativação e certificado: **R$ 284.668,86** que hoje não aparecem em dashboard nenhum.

---

## 6. O reajuste passa a ser do produto

Levantado pelo Alexandre em 23/08. Regra de negócio que **não estava no código**:

> Cliente com PDV Legal (R$ 300/mês) e Ponto Eletrônico (R$ 130/mês). O reajuste incide **só sobre o PDV Legal**. O Ponto Eletrônico não reajusta.

### 6.1. A data já existe no produto — e não diverge

`cliente_produtos.data_proximo_reajuste` já existe e é atualizada pelo `aplicar_reajuste` junto com a do contrato. Conferidos os 4.056 pares contrato↔produto ativos em 23/08:

| | Pares |
|---|---|
| Iguais | **3.040** |
| **Divergentes** | **0** |
| Só no contrato | 792 |
| Só no produto | 1 |
| Ambos nulos | 223 |

Migrar a data para o produto é backfill de **792 linhas, sem nenhum conflito a resolver**. É a parte fácil.

### 6.2. Mas a data não é o problema — a base é

`preparar_reajuste` seleciona por `contratos.data_proximo_reajuste` e depois **bifurca**:

```
se o cliente tem 1 contrato ativo  → base = MRR INTEIRO do cliente
                                     (Σ cliente_produtos ativos + Σ movimentos)
se tem mais de um contrato         → base = só os produtos daquele contrato
```

Com 1 contrato — **99% dos casos** — o reajuste incide sobre tudo que o cliente paga. No exemplo acima: base 430,00, reajuste sobre 430,00. Exatamente o que a regra proíbe.

**Ainda não causou dano:** dos 266 reajustes aplicados, **0** incidiram sobre cliente com mais de um produto ativo. E hoje só **7 clientes na base inteira** têm mais de um produto ativo (Delvale 1, ASP 1, Athuz 1, Consysa 1, Liberty 3). O defeito é latente — dá para corrigir antes de aparecer, e é por isso que ele entra neste plano em vez de virar bug depois.

### 6.3. O desenho

| Item | Antes | Depois |
|---|---|---|
| Onde mora a data | `contratos.data_proximo_reajuste` (autoridade) + `cliente_produtos` (cópia) | **`cliente_produtos.data_proximo_reajuste` (autoridade)**. A do contrato vira derivada — `MIN()` dos produtos — só para o Omie. |
| Quem é elegível | contrato com data na janela | **produto** com data na janela |
| Base do cálculo | MRR inteiro do cliente (1 contrato) | **saldo do extrato daquele produto** — `venda_nova + upsell + downsell + reajuste` filtrados por `cliente_produto_id` |
| Granularidade de `reajuste_contratos` | 1 linha por contrato | 1 linha por **produto** (a tabela ganha `cliente_produto_id`; o nome fica) |
| Movimento gerado | `reajuste` com `contrato_id` | `reajuste` com `contrato_id` **e `cliente_produto_id`** |
| Produto isento | não existe | flag `reajusta` em `cliente_produtos` (default `true`) — é o que deixa o Ponto Eletrônico de fora sem depender de data nula |

**Por que a base por produto só funciona depois da fase 4:** hoje não existe `venda_nova`, então o extrato não sabe quanto vale cada produto isoladamente — o valor está em `cliente_produtos.vlr_mensal`. Enquanto o backfill não rodar, a base por produto seria `vlr_mensal + movimentos vinculados àquele produto`, e só 4 de 372 movimentos têm vínculo (§1.4). **Por isso o reajuste por produto entra na fase 5, não antes.**

### 6.4. O que o Omie precisa continuar recebendo

`montar_payload_contrato_omie` envia `vigencia_final = contratos.data_proximo_reajuste`, e recusa o envio se a data estiver vencida. Com a autoridade no produto, a do contrato passa a ser mantida como `MIN(data_proximo_reajuste)` dos produtos ativos do contrato — a mais próxima manda, que é o comportamento conservador (o Omie renova a vigência antes, nunca depois).

Enquanto o Omie só suportar 1 produto por contrato, `MIN()` e "a data do produto" são a mesma coisa.

---

## 7. Risco nº 1 — as listas negras

Adicionar `venda_nova` ao enum **duplica o MRR** em qualquer leitor que some produto + lançamento sem excluí-lo.

Varredura completa das funções que leem `movimentos_mrr` (23/08/2026):

**Lista negra — `tipo NOT IN ('venda_avulsa','churn','reactivation')`. Somam `venda_nova` sozinhas:**

| Função | Consequência |
|---|---|
| **`calcular_mrr_cliente`** | Alimenta `montar_payload_contrato_omie` → **o ERP do cliente recebe o dobro.** |
| **`trg_valor_enfileirar_omie`** | Enfileira o valor dobrado. |
| **`preparar_reajuste`** | **Reajuste calculado sobre o dobro da base.** Dinheiro cobrado errado do cliente final. |

**Lista branca — ignoram `venda_nova`, seguras:** `fn_mrr_cliente_em`, `fn_mrr_do_modulo`, `get_mrr_bridge`, `get_mrr_monthly_snapshots`, `fn_cohort_revenue`, `get_cancelamentos_breakdown`, `get_carteira_serie_uf`, `theo_kpis_janela`, `cancelar_contrato`, e `src/lib/mrrRuler.ts` (`MRR_MOV_TIPOS`).

**Sem filtro de tipo — auditar antes da fase 2:** `build_management_digest_block` (relatório gerencial do Théo), `admin_delete_cliente`, `preview_delete_cliente`, `editar_cancelamento`, `fn_oem_espelhar_modulos_no_contrato`. As quatro últimas operam por cliente e não somam MRR; `build_management_digest_block` soma e precisa ser conferida linha a linha.

`preparar_reajuste` é o pior dos três: os outros dois erram um número de tela ou de integração, este **erra o valor que o cliente final passa a pagar**.

**Converter os três para lista branca é a fase 1, isolada, antes de qualquer outra coisa.**

---

## 8. Fases

Cada fase é publicável e reversível sozinha.

| # | Fase | Muda número na tela? |
|---|---|---|
| 1 | Listas negras → brancas nas **três** funções (`calcular_mrr_cliente`, `trg_valor_enfileirar_omie`, `preparar_reajuste`) + auditoria de `build_management_digest_block` | Não |
| 2 | Colunas novas + `categorias_receita` + `valor_pontual` consolidando `vlr_ativacao` / `valor_venda_avulsa` + flag `cliente_produtos.reajusta` | Não (aditivo) |
| 3 | `registrar_movimento_receita` + `estornar_movimento` + `REVOKE` da escrita direta + telas migradas | Não |
| 4 | Backfill de `venda_nova` e churn total + backfill dos 792 `data_proximo_reajuste` no produto + relatório de paridade | Não (extrato ainda não é lido) |
| 5 | `fn_mrr_saldo_em` + `fn_mrr_extrato` + troca das 6 abas, **uma por vez** + **reajuste por produto** (§6.3) | **Sim** — aprovação por aba |
| 6 | `certificado_a1_vendas` migra para o livro | Sim, na aba Vendas |

### Fase 1 — detalhe

Trocar o `NOT IN` por `IN ('upsell','cross_sell','downsell','reajuste')` nas três funções.

Prova, em duas partes:
1. `calcular_mrr_cliente` de todos os clientes ativos dos 3 maiores tenants, antes e depois — **diferença exatamente 0,00** (o enum ainda não tem `venda_nova`, então o `NOT IN` e o `IN` cobrem o mesmo conjunto hoje).
2. `preparar_reajuste` em modo simulação sobre a última janela aplicada — `vlr_mensal_antes` de cada linha idêntico ao que ficou gravado em `reajuste_contratos`.

### Fase 3 — a porta única

`registrar_movimento_receita(p_tenant, p_cliente, p_tipo, p_data, p_valor_delta, p_valor_pontual, p_categoria_id, p_cliente_produto_id, p_modulo_id, p_descricao, p_funcionario_id)` — `SECURITY DEFINER`, `SET search_path = public`, `REVOKE FROM PUBLIC`, `GRANT TO authenticated, service_role`.

**Caminhos de escrita que precisam passar a usá-la ou serem auditados:**

Servidor — 17 funções escrevem em `movimentos_mrr` / `cliente_produtos` / `cliente_produto_modulos`. As 6 que **inserem no extrato** são as críticas: `aplicar_reajuste`, `estornar_reajuste`, `cancelar_contrato`, `reativar_contrato`, `fn_cancelar_modulo_aplicar`, `fn_oem_fila_aplicar`. As demais (`admin_delete_cliente`, `admin_swap_cliente_produto`, `atualizar_custo_ds_oem`, `cancel_cliente_produto`, `create_cliente_produto_with_contract`, `editar_cancelamento`, `fn_oem_espelhar_modulos_no_contrato`, `fn_sync_produto_valores`, `oem_gravar_codigos_em_lote`, `oem_gravar_codigos_no_produto`, `trg_oem_espelhar_ao_vincular`) tocam só estado.

Frontend — escrita direta:

- `src/components/clientes/ClienteProdutosSection.tsx` (3.062 linhas — o monolito; é aqui que produto, módulo e movimento se cruzam)
- `src/components/clientes/MovimentosMrrModal.tsx`
- `src/components/clientes/SugestaoMRRDialog.tsx`
- `src/components/clientes/FinanceiroTab.tsx`, `FinanceiroCard.tsx`
- `src/components/clientes/ClienteContratosSection.tsx`
- `src/pages/ClienteForm.tsx`, `src/pages/Clientes.tsx`
- `src/components/import/ClienteImportModal.tsx`
- `src/components/certificados/CertA1Dashboard.tsx`, `src/pages/CertificadosA1.tsx`, `src/components/clientes/CertificadoA1Section.tsx` (fase 6)

O `REVOKE` só entra **depois** que todos migrarem — senão a tela quebra em produção.

### Fase 4 — backfill e critérios de prova

Gerar, com `origem_registro = 'backfill'`:

- **`venda_nova`** por `cliente_produtos`: `data_movimento = data_venda_efetiva`, `valor_delta = vlr_mensal`, `valor_pontual = vlr_ativacao`, categoria Ativação quando `> 0`.
- **`churn` total** por saída: valor = saldo do cliente na data da saída (a régua já corrigida em 02/08/2026 — churn é o valor **na data da saída**, não a vida inteira).

O backfill **não pode** disparar `trg_movimento_mrr_enfileirar_omie` — 4.990 lançamentos enfileirariam a carteira inteira no ERP. Desabilitar o gatilho na transação ou filtrar por `origem_registro = 'backfill'` dentro dele.

**Critérios de aprovação (todos obrigatórios, antes da fase 5):**

1. Para cada tenant e cada mês dos últimos 24, comparar `Σ fn_mrr_saldo_em` (só extrato) contra `Σ fn_mrr_cliente_em` (régua canônica atual).
   **Não se espera diferença 0,00 — e exigir isso seria errado.** As duas réguas divergem de propósito num caso conhecido: um cliente que sofreu upsell e depois churn fica com o upsell ainda somando na régua atual (`fn_mrr_cliente_em` lê `tipo IN ('upsell','cross_sell','downsell','reajuste')` sem olhar o churn, e só a baixa por `encerrado_em` o remove), enquanto no extrato puro o churn zera o saldo. É a mesma família do bug de 01/08/2026.
   **Critério real:** toda diferença é enumerada por cliente e enquadrada em uma de duas caixas — (a) defeito documentado da régua atual, aceitável e registrado; (b) erro do backfill, bloqueante. **Nenhuma diferença pode ficar sem caixa.** Sair da fase 4 com "resíduo pequeno" é reproduzir o problema que este plano existe para matar.
2. `get_mrr_bridge` recalculado com o extrato completo fecha com resíduo 0,00 em todos os meses — este sim exato, porque a ponte é fechada por construção.
3. Nenhum cliente com saldo negativo (foi o bug de 01/08/2026, 828 clientes).
4. `Σ valor_pontual` de categoria Ativação bate com a origem escolhida no backfill. Como a origem é `cliente_produtos.vlr_ativacao`, a igualdade com R$ 289.528,86 é tautológica e **não prova nada** — o critério que vale é ter explicado a divergência de R$ 4.860,00 contra `contrato_itens` **antes** de migrar, e ter decidido conscientemente qual das duas fontes é a certa.
5. Contagem: 4.990 `venda_nova` + 887 `churn` esperados; qualquer falta identificada individualmente, nunca por diferença agregada.

### Fase 5 — troca das abas, uma por vez

Ordem sugerida, da menor exposição para a maior:

1. **Cancelamentos** — `get_carteira_churn`, `get_churn_detalhe_uf` (hoje cegas ao extrato; é aqui que o número mais muda)
2. **Cohort** — `fn_cohort_logos`, `fn_cohort_saldo_forecast`, `fn_cohort_revenue`
3. **Visão Geral** — `get_tenure_medio_meses`, `get_mrr_monthly_snapshots`
4. **Distribuição** — `useDistribuicaoExtras.ts`
5. **Vendas** — `useVendasExtras.ts` (ganha `valor_pontual`)
6. **Crescimento** — `get_mrr_bridge` reescrita **sem** `mov_de_quem_saiu` e `churn_parcial`, que deixam de existir

Também na fase 5:

- `fn_mrr_por_cliente_em` para de usar `clientes.mensalidade`.
- `src/lib/mrrRuler.ts` deixa de somar base + ajuste — vira leitura direta do saldo.
- **Reajuste por produto** (§6.3): `preparar_reajuste` passa a selecionar por `cliente_produtos.data_proximo_reajuste`, respeitar a flag `reajusta` e calcular a base pelo saldo daquele produto. `reajuste_contratos` ganha `cliente_produto_id`. A bifurcação "1 contrato → MRR inteiro" **deixa de existir**.
  Prova obrigatória: rodar em simulação sobre os 7 clientes multi-produto e conferir manualmente, um por um, que só o produto certo foi incluído.
  `contratos.data_proximo_reajuste` passa a ser mantida como `MIN()` dos produtos ativos, só para o Omie (§6.4).

**Cada aba entrega um relatório antes/depois por tenant e por mês. Sem aprovação do Alexandre, não vai.**

---

## 9. Riscos

| Risco | Mitigação |
|---|---|
| `venda_nova` duplicar o MRR no Omie | Fase 1 isolada, antes de tudo. Prova de diferença 0,00. |
| **`venda_nova` dobrar a base do reajuste** — dinheiro cobrado errado do cliente final | Fase 1 cobre `preparar_reajuste`. É o pior dos três casos de lista negra. |
| Reajuste por produto mudar o valor de quem já tem data marcada | Só entra na fase 5, depois do backfill. Simulação obrigatória sobre os 7 clientes multi-produto. |
| `contratos.data_proximo_reajuste` desatualizar e travar o Omie | Mantida como `MIN()` dos produtos; `montar_payload_contrato_omie` já recusa data vencida — o erro aparece, não passa silencioso. |
| Backfill enfileirar 4.990 contratos no Omie | Gatilho desabilitado na transação / filtro por `origem_registro`. |
| `ADD VALUE` no enum é irreversível | Sem rollback. Só entra depois da fase 1 aprovada. |
| Escrita direta sobreviver ao `REVOKE` | Inventário das 17 funções + 11 arquivos acima. `REVOKE` só na última etapa da fase 3. |
| Lovable escrever nas telas em migração | Trabalho em worktree, `git pull --rebase` antes de push, arquivos em migração declarados. |
| `ClienteProdutosSection.tsx` (3.062 linhas) | Quebrar em unidades menores é parte da fase 3, não refactor à parte. |
| Perda de performance na lista de clientes | `clientes.mensalidade` mantida como cache + conferidor (§5.3). |
| Divergência de R$ 4.860,00 na ativação | Investigar e explicar **antes** do backfill; não migrar dado que não fecha. |
| Delvale não tem movimento → parece que nada muda | O risco está concentrado em Digi Office e ASP. Testar com esses dois. |

---

## 10. Fora de escopo

- Suporte a múltiplos produtos/contratos por cliente no Omie (limitação pré-existente).
- Recorrência não mensal (anual, trimestral, por consumo).
- Separação receita bruta × repasse de fornecedor no mesmo lançamento.
- Renomear a tabela `movimentos_mrr`.
- **Excluir a entidade contrato.** Fica registrado como pedido do Alexandre, adiado com motivo (§2, D5): 1.015 `ds_contract_id` já espelhados no Omie. Se voltar à mesa, é projeto próprio com plano de re-vinculação do ERP.
- Índice de reajuste (IGPM/IPCA) por produto. `contratos.indice_reajuste` existe e é exibido/editável em `ClienteContratosSection.tsx`, mas **não entra no cálculo** — `preparar_reajuste` recebe o percentual por parâmetro. Continua assim.
