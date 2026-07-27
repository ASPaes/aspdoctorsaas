# Drill-down do card "Não Atendido" — clientes no vácuo (DEM-0153)

**Data:** 2026-07-26
**Demanda:** DEM-0153 — CONSYSA SISTEMAS
**Tela:** Atendimento → Velocidade / SLA
**Arquivos alvo:** `src/components/atendimento/VelocidadeTab.tsx` · 2 arquivos novos · 1 RPC nova

## Problema

O card **Não Atendido** (`src/components/atendimento/VelocidadeTab.tsx:107`) mostra o percentual de
atendimentos encerrados sem ninguém ter assumido — `8.7% · 78/893 sem assumir` no print da demanda.
É um número morto: o gestor vê que 78 clientes ficaram no vácuo e não tem como saber **quais**.

Todos os outros drill-downs desse dashboard já existem no Tempo Real (`VerChatsDialog` +
`get_atendimento_realtime_chats`, buckets `fila` / `parados_24h` / `sla_estourando`), mas eles olham
só o **agora**. O card Não Atendido é histórico e não tem drill-down nenhum.

## O que os dados mostram

Medido em produção, CONSYSA, últimos 60 dias (`support_attendances`, mesmo recorte da RPC do card):

| Métrica | Valor |
|---|---|
| Atendimentos encerrados | 1.853 |
| `assumed_at IS NULL` (o número do card) | 175 |
| Desses, com `cliente_id` vinculado | 45 (26%) |
| Desses, com resposta de agente (`msg_agent_count > 0`) | 87 (50%) |
| Vácuo real — zero resposta de agente | **88** |
| Contatos distintos entre os 175 | 114 |
| `closed_reason` | 100% `manual` |
| Viraram ticket | 0 |

Duas conclusões que mudam a demanda como foi escrita:

1. **Agrupar por cliente não funciona.** 74% dos casos não têm cliente vinculado — coerente, já que
   ninguém assumiu e portanto ninguém vinculou. Na Feax são 57 não atendidos e **zero** com cliente.
   A chave de agrupamento tem que ser o **contato** (`contact_id`, com fallback para `contact_phone`).
2. **Metade dos 175 não é vácuo.** São chats em que o agente respondeu pelo WhatsApp e nunca clicou
   em "assumir" — falha de processo, não abandono. Listar os 175 crus faria o operador ver o próprio
   atendimento na lista de abandonados.

## Decisões tomadas

| Decisão | Escolha |
|---|---|
| O que é "cliente no vácuo" | O card **Não Atendido** (histórico do período), não a fila do Tempo Real |
| Granularidade da lista | **Agrupada por contato** — 1 linha por pessoa, com contador, expande nos chats |
| Escopo dos chats de cada contato | **Só os não atendidos do período filtrado** — sem histórico completo |
| Recorte de "vácuo" | **Só os sem nenhuma resposta de agente** (88), não os 175 |
| Onde o chat abre | **Modal de leitura no próprio dashboard**, com botão "Abrir no WhatsApp" |

A quarta decisão cria um descasamento consciente: o card diz 175 e a lista abre com 88. Mitigação
obrigatória — ver "Linha de reconciliação" abaixo. Nenhum KPI existente é alterado.

## Escopo

Uma RPC nova, dois arquivos novos e uma prop no card. Nada do que já existe muda de comportamento:
`get_atendimento_velocidade` não é tocada, o card continua contando 175, nenhuma migration de tabela,
nenhuma edge function, nenhum canal Realtime novo.

## Mudanças

### A. RPC `get_atendimento_nao_atendidos`

```sql
CREATE OR REPLACE FUNCTION public.get_atendimento_nao_atendidos(
  p_tenant_id       uuid,
  p_date_from       timestamptz,
  p_date_to         timestamptz,
  p_department_id   uuid    DEFAULT NULL,
  p_unidade_base_id bigint  DEFAULT NULL,
  p_agent_id        uuid    DEFAULT NULL,
  p_is_group        boolean DEFAULT NULL,
  p_limit           int     DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
```

Corpo, em CTEs:

- **`base`** — cópia literal da CTE `base` de `get_atendimento_velocidade`: mesmo guard de tenant
  (`is_super_admin()` → `p_tenant_id`, senão `current_tenant_id()`, exceção se nulo), mesmo
  `user_effective_unidades()`, mesmos filtros de período / `status='closed'` / mensagem de cliente /
  departamento / unidade / agente / `is_group`. **Não reescrever de cabeça** — a divergência de uma
  cláusula faz a lista não bater com o card e não há como o usuário saber qual dos dois está certo.
