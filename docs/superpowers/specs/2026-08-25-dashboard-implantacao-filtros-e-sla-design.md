# Dashboard de Implantação — filtros e 3 variáveis novas de SLA

Data: 2026-08-25 · Owner: Alexandre (ASP) · Módulo: Onboarding & Implantação

## Problema

O Dashboard de Onboarding (`src/pages/onboarding/OnboardingDashboardPage.tsx`) só tem
um recorte: data. Não dá para olhar um pipeline, um responsável ou um tipo de demanda
isolado. E três perguntas de operação não têm resposta na tela:

1. Quanto tempo, em média, uma etapa consome — e de quem é esse tempo.
2. Quanto tempo leva, do começo ao fim, implantar um cliente.
3. Quanto o responsável demora para fazer o primeiro contato com o cliente depois de
   receber a jornada.

Além disso, todo número do painel é um agregado sem lastro visível: não há como clicar
e ver de onde ele veio.

## Fatos medidos (produção, 2026-08-25)

Recorte: jornadas criadas desde 2026-07-01, excluindo `situacao = 'cancelado'`.

| Fato | Valor |
|---|---|
| Jornadas não canceladas | 158 |
| Concluídas (`concluido_em`) | 69 · média **4,9 dias corridos** |
| Com implantação completa (`implantacao_iniciada_em` + `implantacao_concluida_em`) | 35 · média **3,9 dias corridos** |
| Com 1º contato do responsável no WhatsApp | 103 (65%) |
| Com histórico de responsável (`onboarding_responsavel_history`) | 180/180 (100%) |
| Transferências de responsável | 123 |

Correções sobre o que se supunha:

- **"Calendário" no card de etapa não é a SLA média.** O card já traz duas médias de
  duração: `Expediente` (média de `duracao_util_minutos` — é a que se compara com o
  SLA) e `Calendário` (média de `duracao_minutos`, relógio de parede). O alvo é o badge
  `SLA 1d`. Renomear `Calendário` para "SLA média" trocaria a base e daria número errado.
- **O ticket de onboarding não registra interação com o cliente.** Os 708 `nota_agente`
  e 126 `comment` de `support_ticket_events` são internos. Contato real só existe no
  WhatsApp.
- **O "Ciclo médio" que já existe não responde a pergunta 2.** Ele mistura jornada aberta
  com concluída (`sla_total_util_min` de tudo que tem calendário > 0).

## Decisões do owner

| Assunto | Decisão |
|---|---|
| O que é "primeira interação" | 1ª mensagem `is_from_me` enviada **pelo responsável** ao cliente da jornada. Sem contato registrado é um estado visível, não um buraco. |
| Tempo total | Dois cards lado a lado: ponta a ponta **e** só a fase de Implantação. |
| Escopo dos filtros | Dashboard inteiro. |
| Rastreabilidade | Todo card de média/percentual abre a lista que o formou. |
| Rótulos do card de etapa | `Tempo médio · expediente` / `Tempo médio · calendário`. Badge segue sendo o alvo. |
| Atribuição por responsável | Quem era responsável **na época** da etapa, via `onboarding_responsavel_history`. |

## Arquitetura

O dashboard hoje busca cada fonte separadamente com `fetchAllRows()` e cruza em
`useMemo` (journeys, trainings, pauses, vendor returns, phases, stage history). O
desenho mantém esse padrão: **nenhum agregado de card é calculado em SQL** — o banco
entrega linha por jornada/etapa e a média continua sendo feita em TS. O banco só ganha o
que o frontend não consegue produzir sozinho.

Alternativas descartadas:

- **Tudo no frontend.** Inviável para o 1º contato: exigiria varrer `whatsapp_messages`
  (387k linhas) no navegador.
- **RPC agregada por card.** Menos tráfego, mas mata o drill-down (2ª chamada por card)
  e tira a aritmética do TS testável (`dashMetrics.ts` tem testes; SQL não versionado
  não tem).

### Banco — 1 view + 1 RPC (aditivos, nada é alterado)

**`vw_onboarding_stage_attribution`** — view, `security_invoker = true`.

União de `onboarding_stage_history` e `onboarding_training_stage_history`, cada linha
cruzada com quem era responsável em `entrou_em`:

```
journey_id, stage_id, entrou_em, saiu_em,
duracao_minutos, duracao_util_minutos,
responsavel_user_id   -- linha de onboarding_responsavel_history vigente em entrou_em
```

Regra de vigência: `de <= entrou_em AND (ate IS NULL OR ate > entrou_em)`. Etapa que
atravessa uma transferência fica com quem começou — decisão consciente, registrada no
comentário da view.

