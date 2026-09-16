-- ============================================================================
-- E-mails: pastas (entrega 2 de 3)
--
-- Pedido do Alexandre (15/09/2026): organizar Enviados e Recebidos em pastas,
-- como se faz na caixa de entrada, com "Mover para" e criação na hora.
--
-- DOIS TIPOS, decididos por ele:
--   setor   -> todo mundo do setor vê e usa (department_id obrigatório);
--   pessoal -> só quem criou vê (criado_por obrigatório).
-- Sem isso, ou todo mundo vê tudo, ou ninguém compartilha.
--
-- Um e-mail fica em UMA pasta (pasta_id), como pasta de verdade, e não como
-- marcador: foi assim que ele descreveu ("mover aquele e-mail para uma pasta").
--
-- Escrita só pelas RPCs abaixo: a tela não faz insert/update direto. As RPCs
-- repetem a regra de quem enxerga (20260913200000) porque SECURITY DEFINER
-- passa por cima do RLS.
--
-- Aplicar pelo SQL Editor. Blocos independentes e idempotentes.
-- ============================================================================


-- ── Bloco 1: a tabela ───────────────────────────────────────────────────────
begin;

create table if not exists public.email_pastas (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  nome          text not null,
  cor           text not null default '#64748B',
  escopo        text not null check (escopo in ('setor', 'pessoal')),
  -- setor: a pasta é do time; pessoal: a pasta é de uma pessoa
  department_id uuid references public.support_departments(id) on delete cascade,
  criado_por    uuid,
  created_at    timestamptz not null default now(),

  constraint email_pastas_nome_ok check (length(btrim(nome)) between 1 and 40),
  constraint email_pastas_cor_ok  check (cor ~ '^#[0-9A-Fa-f]{6}$'),
  constraint email_pastas_dono_ok check (
    (escopo = 'setor'   and department_id is not null)
    or (escopo = 'pessoal' and criado_por is not null)
  )
);

comment on table public.email_pastas is
  'Pastas das telas E-mails (Enviados e Recebidos). escopo=setor: todo o setor usa; escopo=pessoal: só quem criou.';

-- nome repetido confunde na hora de mover: único por dono, sem diferenciar
-- maiúscula nem espaço nas pontas
create unique index if not exists ux_email_pastas_setor
  on public.email_pastas (tenant_id, department_id, lower(btrim(nome)))
  where escopo = 'setor';

create unique index if not exists ux_email_pastas_pessoal
  on public.email_pastas (tenant_id, criado_por, lower(btrim(nome)))
  where escopo = 'pessoal';

alter table public.email_pastas enable row level security;

-- Leitura: a pessoa vê a pasta pessoal dela e as pastas dos setores em que ela
-- está; admin e head veem as pastas de setor todas, como no resto do módulo.
drop policy if exists email_pastas_select on public.email_pastas;
create policy email_pastas_select on public.email_pastas
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and (
        (escopo = 'pessoal' and criado_por = (select auth.uid()))
        or (
          escopo = 'setor'
          and (
            (select public.is_tenant_admin_or_head())
            or exists (
              select 1
                from public.support_department_members m
               where m.department_id = email_pastas.department_id
                 and m.user_id = (select auth.uid())
                 and m.is_active
            )
          )
        )
      )
    )
  );

-- o padrão do banco dá também TRUNCATE a authenticated, e TRUNCATE ignora o
-- RLS; escrita aqui é só pelas RPCs, então a tela fica só com o select
revoke all on public.email_pastas from anon, authenticated;
grant select on public.email_pastas to authenticated;
grant all on public.email_pastas to service_role;

commit;


-- ── Bloco 2: a pasta de cada e-mail ─────────────────────────────────────────
begin;

alter table public.email_envios
  add column if not exists pasta_id uuid references public.email_pastas(id) on delete set null;

alter table public.email_recebidos
  add column if not exists pasta_id uuid references public.email_pastas(id) on delete set null;

