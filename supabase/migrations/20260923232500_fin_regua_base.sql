-- =============================================================================
-- Régua de cobrança — as duas tabelas e o portão. Nada aqui manda mensagem.
--
-- São os itens 1, 2 e 6 do plano aprovado pelo Alexandre em 23/09/2026: a
-- configuração dos toques, o registro do que já saiu, e a chave que impede o
-- motor de alcançar cliente antes de ele testar no próprio número.
--
-- O motor vem depois, numa entrega separada. Estas tabelas existirem antes é o
-- que garante que, quando ele nascer, já nasça com o freio instalado — foi o
-- que funcionou na 2ª via.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Os toques da régua
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `dias_offset` é relativo ao VENCIMENTO: negativo antes (-3 = três dias antes),
-- 0 no dia, positivo depois (+7 = uma semana de atraso). Um número só, em vez de
-- "tipo" + "quantidade", porque é assim que se pensa a régua ("mando no D-3") e
-- porque ordenar por ele já dá a linha do tempo.
create table if not exists public.fin_regua_toques (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  dias_offset integer not null,
  rotulo text not null,
  mensagem text not null,

  -- Desligar um toque não apaga o histórico do que ele já mandou.
  ativo boolean not null default true,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  -- Dois toques no mesmo dia mandariam duas mensagens no mesmo dia. Nunca é o
  -- que se quer, e o banco é quem deve impedir.
  unique (tenant_id, dias_offset)
);

comment on table public.fin_regua_toques is
  'Os toques da régua de cobrança de cada tenant: quando falar (dias_offset em relação ao vencimento) e o que falar.';
comment on column public.fin_regua_toques.dias_offset is
  'Dias em relação ao vencimento: negativo = antes, 0 = no dia, positivo = em atraso.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O que já foi enviado
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Esta tabela é a garantia de que ninguém é cobrado duas vezes pela mesma
-- parcela no mesmo toque, mesmo que o cron rode duas vezes, que a edge function
-- seja reexecutada, ou que alguém aperte "rodar agora" no meio do dia.
--
-- A chave é (tenant, título, dias_offset) e NÃO (tenant, título, toque_id) de
-- propósito: apagar e recriar o toque D+3 não pode liberar uma segunda cobrança
-- de quem já recebeu a do D+3. O `toque_id` fica junto para referência e morre
-- em `set null` se o toque for apagado; quem identifica o envio é o offset.
create table if not exists public.fin_cobranca_envios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  titulo_id uuid not null references public.fin_titulos(id) on delete cascade,

  toque_id uuid null references public.fin_regua_toques(id) on delete set null,
  dias_offset integer not null,

  -- enviado   = a mensagem saiu.
  -- suprimido = decidimos NÃO mandar, e `motivo` diz por quê (já pago na
  --             releitura, cliente sem telefone, valor zerado). Registrar a
  --             supressão é o que impede o dia seguinte de tentar de novo e
  --             é o que responde "por que o fulano não recebeu?".
  -- erro      = tentamos e falhou; o motor pode atualizar ESTA linha e tentar
  --             de novo, sem criar uma segunda.
  status text not null check (status in ('enviado', 'suprimido', 'erro')),
  motivo text null,
  tentativas smallint not null default 0,

  -- Retrato do que foi dito ao cliente. Sem isto, responder "quanto mandamos
  -- cobrar dele em agosto?" exigiria adivinhar, porque o título muda de valor
  -- (multa, juros) e de situação depois.
  valor numeric null,
  vencimento date null,
  telefone text null,

  conversation_id uuid null references public.whatsapp_conversations(id) on delete set null,
  message_id text null,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  unique (tenant_id, titulo_id, dias_offset)
);

comment on table public.fin_cobranca_envios is
  'Um registro por título × toque da régua. A unicidade (tenant, título, dias_offset) é o que impede cobrar duas vezes a mesma parcela no mesmo toque.';
comment on column public.fin_cobranca_envios.status is
  'enviado = saiu; suprimido = decidimos não mandar (motivo explica); erro = falhou e pode ser retentado NESTA linha.';

