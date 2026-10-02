-- Ocorrencias de churn e irritacao detectadas pela IA nos atendimentos.
--
-- Por que existe: `whatsapp_sentiment_analysis` guarda UMA linha por conversa,
-- sobrescrita a cada analise — a irritacao de ontem some na analise de hoje e
-- nao ha como contar recorrencia. Aqui cada ocorrencia fica, e alimenta:
--   - a Visao 360 do cliente (lista + fator Suporte da nota de saude);
--   - a Visao 360 do colaborador (so irritacao com o ATENDIMENTO, so quando o
--     atendimento tinha dono — fila sem dono fica no setor, nao na pessoa);
--   - o aviso por recorrencia (3+ irritacoes atendimento/produto em 30 dias).
-- Decisoes do Alexandre em 01/10/2026.
--
-- Uma ocorrencia por (atendimento, tipo, alvo): a analise roda a cada 5
-- mensagens e de novo no fechamento, e cada rodada redetecta a mesma irritacao.
-- A recorrencia e contada em atendimentos, nao em rodadas de analise.
--
-- Escrita so pela edge function (service_role). O frontend so le.

create table if not exists public.atendimento_ocorrencias (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  attendance_id   uuid not null references public.support_attendances(id) on delete cascade,
  cliente_id      uuid references public.clientes(id) on delete set null,
  contact_id      uuid references public.whatsapp_contacts(id) on delete set null,
  tipo            text not null,
  alvo            text not null,
  -- Dono do atendimento quando a irritacao foi detectada. So para alvo
  -- 'atendimento': irritacao com o produto ou com fator externo nao e do colaborador.
  responsavel_id  uuid references public.profiles(user_id) on delete set null,
  department_id   uuid references public.support_departments(id) on delete set null,
  trecho          text not null,
  motivo          text,
  confianca       numeric(4,3),
  origem          text not null default 'durante',
  modelo          text,
  detectado_em    timestamptz not null default now(),
  constraint atendimento_ocorrencias_tipo_alvo_chk check (
    (tipo = 'churn' and alvo = 'contrato') or
    (tipo = 'irritacao' and alvo in ('atendimento', 'produto', 'externo'))
  ),
  constraint atendimento_ocorrencias_origem_chk check (origem in ('durante', 'fechamento')),
  constraint atendimento_ocorrencias_responsavel_chk check (responsavel_id is null or alvo = 'atendimento'),
  constraint atendimento_ocorrencias_unica unique (attendance_id, tipo, alvo)
);

create index if not exists idx_atend_ocorr_cliente
  on public.atendimento_ocorrencias (tenant_id, cliente_id, detectado_em desc);
create index if not exists idx_atend_ocorr_contato
  on public.atendimento_ocorrencias (tenant_id, contact_id, detectado_em desc);
create index if not exists idx_atend_ocorr_responsavel
  on public.atendimento_ocorrencias (tenant_id, responsavel_id, detectado_em desc)
  where responsavel_id is not null;

alter table public.atendimento_ocorrencias enable row level security;

-- Tabela nova em `public` nasce com grant para anon e authenticated.
revoke all on public.atendimento_ocorrencias from anon, authenticated;
grant select on public.atendimento_ocorrencias to authenticated;
grant all on public.atendimento_ocorrencias to service_role;

create policy atendimento_ocorrencias_tenant_select
  on public.atendimento_ocorrencias
  for select to authenticated
  using (
    (select public.is_super_admin())
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );
