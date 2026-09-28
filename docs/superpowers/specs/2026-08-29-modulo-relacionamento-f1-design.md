# Módulo Relacionamento — F1 "Destravar"
## Design aprovado · 29/08/2026

**Fonte:** *Módulo Relacionamento — DoctorSaaS · Documento único de contexto e especificação funcional v1.0 (29/08/2026)*, que consolida o Playbook Operacional Multiplica ASP v1.0 e o documento de Identidade e Personalidade. Referências neste spec no formato `(doc cap. X)`.

**Escopo desta spec:** apenas a **F1** do cap. 17. As fases F2–F5 aparecem só na matriz de cobertura (§12), para garantir que nada do documento se perca.

**Estado:** design aprovado pelo Alexandre em 29/08/2026. Nenhuma linha de código escrita. Nenhuma migration aplicada.

---

## 1. Por que a F1 existe

O programa anterior não morreu por falta de ferramenta: morreu por falta de resposta (doc cap. 3.3). A F1 é a única fase que ataca isso — ela entrega o mecanismo que torna o silêncio visível e impede que ele se repita. O passivo de 24 registros antigos entra como histórico consultável, não como fila de trabalho (§7).

Requisito funcional nº 1 do módulo, que a F1 precisa garantir:

> Nenhuma indicação passa **15 dias** sem que o Multiplicador receba uma mensagem de status. Nenhuma passa **45 dias** sem desfecho.

---

## 2. Decisões

### 2.1 Tomadas nesta sessão

| # | Decisão | Consequência |
|---|---|---|
| D1 | **Módulo vendável desde já** (resolve doc 19.3) | Multi-tenant real, não só RLS. Nenhuma regra do Multiplica ASP em código |
| D2 | **Tudo vira dado; critérios de elegibilidade como catálogo em código com parâmetros em tabela** (resolve doc 19.5, contra a recomendação do próprio documento) | `rel_criterios.sql_predicado` do doc 7.4 **não será criado**. As ~10 travas são implementadas em código; só os parâmetros (90 dias, 48h, 30 dias) ficam em tabela. Evita SQL de admin de tenant executado server-side sobre a base de clientes, num repositório público |
| D3 | **Toque sai 1:1 pelo chat de WhatsApp que já existe** | F1 não constrói `rel_outbox`, não precisa de throttle nem da decisão 19.2. Grava `mensagem_id` real |
| D4 | **Três pontos de entrada da indicação:** manual (ficha do cliente e tela do módulo), a partir do atendimento de WhatsApp, e a partir do cadastro de venda (retroativo) | Leitura por IA das conversas fica fora. Ver §8 |
| D5 | **Indicação retroativa não entra nas taxas** (`registro_retroativo`) | Conta na receita e na recompensa; fica fora de taxa de conversão e tempo médio. Sem isso, capturar os 367 clientes sem origem cria um funil fictício (risco #7 do Anexo D) |
| D6 | **Validade de 90 dias tira o direito à recompensa, não a indicação do funil** (doc cap. 1 e Anexo B) | A indicação continua trabalhável. Se fechar no dia 100, não gera recompensa. **O Multiplicador é avisado quando o prazo vence** — não pode descobrir no dia da venda |
| D7 | **A Fase 0 manual espera a F1** | A migração entrega os 24 toques vencidos como fila real. Nenhum campo de "já tratado fora do sistema" é necessário |
| D8 | **O tipo `indicacao` de `cs_tickets` é desativado após a migração** (resolve doc 19.6) | Sai da UI e é recusado no back. O enum permanece para o histórico. Sem alternativa técnica defensável — duas fontes de verdade para indicação é o pior resultado possível (doc 4.1 aviso 2) |
| D9 | **Os 24 registros antigos entram como HISTÓRICO, sem movimento** (decisão do Alexandre, 29/08 — contraria o doc 7.10 item 3) | Nenhum `rel_toques` é criado na migração. Nada sai para Multiplicador nem para indicado. Eles ficam fora do pipeline e fora de todos os indicadores. A Head de CS reativa individualmente o que valer a pena |
| D10 | **As 4 vendas antigas sem retribuição são só registro** | Ficam marcadas no histórico como "venda por indicação sem retribuição". **Não** viram `rel_recompensas`, não entram na fila do Financeiro, não geram alerta e não contam no custo do programa. Se a Direção decidir retribuir, a Camila reativa aquele registro |

### 2.2 Ainda em aberto — não inventar resposta

| # | Decisão | Trava qual fase | Comportamento até lá |
|---|---|---|---|
| 19.1 | **Inadimplência.** Não existe fonte de "adimplente" no projeto `vbngjzovjhkmietztffo`. Opções: integrar contas a receber do Omie (`vqrytdntynxuqozehals`), flag manual do Financeiro, ou remover a trava | F2 | Trava fica **desligada e sinalizada na tela**, como o documento determina |
| 19.2 | **Instância WhatsApp:** dedicada ou compartilhada com o suporte | F3 (NPS) e F4 (campanhas) | Não afeta a F1: o toque sai pela instância que já atende aquele cliente |
| 19.4 | **E-mail:** provedor e domínio a autenticar | F5 | Canal `email` modelado, não implementado |
| 19.7 | **Natureza da recompensa.** A pesquisa telefônica com 50 clientes da Fase 0 ainda não aconteceu | F4 (a fila do Financeiro) | Na F1, `rel_recompensas` existe só como registro de dívida. `rel_recompensa_catalogo` **não** é criada ainda |

### 2.3 Discordâncias registradas do documento

**a) O indicador principal é zerável por dentro.** O doc 10.2 afirma que "sem retorno há 15+ dias = 0" significa programa saudável. Não significa: basta enviar T3 "ainda não temos novidade" a cada 15 dias para o número ficar em zero com a indicação parada há 154 dias — que é literalmente o estado de hoje. Ele mede educação, não progresso.

