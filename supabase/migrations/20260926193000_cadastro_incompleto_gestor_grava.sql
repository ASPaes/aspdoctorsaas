-- Cadastro incompleto: gestor (head) também grava em massa.
--
-- Decisão do Alexandre em 26/09: a regra era "head confere, admin grava", mas o
-- gestor de unidade (ex.: Julio, Digi Up) precisa sanear a própria carteira.
-- O limite continua sendo a unidade — fn_cadastro_escopo_unidades() impede
-- gravar fora das unidades que ele vê (migration 20260926190000).


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

  -- Escrever cadastro em massa é de admin e gestor, sempre dentro das
  -- unidades que a pessoa vê (v_esc acima).
  if not (coalesce(current_setting('role', true), '') = 'service_role'
          or public.is_super_admin() or public.is_tenant_admin_or_head()) then
    raise exception 'Apenas administradores e gestores podem preencher cadastro em lote'
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
          or public.is_super_admin() or public.is_tenant_admin_or_head()) then
    raise exception 'Apenas administradores e gestores podem preencher cadastro em lote'
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
          or public.is_super_admin() or public.is_tenant_admin_or_head()) then
    raise exception 'Apenas administradores e gestores podem preencher cadastro em lote'
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
