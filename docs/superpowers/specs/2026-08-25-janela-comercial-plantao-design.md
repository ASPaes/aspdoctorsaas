# Janela comercial × plantão — design

**Data:** 25/08/2026 · **Owner:** Alexandre (ASP) · **Origem:** reclamação da Digi Office

## Problema

O dash de Atendimento classifica plantão lendo a janela de `business_hours`, que é a
janela de **disponibilidade** (quando tem gente atendendo), não a janela **comercial**
(quando o atendimento está incluso no contrato). Na Digi Office o Suporte está
cadastrado 09:00–22:00 nos **7 dias da semana** — para o motor, sábado às 15h é
expediente.

Consequências medidas no período 27/07–25/08 (tenant Digi Office):

| Indicador | Valor |
|---|---|
| Atendimentos marcados plantão pela régua atual | 11 |
| Tickets marcados plantão pelo operador, à mão | 232 |
| Desses, com chat aberto **dentro** da janela 09–22 | 175 |
| Tickets de plantão cujo chat também está marcado plantão | **1** |

O operador corrige na mão 175 vezes por mês. Quando esquece, vira divergência —
foi o que o cliente relatou.

Duas portas levam à mesma raiz:

- **Chat:** `fn_atendimento_plantao_em` → `fn_instante_fora_expediente` →
  `fn_expediente_janela_do_dia`, que lê `business_hours`.
- **Ticket:** o modo "auto" do modal chama `check_tipo_horario` →
  `is_within_business_hours(tenant, setor, opened_at do chat)`. Além da janela errada,
  a âncora é a **abertura do chat**, não o instante em que o agente trabalhou — a
  reclamação literal do cliente ("classifica com base no horário de abertura").

## Regra de negócio (Digi Office, palavras do cliente)

- Comercial: seg–qui 09:00–18:00, sex 09:00–17:00
- Plantão: fora disso até 22:00; fim de semana 09:00–22:00

Outros tenants têm janelas próprias — ASP é 08:00–12:00 e 13:30–18:18.

## Decisões tomadas

1. **A janela de disponibilidade não muda.** `business_hours` (09–22) continua sendo
   lida por distribuição (`fn_assign_conversation_if_ready`), mensagem automática de
   fora do horário, timeout de inatividade, SLA (`segundos_uteis`, `fn_business_due_at`,
   `fn_add_business_days`), go-live do onboarding e notificações. Baixá-la para 09–18
   faria o robô responder "estamos fechados" às 19h com agente atendendo.
2. **Nasce uma janela nova: horário comercial.** Cadastro **só no nível do tenant**
   (decisão do owner). Sem override por setor.
3. **Plantão é derivado, não cadastrado.** Plantão = ação do agente fora da janela
   comercial. O "até 22h" já vem da disponibilidade; quem trabalhou às 23h está fora do
   comercial do mesmo jeito. Um cadastro só, sem buraco entre as duas janelas.
4. **Tolerância cai de 30 para 5 minutos.** Os 30 min existiam para uma janela de
   disponibilidade difusa (agente começando 08:10 numa janela 08:30). Numa janela
   comercial que vale dinheiro, 30 min apagariam o plantão das 18h.
5. **Backfill: chats sim, tickets não.** O ticket é declaração do operador e fica
   intocado. O chat é medição e é recalculado.
6. **A aba Tickets passa a obedecer o filtro** "Só plantão".

## Validação — a régua nova contra o gabarito humano

Simulação com a janela do cliente e tolerância 5 min, período 27/07–25/08:

| | |
|---|---|
| Atendimentos com ação de agente | 2.054 |
| Plantão pela régua nova | 450 |
| Plantão pela régua atual | 11 |
| Operador marcou plantão / sistema concorda | **164 de 171 (96%)** |
| Operador marcou comercial / houve trabalho fora do comercial | **62** |
| Concordância geral (963 tickets com chat) | **92,8%** |

Sensibilidade da tolerância: 0 min → 509 · **5 min → 450** · 30 min → 310.

Os 62 são plantão que aconteceu e ninguém registrou, em um único mês. É o ganho
principal da entrega, junto com parar de digitar 175 correções por mês.

## Desenho

### 1. Cadastro

Em `configuracoes` (tenant):

- `horario_comercial` `jsonb` — **mesmo formato** de `business_hours`
  (`{"mon":{"active":true,"slots":[{"start":"08:00","end":"12:00"},{"start":"13:30","end":"18:18"}]}, ...}`).
  O formato já aceita múltiplos slots, então o almoço da ASP entra sem campo novo.
- `horario_comercial_enabled` `boolean` default `false`.

UI: Configurações → Horário/Plantão (`HorarioPlantaoTab.tsx`), nova seção logo abaixo
da grade que já existe, reaproveitando o mesmo editor de dias. **Sem o seletor
Global/setor** — nível tenant apenas.

**Renomeação de rótulos** (aprovada pelo owner; só texto, nenhum dado muda). A tela
tinha três seções e a chamada "Plantão" não fala de horário — é o escalonamento on-call
(telefone, template, palavras-chave de urgência). Sem renomear, o usuário procuraria a
régua de plantão dentro dela e não acharia:

| Hoje | Passa a ser |
|---|---|
| Horário de Atendimento | Disponibilidade de atendimento |
| *(nova)* | Horário comercial |
| Plantão | Escalonamento de plantão |

Os rótulos de toast em `useSectionSave` acompanham (`"Horário de Atendimento"`,
`"Plantão"`).

**Fallback:** `horario_comercial_enabled = false` → a classificação usa
`business_hours`, exatamente como hoje. Os outros 12 tenants não mudam nada até
preencherem a tela.

