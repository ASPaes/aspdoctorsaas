# Onboarding — SLA em horário útil, etapa gatilho e Data de Abertura

**Data:** 2026-07-26
**Owner:** Alexandre (ASP)
**Status:** aguardando aprovação

---

## Contexto

Três problemas, levantados pelo owner e confirmados no banco de produção:

**1. O SLA começa cedo demais.** Hoje o relógio da jornada parte no primeiro `move_onboarding_stage` (`sla_iniciado_em = COALESCE(sla_iniciado_em, now())`) ou na criação, se `data_inicio_planejado <= now()`. Não existe forma de dizer "o SLA só começa quando o ticket chegar na etapa X". Um ticket aberto não necessariamente deve começar a contar.

**2. O SLA é medido em horas corridas 24/7.** Verificado na `vw_onboarding_journeys`: todos os cálculos são `EXTRACT(epoch FROM ...)`. Sábado, domingo e madrugada contam. O que a UI chama de **"Efetivo"** *não é horário útil* — é `corrido − pausas manuais`. Nome enganoso: em `whatsapp_attendances`, `sla_util_*` significa horário comercial de verdade; no onboarding significa outra coisa.

O motor de horário útil **já existe e está ocioso**: `segundos_uteis(inicio, fim, tenant_id, department_id)` respeita slots múltiplos, feriados (`business_hours_exceptions`), timezone e faz fallback setor → global → corrido. Há UI de configuração por setor em Configurações › Horário & plantão. O onboarding só usa isso para *sugerir* a data de go-live (`fn_journey_go_live`), nunca para medir.

Para contar horário útil é preciso um setor — e **0 de 14 jornadas** têm `department_id` preenchido (o ticket de onboarding nasce sem setor). Sem resolver a origem do setor, `segundos_uteis` cai no fallback e devolve tempo corrido de novo: mudança sem efeito.

**3. Não existe Data de Abertura visível.** `onboarding_journeys.created_at` existe na tabela mas **não é exposto pela view** nem renderizado em lugar nenhum. O que aparece é "Início planejado" (`data_inicio_planejado`, editável) e um "Início da jornada" derivado do primeiro evento da timeline — nenhum dos dois é a data de abertura.

### Resultado esperado

O head consegue definir, por pipeline, a etapa em que o cronômetro parte; o SLA passa a medir só o expediente do setor responsável; e a data de abertura fica visível e imutável na jornada.

---

## Decisões tomadas (owner, 26/07)

| Decisão | Escolha |
|---|---|
| Base de medição | **Horário útil, setor definido no pipeline** |
| Pipeline sem etapa gatilho | **Mantém comportamento atual** (inicia no primeiro move) |
| Jornada que nasce na etapa gatilho | **SLA parte na criação** |
| Valor de 1 "dia" de SLA | **8h (480 min)**, com conversão one-shot dos valores existentes |
| Pausas manuais | **Também em horário útil** |

---

## Parte 1 — Flag de etapa gatilho

### Schema

```sql
ALTER TABLE public.onboarding_stages
  ADD COLUMN inicia_sla boolean NOT NULL DEFAULT false;

-- exclusividade garantida NO BANCO, não só na UI
CREATE UNIQUE INDEX uq_onb_stage_inicia_sla_por_pipeline
  ON public.onboarding_stages (pipeline_id) WHERE inicia_sla;
```

O índice parcial **não filtra por `ativo`** de propósito: uma etapa inativa marcada continua ocupando o slot, senão reativá-la violaria a unicidade depois.

### UI — `src/pages/onboarding/config/PipelinesPanel.tsx`

- **`StageDialog`** (:926-1055): novo `Switch` "Iniciar contagem de SLA nesta etapa", junto dos switches existentes (`is_initial`, `is_final`, `pausa_sla`, `ativo`).
  - Quando **outra** etapa do pipeline já detém a flag, o switch renderiza **desabilitado** com o texto `Já definida em «{nome da etapa}»`. É o comportamento pedido: escolhida uma, as demais perdem a opção. Para trocar, desmarca na etapa atual primeiro.
- **`SortableStageRow`** (:540-585): badge ⏱ na etapa gatilho, ao lado das flags inicial/final/pausa já existentes.
- **`saveStage`** (:233-265): incluir `inicia_sla` no payload e tratar erro `23505` (violação do índice) com mensagem clara em vez do erro cru do Postgres — a UI previne, mas duas abas abertas conseguem furar.

### RPC `move_onboarding_stage`

Substituir a linha `sla_iniciado_em = COALESCE(sla_iniciado_em, v_now)` por:

