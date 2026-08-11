# Checklist da etapa vinculado ao tipo de demanda

**Data:** 11/08/2026
**Área:** Onboarding & Implantação — configuração de pipeline e card da jornada

## Problema

Hoje o checklist do onboarding só existe preso à etapa: todo grupo cadastrado em
`onboarding_stage_checklist_groups` aparece em **todas** as jornadas que passam por aquela
etapa, qualquer que seja o tipo de demanda. Uma etapa "Recolhimento Dados" que serve
Implantação, Migração e Troca de Equipamento mostra a união de tudo — e como item
obrigatório trava a passagem de etapa, o operador é obrigado a marcar item que não é do
caso dele.

O tenant tem 8 tipos de demanda ativos, 10 grupos de checklist e 50 itens. Todas as 94
jornadas já têm `demand_type_id` preenchido.

## Escopo

**Entra:** vincular grupo de checklist a um ou mais tipos de demanda.

**Fica de fora:** vínculo por módulo da jornada. Decidido em 11/08 depois de medir os dados:
dos 165 módulos de jornada, 81 foram digitados à mão sem vínculo com o catálogo
(`Mesa`, `Balcão`, `Ficha`, `Delivery`, além de variações com typo — `Balcao`,
`Comanda Individual`), e só 1 dos 40 nomes distintos casa com algum dos 555 registros de
`produto_modulos`. Um filtro por módulo hoje não dispararia em metade das jornadas.
O schema abaixo nasce preparado para receber esse segundo vínculo como uma tabela irmã,
sem reescrever o que está sendo entregue agora.

## Regras

1. Grupo **sem** nenhum vínculo → aparece em qualquer jornada. É o estado dos 10 grupos de
   hoje: nada muda até alguém vincular.
2. Grupo **com** vínculo → aparece só nas jornadas cujo `demand_type_id` está na lista.
3. Item **sem grupo** (`onboarding_stage_checklist.group_id IS NULL`, o bloco "Sem checklist"
   da tela de configuração) → aparece sempre. Não há onde pendurar vínculo.
4. Jornada **sem** `demand_type_id` → não filtra nada, comporta-se como hoje. Hoje são 0
   casos; a regra existe para nunca esconder item por causa de dado faltando.
5. Jornada aberta em que o vínculo passa a não valer (troca do tipo de demanda pelo
   `EditJourneyInfoDialog`, ou vínculo criado depois): o item **não marcado** é removido do
   card; o item **já marcado** permanece, como histórico do que foi feito.

## Schema

Uma tabela nova, aditiva. Nenhuma migração de dado, nenhuma coluna alterada.

```sql
CREATE TABLE public.onboarding_checklist_group_demand_types (
  group_id       uuid NOT NULL REFERENCES public.onboarding_stage_checklist_groups(id) ON DELETE CASCADE,
  demand_type_id uuid NOT NULL REFERENCES public.onboarding_demand_types(id)           ON DELETE CASCADE,
  tenant_id      uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, demand_type_id)
);
CREATE INDEX ON public.onboarding_checklist_group_demand_types (tenant_id, demand_type_id);
```

RLS espelhando `onboarding_stage_checklist_groups` — 4 policies (`sel`/`ins`/`upd`/`del`)
com `can_access_tenant_row(tenant_id)`, que já embute o bypass de super admin.

**Consequência aceita:** apagar um tipo de demanda (o `DemandTypesPanel` faz DELETE, não
soft-delete) remove os vínculos por cascade. Um grupo que ficar sem nenhum vínculo volta a
valer para todas as demandas. É o comportamento correto — o alternativo seria o grupo
sumir de todas.

## Função única do filtro

Uma única definição da regra, consumida pelas duas RPCs. Não reimplementar o predicado
inline em nenhum dos dois lugares.

```sql
CREATE OR REPLACE FUNCTION public.fn_onb_checklist_grupo_aplica(
  p_group_id uuid, p_demand_type_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p_group_id IS NULL
      OR p_demand_type_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.onboarding_checklist_group_demand_types l
                      WHERE l.group_id = p_group_id)
      OR EXISTS (SELECT 1 FROM public.onboarding_checklist_group_demand_types l
                  WHERE l.group_id = p_group_id AND l.demand_type_id = p_demand_type_id);
$$;

REVOKE ALL ON FUNCTION public.fn_onb_checklist_grupo_aplica(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_checklist_grupo_aplica(uuid, uuid) TO authenticated, service_role;
```

Não é `SECURITY DEFINER`: ela é chamada de dentro de RPCs que já são definer e rodam como
owner. Retorna booleano, não devolve dado de tenant nenhum.

## Backend — 2 RPCs alteradas

### `sync_journey_stage_checklist(p_journey_id, p_stage_id)`

