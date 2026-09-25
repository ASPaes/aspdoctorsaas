-- Resumo do Théo na Visão 360° do cliente.
--
-- Decisão do Alexandre em 24/09/2026: o resumo só é gerado quando a pessoa
-- clica (gasta IA da empresa), e TODA consulta fica guardada: o card mostra a
-- última do dia e o botão Histórico mostra todas.
--
-- Quem grava é só a edge function `cliente-resumo-360` (service_role). A equipe
-- da empresa lê. Não existe policy de insert/update/delete de propósito.

create table if not exists public.cliente_resumos_ia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  criado_por uuid,                         -- auth.users.id de quem pediu
  criado_em timestamptz not null default now(),
  resumo text not null,
  pontos jsonb not null default '[]'::jsonb, -- lista curta de próximos passos
  modelo text,
  provider text,
  input_tokens integer,
  output_tokens integer,
  custo_usd numeric(12, 6)
);

create index if not exists cliente_resumos_ia_cliente_idx
  on public.cliente_resumos_ia (cliente_id, criado_em desc);

alter table public.cliente_resumos_ia enable row level security;

-- `is true`: is_super_admin() devolve NULL para quem não tem perfil, e NULL
-- num OR não abre nem fecha nada de forma previsível.
create policy cliente_resumos_ia_select on public.cliente_resumos_ia
  for select to authenticated
  using (
    (select public.is_super_admin()) is true
    or tenant_id = (select public.current_tenant_id())
  );

-- O privilégio padrão do Supabase dá ALL para anon e authenticated. Tirar tudo
-- e devolver só a leitura.
revoke all on public.cliente_resumos_ia from anon, authenticated;
grant select on public.cliente_resumos_ia to authenticated;
grant all on public.cliente_resumos_ia to service_role;
