# Onboarding — Janela de contagem do SLA, total do trilho e Régua da Jornada

**Data:** 2026-08-01
**Owner:** Alexandre (ASP)
**Status:** aguardando aprovação

---

## Contexto

Desde 26/07 existe `onboarding_stages.inicia_sla`: o head define em qual etapa o cronômetro
parte. Não existe o simétrico. Três problemas, todos confirmados no banco de produção.

### 1. O fim da contagem não é configurável

O relógio de cada fase para em `onboarding_journeys.onboarding_concluido_em` /
`implantacao_concluida_em`, e esses marcos só são gravados dentro de
`advance_onboarding_phase`, que exige o cartão estar na etapa `is_final`.

Ou seja: **"etapa final" e "etapa que encerra a contagem" são hoje o mesmo campo.** Uma etapa
pode ser o fim administrativo do quadro sem ser o fim do compromisso com o cliente — e não há
como expressar isso.

### 2. "Quanto tempo está configurado" tem três respostas que não batem

| Jornada / pipeline | `sla_total_minutos` do pipeline | Soma das etapas ativas |
|---|---|---|
| Onboarding PDV | 2400 (5d) | 2280 (4,75d) |
| Onboarding Gula | 2400 (5d) | **3840 (8d)** |
| Implantação PDV | 960 (2d) | **1440 (3d)** |
| Implantação Gula | 960 (2d) | 0 etapas |
| Acompanhamento | 7200 (15d) | 7200 ✔ |

O "SLA 5d" que aparece no card do pipeline é um número digitado à mão, independente das
etapas — e é ele que `OnboardingSlaOverview` usa como alvo do dashboard.

### 3. O go-live previsto sai de um quarto número

`fn_journey_go_live` lê `onboarding_demand_types.sla_total_minutos`. Dos 8 tipos de demanda
do Digi Office, **7 estão em 0** — jornada desses tipos nasce sem go-live previsto. O único
preenchido, "Onboarding PDV Legal", promete 2400 min = 5 dias úteis, contra um caminho real
configurado de 2280 (onb) + 1440 (imp) = **3720 min ≈ 7,75 dias úteis**. A promessa é 35%
menor que o plano e nunca foi alcançável.

### Resultado esperado

O head define onde a contagem começa **e onde termina**; o total configurado passa a ser um
número só, derivado das etapas; o go-live sai desse número; e qualquer pessoa consegue abrir
um ticket pai e ver a jornada inteira numa régua, plano contra realizado.

---

## Decisões tomadas (owner, 01/08)

| Decisão | Escolha |
|---|---|
| O que a etapa que encerra faz | **Para o relógio total até o go-live**, não só o da fase |
| Reversibilidade | **Voltar etapa reabre a contagem** (correção de erro); avançar mantém parada |
| Fonte do total configurado | **Soma das etapas.** O total manual do pipeline vira derivado |
| Escopo do total | **Só a janela contada** — do `inicia_sla` até o `encerra_sla` |
| Go-live previsto | **Soma das etapas da janela.** Tipo de Demanda vira referência sem efeito |
| Régua | **Duas réguas empilhadas, largura proporcional ao tempo** |

---

## Parte 1 — Etapa que encerra a contagem

### Schema

```sql
ALTER TABLE public.onboarding_stages
  ADD COLUMN encerra_sla boolean NOT NULL DEFAULT false;

-- mesma regra do inicia_sla: uma por pipeline, garantida no banco
CREATE UNIQUE INDEX uq_onb_stage_encerra_sla_por_pipeline
  ON public.onboarding_stages (pipeline_id) WHERE encerra_sla;

ALTER TABLE public.onboarding_journeys
  ADD COLUMN sla_encerrado_em timestamptz;
```

O índice parcial não filtra por `ativo`, pelo mesmo motivo do `inicia_sla`: etapa inativa
marcada continua ocupando o slot, senão reativá-la violaria a unicidade depois.

### Ordem do trilho

Várias regras abaixo dependem de "esta etapa vem antes daquela". A ordem canônica do trilho é:

```
(onboarding_phases.position, onboarding_stages.position)
```

resolvida via `onboarding_stages → onboarding_pipelines → onboarding_phases`. É a mesma ordem
que o cartão percorre, porque `advance_onboarding_phase` usa `fn_onboarding_next_phase` e
`move_onboarding_stage` respeita a posição dentro do pipeline.