`security_invoker` é seguro aqui: a view só lê tabelas de onboarding, que o usuário já
enxerga.

**`get_onboarding_first_contact(p_tenant_id uuid)`** — RPC, `SECURITY DEFINER`.

Uma linha por jornada não cancelada:

```
journey_id, distribuido_em, primeiro_contato_em,
minutos_corridos, minutos_uteis
```

- `distribuido_em` = `min(de)` de `onboarding_responsavel_history` da jornada.
- `primeiro_contato_em` = menor `whatsapp_messages.timestamp` com `is_from_me = true`,
  `sent_by_user_id = responsavel_user_id`, em conversa de contato com
  `cliente_id = journey.cliente_id`, com `timestamp >= distribuido_em`.
- `minutos_uteis` via `fn_onb_util_min(distribuido_em, primeiro_contato_em, tenant_id,
  sla_dept_onb_id)`.

**Por que RPC e não view.** `whatsapp_messages_select` limita o usuário comum às
conversas do próprio setor. Com `security_invoker`, um implantador veria menos contatos
que um admin e o indicador mudaria conforme quem abre a tela — sem erro nenhum na tela.
A RPC contorna a RLS de setor expondo **só carimbos de tempo** (nenhum conteúdo de
mensagem), do cliente da própria jornada.

Guardas obrigatórias, no padrão do projeto:
`SET search_path = public` · guarda de tenant explícita
(`p_tenant_id = current_tenant_id() OR is_super_admin()`) · `REVOKE FROM PUBLIC` ·
`GRANT TO authenticated, service_role`.

**Custo medido.** `EXPLAIN ANALYZE` do corpo da RPC sobre as 158 jornadas:
**51,8 ms**, plano inteiramente por índice
(`idx_whatsapp_contacts_cliente` → `idx_whatsapp_conversations_contact_id` →
`idx_whatsapp_messages_conv_ts`). Nenhum índice novo é necessário.

### Frontend

**`OnboardingDashboardPage.tsx` tem 728 linhas e vai crescer.** O desenho extrai antes
de somar:

- `useOnboardingDashFilters.ts` — estado dos filtros + as opções (pipelines,
  responsáveis, participantes, tipos de demanda) + o `Set<journey_id>` que passou no
  filtro. Uma fonte só de "quais jornadas contam".
- `OnboardingDashFilterBar.tsx` — a barra.
- `DrilldownSheet.tsx` — o painel lateral, um componente reaproveitado por todos os
  cards.
- `TempoDeEntregaSection.tsx` — o bloco novo de 3 cards.
- A aritmética nova entra em `dashMetrics.ts` (testável, sem DOM e sem Supabase).

## Componentes

### 1. Filtros

Barra ao lado do `DateRangePicker`, no cabeçalho fixo. Quatro multi-selects, vazio =
todos:

| Filtro | Fonte | Semântica |
|---|---|---|
| Pipeline | `onboarding_pipelines` | "a jornada **passou por** este pipeline" — via `vw_onboarding_journey_phases`, porque a jornada percorre um pipeline por fase |
| Responsável | `vw_onboarding_journeys.responsavel_user_id/_nome` | responsável **atual** da jornada |
| Participante | `onboarding_participants` (ligada por `ticket_id`) → `profiles → funcionarios.nome` | a pessoa é participante da jornada, em qualquer papel |
| Tipo de demanda | `onboarding_demand_types` | `demand_type_id` da jornada |

Entre filtros diferentes: **E**. Dentro do mesmo filtro: **OU**.

Reúso: `src/components/atendimento/MultiSelectFilter.tsx` já faz exatamente isso, mas o
tipo de `id` é `number` e os ids do onboarding são UUID. Generalizar para
`string | number` — mudança pequena e retrocompatível; os 6 usos em
`AtendimentoDashboard.tsx` continuam válidos.

O filtro produz `allowedJourneyIds: Set<string>`, que se combina com o
`allowedJourneyIds` que a página já calcula (jornadas não canceladas). Todas as seções
já derivam desse conjunto — é por isso que "dashboard inteiro" cabe sem reescrever cada
seção.

### 2. Card de etapa — rótulos

Em `OnboardingSlaOverview.tsx`, `EtapaCard`: `Expediente` → `Tempo médio · expediente`,
`Calendário` → `Tempo médio · calendário`. Badge `SLA {alvo}` inalterado. Nenhuma conta
muda.

### 3. Aba "Por Responsável"

