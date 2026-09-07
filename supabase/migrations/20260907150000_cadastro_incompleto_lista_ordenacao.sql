-- Ordenação por coluna na lista de Cadastro incompleto.
--
-- Precisa ser aqui e não na tela: a lista corta em 300 de 567. Ordenar as 300
-- já carregadas responderia "o mais antigo das 300", não o mais antigo da fila.
--
-- DROP + CREATE porque a contagem de parâmetros muda: CREATE OR REPLACE criaria
-- uma sobrecarga e a chamada por nome do PostgREST ficaria ambígua. Os dois
-- parâmetros novos têm default, então a tela publicada continua chamando com os
-- 7 de sempre enquanto o frontend novo não sobe.
drop function if exists public.fn_cadastro_incompleto_lista(uuid, text, bigint[], bigint, text, integer, integer);

create or replace function public.fn_cadastro_incompleto_lista(
  p_tenant_id uuid,
  p_campo text,
  p_unidades bigint[] default null::bigint[],
  p_produto_id bigint default null::bigint,
  p_busca text default null::text,
  p_limite integer default 200,
  p_offset integer default 0,
  p_ordem text default null::text,
  p_dir text default 'asc'::text
)
returns table(registro_id uuid, cliente_id uuid, codigo integer, cliente_nome text,
              detalhe text, unidade text, data_cadastro date, total bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_q   text;
  v_bs  text := nullif(btrim(coalesce(p_busca, '')), '');
  v_ord text;
  v_dir text := case when lower(coalesce(p_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;
begin
  if not (
    coalesce(current_setting('role', true), '') = 'service_role'
    or public.is_super_admin()
    or p_tenant_id = public.current_tenant_id()
  ) then
    raise exception 'Acesso negado ao tenant %', p_tenant_id using errcode = '42501';
  end if;

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
    using p_tenant_id, p_unidades, p_produto_id, v_bs, greatest(1, least(p_limite, 500)), greatest(0, p_offset);
end;
$function$;

revoke all on function public.fn_cadastro_incompleto_lista(uuid, text, bigint[], bigint, text, integer, integer, text, text) from public;
grant execute on function public.fn_cadastro_incompleto_lista(uuid, text, bigint[], bigint, text, integer, integer, text, text) to authenticated, service_role;
