# Participantes e presença no sub-ticket de treino

Data: 2026-08-02
Status: aprovado para plano

## Problema

O sub-ticket de treino não sabe **quem** foi treinado. Existe `onboarding_training_sessions.participantes`,
um `text` livre — e ele está **vazio nas 26 sessões da base** e não é lido por nenhum arquivo do front.
Coluna morta.

Quem esteve na sala hoje é respondido por um único booleano, `proprietario_presente`, que diz apenas
se o dono da empresa apareceu. Ele é preenchido à mão por um botão no card e está informado em
**2 das 26 sessões** — os outros 24 são `NULL`, que significa "não informado" e não "ausente".
Foi exatamente essa confusão que pintou a métrica do dashboard de vermelho em 02/08 e obrigou o
`dashMetrics.ts` a passar a dividir pelos informados.

Consequências práticas: não dá para saber quem faltou, não dá para cobrar quem faltou, e um
retreinamento é agendado sem saber quem precisa dele.

## Escopo

Uma lista 1:N de participantes por sessão de treino. Cada participante:

| Campo | |
|---|---|
| Nome | obrigatório |
| Tipo | `colaborador` · `responsavel_empresa` · `outro` |
| Fone | opcional |
| E-mail | opcional |
| Presença | `presente` · `ausente` · **não informado** (estado inicial) |

### Fora do escopo, por decisão

- **Tipos cadastráveis por tenant.** Os três valores são fixos no código. `onboarding_participant_roles`
  virou tabela por tenant em 26/07 porque papel de participante da jornada é operacional (implantador,
  vendedor…) e cada empresa organiza o seu. Aqui é classificação de quem sentou na cadeira, não papel.
  Se um tenant precisar de mais, o CHECK vira tabela — mas não antes.
- **No-show automático.** Todo mundo ausente **não** vira `status = 'no_show'`. A flag continua manual,
  pelo botão de sempre. Motivo: `no_show` é pegajosa (nada limpa) e já causou dupla contagem no
  dashboard; não vamos criar um segundo escritor para ela.
- **Retreinamento pré-preenchido com quem faltou.** Boa ideia, não é esta entrega.

## Modelo de dados

### `onboarding_training_participants` (nova)

| coluna | tipo | |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL → `tenants` | |
| `training_id` | uuid NOT NULL → `onboarding_training_sessions` **ON DELETE CASCADE** | |
| `cliente_contato_id` | uuid NULL → `cliente_contatos` **ON DELETE SET NULL** | de onde veio, quando veio de lá |
| `nome` | text NOT NULL | |
| `tipo` | text NOT NULL, CHECK `IN ('colaborador','responsavel_empresa','outro')` | default `colaborador` |
| `fone` | text NULL | |
| `email` | text NULL | |
| `presente` | boolean NULL | **NULL = não informado** |
| `presenca_em` | timestamptz NULL | quando a chamada foi respondida |
| `presenca_por` | uuid NULL | quem respondeu |
| `created_at` / `created_by` / `updated_at` | | |

**Por que `nome`/`fone`/`email` são cópia e não JOIN em `cliente_contatos`:** a lista é o registro
do que aconteceu naquele dia. Se o contato trocar de telefone, mudar de empresa ou for apagado do
cadastro, a ata do treino continua verdadeira. `cliente_contato_id` fica só como rastro da origem —
e é `ON DELETE SET NULL` justamente porque apagar o contato não pode apagar a ata.

Índices: `(training_id)` e `(tenant_id, cliente_contato_id)`.

RLS nas 4 operações com `public.can_access_tenant_row(tenant_id)`, igual a
`onboarding_training_stage_history`.

### `onboarding_training_sessions.participantes`

**Dropada.** 26 linhas na base, zero preenchidas, zero leitores no repo. Deixar uma coluna `text`
chamada `participantes` ao lado de uma tabela `..._participants` é convite a bug.

### `proprietario_presente` vira derivado

A coluna **continua existindo e continua sendo lida pelo dashboard** — o que muda é quem escreve.
Trigger `AFTER INSERT/UPDATE/DELETE` em `onboarding_training_participants` recalcula:

```
informados := participantes do treino com tipo='responsavel_empresa' AND presente IS NOT NULL
se informados = 0  →  NÃO MEXE na coluna
senão              →  proprietario_presente := (existe algum informado com presente = true)
```

A cláusula "não mexe quando não há informado" preserva as **2 sessões já marcadas hoje** e mantém
a semântica que o `dashMetrics.ts` acabou de ganhar: `NULL` é "não informado", nunca "ausente".

`dashMetrics.ts` e `OnboardingDashboardPage.tsx` **não mudam uma linha**. A métrica que já existe
passa a se alimentar sozinha, com cobertura muito maior.

O botão "Proprietário presente / Marcar ausente" **sai** do card do treino
(`JourneyDetailSheet.tsx:2399-2404`) e a função `handleTogglePresente` some junto: a verdade passa
a ser a lista. O badge "proprietário presente" no card continua, agora derivado.

### `vw_onboarding_training_cards`

Ganha três colunas por `LEFT JOIN LATERAL` sobre a tabela nova:

- `participantes_total` int
- `participantes_presentes` int
- `chamada_pendente` boolean — `total = 0 OR existe algum com presente IS NULL`

