-- Pauta do 1:1 pelo Théo, na Visão 360° do colaborador.
--
-- Só é gerada quando um gestor clica (gasta IA da empresa). Toda pauta gerada
-- fica guardada: o card mostra a última e o Histórico mostra todas.
--
-- Quem grava é só a edge function `colaborador-pauta-360` (service_role).
-- A tabela não tem policy nenhuma: a leitura passa pela RPC abaixo, que aplica
-- a mesma regra da Visão 360° do colaborador, restrita a quem gere pessoas:
--   head  -> pautas da equipe dos setores em que é membro ativo
--   admin / super admin -> todas do tenant
--   user  -> nenhuma (a pauta é ferramenta do gestor para a conversa)

create table if not exists public.colaborador_pautas_ia (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  colaborador_id uuid not null,            -- auth.users.id de quem é avaliado
  criado_por uuid,                         -- auth.users.id de quem pediu
  criado_em timestamptz not null default now(),
  periodo_de timestamptz,
  periodo_ate timestamptz,
  resumo text not null,
  reconhecer jsonb not null default '[]'::jsonb,
  conversar jsonb not null default '[]'::jsonb,
  desenvolver jsonb not null default '[]'::jsonb,
  modelo text,
  provider text,
  input_tokens integer,
  output_tokens integer,
  custo_usd numeric(12, 6)
);

create index if not exists colaborador_pautas_ia_colab_idx
  on public.colaborador_pautas_ia (tenant_id, colaborador_id, criado_em desc);

alter table public.colaborador_pautas_ia enable row level security;

-- O privilégio padrão dá ALL a anon e authenticated: tirar tudo.
revoke all on public.colaborador_pautas_ia from anon, authenticated;
grant all on public.colaborador_pautas_ia to service_role;

create or replace function public.get_colaborador_pautas(
  p_user_id uuid,
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_super boolean := coalesce(public.is_super_admin(), false);
  v_tenant uuid;
  v_role text;
  v_pode boolean;
begin
  if v_caller is null then raise exception 'Não autenticado'; end if;
  if p_tenant_id is not null and v_super then v_tenant := p_tenant_id;
  else v_tenant := public.current_tenant_id(); end if;
  if v_tenant is null then raise exception 'Tenant não identificado'; end if;

  select p.role into v_role from profiles p where p.user_id = v_caller limit 1;

  v_pode := exists (select 1 from profiles p where p.user_id = p_user_id and p.tenant_id = v_tenant)
    and (
      v_super or v_role = 'admin'
      or (v_role = 'head' and exists (
        select 1 from support_department_members m
        join support_department_members m2 on m2.department_id = m.department_id
        where m.user_id = v_caller and m.tenant_id = v_tenant and coalesce(m.is_active, true)
          and m2.user_id = p_user_id and m2.tenant_id = v_tenant and coalesce(m2.is_active, true)))
    );
  if not v_pode then
    raise exception 'Sem permissão para ver a pauta deste colaborador' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'criado_em', x.criado_em, 'criado_por', x.criado_por,
             'periodo_de', x.periodo_de, 'periodo_ate', x.periodo_ate,
             'resumo', x.resumo, 'reconhecer', x.reconhecer, 'conversar', x.conversar, 'desenvolver', x.desenvolver)
           order by x.criado_em desc)
    from (
      select * from colaborador_pautas_ia
      where tenant_id = v_tenant and colaborador_id = p_user_id
      order by criado_em desc
      limit 100
    ) x
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_colaborador_pautas(uuid, uuid) from public, anon;
grant execute on function public.get_colaborador_pautas(uuid, uuid) to authenticated, service_role;
