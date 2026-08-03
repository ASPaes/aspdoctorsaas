# Dashboard de Onboarding — jornadas canceladas fora dos indicadores

**Data:** 2026-08-02
**Arquivos:** `src/pages/onboarding/OnboardingDashboardPage.tsx`, `src/pages/onboarding/OnboardingSlaOverview.tsx`
**Escopo:** só frontend. Nenhuma migration, nenhuma alteração de view, nenhuma escrita em produção.

---

## Problema

O dashboard não distingue jornada cancelada de jornada viva. Toda seção — SLA, treinamentos,
tempo parado, retornos ao vendedor — conta as canceladas junto. Não existe card mostrando
quantas jornadas estão em aberto nem quantas foram canceladas.

Auditoria feita contra a produção da Digi Office em 02/08/2026 (49 jornadas: 22 em andamento,
15 não iniciadas, 8 canceladas, 4 concluídas).

### Contaminação medida

| Seção | Hoje | Sem canceladas |
|---|---|---|
| SLA Total · jornadas com SLA | 48 | 41 |
| Retornos ao vendedor | 1 retorno — **todo ele de jornada cancelada** | 0 |
| Tempo parado | 3 pausas, **2 de cancelada** | 1 |
| Treinamentos | 26 sessões, **11 de cancelada** | 15 |

O card de retornos ao vendedor é 100% ruído hoje.

### Defeitos encontrados além do pedido