comment on column public.email_envios.pasta_id is
  'Pasta escolhida na tela E-mails. Apagar a pasta devolve o e-mail para "sem pasta" (on delete set null).';
comment on column public.email_recebidos.pasta_id is
  'Pasta escolhida na tela E-mails. Apagar a pasta devolve o e-mail para "sem pasta" (on delete set null).';

-- filtrar por pasta é o caso novo; indexa só quem está em alguma
create index if not exists ix_email_envios_pasta
  on public.email_envios (tenant_id, pasta_id, created_at desc)
  where pasta_id is not null;

create index if not exists ix_email_recebidos_pasta
  on public.email_recebidos (tenant_id, pasta_id, recebido_em desc)
  where pasta_id is not null;

commit;


-- ── Bloco 3: criar, renomear e apagar pasta ─────────────────────────────────
begin;

create or replace function public.fn_email_pasta_salvar(
  p_nome          text,
  p_cor           text default '#64748B',
  p_escopo        text default 'pessoal',
  p_department_id uuid default null,
  p_id            uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.fn_acting_user();
  v_super  boolean := coalesce(public.is_super_admin(), false);
  v_role   text;
  v_tenant uuid;
  v_ativo  boolean;
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if v_nome = '' or length(v_nome) > 40 then
    raise exception 'A pasta precisa de um nome de até 40 caracteres.';
  end if;
  if p_escopo not in ('setor', 'pessoal') then
    raise exception 'Tipo de pasta inválido: %', p_escopo;
  end if;
  if coalesce(p_cor, '') !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'Cor inválida.';
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;
  if v_tenant is null and not v_super then
    raise exception 'Perfil sem tenant.' using errcode = '42501';
  end if;
  -- sem isto, perfil pendente criava pasta que o RLS não deixa ele ver depois
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;

  if p_escopo = 'setor' then
    if p_department_id is null then
      raise exception 'Pasta de setor precisa do setor.';
    end if;
    -- do setor: quem é do setor, ou quem manda no tenant
    if not v_super
       and coalesce(v_role, '') not in ('admin', 'head')
       and not exists (
         select 1 from public.support_department_members m
          where m.department_id = p_department_id and m.user_id = v_uid and m.is_active
       )
    then
      raise exception 'Você não faz parte deste setor.' using errcode = '42501';
    end if;
  end if;

  if p_id is null then
    insert into public.email_pastas (tenant_id, nome, cor, escopo, department_id, criado_por)
    values (
      v_tenant,
      v_nome,
      p_cor,
      p_escopo,
      case when p_escopo = 'setor' then p_department_id end,
      case when p_escopo = 'pessoal' then v_uid end
    )
    returning id into v_id;
  else
    -- renomear e trocar cor; o dono e o tipo não mudam depois de criada
    update public.email_pastas f
       set nome = v_nome, cor = p_cor
     where f.id = p_id
       and (v_super or f.tenant_id = v_tenant)
       and (
         v_super
         or coalesce(v_role, '') in ('admin', 'head')
         or (f.escopo = 'pessoal' and f.criado_por = v_uid)
         or (f.escopo = 'setor' and exists (
              select 1 from public.support_department_members m
               where m.department_id = f.department_id and m.user_id = v_uid and m.is_active
            ))
       )
    returning f.id into v_id;

    if v_id is null then
      raise exception 'Pasta não encontrada, ou você não pode mexer nela.' using errcode = '42501';
    end if;
  end if;

  return v_id;
exception
  when unique_violation then
    raise exception 'Já existe uma pasta com esse nome.';
end;
$$;

revoke all on function public.fn_email_pasta_salvar(text, text, text, uuid, uuid) from public, anon;
grant execute on function public.fn_email_pasta_salvar(text, text, text, uuid, uuid) to authenticated, service_role;


create or replace function public.fn_email_pasta_excluir(p_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := public.fn_acting_user();
  v_super   boolean := coalesce(public.is_super_admin(), false);
  v_role    text;
  v_tenant  uuid;
  v_ativo   boolean;
  v_apagada integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;

  -- os e-mails não somem junto: o on delete set null devolve para "sem pasta"
  with alvo as (
    delete from public.email_pastas f
     where f.id = p_id
       and (v_super or f.tenant_id = v_tenant)
       and (
         v_super
         or coalesce(v_role, '') in ('admin', 'head')
         or (f.escopo = 'pessoal' and f.criado_por = v_uid)
         or (f.escopo = 'setor' and exists (
              select 1 from public.support_department_members m
               where m.department_id = f.department_id and m.user_id = v_uid and m.is_active
            ))
       )
    returning 1
  )
  select count(*) into v_apagada from alvo;

  if v_apagada = 0 then
    raise exception 'Pasta não encontrada, ou você não pode apagá-la.' using errcode = '42501';
  end if;
  return v_apagada;
end;
$$;

revoke all on function public.fn_email_pasta_excluir(uuid) from public, anon;
grant execute on function public.fn_email_pasta_excluir(uuid) to authenticated, service_role;

commit;


-- ── Bloco 4: mover e-mail para a pasta ──────────────────────────────────────
begin;

create or replace function public.fn_email_mover_pasta(
  p_tabela   text,
  p_ids      uuid[],
  p_pasta_id uuid default null   -- null = tirar da pasta
)
returns table(afetados integer, bloqueados integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.fn_acting_user();
  v_super    boolean := coalesce(public.is_super_admin(), false);
  v_role     text;
  v_tenant   uuid;
  v_ativo    boolean;
  v_tudo     boolean;
  v_afetados integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if p_tabela not in ('enviados', 'recebidos') then
    raise exception 'Tabela inválida: %', p_tabela;
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return query select 0, 0;
    return; -- sem isto seguiria e rodaria o update com lista vazia
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;
  if not v_super and not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;

  v_tudo := v_super or coalesce(v_role, '') in ('admin', 'head');

  -- a pasta precisa existir, ser do mesmo tenant e ser DELA (ou do setor dela):
  -- senão daria para esconder e-mail numa pasta que a pessoa nem enxerga
  if p_pasta_id is not null then
    if not exists (
      select 1 from public.email_pastas f
       where f.id = p_pasta_id
         and (v_super or f.tenant_id = v_tenant)
         and (
           v_tudo
           or (f.escopo = 'pessoal' and f.criado_por = v_uid)
           or (f.escopo = 'setor' and exists (
                select 1 from public.support_department_members m
                 where m.department_id = f.department_id and m.user_id = v_uid and m.is_active
              ))
         )
    ) then
      raise exception 'Pasta não encontrada, ou você não pode usá-la.' using errcode = '42501';
    end if;
  end if;

  if p_tabela = 'enviados' then
    with alvo as (
      update public.email_envios e
         set pasta_id = p_pasta_id
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
         and (v_tudo or e.enviado_por = v_uid)
         and e.deleted_at is null
         and e.pasta_id is distinct from p_pasta_id
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      update public.email_recebidos r
         set pasta_id = p_pasta_id
       where r.id = any(p_ids)
         and (v_super or r.tenant_id = v_tenant)
         and (
           v_tudo
           or exists (
             select 1 from public.email_envios e
              where e.id = r.envio_id and e.enviado_por = v_uid
           )
         )
         and r.deleted_at is null
         and r.pasta_id is distinct from p_pasta_id
      returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  return query select v_afetados, cardinality(p_ids) - v_afetados;
end;
$$;

revoke all on function public.fn_email_mover_pasta(text, uuid[], uuid) from public, anon;
grant execute on function public.fn_email_mover_pasta(text, uuid[], uuid) to authenticated, service_role;

commit;


-- ============================================================================
-- ORDEM: aplicar este SQL ANTES do push da tela das pastas. A tela lê
-- email_pastas e chama as três funções; sem elas, o menu Pastas abriria vazio e
-- "Mover para" devolveria erro de função inexistente.
-- ============================================================================