### `move_onboarding_stage`

Duas mudanças, ambas no `UPDATE` que já existe:

```sql
-- resolve, junto do bloco que já lê inicia_sla:
SELECT COALESCE(s.encerra_sla, false) INTO v_target_encerra
  FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;

-- ordem do trilho da etapa alvo e da etapa que encerrou a contagem
-- (NULL quando a jornada ainda não tem sla_encerrado_em)
```

No `UPDATE`:

```sql
sla_encerrado_em = CASE
  WHEN v_target_encerra                       THEN COALESCE(sla_encerrado_em, v_now)
  WHEN sla_encerrado_em IS NULL               THEN NULL
  WHEN v_target_ordem < v_ordem_que_encerrou  THEN NULL   -- voltou etapa: reabre
  ELSE sla_encerrado_em                                    -- avançou: segue parada
END
```

Quando o `CASE` reabre (transição de `NOT NULL` → `NULL`), gravar evento na Timeline:

```sql
INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_reaberto',
        'Contagem de SLA reaberta: cartão voltou para ' || v_tgt_nome);
```

Simétrico ao encerramento (`onboarding_sla_encerrado`). Sem esses dois eventos não há como
auditar depois por que o número mudou.

### `advance_onboarding_phase`

A etapa inicial da fase destino pode ser a marcada — caminho raro, mas precisa fechar. Aplicar
a mesma regra de `sla_encerrado_em` no `UPDATE` de lá.

**Bug adjacente que entra junto:** `advance_onboarding_phase` faz
`sla_iniciado_em = COALESCE(sla_iniciado_em, v_now)` incondicionalmente, ignorando o gate do
`inicia_sla`. Uma jornada cujo pipeline tem gatilho e ainda não partiu tem o relógio ligado
por um avanço de fase. Corrigir para respeitar o gatilho, igual `move_onboarding_stage`.

### Degradação

Pipeline sem nenhuma etapa marcada = **comportamento de hoje**: a contagem para em
`concluido_em`. Nenhuma jornada existente muda de número no dia do deploy.

### UI — `src/pages/onboarding/config/PipelinesPanel.tsx`

- **`StageDialog`**: switch "Encerra a contagem de SLA" ao lado de "Inicia a contagem de SLA",
  no mesmo bloco `Comportamento`. Quando outra etapa do pipeline já detém a flag, renderiza
  desabilitado com `Já definida em «{nome}» — desmarque lá para usar aqui` — texto idêntico ao
  que o `inicia_sla` já usa.
- **`SortableStageRow`**: badge 🏁 na etapa que encerra, ao lado dos badges de inicial/final/pausa.
- **`saveStage`**: incluir `encerra_sla` no payload e tratar `23505` com mensagem clara.
  A UI previne, duas abas abertas furam.

---

## Parte 2 — O total configurado passa a ser a soma da janela

### Trigger de coerência

`onboarding_pipelines.sla_total_minutos` **sai do formulário** e passa a ser mantido pelo banco:

```sql
CREATE OR REPLACE FUNCTION public.fn_sync_pipeline_sla_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.onboarding_pipelines p
     SET sla_total_minutos = COALESCE((
           SELECT sum(s.sla_minutos) FROM public.onboarding_stages s
            WHERE s.pipeline_id = p.id AND s.ativo AND NOT s.pausa_sla), 0)
   WHERE p.id = COALESCE(NEW.pipeline_id, OLD.pipeline_id);
  RETURN NULL;
END $$;

CREATE TRIGGER trg_sync_pipeline_sla_total
AFTER INSERT OR UPDATE OF sla_minutos, ativo, pausa_sla, pipeline_id OR DELETE
ON public.onboarding_stages
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_pipeline_sla_total();
```

Escolha deliberada: manter a coluna em vez de dropar. `OnboardingSlaOverview` continua lendo
`sla_total_minutos` como alvo, sem nenhuma alteração de query — só que agora o número é
sempre a soma. **Divergência vira impossível por construção, não por disciplina.**

Etapas com `pausa_sla` ficam fora da soma: o relógio não corre nelas, então o alvo não pode
contá-las. Hoje as duas etapas nessa condição ("Pendências", "Pendente Agendar") já estão com
`sla_minutos = 0`, então o UPDATE inicial não muda nada nelas.