```sql
-- antes do UPDATE: resolve gatilho do pipeline da etapa ALVO
SELECT s.inicia_sla,
       EXISTS (SELECT 1 FROM public.onboarding_stages x
                WHERE x.pipeline_id = s.pipeline_id AND x.inicia_sla)
  INTO v_target_inicia, v_pipe_tem_gatilho
  FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;

-- no UPDATE:
sla_iniciado_em = CASE
  WHEN v_pipe_tem_gatilho AND v_target_inicia THEN COALESCE(sla_iniciado_em, v_now)
  WHEN v_pipe_tem_gatilho                     THEN sla_iniciado_em   -- ainda não partiu
  ELSE COALESCE(sla_iniciado_em, v_now)                              -- comportamento atual
END
```

### RPC `create_onboarding_journey`

```sql
sla_iniciado_em = CASE
  WHEN EXISTS (SELECT 1 FROM public.onboarding_stages x
                WHERE x.pipeline_id = v_pipe_onb AND x.inicia_sla)
    THEN CASE WHEN EXISTS (SELECT 1 FROM public.onboarding_stages x
                            WHERE x.id = v_first_stage AND x.inicia_sla)
              THEN now() ELSE NULL END
  ELSE CASE WHEN p_data_inicio_planejado IS NOT NULL
             AND p_data_inicio_planejado <= now() THEN now() ELSE NULL END
END
```

---

## Parte 2 — Setor no pipeline

```sql
ALTER TABLE public.onboarding_pipelines
  ADD COLUMN department_id uuid REFERENCES public.support_departments(id) ON DELETE SET NULL;
```

**Resolução em cascata do setor efetivo:** `COALESCE(pipeline.department_id, ticket.department_id)`. Se ambos NULL, `segundos_uteis` cai no expediente global do tenant; sem esse, volta a tempo corrido — degradação previsível, nunca erro.

Fases diferentes podem ter setores diferentes: onboarding usa `pipeline_onboarding_id.department_id`, implantação usa `pipeline_implantacao_id.department_id`.

**UI — `PipelineDialog`** (`PipelinesPanel.tsx:839-921`): `Select` "Setor (define o expediente do SLA)", populado de `support_departments` do tenant, com opção vazia e hint `Sem setor, usa o horário global do tenant`.

---

## Parte 3 — SLA em horário útil

### Helper

```sql
CREATE OR REPLACE FUNCTION public.fn_onb_util_min(
  p_start timestamptz, p_end timestamptz, p_tenant_id uuid, p_department_id uuid
) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN 0
    ELSE public.segundos_uteis(p_start, p_end, p_tenant_id, p_department_id) / 60
  END;
$$;
REVOKE ALL ON FUNCTION public.fn_onb_util_min(timestamptz,timestamptz,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_util_min(timestamptz,timestamptz,uuid,uuid)
  TO authenticated, service_role;
```

### Reescrita da `vw_onboarding_journeys`

Dois `LEFT JOIN` novos em `onboarding_pipelines` (por `pipeline_onboarding_id` e `pipeline_implantacao_id`) para trazer o `department_id` de cada fase.

| Coluna | Semântica nova |
|---|---|
| `sla_*_corrido_min` | **inalterada** — relógio de parede, serve de auditoria |
| `sla_*_pausado_min` | passa a ser **pausa em minutos úteis** (para bater a subtração) |
| `sla_*_util_min` | `GREATEST(0, fn_onb_util_min(ini, fim, tenant, dept) − pausa_util)` — agora horário útil **de verdade** |
| `etapa_atual_min` / `etapa_semaforo` | passam a usar `fn_onb_util_min(ea.entrou_em, now(), …)` |
| `aberta_em` | **nova** — `j.created_at` |

As CTEs `pausa_onb` / `pausa_imp` / `pausa_all` passam a somar `fn_onb_util_min(iniciada_em, COALESCE(finalizada_em, now()), tenant, dept_da_fase)` em vez de `EXTRACT(epoch …)`. Precisam de join com `onboarding_journeys` + pipelines para alcançar tenant e setor.

### Materializar o tempo útil por etapa

`onboarding_stage_history.duracao_util_minutos` existe e está **100% NULL** (72 linhas, 0 preenchidas) — por isso a aba "Por Etapa" do dashboard mostra Efetivo == Corrido sempre e a barra de pausa nunca aparece ([OnboardingSlaOverview.tsx:341](src/pages/onboarding/OnboardingSlaOverview.tsx#L341)).

Em `move_onboarding_stage`, ao fechar o histórico, preencher:

```sql
UPDATE public.onboarding_stage_history
   SET saiu_em = v_now,
       duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
       duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
 WHERE id = v_open_history;
```

Isso mata dois coelhos: conserta a aba "Por Etapa" e evita recalcular horário útil de etapas já fechadas a cada leitura da view.

---

## Parte 4 — Conversão dos SLAs existentes

Os valores atuais foram digitados como dias de 24h (`partsToMinutes` faz `dias × 24 × 60`). Migrar a medição sem converter os alvos inverteria o indicador — "5 dias" viraria 7200 minutos *de expediente* = 15 dias úteis reais, e tudo ficaria verde.

Fórmula exata, preserva a parte em horas/minutos:

```sql
novo = (valor / 1440) * 480 + (valor % 1440)   -- divisão inteira
```

| Objeto | Antes | Depois |
|---|---|---|
| `Onboarding PDV` / `Onboarding Gula` (pipeline) | 7200 | 2400 (5 dias úteis) |
| `Implantação PDV` / `Implantação Gula` (pipeline) | 2880 | 960 (2 dias) |
| `Cadastro Produtos` | 2880 | 960 |
| `Recolhimento Dados` / `Treinamento Marcado` / `Fechamento` | 1440 | 480 (1 dia) |
| `Segundo Treinamento` / `Em Andamento` | 2880 | 960 |
| `Novo Cli Gula` | 7200 | 2400 |
| `Conferência` / `Marcar treinamento PDV` | 360 | 360 (já era 6h) |
| `Novo Cliente` | 120 | 120 (já era 2h) |
| `Pendências` | 0 | 0 |

Aplicar em `onboarding_stages.sla_minutos`, `onboarding_pipelines.sla_total_minutos` e `onboarding_demand_types.sla_total_minutos`.

**Efeito colateral obrigatório:** `fn_journey_go_live` faz `CEIL(sla_total_minutos / 1440)` para converter em dias úteis. Com a base em 480, tem de virar `CEIL(sla_total_minutos / 480.0)`, senão a sugestão de go-live encolhe 3×.

### Frontend — base de 8h

- [`config/utils.ts:14-16`](src/pages/onboarding/config/utils.ts#L14-L16): `partsToMinutes` → `dias * 480 + horas * 60 + minutos`; `minutesToParts` e `formatSlaHuman` na mesma base.
- [`SlaInput.tsx`](src/pages/onboarding/config/SlaInput.tsx): rótulo do campo dias vira `dias (1 dia útil = 8h)`.
- [`OnboardingSlaOverview.tsx:43-52`](src/pages/onboarding/OnboardingSlaOverview.tsx#L43-L52): `formatMin` usa `d = h / 8`, não `h / 24`. Conferir se `JourneyDetailSheet` e `OnboardingPage` têm cópias próprias do formatador e alinhar.

---

## Parte 5 — Data de Abertura

A view passa a expor `aberta_em` (`j.created_at`). Renderizar **read-only** em três pontos:

- [`JourneyDetailSheet.tsx:1636-1652`](src/pages/onboarding/JourneyDetailSheet.tsx#L1636-L1652) — chip "Aberta em", junto dos chips de SLA e Go-live.
- [`NewJourneyModal.tsx:310`](src/pages/onboarding/NewJourneyModal.tsx#L310) — linha read-only "Data de abertura: hoje" **acima** de "Início planejado", para deixar explícita a diferença entre abertura e início planejado.
- [`OnboardingPage.tsx`](src/pages/onboarding/OnboardingPage.tsx) — coluna "Aberta em" na visão de lista, que hoje só mostra go-live.

Em nenhum ponto o campo é editável.

---

## Correção de consistência incluída

A aba **Por Área** do dashboard calcula "efetivo" como `sla_total_corrido_min − sla_total_pausado_min` ([OnboardingSlaOverview.tsx:314-317](src/pages/onboarding/OnboardingSlaOverview.tsx#L314-L317)), enquanto as abas Total e Pipeline usam `sla_onb_util_min + sla_imp_util_min`. São grandezas diferentes para o mesmo conceito, e depois desta mudança a divergência fica pior. Unificar a aba Área para o mesmo par de colunas das demais.

---

## Perf

`segundos_uteis` é plpgsql com laço dia-a-dia e um `EXISTS` em `business_hours_exceptions` por dia. Com 14 jornadas de ~90 dias são ~1.260 lookups por leitura da view — irrelevante, e os índices `idx_bhe_tenant_date` / `idx_bhe_dept_date` já existem.

O risco é de escala: a view é lida pelo kanban ([OnboardingPage.tsx:192](src/pages/onboarding/OnboardingPage.tsx#L192)) e pelo dashboard. Materializar `duracao_util_minutos` já tira as etapas fechadas do caminho quente. **Gate:** medir `EXPLAIN ANALYZE` da view antes e depois; se passar de ~150 ms, materializar também as métricas por fase em `onboarding_phase_metrics` (a tabela e a função `fn_snapshot_onboarding_phase` já existem) em vez de calcular ao vivo.

---

## Arquivos afetados

**Banco (via `apply_migration`, com OK explícito do Alexandre):**
- `onboarding_stages.inicia_sla` + índice único parcial
- `onboarding_pipelines.department_id`
- `fn_onb_util_min` (nova)
- `vw_onboarding_journeys` (reescrita)
- `move_onboarding_stage`, `create_onboarding_journey`, `fn_journey_go_live`
- UPDATE de conversão dos SLAs
- Regenerar `src/integrations/supabase/types.ts`

**Frontend:**
- [src/pages/onboarding/config/PipelinesPanel.tsx](src/pages/onboarding/config/PipelinesPanel.tsx) — `StageDialog`, `PipelineDialog`, `SortableStageRow`, `saveStage`, `savePipeline`
- [src/pages/onboarding/config/utils.ts](src/pages/onboarding/config/utils.ts) e [SlaInput.tsx](src/pages/onboarding/config/SlaInput.tsx) — base de 8h
- [src/pages/onboarding/OnboardingSlaOverview.tsx](src/pages/onboarding/OnboardingSlaOverview.tsx) — `formatMin`, aba Área
- [src/pages/onboarding/JourneyDetailSheet.tsx](src/pages/onboarding/JourneyDetailSheet.tsx), [OnboardingPage.tsx](src/pages/onboarding/OnboardingPage.tsx), [NewJourneyModal.tsx](src/pages/onboarding/NewJourneyModal.tsx) — Data de Abertura

---

## Verificação

Tudo validado **primeiro no Docker local** (tem a base real de produção), depois produção via SQL Editor / `apply_migration` com OK do Alexandre.

1. **Unicidade da flag:** tentar marcar duas etapas do mesmo pipeline → esperado `23505`; etapas de pipelines diferentes → passa. Rodar em `BEGIN/ROLLBACK`.
2. **Início do SLA:** smoke test rollback-safe (`DO $$ … RAISE EXCEPTION 'SMOKE_OK|%'`) cobrindo os três caminhos — pipeline sem gatilho (comportamento atual), pipeline com gatilho movendo para etapa não-gatilho (`sla_iniciado_em` continua NULL), e move para a etapa gatilho (parte agora).
3. **Nascer na etapa gatilho:** criar jornada num pipeline cuja primeira etapa é a gatilho → `sla_iniciado_em = created_at`.
4. **Horário útil:** jornada iniciada sexta 17h, medida segunda 9h, com expediente 08–18 seg-sex → esperado ~60 min úteis (não ~3.840 corridos). Conferir também com feriado em `business_hours_exceptions`.
5. **Conversão:** query antes/depois comparando cada `sla_minutos` com `(v/1440)*480 + (v%1440)`; conferir `fn_journey_go_live` devolvendo a mesma data de antes.
6. **Grants:** `pg_proc` + `information_schema.routine_privileges` para `fn_onb_util_min` — precisa listar `authenticated` (armadilha conhecida do projeto: RPC retorna null no front por falta de grant).
7. **Perf:** `EXPLAIN ANALYZE SELECT * FROM vw_onboarding_journeys` antes e depois.
8. **UI:** `bun run dev` contra o local — cadastrar etapa gatilho, ver o switch desabilitar nas demais, conferir badge, setor no pipeline, e a Data de Abertura nos três pontos.

---

## Fora de escopo

- **Nomenclatura `sla_util_*`.** Depois desta mudança o nome finalmente descreve o que faz no onboarding, mas segue significando "corrido − pausas" em `onboarding_phase_metrics.sla_util_min`, que não é tocado aqui. Renomear colunas é entrega separada.
- **`business_hours_exceptions_tenant_date_unique` é UNIQUE em `(tenant_id, date)`**, o que impede cadastrar exceção por setor numa data que já tem exceção global — apesar do índice `idx_bhe_dept_date` sugerir o contrário. Limitação preexistente, não introduzida aqui.
- Migrar o SLA de Support Tickets — `support_tickets` não tem coluna de prazo; não existe SLA de ticket hoje.
