# Rodízio do onboarding por pipeline

**Data:** 13/08/2026 · **Origem:** owner (Digi Office — pipelines "Onboarding PDV" e "Onboarding Gula")

## Problema

A regra de distribuição do onboarding é **uma por setor**. `onboarding_assignment_rules`
tem `UNIQUE (tenant_id, department_id)`, e `fn_onboarding_pick_assignee(p_tenant_id,
p_department_id)` monta o pool a partir de `support_department_members` daquele setor.

Digi Office tem dois pipelines na jornada de Onboarding e **os dois apontam para o mesmo
setor**:

| pipeline | produto | setor | membros do setor |
|---|---|---|---|
| Onboarding PDV | todos | `Onboarding` | Amanda Ferrari, Fabianne |
| Onboarding Gula | Gula (14) | `Onboarding` | Amanda Ferrari, Fabianne |

Resultado: uma regra só (`round_robin`, sem exclusões) governa os dois. Não existe como
dizer "Fabianne não pega Gula" nem "quem pega Gula é o Fabricio".

**E quem realmente faz o onboarding do Gula não está no setor.** Medido em produção em
13/08: as 5 jornadas de produto Gula que existem têm `onboarding_responsavel_history.motivo
IS NULL` nas 5 — **nenhuma veio do motor**. As duas mais recentes (12/08, ativas) foram
atribuídas à mão para **"Fabricio Onboarding"**, que é do setor **`Suporte Gula`**.

E `funcionarios.department_id` é 1 setor por pessoa (`trg_sync_funcionario_dept_to_members`
replica para `support_department_members`). Pôr o Fabricio no setor `Onboarding` para ele
entrar no rodízio tiraria ele do `Suporte Gula` e quebraria a distribuição de chat dele.

Ou seja: enquanto o pool sair do setor, o Gula continua sendo distribuído na mão.

## Regra

**A unidade de distribuição passa a ser o pipeline, não o setor.** Cada pipeline tem motor
próprio: estratégia própria, agente fixo próprio, ciclo de rodízio próprio e **lista própria
de participantes, escolhida a dedo entre qualquer funcionário ativo do tenant**.

Três pontos que ficam decididos:

1. **A lista é explícita, não uma exclusão.** Com pool livre não existe "de quem excluir":
   `excluded_agents` (quem NÃO participa) vira `included_agents` (quem participa), ordenada.
   O rodízio caminha nessa ordem.
2. **Fallback = setor, nunca o tenant.** Pipeline sem regra, ou com a lista vazia, cai nos
   membros do setor do pipeline com `menor_carga` — o comportamento de hoje. Sem isso, todo
   tenant que ainda não configurou passaria a criar jornada órfã. O tenant inteiro só
   aparece no **seletor da tela**, para poder adicionar alguém de fora do setor; nunca como
   pool automático.
3. **`menor_carga` continua contando a pessoa inteira.** As jornadas ativas de alguém são
   as dele em todos os pipelines, não só as do pipeline que está distribuindo — é a carga
   real dela.

**O setor continua saindo do pipeline e indo para o ticket.** Ele deixa de mandar em quem
recebe, e nada mais. Se o ticket de Gula deve nascer em `Suporte Gula` em vez de
`Onboarding`, isso já é configurável na primeira seção da mesma tela — não precisa de código.

**Desequilíbrio aceito.** Cada pipeline gira o próprio ciclo sem olhar o outro. Quem estiver
em dois pipelines pode receber alternadamente de ambos e acumular mais que um colega que só
está em um. É o preço de separar os motores, e foi aceito pelo owner: `menor_carga` continua
disponível para quem quiser equilíbrio em vez de alternância.

## Modelo de dados

### `onboarding_assignment_rules`

| coluna | antes | depois |
|---|---|---|
| `department_id` | `NOT NULL`, FK, parte da UNIQUE | **removida** — deriva do pipeline |
| `pipeline_id` | — | `NOT NULL`, FK → `onboarding_pipelines(id) ON DELETE CASCADE` |
| UNIQUE | `(tenant_id, department_id)` | `(tenant_id, pipeline_id)` |
| `excluded_agents uuid[]` | quem NÃO participa | **removida** |
| `included_agents uuid[]` | — | quem participa, na ordem do rodízio, default `'{}'` |
| `strategy`, `fixed_agent_id`, `round_robin_last_index`, `is_active` | por setor | por pipeline |

`department_id` sai em vez de virar redundante: mantê-lo criaria divergência silenciosa no
dia em que o setor do pipeline mudar na tela e a regra continuar apontando para o antigo.

As 4 policies de RLS (`can_access_tenant_row(tenant_id)`) e a trigger
`trg_touch_onboarding_assignment_rules` não mudam — nenhuma delas olha `department_id`.

### Backfill

Para cada pipeline **ativo da primeira jornada** cujo setor tem regra hoje, cria uma linha
copiando `strategy`, `fixed_agent_id`, `round_robin_last_index` e `is_active`, com
`included_agents` = membros ativos do setor menos os que estavam em `excluded_agents`, na
mesma ordem que o motor usa hoje (`ORDER BY m.user_id`).

