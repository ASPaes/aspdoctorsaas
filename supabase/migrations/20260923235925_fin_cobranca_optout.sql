-- =============================================================================
-- Opt-out da cobrança — o direito de não receber.
--
-- Não é refinamento: desde 2026 oferecer saída virou exigência, com prazo para
-- atender o pedido e fiscalização da ANPD. A régua não pode ser liberada sem
-- isto.
--
-- O QUE NÃO PRECISA: opt-in. Lembrete de pagamento para cliente com contrato
-- ativo se sustenta em execução de contrato, não em consentimento. Por isso
-- esta tabela guarda só quem pediu para SAIR, e o silêncio não bloqueia
-- ninguém.
--
-- A CHAVE É O TELEFONE, não o cliente. Quem pede para sair é a pessoa que
-- recebeu a mensagem, e ela pode nem estar vinculada a um cadastro. Bloquear
-- pelo telefone respeita o pedido mesmo quando o vínculo com o cliente está
-- errado ou ausente — que é justamente quando o pedido costuma aparecer.
--
-- `cliente_id` fica junto quando dá para saber, para a tela mostrar de quem é,
-- mas nunca é ele que decide o bloqueio.
-- =============================================================================

create table if not exists public.fin_cobranca_optout (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,

  -- DDD + os 8 últimos dígitos. Mesma chave da 2ª via, e pela mesma razão: os
  -- 10 últimos dígitos NÃO identificam um telefone no Brasil, porque o nono
  -- dígito do celular empurra tudo e o mesmo número escrito de duas formas
  -- viraria dois. Um opt-out que não reconhece o número que pediu para sair é
  -- pior do que não ter opt-out.
  chave_telefone text not null,
  telefone_original text null,

  cliente_id uuid null references public.clientes(id) on delete set null,
  conversation_id uuid null references public.whatsapp_conversations(id) on delete set null,

  -- 'cliente' = ele mesmo pediu no WhatsApp. 'operador' = alguém registrou pela
  -- tela, a pedido dele por outro canal.
  origem text not null default 'cliente' check (origem in ('cliente', 'operador')),
  texto_recebido text null,

  criado_em timestamptz not null default now(),

  -- Sair não é definitivo: o cliente pode voltar a pedir os lembretes. Em vez
  -- de apagar a linha, ela é revogada — assim fica o registro de que houve um
  -- opt-out, que é o que responde uma reclamação meses depois.
  revogado_em timestamptz null,
  revogado_por uuid null,

  unique (tenant_id, chave_telefone)
);

comment on table public.fin_cobranca_optout is
  'Quem pediu para não receber cobrança automática. A chave é o telefone (DDD + 8 últimos), não o cliente: quem pede para sair é quem recebeu a mensagem, e pode não ter cadastro vinculado.';
comment on column public.fin_cobranca_optout.revogado_em is
  'Preenchido quando o cliente volta a aceitar. A linha nunca é apagada: o histórico do opt-out é o que responde uma reclamação depois.';

-- Como a régua vai perguntar: "este telefone está bloqueado agora?"
create index if not exists idx_fin_optout_ativo
  on public.fin_cobranca_optout (tenant_id, chave_telefone)
  where revogado_em is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — mesmo desenho do resto do Financeiro
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.fin_cobranca_optout enable row level security;

revoke all on public.fin_cobranca_optout from anon, authenticated;
grant select on public.fin_cobranca_optout to authenticated;
grant select, insert, update, delete on public.fin_cobranca_optout to service_role;

drop policy if exists fin_cobranca_optout_select on public.fin_cobranca_optout;
create policy fin_cobranca_optout_select on public.fin_cobranca_optout
  for select
  using (
    (select public.is_super_admin()) is true
    and exists (
      select 1 from public.tenants t
       where t.id = fin_cobranca_optout.tenant_id
         and t.financeiro_enabled is true
    )
  );