**Decisão:** a home mostra **dois** números, lado a lado:
- `sem_retorno_15d` — a promessa ao cliente (o do documento)
- `sem_movimento_15d` — indicações sem mudança de estágio há 15+ dias (o travamento real)

O segundo é o que teria acendido em fevereiro de 2026. Custo: uma coluna a mais na mesma RPC agregadora.

**c) A F3 dispara em massa antes de a F4 construir o freio** (correção de sequenciamento). O cap. 17 põe o NPS na F3 — envio em lotes de 150/dia para ~750 clientes — e o `rel_outbox` com throttle, janela horária, warm-up, opt-out e kill switch só na F4. Mas o cap. 12.3 enfileira os convites de NPS **no próprio `rel_outbox`**. Do jeito escrito, a F3 dispararia 750 mensagens por API não oficial sem throttle, sem opt-out e sem botão de parar — o risco que o cap. 13.1 manda tratar como código, e um problema de LGPD além do de bloqueio de número.

**Decisão:** a infra de saída (outbox, throttle, janela, warm-up, opt-out, kill switch) sai da F4 e passa a ser a **primeira metade da F3**, antes do NPS. A F4 fica com templates, IA, campanhas e a fila de recompensas, herdando a infra pronta.

**b) A trava 7 come o grupo A** (para a F2, anotado aqui para não virar bug de regra). "Já abordado nos últimos 90 dias e não indicou" (doc 8.2 #7) bloqueia por 90 dias; o grupo A prevê contato ativo a cada 90 dias (doc 8.3). Um Multiplicador abordado que não indicou naquela vez fica permanentemente na borda do bloqueio. Precisa de exceção explícita para o grupo A, ou de janela diferente.

---

## 3. O dado real (medido em produção, 29/08/2026)

Tenant ASP `a0000000-0000-0000-0000-000000000001`. Confirma o doc 3.3 e acrescenta três fatos que ele não registra.

| Medida | Valor |
|---|---|
| `cs_tickets` com `tipo='indicacao'` | 24, entre 03/02/2026 e 19/05/2026, só no tenant ASP |
| Clientes distintos que indicaram | 15 |
| Sem desfecho de indicação / com desfecho | **16 / 8** (4 `fechou`, 4 `nao_fechou`) |
| **Tickets com `status='concluido'`** | **21 dos 24**, incluindo 10 das 11 `enviada_ao_comercial` |
| **Sem `cliente_id`** | **7** — e **nenhum** deles tem `contato_externo_nome` |
| **Sem telefone do indicado** | **6** · sem cidade: 2 |
| `owner_id` preenchido | 22 dos 24 |
| Indicadores com telefone / já cancelados | 15 de 15 / 2 |
| **Indicadores com conversa de WhatsApp aberta** | **10 de 15** |
| Tabelas `rel_*` ou `nps_*` já existentes | nenhuma |

**O que isso muda:**

1. Ninguém deixou nada "em aberto". Fecharam o chamado e deixaram a indicação sem desfecho — é pior que parado, foi dado por encerrado. **O critério da migração é `indicacao_status`, nunca o status do ticket.**
2. Existem 7 indicações — algumas em `fechou` — em que a ASP **não sabe a quem retribuir**. Não há rastro nenhum.
3. Para 5 dos 15 indicadores, o envio do toque precisa abrir conversa de WhatsApp.

---

## 4. Modelo de dados da F1

Prefixo `rel_`. Todas com `tenant_id uuid not null`, RLS por tenant com `OR public.is_super_admin()`, `created_at`/`updated_at`, auditoria por `audit_events`.

### 4.1 Pipeline

```
rel_pipelines      id, tenant_id, nome, slug, descricao, tipo, ativo, position,
                   prazo_desfecho_dias, alerta_sem_toque_dias
rel_stages         id, tenant_id, pipeline_id, nome, slug, position, cor,
                   sla_minutos, is_initial, is_final, is_ganho, is_perda,
                   inicia_sla, encerra_sla, pausa_sla, visible_sections,
                   exige_campos jsonb, exige_toque text, ativo
rel_stage_history  id, tenant_id, indicacao_id, stage_from, stage_to,
                   moved_by, moved_at, motivo, sla_estourado
```

Nomes copiados de `onboarding_stages` (verificado em produção: `slug`, `position`, `cor`, `sla_minutos`, `is_initial`, `is_final`, `inicia_sla`, `encerra_sla`, `pausa_sla`, `visible_sections` existem lá com esses nomes) — para não criar um segundo vocabulário dentro do mesmo produto (doc 4.1 decisão 1).

**`prazo_desfecho_dias` (45) e `alerta_sem_toque_dias` (15) são colunas, não constantes** — exigência de D1.

Seed do pipeline do tenant ASP (doc 7.1):

| # | slug | SLA | Obrigação para sair |
|---|---|---|---|
| 1 | `recebida` | — | T1 enviado em até 24h |
| 2 | `contatada` | 24h úteis | registro do 1º contato com o indicado |
| 3 | `qualificada` | 24h | checklist de qualificação + T2 |
| 4 | `enviada_comercial` | imediato | responsável comercial atribuído |
| 5 | `em_negociacao` | 45 dias | atualização a cada 48h; T3 a cada 15 dias |
| 6 | `fechou` (`is_ganho`) | — | cliente vinculado + origem + T4 + recompensa aberta |
| 7 | `nao_fechou` (`is_perda`) | — | motivo + T4 |

### 4.2 Indicações e Multiplicadores

```
rel_indicacoes      id, tenant_id, codigo, pipeline_id, stage_id, stage_since,
                    multiplicador_id NULLABLE -> rel_multiplicadores,
                    atribuicao (multiplicador|interna|parceiro),
                    indicado_nome, indicado_telefone, indicado_cidade_id,
                    indicado_empresa, indicado_contexto,
                    origem_captacao, gatilho_id, abordagem_id,
                    conversa_id, mensagem_origem_id,
                    cs_owner_id, comercial_owner_id,
                    qualificacao jsonb, motivo_desqualificacao,
                    cliente_gerado_id, contrato_id, valor_ativacao, valor_mrr,
                    data_registro, data_desfecho, prazo_validade,
                    ultimo_toque_em, proximo_toque_em,
                    registro_retroativo, dados_incompletos,
                    pendente_identificacao, cs_ticket_origem_id
rel_multiplicadores id, tenant_id, cliente_id NULLABLE, pessoa_nome,
                    pessoa_telefone, pessoa_email, tipo (cliente|ex_lead|outro),
                    primeira_indicacao_em, total_indicacoes, total_vendas,
                    selo, recorrente, opt_out, opt_out_motivo, opt_out_em,
                    observacao
```

**Diferenças em relação ao doc 7.2, com motivo:**

- `multiplicador_id` é **nullable**. Sem isso, os 7 registros históricos sem `cliente_id` sumiriam na migração ou virariam Multiplicador falso. Ver §7.
- `atribuicao` vem do Anexo C e ficou de fora do 7.2. É o que separa Multiplica ASP de Indicação Interna e de Indicação Parceiro (doc 9.1).
- `conversa_id` / `mensagem_origem_id` — rastro do ponto de entrada "atendimento de WhatsApp" (D4).
- `registro_retroativo` — D5.
- `dados_incompletos`, `pendente_identificacao` — dívida do dado migrado, ver §7.

`rel_multiplicadores` continua separado de `clientes` porque o playbook aceita indicação de ex-lead, que não tem `clientes.id` (doc 7.2). Para cliente, `cliente_id` é o vínculo direto e é por ele que a ficha do cliente lista as indicações.

### 4.3 Toques

```
rel_toques       id, tenant_id, indicacao_id, tipo, canal, status,
                 previsto_para, enviado_em, enviado_por, template_id,
                 conteudo_final, mensagem_id, conversa_id
rel_toque_regras id, tenant_id, pipeline_id, tipo, gatilho, stage_id,
                 offset_horas, intervalo_dias, canal_obrigatorio,
                 template_id, ativo, position
```

**`rel_toque_regras` não existe no documento.** O doc 7.3 escreve a cadência como regra fixa ("ao criar → T1 em 24h", "T3 a cada 15 dias", "T4 obrigatoriamente por ligação"). Com D1, ela precisa ser dado — senão o segundo tenant não consegue mudar prazo nem canal sem deploy, e o módulo não é vendável.

`gatilho` ∈ `ao_criar | ao_entrar_stage | recorrente_enquanto_aberto | ao_desfecho`.

Seed do tenant ASP, reproduzindo o doc 7.3:

| tipo | gatilho | parâmetro | canal |
|---|---|---|---|
| T1 | `ao_criar` | +24h | whatsapp |
| T2 | `ao_entrar_stage` (`contatada`) | +72h do registro | whatsapp |
| T3 | `recorrente_enquanto_aberto` | a cada 15 dias | whatsapp |
| T4 | `ao_desfecho` | imediato | **ligacao (obrigatório)** |

### 4.4 Templates

```
rel_templates        id, tenant_id, nome, slug, canal, categoria, assunto,
                     corpo, variaveis jsonb, gerado_por_ia, aprovado,
                     aprovado_por, aprovado_em, versao, ativo
rel_template_versoes id, template_id, versao, corpo, criado_por, criado_em
```

Antecipadas da F4 porque sem elas não há rascunho de toque. Na F1: **sem geração por IA** (fica na F4, junto dos guardrails do doc 14.1) e **com** o modal das 4 perguntas do doc 14.2 — `aprovado` só vai a `true` por usuário com permissão, através dele. Seed: os scripts do Anexo A que a F1 usa (T1–T4, A.9).

### 4.5 Recompensas (só o registro)

```
rel_recompensas  id, tenant_id, indicacao_id, multiplicador_id, tipo, descricao,
                 valor_custo, status, prazo_ate, aprovada_por, entregue_por,
                 entregue_em, confirmada_em, comprovante_url, observacao
```

Antecipada da F4 **só como registro de dívida**, e apenas para indicações NOVAS: a transição para `fechou` exige "recompensa aberta" (doc 9), e sem a tabela essa regra fica órfã. As 4 vendas antigas **não** entram aqui (D10) — ficam marcadas no histórico. A fila do Financeiro, o catálogo e a tela continuam na F4. Validação `valor_custo <= 500` já entra (doc 4 decisão 6), como parâmetro do tenant, não constante.

### 4.6 Acesso

- `tenants.relacionamento_enabled boolean default false` — mesmo padrão de `onboarding_enabled` e `acessofast_enabled`, ambos já existentes.
- `useRelacionamentoAccess` + `RelacionamentoGuard`, cópia de `useOnboardingAccess` / `OnboardingGuard`.
- `resources` + `role_permissions` novos: `relacionamento.pipeline`, `relacionamento.toques`, `relacionamento.config`.

---

## 5. Motor de pipeline

RPC `mover_indicacao_stage`, espelhando `move_onboarding_stage`. Ela valida `exige_campos` e `exige_toque` do estágio de destino e **recusa com o motivo**; o botão na tela fica desabilitado com o motivo à vista, em vez de mover e cobrar depois (doc cap. 9).

Transições e exigências: doc cap. 9, tabela completa. Mais:

- **Tentativas sem resposta** (doc 9, 10.1 do playbook): após 3 tentativas em 5 dias úteis sem resposta do indicado, o card volta para o CS com a ação "pedir ajuda ao Multiplicador". É um estado que o pipeline representa, não um texto de processo.
- **Regras de atribuição** (doc 9.1), todas validadas pelo sistema: duplicidade vale o primeiro registrado (data/hora) e o segundo dispara agradecimento explicando; indicado já no funil não vale, detectado por telefone/CNPJ contra `clientes` e contra indicações abertas; colaborador da ASP entra como `atribuicao='interna'` e não gera recompensa; parceiro (Hiper, Zetta, Comanda 10, revendas) entra como `atribuicao='parceiro'` e não é Multiplica ASP; ex-lead vale (`tipo='ex_lead'`); Multiplicador que cancela antes da venda continua com recompensa devida; indicado que cancela em menos de 90 dias não faz a recompensa ser retirada.
- **Prazo de validade (D6):** ao atingir `prazo_validade`, a indicação continua no funil e perde o direito à recompensa. Gera um toque de aviso ao Multiplicador. Não expira sozinha.

Padrão de RPC nova, obrigatório no projeto: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE FROM PUBLIC` + `GRANT TO authenticated, service_role`, e aceitar `p_tenant_id` explícito para quando o super admin simula tenant.

---

## 6. Motor de toques

**Geração:** trigger na criação da indicação e na transição de estágio, lendo `rel_toque_regras`. Um cron cuida do T3 recorrente e de marcar vencidos.

**Envio (D3):** pelo chat que já existe, via `send-whatsapp-message`, na instância que já atende aquele cliente. Para os 5 indicadores sem conversa, abre conversa com `findOrCreateContact` / `findOrCreateConversation` (`supabase/functions/_shared/message-processor.ts`), mesmo caminho já usado por `send-whatsapp-template`.

O envio cria atendimento (`ensureAttendanceForOperatorMessage`), e isso é correto: o Multiplicador vai responder e alguém precisa atender. Duas travas:

1. **Se já houver atendimento vivo, o toque só escreve na conversa** — não mexe em setor, não mexe em responsável, não reatribui. Foi exatamente assim que a cobrança sequestrou atendimento antes.
2. **T4 não envia nada.** É ligação (doc 7.3: "no desfecho se liga, não se manda mensagem"). O CS registra data e quem ligou; sem esse registro a indicação não encerra.

Isto **não** é o cenário do doc 12.4: são mensagens 1:1 para clientes que já conversam com a ASP, não 750 disparos de pesquisa.

**Cobrança de atraso:** pela infra de notificação existente (`notification_event_types`, `notifications`, `notification_dispatch_queue`), sem criar mecanismo novo.

| Evento | Destino |
|---|---|
| Toque vencido | CS responsável |
| `alerta_sem_toque_dias` (15) sem toque | Direção |
| `prazo_desfecho_dias` + 1 (46) sem desfecho | Direção + exigência de ligação |

Se a notificação sair por WhatsApp, respeita `is_wa_quiet_hours()` — fonte única, não duplicar a lógica.

---

## 7. Migração dos 24 registros — como histórico, sem movimento

Única vez em que `cs_tickets` é tocado. **O módulo não usa ticket em nenhum fluxo corrente.**

O doc 7.10 item 3 manda criar os toques das indicações migradas como "pendentes e vencidos", para que a Fase 0 vire fila. **Essa parte foi revertida (D9).** Motivo: enviar hoje um T1 sobre uma indicação de fevereiro, a um Multiplicador que já desistiu de esperar, é pior que o silêncio — e nenhum dos 24 registros carrega contexto suficiente para uma mensagem que não soe automática.

**O que a migração faz:**

| | |
|---|---|
| Estado | Entram como **histórico**: sem estágio ativo, sem SLA correndo, fora do pipeline |
| Toques | **Nenhum `rel_toques` é criado.** Nada sai para Multiplicador nem para indicado |
| Indicadores | **Não entram** no funil, no `sem_retorno_15d` nem no `sem_movimento_15d`. Contam só como total do histórico |
| Onde aparecem | Painel próprio, "Registros anteriores ao programa", com quem indicou (quando se sabe), o indicado, o status em que parou e a idade real |
| Recompensas | As 4 vendas sem retribuição ficam **marcadas** ali (D10). Não viram `rel_recompensas` |

**Reativação.** Ação individual, restrita ao papel **head**. A Camila escolhe o estágio em que a indicação entra no pipeline, e o relógio começa **a partir da reativação** — o T1 é gerado dali, nunca retroativamente. O card guarda o rastro de que veio do histórico (`cs_ticket_origem_id` e a data original).

**Os defeitos do dado histórico são preservados como estão, sem inventar valor:**

| Caso | Qtd | Como fica |
|---|---|---|
| Sem `cliente_id` e sem `contato_externo_nome` | 7 | `pendente_identificacao=true`. Não se sabe quem indicou; nenhum Multiplicador é criado para eles. **1 desses 7 está entre as 4 que fecharam** — venda por indicação sem ninguém a quem retribuir |
| Sem telefone do indicado | 6 | `dados_incompletos=true`. Na reativação, a transição para `contatada` exige completar |
| Sem cidade | 2 | Mesma flag |

**Demais passos:**

1. Até 15 `rel_multiplicadores` a partir dos clientes distintos, com `primeira_indicacao_em`, `total_indicacoes`, `total_vendas` e `recorrente` calculados. Os 2 já cancelados entram normalmente (doc 9.1).
2. `cs_owner_id` a partir de `cs_tickets.owner_id → funcionarios` (preenchido em 22 dos 24), como informação do histórico.
3. Status original preservado como texto no registro (`qualificada`, `enviada_ao_comercial`, `fechou`, `nao_fechou`, sem status), para a Camila decidir a reativação com o dado à vista.
4. `cs_ticket_origem_id` guarda o rastro. **A migração é idempotente.**
5. `tipo='indicacao'` sai da UI do CS e passa a ser recusado no back (D8). O enum permanece.

**Como o dia 1 fica:** o módulo abre **zerado** — indicador em 0, pipeline vazio, nenhuma mensagem pendente. Ao lado, um painel com os 24 registros antigos e o botão de reativar. O programa começa limpo, e o indicador só volta a ter sentido a partir da primeira indicação nova.

---

## 8. Telas e pontos de entrada

```
/relacionamento
├── /                    Visão geral: sem_retorno_15d E sem_movimento_15d em destaque,
│                        com o nome de quem está devendo o toque
├── /indicacoes          Kanban + lista, filtros, SLA visível, idade do card
│   └── /:id             Ficha: linha do tempo, toques, qualificação, desfecho, recompensa
└── /config              Pipeline e estágios, regras de toque, templates
```

**Três pontos de entrada da indicação (D4):**

| Caminho | Onde | O que grava |
|---|---|---|
| Manual | Aba **Relacionamento** na ficha do cliente, e tela do módulo | `origem_captacao`, contexto, Multiplicador |
| Do atendimento | Botão dentro do chat de WhatsApp — dialog próprio, grava direto em `rel_indicacoes` | + `conversa_id`, `mensagem_origem_id`; cliente e contexto pré-preenchidos |
| Do cadastro de venda | "Quem indicou" obrigatório quando `origem_venda_id` = "Indicação de Cliente" | + `cliente_gerado_id`, `contrato_id`; nasce em `fechou`, `registro_retroativo=true`, recompensa `devida` |

Nenhum deles abre ticket. O Suporte continua sem **pedir** indicação (doc cap. 2) — ele apenas registra a que o cliente deu, o que o doc cap. 9 já autoriza ("— → recebida: CS / Suporte / Comercial").

Fora da F1: `/fila`, `/multiplicadores`, `/carteira`, `/campanhas`, `/nps`, `/templates`, `/recompensas`, `/automacoes`.

---

## 9. Segurança e multi-tenant

- `tenant_id` obrigatório e RLS em todas as tabelas `rel_*`, com `OR public.is_super_admin()` em toda policy que use `profiles.tenant_id`.
- Queries do frontend sempre com `.eq('tenant_id', tid)` explícito via `useTenantFilter` — performance/índice; a segurança é o RLS.
- Tabela de volume (`rel_stage_history`, `rel_toques`) → `fetchAllRows()`. Canal Realtime, se houver → `subscribeSharedChannel()`.
- Telefone → `normalizeBRPhone` / `phoneSearchVariants` do `_shared/phone.ts`.
- Função nova nasce aberta para `authenticated`: revogar explicitamente o que não deve ficar exposto.
- Nenhum segredo em código, migration ou seed — o repositório é público.

---

## 10. Indicadores que a F1 entrega

Uma RPC agregadora, nunca N queries no client (doc 10.4).

`sem_retorno_15d` · `sem_movimento_15d` (§2.3a) · indicações por estágio · idade média por estágio · SLA estourado por estágio · toques vencidos por responsável · recompensas devidas e vencidas.

Todos contam **apenas indicações vivas**. Os 24 registros históricos ficam de fora até serem reativados (D9); o painel do histórico traz a contagem deles em separado.

Os 14 indicadores mensais e o funil de 8 etapas do doc cap. 10 ficam na F3, porque dependem de `rel_abordagens` e `rel_elegibilidade`.

---

## 11. Pré-requisito bloqueante do go-live da F1

**Corrigir o cadastro de CS antes de subir.** Hoje `funcionarios`/`profiles` mostram Camila como "Comercial" e Selena como "SDR", e os únicos registros com cargo de CS estão inativos (doc cap. 2).

Deixou de ser recomendação e virou bloqueio com a D9: **reativar um registro do histórico é permissão de `head`**. Com a Camila cadastrada como está, ela não enxerga o botão — e ela é justamente quem decide o que reativar. Some-se a isso que a F1 grava `cs_owner_id` e mede toque por responsável: subir com o cadastro errado faz o primeiro relatório nascer errado.

São dois registros para arrumar.

---

## 12. Matriz de cobertura do documento

Garantia de que nada se perdeu. Cada item do documento e sua fase.

| Doc | Item | Fase |
|---|---|---|
| 5.1 #1 | Pipeline configurável com SLA por estágio | **F1** |
| 5.1 #2 | Cadastro e ficha do Multiplicador | tabela na **F1**; telas na F2 |
| 5.1 #3 | Motor de elegibilidade e grupos A/B/C/D | F2 |
| 5.1 #4 | Fila da semana do CS | F2 |
| 5.1 #5 | Registro de abordagem e repique | F2 |
| 5.1 #6 | Toques T1–T4 com rascunho e cobrança | **F1** |
| 5.1 #7 | Recompensas: fila, 15 dias, entrega, confirmação | registro na **F1**; fila e tela na F4 |
| 5.1 #8 | Submódulo NPS | F3 |
| 5.1 #9 | Campanhas e comunicação com a base | F4 |
| 5.1 #10 | Templates com IA e guardrails | templates na **F1**; IA e guardrails na F4 |
| 5.1 #11 | Catálogo fechado de 7 automações | #3, #4, #5 na **F1**; #1, #2, #6 na F2; #7 na F4 |
| 5.1 #12 | Dashboard: funil de 8 etapas, 14 indicadores, metas | F3 |
| 5.1 #13 | Opt-out e lista de não-abordagem | `rel_multiplicadores.opt_out` na **F1**; `rel_optout` na F4 |
| 5.2 | Fora do escopo v1: e-mail em massa, editor livre de automação, portal do cliente, página pública do regulamento, gamificação | — |
| 7.4 | `rel_criterios.sql_predicado` | **substituído** por catálogo em código (D2) |
| 7.10 | Migração obrigatória, 5 passos | **F1** (§7) — itens 3 e 5 revertidos por D9/D10: sem toques vencidos, sem recompensa devida |
| 8.1 | Universo: base ativa, `matriz_id is null` | F2 |
| 8.2 | 10 travas do grupo D | F2 — a #4 (inadimplência) desligada até 19.1 |
| 8.3 | Os 4 grupos e a precedência | F2 |
| 8.4 | Fila da semana, 12 nomes, motivo real | F2 |
| 9 | Regras de transição | **F1** (§5) |
| 9 | Tentativas sem resposta → volta ao CS | **F1** |
| 9.1 | 7 regras de atribuição | **F1** (§5) |
| 10.1 | Funil de 8 etapas | F3 |
| 10.2 | 14 indicadores mensais | F3 — os da F1 em §10 |
| 10.3 | Metas por pessoa; meta de abordagem no mesmo painel da comercial | F3 |
| 10.4 | Uma RPC agregadora, sem N+1 | **F1** e adiante |
| 11 | 7 automações + treinamento concluído | ver 5.1 #11 |
| 12.1–12.3 | NPS: config, fluxo, detrator → ticket, promotor → grupo B | F3 — **depois** da infra de saída, ver §2.3c |
| 12.4 | Captação: interceptação no webhook antes da URA, máquina de 2 passos, parsing tolerante | F3 — depende de 19.2 |
| 13.1 | Throttle, janela horária, warm-up, opt-out, kill switch, rastro, duplicidade | **F3, antes do NPS** (movido da F4 — §2.3c) |
| 13.2 | Tipos de campanha; `pedido_indicacao` **não existe**; 1 campanha de ativação por trimestre | F4 |
| 13.3 | E-mail | F5 — depende de 19.4 |
| 13.4 | LGPD: base legal, aviso ao indicado, retenção, exclusão a pedido | aviso ao indicado na **F1** (script A.10); política de retenção na F4 |
| 14.1 | Vocabulário proibido e oficial | F4 (com a IA) |
| 14.2 | Teste das 4 perguntas na aprovação | **F1** |
| 14.3 | Governança de IA por `ai_settings` | F4 |
| 15 | Mapa de telas | ver §8 |
| 15 | Ficha do cliente → aba Relacionamento | **F1** |
| 15 | Suporte → "Sinalizar oportunidade ao CS" | F2 |
| 15 | Cadastro de venda → "Quem indicou" obrigatório | **F1** (D4) |
| 16 | RLS, RBAC, whitelist server-side, vault | **F1** (§9) |
| 17 | Fases F1–F5 | esta spec = F1 |
| 18 | Dimensionamento: R$ 44 mil no ano 1 | aposta declarada = produto (D1) |
| 19.1 / 19.2 / 19.4 / 19.7 | Em aberto | §2.2 |
| 19.3 / 19.5 / 19.6 | Resolvidas | D1 / D2 / D8 |
| Anexo A | 11 scripts | A.9 (toques T1–T4) e A.10 na **F1**; os demais na F2/F4 |
| Anexo B | Regulamento em uma página | texto na F4 (tela de config); as regras aplicáveis já valem na **F1** |
| Anexo C | Enums | os da F1: `rel_stage_slug`, `rel_toque_tipo`, `rel_canal`, `rel_multiplicador_tipo`, `rel_atribuicao`, `rel_recompensa_status` |
| Anexo D #1 | Silêncio pós-indicação | **F1** — é a fase inteira |
| Anexo D #2 | Virar "indique e ganhe" | teto na **F1**; tipos de campanha e vocabulário na F4 |
| Anexo D #3 | Pedido fora de hora | F2 e F4 |
| Anexo D #4 | Programa cede à meta comercial | F3 |
| Anexo D #5 | Virar campanha de fim de mês | F4 |
| Anexo D #6 | Voz de marketing | teste das 4 perguntas na **F1**; guardrails na F4 |
| Anexo D #7 | Medir errado | `registro_retroativo` na **F1** (D5); funil na F3 |

---

## 13. Riscos da F1

| Risco | Mitigação |
|---|---|
| Enviar toque mexe em atendimento vivo e sequestra setor/responsável | Trava explícita: com atendimento vivo, o toque só escreve na conversa (§6) |
| Os 7 sem Multiplicador viram cadastro falso para "fechar" a migração | `pendente_identificacao`; nenhum Multiplicador é criado sem origem (§7) |
| Migração dispara mensagem sobre indicação de 5 meses atrás | Nenhum toque é criado na migração; só a reativação pela head gera toque (D9) |
| NPS dispara 750 mensagens sem throttle nem opt-out | Infra de saída movida para antes do NPS (§2.3c) |
| Indicação retroativa infla o funil | `registro_retroativo` fora das taxas (D5) |
| O indicador principal é zerado por T3 automático sem progresso | Segundo indicador `sem_movimento_15d` (§2.3a) |
| Meta por pessoa medida com cargo errado | Pré-requisito de go-live (§11) |
| Migration aplicada sem revisão | Regra da casa: SQL proposto + comportamento + alternativas, aprovação, então executa |

---

## 14. Pendência de versionamento

O documento-fonte v1.0 chegou como PDF no chat e **ainda não está no repositório**. Salvar o `.md` original em `docs/relacionamento/multiplica-asp-modulo-v1.md` para que este spec pare de depender de anexo de conversa.