Digi Office fica com: PDV → `[Amanda, Fabianne]`, Gula → `[Amanda, Fabianne]`, ambos
`round_robin`. **Comportamento no dia 1 idêntico ao de hoje.** Ajustar o Gula para o
Fabricio é ação de tela, não de migration.

Só existe uma linha em produção hoje (setor `Onboarding`, `round_robin`, índice 2, sem
exclusões), então o backfill produz 2 linhas.

## Motor

### `fn_onboarding_pick_assignee(p_tenant_id uuid, p_pipeline_id uuid)`

Precisa de **`DROP` + `CREATE`**: os tipos dos parâmetros são os mesmos `(uuid, uuid)` e só
o nome do segundo muda, e `CREATE OR REPLACE` recusa renomear parâmetro. Na mesma
transação, `create_onboarding_journey` é recriada — plpgsql resolve a chamada em tempo de
execução, então não há janela quebrada.

O que a nova versão faz, em ordem:

1. `PERFORM public.assert_tenant_scope(p_tenant_id)` — **produção tem essa linha e o repo
   não** (injetada por `20260731230000_guarda_escopo_tenant_rpcs.sql`). Recriar sem ela
   reabre o vazamento cross-tenant fechado em 31/07.
2. Lê a regra por `(tenant_id, pipeline_id, is_active)` com `FOR UPDATE` — o lock é o que
   impede duas jornadas simultâneas de lerem o mesmo `round_robin_last_index`.
3. Monta os candidatos:
   - com `included_agents` não vazio → essas pessoas, **na ordem do array**, filtrando por
     `profiles.tenant_id = p_tenant_id AND COALESCE(status,'ativo') = 'ativo'`;
   - sem regra ou com lista vazia → membros ativos do setor do pipeline
     (`onboarding_pipelines.department_id` → `support_department_members`), `ORDER BY user_id`.
4. Sem candidato → `NULL` (a jornada nasce sem responsável, como hoje).
5. `fixo` com o agente ainda no pool → ele. Senão cai em `menor_carga`.
6. `round_robin` → `(last_index + 1) % n`, grava o índice novo, devolve a posição.
7. `menor_carga` → menor número de jornadas ativas da pessoa; empate por quem assumiu a
   última há mais tempo (`onboarding_responsavel_history`), depois por `user_id`.

Grants: `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO authenticated, service_role`, refeitos
depois do `DROP` — o `DROP` leva os grants junto.

### `create_onboarding_journey`

Uma linha muda: `fn_onboarding_pick_assignee(p_tenant_id, v_dept)` vira
`fn_onboarding_pick_assignee(p_tenant_id, v_pipe_onb)`. `v_pipe_onb` já está resolvido
acima (match de produto entre os pipelines com etapas), então não há reordenação.

O `IF/ELSIF` que decide **quando** distribuir muda de condição, com cuidado. Hoje é
`ELSIF v_dept IS NOT NULL … ELSE v_implantador := auth.uid()` — sem setor, quem cria vira
dono. Com pool próprio, um pipeline pode ter participantes e não ter setor, então a
condição passa a ser **"o pipeline tem lista explícita OU tem setor"**.

Não pode virar `ELSIF v_pipe_onb IS NOT NULL`: `v_pipe_onb` nunca é `NULL` naquele ponto (a
guarda de `v_first_stage` já levantou exceção antes), o que tornaria o `ELSE` código morto e
faria todo tenant sem distribuição configurada passar a criar **jornada órfã** — exatamente
a regressão que o comentário da migration original alerta.

Com a condição acima, o mapeamento é 1:1 com hoje: sem lista e sem setor → `auth.uid()`;
com um dos dois → o motor decide, e `NULL` do motor continua significando jornada sem
responsável, como já é.

O `v_motivo` do histórico e o evento `onboarding_responsavel_auto` passam a citar o
**pipeline** em vez do setor.

⚠️ **A definição de produção tem 6910 caracteres contra ~5000 no repo** (SLA, etapa gatilho,
trilho por produto, unidade). Baixar `pg_get_functiondef` imediatamente antes de escrever a
migration e conferir o md5 na hora do apply — duas migrations na mesma função já causaram
lost update neste projeto.

### `fn_onboarding_assignment_pool(...)`

Ganha `p_pipeline_id uuid DEFAULT NULL` e passa a resolver o pipeline (não o setor) quando
vier `NULL`, com a **mesma** regra de escolha de `create_onboarding_journey`
(`fase` + produto + tem etapa ativa + `ORDER BY (produto_id = p_produto_id) DESC NULLS LAST,
position`). Também é `DROP` + `CREATE`: a assinatura atual é
`(uuid, uuid, bigint, text)` e `p_department_id` deixa de fazer sentido como entrada.

Retorno passa a incluir `pipeline_id` e `pipeline_nome` ao lado de `department_id` /
`department_nome`, e `membros` passa a ser a lista efetiva do pipeline (a explícita, ou a do
setor no fallback) com `jornadas_ativas` e um `origem` (`'lista'` | `'setor'`) para a tela
poder dizer de onde saiu.

