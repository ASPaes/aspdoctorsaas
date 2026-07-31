# Implantação Encerrada: o cartão do go-live para de sumir

**Data:** 31/07/2026
**Gatilho:** TK-2026-2193 recebeu go-live e o cartão sumiu do quadro da Implantação.

## O que estava errado

O quadro da Implantação decide o que mostrar olhando `journey_situacao`. Isso erra dos dois lados:

- **Sem jornada seguinte configurada**, o go-live chama `conclude_onboarding_journey`, a jornada
  vira `concluido` e o filtro padrão ("Ativas") corta o cartão. Foi o que aconteceu com o
  TK-2026-2193 — sumiu com o treinamento já `realizado` na etapa `Concluído`.
- **Com o Acompanhamento ligado** (fase ativada 31/07 16:55, pipeline 17:09 na Digi Office), o
  go-live passa a chamar `advance_onboarding_phase` e a jornada segue `em_andamento`. Aí o cartão
  nunca mais sai do quadro da Implantação.

Havia ainda um buraco de regra: a trava "não encerra com sub-ticket de treinamento em aberto"
só existia em `conclude_onboarding_journey`. `advance_onboarding_phase` não tem trava nenhuma —
ou seja, a partir das 17:09 de 31/07 dava para registrar go-live com treinamento em aberto.

## Decisões do owner

1. **Não criar etapa nova.** A etapa marcada `is_final` no pipeline de Implantação **é** a
   "Implantação Encerrada". Na Digi Office ela se chama `Concluído`.
2. **Go-live só finaliza a jornada inteira**: todo sub-ticket de treinamento precisa estar
   encerrado. Caso contrário, bloqueia.
3. **O cartão precisa existir no banco**, não ser um enfeite calculado na tela — a auditoria
   futura vai consultar o banco.
4. **Janela padrão de 30 dias, mas a busca ignora a janela**: procurar por um cliente traz o
   go-live dele de dois meses atrás.

## Desenho

### Backend — `20260731230000_golive_trava_e_arquivamento.sql`

**`journey_go_live` ganha a trava.** A guarda sobe para cá, que é o único caminho de go-live do
front, e assim cobre os dois desfechos (concluir e avançar de fase). Retorna
`{ok:false, reason:'treinos_em_aberto', qtd, codigos}` — formato que `handleConclude` já trata.
Vale **inclusive para admin**: o bypass de admin existe só no botão do front.

`conclude_onboarding_journey` fica intocada — a guarda dela vira redundante, não errada.

**`fn_onb_arquivar_treinos_no_golive(journey)`** leva para a etapa final todo treino `realizado`
que ficou fora dela. Chamada por `journey_go_live` **depois** do go-live dar certo, e só então.

- O pipeline vem da etapa em que o treino está, não da jornada: com fase seguinte,
  `advance_onboarding_phase` já moveu a jornada para o pipeline do Acompanhamento, e derivar dela
  apontaria para o pipeline errado.
- Reusa `move_onboarding_training_stage`, que já fecha a linha de histórico com duração útil,
  marca `realizado_em` e registra o evento no ticket pai. É isso que dá a trilha de auditoria.
- **Não toca em `cancelado`** (fica fora do quadro por desenho) nem em treino aberto — a trava
  garante que não existe treino aberto num go-live.
- Idempotente: rodar de novo move zero.

**Caso legado que fica como está:** TK-2026-1593 deu go-live em 13/07, antes da trava, com o
filho `TK-2026-1593-1` ainda `agendado`. Marcar como `realizado` só para caber na coluna final
seria falsificar histórico. O cartão reaparece dizendo a verdade e sai do quadro em 12/08.

### Frontend

`OnboardingPage.tsx`:

- `vw_onboarding_journey_phases` passa a trazer `concluida_em`.
- `goLiveEm(journeyId, situacao)` devolve quando a Implantação daquela jornada fechou — `null`
  se ainda aberta ou se a jornada foi cancelada (cancelamento não é go-live).
- O filtro do cartão deixa de olhar `situacao` para esse caso: fase fechada → fica na coluna
  final por 30 dias; **com busca digitada, a janela não se aplica**. Situação escolhida à mão
  no filtro continua mandando, inclusive fora da janela.
- `jornadasSemTreino` segue a mesma regra.

`ImplantacaoBoard.tsx`:

- Selo `Go-live DD/MM` no cartão (barra verde no topo, mesma geometria da barra azul de treino
  agendado) e no cartão da visão agrupada.
- Cartão de go-live **não é arrastável** — arrastar reescreveria a etapa arquivada.
- Aviso acima das colunas quando a busca está mostrando go-lives fora dos 30 dias.

`JourneyDetailSheet.tsx`: mensagem própria para `treinos_em_aberto`, listando os códigos abertos.

## Fora de escopo

- Relatório/tela de auditoria de go-lives — o owner pediu para tratar depois.
- Regra de criar ticket de Acompanhamento.
- Reabertura de jornada com go-live dado por engano.

## Testes

`scripts/sql-tests/20_golive_trava_e_arquivamento.sql`, em jornada real dentro de
`BEGIN/ROLLBACK`, cobrindo o caminho novo (com fase seguinte): trava bloqueia e não deixa rastro,
go-live passa com todos os filhos encerrados, treinos realizados terminam na etapa final com
linha de histórico aberta e evento no pai, cancelado não é arrastado, e a segunda passada do
arquivamento move zero.
