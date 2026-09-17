-- DEM-0410 | Automações do atendimento: modelo de dados
--
-- Bloco 1 de 3. Este arquivo é ADITIVO e INERTE: cria as duas tabelas, as
-- policies e a linha do catálogo de RBAC. Nada passa a acontecer com chat
-- nenhum até o bloco 2 (o motor) ser aplicado. É de propósito: dá para subir
-- isto em produção em qualquer horário e conferir o resultado sem risco.
--
-- DESENHO, em uma linha: a regra é avaliada NA HORA em que o chat entra, por
-- `now() between starts_at and ends_at`. Não existe cron para "desativar
-- automação vencida", porque não é preciso: uma janela vencida simplesmente
-- deixa de casar. Um agendador aqui só acrescentaria um ponto de falha (cron
-- parado = regra de falta valendo no dia seguinte).
--
-- COMO SE ENCERRA UMA REGRA
--   Temporária, antes da hora .... update ... set ends_at = now()
--   Fixa ......................... update ... set is_active = false
-- Uma coluna `ended_at` separada faria a janela ter duas fontes de verdade.
--
-- lock_timeout: as 3 FKs (tenants, support_departments, whatsapp_instances)
-- pegam ShareRowExclusive nas tabelas referenciadas, que conflita com o
-- ROW EXCLUSIVE de qualquer INSERT/UPDATE. Em `whatsapp_instances` isso é
-- tráfego real (status de conexão). A transação é curta, mas se ela não
-- conseguir o lock em 5s é melhor desistir do que entrar na fila na frente
-- da operação. Ver o post-mortem do deadlock de 23/08/2026.

begin;

set local lock_timeout = '5s';

-- ─── A regra ────────────────────────────────────────────────────────────────

