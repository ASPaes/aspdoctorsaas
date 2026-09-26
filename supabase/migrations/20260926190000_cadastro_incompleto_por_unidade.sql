-- Cadastro incompleto obedece a unidade.
--
-- As 5 funções da aba eram SECURITY DEFINER e só olhavam o tenant: um usuário
-- restrito a uma unidade (acesso_todas_unidades = false) via e gravava a carteira
-- da empresa inteira. Medido em 26/09 na Digi Office: o Julio, restrito à Digi Up,
-- via "Origem da venda 198" = 79 Digi Office + 75 Digi Up + 44 Nutrebem.
--
-- A régua passa a ser a mesma do resto do sistema: as unidades permitidas ao
-- usuário e, dentro delas, as marcadas no filtro global (user_view_state).
-- Cliente sem unidade só aparece para quem vê todas e está sem filtro.

create or replace function public.fn_cadastro_escopo_unidades()
 returns bigint[]
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- NULL = sem restrição. '{}' = não vê nada (restrito sem unidade liberada).
  select case
    when coalesce(current_setting('role', true), '') = 'service_role' then null
    -- Super admin não é restringido, mas respeita o filtro que escolheu.
    when public.is_super_admin() then
      (select nullif(v.unidade_ids, '{}') from public.user_view_state v where v.user_id = auth.uid())
    else coalesce(public.user_view_unidades(), public.user_allowed_unidades())
  end;
$function$;