**Dois números com papéis distintos, e a tela precisa deixar isso óbvio:**
`sla_total_minutos` do pipeline soma **todas** as etapas ativas dele — é o que o dashboard usa
como alvo por fase. O total do trilho (abaixo) soma **só a janela contada**, que pode cortar no
meio de um pipeline. Quando o `encerra_sla` está no meio, as somas divergem de propósito, e é
exatamente por isso que a Parte 4 marca as etapas "fora da contagem" na lista.

### Total do trilho

```sql
CREATE OR REPLACE FUNCTION public.fn_onb_trilho_sla_min(
  p_tenant_id uuid, p_produto_id bigint
) RETURNS integer
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
```

Algoritmo:

1. Monta o trilho: para cada `onboarding_phases` ativa do tenant, em ordem de `position`,
   escolhe **um** pipeline com a mesma regra que `create_onboarding_journey` e
   `advance_onboarding_phase` já usam — `ativo`, com etapas, `ORDER BY (produto_id =
   p_produto_id) DESC NULLS LAST, position LIMIT 1`. Regra duplicada em três lugares hoje;
   esta função vira a quarta e é candidata a unificar depois, fora deste escopo.
2. Concatena as etapas ativas na ordem canônica do trilho.
3. Recorta a janela: do primeiro `inicia_sla` (ou da primeira etapa, se nenhuma marcada) até o
   primeiro `encerra_sla` (ou a última etapa, se nenhuma marcada).
4. Soma `sla_minutos` das etapas da janela, ignorando `pausa_sla`.

Retorna 0 quando o trilho não tem etapa nenhuma. Grants: `REVOKE FROM PUBLIC`,
`GRANT TO authenticated, service_role` — armadilha conhecida do projeto (RPC volta `null` no
front por falta de grant em `authenticated`).

---

## Parte 3 — Go-live previsto

`fn_journey_go_live` troca a origem do total:

```sql
-- antes: SELECT sla_total_minutos FROM onboarding_demand_types WHERE id = p_demand_type_id
-- agora: v_min := public.fn_onb_trilho_sla_min(p_tenant_id, p_produto_id);
```

A assinatura muda de `(p_tenant_id, p_start, p_demand_type_id, p_department_id)` para
`(p_tenant_id, p_start, p_produto_id, p_department_id)`. Não dá para fazer isso com
`CREATE OR REPLACE` — assinatura diferente cria função nova. **`DROP FUNCTION` da antiga +
`CREATE` da nova, no mesmo deploy dos dois callers**, senão a versão velha fica de pé
respondendo com o número errado.

Callers a atualizar no mesmo push:
- [NewJourneyModal.tsx](src/pages/onboarding/NewJourneyModal.tsx) — passa `produto_id` no lugar de `demand_type_id`
- [EditJourneyInfoDialog.tsx](src/pages/onboarding/EditJourneyInfoDialog.tsx) — idem
- [EditJourneyInfoDialog.test.tsx](src/pages/onboarding/EditJourneyInfoDialog.test.tsx) — o mock da rpc

Efeito visível: o go-live do trilho PDV vai de **5 → 8 dias úteis**, e os 7 tipos de demanda
hoje zerados passam a ter go-live previsto. É o resultado pretendido — o número passa a
refletir o que está configurado.

### Tipo de Demanda vira referência

`onboarding_demand_types.sla_total_minutos` **não alimenta mais cálculo nenhum**. A coluna
fica, com papel novo: registrar a promessa comercial para o sistema poder acusar divergência.

- [DemandTypesPanel.tsx](src/pages/onboarding/config/DemandTypesPanel.tsx): rótulo do campo
  vira **"Prazo prometido (referência)"**, com hint `Não gera o go-live — serve para o sistema
  avisar quando o plano de etapas não cabe na promessa.`
- [NewJourneyModal.tsx](src/pages/onboarding/NewJourneyModal.tsx) e
  [EditJourneyInfoDialog.tsx](src/pages/onboarding/EditJourneyInfoDialog.tsx): o texto que hoje
  deriva dias do tipo de demanda passa a derivar de `fn_onb_trilho_sla_min`.

⚠️ `EditJourneyInfoDialog.tsx:115` usa base 480 e `NewJourneyModal.tsx:156` usa base 1440 para
o mesmo cálculo — a conversão de 26/07 pegou um e esqueceu o outro. Alinhar os dois em 480 via
o formatador único de [slaFormat.ts](src/pages/onboarding/slaFormat.ts).

---

