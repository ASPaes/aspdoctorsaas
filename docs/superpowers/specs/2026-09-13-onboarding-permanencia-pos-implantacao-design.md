# Permanência pós-implantação (cohort de retenção) — Dashboard de Onboarding

**Data:** 13/09/2026 · **Tenant motivador:** Digi Office Sistemas · **Status:** design aprovado, não implementado

---

## 1. Problema

Um tenant remunera o implantador pelos clientes que **permanecem na base 180 dias após a
implantação finalizada**. Hoje não existe nenhuma tela que responda:

- quantos dos clientes entregues em cada mês ainda estão na base;
- quem saiu antes do marco, quantos dias depois da entrega;
- qual implantador entregou cada um desses clientes.

O Dashboard de Onboarding mede **até a entrega** (SLA, tempo de entrega, treinos). Nada mede
**depois** dela.

---

## 2. O que a métrica é

Uma coorte de retenção: linha = mês em que a implantação foi concluída, coluna = quantos
por cento daquele grupo continuavam na base N meses depois.

Régua: **M0 … M6**, onde M6 é o marco de 180 dias que o tenant remunera.

---

## 3. Decisões (tomadas com o owner em 11–13/09/2026)

| # | Decisão | Por quê |
|---|---|---|
| D1 | **A unidade é o CLIENTE**, não a jornada | 125 jornadas concluídas são só 95 clientes. Por jornada, o mesmo cliente sairia duas vezes e debitaria dois implantadores. |
| D2 | Entrada na coorte = **primeira jornada concluída** do cliente | Coorte é data de entrada; a primeira entrega é o que inicia a relação medida. |
| D3 | Saída = **`clientes.data_cancelamento`** | É o registro de cancelamento do cadastro. Cliente que cancelou e voltou tem a data limpa — e reativado **é** permanência, que é a leitura que a comissão quer. |
| D4 | Crédito = **quem conduz o primeiro treino agendado** da jornada; sem treino, o **responsável no instante da conclusão** | O implantador é quem é definido na etapa de treino ("Quem conduz"), não o dono da jornada — os dois divergem em 9 de 54 jornadas com treino. Mas 71 das 125 concluídas não têm treino nenhum, e sem o fallback 57% da coorte ficaria sem dono. |
| D9 | **Filtro por tipo de treino**, "Todos" por padrão | Com um tipo escolhido, só entram clientes cuja jornada de entrega tem aquele treino, e o crédito é do condutor **daquele** tipo. Recorta forte de propósito: "Treinamento PDV" leva a coorte de 125 para 29 jornadas. |
| D5 | Régua **mensal M0..M6** no gráfico principal | Familiar: é a mesma leitura do cohort de MRR que já existe. |
| D6 | **Mais uma faixa de dias** (0–30 / 31–60 / 61–90 / 91–180) abaixo do gráfico | As saídas medidas hoje caem todas em M0. Sem a faixa em dias, o gráfico mensal esconde justamente o caso que o owner descreveu. |
| D7 | Cadastro inconsistente **fora do denominador** | Cliente com cancelamento anterior à entrega não é retenção nem churn do implantador — é dado sujo. Contado à parte, com aviso visível. |
| D8 | **Sem RPC nova, sem migration** | Tudo já está carregado na página; falta uma query de 95 ids em `clientes`. |

---

## 4. Definição exata do cálculo

### 4.1 Entrada na coorte

Jornada elegível: `situacao = 'concluido'` **e** `cliente_id IS NOT NULL`.

Data da entrega:

```
fim = go_live_real ?? concluido_em (como data, America/Sao_Paulo)
```

`go_live_real` é a data de negócio quando existe (58 de 125 jornadas concluídas);
`concluido_em` cobre 125 de 125 e é o fallback. As duas diferem em 6 jornadas.

> **Não usar `onboarding_concluido_em`.** Ele marca o fim da *fase* de onboarding — a
> passagem para Implantação, não a entrega. 61 jornadas têm esse carimbo e ainda estão
> *em* implantação. Também não usar `implantacao_concluida_em` sozinho: só 66 das 125
> concluídas o têm.