create table if not exists public.automation_rules (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  name                 text not null,
  is_active            boolean not null default true,

  -- Janela de vigência. AMBOS nulos = regra fixa (vale sempre que ativa).
  -- `starts_at` nulo com `ends_at` preenchido = "vale desde já até tal hora".
  starts_at            timestamptz,
  ends_at              timestamptz,

  -- ─── Condição ───
  -- Por ora só 'chat_inbound'. O gatilho "setor ficou sem agente disponível"
  -- é a evolução natural do caso do Financeiro (hoje o chat só empilha na fila
  -- com last_queue_reason='no_eligible_agents'), mas entra depois, junto com o
  -- ponto do motor que o detecta.
  trigger_event        text not null default 'chat_inbound',

  -- Casa quando o chat ia para este setor (o que a URA ou o roteamento por
  -- instância decidiu). Nulo = qualquer setor.
  match_department_id  uuid references public.support_departments(id) on delete cascade,

  -- Casa quando o chat ia para esta pessoa. Guarda `profiles.user_id`, não
  -- `profiles.id` — e sem FK, igual a `assignment_rules.fixed_agent_id`.
  -- "Ia para esta pessoa" hoje significa: a regra de atribuição do setor é
  -- 'fixed' nela. Instância pessoal (`whatsapp_instances.default_operator_id`)
  -- NÃO passa pelo motor e por isso não é coberta ainda.
  match_agent_id       uuid,

  -- Canal (número de WhatsApp). Nulo = qualquer canal.
  match_instance_id    uuid references public.whatsapp_instances(id) on delete cascade,

  -- ─── Ação ───
  --   route_to_department: entra na FILA do setor destino e a regra de
  --     atribuição dele escolhe o agente (respeitando presença e capacidade).
  --   route_to_agent: vai DIRETO para a pessoa. A intenção é explícita, então
  --     ignora capacidade; o motor só confere que o perfil está ativo.
  action               text not null,
  target_department_id uuid references public.support_departments(id) on delete cascade,
  target_agent_id      uuid,

  -- Menor número vence quando duas regras casam com o mesmo chat.
  priority             integer not null default 100,

  -- ─── Auditoria ───
  applied_count        integer not null default 0,
  last_applied_at      timestamptz,
  created_by           uuid default public.fn_acting_user(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint chk_automation_rules_trigger
    check (trigger_event in ('chat_inbound')),

  constraint chk_automation_rules_action
    check (action in ('route_to_department', 'route_to_agent')),

  -- Ação e destino têm de combinar, e o destino não usado fica nulo: sem isto
  -- uma regra pode gravar os dois e o motor precisaria de um critério de
  -- desempate que ninguém configurou.
  constraint chk_automation_rules_action_target
    check (
      (action = 'route_to_department' and target_department_id is not null and target_agent_id is null)
      or
      (action = 'route_to_agent' and target_agent_id is not null and target_department_id is null)
    ),

  -- Sem nenhuma condição, a regra engoliria TODO chat do tenant. Erro fácil de
  -- cometer na tela e caríssimo de descobrir depois.
  constraint chk_automation_rules_has_condition
    check (num_nonnulls(match_department_id, match_agent_id, match_instance_id) >= 1),

  constraint chk_automation_rules_window
    check (starts_at is null or ends_at is null or ends_at > starts_at),

  -- Setor X para o próprio setor X não é regra, é no-op que parece regra.
  constraint chk_automation_rules_no_self_dept
    check (target_department_id is null or match_department_id is null
           or target_department_id <> match_department_id),

  constraint chk_automation_rules_no_self_agent
    check (target_agent_id is null or match_agent_id is null
           or target_agent_id <> match_agent_id),

  constraint chk_automation_rules_priority
    check (priority >= 0)
);

comment on table public.automation_rules is
  'DEM-0410: regras que trocam o destino do chat na entrada. Avaliadas em tempo de execução por fn_automation_resolve_chat_routing (bloco 2), chamada de dentro de fn_assign_conversation_if_ready. Janela vencida deixa de casar sozinha: não há cron de expiração.';

comment on column public.automation_rules.ends_at is
  'Fim da janela. "Encerrar agora" numa regra temporária = set ends_at = now(). Nulo com starts_at nulo = regra fixa.';

comment on column public.automation_rules.match_agent_id is
  'profiles.user_id (NÃO profiles.id). Casa com chat que iria para esta pessoa por regra de atribuição fixed. Instância pessoal não passa pelo motor e não é coberta.';

comment on column public.automation_rules.priority is
  'Menor vence. Empate resolvido por created_at mais antigo no motor.';

-- Caminho do motor: tenant + ativa, ordenado por prioridade. A tabela é
-- minúscula por tenant, então este índice parcial é o que basta para o custo
-- ficar no ruído quando não há regra nenhuma.
create index if not exists idx_automation_rules_lookup
  on public.automation_rules (tenant_id, priority, created_at)
  where is_active = true;

drop trigger if exists trg_automation_rules_updated_at on public.automation_rules;
create trigger trg_automation_rules_updated_at
  before update on public.automation_rules
  for each row execute function public.set_updated_at();

-- ─── O extrato: toda vez que uma regra mexeu (ou deixou de mexer) num chat ──
--
-- Sem isto, "por que esse chat foi para o Suporte?" não tem resposta: o motor
-- deixa apenas o estado final na conversa. Também guarda a tentativa que NÃO
-- se aplicou (`applied = false` + `skipped_reason`), que é justamente o caso
-- que gera dúvida na operação.

create table if not exists public.automation_rule_logs (
  id                 bigint generated by default as identity primary key,
  tenant_id          uuid not null,
  rule_id            uuid not null references public.automation_rules(id) on delete cascade,
  conversation_id    uuid,
  attendance_id      uuid,
  applied            boolean not null default true,
  from_department_id uuid,
  to_department_id   uuid,
  to_agent_id        uuid,
  skipped_reason     text,
  created_at         timestamptz not null default now()
);

comment on table public.automation_rule_logs is
  'DEM-0410: extrato das automações. Escrito só pelo motor (SECURITY DEFINER); não há policy de INSERT, então nenhum cliente forja linha aqui.';

create index if not exists idx_automation_rule_logs_tenant_created
  on public.automation_rule_logs (tenant_id, created_at desc);

create index if not exists idx_automation_rule_logs_rule
  on public.automation_rule_logs (rule_id, created_at desc);

create index if not exists idx_automation_rule_logs_conv
  on public.automation_rule_logs (conversation_id)
  where conversation_id is not null;

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Mesmo desenho das policies de `assignment_rules`: `is_super_admin()` sempre
-- por fora (super admin simula tenant e precisa ver o do cliente), os helpers
-- embrulhados em (select ...) para o planner avaliar uma vez por query em vez
-- de por linha.
--
-- ESCRITA é admin OU head, não só admin: quem cria a regra às 7h da manhã
-- quando alguém faltou é o gestor do setor. `is_tenant_admin_or_head()` já
-- existe no banco e confere access_status + status, então não entra ninguém
-- pendente de aprovação.

alter table public.automation_rules enable row level security;

drop policy if exists automation_rules_select on public.automation_rules;
create policy automation_rules_select
  on public.automation_rules
  for select
  using (
    (select public.is_super_admin())
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists automation_rules_write_insert on public.automation_rules;
create policy automation_rules_write_insert
  on public.automation_rules
  for insert
  with check (
    (
      (select public.is_super_admin())
      or (
        (select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id())
      )
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  );

drop policy if exists automation_rules_write_update on public.automation_rules;
create policy automation_rules_write_update
  on public.automation_rules
  for update
  using (
    (
      (select public.is_super_admin())
      or (
        (select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id())
      )
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  )
  with check (
    (
      (select public.is_super_admin())
      or (
        (select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id())
      )
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  );

drop policy if exists automation_rules_write_delete on public.automation_rules;
create policy automation_rules_write_delete
  on public.automation_rules
  for delete
  using (
    (
      (select public.is_super_admin())
      or (
        (select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id())
      )
    )
    and (
      (select public.is_super_admin())
      or (select public.is_tenant_admin_or_head())
    )
  );

alter table public.automation_rule_logs enable row level security;

-- Só leitura, e só de quem enxerga a tela. Nenhuma policy de INSERT/UPDATE/
-- DELETE: o extrato é escrito pelo motor e não se reescreve.
drop policy if exists automation_rule_logs_select on public.automation_rule_logs;
create policy automation_rule_logs_select
  on public.automation_rule_logs
  for select
  using (
    (select public.is_super_admin())
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (select public.is_tenant_admin_or_head())
    )
  );

grant select, insert, update, delete on public.automation_rules to authenticated;
grant select on public.automation_rule_logs to authenticated;

-- ─── Catálogo do RBAC ───────────────────────────────────────────────────────
--
-- Sem estas linhas, com `tenants.rbac_enabled` ligado a aba SOME para head e
-- user e continua aparecendo para o super admin, que é o jeito mais fácil de
-- não perceber. Copia a visibilidade da aba vizinha (Operação): admin e head
-- com can_view, user nada.

insert into public.resources (key, module, label, description, display_order, hidden, is_navigation, where_it_appears)
select
  'cfg.automacoes',
  coalesce((select module from public.resources where key = 'cfg.operacao'), 'Configurações > Atendimento'),
  'Automações',
  'Regras que mudam o destino do chat na entrada, por período ou fixas.',
  coalesce((select display_order + 1 from public.resources where key = 'cfg.operacao'), 810),
  false,
  coalesce((select is_navigation from public.resources where key = 'cfg.operacao'), false),
  'Configurações > Atendimento > Automações'
on conflict (key) do nothing;

insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select role, 'cfg.automacoes', can_view, can_insert, can_update, can_delete
  from public.role_permissions
 where resource_key = 'cfg.operacao'
on conflict (role, resource_key) do nothing;

commit;

-- ─── Conferência (rodar depois, leitura pura) ───────────────────────────────
--
-- select
--   (select count(*) from pg_policies
--      where schemaname = 'public' and tablename = 'automation_rules')      as policies_regra,   -- 4
--   (select count(*) from pg_policies
--      where schemaname = 'public' and tablename = 'automation_rule_logs')  as policies_log,     -- 1
--   (select count(*) from pg_constraint
--      where conrelid = 'public.automation_rules'::regclass
--        and contype = 'c')                                                as checks,           -- 8
--   (select count(*) from pg_indexes
--      where schemaname = 'public'
--        and tablename in ('automation_rules', 'automation_rule_logs'))     as indices,          -- 6
--   (select count(*) from public.resources
--      where key = 'cfg.automacoes')                                       as resource_linha,   -- 1
--   (select count(*) from public.role_permissions
--      where resource_key = 'cfg.automacoes')                              as rbac_linhas;      -- 3
