-- Integração Hiper — motor de reconciliação.
--
-- Uma linha por conta do portal, mais uma por cliente do DoctorSaaS que não tem
-- conta nenhuma lá. NÃO escreve em dado de negócio: só em reconciliacao_hiper.
-- Toda correção em clientes/cliente_produtos é ação humana na aba Divergências.
--
-- Spec: docs/superpowers/specs/2026-08-30-integracao-hiper-design.md

-- Normalização de razão social. Sem isto, "LTDA" viraria ~900 divergências.
create or replace function public.hiper_norm_razao(p text)
returns text language sql immutable parallel safe
set search_path = public, extensions as $$
  select nullif(
    btrim(regexp_replace(
      regexp_replace(
        upper(extensions.unaccent(coalesce(p, ''))),
        '\y(LTDA|ME|EPP|EIRELI|S\.?A|SA|MEI|SS|EI|CIA|COMPANHIA|SOCIEDADE|UNIPESSOAL)\y', ' ', 'g'
      ),
      '[^A-Z0-9]+', ' ', 'g'
    )),
  '');
$$;

comment on function public.hiper_norm_razao(text) is
  'Razão social comparável: sem acento, sem pontuação e sem sufixo societário. A comparação crua acusaria diferença em quase toda a carteira por causa de "LTDA".';