-- Como o motor vai ler: "o que já mandei para estes títulos".
create index if not exists idx_fin_envios_titulo
  on public.fin_cobranca_envios (tenant_id, titulo_id);

-- Como a tela vai ler: "o que saiu nos últimos dias".
create index if not exists idx_fin_envios_tenant_data
  on public.fin_cobranca_envios (tenant_id, criado_em desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Carimbo de atualização
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `fn_fin_titulos_touch` tem nome de tabela mas não olha nenhuma: só faz
-- `new.atualizado_em := now()`. Reusar é melhor do que criar uma terceira cópia
-- da mesma linha de código.
drop trigger if exists trg_fin_regua_toques_touch on public.fin_regua_toques;
create trigger trg_fin_regua_toques_touch
  before update on public.fin_regua_toques
  for each row execute function public.fn_fin_titulos_touch();

drop trigger if exists trg_fin_cobranca_envios_touch on public.fin_cobranca_envios;
create trigger trg_fin_cobranca_envios_touch
  before update on public.fin_cobranca_envios
  for each row execute function public.fn_fin_titulos_touch();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — mesmo desenho da Fase 1
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Leitura: super admin E tenant com `financeiro_enabled`. Escrita: só o motor,
-- com service_role. Ninguém edita envio pela tela — envio é fato consumado.
--
-- `is true` e não o valor cru: `is_super_admin()` devolve NULL para quem não é,
-- e NULL dentro de AND/OR já cegou portão neste projeto.
alter table public.fin_regua_toques enable row level security;
alter table public.fin_cobranca_envios enable row level security;

revoke all on public.fin_regua_toques from anon, authenticated;
revoke all on public.fin_cobranca_envios from anon, authenticated;

grant select on public.fin_regua_toques to authenticated;
grant select on public.fin_cobranca_envios to authenticated;
grant select, insert, update, delete on public.fin_regua_toques to service_role;
grant select, insert, update, delete on public.fin_cobranca_envios to service_role;

drop policy if exists fin_regua_toques_select on public.fin_regua_toques;
create policy fin_regua_toques_select on public.fin_regua_toques
  for select
  using (
    (select public.is_super_admin()) is true
    and exists (
      select 1 from public.tenants t
       where t.id = fin_regua_toques.tenant_id
         and t.financeiro_enabled is true
    )
  );

drop policy if exists fin_cobranca_envios_select on public.fin_cobranca_envios;
create policy fin_cobranca_envios_select on public.fin_cobranca_envios
  for select
  using (
    (select public.is_super_admin()) is true
    and exists (
      select 1 from public.tenants t
       where t.id = fin_cobranca_envios.tenant_id
         and t.financeiro_enabled is true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. O portão, instalado ANTES do motor existir
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Regra do Alexandre, repetida em 23/09/2026: nenhuma automação fala com
-- cliente antes de ele testar no próprio WhatsApp. Na régua isso pesa mais que
-- na 2ª via, porque a régua fala SEM o cliente pedir.
--
-- Nasce `false` e sem telefone nenhum na lista: mesmo que o motor seja
-- publicado por engano, ele não alcança ninguém. Depois de liberada, a lista
-- deixa de filtrar e a chave vira o freio de mão — `false` para o robô parar na
-- hora, sem deploy.
alter table public.configuracoes
  add column if not exists fin_regua_liberada boolean not null default false,
  add column if not exists fin_regua_telefones_teste text[] not null default '{}'::text[];

comment on column public.configuracoes.fin_regua_liberada is
  'Libera a régua de cobrança para TODOS os clientes deste tenant. Padrão false: enquanto estiver false, só os números em fin_regua_telefones_teste recebem cobrança. É também o freio de mão: virar para false para a régua parar na hora, sem deploy.';
comment on column public.configuracoes.fin_regua_telefones_teste is
  'Telefones que recebem a régua enquanto ela não está liberada. Só dígitos, com DDI. A comparação é por DDD + os 8 últimos dígitos, que é o que sobrevive ao nono dígito do celular.';