revoke all on function public.fn_cadastro_escopo_unidades() from public, anon;
grant execute on function public.fn_cadastro_escopo_unidades() to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_cadastro_incompleto_resumo(p_tenant_id uuid)
 RETURNS TABLE(campo text, escopo text, rotulo text, indicador text, em_lote boolean, faltando integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_esc bigint[];
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  -- Só as unidades que quem chamou pode ver, e dentro delas as do filtro global.
  v_esc := public.fn_cadastro_escopo_unidades();

  return query
  with defs(campo, escopo, rotulo, indicador, em_lote) as (values
    ('unidade_base_id',        'cliente',   'Unidade base',           'Filtro global de unidade e todo painel por unidade', true),
    ('funcionario_id',         'produto',   'Vendedor',               'Vendas e carteira por vendedor',                     true),
    ('origem_venda_id',        'produto',   'Origem da venda',        'Aquisição por origem',                               true),
    ('area_atuacao_id',        'cliente',   'Área de atuação',        'Segmentação da carteira',                            true),
    ('segmento_id',            'cliente',   'Segmento',               'Segmentação da carteira',                            true),
    ('fornecedor_id',          'produto',   'Fornecedor',             'Custo e margem por fornecedor',                      true),
    ('data_venda',             'produto',   'Data da venda',          'Vendas por período e early churn',                   true),
    ('data_ativacao',          'produto',   'Data de ativação',       'Tempo entre venda e ativação',                       true),
    ('motivo_cancelamento_id', 'cancelado', 'Motivo do cancelamento', 'Análise de churn por motivo',                        true),
    ('cidade_id',              'cliente',   'Cidade',                 'Distribuição geográfica da carteira',                false),
    ('estado_id',              'cliente',   'Estado',                 'Distribuição geográfica da carteira',                false),
    ('data_proximo_reajuste',  'produto',   'Data do próximo reajuste','Reajustes previstos e faturamento futuro',           false),
    ('vlr_custo',              'produto',   'Custo do produto',       'Margem e lucro por cliente',                         false),
    ('telefone_whatsapp',      'cliente',   'WhatsApp',               'Atendimento e cobrança',                             false),
    ('razao_social',           'cliente',   'Razão social',           'Toda listagem e relatório',                          false)
  ),
  contagens(campo, faltando) as (
    select 'unidade_base_id', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(c.cancelado,false)=false and c.unidade_base_id is null
    union all select 'cidade_id', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(c.cancelado,false)=false and c.cidade_id is null
    union all select 'estado_id', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(c.cancelado,false)=false and c.estado_id is null
    union all select 'area_atuacao_id', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(c.cancelado,false)=false and c.area_atuacao_id is null
    union all select 'segmento_id', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(c.cancelado,false)=false and c.segmento_id is null
    union all select 'telefone_whatsapp', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(c.cancelado,false)=false and coalesce(btrim(c.telefone_whatsapp),'')=''
    union all select 'razao_social', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(c.cancelado,false)=false and coalesce(btrim(c.razao_social),'')=''
    -- Motivo do cancelamento só faz sentido em quem cancelou.
    union all select 'motivo_cancelamento_id', count(*)::int from public.clientes c
      where c.tenant_id = p_tenant_id and (v_esc is null or c.unidade_base_id = any(v_esc)) and c.cancelado and c.motivo_cancelamento_id is null
    union all select 'fornecedor_id', count(*)::int from public.cliente_produtos cp join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = p_tenant_id and cp.ativo and (v_esc is null or c.unidade_base_id = any(v_esc)) and cp.fornecedor_id is null
    union all select 'funcionario_id', count(*)::int from public.cliente_produtos cp join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = p_tenant_id and cp.ativo and (v_esc is null or c.unidade_base_id = any(v_esc)) and cp.funcionario_id is null
    union all select 'origem_venda_id', count(*)::int from public.cliente_produtos cp join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = p_tenant_id and cp.ativo and (v_esc is null or c.unidade_base_id = any(v_esc)) and cp.origem_venda_id is null
    union all select 'data_venda', count(*)::int from public.cliente_produtos cp join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = p_tenant_id and cp.ativo and (v_esc is null or c.unidade_base_id = any(v_esc)) and cp.data_venda is null
    union all select 'data_ativacao', count(*)::int from public.cliente_produtos cp join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = p_tenant_id and cp.ativo and (v_esc is null or c.unidade_base_id = any(v_esc)) and cp.data_ativacao is null
    union all select 'data_proximo_reajuste', count(*)::int from public.cliente_produtos cp join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = p_tenant_id and cp.ativo and (v_esc is null or c.unidade_base_id = any(v_esc)) and cp.data_proximo_reajuste is null
    union all select 'vlr_custo', count(*)::int from public.cliente_produtos cp join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = p_tenant_id and cp.ativo and (v_esc is null or c.unidade_base_id = any(v_esc)) and coalesce(cp.vlr_custo,0)=0
  )
  select d.campo, d.escopo, d.rotulo, d.indicador, d.em_lote, ct.faltando
  from defs d join contagens ct on ct.campo = d.campo
  where ct.faltando > 0
  order by ct.faltando desc;
end;
$function$;


CREATE OR REPLACE FUNCTION public.fn_cadastro_incompleto_lista(p_tenant_id uuid, p_campo text, p_unidades bigint[] DEFAULT NULL::bigint[], p_produto_id bigint DEFAULT NULL::bigint, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 200, p_offset integer DEFAULT 0, p_ordem text DEFAULT NULL::text, p_dir text DEFAULT 'asc'::text)
 RETURNS TABLE(registro_id uuid, cliente_id uuid, codigo integer, cliente_nome text, detalhe text, unidade text, data_cadastro date, total bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_q   text;
  v_bs  text := nullif(btrim(coalesce(p_busca, '')), '');
  v_ord text;
  v_esc bigint[];
  v_dir text := case when lower(coalesce(p_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  -- Só as unidades que quem chamou pode ver, e dentro delas as do filtro global.
  v_esc := public.fn_cadastro_escopo_unidades();

  if p_campo not in ('unidade_base_id','cidade_id','estado_id','area_atuacao_id','segmento_id',
                     'telefone_whatsapp','razao_social','motivo_cancelamento_id',
                     'fornecedor_id','funcionario_id','origem_venda_id','data_venda',
                     'data_ativacao','vlr_custo','data_proximo_reajuste') then
    raise exception 'Campo % não é vigiado', p_campo using errcode = '22023';
  end if;

  -- Lista fechada: o nome da coluna entra em SQL dinâmico, então nada que venha
  -- de fora chega ao ORDER BY sem passar por aqui.
  if nullif(btrim(coalesce(p_ordem, '')), '') is not null then
    v_ord := case p_ordem
      when 'codigo'  then 'codigo'
      when 'nome'    then 'cliente_nome'
      when 'detalhe' then 'detalhe'
      when 'unidade' then 'unidade'
      when 'data'    then 'data_cadastro'
      else null end;
    if v_ord is null then
      raise exception 'Ordenação % não existe', p_ordem using errcode = '22023';
    end if;
    -- Desempate por código: sem ele, duas linhas com a mesma unidade (ou a mesma
    -- data) podem trocar de lugar entre uma página e a seguinte, e o "Selecionar
    -- os 300" passaria a marcar um conjunto diferente a cada consulta.
    v_ord := format('order by %I %s nulls last, codigo nulls last', v_ord, v_dir);
  end if;

  if p_campo in ('unidade_base_id','cidade_id','estado_id','area_atuacao_id','segmento_id',
                 'telefone_whatsapp','razao_social','motivo_cancelamento_id') then
    v_q := format($q$
      select c.id as registro_id, c.id as cliente_id, c.codigo_sequencial as codigo,
             coalesce(nullif(btrim(c.razao_social),''), nullif(btrim(c.nome_fantasia),''), '(sem nome)') as cliente_nome,
             %s as detalhe,
             coalesce(u.nome, '—') as unidade,
             c.data_cadastro,
             count(*) over () as total
      from public.clientes c
      left join public.unidades_base u on u.id = c.unidade_base_id
      where c.tenant_id = $1
        and %s
        and %s
        and ($2 is null or c.unidade_base_id = any($2))
        and ($7::bigint[] is null or c.unidade_base_id = any($7))
        and ($3 is null or exists (select 1 from public.cliente_produtos cp
                                    where cp.cliente_id = c.id and cp.ativo and cp.produto_id = $3))
        and ($4 is null or c.codigo_sequencial::text = $4
             or c.razao_social ilike '%%' || $4 || '%%'
             or c.nome_fantasia ilike '%%' || $4 || '%%'
             or c.cnpj_digits like '%%' || regexp_replace($4, '\D', '', 'g') || '%%')
      %s
      limit $5 offset $6
    $q$,
      case when p_campo in ('cidade_id','estado_id')
           then $$coalesce(nullif(regexp_replace(coalesce(c.cep,''), '\D', '', 'g'), ''), 'sem CEP')$$
           else $$coalesce((select string_agg(distinct pr2.nome, ', ')
                            from public.cliente_produtos cp2
                            join public.produtos pr2 on pr2.id = cp2.produto_id
                            where cp2.cliente_id = c.id and cp2.ativo), 'sem produto ativo')$$ end,
      case when p_campo = 'motivo_cancelamento_id' then 'c.cancelado' else 'coalesce(c.cancelado,false) = false' end,
      case when p_campo in ('telefone_whatsapp','razao_social')
           then format('coalesce(btrim(c.%I), '''') = ''''', p_campo)
           else format('c.%I is null', p_campo) end,
      coalesce(v_ord, 'order by c.codigo_sequencial nulls last')
    );
  else
    v_q := format($q$
      select cp.id as registro_id, c.id as cliente_id, c.codigo_sequencial as codigo,
             coalesce(nullif(btrim(c.razao_social),''), nullif(btrim(c.nome_fantasia),''), '(sem nome)') as cliente_nome,
             coalesce(pr.nome, 'produto sem nome') as detalhe,
             coalesce(u.nome, '—') as unidade,
             c.data_cadastro,
             count(*) over () as total
      from public.cliente_produtos cp
      join public.clientes c on c.id = cp.cliente_id
      left join public.produtos pr on pr.id = cp.produto_id
      left join public.unidades_base u on u.id = c.unidade_base_id
      where cp.tenant_id = $1 and cp.ativo
        and %s
        and ($2 is null or c.unidade_base_id = any($2))
        and ($7::bigint[] is null or c.unidade_base_id = any($7))
        and ($3 is null or cp.produto_id = $3)
        and ($4 is null or c.codigo_sequencial::text = $4
             or c.razao_social ilike '%%' || $4 || '%%'
             or c.nome_fantasia ilike '%%' || $4 || '%%'
             or c.cnpj_digits like '%%' || regexp_replace($4, '\D', '', 'g') || '%%')
      %s
      limit $5 offset $6
    $q$,
      case when p_campo = 'vlr_custo' then 'coalesce(cp.vlr_custo,0) = 0'
           else format('cp.%I is null', p_campo) end,
      -- Sem ordenação escolhida vale o agrupamento por unidade, produto e ÉPOCA:
      -- é ele que faz o bloco selecionável coincidir com o grupo que teve o
      -- mesmo vendedor. Ordenar por coluna é opção, não substituição.
      coalesce(v_ord, 'order by u.nome nulls last, pr.nome, c.data_cadastro nulls last, c.codigo_sequencial nulls last')
    );
  end if;

  return query execute v_q
    using p_tenant_id, p_unidades, p_produto_id, v_bs, greatest(1, least(p_limite, 500)), greatest(0, p_offset), v_esc;
end;
$function$;


CREATE OR REPLACE FUNCTION public.fn_cadastro_preencher_lote(p_tenant_id uuid, p_campo text, p_ids uuid[], p_valor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote   uuid := gen_random_uuid();
  v_tabela text;
  v_lookup text;
  v_tipo   text;
  v_id     bigint;
  v_data   date;
  v_qtd    integer := 0;
  v_sql    text;
  v_existe integer;
  v_esc    bigint[];
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  -- Só as unidades que quem chamou pode ver, e dentro delas as do filtro global.
  v_esc := public.fn_cadastro_escopo_unidades();

  -- Escrever cadastro em massa é de admin. Head confere, admin grava — mesma
  -- régua das outras ações de escrita do saneamento.
  if not (coalesce(current_setting('role', true), '') = 'service_role'
          or public.is_super_admin() or public.is_tenant_admin()) then
    raise exception 'Apenas administradores podem preencher cadastro em lote'
      using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return jsonb_build_object('ok', false, 'erro', 'Nenhum registro selecionado.');
  end if;
  if array_length(p_ids, 1) > 500 then
    return jsonb_build_object('ok', false,
      'erro', 'Máximo de 500 por vez. Use os filtros para dividir.');
  end if;

  -- ── whitelist: tabela, tabela de lookup e tipo do valor ──────────────────
  select x.tabela, x.lookup, x.tipo into v_tabela, v_lookup, v_tipo
  from (values
    ('unidade_base_id',        'clientes',         'unidades_base',        'id'),
    ('area_atuacao_id',        'clientes',         'areas_atuacao',        'id'),
    ('segmento_id',            'clientes',         'segmentos',            'id'),
    ('motivo_cancelamento_id', 'clientes',         'motivos_cancelamento', 'id'),
    ('fornecedor_id',          'cliente_produtos', 'fornecedores',         'id'),
    ('funcionario_id',         'cliente_produtos', 'funcionarios',         'id'),
    ('origem_venda_id',        'cliente_produtos', 'origens_venda',        'id'),
    ('data_venda',             'cliente_produtos', null,                   'data'),
    ('data_ativacao',          'cliente_produtos', null,                   'data')
  ) as x(campo, tabela, lookup, tipo)
  where x.campo = p_campo;

  if v_tabela is null then
    return jsonb_build_object('ok', false,
      'erro', format('O campo "%s" não é preenchido em lote — cada cliente tem o seu valor.', p_campo));
  end if;

  -- ── o valor precisa existir e ser desta empresa ──────────────────────────
  if v_tipo = 'id' then
    v_id := nullif(btrim(coalesce(p_valor, '')), '')::bigint;
    if v_id is null then
      return jsonb_build_object('ok', false, 'erro', 'Escolha um valor.');
    end if;
    v_existe := null;
    execute format('select 1 from public.%I where id = $1 and tenant_id = $2', v_lookup)
      into v_existe using v_id, p_tenant_id;
    if v_existe is null then
      return jsonb_build_object('ok', false,
        'erro', 'O valor escolhido não existe nesta empresa.');
    end if;
    if p_campo = 'unidade_base_id' and v_esc is not null and not (v_id = any(v_esc)) then
      return jsonb_build_object('ok', false,
        'erro', 'Essa unidade está fora das que você pode ver.');
    end if;
  else
    v_data := nullif(btrim(coalesce(p_valor, '')), '')::date;
    if v_data is null then
      return jsonb_build_object('ok', false, 'erro', 'Escolha uma data.');
    end if;
    if v_data > current_date then
      return jsonb_build_object('ok', false, 'erro', 'A data não pode ser futura.');
    end if;
  end if;

  -- ── log ANTES do update: é agora que o valor antigo existe ───────────────
  if v_tabela = 'clientes' then
    execute format($l$
      insert into public.cadastro_lote_log
        (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
         codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
      select $1, $2, %L, 'clientes', c.id, c.id, c.codigo_sequencial, c.razao_social,
             to_jsonb(c.%I), to_jsonb($3), auth.uid()
      from public.clientes c
      where c.tenant_id = $1 and c.id = any($4) and c.%I is null
        and ($5::bigint[] is null or c.unidade_base_id = any($5))
    $l$, p_campo, p_campo, p_campo)
      using p_tenant_id, v_lote, coalesce(v_id, extract(epoch from v_data)::bigint), p_ids, v_esc;

    v_sql := format($u$
      update public.clientes set %I = $1, updated_at = now()
      where tenant_id = $2 and id = any($3) and %I is null
        and ($4::bigint[] is null or unidade_base_id = any($4))
    $u$, p_campo, p_campo);
    execute v_sql using v_id, p_tenant_id, p_ids, v_esc;
  else
    execute format($l$
      insert into public.cadastro_lote_log
        (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
         codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
      select $1, $2, %L, 'cliente_produtos', cp.id, cp.cliente_id, c.codigo_sequencial,
             c.razao_social, to_jsonb(cp.%I), to_jsonb($3::text), auth.uid()
      from public.cliente_produtos cp
      join public.clientes c on c.id = cp.cliente_id
      where cp.tenant_id = $1 and cp.id = any($4) and cp.%I is null
        and ($5::bigint[] is null or c.unidade_base_id = any($5))
    $l$, p_campo, p_campo, p_campo)
      using p_tenant_id, v_lote, coalesce(v_id::text, v_data::text), p_ids, v_esc;

    if v_tipo = 'id' then
      v_sql := format($u$
        update public.cliente_produtos cp set %I = $1, updated_at = now()
        where cp.tenant_id = $2 and cp.id = any($3) and cp.%I is null
          and ($4::bigint[] is null or exists (select 1 from public.clientes c
                where c.id = cp.cliente_id and c.unidade_base_id = any($4)))
      $u$, p_campo, p_campo);
      execute v_sql using v_id, p_tenant_id, p_ids, v_esc;
    else
      v_sql := format($u$
        update public.cliente_produtos cp set %I = $1, updated_at = now()
        where cp.tenant_id = $2 and cp.id = any($3) and cp.%I is null
          and ($4::bigint[] is null or exists (select 1 from public.clientes c
                where c.id = cp.cliente_id and c.unidade_base_id = any($4)))
      $u$, p_campo, p_campo);
      execute v_sql using v_data, p_tenant_id, p_ids, v_esc;
    end if;
  end if;

  get diagnostics v_qtd = row_count;

  return jsonb_build_object(
    'ok', true, 'lote_id', v_lote, 'gravados', v_qtd,
    'pedidos', array_length(p_ids, 1),
    -- Quem já estava preenchido não é erro: é outra pessoa que chegou antes.
    'ja_preenchidos', array_length(p_ids, 1) - v_qtd);
end;
$function$;


CREATE OR REPLACE FUNCTION public.fn_cadastro_calcular_reajuste(p_tenant_id uuid, p_ids uuid[] DEFAULT NULL::uuid[], p_unidades bigint[] DEFAULT NULL::bigint[], p_produto_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote uuid := gen_random_uuid();
  v_ok   integer := 0;
  v_sem  integer := 0;
  v_esc  bigint[];
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  -- Só as unidades que quem chamou pode ver, e dentro delas as do filtro global.
  v_esc := public.fn_cadastro_escopo_unidades();

  if not (coalesce(current_setting('role', true), '') = 'service_role'
          or public.is_super_admin() or public.is_tenant_admin()) then
    raise exception 'Apenas administradores podem preencher cadastro em lote'
      using errcode = '42501';
  end if;

  -- Alvo: pendentes do tenant, filtrados como a tela está filtrando. Quando
  -- p_ids vem preenchido, ele manda — é a seleção explícita de quem clicou.
  drop table if exists _alvo;
  create temp table _alvo on commit drop as
  select cp.id, cp.data_ativacao
  from public.cliente_produtos cp
  join public.clientes c on c.id = cp.cliente_id
  where cp.tenant_id = p_tenant_id
    and cp.ativo
    and cp.data_proximo_reajuste is null
    and (p_ids is null or cp.id = any(p_ids))
    and (p_unidades is null or c.unidade_base_id = any(p_unidades))
    and (v_esc is null or c.unidade_base_id = any(v_esc))
    and (p_produto_id is null or cp.produto_id = p_produto_id);

  select count(*) into v_sem from _alvo where data_ativacao is null;

  insert into public.cadastro_lote_log
    (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
     codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
  select p_tenant_id, v_lote, 'data_proximo_reajuste', 'cliente_produtos', cp.id, cp.cliente_id,
         c.codigo_sequencial, c.razao_social,
         to_jsonb(cp.data_proximo_reajuste),
         to_jsonb(public.calc_proximo_reajuste(cp.data_ativacao, 12)),
         auth.uid()
  from _alvo a
  join public.cliente_produtos cp on cp.id = a.id
  join public.clientes c on c.id = cp.cliente_id
  where a.data_ativacao is not null;

  update public.cliente_produtos cp
     set data_proximo_reajuste = public.calc_proximo_reajuste(cp.data_ativacao, 12),
         updated_at = now()
  from _alvo a
   where cp.id = a.id and a.data_ativacao is not null;

  get diagnostics v_ok = row_count;

  return jsonb_build_object('ok', true, 'lote_id', v_lote,
    'gravados', v_ok, 'sem_ativacao', v_sem,
    'alvo', (select count(*) from _alvo));
end;
$function$;


CREATE OR REPLACE FUNCTION public.fn_cadastro_preencher_cidade(p_tenant_id uuid, p_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lote   uuid := gen_random_uuid();
  v_item   jsonb;
  v_cli    uuid;
  v_cid    bigint;
  v_est    bigint;
  v_ok     integer := 0;
  v_nao    jsonb := '[]'::jsonb;
  v_esc    bigint[];
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  -- Só as unidades que quem chamou pode ver, e dentro delas as do filtro global.
  v_esc := public.fn_cadastro_escopo_unidades();

  if not (coalesce(current_setting('role', true), '') = 'service_role'
          or public.is_super_admin() or public.is_tenant_admin()) then
    raise exception 'Apenas administradores podem preencher cadastro em lote'
      using errcode = '42501';
  end if;

  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    return jsonb_build_object('ok', false, 'erro', 'Nenhum registro selecionado.');
  end if;
  if jsonb_array_length(p_itens) > 500 then
    return jsonb_build_object('ok', false, 'erro', 'Máximo de 500 por vez.');
  end if;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    v_cli := nullif(v_item->>'cliente_id', '')::uuid;
    v_cid := null; v_est := null;

    select c.id, c.estado_id into v_cid, v_est
    from public.cidades c join public.estados es on es.id = c.estado_id
    where upper(c.nome) = upper(btrim(coalesce(v_item->>'cidade', '')))
      and es.sigla = upper(btrim(coalesce(v_item->>'uf', '')))
    limit 1;

    if v_cid is null then
      v_nao := v_nao || jsonb_build_object(
        'cliente_id', v_cli,
        'motivo', format('"%s/%s" não casa com nenhuma cidade cadastrada.',
                         coalesce(v_item->>'cidade', '—'), coalesce(v_item->>'uf', '—')));
      continue;
    end if;

    -- Só quem está vazio: se outra pessoa preencheu no meio, o valor dela fica.
    insert into public.cadastro_lote_log
      (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
       codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
    select p_tenant_id, v_lote, x.campo, 'clientes', c.id, c.id,
           c.codigo_sequencial, c.razao_social, x.antes, x.depois, auth.uid()
    from public.clientes c,
    lateral (values
      ('cidade_id', to_jsonb(c.cidade_id), to_jsonb(v_cid)),
      ('estado_id', to_jsonb(c.estado_id), to_jsonb(coalesce(c.estado_id, v_est)))
    ) as x(campo, antes, depois)
    where c.id = v_cli and c.tenant_id = p_tenant_id and c.cidade_id is null
      and (v_esc is null or c.unidade_base_id = any(v_esc))
      and x.antes is distinct from x.depois;

    update public.clientes
       set cidade_id = v_cid,
           -- O estado não é sobrescrito quando já existe: o CEP confirma, não
           -- corrige. Divergência entre os dois é caso para a ficha.
           estado_id = coalesce(estado_id, v_est),
           updated_at = now()
     where id = v_cli and tenant_id = p_tenant_id and cidade_id is null
       and (v_esc is null or unidade_base_id = any(v_esc));

    if found then v_ok := v_ok + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'lote_id', v_lote,
    'gravados', v_ok, 'pedidos', jsonb_array_length(p_itens), 'recusados', v_nao);
end;
$function$;