É ela que materializa o snapshot em `onboarding_journey_checklist` — chamada pelo
`JourneyDetailSheet` toda vez que o card abre ([JourneyDetailSheet.tsx:547](../../../src/pages/onboarding/JourneyDetailSheet.tsx#L547)).

1. Ler `demand_type_id` da jornada junto com o `tenant_id` que já é lido.
2. **DELETE novo, antes do INSERT:** apagar de `onboarding_journey_checklist` as linhas do
   stage em questão com `origem = 'etapa'`, `done = false` e cujo grupo de origem não
   aplica mais (`NOT fn_onb_checklist_grupo_aplica(c.group_id, v_demand)`, via join em
   `onboarding_stage_checklist` por `source_item_id`). Item com `done = true` não é tocado
   (regra 5).
3. Adicionar o filtro no `INSERT ... SELECT` que materializa.
4. O `UPDATE` de reespelho da definição não muda: ele só toca no que já existe.

### `move_onboarding_stage(...)`

É o gate de passagem de etapa. **Tem dois caminhos de contagem de obrigatórios e os dois
precisam do filtro** — este é o risco nº 1 da entrega: sem isso um item invisível trava a
etapa com a mensagem `checklist_incompleto` e ninguém consegue explicar o que falta.

1. Ler `demand_type_id` no `SELECT ... INTO` inicial.
2. Caminho `v_mat = 0` (jornada que nunca abriu o card, conta direto de
   `onboarding_stage_checklist`): adicionar `AND fn_onb_checklist_grupo_aplica(c.group_id, v_demand)`.
3. Caminho `v_mat > 0`, primeira subquery (a que faz `LEFT JOIN` de `onboarding_stage_checklist`
   com o snapshot): mesmo filtro.
4. Caminho `v_mat > 0`, segunda subquery (itens com `origem <> 'etapa'`, criados à mão na
   jornada): **não muda**. Item manual não tem grupo e não tem vínculo.

`apply_onboarding_blueprint` (gerador de pipeline por IA) **não muda**: grupo que ela cria
nasce sem vínculo e vale para todas as demandas.

Nenhuma outra função do banco lê `onboarding_stage_checklist` — verificado por
`pg_get_functiondef ILIKE`, são exatamente estas 3.

## Frontend

### Configuração — [PipelinesPanel.tsx](../../../src/pages/onboarding/config/PipelinesPanel.tsx)

Único lugar com mudança visual. No header do `SortableGroup` (linha ~1020), entre o nome do
grupo e o badge de contagem de itens:

- Um botão-badge com o resumo do vínculo: **"Todas as demandas"** quando não há vínculo,
  ou os nomes/cores dos tipos vinculados (com "+N" a partir do terceiro).
- Clique abre um `Popover` com a lista de tipos de demanda ativos do tenant e um checkbox
  por linha. Marcar/desmarcar grava direto (insert/delete na tabela de vínculo) e invalida
  a query dos vínculos.
- O tipo de demanda já tem `cor` cadastrada — usar a mesma cor do `DemandTypesPanel` para
  o badge, não inventar paleta.

Duas queries novas, ambas com `.eq("tenant_id", tid)` explícito e `useTenantFilter`:
tipos de demanda ativos (`onboarding_demand_types`, `ativo = true`, ordenado por `position`)
e os vínculos dos grupos da etapa selecionada. A tabela não está em `types.ts` → usar
`(supabase.from("onboarding_checklist_group_demand_types" as any) as any)`, conforme a
convenção do projeto.

A tela de configuração continua listando **todos** os grupos, vinculados ou não — é
cadastro, não jornada.

### Card da jornada — [JourneyDetailSheet.tsx](../../../src/pages/onboarding/JourneyDetailSheet.tsx)

Nenhuma linha alterada. Ele lê o snapshot já filtrado pela RPC.

## Testes

SQL, em `scripts/sql-tests/`, rodados no Docker local via `docker exec` (o stack local tem
a base real de produção). Casos:

1. Grupo sem vínculo aparece em jornada de qualquer demanda.
2. Grupo vinculado à demanda A aparece na jornada A e **não** aparece na jornada B.
3. Grupo vinculado a A **e** B aparece nas duas.
4. Item obrigatório de grupo que não aplica **não** bloqueia `move_onboarding_stage` —
   testar nos dois caminhos: jornada sem snapshot (`v_mat = 0`) e jornada com snapshot.
5. Item obrigatório de grupo que aplica **continua** bloqueando.
6. Troca do tipo de demanda da jornada: item não marcado do grupo que saiu some no próximo
   `sync`; item marcado permanece.
7. Item sem grupo aparece em qualquer demanda.
8. Jornada com `demand_type_id IS NULL` vê todos os grupos.
9. RLS: usuário do tenant X não lê vínculo do tenant Y (JWT forjado, conforme
   `docs/` de validação de RLS local).

`bun run build` e `npx tsc -p tsconfig.app.json` (o `tsc` da raiz não checa nada).

## Ordem de aplicação

1. Tabela + RLS + índice.
2. `fn_onb_checklist_grupo_aplica`.
3. `sync_journey_stage_checklist` e `move_onboarding_stage` — reler
   `pg_get_functiondef` imediatamente antes de cada `CREATE OR REPLACE`: outra sessão ou o
   Lovable podem ter reescrito a função no meio do caminho.
4. Frontend.

Tudo validado no Docker local primeiro. Aplicação em produção só com OK explícito, via
`apply_migration` — nunca `db push`.