- **`vacuo`** — `base` + `assumed_at IS NULL AND COALESCE(msg_agent_count, 0) = 0`.
- **`chats`** — `vacuo` + `LEFT JOIN support_departments sd ON sd.id = department_id` e
  `LEFT JOIN clientes c ON c.id = cliente_id`; nome do cliente por
  `COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)')` — mesmo padrão de `get_atendimento_clientes`.
  A tabela `clientes` **não tem coluna `nome`**. Chave de agrupamento:
  `COALESCE(contact_id::text, contact_phone, id::text)`.
- **`agrupado`** — `GROUP BY` na chave; campos escalares por
  `(array_agg(x ORDER BY opened_at DESC))[1]`; cliente por
  `(array_agg(x ORDER BY (x IS NULL), opened_at DESC))[1]` para não perder o vínculo quando só um dos
  chats do contato tem cliente; `count(*) AS qtd`; `max(opened_at) AS ultimo_at`; e os chats em
  `jsonb_agg(... ORDER BY opened_at DESC)`.

Retorno (valores ilustrativos, exceto onde a validação abaixo fixa o esperado):

```jsonc
{
  "total_sem_resposta": 88,     // tamanho da lista
  "total_card": 175,            // count(*) de base WHERE assumed_at IS NULL — só para a reconciliação
  "total_contatos": 62,
  "truncado": false,            // total_contatos > p_limit
  "contatos": [
    {
      "contato": "…", "telefone": "…",
      "cliente_id": null, "cliente_nome": null,
      "qtd": 3, "ultimo_at": "…",
      "chats": [
        { "attendance_id": "…", "attendance_code": "…", "conversation_id": "…",
          "opened_at": "…", "closed_at": "…", "departamento": "…",
          "msg_customer_count": 4, "aberto_seg": 5310 }
      ]
    }
  ]
}
```

Ordenação dos contatos: `qtd DESC, ultimo_at DESC` — reincidência primeiro. `LIMIT p_limit` (200)
aplicado na subquery ordenada, com `truncado` sinalizando corte. Não usa `fetchAllRows` no frontend:
o retorno é agregado e cabe numa resposta.

Grants, na mesma migration:

```sql
REVOKE ALL ON FUNCTION public.get_atendimento_nao_atendidos(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid, boolean, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_atendimento_nao_atendidos(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid, boolean, int) TO authenticated, service_role;
```

Sem o `GRANT` a `authenticated` a RPC volta `null` no frontend e funciona no SQL Editor — a
armadilha número 1 do projeto.

### B. `src/components/atendimento/useAtendimentoNaoAtendidos.ts` (novo)

Clone estrutural de `useAtendimentoVelocidade`: `useTenantFilter` → `effectiveTenantId`,
`useUnidadeFilter` → `selectedUnidadeId` / `viewKey` / `unidadeFilterReady`, `useAtendimentoFilter`
→ `dateRange` / `departmentId` / `agentId` / `tipoAtendimento` (→ `p_is_group`).

- Assinatura: `useAtendimentoNaoAtendidos(enabled: boolean)` — o dialog passa o próprio `open`.
- `queryKey`: `["atendimento-nao-atendidos", tid, from, to, viewKey, departmentId, agentId, tipoAtendimento]`
- `enabled`: `enabled && !!tid && unidadeFilterReady` — a query só dispara quando o dialog abre.
- `refetchOnWindowFocus: false`, como os irmãos.

### C. `src/components/atendimento/NaoAtendidosDialog.tsx` (novo)

`Dialog` `max-w-2xl`, título "Clientes no vácuo".

- **Linha de reconciliação**, logo abaixo do título, em `text-xs text-muted-foreground`, montada com os
  números que a RPC devolve:
  `{total_sem_resposta} chats sem nenhuma resposta · outros {total_card − total_sem_resposta} tiveram
  resposta mas ninguém assumiu (o card conta os {total_card}).`
  Renderizada só quando `total_card > total_sem_resposta`. É o que impede o descasamento de virar chamado.
- Lista de contatos em `ScrollArea` `max-h-[60vh]`, item colapsável (`Collapsible`, fechado por padrão;
  aberto automaticamente quando só há um contato). Cabeçalho de cada item: nome do contato em destaque,
  telefone e nome do cliente (quando houver) em linha secundária, badge com `qtd` quando `> 1`.
- Expandido: uma linha por chat com data/hora de abertura, departamento, duração aberta
  (`fmtEspera(aberto_seg)`, reusado de `TempoRealTab`) e `ChevronRight`. Clique abre o modal de leitura.
