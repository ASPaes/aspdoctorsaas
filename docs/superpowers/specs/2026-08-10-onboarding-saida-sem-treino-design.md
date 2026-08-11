# Saída do Onboarding decide pelo treino agendado

**Data:** 10/08/2026 · **Origem:** DEM-0269 · **Caso:** TK-2026-2873 (ESQUINA DA ERIKA, Digi Office)

## Problema

`advance_onboarding_to_implantacao` move a jornada para a Implantação **sem olhar treino
nenhum**. Li a função inteira: não há uma linha sobre `onboarding_training_sessions`.

A TK-2026-2873 saiu do Onboarding em 07/08 13:28 com zero treino. O evento gravado é
`onboarding_fase_implantacao` — foi o botão "Concluir onboarding → Implantação", não o
Go-live. Ela parou na etapa "Treinamento Marcado" da Implantação PDV, sem treino que a
faça andar.

Quem consegue tirá-la de lá: ninguém da equipe. `canGoLive` em
`JourneyDetailSheet.tsx:1063` é `(faseSlug === "implantacao" && etapaFinal) || isAdmin`, e
todo o time de onboarding da Digi Office é `head`. `head` não vê Go-live no Onboarding, e
na Implantação só o veria na etapa final — que não é onde a jornada está. São 6 jornadas
na Implantação sem nenhum treino hoje; nenhuma na etapa final.

## Regra

**Gatilho: o botão Go-live**, e ele vira a **saída única** do Onboarding — decisão do owner
em 11/08. Duas consequências obrigatórias:

- **Go-live passa a aparecer para `head`/`user`** na etapa final do Onboarding. Sem isso a
  regra não alcança ninguém: todo o time de onboarding da Digi Office é `head` e o
  `canGoLive` de hoje esconde o botão deles. `canGoLive` vira `etapaFinal || isAdmin`.
- **"Concluir onboarding → Implantação" sai da tela.** O que ele fazia vira a opção
  "Transferir para Implantação" de dentro do diálogo. Dois botões com destinos diferentes
  na mesma barra foi o que produziu a TK-2026-2873.

O que o Go-live faz passa a depender da fase: no **Onboarding**, aplica a regra abaixo; na
**Implantação** (e nas fases seguintes), segue exatamente como hoje — encerra a jornada.

Nota de rótulo, registrada e não resolvida: "Go-live" descreve bem a saída B (cliente no ar,
sem treino a fazer) e mal a saída A (avanço interno de fase). O owner preferiu não criar
rótulo novo; o diálogo é que nomeia os destinos.

**Treino vivo** = sessão em `onboarding_training_sessions` da jornada com
`deleted_at IS NULL` e `status <> 'cancelado'`. Contam `previsto`, `agendado`, `realizado`
e `no_show`; só `cancelado` não conta.

| Situação | Comportamento |
|---|---|
| Tem treino vivo | Vai para a Implantação direto, sem perguntar. Comportamento de hoje. |
| Não tem | Abre o diálogo com as duas saídas abaixo. |

**Saída A — "Transferir para Implantação".** Move a jornada, sem formulário e **sem exigir
agendamento** — decisão do owner em 11/08. Quem quiser agendar usa o botão "Agendar treino",
que já fica disponível na Implantação a qualquer momento (`canScheduleTraining` retorna
`true` para toda fase que não seja a primeira, `JourneyDetailSheet.tsx:1016`). Chama
`advance_onboarding_to_implantacao` com o opt-in explícito.

**Saída B — "Encerrar no Onboarding, sem necessidade de treino".** Chama `journey_go_live`.
A jornada vai a `concluido`, o cartão cai na coluna "Onboarding concluído" e o ticket TK
fecha. Justificativa **opcional** (gravada no evento da Timeline) e data de go-live real
**opcional** (em branco = hoje), igual ao diálogo de Go-live atual.

Cancelar o diálogo não faz nada.

**O que a regra é e o que ela não é.** Com a saída A não exigindo agendamento, o diálogo
deixa de *impedir* que uma jornada entre na Implantação sem treino e passa a *tornar isso
consciente*. A porta que produziu a TK-2026-2873 continua aberta — ganha uma placa. Foi
decisão explícita do owner, não descuido de desenho. O ganho é que ninguém mais atravessa
sem perceber.

## Onde a checagem mora

**Dentro da RPC**, não só no React. `advance_onboarding_to_implantacao` passa a recusar com
`{ ok: false, reason: 'sem_treino' }` quando não há treino vivo, a menos que o chamador
passe um opt-in explícito. Sem isso a regra é decorativa: qualquer outro caminho fura.

Os dois caminhos que precisam obedecer:

1. Botão **Go-live** na etapa final do Onboarding — `JourneyDetailSheet.tsx`, `handleConclude`.
2. **Arrastar o cartão** para a coluna "Onboarding concluído" no quadro —
   `OnboardingPage.tsx:647`. Hoje esse arrasto chama `advance_onboarding_to_implantacao`,
   ou seja: uma coluna chamada "Onboarding concluído" que na verdade manda para a
   Implantação. Mesmo diálogo, mesma regra.

## Correções que entram junto

- `conclude_onboarding_journey` grava `implantacao_concluida_em = now()` mesmo quando a
  jornada nunca entrou na Implantação. Encerrando no Onboarding isso vira dado falso em
  relatório de implantação. Só gravar quando `v_fase = 'implantacao'`.
- `revert_onboarding_to_onboarding` existe no banco, **não está ligada a nenhum botão** e
  está errada: apaga a linha de fase do **Onboarding** (`WHERE fase = 'onboarding'`) em vez
  da Implantação, e não limpa `duracao_util_minutos` ao reabrir o histórico. Quem a
  chamasse perderia o tempo real do onboarding e ganharia uma Implantação fantasma. Ou
  conserta, ou remove.

## Fora de escopo

- **Go-live na etapa final do Acompanhamento continua só para admin.** `canGoLive`
  ficou `((implantacao|onboarding) && etapaFinal) || isAdmin` em vez do mais simples
  `etapaFinal || isAdmin` justamente para não liberar de carona uma fase que ninguém
  pediu. Se jornadas começarem a empilhar no Acompanhamento, é o mesmo bug e a
  correção é de uma linha.
- As outras 5 jornadas sem treino na Implantação (TK-2026-2601, 2602, 2610, 2611, 2624).
  Estão em etapas que fazem sentido sem treino ("Pendências", "Pendente Agendar") e o
  owner decidiu não mexer.

## Dado a corrigir

TK-2026-2873 volta para o Onboarding, etapa "Marcar treinamento PDV", por SQL: apaga a
passagem pela Implantação em `onboarding_stage_history` e em `onboarding_phase_metrics`,
reabre a última passagem do Onboarding e limpa `onboarding_concluido_em` /
`implantacao_iniciada_em`. Os triggers `fn_sync_onboarding_journey_phase` e
`fn_open_onboarding_phase_row` derivam `current_phase_id` e reabrem a linha de fase
sozinhos — a linha da Implantação tem que ser apagada **depois** do UPDATE da jornada,
senão o trigger a fecha com `now()` e ela sobrevive. O evento original de 07/08 fica na
Timeline; entra um `onboarding_fase_revertida` ao lado. Ensaiado com rollback: resultado
confere.
