# Onboarding — quadro padrão da jornada de Acompanhamento

**Data:** 31/07/2026
**Owner:** Alexandre (ASP)
**Status:** desenho aprovado em 31/07/2026 — a implementar no banco local

---

## Contexto

A jornada **Acompanhamento** é a terceira fase do onboarding (spec de 29/07,
`2026-07-29-onboarding-jornadas-cadastraveis-e-acompanhamento-design.md`): depois do go-live, o
cliente entra num período de observação em que se lançam indicadores de uso para saber se ele
**de fato** começou a usar o sistema.

`fn_seed_onboarding_phases` cria as três jornadas em todo tenant — `onboarding`, `implantacao` e
`acompanhamento`, esta última **inativa** por padrão. Mas o seed para aí: **não existe nenhum seed
de pipeline em lugar nenhum do repo**, para jornada nenhuma. Quem ativa o Acompanhamento encontra
um cadastro vazio.

### O que trava hoje

`advance_onboarding_phase` escolhe o pipeline da fase destino e, quando não acha nenhum, devolve
`{"ok": false, "reason": "fase_sem_pipeline"}` (migration `20260729110000`, linha ~86). A jornada
**não avança**. Ou seja: ativar a jornada de Acompanhamento hoje, sozinho, não produz nada — é
preciso montar pipeline e etapas na mão antes que qualquer cliente consiga chegar lá.

### Medido no banco local em 31/07/2026

| | |
|---|---|
| Tenants com a jornada `acompanhamento` cadastrada | 14 (todos) |
| Tenants com a jornada **ativa** | 1 — Digi Office Sistemas |
| Tenants com pipeline nessa jornada | 1 — Digi Office, "Acompanhamento de uso", 3 etapas |

O pipeline da Digi Office foi criado à mão em 31/07 02:05 junto com o ticket `[DEMO]` — pipeline,
3 etapas e 5 indicadores no mesmo timestamp. Os nomes dessas etapas não existem em nenhum arquivo
do repositório. Não é padrão: é um seed de demonstração.

---

## Decisão

O quadro da jornada de Acompanhamento passa a **vir montado**. O tenant edita, renomeia, reordena
ou apaga o que quiser depois — é cadastro comum, não configuração travada.

### Gatilho: ao ativar a jornada

Trigger `AFTER UPDATE` em `onboarding_phases`, disparando **apenas** quando `slug = 'acompanhamento'`
e `ativo` passa de `false` para `true`. Chama `fn_seed_onboarding_acompanhamento_pipeline(tenant)`.

Alternativas descartadas:

- **Seed em todo tenant** (junto de `fn_seed_onboarding_phases`): criaria pipeline + 4 etapas para
  13 tenants que hoje não usam a jornada, para nada.
- **Botão "usar modelo padrão"** no cadastro: mais um clique e mais UI para manter, sem ganho.

O gatilho fica **no banco, não no front**. Assim vale para o toggle da tela de cadastro, para um
`UPDATE` manual via SQL e para tenant novo — um caminho só, sem duplicação de regra.

### Guarda de idempotência

`fn_seed_onboarding_acompanhamento_pipeline` só age se o tenant **não tiver nenhum pipeline** naquela
jornada — ativo ou inativo. Consequências, explicitamente:

- A Digi Office não é tocada: já tem pipeline.
- Editar ou apagar etapas não ressuscita nada, porque o pipeline continua existindo.
- O padrão só volta se o pipeline inteiro for apagado **e** a jornada for desativada e religada.

### Backfill: nenhum

Não há tenant com a jornada ativa e sem pipeline. A migration não precisa mexer em dado existente.

---

## O modelo padrão

Pipeline **"Acompanhamento de uso"** — `produto_id NULL` (vale para todos), `department_id NULL`,
`sla_total_minutos NULL`, `ativo`, `position 1`.

| # | Etapa | slug | Cor | Flags | `visible_sections` |
|---|---|---|---|---|---|
| 1 | Primeiras semanas | `primeiras-semanas` | `#0EA5E9` | `is_initial` | `acompanhamento, participantes, eventos` |
| 2 | Uso em ritmo | `uso-em-ritmo` | `#22C55E` | — | `acompanhamento, participantes, eventos` |
| 3 | Sinal de risco | `sinal-de-risco` | `#EF4444` | — | `acompanhamento, participantes, eventos` |
| 4 | Cliente destravado | `cliente-destravado` | `#F59E0B` | `is_final` | `acompanhamento, eventos` |

**Por que a coluna de risco.** É a única razão operacional de abrir esse quadro todos os dias: é
onde cai o cliente que parou de usar. Sem ela o quadro só tem caminho feliz, e quem esfriou fica
parado em "Uso em ritmo" mentindo que está tudo bem.

**Sem SLA em etapa nenhuma** — `sla_minutos NULL`, nenhum `inicia_sla`. Isso é decisão, não
esquecimento: `advance_onboarding_phase` faz `sla_iniciado_em = COALESCE(sla_iniciado_em, now())`,
ou seja, **o relógio da jornada não reinicia** ao entrar no Acompanhamento — ele partiu lá no
Onboarding. Prazo por etapa aqui faria todo cartão nascer estourado. Quem quiser prazo configura.

**Indicadores ficam de fora do padrão.** São a parte que mais varia por negócio: os 5 da Digi Office
("Nº de vendas", "Notas fiscais emitidas") são de ERP de varejo e não cabem em contabilidade nem em
ISP. Indicador continua cadastro 100% do tenant.

---

## Entrega

1. **Migration** — `fn_seed_onboarding_acompanhamento_pipeline(uuid)` (`SECURITY DEFINER`,
   `SET search_path = public`, `REVOKE FROM PUBLIC`, `GRANT TO service_role`) + a função de trigger
   e o trigger em `onboarding_phases`.
2. **Teste** — `scripts/sql-tests/19_acompanhamento_pipeline_padrao.sql`, dentro de `BEGIN/ROLLBACK`:
   - ativar a jornada num tenant sem pipeline cria 1 pipeline e 4 etapas, na ordem e com as flags;
   - ativar de novo (ou desativar/reativar com pipeline presente) não duplica;
   - a Digi Office continua com o pipeline dela intacto;
   - `advance_onboarding_phase` deixa de responder `fase_sem_pipeline` para o tenant recém-ativado.

**Zero mudança de front.** O cadastro de Pipelines e o board já leem por `phase_id`.