## Parte 4 — Onde o admin vê e corrige

Faixa no topo da coluna **ETAPAS** em Configuração › Pipelines & Etapas, sempre visível:

```
Trilho PDV · Onboarding 4,75d + Implantação 3d = 7,75d úteis
Janela: Novo Cliente → Sub-tickets Finalizados
⚠ prazo prometido no tipo "Onboarding PDV Legal": 5d — plano 2,75d acima
```

- Cada parcela do trilho é clicável e navega para o pipeline correspondente.
- O alerta de divergência aparece quando algum tipo de demanda ativo do tenant tem prazo
  prometido preenchido e diferente do trilho. **Só avisa, não bloqueia** — decisão do owner.
- Etapas fora da janela recebem marca visual `fora da contagem` na `SortableStageRow`, em tom
  apagado. É como o admin descobre que marcou o `encerra_sla` cedo demais.
- O card do pipeline passa a mostrar `SLA 4,75d · soma de 5 etapas` no lugar do total manual.

---

## Parte 5 — Régua da Jornada

Botão **"Régua da jornada"** no cabeçalho do ticket pai
([JourneyDetailSheet.tsx](src/pages/onboarding/JourneyDetailSheet.tsx)), abrindo diálogo largo.
Componente novo: `src/pages/onboarding/JourneyRuler.tsx`.

Cobre o **trilho inteiro** — Onboarding + Implantação — não só a fase atual, porque é isso que
o cartão percorre.

### Layout

```
PLANO  ●━2h━○━━6h━━━○━━8h━━━○━━━━16h━━━━━○━6h━◉
                                          7,75d úteis

REAL   ●━1h━○━4h━○━━━━━━━━━28h━━━━━━━━━━○
                 ↑ Recolhimento Dados: 3,5x o plano
                                          2d5h correndo
```

- **Largura proporcional ao tempo**, nas duas réguas, na mesma escala. `min-width` por segmento
  garante que uma etapa de 2h continue clicável ao lado de uma de 28h.
- Nó preto = início da contagem (`inicia_sla`). Nó verde = fim da contagem (`encerra_sla`, ou
  go-live se nenhuma marcada). Nós vazados = etapas intermediárias.
- Cor do segmento REAL pelo semáforo já existente: verde < 70% do plano, amarelo ≥ 70%,
  vermelho ≥ 100%.
- Etapa em aberto: segmento pontilhado, crescendo até `now()`.
- Etapas fora da janela aparecem depois do nó verde, em cinza, com rótulo `fora da contagem`.
- Hover no segmento: nome da etapa, plano, real, delta, datas de entrada e saída.

### Dados

Plano por etapa: `onboarding_stages.sla_minutos` das etapas do trilho.

Real por etapa: `onboarding_stage_history`, **agregado por etapa**:

```sql
sum(COALESCE(duracao_util_minutos,
             fn_onb_util_min(entrou_em, COALESCE(saiu_em, now()), tenant, dept)))
```

**A agregação não é opcional.** Em produção hoje existem 23 pares (jornada, etapa) com mais de
uma passagem, chegando a 3 na mesma etapa. Uma régua que renderiza uma linha de histórico por
nó desenha a mesma etapa três vezes e o total não fecha. Quando `count(*) > 1`, o nó recebe o
selo `×2` / `×3` e o hover lista cada passagem.

Fonte única: RPC `get_journey_ruler(p_journey_id)` retornando um array ordenado pela ordem do
trilho com `{stage_id, nome, fase, ordem, plano_min, real_min, passagens, aberta, fora_janela}`.
Cálculo no banco, não no cliente — é a mesma regra de horário útil que o resto do SLA usa, e
duplicá-la em TypeScript garante divergência.

### Backfill obrigatório

19 linhas de `onboarding_stage_history` estão fechadas (`saiu_em NOT NULL`) com
`duracao_util_minutos NULL` — são anteriores ao fix de 26/07. Sem backfill elas renderizam com
largura zero e a régua das jornadas antigas fica visualmente errada.

```sql
UPDATE public.onboarding_stage_history h
   SET duracao_util_minutos = public.fn_onb_util_min(
         h.entrou_em, h.saiu_em, h.tenant_id,
         (SELECT COALESCE(p.department_id, t.department_id)
            FROM public.onboarding_stages s
            JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
            JOIN public.onboarding_journeys j  ON j.id = h.journey_id
            LEFT JOIN public.support_tickets t ON t.id = j.ticket_id
           WHERE s.id = h.stage_id))
 WHERE h.saiu_em IS NOT NULL AND h.duracao_util_minutos IS NULL;
```