Quarta aba, ao lado de Por Pipeline / Por Etapa / Por Área. Um `ComplianceCard` por
responsável: % no prazo bruto e efetivo, ciclo médio bruto e efetivo, contagem de
jornadas. Fonte: `vw_onboarding_stage_attribution` agregada por `responsavel_user_id`,
nomes resolvidos por `profiles → funcionarios.nome` (o padrão já usado na página).

O drill-down do card de **etapa** ganha a quebra por responsável — é o cruzamento que o
owner pediu ("SLA da etapa Cadastro de Produtos, por responsável").

### 4. Bloco "Tempo de entrega"

Três `KpiCard`s. **A coorte destes cards é diferente do resto da tela** e isso vai
escrito no subtítulo de cada um:

| Card | Coorte | Valor | Subtítulo |
|---|---|---|---|
| Tempo total | jornadas **concluídas dentro da janela** (`concluido_em`) | média `concluido_em − aberta_em`, expediente como principal | `N jornadas concluídas · calendário Xd` |
| Tempo de implantação | jornadas com os dois carimbos de implantação dentro da janela | média `implantacao_concluida_em − implantacao_iniciada_em` | `N jornadas · amostra menor que o card ao lado` |
| 1º contato com o cliente | jornadas **distribuídas dentro da janela** | média `primeiro_contato_em − distribuido_em`, expediente | `N de M com contato registrado` |

Por que coorte e não a janela de sobreposição usada em `separarJornadas`: o resto do
painel responde "como está o SLA agora" e por isso inclui jornada aberta; estes três
respondem "quanto levou", pergunta que só jornada terminada responde. A diferença fica
explícita no subtítulo, não implícita no código.

O card de 1º contato mostra `N de M` justamente porque 35% não têm contato registrado —
o buraco é o indicador. Tom `warning` quando a cobertura fica abaixo de 70%.

### 5. Drill-down

`DrilldownSheet` — um `Sheet` lateral, aberto por clique em qualquer card de média ou
percentual. Recebe título, subtítulo com a regra do número, e a lista já pronta:

```
cliente · jornada (link) · tempo expediente · tempo calendário · % do SLA · responsável
```

Ordenado do pior para o melhor. Rodapé com a conta: `soma / N = média`. Sem paginação —
a lista já está em memória (é dela que o card foi calculado).

Os cards ganham `role="button"`, foco por teclado e `cursor-pointer`; card sem lastro
(N = 0) não abre.

## Erros e casos de borda

| Caso | Comportamento |
|---|---|
| Jornada sem responsável | Não existe hoje (0/180), mas a view/RPC trata como `NULL` e o card agrupa em "— sem responsável" |
| Cliente sem contato de WhatsApp | `primeiro_contato_em` nulo → entra no denominador, não na média |
| Etapa que atravessa transferência | Conta para quem começou (documentado na view) |
| Filtro que zera o resultado | `EmptyNote` explicando qual filtro está ativo, com botão "limpar filtros" |
| RPC sem `GRANT` para `authenticated` | Sintoma clássico do projeto: `null` no frontend, funciona via `service_role`. Validação pós-migration confere `pg_proc` + `information_schema.routine_privileges` + smoke test numa query só |
| Super admin em "Todos os tenants" | `effectiveTenantId` é `null` e as queries não rodam (`enabled` já exige `!!effectiveTenantId`) — comportamento atual, mantido |

## Testes

- `dashMetrics.test.ts` — aritmética nova: coorte de conclusão, média de 1º contato com
  nulos no denominador, atribuição por responsável vigente (incluindo etapa que
  atravessa transferência).
- Filtros: `E` entre dimensões, `OU` dentro da dimensão, vazio = todos, pipeline por
  passagem de fase.
- Smoke test SQL rollback-safe da RPC e da view em `scripts/sql-tests/`, no banco local.
- `tsc -p tsconfig.app.json` + `bun run build` antes de qualquer entrega (o `tsc` da raiz
  não checa nada).

## Fora de escopo

- Automatizar o primeiro contato. O owner registrou que a intenção é automatizar e que
  isso encerraria a variável 4 — a métrica existe para medir até lá.
- Exportar CSV do drill-down.
- Backfill de contato para as 55 jornadas sem registro: não há dado de onde tirar.
- Mudar qualquer conta existente do painel. Todo o desenho é aditivo.

## Ordem de entrega

Uma coisa por vez, cada uma validada antes da próxima:

1. Filtros (só frontend, sem SQL) — entrega isolada e reversível.
2. Rótulos do card de etapa (uma linha).
3. `vw_onboarding_stage_attribution` + aba "Por Responsável".
4. `get_onboarding_first_contact` + bloco "Tempo de entrega".
5. `DrilldownSheet` aplicado a todos os cards.