⚠️ A view é `security_invoker=true`. O `CREATE OR REPLACE VIEW` **tem que repetir a cláusula** —
sem ela a opção é descartada em silêncio (provado em 26/07, `dfbbf64a`).

## RPCs

Todas `SECURITY DEFINER` + `SET search_path = public` + `REVOKE FROM PUBLIC` +
`GRANT TO authenticated, service_role`, com a guarda de tenant como **primeiro** statement.

### `upsert_onboarding_training_participant(p_participant_id, p_training_id, p_nome, p_tipo, p_fone, p_email, p_cliente_contato_id, p_salvar_no_cliente)`

Cria ou edita um participante. Com `p_salvar_no_cliente = true` e sem `p_cliente_contato_id`,
grava também em `cliente_contatos` (cliente da jornada) e guarda o id resultante.
Recusa treino excluído. Não recusa treino realizado — corrigir um nome depois é legítimo.

### `delete_onboarding_training_participant(p_participant_id)`

Remoção física. A lista é cadastro do treino, não histórico de movimentação.

### `set_onboarding_training_attendance(p_training_id, p_presencas jsonb)`

`p_presencas` = `[{"id": uuid, "presente": bool}, …]`. Grava todos de uma vez, com
`presenca_em = now()` e `presenca_por = auth.uid()`. Uma chamada só para a tela inteira, em vez de
N updates — a trigger de `proprietario_presente` roda uma vez por statement.

### `mark_onboarding_training_realized(p_training_id)`

Substitui o `UPDATE` direto que o botão **Realizado** faz hoje
(`JourneyDetailSheet.tsx:1588`). Valida, nesta ordem:

| situação | retorno |
|---|---|
| treino excluído / cancelado | `ok:false, reason:'treino_indisponivel'` |
| `participantes_total = 0` | `ok:false, reason:'sem_participantes'` |
| algum `presente IS NULL` | `ok:false, reason:'presenca_pendente', pendentes:N` |
| ok | marca `status='realizado'`, `realizado_em=now()`, registra evento na timeline |

### `move_onboarding_training_stage` — muda o retorno, **não** o comportamento

Continua movendo e continua marcando `realizado` ao entrar em etapa `is_final`. Passa a devolver
`chamada_pendente: true` quando fecha o cartão com presença em aberto.

**Decisão do owner:** arrastar **avisa, mas não impede**. O aviso não pode ser só um toast que some —
o cartão fica com badge **"chamada pendente"** no quadro e no card da jornada até alguém responder.

Os **9 treinos já realizados** não são tocados. A trava vale daqui pra frente.

## UX

### `TrainingParticipantsDialog` — um diálogo, dois modos

**Modo lista** (botão `Participantes` no card do treino):
linha por participante com nome, badge do tipo, fone, e-mail e o estado da presença.
Adicionar abre um campo de busca que consulta `cliente_contatos` do cliente da jornada; escolher um
contato preenche nome, fone e e-mail sozinho. Digitando um nome que não existe, aparece o checkbox
**"Salvar no cadastro do cliente"**, marcado por padrão — desmarque para gente de passagem.

**Modo chamada** (abre quando o botão `Realizado` volta `presenca_pendente` ou `sem_participantes`):
a mesma lista, com presente/ausente por pessoa em destaque. O botão de confirmar só habilita com
todo mundo respondido e com pelo menos um participante na lista. Fechar o diálogo sem responder é
permitido — o treino simplesmente não fica realizado.

### Card do treino (`JourneyDetailSheet`)

- Linha nova: `👥 3 · 2 presentes`, ou `👥 3 · chamada pendente`, ou `Sem participantes`.
- Botão `Participantes` ao lado de `Editar`.
- Sai o botão `Proprietário presente / Marcar ausente`.

### Quadro da Implantação (`ImplantacaoBoard`)

- Badge `chamada pendente` no cartão, âmbar, quando `chamada_pendente = true` e o treino já está
  realizado. Cartão ainda não realizado não mostra nada — não é pendência ainda.
- Contagem `👥 3 · 2 presentes` no rodapé do cartão.
- Ao arrastar para a coluna final com presença em aberto: toast de aviso
  ("Treinamento fechado sem a chamada — abra a jornada e marque quem participou"), o cartão anda.

**Jornada encerrada não recebe o selo**, nem no quadro nem na jornada. Dos 9 treinos já realizados
na base, 7 estão em jornada concluída ou cancelada: cobrar chamada do passado que ninguém pode mais
responder é ruído, não pendência. Sobram 2 cartões com o selo no dia da subida.

## Quem pode

Mesma porta de `canScheduleTraining` (`JourneyDetailSheet.tsx:1004`): jornada não concluída e,
na primeira jornada, só a partir da etapa final do onboarding. Sem role novo.
A guarda real é `can_access_tenant_row` dentro de cada RPC.

## Testes

- `dashMetrics.test.ts` não muda — a forma dos dados que ele consome é a mesma.
- Novo `scripts/sql-tests/` para a trigger de `proprietario_presente`: os quatro caminhos
  (nenhum informado → não mexe; um responsável presente → true; um responsável ausente → false;
  responsável removido da lista → volta a não mexer).
- Smoke rollback-safe (`DO $$ … RAISE EXCEPTION 'SMOKE_OK|%'`) para
  `mark_onboarding_training_realized` nos quatro retornos.
- Validação de grants: `pg_proc` + `information_schema.routine_privileges` numa query só.
