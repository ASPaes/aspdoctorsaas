-- Gravação em massa do Cadastro incompleto passa a gravar também no CONTRATO.
--
-- Origem, vendedor e datas existem no produto (cliente_produtos) e no contrato.
-- A ficha do cliente espelha um no outro (sync_cliente_produto_to_contract);
-- a gravação em massa gravava só no produto, e a lista de Clientes, que lê do
-- contrato, continuava mostrando "Nulo" (Digi Up, 26/09: 89 clientes).
--
-- Regra (Alexandre, 26/09/2026): a base é o contrato.
--   1. produto vazio com contrato preenchido -> recebe o do contrato;
--   2. o resto recebe o valor escolhido na tela (ou o reajuste calculado);
--   3. contrato vazio recebe o mesmo valor do produto.

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
  v_col_ct text;
  v_do_ct  integer := 0;
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
    -- A base é o CONTRATO (decisão do Alexandre, 26/09/2026). O produto e o
    -- contrato guardam origem, vendedor e datas; a lista de Clientes lê do
    -- contrato. Gravar só no produto deixava a lista dizendo "vazio".
    v_col_ct := case p_campo
      when 'origem_venda_id' then 'origem_venda_id'
      when 'funcionario_id'  then 'funcionario_id'
      when 'data_venda'      then 'data_venda'
      when 'data_ativacao'   then 'data_inicio'
      else null end;  -- fornecedor não existe no contrato

    -- 1) Produto vazio cujo contrato já sabe a resposta: vale a do contrato.
    if v_col_ct is not null then
      execute format($l$
        insert into public.cadastro_lote_log
          (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
           codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
        select $1, $2, %L, 'cliente_produtos', cp.id, cp.cliente_id, c.codigo_sequencial,
               c.razao_social, 'null'::jsonb, to_jsonb(ct.%I::text), auth.uid()
        from public.cliente_produtos cp
        join public.clientes c on c.id = cp.cliente_id
        join public.contrato_itens ci on ci.cliente_produto_id = cp.id
        join public.contratos ct on ct.id = ci.contrato_id
        where cp.tenant_id = $1 and cp.id = any($3) and cp.%I is null and ct.%I is not null
          and ($4::bigint[] is null or c.unidade_base_id = any($4))
      $l$, p_campo, v_col_ct, p_campo, v_col_ct)
        using p_tenant_id, v_lote, p_ids, v_esc;

      execute format($u$
        update public.cliente_produtos cp set %I = ct.%I, updated_at = now()
        from public.contrato_itens ci, public.contratos ct, public.clientes c
        where ci.cliente_produto_id = cp.id and ct.id = ci.contrato_id and c.id = cp.cliente_id
          and cp.tenant_id = $1 and cp.id = any($2) and cp.%I is null and ct.%I is not null
          and ($3::bigint[] is null or c.unidade_base_id = any($3))
      $u$, p_campo, v_col_ct, p_campo, v_col_ct)
        using p_tenant_id, p_ids, v_esc;
      get diagnostics v_do_ct = row_count;
    end if;

    -- 2) O resto recebe o valor escolhido na tela.
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
    get diagnostics v_qtd = row_count;

    -- 3) Contrato vazio recebe o mesmo valor do produto.
    if v_col_ct is not null then
      execute format($l$
        insert into public.cadastro_lote_log
          (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
           codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
        select $1, $2, %L, 'contratos', ct.id, ct.cliente_id, c.codigo_sequencial,
               c.razao_social, 'null'::jsonb, to_jsonb(cp.%I::text), auth.uid()
        from public.cliente_produtos cp
        join public.clientes c on c.id = cp.cliente_id
        join public.contrato_itens ci on ci.cliente_produto_id = cp.id
        join public.contratos ct on ct.id = ci.contrato_id
        where cp.tenant_id = $1 and cp.id = any($3) and cp.%I is not null and ct.%I is null
          and ($4::bigint[] is null or c.unidade_base_id = any($4))
      $l$, v_col_ct, p_campo, p_campo, v_col_ct)
        using p_tenant_id, v_lote, p_ids, v_esc;

      execute format($u$
        update public.contratos ct set %I = cp.%I, updated_at = now()
        from public.contrato_itens ci, public.cliente_produtos cp, public.clientes c
        where ci.contrato_id = ct.id and cp.id = ci.cliente_produto_id and c.id = cp.cliente_id
          and cp.tenant_id = $1 and cp.id = any($2) and cp.%I is not null and ct.%I is null
          and ($3::bigint[] is null or c.unidade_base_id = any($3))
      $u$, v_col_ct, p_campo, p_campo, v_col_ct)
        using p_tenant_id, p_ids, v_esc;
    end if;

    v_qtd := v_qtd + v_do_ct;
    return jsonb_build_object(
      'ok', true, 'lote_id', v_lote, 'gravados', v_qtd, 'do_contrato', v_do_ct,
      'pedidos', array_length(p_ids, 1),
      'ja_preenchidos', array_length(p_ids, 1) - v_qtd);
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
  --
  -- A base é o CONTRATO (decisão do Alexandre, 26/09/2026): se o contrato já
  -- tem a data, ela vale; só sem ela a data é calculada pela ativação.
  drop table if exists _alvo;
  create temp table _alvo on commit drop as
  select cp.id, cp.data_ativacao,
         coalesce(
           (select ct.data_proximo_reajuste
              from public.contrato_itens ci join public.contratos ct on ct.id = ci.contrato_id
             where ci.cliente_produto_id = cp.id and ct.data_proximo_reajuste is not null
             order by ct.data_proximo_reajuste limit 1),
           public.calc_proximo_reajuste(cp.data_ativacao, 12)) as nova
  from public.cliente_produtos cp
  join public.clientes c on c.id = cp.cliente_id
  where cp.tenant_id = p_tenant_id
    and cp.ativo
    and cp.data_proximo_reajuste is null
    and (p_ids is null or cp.id = any(p_ids))
    and (p_unidades is null or c.unidade_base_id = any(p_unidades))
    and (v_esc is null or c.unidade_base_id = any(v_esc))
    and (p_produto_id is null or cp.produto_id = p_produto_id);

  select count(*) into v_sem from _alvo where nova is null;

  insert into public.cadastro_lote_log
    (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
     codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
  select p_tenant_id, v_lote, 'data_proximo_reajuste', 'cliente_produtos', cp.id, cp.cliente_id,
         c.codigo_sequencial, c.razao_social,
         to_jsonb(cp.data_proximo_reajuste),
         to_jsonb(a.nova),
         auth.uid()
  from _alvo a
  join public.cliente_produtos cp on cp.id = a.id
  join public.clientes c on c.id = cp.cliente_id
  where a.nova is not null;

  update public.cliente_produtos cp
     set data_proximo_reajuste = a.nova,
         updated_at = now()
  from _alvo a
   where cp.id = a.id and a.nova is not null;

  get diagnostics v_ok = row_count;

  -- Contrato vazio recebe a mesma data.
  insert into public.cadastro_lote_log
    (tenant_id, lote_id, campo, tabela, registro_id, cliente_id,
     codigo_sequencial, cliente_nome, valor_antes, valor_depois, feito_por)
  select distinct on (ct.id) p_tenant_id, v_lote, 'data_proximo_reajuste', 'contratos', ct.id, ct.cliente_id,
         c.codigo_sequencial, c.razao_social, 'null'::jsonb, to_jsonb(a.nova::text), auth.uid()
  from _alvo a
  join public.contrato_itens ci on ci.cliente_produto_id = a.id
  join public.contratos ct on ct.id = ci.contrato_id
  join public.clientes c on c.id = ct.cliente_id
  where a.nova is not null and ct.data_proximo_reajuste is null
  order by ct.id, a.nova;

  update public.contratos ct
     set data_proximo_reajuste = x.nova, updated_at = now()
  from (select ci.contrato_id, min(a.nova) nova
          from _alvo a join public.contrato_itens ci on ci.cliente_produto_id = a.id
         where a.nova is not null group by 1) x
   where ct.id = x.contrato_id and ct.data_proximo_reajuste is null;

  return jsonb_build_object('ok', true, 'lote_id', v_lote,
    'gravados', v_ok, 'sem_ativacao', v_sem,
    'alvo', (select count(*) from _alvo));
end;
$function$;