1. **O filtro de período não vale para o SLA.** `journeysQ`
   ([OnboardingDashboardPage.tsx:112-125](../../../src/pages/onboarding/OnboardingDashboardPage.tsx#L112-L125))
   não tem filtro de data. As quatro seções de SLA são sempre "desde sempre", enquanto
   treinos, pausas e retornos respeitam o `DateRangePicker`. O card "Total PDV finalizados"
   mistura os dois: o número é do período, o subtítulo "N jornadas concluídas" é do histórico
   inteiro.

2. **`no_show` é flag pegajosa, não desfecho.**
   [JourneyDetailSheet.tsx:1593](../../../src/pages/onboarding/JourneyDetailSheet.tsx#L1593)
   grava `no_show=true` e nunca limpa; `handleMarkRealized` não reverte. Resultado: a "Taxa de
   no-show" de 33,3% soma quatro situações distintas — uma sessão realizada na 3ª tentativa
   (contada como no-show *e* como realizada), uma agendada que ainda vai acontecer, uma
   cancelada que teve falta, e uma que de fato terminou em falta.

3. **`status='cancelado'` conta como treino.** 11 das 26 sessões. Entram no denominador de
   "% Retreinamento" e no rótulo "N agendados no total". A tabela "Por tipo de treino" não tem
   coluna para cancelado — o número some sem rastro.

4. **"Total PDV finalizados" é estruturalmente 0.** Nenhum dos 9 tipos de treino da Digi Office
   tem `conta_como_pdv=true`, nem o "Treinamento PDV", que tem 19 sessões. O card mostra um `0`
   mudo que parece resultado e é cadastro em branco.

5. **"Proprietário presente" trata `NULL` como ausência.** `proprietario_presente` é nullable:
   2 `true`, 0 `false`, **24 `NULL`**. O card calcula 2/9 = 22,2% e pinta de vermelho contra a
   meta de 90%. Acusa a equipe de um problema que é campo não preenchido.

6. **4 sessões sem data nenhuma** (`realizado_em` e `agendado_para` ambos nulos) são descartadas
   por qualquer período — invisíveis no dashboard.

Verificado e **descartado como defeito**: `is_retreinamento` é `NOT NULL DEFAULT false`, então
0% de retreinamento é leitura legítima e não campo vazio. Só o denominador precisa de conserto.

---

## Decisões tomadas

| Questão | Decisão |
|---|---|
| Jornada cancelada nos indicadores | Fora de tudo. Aparece só no card próprio. |
| Filtro de período | Duas faixas explícitas: estado agora (ignora período) + resto (respeita). |
| Treino cancelado | Desfecho próprio, com card e coluna. Pode ter tido no-show ou não. |
| Card PDV zerado | Estado vazio explicativo. Sem escrita em produção. |

---

## Desenho

### 1. Faixa "Situação agora"

Nova seção no topo, antes do `OnboardingSlaOverview`. Contagem de jornadas por situação,
**ignorando o `DateRangePicker` de propósito** — é foto do estado atual, não do intervalo. O
subtítulo da seção diz isso na tela.

| Card | Valor (Digi Office hoje) | Subtítulo |
|---|---|---|
| Em aberto | 37 | 22 em andamento · 15 não iniciadas |
| Concluídas | 4 | — |
| Canceladas | 8 | 16,3% das 49 |

"Em aberto" = `situacao IN ('nao_iniciado','em_andamento','parado')`. O valor `parado` existe no
enum `onb_situacao` e hoje tem 0 linhas; entra na conta para não sumir quando aparecer.

### 2. Regra única de exclusão

Um único ponto de corte, derivado da query existente. Três listas a partir de `journeysQ.data`:

```
journeys        — tudo, sem filtro. Só a faixa "Situação agora" usa.
journeysAtivas  — journeys sem situacao === 'cancelado'.
journeysPeriodo — journeysAtivas com aberta_em dentro do dateRange.
```

- `allowedJourneyIds` passa a ser construído de **`journeysAtivas`**, não de `journeys`. Como
  treinos, pausas e retornos já filtram por esse Set, herdam a exclusão sem alteração própria.
- `OnboardingSlaOverview` recebe **`journeysPeriodo`**.
- `concluidas` sai do subtítulo do card de PDV e passa a viver na faixa 1.

A separação entre `journeysAtivas` e `journeysPeriodo` é obrigatória: se os treinos usassem a
lista recortada por data de abertura, um treino de agosto numa jornada aberta em junho sumiria
da tela.

`journeysQ` precisa passar a selecionar `aberta_em` (a view já expõe; o `select` atual não pede).

### 3. Desfecho do treino vira exclusivo

`status` (enum `onb_treino_status`: `previsto`, `agendado`, `realizado`, `no_show`, `cancelado`)
passa a ser a única fonte do desfecho:

| Desfecho | Regra |
|---|---|
| Realizado | `status === 'realizado'` |
| No-show | `status === 'no_show'` |
| Cancelado | `status === 'cancelado'` |
| Em aberto | `status === 'previsto' \|\| status === 'agendado'` |

`no_show === true` deixa de ser desfecho e vira um número separado: **"sessões que faltaram ao
menos uma vez"**, exibido como subtítulo. É a leitura correta da flag pegajosa. São 4 na base
inteira da Digi Office; 2 dentro do recorte de julho sem canceladas.

Métricas recalculadas:

- **Taxa de no-show** = `noShow / (realizado + noShow)`. Cancelado fora do denominador — uma
  sessão cancelada não é uma falta do cliente. Acaba a dupla contagem da sessão realizada na
  3ª tentativa.
- **% Realizado** = `realizado / (realizado + noShow + emAberto)`. Cancelado fora.
- **% Retreinamento** = `retreinos / (realizado + noShow + emAberto)`. Denominador deixa de
  incluir cancelado.
- Rótulo "N agendados no total" passa a contar só o que não foi cancelado.

Tabela "Por tipo de treino" ganha coluna **Cancelados**, para o número não sumir sem rastro.
Coluna No-show passa a usar o desfecho, com a contagem de faltas como `title` da célula.

### 4. Cards que dão veredito sobre campo em branco

**Total PDV finalizados.** Query nova e barata em `onboarding_training_types` do tenant. Se
nenhum tipo tem `conta_como_pdv=true`, o card não mostra `0`: mostra `—` com a explicação
"nenhum tipo de treino marcado como PDV" e um link para o cadastro. Sem cor de veredito.

**Proprietário presente.** Denominador passa a ser só as sessões com o campo **informado**
(`proprietario_presente !== null`), não todas as realizadas. Digi Office: 2 de 2 = 100%, com
subtítulo de cobertura "2 de 9 realizados informados". Se a cobertura for 0, mesmo tratamento
do PDV: `—` e a explicação, sem cor.

Sem cobertura, um percentual é opinião, não medida. O card passa a dizer qual dos dois está
mostrando.

---

## Fora de escopo

- Limpar a flag `no_show` ao marcar realizado. É correção no fluxo de escrita
  (`JourneyDetailSheet`), não no dashboard, e mudaria dado histórico.
- Marcar `conta_como_pdv` no tipo "Treinamento PDV" da Digi Office. Escrita em produção,
  decisão do Alexandre.
- As 4 sessões sem data. Ficam invisíveis; conserto exige decidir uma data de fallback.
- Recorte do SLA por jornada *ativa* no período em vez de *aberta* no período. A coorte por
  abertura é a leitura escolhida ("das que entraram em julho, quantas cumpriram o SLA").

## Consequência a avisar antes de publicar

As 49 jornadas da Digi Office foram abertas em **julho/2026**, e o dashboard abre no mês
corrente. Com o período padrão (agosto), `journeysPeriodo` fica vazio e **as quatro seções de
SLA passam a aparecer em branco** — hoje elas mostram 48 jornadas porque ignoram o período.

Isso é o comportamento correto da decisão tomada, não regressão, e é exatamente a razão de
existir a faixa "Situação agora": ela continua mostrando 37 / 4 / 8 independente do intervalo.
Ainda assim, é mudança visível na primeira abertura — precisa ser dita ao Alexandre antes de
publicar, não descoberta por ele na tela.

## Verificação

Gabarito medido em produção (Digi Office, 02/08/2026). Depois da mudança, **com o período
ajustado para julho/2026**:

| Indicador | Esperado | Era |
|---|---|---|
| Situação agora | 37 em aberto · 4 concluídas · 8 canceladas | não existia |
| SLA Total · jornadas com SLA | 41 | 48 |
| Retornos ao vendedor | 0 | 1 (de jornada cancelada) |
| Tempo parado | 1 pausa | 3 pausas |
| Sessões de treino no período | 10 não canceladas (11 com a cancelada) | 26 |
| Realizados | 9 | 9 |
| Desfecho no-show | 0 | — |
| Taxa de no-show | **0%** (0 de 9) | 33,3% |
| % Realizado | 90% (9 de 10) | — |
| % Retreinamento | 0% (0 de 10) | 0% de 26 |
| Proprietário presente | 100% · cobertura 2 de 9 informados | 22,2% em vermelho |
| Total PDV finalizados | `—` com nota de cadastro | `0` |

A taxa de no-show cai de 33,3% para 0% porque a única sessão cujo **desfecho** foi falta
pertencia a uma jornada cancelada. As outras três que hoje inflam o número são a flag pegajosa:
duas sessões seguiram adiante (uma realizada, uma reagendada) e uma foi cancelada. Elas passam
a aparecer como "2 sessões faltaram ao menos uma vez", que é o que o dado de fato diz.

Nota: 4 das 26 sessões não têm `realizado_em` nem `agendado_para` e continuam fora de qualquer
período — é o defeito 6, deixado fora de escopo.

Testes com `createRoot` + `act` (RTL não funciona neste repo), no padrão de
`ImplantacaoBoard.test.tsx`. Type-check com `npx tsc -p tsconfig.app.json` — `tsc` na raiz não
checa nada.

Testes com `createRoot` + `act` (RTL não funciona neste repo), no padrão de
`ImplantacaoBoard.test.tsx`. Type-check com `npx tsc -p tsconfig.app.json` — `tsc` na raiz não
checa nada.