`no_rodizio` sai do retorno: com lista explícita, estar na lista **é** participar.

## Tela — `src/pages/onboarding/config/DistribuicaoPanel.tsx`

A seção "Setor de cada pipeline" não muda.

A seção "Regra do rodízio" passa de **um card por setor** para **um card por pipeline da
primeira jornada** (hoje: Onboarding PDV e Onboarding Gula), com o nome do setor como
subtítulo do card — ele ainda importa, porque é o que vai para o ticket e é o fallback.

Dentro do card:

- **Como escolher o responsável** — igual, mas grava por pipeline (`onConflict:
  "tenant_id,pipeline_id"`).
- **Agente fixo** — a lista de opções passa a ser a lista de participantes do pipeline.
- **Quem participa** — deixa de ser switch sobre os membros do setor. Vira a lista escolhida,
  cada linha com nome, jornadas ativas e um **X** para remover, mais um
  **"+ Adicionar pessoa"** que oferece qualquer funcionário ativo do tenant ainda não na
  lista (`profiles.status='ativo'` → `funcionarios.nome`, ordenado por nome).
- **Lista vazia** — estado explícito, não erro: "Sem ninguém escolhido — as jornadas vão para
  o rodízio do setor `X`", ou "…vão nascer sem responsável" quando o setor também está vazio
  ou o pipeline não tem setor. A trava atual ("precisa sobrar pelo menos uma pessoa") **sai**:
  esvaziar a lista passa a ser uma escolha válida, com consequência escrita na tela.

O aviso de que o rodízio só age na criação e só na primeira jornada continua.

## Tela — `src/pages/onboarding/NewJourneyModal.tsx`

Já resolve o pool por produto — que é o que escolhe o pipeline — então herda o
comportamento novo sem mudar a chamada. Três ajustes:

- O texto da prévia passa a citar o pipeline: "Rodízio de **Onboarding Gula**" em vez de
  "Rodízio entre o setor Onboarding".
- `temSetor` (linha 125), que hoje decide entre o pool e a lista geral de funcionários,
  passa a olhar `membros.length > 0`: com pool próprio, ter setor deixou de ser o sinal certo.
- **O select de Responsável não pode ficar restrito à lista do pipeline.** Hoje, com setor
  definido, ele só oferece os membros do setor (linha 320) — e é justamente por isso que
  escolher o Fabricio à mão hoje depende de o pipeline estar sem setor. Passa a ter dois
  grupos: os participantes do pipeline, com a carga de cada um, e **"Outros"** com o
  restante dos funcionários ativos. A exceção manual continua possível sem depender de
  configuração ausente.

## Testes

`scripts/sql-tests/03_distribuicao.sql` já cobre o motor e **vai quebrar de propósito** — a
asserção nº 2 conta as 10 colunas de `onboarding_assignment_rules` pelo nome. Atualizar, e
somar os casos novos:

1. Dois pipelines no mesmo setor com listas diferentes → cada um distribui só para a sua
   gente, e o rodízio de um não move o índice do outro.
2. Participante **de fora do setor** do pipeline é escolhido normalmente (é o caso Fabricio).
3. Pipeline sem regra → cai nos membros do setor com `menor_carga` (não regride).
4. Pipeline com `included_agents = '{}'` → mesmo fallback do item 3.
5. Participante que ficou `profiles.status <> 'ativo'` sai do pool sem quebrar o rodízio.
6. `fixo` apontando para alguém que saiu da lista → cai em `menor_carga`.
7. Grants de `authenticated` presentes nas duas funções **depois** do `DROP`/`CREATE`.

Roda no Docker local: `docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d
postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_distribuicao.sql`.

Antes do apply em produção, conferir na tela local com a base real: os dois cards aparecem,
o Gula aceita o Fabricio, e uma jornada nova de Gula nasce com ele sem ninguém escolher.

## Fora de escopo

- Ordenar o rodízio arrastando — a ordem é a de inserção.
- Distribuição nas jornadas seguintes (Implantação, Acompanhamento): lá a responsabilidade
  vai para quem conduziu o treino, e isso não muda.
- Mudar o setor que vai para o ticket do Gula: já é configurável na tela.
- Teto de jornadas por pessoa: continua não existindo, decisão anterior do owner.

## Riscos

| risco | mitigação |
|---|---|
| `create_onboarding_journey` regredir (prod ≠ repo, 6910 vs ~5000 chars) | baixar `pg_get_functiondef` e conferir md5 no momento do apply |
| Recriar `fn_onboarding_pick_assignee` sem `assert_tenant_scope` | está no passo 1 do motor; teste 7 confere os grants, e o corpo é conferido no diff |
| `DROP FUNCTION` derrubar grants em silêncio | `REVOKE`/`GRANT` explícitos na mesma migration, asseridos no teste |
| Backfill errado deixar pipeline sem regra | o fallback para o setor cobre; nenhuma jornada nasce órfã por isso |
| Migration não versionada (o projeto não tem CI de migrations) | migration no repo **e** aplicada por `apply_migration`, com OK do Alexandre |
