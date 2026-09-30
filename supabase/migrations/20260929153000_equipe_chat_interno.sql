-- ============================================================================
-- Equipe DS — chat interno entre colaboradores (versão 1.0, parte 1: banco)
--
-- Canais, conversas diretas (1:1 e grupo), fios, reações, fixar, salvos e busca.
-- Nada de WhatsApp aqui: é 100% interno, por tenant.
--
-- DECISÕES DO OWNER (29/09/2026):
--   · DM, grupo e canal privado são PRIVADOS. Nem o super admin lê, mesmo
--     simulando o tenant. Exceção consciente à regra "toda policy tem
--     OR is_super_admin()". Canais abertos (#geral, setor, canal público) o
--     super admin lê, como em qualquer outra tela.
--   · Só admin e head (e super admin) criam canal.
--   · #geral com todo o tenant + um canal por setor, mantidos sozinhos.
--   · Autor edita e apaga sempre, com marca. Admin apaga de qualquer um.
--
-- QUEM PARTICIPA DE QUÊ (o desenho que evita sincronizar lista de membros):
--   · geral  → todo mundo do tenant. Calculado na hora, sem linha de membro.
--   · setor  → quem está em support_department_members (ativo). Calculado na
--              hora. Admin/head podem ENTRAR no canal de outro setor; aí sim
--              ganham linha em equipe_membros.
--   · canal  → linha ativa em equipe_membros (público: qualquer um entra).
--   · dm / grupo → linha ativa em equipe_membros.
--   equipe_membros também guarda o "lido até" de cada pessoa em cada canal,
--   inclusive nos automáticos (a linha nasce na primeira leitura).
--
-- ESCRITA SÓ POR RPC. As tabelas têm policy de SELECT (a tela e o Realtime
-- leem direto) e nenhuma de INSERT/UPDATE/DELETE: toda mudança passa por uma
-- função que confere tenant, papel e participação.
--
-- REAÇÕES MORAM NA MENSAGEM (jsonb), não em tabela própria: o Realtime não
-- aplica RLS em DELETE, então tirar uma reação de tabela separada vazaria a
-- chave para quem não participa. Como UPDATE na mensagem, a RLS vale.
-- ============================================================================
begin;

-- --------------------------------------------------------------- tabelas
create table if not exists public.equipe_canais (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  tipo            text not null check (tipo in ('geral','setor','canal','dm','grupo')),
  nome            text,
  descricao       text,
  privado         boolean not null default false,
  department_id   uuid references public.support_departments(id) on delete set null,
  dm_chave        text,
  criado_por      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  arquivado_em    timestamptz,
  ultima_mensagem_em timestamptz,
  constraint equipe_canais_nome_obrigatorio check (tipo in ('dm','grupo') or nullif(btrim(nome),'') is not null),
  constraint equipe_canais_setor_tem_setor  check (tipo <> 'setor' or department_id is not null),
  constraint equipe_canais_dm_tem_chave     check (tipo not in ('dm','grupo') or dm_chave is not null)
);
comment on table public.equipe_canais is 'Chat interno (Equipe DS): canais, DMs e grupos. Escrita só pelas RPCs equipe_*.';
comment on column public.equipe_canais.dm_chave is 'dm/grupo: user_ids ordenados e unidos por vírgula. Garante uma conversa só para o mesmo conjunto de pessoas.';

create unique index if not exists uq_equipe_canais_geral on public.equipe_canais (tenant_id) where tipo = 'geral';
create unique index if not exists uq_equipe_canais_setor on public.equipe_canais (tenant_id, department_id) where tipo = 'setor';
create unique index if not exists uq_equipe_canais_dm    on public.equipe_canais (tenant_id, dm_chave) where tipo in ('dm','grupo');
create unique index if not exists uq_equipe_canais_nome  on public.equipe_canais (tenant_id, lower(nome)) where tipo = 'canal' and arquivado_em is null;

create table if not exists public.equipe_membros (
  canal_id     uuid not null references public.equipe_canais(id) on delete cascade,
  user_id      uuid not null,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  entrou_em    timestamptz not null default now(),
  saiu_em      timestamptz,
  lido_ate     timestamptz,
  silenciado   boolean not null default false,
  oculto_em    timestamptz,
  primary key (canal_id, user_id)
);
comment on table public.equipe_membros is 'Participação (canal/dm/grupo) e estado de leitura (todos os tipos). Em geral/setor a linha é só leitura: quem participa é calculado.';
create index if not exists idx_equipe_membros_user on public.equipe_membros (user_id) where saiu_em is null;

create table if not exists public.equipe_mensagens (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  canal_id         uuid not null references public.equipe_canais(id) on delete cascade,
  autor_id         uuid,
  parent_id        uuid references public.equipe_mensagens(id) on delete cascade,
  tipo             text not null default 'texto' check (tipo in ('texto','sistema')),
  corpo            text not null default '',
  anexos           jsonb not null default '[]'::jsonb,
  refs             jsonb not null default '[]'::jsonb,
  mencoes          uuid[] not null default '{}',
  menciona_todos   boolean not null default false,
  reacoes          jsonb not null default '{}'::jsonb,
  respostas        integer not null default 0,
  ultima_resposta_em timestamptz,
  respondentes     uuid[] not null default '{}',
  editada_em       timestamptz,
  apagada_em       timestamptz,
  apagada_por      uuid,
  fixada_em        timestamptz,
  fixada_por       uuid,
  -- clock_timestamp: hora exata do envio (now() empataria com o "lido até" gravado na mesma transação)
  created_at       timestamptz not null default clock_timestamp(),
  constraint equipe_mensagens_corpo_tamanho check (char_length(corpo) <= 8000)
);
comment on column public.equipe_mensagens.reacoes is '{"👍": ["<user_id>", ...]}. Alterado só por equipe_reagir.';
comment on column public.equipe_mensagens.refs is 'Cartões vivos: [{"tipo":"ticket|cliente|atendimento","id":"..."}]. O conteúdo é lido na hora, com a permissão de quem vê.';
comment on column public.equipe_mensagens.respondentes is 'Quem respondeu no fio (para o avatar da contagem e para avisar resposta nova).';

create index if not exists idx_equipe_msg_canal  on public.equipe_mensagens (canal_id, created_at desc) where parent_id is null;
create index if not exists idx_equipe_msg_fio    on public.equipe_mensagens (parent_id, created_at) where parent_id is not null;
create index if not exists idx_equipe_msg_fixada on public.equipe_mensagens (canal_id) where fixada_em is not null;
create index if not exists idx_equipe_msg_mencao on public.equipe_mensagens using gin (mencoes);
-- busca e "meus fios" varrem o tenant por data
create index if not exists idx_equipe_msg_tenant on public.equipe_mensagens (tenant_id, created_at desc);
create index if not exists idx_equipe_msg_fios_ativos on public.equipe_mensagens (tenant_id, ultima_resposta_em desc) where respostas > 0;

create table if not exists public.equipe_salvos (
  user_id     uuid not null,
  mensagem_id uuid not null references public.equipe_mensagens(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, mensagem_id)
);

