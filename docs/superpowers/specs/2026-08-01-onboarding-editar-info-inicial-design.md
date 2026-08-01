# Editar informações iniciais da jornada de onboarding (admin)

Data: 2026-08-01
Status: aprovado para plano

## Problema

A jornada de onboarding nasce no `NewJourneyModal` com cliente, produto, tipo de demanda,
assunto, início planejado e go-live previsto. Depois de aberta, só o responsável (Transferir),
os módulos e as tags são editáveis. O resto é imutável — não existe nenhuma RPC de update.

Quando o vendedor erra uma informação no cadastro, hoje não há correção: o dado errado
acompanha a jornada até o fim e contamina o controle e os relatórios.

## Escopo

Um admin pode corrigir, em jornada **aberta**:

| Campo | Onde vive |
|---|---|
| Cliente | `support_tickets.cliente_id` + `onboarding_journeys.cliente_id` (+ `unidade_base_id` do ticket) |
| Tipo de demanda | `onboarding_journeys.demand_type_id` |
| Assunto | `support_tickets.assunto` |
| Início planejado | `onboarding_journeys.data_inicio_planejado` |
| Go-live previsto | `onboarding_journeys.go_live_previsto` |

### Fora do escopo, por decisão

- **Produto.** `create_onboarding_journey` resolve `pipeline_onboarding_id` e
  `pipeline_implantacao_id` a partir do produto. Trocá-lo depois exigiria migrar a jornada de
  quadro e remapear `onboarding_journey_checklist`, `onboarding_stage_history`,
  `onboarding_phase_metrics` e `onboarding_training_stage_history`.
  Em produção existe **um único** par produto↔pipeline (`Onboarding Gula`, produto 14, com 1
  jornada; as outras 48 usam `Onboarding PDV`, que tem `produto_id IS NULL`). Custo alto para 1
  caso em 49. **Para trocar o produto: cancelar a jornada e abrir outra.**
  Efeito colateral bom: como `advance_onboarding_phase` também resolve o pipeline da fase
  seguinte pelo `produto_id` atual, manter o produto imutável mantém o quadro futuro previsível.
- **Responsável.** Já existe `transfer_onboarding_responsavel`, com histórico
  (`onboarding_responsavel_history`) e motivo próprios. Não duplicar.
- **Jornada concluída ou cancelada.** Travada, como já faz `move_onboarding_stage` e
  `advance_onboarding_phase` (`reason: 'jornada_terminal'`). Nada reescreve relatório fechado.

## Quem pode

`profiles.role = 'admin'` **ou** `profiles.is_super_admin = true`.

Segue o padrão de `RequireRole` e o que o `JourneyDetailSheet.tsx:1039` já calcula
(`isAdmin`). `head` e `user` não veem o botão e não passam pela RPC.

A checagem de role acontece **dentro da RPC**, não só na UI. O CLAUDE.md registra "RBAC backend
hardening" como pendência aberta (Conselho DS é gate só de UI); esta função nasce fechada.

## UX

Botão **`Editar`** no cabeçalho do `JourneyDetailSheet`, na mesma linha de
Conversa / Retornar ao vendedor / Pausar / Cancelar jornada / Go-live.
Só renderiza quando `isAdmin && situacao ∉ ('concluido','cancelado')`.

Abre `EditJourneyInfoDialog`, espelhando o `NewJourneyModal` com os valores atuais:

- Cliente (busca por nome/CNPJ, mesma RPC de busca do modal de criação)
- Tipo de demanda
- Assunto
- Início planejado
- Go-live previsto
- **Motivo da alteração** — obrigatório, como em `transfer_onboarding_responsavel`
- Produto aparece como texto **desabilitado**, com a nota: *"Para trocar o produto, cancele esta
  jornada e abra outra — o produto define o quadro de etapas."*

Mexer em **início planejado** ou **tipo de demanda** recalcula o **go-live previsto** pelo SLA do
tipo de demanda, e o admin pode sobrescrever na mão — o mesmo comportamento (e o mesmo estado
`goLiveEdited`) que o `NewJourneyModal` já tem.

Ao salvar: toast + invalidação das queries do sheet e dos boards.

### Consequências visíveis, aceitas

