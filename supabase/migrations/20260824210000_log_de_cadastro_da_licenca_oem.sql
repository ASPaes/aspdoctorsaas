-- ============================================================================
-- Registro de toda tentativa de corrigir o CADASTRO de uma licença no OEM
--
-- A partir de 24/08/2026 a aba Divergências passa a oferecer "Atualizar no
-- OEM" para nome e CNPJ. Isso é escrita no sistema do parceiro, numa rota que
-- salva a filial INTEIRA — e escrita em sistema de terceiro sem registro não
-- se audita depois. Mesmo desenho da `oem_baixa_modulo_log`, que já existe
-- para a baixa de módulo.
--
-- Guarda TODA tentativa, inclusive a recusada e a simulada: é justamente a
-- recusa que interessa quando alguém pergunta "por que não foi?". A resposta
-- do parceiro entra inteira em `resposta` — a mensagem resumida perde a
-- diferença entre "faltou codigoTipoNegocio" e "o parceiro negou".
--
-- `valor_anterior` vem do que o OEM tinha ANTES (a função de lá devolve), não
-- do que o DoctorSaaS achava que ele tinha. São coisas diferentes quando o
-- espelho está atrasado, e a que importa aqui é a do parceiro.
-- ============================================================================

begin;

create table if not exists public.oem_cadastro_licenca_log (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  conta_integration_id uuid,
  cliente_id           uuid,
  empresa_codigo       text,
  filial_codigo        text,
  campo                text not null check (campo in ('nome', 'cnpj')),
  valor_anterior       text,
  valor_novo           text,
  simulado             boolean not null default false,
  ok                   boolean not null default false,
  http                 integer,
  resposta             jsonb,
  usuario_id           uuid,
  criado_em            timestamptz not null default now()
);

comment on table public.oem_cadastro_licenca_log is
  'Toda tentativa de gravar nome ou CNPJ da filial no OEM, inclusive as recusadas e as simuladas. valor_anterior é o que o parceiro tinha antes, não o que o espelho daqui dizia.';

create index if not exists idx_oem_cadastro_log_tenant_data
  on public.oem_cadastro_licenca_log (tenant_id, criado_em desc);

create index if not exists idx_oem_cadastro_log_filial
  on public.oem_cadastro_licenca_log (filial_codigo)
  where filial_codigo is not null;

alter table public.oem_cadastro_licenca_log enable row level security;

-- Leitura pelo tenant, como o resto da aba. `or is_super_admin()` não é
-- opcional: sem ele o super admin simulando um tenant não enxerga nada.
drop policy if exists "oem_cadastro_log_select" on public.oem_cadastro_licenca_log;
create policy "oem_cadastro_log_select"
  on public.oem_cadastro_licenca_log for select
  to authenticated
  using (
    public.is_super_admin()
    or tenant_id in (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );

-- Quem escreve é a edge function, com service_role. Não existe caminho de
-- INSERT pelo navegador de propósito: log que o cliente pode forjar não é log.
grant select on public.oem_cadastro_licenca_log to authenticated;
grant all    on public.oem_cadastro_licenca_log to service_role;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura). Zero linhas até a primeira tentativa:
--   select criado_em, campo, valor_anterior, valor_novo, ok, http
--     from public.oem_cadastro_licenca_log order by criado_em desc limit 20;
-- ---------------------------------------------------------------------------