Setor resolvido como no resto do sistema: `COALESCE(pipeline.department_id,
ticket.department_id)` — mesma cascata de `move_onboarding_stage`. 19 linhas, uma call.

---

## Perf

`fn_onb_trilho_sla_min` é leitura de cadastro (3 pipelines, ~15 etapas). Chamada na criação da
jornada, na edição e na tela de configuração. Irrelevante.

`get_journey_ruler` roda **sob demanda, num clique**, para uma jornada só (~5 a 15 linhas de
histórico). Não entra em polling, não entra no kanban, não entra na
`vw_onboarding_journeys` — que já é caminho quente. Isso é intencional: a régua não pode
encarecer a lista.

O trigger `trg_sync_pipeline_sla_total` dispara em escrita de etapa — operação de cadastro,
raríssima. `onboarding_stages` não está na publication `supabase_realtime`.

---

## Verificação

Tudo primeiro no Docker local (tem a base real de produção), depois produção via
`apply_migration` com OK do Alexandre.

1. **Unicidade:** marcar duas etapas do mesmo pipeline com `encerra_sla` → `23505`; pipelines
   diferentes → passa. Em `BEGIN/ROLLBACK`.
2. **Encerramento:** smoke test rollback-safe (`DO $$ … RAISE EXCEPTION 'SMOKE_OK|%'`) movendo
   uma jornada para a etapa marcada → `sla_encerrado_em` gravado; movendo para a etapa seguinte
   → continua gravado; movendo para a anterior → volta a `NULL` e evento
   `onboarding_sla_reaberto` na timeline.
3. **Sem etapa marcada:** jornada em pipeline sem `encerra_sla` mantém exatamente os mesmos
   números de hoje. Comparar `sla_total_util_min` antes e depois nas 38 jornadas abertas.
4. **Trigger de total:** alterar `sla_minutos` de uma etapa, deletar outra, desativar uma
   terceira → conferir `sla_total_minutos` do pipeline batendo com a soma em cada passo.
5. **Trilho:** `fn_onb_trilho_sla_min` do PDV = 3720; do Gula = soma das etapas do trilho Gula.
   Conferir que etapa `pausa_sla` fica fora e que a janela recorta certo quando o `encerra_sla`
   está no meio do pipeline.
6. **Go-live:** `fn_journey_go_live` com o start de hoje devolve a data de 8 dias úteis à
   frente, não 5. Conferir que a função antiga não existe mais (`pg_proc`) e que a nova tem
   grant para `authenticated` (`information_schema.routine_privileges`).
7. **Backfill:** `count(*) WHERE saiu_em IS NOT NULL AND duracao_util_minutos IS NULL` = 0.
8. **Régua com revisita:** abrir a régua de uma das 23 jornadas com passagem repetida →
   a etapa aparece **uma vez**, com selo `×N`, e a soma dos segmentos bate com
   `sla_total_util_min` da view.
9. **UI:** `bun run dev` contra o local — marcar/desmarcar `encerra_sla`, ver o switch
   desabilitar nas demais, a faixa do trilho, o alerta de divergência, as etapas "fora da
   contagem", e a régua nos dois estados (jornada em andamento e concluída).
10. **tsc:** `npx tsc -p tsconfig.app.json` (o da raiz não checa nada) + `bun run build`.

---

## Fora de escopo

- **Medir a jornada de Acompanhamento.** O enum `onb_fase_atual` só tem
  `onboarding | implantacao | concluido`, então `vw_onboarding_journeys` não tem onde somar a
  3ª jornada. Com a janela terminando na Implantação isso não altera nenhum número. Se um dia
  o `encerra_sla` for para o Acompanhamento, o enum e a view entram junto.
- **Unificar a regra de escolha de pipeline por produto**, hoje duplicada em
  `create_onboarding_journey`, `advance_onboarding_phase` e agora `fn_onb_trilho_sla_min`.
- **Dropar `onboarding_pipelines.sla_total_minutos`.** Mantida e sincronizada por trigger para
  não tocar nas queries do dashboard neste deploy.
- **Renomear `sla_util_*`.** Segue significando "corrido − pausas" em
  `onboarding_phase_metrics`, que não é tocado aqui.