create or replace function public.hiper_reconciliar(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_forn        bigint;
  v_contas      integer := 0;
  v_orfaos      integer := 0;
  v_pendentes   integer := 0;
  v_novas       integer := 0;
begin
  -- Guarda de tenant. `current_setting('role')` sobrevive ao SECURITY DEFINER,
  -- então é ele que distingue a edge function (service_role) do usuário.
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

  select fornecedor_id into v_forn
  from public.hiper_integration where tenant_id = p_tenant_id;

  if v_forn is null then
    return jsonb_build_object(
      'ok', false,
      'erro', 'Escolha o fornecedor Hiper na aba Conexão. Sem essa amarra o cruzamento tocaria a base inteira.');
  end if;

  -- ── escopo do DoctorSaaS: só quem tem contrato ativo com o fornecedor Hiper ──
  create temp table _ds on commit drop as
  select c.id                                as cliente_id,
         nullif(c.cnpj_digits, '')           as cnpj,
         c.razao_social,
         coalesce(c.cancelado, false)        as cancelado,
         c.matriz_id,
         c.codigo_sequencial,
         a.vlr_mensal,
         a.vlr_custo,
         a.modelo_contrato_id,
         a.cp_id
  from public.clientes c
  cross join lateral (
    select sum(cp.vlr_mensal)                                              as vlr_mensal,
           sum(cp.vlr_custo)                                               as vlr_custo,
           min(coalesce(cp.modelo_contrato_id, c.modelo_contrato_id))      as modelo_contrato_id,
           min(cp.id::text)::uuid                                          as cp_id,
           count(*)                                                        as n
    from public.cliente_produtos cp
    where cp.cliente_id = c.id and cp.fornecedor_id = v_forn and cp.ativo
  ) a
  where c.tenant_id = p_tenant_id and a.n > 0 and nullif(c.cnpj_digits, '') is not null;

  create index on _ds (cnpj);
  create index on _ds (cliente_id);

  -- ── candidatos por CNPJ da CONTA (nível 1 do match) ─────────────────────────
  create temp table _cand on commit drop as
  select e.id_portal,
         count(d.cliente_id)                          as qtd,
         min(d.cliente_id::text)::uuid                as unico
  from public.hiper_espelho_cadastro e
  left join _ds d on d.cnpj = e.cnpj_norm
  where e.tenant_id = p_tenant_id
  group by e.id_portal;
  create index on _cand (id_portal);

  -- ── nível 2: cliente que casa com um ESTABELECIMENTO, e não com uma conta.
  --    Conta própria ganha de estabelecimento: quem já casou no nível 1 não
  --    entra aqui (o portal é quem sabe como cobra).
  create temp table _fil_match on commit drop as
  select f.id_portal, f.cnpj_norm, d.cliente_id, d.matriz_id,
         d.vlr_mensal, d.vlr_custo, d.cancelado, d.razao_social
  from public.hiper_espelho_filial f
  join _ds d on d.cnpj = f.cnpj_norm
  where f.tenant_id = p_tenant_id
    and not exists (
      select 1 from public.hiper_espelho_cadastro e2
      where e2.tenant_id = p_tenant_id and e2.cnpj_norm = f.cnpj_norm
    );
  create index on _fil_match (id_portal);
  create index on _fil_match (cliente_id);

  -- ── as linhas da conta ──────────────────────────────────────────────────────
  create temp table _novo on commit drop as
  with base as (
    select
      e.id_portal, e.cnpj_norm, e.razao_social as razao_hiper, e.situacao,
      e.responsavel_tipo, e.plano, e.cancelada_em, e.cancelada_por,
      e.bruto_mes, e.custo_mes, e.mrr, e.a_pagar,
      c.qtd,
      -- escolha humana anterior manda sobre o automático
      coalesce(r.candidato_escolhido, case when c.qtd = 1 then c.unico end) as cliente_id,
      r.candidato_escolhido,
      (e.situacao in ('ativo','bloqueado'))                                as viva
    from public.hiper_espelho_cadastro e
    join _cand c on c.id_portal = e.id_portal
    left join public.reconciliacao_hiper r
           on r.tenant_id = p_tenant_id and r.id_portal = e.id_portal
    where e.tenant_id = p_tenant_id
  ),
  comds as (
    select b.*, d.cliente_id as ds_id, d.razao_social as razao_ds, d.cnpj as cnpj_ds,
           d.vlr_mensal, d.vlr_custo, d.cancelado, d.modelo_contrato_id, d.cp_id
    from base b
    left join _ds d on d.cliente_id = b.cliente_id
  ),
  dinheiro as (
    select x.*,
      -- Hiperador: o portal não sabe o preço (mensalidade zerada em todas as
      -- contas). Central: quem cobra é a Hiper, e o custo é tudo o que ela
      -- retém — o campo `custo` do portal não serve (zero em CL, sem a taxa
      -- da central em CC).
      case when not x.viva then null
           when x.responsavel_tipo = 'hiper'
             then nullif(coalesce(x.custo_mes, x.a_pagar), 0)
           when x.bruto_mes is null then null
           else round(coalesce(x.bruto_mes,0) - coalesce(x.mrr,0), 2)
      end as custo_hiper,
      case when not x.viva then null
           when x.responsavel_tipo = 'hiper' then null
           else nullif(x.bruto_mes, 0)
      end as mrr_hiper,
      v.modelo_contrato_id as modelo_esperado
    from comds x
    left join public.hiper_catalogo_vinculo v
      on v.tenant_id = p_tenant_id and v.tipo = 'contrato' and v.chave = x.responsavel_tipo
  )
  select
    y.id_portal, y.cnpj_norm, y.razao_hiper, y.situacao, y.responsavel_tipo, y.plano,
    y.cancelada_em, y.cancelada_por, y.custo_hiper, y.mrr_hiper,
    y.ds_id, y.cp_id, y.razao_ds, y.cnpj_ds, y.modelo_contrato_id,
    y.vlr_mensal, y.vlr_custo, y.cancelado, y.qtd, y.candidato_escolhido,
    case when y.ds_id is not null then 'vinculado'
         when y.qtd > 1            then 'ambiguo'
         else 'sem_dono' end                                        as estado_match,
    case when y.ds_id is not null then 'cnpj' end                   as criterio_match,
    y.viva, y.modelo_esperado
  from dinheiro y;

  create index on _novo (id_portal);
  create index on _novo (ds_id);

  -- ── grava: upsert que preserva a decisão do operador ────────────────────────
  insert into public.reconciliacao_hiper as r (
    tenant_id, gerado_em, id_portal, cnpj_norm, razao_social_hiper, situacao_hiper,
    plano_hiper, responsavel_tipo, mrr_hiper, custo_hiper, cancelada_em, cancelada_por,
    ds_cliente_id, ds_cliente_produto_id, razao_social_ds, cnpj_ds,
    modelo_contrato_id_ds, modelo_contrato_ds, mensalidade_ds, custo_ds, cancelado_ds,
    qtd_candidatos_ds, criterio_match, estado_match, divergencias, detalhe, margem
  )
  select
    p_tenant_id, now(), n.id_portal, n.cnpj_norm, n.razao_hiper, n.situacao,
    n.plano, n.responsavel_tipo, n.mrr_hiper, n.custo_hiper, n.cancelada_em, n.cancelada_por,
    n.ds_id, n.cp_id, n.razao_ds, n.cnpj_ds,
    n.modelo_contrato_id, mc.nome, n.vlr_mensal, n.vlr_custo, n.cancelado,
    n.qtd, n.criterio_match, n.estado_match,
    -- as comparações escalares, na ordem em que a operação ataca:
    -- tipo de contrato decide a regra do dinheiro; filial decide de quem ele é.
      (case when n.estado_match = 'sem_dono' and n.viva            then array['sem_dono']                 else '{}'::text[] end)
   || (case when n.estado_match = 'ambiguo'                        then array['cnpj_ambiguo']             else '{}'::text[] end)
   || (case when n.estado_match = 'vinculado' and not n.viva
                 and not coalesce(n.cancelado, false)              then array['conta_inativa_no_hiper']   else '{}'::text[] end)
   || (case when n.estado_match = 'vinculado' and n.viva
                 and n.modelo_contrato_id is null                  then array['tipo_contrato_ausente']    else '{}'::text[] end)
   || (case when n.estado_match = 'vinculado' and n.viva
                 and n.modelo_contrato_id is not null and n.modelo_esperado is not null
                 and n.modelo_contrato_id <> n.modelo_esperado     then array['tipo_contrato_divergente'] else '{}'::text[] end)
   || (case when n.estado_match = 'vinculado' and n.custo_hiper is not null
                 and abs(coalesce(n.vlr_custo, 0) - n.custo_hiper) > 0.01
                                                                   then array['custo_divergente']         else '{}'::text[] end)
   || (case when n.estado_match = 'vinculado' and n.mrr_hiper is not null
                 and abs(coalesce(n.vlr_mensal, 0) - n.mrr_hiper) > 0.01
                                                                   then array['mrr_divergente']           else '{}'::text[] end)
   || (case when n.estado_match = 'vinculado' and n.viva
                 and public.hiper_norm_razao(n.razao_hiper) is distinct from public.hiper_norm_razao(n.razao_ds)
                                                                   then array['razao_social_divergente']  else '{}'::text[] end)
   || coalesce(md.divergencias, '{}') || coalesce(fl.divergencias, '{}'),
    jsonb_strip_nulls(jsonb_build_object(
      'modulos', nullif(coalesce(md.detalhe, '{}'::jsonb), '{}'::jsonb),
      'filiais', nullif(coalesce(fl.detalhe, '{}'::jsonb), '{}'::jsonb))),
    case when n.custo_hiper is not null and n.vlr_mensal is not null
         then round(n.vlr_mensal - n.custo_hiper, 2) end
  from _novo n
  left join public.modelos_contrato mc on mc.id = n.modelo_contrato_id

  -- ── módulos: só custo, nunca MRR. Só entra app COM vínculo; app sem vínculo
  --    é pendência da aba Módulos, não do cliente (senão 327 contas repetiriam
  --    a mesma linha).
  left join lateral (
    with hip as (
      select m.app_nome, coalesce(m.custo, 0) as custo, v.modulo_id
      from public.hiper_espelho_modulo m
      join public.hiper_catalogo_vinculo v
        on v.tenant_id = p_tenant_id and v.tipo = 'modulo' and v.chave = m.app_nome
      where m.tenant_id = p_tenant_id and m.id_portal = n.id_portal and m.ativo
    ),
    dsm as (
      select cpm.modulo_id, coalesce(cpm.vlr_custo, 0) as custo, pm.nome
      from public.cliente_produto_modulos cpm
      join public.cliente_produtos cp on cp.id = cpm.cliente_produto_id
      join public.produto_modulos    pm on pm.id = cpm.modulo_id
      where cp.cliente_id = n.ds_id and cp.fornecedor_id = v_forn
        and cp.ativo and cpm.ativo
    ),
    a_mais as (select h.app_nome, h.custo from hip h
               where not exists (select 1 from dsm d where d.modulo_id = h.modulo_id)),
    a_menos as (select d.nome, d.custo from dsm d
                where not exists (select 1 from hip h where h.modulo_id = d.modulo_id)),
    -- custo só diverge quando há custo de algum lado: 1.079 dos 1.367 módulos
    -- do portal vêm com custo 0 (app gratuito ou bonificado), e comparar zero
    -- com zero encheria a lista sem dizer nada.
    custo_dif as (
      select h.app_nome, h.custo as custo_hiper, d.custo as custo_ds
      from hip h join dsm d on d.modulo_id = h.modulo_id
      where (h.custo > 0 or d.custo > 0) and abs(h.custo - d.custo) > 0.01
    )
    select
      (case when exists (select 1 from a_mais)    then array['modulo_a_mais_no_hiper']  else '{}'::text[] end)
   || (case when exists (select 1 from a_menos)   then array['modulo_a_menos_no_hiper'] else '{}'::text[] end)
   || (case when exists (select 1 from custo_dif) then array['modulo_custo_divergente'] else '{}'::text[] end)
      as divergencias,
      jsonb_strip_nulls(jsonb_build_object(
        'a_mais',  (select jsonb_agg(jsonb_build_object('nome', app_nome, 'custo', custo)) from a_mais),
        'a_menos', (select jsonb_agg(jsonb_build_object('nome', nome, 'custo', custo)) from a_menos),
        'custo',   (select jsonb_agg(jsonb_build_object('nome', app_nome, 'hiper', custo_hiper, 'ds', custo_ds)) from custo_dif)
      )) as detalhe
  ) md on n.estado_match = 'vinculado'

  -- ── filiais: a árvore e o dinheiro dela ─────────────────────────────────────
  left join lateral (
    with esp as (   -- estabelecimentos que o portal diz que esta conta tem
      select f.cnpj_norm, f.nome
      from public.hiper_espelho_filial f
      where f.tenant_id = p_tenant_id and f.id_portal = n.id_portal and f.ativo
    ),
    aqui as (       -- o que existe no DoctorSaaS para esses CNPJs
      select c2.id, c2.cnpj_digits, c2.razao_social, c2.matriz_id, c2.codigo_sequencial,
             d.vlr_mensal, d.vlr_custo, dec.decisao
      from esp
      join public.clientes c2
        on c2.tenant_id = p_tenant_id and c2.cnpj_digits = esp.cnpj_norm
      left join _ds d on d.cliente_id = c2.id
      left join public.hiper_filial_decisao dec
        on dec.tenant_id = p_tenant_id and dec.cliente_id = c2.id
      where coalesce(c2.cancelado, false) = false
    ),
    faltando as (
      select esp.cnpj_norm, esp.nome from esp
      where not exists (select 1 from aqui a where a.cnpj_digits = esp.cnpj_norm)
    ),
    sem_matriz as (
      select id, razao_social, cnpj_digits from aqui
      where matriz_id is distinct from n.ds_id
    ),
    -- Filial que paga a própria conta existe: só entra quem não tem decisão
    -- registrada. Sem isso a linha voltaria todo dia.
    com_valor as (
      select id, razao_social, cnpj_digits, vlr_mensal, vlr_custo from aqui
      where coalesce(decisao, '') <> 'paga_propria_conta'
        and (coalesce(vlr_mensal, 0) > 0.01 or coalesce(vlr_custo, 0) > 0.01)
    ),
    -- amarrada como filial aqui, mas o portal emite conta separada para ela
    conta_propria as (
      select c3.id, c3.razao_social, c3.cnpj_digits
      from public.clientes c3
      join public.hiper_espelho_cadastro e3
        on e3.tenant_id = p_tenant_id and e3.cnpj_norm = c3.cnpj_digits
      left join public.hiper_filial_decisao dec3
        on dec3.tenant_id = p_tenant_id and dec3.cliente_id = c3.id
      where c3.tenant_id = p_tenant_id and c3.matriz_id = n.ds_id
        and coalesce(c3.cancelado, false) = false
        and coalesce(dec3.decisao, '') <> 'paga_propria_conta'
    ),
    -- "filial" com o MESMO CNPJ da matriz não é filial: é o cadastro repetido
    duplicado as (
      select c4.id, c4.razao_social
      from public.clientes c4
      where c4.tenant_id = p_tenant_id and c4.matriz_id = n.ds_id
        and c4.cnpj_digits = n.cnpj_norm and coalesce(c4.cancelado, false) = false
    )
    select
      (case when exists (select 1 from faltando)      then array['filial_faltando_no_ds']  else '{}'::text[] end)
   || (case when exists (select 1 from sem_matriz)    then array['filial_sem_matriz']      else '{}'::text[] end)
   || (case when exists (select 1 from com_valor)     then array['filial_com_valor']       else '{}'::text[] end)
   || (case when exists (select 1 from conta_propria) then array['filial_e_conta_propria'] else '{}'::text[] end)
   || (case when exists (select 1 from duplicado)     then array['cadastro_duplicado']     else '{}'::text[] end)
      as divergencias,
      jsonb_strip_nulls(jsonb_build_object(
        'faltando',      (select jsonb_agg(jsonb_build_object('cnpj', cnpj_norm, 'nome', nome)) from faltando),
        'sem_matriz',    (select jsonb_agg(jsonb_build_object('cliente_id', id, 'nome', razao_social, 'cnpj', cnpj_digits)) from sem_matriz),
        'com_valor',     (select jsonb_agg(jsonb_build_object('cliente_id', id, 'nome', razao_social, 'cnpj', cnpj_digits, 'mrr', vlr_mensal, 'custo', vlr_custo)) from com_valor),
        'conta_propria', (select jsonb_agg(jsonb_build_object('cliente_id', id, 'nome', razao_social, 'cnpj', cnpj_digits)) from conta_propria),
        'duplicado',     (select jsonb_agg(jsonb_build_object('cliente_id', id, 'nome', razao_social)) from duplicado)
      )) as detalhe
  ) fl on n.ds_id is not null
  on conflict (tenant_id, id_portal) where id_portal is not null do update set
    gerado_em             = excluded.gerado_em,
    cnpj_norm             = excluded.cnpj_norm,
    razao_social_hiper    = excluded.razao_social_hiper,
    situacao_hiper        = excluded.situacao_hiper,
    plano_hiper           = excluded.plano_hiper,
    responsavel_tipo      = excluded.responsavel_tipo,
    mrr_hiper             = excluded.mrr_hiper,
    custo_hiper           = excluded.custo_hiper,
    cancelada_em          = excluded.cancelada_em,
    cancelada_por         = excluded.cancelada_por,
    ds_cliente_id         = excluded.ds_cliente_id,
    ds_cliente_produto_id = excluded.ds_cliente_produto_id,
    razao_social_ds       = excluded.razao_social_ds,
    cnpj_ds               = excluded.cnpj_ds,
    modelo_contrato_id_ds = excluded.modelo_contrato_id_ds,
    modelo_contrato_ds    = excluded.modelo_contrato_ds,
    mensalidade_ds        = excluded.mensalidade_ds,
    custo_ds              = excluded.custo_ds,
    cancelado_ds          = excluded.cancelado_ds,
    qtd_candidatos_ds     = excluded.qtd_candidatos_ds,
    criterio_match        = excluded.criterio_match,
    estado_match          = excluded.estado_match,
    divergencias          = excluded.divergencias,
    detalhe               = excluded.detalhe,
    margem                = excluded.margem,
    -- A decisão do operador só é reaberta se o CONJUNTO de divergências mudou.
    -- Sem isto, resolver de manhã traria a linha de volta à tarde.
    status_usuario = case
      when r.divergencias is distinct from excluded.divergencias then 'pendente'
      else r.status_usuario end,
    resolvido_em = case
      when r.divergencias is distinct from excluded.divergencias then null
      else r.resolvido_em end,
    resolvido_por = case
      when r.divergencias is distinct from excluded.divergencias then null
      else r.resolvido_por end;

  get diagnostics v_contas = row_count;

  -- ── cliente do DoctorSaaS sem conta nenhuma no portal ───────────────────────
  -- Quem casou como FILIAL não entra: seria acusar 33 clientes de órfãos quando
  -- eles têm conta-mãe.
  insert into public.reconciliacao_hiper as r (
    tenant_id, gerado_em, ds_cliente_id, ds_cliente_produto_id, razao_social_ds, cnpj_ds,
    modelo_contrato_id_ds, modelo_contrato_ds, mensalidade_ds, custo_ds, cancelado_ds,
    estado_match, divergencias, detalhe
  )
  select p_tenant_id, now(), d.cliente_id, d.cp_id, d.razao_social, d.cnpj,
         d.modelo_contrato_id, mc.nome, d.vlr_mensal, d.vlr_custo, d.cancelado,
         'sem_conta', array['sem_conta_no_hiper'], '{}'::jsonb
  from _ds d
  left join public.modelos_contrato mc on mc.id = d.modelo_contrato_id
  where not d.cancelado
    and not exists (select 1 from _novo n where n.ds_id = d.cliente_id)
    and not exists (select 1 from _fil_match f where f.cliente_id = d.cliente_id)
  on conflict (tenant_id, ds_cliente_id) where id_portal is null do update set
    gerado_em             = excluded.gerado_em,
    razao_social_ds       = excluded.razao_social_ds,
    cnpj_ds               = excluded.cnpj_ds,
    modelo_contrato_id_ds = excluded.modelo_contrato_id_ds,
    modelo_contrato_ds    = excluded.modelo_contrato_ds,
    mensalidade_ds        = excluded.mensalidade_ds,
    custo_ds              = excluded.custo_ds,
    cancelado_ds          = excluded.cancelado_ds,
    estado_match          = excluded.estado_match,
    divergencias          = excluded.divergencias;

  get diagnostics v_orfaos = row_count;

  -- ── some com o que não existe mais dos dois lados ───────────────────────────
  delete from public.reconciliacao_hiper r
  where r.tenant_id = p_tenant_id
    and (
      (r.id_portal is not null
        and not exists (select 1 from _novo n where n.id_portal = r.id_portal))
      or
      (r.id_portal is null
        and not exists (
          select 1 from _ds d
          where d.cliente_id = r.ds_cliente_id and not d.cancelado
            and not exists (select 1 from _novo n where n.ds_id = d.cliente_id)
            and not exists (select 1 from _fil_match f where f.cliente_id = d.cliente_id)))
    );

  select count(*) into v_pendentes
  from public.reconciliacao_hiper
  where tenant_id = p_tenant_id and status_usuario = 'pendente'
    and cardinality(divergencias) > 0;

  select count(*) into v_novas
  from public.reconciliacao_hiper
  where tenant_id = p_tenant_id and gerado_em >= now() - interval '1 minute'
    and status_usuario = 'pendente' and cardinality(divergencias) > 0;

  return jsonb_build_object(
    'ok', true,
    'contas', v_contas,
    'orfaos', v_orfaos,
    'pendentes', v_pendentes,
    'novas', v_novas
  );
end;
$$;

revoke all on function public.hiper_reconciliar(uuid) from public;
grant execute on function public.hiper_reconciliar(uuid) to authenticated, service_role;
revoke all on function public.hiper_norm_razao(text) from public;
grant execute on function public.hiper_norm_razao(text) to authenticated, service_role;