Um cliente entra **uma vez**, com `fim = MIN(fim)` entre suas jornadas concluídas.
O mês da coorte é `yyyy-MM` desse `fim`.

### 4.2 Saída

```
saida = clientes.data_cancelamento   (null = ainda na base)
```

- `saida >= fim` → saiu. `dias = saida - fim`.
- `saida < fim` → **inconsistente** (ver 4.4).
- `saida IS NULL` → permaneceu.

### 4.3 Retenção acumulada

Para cada coorte C e cada M∈{0..6}:

```
limite   = fim + M meses            (addMonths, mesma data no mês seguinte)
madura   = hoje >= limite           (a coorte inteira; não por cliente)
saidos   = clientes da coorte com saida <= limite
retencao = 1 - saidos / tamanho_da_coorte
```

**Célula não madura fica VAZIA, nunca 100%.** Uma coorte de 20 dias não "reteve 100% em
M6" — ela não chegou lá. Esse é o erro clássico de cohort e é proibido aqui.

O denominador é fixo (tamanho da coorte), não decai a cada coluna: é retenção acumulada,
não sobrevivência condicional.

### 4.4 Exclusões

Cliente com `data_cancelamento < fim` sai do numerador **e** do denominador e aparece num
aviso próprio: *"N clientes constam cancelados antes da própria entrega — cadastro a
conferir"*, com a lista. Somá-los como saída puniria o implantador por dado sujo; somá-los
como retidos seria mentira (hoje têm 0 contratos ativos).

Medido em 13/09/2026: **1 caso** em 95.

### 4.5 Crédito ao implantador

O implantador é **quem conduz o treino**, não o dono da jornada. A jornada que dá o
crédito é a **mesma** que definiu `fim` (a primeira concluída).

```
treinos    = treinos daquela jornada com cancelado_em IS NULL
             E conduzido_por IS NOT NULL
             (e, com filtro de tipo ativo, só os daquele training_type_id)
escolhido  = o de menor agendado_para (nulos por último; desempate pelo id)
implantador = escolhido.conduzido_por          → origem "treino"
```

**Sem treino que sirva**, cai no responsável do instante da conclusão:

```
implantador = último userId de responsaveisNaJanela(periodos[journey_id], fim, fim)
              ?? journey.responsavel_user_id   → origem "jornada"
```

Janela de instante (`de = ate = fim`): devolve quem era dono no momento da conclusão, não
o dono de hoje. Sem histórico, cai no `responsavel_user_id` da view — mesma degradação que
os outros cards já adotam.

Cada cliente carrega a `origem` do próprio crédito, e a tela diz quantos vieram do
fallback. Sem isso, 71 linhas creditadas por um critério diferente passariam por
condutores de treino sem ninguém perceber.

Treino **cancelado** (`cancelado_em`) nunca credita: são 3 na base, e quem teve o treino
cancelado não conduziu nada.

Treino **sem "Quem conduz" preenchido** também não credita — ele não aponta ninguém, e
creditar `null` com origem "treino" produziria uma linha "—" indistinguível de um implantador
desconhecido. Ele cede a vez ao próximo treino elegível e, na falta de outro, ao fallback da
jornada. Hoje é caso teórico: os 74 treinos das jornadas concluídas têm condutor.

### 4.6 Filtro por tipo de treino

Seletor próprio na seção, "Todos os tipos" por padrão. Com um tipo escolhido:

- **entra** só o cliente cuja jornada de entrega tem treino não cancelado daquele tipo;
- **o crédito** é do condutor do primeiro treino **daquele tipo**;
- **não há fallback** — sem o treino do tipo, o cliente não está no recorte.

A coorte encolhe de verdade (PDV: 29 de 125 jornadas) e a tela precisa dizer isso em
texto, senão a queda parece perda de dado.

---