### 2. Régua

Funções novas, irmãs das que existem:

- `fn_janela_comercial_do_dia(p_tenant_id, p_at)` → `(abre, fecha)`. Espelha
  `fn_expediente_janela_do_dia`, incluindo a cascata de feriado
  (`business_hours_exceptions` → `tenant_holiday_template` → dia normal), mas lendo
  `configuracoes.horario_comercial`. Sem parâmetro de setor. Cai em
  `fn_expediente_janela_do_dia` quando `horario_comercial_enabled = false`.
- `fn_instante_fora_comercial(p_tenant_id, p_at, p_tolerancia_min default 5)` →
  `boolean`. Aritmética em **segundos com clamp em [0, 86399]**, como a atual — `'23:45'
  + 30min` daria a volta em 00:15 e marcaria o dia inteiro como fora.

Alteração cirúrgica: `fn_atendimento_plantao_em` troca as três chamadas a
`fn_instante_fora_expediente` por `fn_instante_fora_comercial` e o default de
`p_tolerancia_min` vai de 30 para 5. As fontes de instante não mudam (`assumed_at`,
`first_human_response_at`, mensagens com `sent_by_user_id`, todas recortadas por
`[opened_at, closed_at]`).

`fn_instante_fora_expediente` e `fn_expediente_janela_do_dia` **não são tocadas** —
`get_atendimento_volume` e a coluna de latência da aba Agentes continuam nelas.

### 3. Ticket

`check_tipo_horario` passa a usar a janela comercial. A âncora sai de "abertura do
chat" e passa a ser o instante de trabalho: quando o atendimento tem `plantao_em`
preenchido, o modal sugere `plantao` e **já preenche `horario_inicio` com esse
instante** — hoje o operador digita isso 175 vezes por mês.

`trg_zz_set_plantao` é `BEFORE UPDATE` (não `INSERT`), então `plantao_em` fica fresco
durante o atendimento — mas pode estar nulo num ticket aberto no meio da conversa,
antes do primeiro UPDATE. Nesse caso o modal cai em `check_tipo_horario` no instante
atual, já pela janela comercial. Ticket aberto no meio da conversa e chat fechado
depois podem divergir, e isso é aceito: o ticket é declaração, não medição.

O modo manual continua: 47 tickets do mês são de telefone, sem chat nenhum.

Arquivos: `src/components/tickets/CreateSupportTicketModal.tsx` (modo auto),
`src/components/tickets/ClassifyClosureModal.tsx` (hoje sem auto-detecção, default
fixo `comercial` — passa a receber a mesma sugestão).

### 4. Aba Tickets

`get_atendimento_taxonomia` ganha `p_plantao` filtrando por
`support_tickets.tipo_horario`. **DROP + CREATE** — parâmetro novo cria sobrecarga e o
PostgREST fica ambíguo. `useAtendimentoTaxonomia.ts` passa o parâmetro e inclui no
`queryKey`.

Armadilha desta RPC: `por_horario` é justamente o gráfico "Comercial × Plantão". Sob
"Só plantão" ele fica com uma barra só — comportamento correto, mas vale conferir na
tela.

### 5. Backfill

Só para tenant com `horario_comercial_enabled = true` — é rotina por tenant, rodada
depois que ele cadastra, não migration global.

Dimensionado na Digi (6.098 atendimentos desde 13/04):

| | |
|---|---|
| Viram `plantao = true` | 1.333 |
| Deixam de ser (`true` → `false`) | 6 |
| Escritas totais | ~1.339 |

**Grava só as linhas que mudam de valor.** `NULL` e `false` se comportam igual para o
filtro, então 4.759 linhas não precisam ser tocadas — o fanout de realtime cai de 6.098
eventos para ~1.339.

Cuidados (`support_attendances` tem 26 triggers e está na publication
`supabase_realtime`):

- `session_replication_role` é **negado** para o papel do MCP. Não há como desligar
  trigger durante a carga.
- `sync_attendance_department` é `BEFORE UPDATE` **sem lista de colunas** e herdaria o
  setor da conversa em linhas com `department_id` nulo. São **14 das 1.333** — ficam de
  fora do backfill, como em 24/08.
- Lotes pequenos, fora do pico.

## Confirmado com o owner

Fim de semana inteiro conta como plantão, inclusive fora da faixa 09–22 que o cliente
citou. Plantão é derivado ("tudo que não é comercial"), então não existe um terceiro
estado "fechado". Levantado explicitamente e aceito.

## Fora de escopo

- Override de horário comercial por setor.
- Reclassificar `tipo_horario` de tickets já criados.
- Abas Tempo Real, Clientes e `chats_timeline`, que ficaram fora do filtro de plantão
  em 24/08 com motivo registrado.

## Testes

- `scripts/sql-tests/`: janela comercial com almoço (ASP) não marca 12:45 como plantão;
  sexta 17:30 na Digi é plantão e quinta 17:30 não é; sábado inteiro é plantão; 18:04 é
  comercial e 18:06 é plantão (tolerância de 5 min); tenant sem cadastro se comporta
  exatamente como hoje.
- Invariante do filtro: `get_atendimento_taxonomia` sob "Só plantão" não traz ticket
  `comercial`, e o inverso — no molde de
  `scripts/sql-tests/43_chats_lista_bate_com_total.sql`. **Conferir que o assert vê
  vermelho** comparando recortes diferentes de propósito.
- Ao adicionar `p_plantao` ao hook, atualizar o mock de `useAtendimentoFilter` nos
  testes — `toEqual` ignora propriedade `undefined` e o assert passa à toa.