1. **Trocar o cliente troca a unidade do ticket** (`clientes.unidade_base_id` → ticket). Quem
   estiver com filtro global de unidade ativo pode deixar de ver a jornada. Esperado.
2. **Mudar as datas não reinicia o SLA.** `sla_iniciado_em` não é tocado — `data_inicio_planejado`
   é planejamento, não cronômetro. Reiniciar SLA é outra feature.
3. **Treinamentos agendados e a conversa de WhatsApp não mudam** ao trocar o cliente: o vínculo é
   com o ticket, e o ticket continua o mesmo.

## Backend

RPC nova, uma transação:

```
update_onboarding_journey_info(
  p_journey_id                uuid,
  p_cliente_id                uuid,
  p_demand_type_id            uuid,
  p_assunto                   text,
  p_data_inicio_planejado     timestamptz,
  p_go_live_previsto          date,
  p_motivo                    text
) returns jsonb
```

`SECURITY DEFINER` · `SET search_path = public` · `REVOKE FROM PUBLIC` ·
`GRANT TO authenticated, service_role`.

**Todos os parâmetros são sempre enviados**, com o valor que está na tela. Não existe "campo
omitido": `NULL` significa *limpar*, não *manter*. Por isso não há flags `p_limpar_*` como em
`update_onboarding_training` — o diálogo carrega os valores atuais e devolve o formulário inteiro.

`p_cliente_id` e `p_assunto` não aceitam `NULL`/vazio (são obrigatórios desde a criação).
`p_demand_type_id`, `p_data_inicio_planejado` e `p_go_live_previsto` aceitam `NULL` e limpam o campo.

Guardas, nesta ordem:

1. `current_setting('role')` como primeiro statement — separa usuário logado de edge
   function/cron. É o que fecha o buraco cross-tenant corrigido em 31/07; `can_access_tenant_row`
   sozinho não serve de guarda.
2. Jornada existe → carrega `tenant_id`, `ticket_id`, `situacao`, valores atuais.
3. `can_access_tenant_row(v_tenant)`.
4. Role admin ou `is_super_admin()` no tenant da jornada.
5. `situacao IN ('concluido','cancelado')` → `{ok:false, reason:'jornada_terminal'}`.
6. Motivo não-vazio.
7. Cliente novo existe e é do mesmo tenant.

Escrita:

- `UPDATE support_tickets` — `assunto`, `cliente_id`, `unidade_base_id` (lido de
  `clientes.unidade_base_id` do cliente novo).
- `UPDATE onboarding_journeys` — `cliente_id`, `demand_type_id`, `data_inicio_planejado`,
  `go_live_previsto`. **`sla_iniciado_em` intocado.**
- Uma linha em `support_ticket_events` **por campo alterado**: `event_type`
  `'onboarding_info_editada'`, com `old_value` / `new_value` e o motivo no `content`.
  Aparece na aba **Timeline**, que já lê essa tabela.

Nenhum campo enviado igual ao atual gera evento — só o que mudou de fato.

## Testes

`scripts/sql-tests/`, rodando no Docker local via `docker exec`:

1. `head` e `user` são recusados; `admin` passa; super admin passa em tenant que não é o dele.
2. Jornada `concluido` e `cancelado` retornam `jornada_terminal` sem escrever nada.
3. Motivo vazio é recusado.
4. Cliente de outro tenant é recusado.
5. Troca de cliente atualiza os **dois** registros (ticket e jornada) e a `unidade_base_id`.
6. `sla_iniciado_em` é idêntico antes e depois, inclusive mudando `data_inicio_planejado`.
7. Campo enviado sem alteração não gera evento; campo alterado gera exatamente um.

Frontend: `createRoot` + `act` com o client do Supabase mockado — `@testing-library/react` derruba
a suíte neste repo (falta o peer `@testing-library/dom`).

## Riscos

- `JourneyDetailSheet.tsx` tem 3.490 linhas. O diálogo nasce em arquivo próprio
  (`EditJourneyInfoDialog.tsx`), não dentro dele.
- Outra sessão pode estar editando os mesmos arquivos de onboarding (`ImplantacaoBoard.tsx` está
  modificado e não é deste trabalho). Reconferir `git log` antes de afirmar estado; nunca
  `git add -A`.
- A DDL vai para produção via SQL Editor / `apply_migration` com OK explícito do Alexandre —
  nunca `db push`.