- Estados: `Loader2` centralizado, erro em `border-destructive/30`, vazio com texto explicativo.

### D. Modal de leitura

Reusa `src/components/tickets/AttendanceChatHistoryModal.tsx` **sem alteração nenhuma** — ele já
recebe `conversationId`, `attendanceCode`, `contactName`, `openedAt`, `closedAt`, recorta as
mensagens pela janela do atendimento e trata mídia.

O "Abrir no WhatsApp" **não entra no modal** (que é compartilhado com a tela de tickets e não pode
mudar por causa desta demanda): é um botão de ícone na própria linha do chat, dentro do
`NaoAtendidosDialog`. Ele fecha o dialog e navega para `/whatsapp?conversation=<id>` — o mesmo deep
link que `VerChatsDialog` já usa e que `WhatsApp.tsx:85` já resolve para conversas encerradas.
A linha do chat fica com duas ações: o corpo abre a leitura, o ícone leva para o atendimento.

### E. `VelocidadeTab.tsx`

Única alteração no arquivo: `footer` no card Não Atendido, no mesmo padrão de `TempoRealTab.tsx:29`:

```tsx
footer={data.nao_atendido > 0 ? (
  <button type="button" onClick={() => setVerVacuo(true)}
    className="text-xs font-medium text-primary hover:underline focus:outline-none">
    Ver clientes →
  </button>
) : undefined}
```

Mais o `<NaoAtendidosDialog open={verVacuo} onOpenChange={setVerVacuo} />` no fim do fragmento.
O tilt 3D, o spotlight e o benchmark do `KPICardEnhanced` continuam intactos — `footer` é uma prop
que o componente já suporta.

## Bordas

| Situação | Comportamento |
|---|---|
| Filtro "agente X" ativo na tela | Lista sempre vazia (não atendido não tem `assigned_to`). Mensagem: "Nenhum resultado: o filtro de agente exclui atendimentos não atendidos, que por definição não têm agente." |
| Contato sem cliente vinculado (74%) | Mostra nome/telefone do WhatsApp. Sem placeholder de cliente. |
| Contato sem nome no WhatsApp | Cai para o telefone; só então `'Sem nome'`. |
| Mais de 200 contatos | Lista os 200 primeiros e avisa no rodapé quantos ficaram de fora. Sem truncamento silencioso. |
| Grupos | Respeita o filtro "Tipo" da tela via `p_is_group`, igual a todas as outras abas. |
| Card com valor 0 | Sem botão — o `footer` só aparece com `nao_atendido > 0`. |

## Validação antes de mostrar

Tudo no banco **local** (`./scripts/setup-local-db.sh`, que hoje tem a base real), nada em produção
até o Alexandre liberar:

1. `pg_proc` — a função existe com a assinatura esperada.
2. `information_schema.routine_privileges` — `authenticated` e `service_role` com `EXECUTE`.
3. Teste SQL em `scripts/sql-tests/`, no padrão do repo (`BEGIN` / `DO $$ ... RAISE EXCEPTION
   'FALHOU N: …' ... $$` / `ROLLBACK`), assertando **invariantes**, não números absolutos:
   `total_card` = `nao_atendido` de `get_atendimento_velocidade` nos mesmos filtros ·
   `total_sem_resposta` = contagem direta do critério · soma dos `qtd` = `total_sem_resposta` ·
   `total_contatos` = distintos da chave de agrupamento.
   **Por que invariante e não número fixo:** o banco local está congelado em 16/07/2026. A mesma
   janela de 60 dias dá `79 / 157` no local e `88 / 175` em produção. Um teste com número fixo
   quebraria sozinho na próxima carga de dados.
4. A conferência cruzada do item 3 (`total_card` × `nao_atendido`) é a que pega CTE `base` copiada
   errado — roda no mesmo banco, então independe de os dados estarem frescos.
5. Frontend: `npx tsc -p tsconfig.app.json` (o `tsc` da raiz não checa nada) + `bun run build`.
6. Revisão visual no localhost com o tenant CONSYSA simulado antes de mostrar.

## Fora de escopo

- Mudar a definição do card Não Atendido ou qualquer KPI existente.
- Drill-down dos 87 "respondidos sem assumir" — decisão explícita de deixar de fora.
- Histórico completo do contato além do período filtrado.
- Ação em massa (reabrir, atribuir, criar ticket) a partir da lista.
- Migrar os 5 `supabase.channel()` diretos da dívida técnica.