## 5. Estado do dado em 13/09/2026 (produção)

| Medida | Valor |
|---|---|
| Jornadas concluídas | 125 |
| Clientes na coorte (D1+D2) | **95** |
| Saídas após a entrega | **2** (7 e 8 dias) |
| Cadastros inconsistentes | 1 |
| Coorte mais antiga | 16/07/2026 |
| Clientes maduros em M1 | 31 |
| Clientes maduros em M2 | **0** |
| Jornadas concluídas com treino | 54 de 125 |
| ...com condutor ≠ responsável da jornada | 9 |
| ...com mais de um treino | 12 (9 com condutores diferentes) |
| Treinos cancelados (não creditam) | 3 |
| Tipos de treino cadastrados | 11 · "Treinamento PDV" em 29 jornadas |
| Primeiro M6 da base | **12/01/2027** |

**A tela nasce quase vazia, e isso é correto.** O valor imediato está na faixa de dias e na
tabela por implantador; a matriz ganha corpo ao longo dos meses. Qualquer versão que
mostre a matriz "cheia" hoje está mentindo sobre maturidade.

Tenants com jornada concluída: Digi Office (a grande maioria), CONSYSA (3), Delvale (1).

---

## 6. Arquitetura

Nenhuma RPC, nenhuma migration, nenhuma view. Três peças:

### 6.1 `src/pages/onboarding/permanencia.ts` — lógica pura

Sem React, sem Supabase. Entrada/saída tipadas, 100% testável — mesmo padrão de
`dashMetrics.ts` e `responsavelNaJanela.ts`.

```ts
export interface EntradaPermanencia {
  journeys: JourneyPermanencia[];          // situacao/cliente_id/go_live_real/concluido_em/journey_id/responsavel_user_id
  cancelamentoPorCliente: Record<string, string | null>;  // cliente_id -> data_cancelamento
  periodosResponsavel: Record<string, PeriodoResponsavel[]>;
  hoje: Date;                              // injetado: teste não depende do relógio
  mesesJanela: 3 | 6 | 12;
}

export interface ResultadoPermanencia {
  coortes: Coorte[];                       // mes, tamanho, celulas[M0..M6] (null = imatura)
  faixas: FaixaDias[];                     // 0-30 / 31-60 / 61-90 / 91-180, contagem + clientes
  porImplantador: LinhaImplantador[];      // userId, entregues, saidas, pctM6 (null se imaturo)
  inconsistentes: ClientePermanencia[];
  clientes: ClientePermanencia[];          // base do drill-down
}
```

### 6.2 `src/pages/onboarding/PermanenciaSection.tsx` — a seção

Recebe `journeys`, `treinos`, `nomes`, `tenantId` e os recortes por prop, igual a
`TempoDeEntregaSection`. Os treinos **já estão carregados na página** (`trainingsAllQ`) —
não abrir query nova para eles. Faz **uma** query própria:

```ts
supabase.from("clientes").select("id, data_cancelamento")
  .eq("tenant_id", tid).in("id", clienteIds)
```

95 ids hoje; usar `fetchAllRows` mesmo assim (regra do projeto, e a base cresce).
`queryKey` inclui `effectiveTenantId` e o `viewKey` do filtro de unidade.

### 6.3 Ligação em `OnboardingDashboardPage.tsx`

Uma seção nova, depois de `TempoDeEntregaSection`, recebendo **`ativas`** (não `periodo`:
a coorte é por data de conclusão, e `periodo` recorta por sobreposição de abertura — o
mesmo motivo já documentado em `TempoDeEntregaSection`).

**A seção tem seletor próprio de janela (3/6/12 meses), independente do `DateRangePicker`
do topo.** O topo abre no mês corrente e a matriz sairia com uma linha só. Os filtros de
unidade, pipeline e responsável continuam valendo normalmente.

---

## 7. Interface

Três blocos dentro de uma seção "Permanência pós-implantação":