-- Até onde cada pessoa leu cada fio (respostas de uma mensagem).
create table if not exists public.equipe_fio_leitura (
  user_id   uuid not null,
  raiz_id   uuid not null references public.equipe_mensagens(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lido_ate  timestamptz not null,
  primary key (user_id, raiz_id)
);

-- ------------------------------------------------------------ helpers
-- Tenant do chamador bate, ou é super admin.
create or replace function public.fn_equipe_tenant_ok(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid()
       and (p.tenant_id = p_tenant_id or p.is_super_admin)
  );
$$;

-- Admin/head do tenant, ou super admin.
create or replace function public.fn_equipe_pode_gerir(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid()
       and (p.is_super_admin or (p.tenant_id = p_tenant_id and p.role in ('admin','head')))
  );
$$;

-- Pode LER o canal (base da RLS e de todas as RPCs).
create or replace function public.fn_equipe_pode_ver(p_canal_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.equipe_canais c
      join public.profiles p on p.user_id = auth.uid()
     where c.id = p_canal_id
       and case
             -- privados: só quem participa. Super admin NÃO fura (decisão do owner).
             when c.tipo in ('dm','grupo') or (c.tipo = 'canal' and c.privado) then
               p.tenant_id = c.tenant_id
               and exists (select 1 from public.equipe_membros m
                            where m.canal_id = c.id and m.user_id = p.user_id and m.saiu_em is null)
             when c.tipo = 'setor' then
               p.is_super_admin
               or (p.tenant_id = c.tenant_id and (
                     p.role in ('admin','head')
                     or exists (select 1 from public.support_department_members dm
                                 where dm.department_id = c.department_id
                                   and dm.user_id = p.user_id and dm.is_active)
                     or exists (select 1 from public.equipe_membros m
                                 where m.canal_id = c.id and m.user_id = p.user_id and m.saiu_em is null)))
             else -- geral e canal público
               p.is_super_admin or p.tenant_id = c.tenant_id
           end
  );
$$;

-- "Estou dentro" (aparece na minha lista e conta não lida). Mais estreito que ver.
create or replace function public.fn_equipe_participo(p_canal_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.equipe_canais c
     where c.id = p_canal_id
       and (
         c.tipo = 'geral'
         or exists (select 1 from public.equipe_membros m
                     where m.canal_id = c.id and m.user_id = p_user_id and m.saiu_em is null)
         or (c.tipo = 'setor' and exists (
               select 1 from public.support_department_members dm
                where dm.department_id = c.department_id and dm.user_id = p_user_id and dm.is_active))
       )
  );
$$;

-- --------------------------------------------------------------- RLS
alter table public.equipe_canais    enable row level security;
alter table public.equipe_membros   enable row level security;
alter table public.equipe_mensagens enable row level security;
alter table public.equipe_salvos    enable row level security;

drop policy if exists equipe_canais_select on public.equipe_canais;
create policy equipe_canais_select on public.equipe_canais
  for select to authenticated using (public.fn_equipe_pode_ver(id));

drop policy if exists equipe_membros_select on public.equipe_membros;
create policy equipe_membros_select on public.equipe_membros
  for select to authenticated using (user_id = auth.uid() or public.fn_equipe_pode_ver(canal_id));

drop policy if exists equipe_mensagens_select on public.equipe_mensagens;
create policy equipe_mensagens_select on public.equipe_mensagens
  for select to authenticated using (public.fn_equipe_pode_ver(canal_id));

drop policy if exists equipe_salvos_select on public.equipe_salvos;
create policy equipe_salvos_select on public.equipe_salvos
  for select to authenticated using (user_id = auth.uid());

alter table public.equipe_fio_leitura enable row level security;
drop policy if exists equipe_fio_leitura_select on public.equipe_fio_leitura;
create policy equipe_fio_leitura_select on public.equipe_fio_leitura
  for select to authenticated using (user_id = auth.uid());

-- Escrita direta fechada (RLS sem policy já nega; o revoke deixa explícito).
revoke insert, update, delete on public.equipe_canais, public.equipe_membros,
  public.equipe_mensagens, public.equipe_salvos, public.equipe_fio_leitura from anon, authenticated;

-- ------------------------------------------------ canais automáticos
-- Garante #geral e um canal por setor ativo; renomeia e arquiva conforme o setor.
-- Só escreve quando falta ou mudou: pode rodar a cada abertura da lista.
create or replace function public.equipe_garantir_canais(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fn_equipe_tenant_ok(p_tenant_id) then
    raise exception 'Sem acesso a este tenant' using errcode = '42501';
  end if;

  insert into public.equipe_canais (tenant_id, tipo, nome, descricao)
  values (p_tenant_id, 'geral', 'geral', 'Toda a equipe. Avisos e recados.')
  on conflict (tenant_id) where tipo = 'geral' do nothing;

  insert into public.equipe_canais (tenant_id, tipo, nome, descricao, department_id)
  select d.tenant_id, 'setor', coalesce(nullif(btrim(d.name), ''), 'Setor'),
         'Canal do setor ' || coalesce(nullif(btrim(d.name), ''), 'sem nome'), d.id
    from public.support_departments d
   where d.tenant_id = p_tenant_id and d.is_active
  on conflict (tenant_id, department_id) where tipo = 'setor' do nothing;

  update public.equipe_canais c
     set nome = coalesce(nullif(btrim(d.name), ''), 'Setor'),
         arquivado_em = case when d.is_active then null else coalesce(c.arquivado_em, now()) end,
         updated_at = now()
    from public.support_departments d
   where c.tenant_id = p_tenant_id and c.tipo = 'setor' and d.id = c.department_id
     and (c.nome is distinct from coalesce(nullif(btrim(d.name), ''), 'Setor')
          or (d.is_active and c.arquivado_em is not null)
          or (not d.is_active and c.arquivado_em is null));

  -- setor apagado (department_id virou null pelo FK): arquiva
  update public.equipe_canais
     set arquivado_em = now(), updated_at = now()
   where tenant_id = p_tenant_id and tipo = 'setor' and department_id is null and arquivado_em is null;
end;
$$;

-- ------------------------------------------------------ lista lateral
create or replace function public.equipe_minhas_conversas(p_tenant_id uuid)
returns table (
  id uuid, tipo text, nome text, descricao text, privado boolean, department_id uuid,
  arquivado boolean, ultima_mensagem_em timestamptz, previa text, previa_autor uuid,
  nao_lidas integer, mencoes integer, silenciado boolean, outros uuid[]
)
language plpgsql security definer set search_path = public as $$
declare
  v_uid  uuid := auth.uid();
  v_base timestamptz;
begin
  -- Os canais automáticos só precisam de conserto quando algo mudou (tenant
  -- novo, setor criado, renomeado ou desativado). A checagem é só leitura: a
  -- lista é relida por quem está online e não pode escrever a cada vez.
  if not public.fn_equipe_tenant_ok(p_tenant_id) then
    raise exception 'Sem acesso a este tenant' using errcode = '42501';
  end if;
  -- (apelidos em tudo: "tipo" e "id" também são colunas de saída desta função)
  if not exists (select 1 from public.equipe_canais g where g.tenant_id = p_tenant_id and g.tipo = 'geral')
     or exists (select 1 from public.support_departments d
                 where d.tenant_id = p_tenant_id and d.is_active
                   and not exists (select 1 from public.equipe_canais c
                                    where c.tenant_id = p_tenant_id and c.tipo = 'setor' and c.department_id = d.id
                                      and c.arquivado_em is null
                                      and c.nome = coalesce(nullif(btrim(d.name), ''), 'Setor')))
     or exists (select 1 from public.equipe_canais c
                 where c.tenant_id = p_tenant_id and c.tipo = 'setor' and c.arquivado_em is null
                   and not exists (select 1 from public.support_departments d where d.id = c.department_id and d.is_active)) then
    perform public.equipe_garantir_canais(p_tenant_id);
  end if;
  select coalesce(p.created_at, now()) into v_base from public.profiles p where p.user_id = v_uid;

  return query
  with meus as (
    select c.*, m.lido_ate, coalesce(m.silenciado,false) as silenciado_m, m.oculto_em
      from public.equipe_canais c
      left join public.equipe_membros m on m.canal_id = c.id and m.user_id = v_uid
     where c.tenant_id = p_tenant_id
       and (c.arquivado_em is null or c.tipo in ('dm','grupo','canal'))
       and (
         c.tipo = 'geral'
         or (m.user_id is not null and m.saiu_em is null)
         or (c.tipo = 'setor' and exists (
               select 1 from public.support_department_members dm
                where dm.department_id = c.department_id and dm.user_id = v_uid and dm.is_active))
       )
       -- DM fechada volta quando chega mensagem nova
       and (m.oculto_em is null or c.ultima_mensagem_em > m.oculto_em)
       -- privados nunca aparecem para super admin de fora (fn_equipe_pode_ver decide)
       and public.fn_equipe_pode_ver(c.id)
  )
  select c.id, c.tipo, c.nome, c.descricao, c.privado, c.department_id,
         c.arquivado_em is not null,
         c.ultima_mensagem_em,
         u.previa, u.autor_id,
         coalesce(nl.qt, 0)::int, coalesce(nl.men, 0)::int,
         c.silenciado_m,
         case when c.tipo in ('dm','grupo') then
           array(select mm.user_id from public.equipe_membros mm
                  where mm.canal_id = c.id and mm.saiu_em is null and mm.user_id <> v_uid
                  order by mm.entrou_em)
         else '{}'::uuid[] end
    from meus c
    left join lateral (
      select case when x.apagada_em is not null then 'Mensagem apagada'
                  when x.corpo = '' and jsonb_array_length(x.anexos) > 0 then
                    case when x.anexos->0->>'mime' like 'image/%' then 'Enviou uma imagem'
                         else 'Enviou ' || (x.anexos->0->>'nome') end
                  when x.corpo = '' and jsonb_array_length(x.refs) > 0 then
                    case x.refs->0->>'tipo' when 'ticket' then 'Compartilhou um ticket'
                                            when 'cliente' then 'Compartilhou um cliente'
                                            else 'Pediu ajuda com um atendimento' end
                  else left(regexp_replace(x.corpo, '\s+', ' ', 'g'), 140) end as previa,
             x.autor_id
        from public.equipe_mensagens x
       where x.canal_id = c.id and x.parent_id is null
       order by x.created_at desc limit 1
    ) u on true
    left join lateral (
      select count(*) as qt,
             count(*) filter (where v_uid = any(y.mencoes) or y.menciona_todos) as men
        from (select z.mencoes, z.menciona_todos
                from public.equipe_mensagens z
               where z.canal_id = c.id and z.parent_id is null
                 and z.created_at > coalesce(c.lido_ate, greatest(v_base, c.created_at))
                 and z.autor_id is distinct from v_uid
                 and z.apagada_em is null
               limit 100) y
    ) nl on true
   order by c.ultima_mensagem_em desc nulls last;
end;
$$;

-- ------------------------------------------------------- pessoas
-- Colegas do tenant com presença real (turno/pausa) e atendimentos em andamento.
create or replace function public.equipe_pessoas(p_tenant_id uuid)
returns table (
  user_id uuid, nome text, cargo text, role text, department_id uuid, setor text,
  presenca text, pausa text, pausa_fim timestamptz, atendimentos integer, ultimo_sinal timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fn_equipe_tenant_ok(p_tenant_id) then
    raise exception 'Sem acesso a este tenant' using errcode = '42501';
  end if;
  return query
  select p.user_id,
         coalesce(f.nome, 'Sem nome'),
         f.cargo, p.role, f.department_id, d.name,
         coalesce(sp.status, 'offline'),
         pr.name, sp.pause_expected_end_at,
         coalesce(a.qt, 0)::int,
         sp.last_heartbeat_at
    from public.profiles p
    left join public.funcionarios f on f.id = p.funcionario_id
    left join public.support_departments d on d.id = f.department_id
    left join public.support_agent_presence sp on sp.user_id = p.user_id
    left join public.support_pause_reasons pr on pr.id = sp.pause_reason_id
    left join lateral (
      select count(*) as qt from public.support_attendances sa
       where sa.tenant_id = p_tenant_id and sa.assigned_to = p.user_id and sa.status = 'in_progress'
    ) a on true
   where p.tenant_id = p_tenant_id
     and p.status = 'ativo' and p.access_status = 'active'
   order by coalesce(f.nome, 'Sem nome');
end;
$$;

-- ---------------------------------------------------- criar canal
create or replace function public.equipe_criar_canal(
  p_tenant_id uuid, p_nome text, p_descricao text default null,
  p_privado boolean default false, p_membros uuid[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_nome text := lower(regexp_replace(btrim(coalesce(p_nome,'')), '\s+', '-', 'g'));
begin
  if not public.fn_equipe_pode_gerir(p_tenant_id) then
    raise exception 'Só administrador ou gestor cria canal' using errcode = '42501';
  end if;
  v_nome := regexp_replace(v_nome, '^#+', '');
  if v_nome = '' or char_length(v_nome) > 60 then
    raise exception 'Nome do canal precisa ter entre 1 e 60 caracteres';
  end if;
  if exists (select 1 from public.equipe_canais where tenant_id = p_tenant_id and tipo = 'canal'
              and arquivado_em is null and lower(nome) = v_nome) then
    raise exception 'Já existe um canal chamado #%', v_nome;
  end if;

  begin
    insert into public.equipe_canais (tenant_id, tipo, nome, descricao, privado, criado_por, ultima_mensagem_em)
    values (p_tenant_id, 'canal', v_nome, nullif(btrim(p_descricao),''), coalesce(p_privado,false), v_uid, now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Já existe um canal chamado #%', v_nome;
  end;

  insert into public.equipe_membros (canal_id, user_id, tenant_id, lido_ate)
  select v_id, u, p_tenant_id, now()
    from (select v_uid as u union select unnest(coalesce(p_membros,'{}'))) s
   where exists (select 1 from public.profiles p where p.user_id = s.u and p.tenant_id = p_tenant_id
                   and (s.u = v_uid or (p.status = 'ativo' and p.access_status = 'active')))
  on conflict do nothing;

  insert into public.equipe_mensagens (tenant_id, canal_id, autor_id, tipo, corpo)
  values (p_tenant_id, v_id, v_uid, 'sistema', 'criou o canal');
  return v_id;
end;
$$;

-- -------------------------------------------- abrir conversa direta
-- 1 pessoa → dm; 2+ → grupo. Mesmo conjunto de pessoas = mesma conversa.
create or replace function public.equipe_abrir_dm(p_tenant_id uuid, p_user_ids uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_chave text;
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where user_id = v_uid and tenant_id = p_tenant_id) then
    -- DM é entre colegas do mesmo tenant; super admin simulando não conversa em nome de ninguém.
    raise exception 'Conversa direta só entre colegas do mesmo tenant' using errcode = '42501';
  end if;

  select array_agg(distinct u order by u) into v_ids
    from (select unnest(coalesce(p_user_ids,'{}')) as u union select v_uid) s
   where exists (select 1 from public.profiles p where p.user_id = s.u and p.tenant_id = p_tenant_id
                   and (s.u = v_uid or (p.status = 'ativo' and p.access_status = 'active')));

  if coalesce(array_length(v_ids,1),0) < 2 then
    raise exception 'Escolha pelo menos uma pessoa';
  end if;
  if array_length(v_ids,1) > 9 then
    raise exception 'Grupo direto aceita até 9 pessoas. Para mais, crie um canal.';
  end if;

  v_chave := array_to_string(v_ids, ',');
  select id into v_id from public.equipe_canais
   where tenant_id = p_tenant_id and tipo in ('dm','grupo') and dm_chave = v_chave;

  if v_id is null then
    insert into public.equipe_canais (tenant_id, tipo, dm_chave, criado_por)
    values (p_tenant_id, case when array_length(v_ids,1) = 2 then 'dm' else 'grupo' end, v_chave, v_uid)
    on conflict (tenant_id, dm_chave) where tipo in ('dm','grupo') do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.equipe_canais
       where tenant_id = p_tenant_id and tipo in ('dm','grupo') and dm_chave = v_chave;
    end if;
    insert into public.equipe_membros (canal_id, user_id, tenant_id, lido_ate)
    select v_id, u, p_tenant_id, now() from unnest(v_ids) u
    on conflict do nothing;
  end if;

  update public.equipe_membros set oculto_em = null
   where canal_id = v_id and user_id = v_uid and oculto_em is not null;
  return v_id;
end;
$$;

-- --------------------------------------------------------- enviar
create or replace function public.equipe_enviar(
  p_canal_id uuid, p_corpo text, p_parent_id uuid default null,
  p_mencoes uuid[] default '{}', p_menciona_todos boolean default false,
  p_anexos jsonb default '[]', p_refs jsonb default '[]'
) returns public.equipe_mensagens
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_c   public.equipe_canais;
  v_msg public.equipe_mensagens;
  v_corpo text := btrim(coalesce(p_corpo,''));
begin
  select * into v_c from public.equipe_canais where id = p_canal_id;
  if v_c.id is null or not public.fn_equipe_pode_ver(p_canal_id) then
    raise exception 'Sem acesso a esta conversa' using errcode = '42501';
  end if;
  if v_c.arquivado_em is not null then
    raise exception 'Canal arquivado não recebe mensagens';
  end if;
  if v_corpo = '' and coalesce(jsonb_array_length(p_anexos),0) = 0 and coalesce(jsonb_array_length(p_refs),0) = 0 then
    raise exception 'Mensagem vazia';
  end if;
  if p_parent_id is not null and not exists (
       select 1 from public.equipe_mensagens where id = p_parent_id and canal_id = p_canal_id and parent_id is null) then
    raise exception 'Mensagem de origem do fio não encontrada neste canal';
  end if;
  if not public.fn_equipe_anexos_validos(coalesce(p_anexos, '[]'::jsonb), v_c.tenant_id, p_canal_id) then
    raise exception 'Anexo inválido: envie o arquivo de novo';
  end if;
  if not public.fn_equipe_refs_validas(coalesce(p_refs, '[]'::jsonb), v_c.tenant_id) then
    raise exception 'Anexo inválido: ticket, cliente ou atendimento não encontrado nesta empresa';
  end if;

  insert into public.equipe_mensagens (tenant_id, canal_id, autor_id, parent_id, corpo, anexos, refs, mencoes, menciona_todos)
  values (v_c.tenant_id, p_canal_id, v_uid, p_parent_id, v_corpo,
          coalesce(p_anexos,'[]'), coalesce(p_refs,'[]'),
          -- só menciona quem é do tenant
          coalesce((select array_agg(distinct m) from unnest(coalesce(p_mencoes,'{}')) m
                     where exists (select 1 from public.profiles p where p.user_id = m and p.tenant_id = v_c.tenant_id)), '{}'),
          coalesce(p_menciona_todos,false) and v_c.tipo not in ('dm'))
  returning * into v_msg;

  if p_parent_id is null then
    update public.equipe_canais set ultima_mensagem_em = v_msg.created_at where id = p_canal_id;
  else
    update public.equipe_mensagens
       set respostas = respostas + 1,
           ultima_resposta_em = v_msg.created_at,
           respondentes = case when v_uid = any(respondentes) then respondentes else respondentes || v_uid end
     where id = p_parent_id;
  end if;

  if p_parent_id is null then
    -- quem envia leu o canal até aqui. Em geral/setor a linha é só de leitura
    -- (nasce "fora"): mandar mensagem no setor alheio não faz ninguém entrar nele.
    insert into public.equipe_membros (canal_id, user_id, tenant_id, lido_ate, saiu_em)
    values (p_canal_id, v_uid, v_c.tenant_id, v_msg.created_at,
            case when v_c.tipo in ('geral','setor') then now() end)
    on conflict (canal_id, user_id) do update
       set lido_ate = greatest(coalesce(equipe_membros.lido_ate, excluded.lido_ate), excluded.lido_ate),
           oculto_em = null;
  else
    -- resposta no fio marca só o FIO como lido: o canal pode ter novidade que
    -- a pessoa ainda não viu
    insert into public.equipe_fio_leitura (user_id, raiz_id, tenant_id, lido_ate)
    values (v_uid, p_parent_id, v_c.tenant_id, v_msg.created_at)
    on conflict (user_id, raiz_id) do update
       set lido_ate = greatest(equipe_fio_leitura.lido_ate, excluded.lido_ate);
    update public.equipe_membros set oculto_em = null
     where canal_id = p_canal_id and user_id = v_uid and oculto_em is not null;
  end if;

  -- arquivo usado não pode ir em outra mensagem
  update public.equipe_uploads set usado_em = now()
   where path in (select a->>'path' from jsonb_array_elements(v_msg.anexos) a);

  perform public.fn_equipe_avisar(v_msg);
  return v_msg;
end;
$$;

-- ------------------------------------------------- editar / apagar
create or replace function public.equipe_editar(p_mensagem_id uuid, p_corpo text, p_mencoes uuid[] default '{}')
returns public.equipe_mensagens
language plpgsql security definer set search_path = public as $$
declare v_m public.equipe_mensagens; v_corpo text := btrim(coalesce(p_corpo,''));
begin
  select * into v_m from public.equipe_mensagens where id = p_mensagem_id;
  if v_m.id is null or v_m.autor_id is distinct from auth.uid() or v_m.tipo <> 'texto' then
    raise exception 'Só o autor edita a mensagem' using errcode = '42501';
  end if;
  -- saiu do canal privado: não mexe mais no que escreveu lá
  if not public.fn_equipe_pode_ver(v_m.canal_id)
     or exists (select 1 from public.equipe_canais where id = v_m.canal_id and arquivado_em is not null) then
    raise exception 'Sem acesso a esta conversa' using errcode = '42501';
  end if;
  if v_m.apagada_em is not null then raise exception 'Mensagem apagada não pode ser editada'; end if;
  if v_corpo = '' and jsonb_array_length(v_m.anexos) = 0 then raise exception 'Mensagem vazia'; end if;
  update public.equipe_mensagens
     set corpo = v_corpo, editada_em = now(),
         mencoes = coalesce((select array_agg(distinct m) from unnest(coalesce(p_mencoes,'{}')) m
                              where exists (select 1 from public.profiles p where p.user_id = m and p.tenant_id = v_m.tenant_id)), '{}')
   where id = p_mensagem_id
  returning * into v_m;
  return v_m;
end;
$$;

create or replace function public.equipe_apagar(p_mensagem_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.equipe_mensagens; v_uid uuid := auth.uid();
begin
  select * into v_m from public.equipe_mensagens where id = p_mensagem_id;
  if v_m.id is null or not public.fn_equipe_pode_ver(v_m.canal_id) then
    raise exception 'Mensagem não encontrada' using errcode = '42501';
  end if;
  if v_m.autor_id is distinct from v_uid and not exists (
       select 1 from public.profiles p where p.user_id = v_uid
          and (p.is_super_admin or (p.tenant_id = v_m.tenant_id and p.role = 'admin'))) then
    raise exception 'Só o autor ou um administrador apaga a mensagem' using errcode = '42501';
  end if;
  update public.equipe_mensagens
     set corpo = '', anexos = '[]', refs = '[]', mencoes = '{}', menciona_todos = false,
         reacoes = '{}', fixada_em = null, fixada_por = null,
         apagada_em = now(), apagada_por = v_uid
   where id = p_mensagem_id and apagada_em is null;
end;
$$;

-- --------------------------------------------------------- reagir
-- Liga/desliga a reação do chamador. Devolve o mapa atualizado.
create or replace function public.equipe_reagir(p_mensagem_id uuid, p_emoji text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_m public.equipe_mensagens; v_uid text := auth.uid()::text; v_lista jsonb; v_r jsonb;
begin
  if p_emoji is null or char_length(p_emoji) > 32 then raise exception 'Reação inválida'; end if;
  select * into v_m from public.equipe_mensagens where id = p_mensagem_id for update;
  if v_m.id is null or not public.fn_equipe_pode_ver(v_m.canal_id) or v_m.apagada_em is not null then
    raise exception 'Mensagem não encontrada' using errcode = '42501';
  end if;
  v_lista := coalesce(v_m.reacoes -> p_emoji, '[]'::jsonb);
  if v_lista ? v_uid then
    v_lista := v_lista - v_uid;
  else
    if not (v_m.reacoes ? p_emoji) and (select count(*) from jsonb_object_keys(v_m.reacoes)) >= 20 then
      raise exception 'Limite de reações diferentes nesta mensagem';
    end if;
    v_lista := v_lista || to_jsonb(v_uid);
  end if;
  v_r := case when jsonb_array_length(v_lista) = 0 then v_m.reacoes - p_emoji
              else jsonb_set(v_m.reacoes, array[p_emoji], v_lista) end;
  update public.equipe_mensagens set reacoes = v_r where id = p_mensagem_id;
  return v_r;
end;
$$;

-- ------------------------------------------------------ marcar lido
create or replace function public.equipe_marcar_lido(p_canal_id uuid, p_ate timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid;
begin
  select tenant_id into v_t from public.equipe_canais where id = p_canal_id;
  if v_t is null or not public.fn_equipe_pode_ver(p_canal_id) then
    raise exception 'Sem acesso a esta conversa' using errcode = '42501';
  end if;
  insert into public.equipe_membros (canal_id, user_id, tenant_id, lido_ate, saiu_em)
  values (p_canal_id, auth.uid(), v_t, coalesce(p_ate, clock_timestamp()), now())   -- linha só de leitura: nasce "fora"
  on conflict (canal_id, user_id) do update
     set lido_ate = greatest(coalesce(equipe_membros.lido_ate, excluded.lido_ate), excluded.lido_ate);
  perform public.fn_equipe_limpar_avisos(p_canal_id, null);
end;
$$;

-- --------------------------------------------- entrar / sair / ocultar
create or replace function public.equipe_entrar(p_canal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.equipe_canais;
begin
  select * into v_c from public.equipe_canais where id = p_canal_id;
  if v_c.id is null or not public.fn_equipe_pode_ver(p_canal_id)
     or v_c.tipo not in ('canal','setor') or v_c.arquivado_em is not null then
    raise exception 'Não é possível entrar neste canal' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where user_id = auth.uid() and tenant_id = v_c.tenant_id) then
    raise exception 'Só colaboradores do tenant entram no canal' using errcode = '42501';
  end if;
  insert into public.equipe_membros (canal_id, user_id, tenant_id, lido_ate)
  values (p_canal_id, auth.uid(), v_c.tenant_id, now())
  on conflict (canal_id, user_id) do update set saiu_em = null, entrou_em = now();
end;
$$;

create or replace function public.equipe_sair(p_canal_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  select tipo into v_tipo from public.equipe_canais where id = p_canal_id;
  if v_tipo in ('dm','grupo') then
    -- conversa direta não se abandona: some da lista até chegar mensagem nova
    update public.equipe_membros set oculto_em = now() where canal_id = p_canal_id and user_id = auth.uid();
  elsif v_tipo in ('canal','setor') then
    update public.equipe_membros set saiu_em = now() where canal_id = p_canal_id and user_id = auth.uid();
  else
    raise exception 'Não é possível sair do #geral';
  end if;
end;
$$;

create or replace function public.equipe_adicionar_membros(p_canal_id uuid, p_user_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.equipe_canais;
begin
  select * into v_c from public.equipe_canais where id = p_canal_id;
  if v_c.id is null or v_c.tipo <> 'canal' or not public.fn_equipe_pode_ver(p_canal_id) then
    raise exception 'Canal não encontrado' using errcode = '42501';
  end if;
  if not public.fn_equipe_pode_gerir(v_c.tenant_id) and v_c.criado_por is distinct from auth.uid() then
    raise exception 'Só administrador, gestor ou quem criou o canal adiciona pessoas' using errcode = '42501';
  end if;
  insert into public.equipe_membros (canal_id, user_id, tenant_id, lido_ate)
  select p_canal_id, p.user_id, v_c.tenant_id, now()
    from public.profiles p where p.user_id = any(p_user_ids) and p.tenant_id = v_c.tenant_id
     and p.status = 'ativo' and p.access_status = 'active'
  on conflict (canal_id, user_id) do update set saiu_em = null;
end;
$$;

create or replace function public.equipe_silenciar(p_canal_id uuid, p_silenciar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_t uuid;
begin
  select tenant_id into v_t from public.equipe_canais where id = p_canal_id;
  if v_t is null or not public.fn_equipe_pode_ver(p_canal_id) then
    raise exception 'Sem acesso a esta conversa' using errcode = '42501';
  end if;
  -- Linha nova nasce SEMPRE "fora" (saiu_em preenchido): silenciar não pode
  -- virar participação. Quem participa de canal/dm/grupo já tem a linha, e aí
  -- só o silenciado muda. Em geral/setor quem participa é calculado.
  insert into public.equipe_membros (canal_id, user_id, tenant_id, silenciado, saiu_em)
  values (p_canal_id, auth.uid(), v_t, p_silenciar, now())
  on conflict (canal_id, user_id) do update set silenciado = excluded.silenciado;
end;
$$;

-- ------------------------------------------------------ fixar / salvar
create or replace function public.equipe_fixar(p_mensagem_id uuid, p_fixar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.equipe_mensagens; v_c public.equipe_canais;
begin
  select * into v_m from public.equipe_mensagens where id = p_mensagem_id;
  select * into v_c from public.equipe_canais where id = v_m.canal_id;
  if v_m.id is null or not public.fn_equipe_pode_ver(v_m.canal_id) or v_m.apagada_em is not null then
    raise exception 'Mensagem não encontrada' using errcode = '42501';
  end if;
  if v_c.tipo not in ('dm','grupo') and not public.fn_equipe_pode_gerir(v_c.tenant_id)
     and v_c.criado_por is distinct from auth.uid() then
    raise exception 'Só administrador, gestor ou quem criou o canal fixa mensagens' using errcode = '42501';
  end if;
  update public.equipe_mensagens
     set fixada_em = case when p_fixar then now() end,
         fixada_por = case when p_fixar then auth.uid() end
   where id = p_mensagem_id;
end;
$$;

create or replace function public.equipe_salvar(p_mensagem_id uuid, p_salvar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.equipe_mensagens;
begin
  select * into v_m from public.equipe_mensagens where id = p_mensagem_id;
  if v_m.id is null or not public.fn_equipe_pode_ver(v_m.canal_id) then
    raise exception 'Mensagem não encontrada' using errcode = '42501';
  end if;
  if p_salvar then
    insert into public.equipe_salvos (user_id, mensagem_id, tenant_id)
    values (auth.uid(), p_mensagem_id, v_m.tenant_id) on conflict do nothing;
  else
    delete from public.equipe_salvos where user_id = auth.uid() and mensagem_id = p_mensagem_id;
  end if;
end;
$$;

-- ------------------------------------------------------------ fios
-- Fios de que participo (escrevi a mensagem de origem, respondi ou fui
-- mencionado numa resposta), com quantas respostas ainda não li.
create or replace function public.equipe_meus_fios(p_tenant_id uuid, p_limite integer default 40)
returns table (
  raiz_id uuid, canal_id uuid, canal_tipo text, canal_nome text, canal_outros uuid[],
  autor_id uuid, corpo text, apagada boolean, created_at timestamptz,
  respostas integer, ultima_resposta_em timestamptz, respondentes uuid[],
  nao_lidas integer, mencoes integer
)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not public.fn_equipe_tenant_ok(p_tenant_id) then
    raise exception 'Sem acesso a este tenant' using errcode = '42501';
  end if;
  return query
  select r.id, r.canal_id, c.tipo, c.nome,
         case when c.tipo in ('dm','grupo') then
           array(select mm.user_id from public.equipe_membros mm
                  where mm.canal_id = c.id and mm.saiu_em is null and mm.user_id <> v_uid)
         else '{}'::uuid[] end,
         r.autor_id, r.corpo, r.apagada_em is not null, r.created_at,
         r.respostas, r.ultima_resposta_em, r.respondentes,
         coalesce(n.qt, 0)::int, coalesce(n.men, 0)::int
    from public.equipe_mensagens r
    join public.equipe_canais c on c.id = r.canal_id
    left join public.equipe_fio_leitura fl on fl.raiz_id = r.id and fl.user_id = v_uid
    left join lateral (
      select count(*) as qt,
             count(*) filter (where v_uid = any(x.mencoes) or x.menciona_todos) as men
        from public.equipe_mensagens x
       where x.parent_id = r.id
         and x.created_at > coalesce(fl.lido_ate, '-infinity')
         and x.autor_id is distinct from v_uid
         and x.apagada_em is null
    ) n on true
   where r.tenant_id = p_tenant_id
     and r.parent_id is null
     and r.respostas > 0
     and (r.autor_id = v_uid or v_uid = any(r.respondentes)
          or exists (select 1 from public.equipe_mensagens y
                      where y.parent_id = r.id and v_uid = any(y.mencoes)))
     and public.fn_equipe_pode_ver(r.canal_id)
   order by r.ultima_resposta_em desc nulls last
   limit greatest(1, least(coalesce(p_limite, 40), 100));
end;
$$;

create or replace function public.equipe_marcar_fio_lido(p_raiz_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.equipe_mensagens;
begin
  select * into v_m from public.equipe_mensagens where id = p_raiz_id and parent_id is null;
  if v_m.id is null or not public.fn_equipe_pode_ver(v_m.canal_id) then
    raise exception 'Fio não encontrado' using errcode = '42501';
  end if;
  insert into public.equipe_fio_leitura (user_id, raiz_id, tenant_id, lido_ate)
  values (auth.uid(), p_raiz_id, v_m.tenant_id, clock_timestamp())
  on conflict (user_id, raiz_id) do update set lido_ate = excluded.lido_ate;
  perform public.fn_equipe_limpar_avisos(v_m.canal_id, p_raiz_id);
end;
$$;

-- ----------------------------------------------------------- busca
-- Texto nas mensagens que eu posso ler, sem diferenciar acento nem maiúscula.
-- Sem índice de texto de propósito: volume de chat interno é pequeno e o
-- recorte por tenant + data já corta a varredura. Rever se passar de ~200 mil
-- mensagens num tenant.
create or replace function public.equipe_buscar(p_tenant_id uuid, p_termo text, p_limite integer default 30)
returns table (
  id uuid, canal_id uuid, parent_id uuid, autor_id uuid, corpo text, created_at timestamptz,
  canal_tipo text, canal_nome text, canal_outros uuid[]
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_termo text := public.f_unaccent(lower(btrim(coalesce(p_termo,''))));
begin
  if not public.fn_equipe_tenant_ok(p_tenant_id) then
    raise exception 'Sem acesso a este tenant' using errcode = '42501';
  end if;
  if char_length(v_termo) < 2 then return; end if;
  v_termo := replace(replace(replace(v_termo, '\', '\\'), '%', '\%'), '_', '\_');
  return query
  with visiveis as (
    select c.id, c.tipo, c.nome from public.equipe_canais c
     where c.tenant_id = p_tenant_id and public.fn_equipe_pode_ver(c.id)
  )
  select m.id, m.canal_id, m.parent_id, m.autor_id, m.corpo, m.created_at, v.tipo, v.nome,
         case when v.tipo in ('dm','grupo') then
           array(select mm.user_id from public.equipe_membros mm
                  where mm.canal_id = v.id and mm.saiu_em is null and mm.user_id <> v_uid)
         else '{}'::uuid[] end
    from public.equipe_mensagens m
    join visiveis v on v.id = m.canal_id
   where m.tenant_id = p_tenant_id
     and m.apagada_em is null
     and m.tipo = 'texto'
     and public.f_unaccent(lower(m.corpo)) like '%' || v_termo || '%'
   order by m.created_at desc
   limit greatest(1, least(coalesce(p_limite, 30), 100));
end;
$$;

-- ------------------------------------------------------------- avisos
-- Uma pessoa enxerga o canal? (fn_equipe_pode_ver é "eu"; esta é "fulano",
-- para decidir quem recebe aviso. Sem o atalho do super admin: aviso é só
-- para quem é do tenant.)
create or replace function public.fn_equipe_usuario_ve(p_canal_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.equipe_canais c
      join public.profiles p on p.user_id = p_user_id and p.tenant_id = c.tenant_id
                            and p.status = 'ativo' and p.access_status = 'active'
     where c.id = p_canal_id
       and case
             when c.tipo in ('dm','grupo') or (c.tipo = 'canal' and c.privado) then
               exists (select 1 from public.equipe_membros m
                        where m.canal_id = c.id and m.user_id = p_user_id and m.saiu_em is null)
             when c.tipo = 'setor' then
               p.role in ('admin','head')
               or exists (select 1 from public.support_department_members dm
                           where dm.department_id = c.department_id and dm.user_id = p_user_id and dm.is_active)
               or exists (select 1 from public.equipe_membros m
                           where m.canal_id = c.id and m.user_id = p_user_id and m.saiu_em is null)
             else true
           end
  );
$$;

-- Avisa quem precisa saber de uma mensagem nova (sino + push).
--   DM e grupo  -> os outros participantes (menos quem silenciou)
--   @pessoa     -> a pessoa, mesmo com a conversa silenciada, se ela vê o canal
--   @todos      -> quem participa do canal (menos quem silenciou)
--   fio         -> quem começou o fio e quem respondeu nele
-- Rajada na mesma conversa (ou no mesmo fio) não vira pilha: enquanto o aviso
-- anterior não foi lido, ele é ATUALIZADO (título, motivo e contador; o texto nunca vai)
-- e o delivered_at do destinatário muda, que é o que a tela trata como "chegou
-- de novo" (som e toast). O push só sai no primeiro, porque o gatilho de push
-- é de INSERT.
create or replace function public.fn_equipe_avisar(p_msg public.equipe_mensagens)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_c       public.equipe_canais;
  v_autor   text;
  v_titulo  text;
  v_corpo   text;
  v_url     text;
  v_onde    text;
  v_raiz    uuid := p_msg.parent_id;
  r         record;
  v_nr      uuid;
  v_n       uuid;
begin
  select * into v_c from public.equipe_canais where id = p_msg.canal_id;
  if v_c.id is null or p_msg.tipo <> 'texto' then return; end if;

  select coalesce(f.nome, 'Um colega') into v_autor
    from public.profiles p left join public.funcionarios f on f.id = p.funcionario_id
   where p.user_id = p_msg.autor_id;
  v_autor := coalesce(v_autor, 'Um colega');

  -- ⚠️ O TEXTO DA MENSAGEM NÃO VAI PARA O AVISO. A policy notif_select de
  -- produção deixa qualquer pessoa do tenant ler a tabela notifications inteira
  -- (não filtra por destinatário): a prévia de uma DM vazaria para a empresa.
  -- Título e corpo dizem só quem e onde; a tela busca a prévia em
  -- equipe_mensagens, que tem a RLS certa. Nome de canal privado também não vai.
  v_onde := case v_c.tipo when 'setor' then 'Canal ' || v_c.nome
                           when 'canal' then case when v_c.privado then 'um canal privado' else '#' || v_c.nome end
                           else '#' || v_c.nome end;

  v_url := '/equipe?c=' || v_c.id
        || case when v_raiz is not null then '&f=' || v_raiz || '&m=' || v_raiz else '&m=' || p_msg.id end;

  for r in
    with candidatos as (
      -- conversa direta
      select m.user_id, 'dm'::text as motivo, 1 as peso
        from public.equipe_membros m
       where v_c.tipo in ('dm','grupo') and m.canal_id = v_c.id and m.saiu_em is null and not m.silenciado
      union all
      -- menção direta (fura o silêncio)
      select u, 'mencao', 0 from unnest(p_msg.mencoes) u
      union all
      -- @todos
      select p.user_id, 'todos', 2
        from public.profiles p
        left join public.equipe_membros m on m.canal_id = v_c.id and m.user_id = p.user_id
       where p_msg.menciona_todos and v_c.tipo not in ('dm','grupo')
         and p.tenant_id = v_c.tenant_id and not coalesce(m.silenciado, false)
         and public.fn_equipe_participo(v_c.id, p.user_id)
      union all
      -- fio: quem começou e quem respondeu
      select x.u, 'fio', 3
        from public.equipe_mensagens raiz,
             lateral unnest(array_append(raiz.respondentes, raiz.autor_id)) as x(u)
       where v_raiz is not null and raiz.id = v_raiz
    )
    -- um aviso por pessoa, pelo motivo mais forte (menção > dm > todos > fio)
    select distinct on (user_id) user_id, motivo
      from candidatos
     where user_id is not null and user_id is distinct from p_msg.autor_id
       and public.fn_equipe_usuario_ve(v_c.id, user_id)
     order by user_id, peso
  loop
    v_titulo := case
      when r.motivo = 'mencao' and v_c.tipo not in ('dm','grupo') then v_autor || ' mencionou você em ' || v_onde
      when v_raiz is not null then v_autor || ' respondeu no fio'
      when v_c.tipo = 'dm' then v_autor
      when v_c.tipo = 'grupo' then v_autor || ' no grupo'
      when r.motivo = 'todos' then v_autor || ' avisou todos em ' || v_onde
      else v_autor end;
    v_corpo := case
      when v_raiz is not null then 'Nova resposta no fio'
      when v_c.tipo = 'dm' then 'Nova mensagem direta'
      when v_c.tipo = 'grupo' then 'Nova mensagem no grupo'
      when r.motivo = 'mencao' then 'Mencionou você'
      when r.motivo = 'todos' then 'Aviso para todos'
      else 'Nova mensagem' end;

    -- aviso ainda não lido desta conversa (ou deste fio) para esta pessoa?
    select nr.id, n.id into v_nr, v_n
      from public.notification_recipients nr
      join public.notifications n on n.id = nr.notification_id
     where nr.user_id = r.user_id and nr.read_at is null and nr.dismissed_at is null
       and n.type = 'equipe_mensagem'
       and n.metadata->>'canal_id' = v_c.id::text
       and coalesce(n.metadata->>'raiz_id', '') = coalesce(v_raiz::text, '')
       and n.created_at > now() - interval '12 hours'
     order by n.created_at desc
     limit 1;

    if v_n is not null then
      update public.notifications
         set title = v_titulo, body = v_corpo, action_url = v_url,
             metadata = metadata || jsonb_build_object(
               'mensagem_id', p_msg.id, 'motivo', r.motivo,
               'unread_count', coalesce((metadata->>'unread_count')::int, 1) + 1)
       where id = v_n;
      -- delivered_at novo = a tela toca de novo; @todos nunca toca
      if r.motivo <> 'todos' then
        update public.notification_recipients set delivered_at = clock_timestamp() where id = v_nr;
      end if;
    else
      insert into public.notifications (tenant_id, type, severity, title, body, action_url, metadata, created_by)
      values (v_c.tenant_id, 'equipe_mensagem', 'info', v_titulo, v_corpo, v_url,
              jsonb_build_object('canal_id', v_c.id, 'raiz_id', v_raiz, 'mensagem_id', p_msg.id,
                                 'motivo', r.motivo, 'unread_count', 1),
              p_msg.autor_id)
      returning id into v_n;
      -- @todos é aviso para a empresa, não demanda pessoal: fica no sino, sem
      -- push, som nem toast (silent_mode). Regra de 26/09: o celular só avisa o
      -- que está no nome da pessoa.
      insert into public.notification_recipients (tenant_id, notification_id, user_id, silent_mode)
      values (v_c.tenant_id, v_n, r.user_id, r.motivo = 'todos');
    end if;
    v_n := null; v_nr := null;
  end loop;
exception when others then
  -- aviso nunca derruba o envio da mensagem
  raise warning 'fn_equipe_avisar: %', sqlerrm;
end;
$$;
revoke all on function public.fn_equipe_avisar(public.equipe_mensagens) from public, anon, authenticated;
revoke all on function public.fn_equipe_usuario_ve(uuid, uuid) from public, anon, authenticated;

-- Leu a conversa (ou o fio) = o aviso dela sai do sino.
create or replace function public.fn_equipe_limpar_avisos(p_canal_id uuid, p_raiz_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.notification_recipients nr
     set read_at = now()
    from public.notifications n
   where n.id = nr.notification_id
     and nr.user_id = auth.uid() and nr.read_at is null
     and n.type = 'equipe_mensagem'
     and n.metadata->>'canal_id' = p_canal_id::text
     and coalesce(n.metadata->>'raiz_id', '') = coalesce(p_raiz_id::text, '');
$$;
revoke all on function public.fn_equipe_limpar_avisos(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------- arquivos
-- Bucket privado. Upload e leitura só pela edge function `equipe-anexos`
-- (service_role): upload direto do navegador para o Storage não funciona
-- neste projeto. O caminho é <tenant>/<canal>/<uuid>.<ext>.
insert into storage.buckets (id, name, public, file_size_limit)
values ('equipe-anexos', 'equipe-anexos', false, 26214400)   -- 25 MB
on conflict (id) do nothing;

-- Todo upload é registrado pela edge function (service_role). Sem o registro, um
-- membro que guardou o caminho de um arquivo (vem no payload da mensagem)
-- poderia reenviá-lo numa mensagem nova e ressuscitar o que foi apagado.
create table if not exists public.equipe_uploads (
  path       text primary key,
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  canal_id   uuid not null references public.equipe_canais(id) on delete cascade,
  user_id    uuid not null,
  criado_em  timestamptz not null default now(),
  usado_em   timestamptz
);
alter table public.equipe_uploads enable row level security;   -- sem policy: só service_role e RPCs
revoke all on public.equipe_uploads from anon, authenticated;

-- anexos = [{"path","nome","mime","tamanho","largura"?,"altura"?}], até 10.
-- O caminho TEM de ser da pasta deste canal: sem isso, alguém anexaria o
-- arquivo de uma DM alheia numa mensagem sua e a function passaria a entregar.
create or replace function public.fn_equipe_anexos_validos(p_anexos jsonb, p_tenant_id uuid, p_canal_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare a jsonb; v_prefixo text := p_tenant_id::text || '/' || p_canal_id::text || '/';
begin
  if jsonb_typeof(p_anexos) <> 'array' or jsonb_array_length(p_anexos) > 10 then return false; end if;
  for a in select * from jsonb_array_elements(p_anexos) loop
    if jsonb_typeof(a) <> 'object'
       or coalesce(a->>'path', '') !~ ('^' || v_prefixo || '[0-9a-f-]{36}\.[a-z0-9]{1,5}$')
       or char_length(coalesce(a->>'nome', '')) not between 1 and 200
       or char_length(coalesce(a->>'mime', '')) not between 1 and 120
       or coalesce((a->>'tamanho')::bigint, -1) not between 0 and 26214400
       -- subido por quem envia, para esta conversa, e ainda não usado
       or not exists (select 1 from public.equipe_uploads u
                       where u.path = a->>'path' and u.canal_id = p_canal_id
                         and u.user_id = auth.uid() and u.usado_em is null) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;   -- tamanho não numérico e afins
end;
$$;

-- Quais destes arquivos estão numa mensagem NÃO apagada do canal. Só a edge
-- function chama (service_role): apagar a mensagem corta o acesso ao arquivo.
create or replace function public.fn_equipe_anexos_vivos(p_canal_id uuid, p_paths text[])
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p), '{}')
    from unnest(p_paths) p
   where exists (select 1 from public.equipe_mensagens m
                  where m.canal_id = p_canal_id and m.apagada_em is null
                    and m.anexos @> jsonb_build_array(jsonb_build_object('path', p)));
$$;
-- sem WHERE: o planejador não prova que "anexos @> ..." implica "anexos <> []"
create index if not exists idx_equipe_msg_anexos on public.equipe_mensagens using gin (anexos jsonb_path_ops);
revoke all on function public.fn_equipe_anexos_vivos(uuid, text[]) from public, anon, authenticated;
grant execute on function public.fn_equipe_anexos_vivos(uuid, text[]) to service_role;

-- ---------------------------------------------------- cartões vivos
-- refs = [{"tipo":"ticket|cliente|atendimento","id":"<uuid>"}], até 5, todos
-- do mesmo tenant do canal. Só confere que existem: o CONTEÚDO do cartão é
-- lido por equipe_cartoes com a permissão de quem está vendo.
create or replace function public.fn_equipe_refs_validas(p_refs jsonb, p_tenant_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_id uuid; v_ok boolean;
begin
  if jsonb_typeof(p_refs) <> 'array' or jsonb_array_length(p_refs) > 5 then return false; end if;
  for r in select * from jsonb_array_elements(p_refs) loop
    begin v_id := (r->>'id')::uuid; exception when others then return false; end;
    -- o "then" do case dentro de um "if" confunde o plpgsql: resultado na variável
    v_ok := case r->>'tipo'
      when 'ticket'      then exists (select 1 from public.support_tickets where id = v_id and tenant_id = p_tenant_id and deleted_at is null)
      when 'cliente'     then exists (select 1 from public.clientes where id = v_id and tenant_id = p_tenant_id)
      when 'atendimento' then exists (select 1 from public.support_attendances where id = v_id and tenant_id = p_tenant_id)
      else false end;
    if not v_ok then return false; end if;
  end loop;
  return true;
end;
$$;

-- SECURITY INVOKER de propósito: cada colega vê o cartão com a PRÓPRIA
-- permissão (RLS de tickets, clientes e conversas, inclusive recorte por
-- unidade). O que a pessoa não pode ver volta sem linha, e a tela mostra
-- "sem acesso" no lugar do cartão.
create or replace function public.equipe_cartoes(p_refs jsonb)
returns table (tipo text, id uuid, dados jsonb)
language sql stable security invoker set search_path = public as $$
  with r as (
    select distinct x->>'tipo' as tipo, (x->>'id')::uuid as id
      from jsonb_array_elements(coalesce(p_refs, '[]'::jsonb)) x
     where x->>'id' ~* '^[0-9a-f-]{36}$'
     limit 50
  )
  select 'ticket', t.id, jsonb_build_object(
           'codigo', t.ticket_code, 'assunto', t.assunto, 'prioridade', t.prioridade,
           'aberto_em', t.aberto_em, 'concluido_em', t.concluido_em,
           'previsao', t.previsao_encerramento, 'responsavel', t.responsavel_user_id,
           'status', st.name, 'status_cor', st.color, 'status_final', coalesce(st.is_terminal, false),
           'cliente', coalesce(nullif(c.nome_fantasia, ''), c.razao_social))
    from r join public.support_tickets t on t.id = r.id and r.tipo = 'ticket' and t.deleted_at is null
    left join public.ticket_statuses st on st.id = t.status_id
    left join public.clientes c on c.id = t.cliente_id
  union all
  select 'cliente', c.id, jsonb_build_object(
           'nome', coalesce(nullif(c.nome_fantasia, ''), c.razao_social), 'razao_social', c.razao_social,
           'cnpj', c.cnpj, 'codigo', c.codigo_sequencial, 'cancelado', c.cancelado,
           'mensalidade', c.mensalidade, 'cliente_desde', coalesce(c.data_ativacao, c.data_cadastro),
           'tickets_abertos', (select count(*) from public.support_tickets tk
                                where tk.cliente_id = c.id and tk.concluido_em is null and tk.deleted_at is null))
    from r join public.clientes c on c.id = r.id and r.tipo = 'cliente'
  union all
  select 'atendimento', a.id, jsonb_build_object(
           'codigo', a.attendance_code, 'status', a.status, 'aberto_em', a.opened_at,
           'responsavel', a.assigned_to, 'conversa_id', a.conversation_id,
           'contato', coalesce(nullif(ct.name, ''), ct.phone_number), 'telefone', ct.phone_number,
           'cliente', coalesce(nullif(cl.nome_fantasia, ''), cl.razao_social),
           'ultima_do_cliente', a.last_customer_message_at, 'ultima_nossa', a.last_operator_message_at,
           'previa', cv.last_message_preview, 'grupo', coalesce(cv.is_group, false))
    from r join public.support_attendances a on a.id = r.id and r.tipo = 'atendimento'
    -- a conversa é quem carrega o recorte de unidade: sem ela visível, sem cartão
    join public.whatsapp_conversations cv on cv.id = a.conversation_id
    left join public.whatsapp_contacts ct on ct.id = a.contact_id
    left join public.clientes cl on cl.id = a.cliente_id;
$$;

-- ----------------------------------------------------------- salvos
create or replace function public.equipe_meus_salvos(p_tenant_id uuid)
returns table (
  id uuid, canal_id uuid, parent_id uuid, autor_id uuid, corpo text, created_at timestamptz,
  apagada boolean, salvo_em timestamptz, canal_tipo text, canal_nome text, canal_outros uuid[]
)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if not public.fn_equipe_tenant_ok(p_tenant_id) then
    raise exception 'Sem acesso a este tenant' using errcode = '42501';
  end if;
  return query
  select m.id, m.canal_id, m.parent_id, m.autor_id, m.corpo, m.created_at, m.apagada_em is not null,
         s.created_at, c.tipo, c.nome,
         case when c.tipo in ('dm','grupo') then
           array(select mm.user_id from public.equipe_membros mm
                  where mm.canal_id = c.id and mm.saiu_em is null and mm.user_id <> v_uid)
         else '{}'::uuid[] end
    from public.equipe_salvos s
    join public.equipe_mensagens m on m.id = s.mensagem_id
    join public.equipe_canais c on c.id = m.canal_id
   where s.user_id = v_uid and s.tenant_id = p_tenant_id
     -- saí do canal privado: o salvo some junto
     and public.fn_equipe_pode_ver(m.canal_id)
   order by s.created_at desc;
end;
$$;

-- ------------------------------------------------------------ grants
-- Helpers de RLS e RPCs de tela: authenticated executa (a checagem é interna).
do $$
declare f text;
begin
  foreach f in array array[
    'fn_equipe_tenant_ok(uuid)','fn_equipe_pode_gerir(uuid)','fn_equipe_pode_ver(uuid)',
    'equipe_garantir_canais(uuid)','equipe_minhas_conversas(uuid)','equipe_pessoas(uuid)',
    'equipe_criar_canal(uuid,text,text,boolean,uuid[])','equipe_abrir_dm(uuid,uuid[])',
    'equipe_enviar(uuid,text,uuid,uuid[],boolean,jsonb,jsonb)','equipe_editar(uuid,text,uuid[])',
    'equipe_apagar(uuid)','equipe_reagir(uuid,text)','equipe_marcar_lido(uuid,timestamptz)',
    'equipe_entrar(uuid)','equipe_sair(uuid)','equipe_adicionar_membros(uuid,uuid[])',
    'equipe_silenciar(uuid,boolean)','equipe_fixar(uuid,boolean)','equipe_salvar(uuid,boolean)',
    'equipe_meus_fios(uuid,integer)','equipe_marcar_fio_lido(uuid)','equipe_buscar(uuid,text,integer)',
    'equipe_meus_salvos(uuid)','equipe_cartoes(jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- Auxiliares só usadas por dentro das RPCs (SECURITY DEFINER): com EXECUTE para
-- authenticated elas viram oráculo (ex.: "fulano está nesta DM?", "este ticket
-- existe em outro tenant?"). O default privileges do banco dá EXECUTE a
-- authenticated em toda função nova, então o revoke tem de ser explícito.
revoke all on function public.fn_equipe_participo(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_equipe_refs_validas(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.fn_equipe_anexos_validos(jsonb, uuid, uuid) from public, anon, authenticated;

grant select on public.equipe_canais, public.equipe_membros, public.equipe_mensagens, public.equipe_salvos,
  public.equipe_fio_leitura to authenticated;

-- ---------------------------------------------------------- realtime
-- Só mensagens (novas, editadas, reações, contagem do fio). equipe_canais fica
-- FORA de propósito: cada mensagem atualiza ultima_mensagem_em, e isso seria um
-- 2º evento por mensagem avaliado pela RLS de cada pessoa online. Canal novo
-- (DM, canal criado) chega pela primeira mensagem dele, que é um INSERT aqui.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='equipe_mensagens') then
    alter publication supabase_realtime add table public.equipe_mensagens;
  end if;
end $$;

commit;