1. **Matriz M0..M6** — linha por mês de coorte, célula colorida por faixa de retenção,
   reusando a escala de cores de `CohortTab` — hoje `getRetentionColor` é local e não
   exportada; extrair para `src/components/dashboard/retentionColor.ts` e passar a ser
   importada pelos dois, em vez de copiar a função. Célula imatura: cinza
   com "—" e tooltip *"a coorte ainda não chegou a M3"*. Cabeçalho marca M6 como o marco
   remunerado.
2. **Faixa de dias até a saída** — barras 0–30 / 31–60 / 61–90 / 91–180, contagem absoluta.
   É o bloco que tem número hoje.
3. **Tabela "Implantador × permanência"** — entregues, saídas, dias médios até a saída,
   % em M6 (vazio enquanto imaturo). Ordenada por entregues.

Clique em qualquer célula/barra/linha abre o `DrilldownSheet` já existente com: cliente,
data da entrega, implantador creditado, data de saída e **dias exatos**. É essa lista que
o tenant confere para pagar.

Aviso dos inconsistentes (4.4) no rodapé da seção, discreto, com a lista no mesmo sheet.

Padrão visual: o mesmo das seções vizinhas (Card + `KpiCard` + tabela shadcn). Sem gráfico
novo de biblioteca — recharts já está na página.

---

## 8. Testes

`src/pages/onboarding/permanencia.test.ts`, com `hoje` injetado:

1. Cliente com duas jornadas concluídas entra **uma vez**, pela mais antiga.
2. Célula imatura é `null`, não 100% — coorte de 20 dias em M6.
3. Saída em D+45 conta em M1 e na faixa 31–60, e **não** em M0.
4. Saída exatamente no limite (`saida == fim + 1 mês`) conta em M1 (limite fechado).
5. `data_cancelamento < fim` sai do denominador e entra em `inconsistentes`.
6. `data_cancelamento IS NULL` com `data_reativacao` preenchida conta como **permaneceu**.
7. Crédito vai para o responsável do instante da conclusão, não para o atual — jornada
   que trocou de mão depois da entrega.
8. Jornada sem histórico de responsável cai no `responsavel_user_id` da view.
9. Coorte sem nenhuma saída dá 100% nas colunas maduras.
10. `cliente_id` nulo é ignorado sem quebrar.
11. Crédito vai para o condutor do treino, não para o responsável da jornada.
12. Com dois treinos de condutores diferentes, vale o de **menor** `agendado_para`.
13. Treino cancelado não credita — cai no responsável da jornada.
14. Jornada sem treino cai no responsável da conclusão e é marcada com `origem: "jornada"`.
15. Com filtro de tipo, jornada sem treino daquele tipo **sai** da coorte (sem fallback).

Não há teste de UI; a lógica inteira mora no módulo puro.

---

## 9. Fora de escopo

- **Marco configurável por tenant** (180 fixo como M6 nesta entrega). Quando um segundo
  tenant tiver régua diferente, vira ajuste em Configuração · Implantação.
- **Cálculo de valor de comissão.** A tela dá a base de conferência, não o dinheiro.
- **Retenção por receita** (MRR retido) — a coorte aqui é por logo. O cohort de receita já
  existe no Dashboard financeiro.
- **Backfill/limpeza dos cadastros inconsistentes.** A tela só os expõe.

---

## 10. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Tela nasce sem dado e parece quebrada | Estado vazio explícito: *"a coorte mais antiga tem N dias; M6 da primeira turma cai em 12/01/2027"*. |
| `data_cancelamento` é campo único e mutável: reativação apaga o histórico | Aceito (D3) — reativado é permanência. 2 casos conhecidos na base. |
| Cliente entregue por um implantador e reentregue por outro | D2 fixa o crédito na primeira entrega. Revisitar se o owner apontar caso real. |
| Coorte pequena (Consysa: 3, Delvale: 1) vira percentual sem sentido | Mostrar sempre `n` ao lado do %; coorte com menos de 5 clientes sai com o número absoluto em destaque. |
