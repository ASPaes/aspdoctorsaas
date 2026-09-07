-- Duas correções pequenas na reconciliação de módulos do OEM.

-- =========================================================================
-- 1. A CARGA PARA DE INFLAR QUANTIDADE ZERO
--
-- `greatest(coalesce(x.quantidade, 1), 1)` forçava mínimo 1. Quando o OEM diz
-- `quantidade: 0` com `ativo: true` — a filial não contratou aquele módulo,
-- caso comum em centro de distribuição sem PDV —, a ficha passava a afirmar
-- que o cliente tem 1. Foi a origem das 12 divergências que a reconciliação
-- de 06/09/2026 apontou, em 12 clientes.
--
-- ⚠️ NÃO HÁ DINHEIRO ERRADO NISSO, e a primeira análise dizia que havia.
-- Eu somei o `vlr_custo` (unitário) e anunciei R$ 198,07/mês de custo
-- fantasma. Errado: o custo do produto sai de
-- `coalesce(vlr_custo_total, vlr_custo * quantidade)` em
-- `fn_sync_produto_valores`, e nessas linhas o `vlr_custo_total` vem 0 do
-- parceiro — não NULL, 0. Custo efetivo e receita efetiva conferidos nas 12:
-- R$ 0,00 nos dois. O defeito é a ficha mentir na tela, e só.
--
-- ⚠️ POR QUE NÃO TIRAR ESSES MÓDULOS DA CARGA
-- A saída óbvia seria não listá-los em `v_chaves`. Ela está ERRADA: módulo
-- fora de `v_chaves` cai no DELETE e no "inativar" no fim da função. E
-- quantidade 0 com ativo true não acontece só nos módulos contados — em
-- 06/09/2026 o espelho tinha 523 filiais assim no Usuário Cloud, 166 na
-- Licença PDV, mas também 1 no NFCE e 1 no NFE, que são liga/desliga.
-- Apagaríamos módulo de bandeira contratado por causa de um zero que ali
-- significa outra coisa.
--
-- `coalesce(x.quantidade, 1)` mantém o padrão 1 para quem NÃO INFORMA
-- quantidade (módulo sem contagem) e respeita o zero de quem informa. É a
-- diferença entre "não sei" e "sei que é zero", que é o mesmo par que já
-- separou tantas coisas nesta integração.
-- =========================================================================
create or replace function public.fn_oem_espelhar_modulos_no_contrato(
  p_tenant_id uuid, p_filial_codigo text, p_modulos jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_cp              record;
  v_m               record;
  v_modulo_id       uuid;
  v_chaves          text[];
  v_n               int;
  v_criados_catalogo int := 0;
  v_vinculados      int := 0;
  v_atualizados     int := 0;
  v_inativados      int := 0;
  v_apagados        int := 0;
BEGIN
  IF p_modulos IS NULL OR jsonb_typeof(p_modulos) <> 'array' THEN
    RETURN jsonb_build_object('ignorado', 'filial sem lista de módulos');
  END IF;

  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  SELECT array_agg(DISTINCT public.fn_norm_nome_modulo(x.nome))
    INTO v_chaves
    FROM jsonb_to_recordset(p_modulos) AS x(nome text, ativo boolean)
   WHERE coalesce(x.ativo, true) = true AND coalesce(btrim(x.nome), '') <> '';

  FOR v_cp IN
    SELECT cp.id, cp.produto_id, cp.tenant_id
      FROM public.cliente_produtos cp
     WHERE cp.tenant_id = p_tenant_id
       AND cp.oem_codigo_filial = p_filial_codigo
  LOOP
    FOR v_m IN
      SELECT DISTINCT ON (public.fn_norm_nome_modulo(x.nome))
             btrim(x.nome)                     AS nome,
             public.fn_norm_nome_modulo(x.nome) AS chave,
             x.codigo                          AS codigo,
             -- AQUI. Era `greatest(coalesce(x.quantidade, 1), 1)`.
             coalesce(x.quantidade, 1)         AS quantidade,
             coalesce(x.valor_unitario, 0)     AS valor,
             x.valor_total                     AS valor_total
        FROM jsonb_to_recordset(p_modulos)
             AS x(nome text, codigo int, ativo boolean,
                  quantidade numeric, valor_unitario numeric, valor_total numeric)
       WHERE coalesce(x.ativo, true) = true
         AND coalesce(btrim(x.nome), '') <> ''
       ORDER BY public.fn_norm_nome_modulo(x.nome), x.codigo
    LOOP
      SELECT m.id INTO v_modulo_id
        FROM public.produto_modulos m
       WHERE m.produto_id = v_cp.produto_id
         AND public.fn_norm_nome_modulo(m.nome) = v_m.chave
       ORDER BY m.created_at
       LIMIT 1;

      IF v_modulo_id IS NULL THEN
        INSERT INTO public.produto_modulos
          (tenant_id, produto_id, nome, descricao, ativo, vlr_custo,
           margem_percentual, vlr_venda, oem_modulo_codigo)
        VALUES
          (v_cp.tenant_id, v_cp.produto_id, v_m.nome,
           'Importado do OEM · módulo #' || coalesce(v_m.codigo, 0), true, v_m.valor,
           0, 0, v_m.codigo)
        RETURNING id INTO v_modulo_id;
        v_criados_catalogo := v_criados_catalogo + 1;
      ELSE
        -- Módulo que já existia no catálogo e ainda não tinha o código: é a
        -- carga do espelho que sabe qual é.
        UPDATE public.produto_modulos
           SET oem_modulo_codigo = v_m.codigo, updated_at = now()
         WHERE id = v_modulo_id
           AND oem_modulo_codigo IS NULL
           AND v_m.codigo IS NOT NULL;
      END IF;

      UPDATE public.cliente_produto_modulos c
         SET quantidade        = coalesce(c.quantidade_manual, v_m.quantidade),
             vlr_custo         = v_m.valor,
             vlr_custo_total   = v_m.valor_total,
             oem_modulo_codigo = v_m.codigo,
             quantidade_manual = CASE WHEN coalesce(c.quantidade_manual, -1) = v_m.quantidade
                                      THEN NULL ELSE c.quantidade_manual END,
             ativo             = CASE WHEN c.cancelado_manual THEN c.ativo ELSE true END,
             data_inativacao   = CASE WHEN c.cancelado_manual THEN c.data_inativacao ELSE NULL END,
             updated_at        = now()
       WHERE c.cliente_produto_id = v_cp.id
         AND c.modulo_id = v_modulo_id
         AND c.origem = 'oem';
      GET DIAGNOSTICS v_n = ROW_COUNT;

      IF v_n > 0 THEN
        v_atualizados := v_atualizados + v_n;
      ELSIF NOT EXISTS (
        SELECT 1 FROM public.cliente_produto_modulos c
         WHERE c.cliente_produto_id = v_cp.id AND c.modulo_id = v_modulo_id
      ) THEN
        INSERT INTO public.cliente_produto_modulos
          (tenant_id, cliente_produto_id, modulo_id, quantidade,
           vlr_custo, vlr_custo_total, vlr_mensal, ativo, origem, data_ativacao, oem_modulo_codigo)
        VALUES
          (v_cp.tenant_id, v_cp.id, v_modulo_id, v_m.quantidade,
           v_m.valor, v_m.valor_total, 0, true, 'oem', current_date, v_m.codigo);
        v_vinculados := v_vinculados + 1;
      END IF;
    END LOOP;

    DELETE FROM public.cliente_produto_modulos c
     USING public.produto_modulos m
     WHERE m.id = c.modulo_id
       AND c.cliente_produto_id = v_cp.id
       AND c.origem = 'oem'
       AND c.cancelado_manual = false
       AND (v_chaves IS NULL OR NOT (public.fn_norm_nome_modulo(m.nome) = ANY (v_chaves)))
       AND NOT EXISTS (
         SELECT 1 FROM public.movimentos_mrr mv WHERE mv.cliente_produto_modulo_id = c.id
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_apagados := v_apagados + v_n;

    UPDATE public.cliente_produto_modulos c
       SET ativo = false, data_inativacao = current_date, updated_at = now()
      FROM public.produto_modulos m
     WHERE m.id = c.modulo_id
       AND c.cliente_produto_id = v_cp.id
       AND c.origem = 'oem'
       AND c.ativo
       AND (v_chaves IS NULL OR NOT (public.fn_norm_nome_modulo(m.nome) = ANY (v_chaves)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inativados := v_inativados + v_n;
  END LOOP;

  RETURN jsonb_build_object(
    'vinculados',       v_vinculados,
    'atualizados',      v_atualizados,
    'inativados',       v_inativados,
    'apagados',         v_apagados,
    'criados_catalogo', v_criados_catalogo
  );
END;
$function$;

-- =========================================================================
-- 2. A VIEW DE DIVERGÊNCIA PARA DE DUPLICAR LINHA
--
-- O nome do módulo era buscado por (produto × código do OEM), e isso
-- MULTIPLICA a linha quando o catálogo tem mais de um módulo com o mesmo
-- código: em "PDV Legal - Raspberry" existem `Licença PDV` e `PDV/Comandas`,
-- os dois no código 10. A view anunciou 14 divergências onde havia 12, e as
-- duas sobrando eram a mesma linha com dois nomes.
--
-- Agora o nome vem do módulo que a ficha de fato aponta (`cpm.modulo_id`),
-- que é sem ambiguidade.
-- =========================================================================
create or replace view public.v_oem_divergencia_modulo as
with ficha as (
  select cp.tenant_id,
         cp.id                       as cliente_produto_id,
         cp.cliente_id,
         cp.oem_codigo_filial        as filial_codigo,
         cpm.oem_modulo_codigo       as codigo,
         sum(case when cpm.ativo then greatest(coalesce(cpm.quantidade, 1), 1) else 0 end) as qtd_ficha,
         bool_or(cpm.ativo)          as vivo_na_ficha,
         bool_or(coalesce(cpm.cancelado_manual, false) and not cpm.ativo) as cancelado_na_ficha,
         max(cpm.data_inativacao) filter (where not cpm.ativo) as cancelado_em,
         min(pmf.nome)               as modulo
    from public.cliente_produto_modulos cpm
    join public.cliente_produtos cp on cp.id = cpm.cliente_produto_id
    left join public.produto_modulos pmf on pmf.id = cpm.modulo_id
   where cpm.oem_modulo_codigo is not null
     and cp.oem_codigo_filial is not null
   group by 1, 2, 3, 4, 5
),
licenca as (
  select e.tenant_id,
         e.filial_codigo,
         e.conta_integration_id,
         e.last_sync_oem,
         e.desativa_em,
         (m->>'codigo')::int                          as codigo,
         coalesce((m->>'ativo')::boolean, true)        as ativo_no_oem,
         coalesce((m->>'quantidade')::numeric, 0)      as qtd_oem,
         nullif(m->>'datavalidade', '')::timestamptz   as baixa_em,
         coalesce(nullif(m->>'datavalidade', '')::timestamptz > now(), false) as baixa_futura
    from public.oem_espelho_filial e
    cross join lateral jsonb_array_elements(e.modulos) m
   where jsonb_typeof(e.modulos) = 'array'
)
select f.tenant_id,
       f.cliente_id,
       f.cliente_produto_id,
       f.filial_codigo,
       f.codigo,
       f.modulo,
       c.nome_fantasia        as cliente,
       l.conta_integration_id,
       l.last_sync_oem,
       f.qtd_ficha, f.vivo_na_ficha, f.cancelado_na_ficha, f.cancelado_em,
       l.qtd_oem, l.ativo_no_oem, l.baixa_em, l.baixa_futura,
       case
         when f.cancelado_na_ficha and not f.vivo_na_ficha
              and l.ativo_no_oem and not l.baixa_futura
           then 'cancelado_ativo_no_oem'
         when f.vivo_na_ficha and not l.ativo_no_oem
              and l.baixa_em::date is distinct from l.desativa_em
           then 'ativo_desligado_no_oem'
         when f.vivo_na_ficha and l.ativo_no_oem and not l.baixa_futura
              and f.qtd_ficha <> l.qtd_oem
           then 'quantidade_divergente'
       end as tipo
  from ficha f
  join licenca l
    on l.tenant_id = f.tenant_id
   and l.filial_codigo = f.filial_codigo
   and l.codigo = f.codigo
  left join public.clientes c on c.id = f.cliente_id
 where f.codigo <> 8
   and l.last_sync_oem > now() - interval '24 hours'
   and not exists (
     select 1 from public.oem_sync_fila q
      where q.cliente_produto_id = f.cliente_produto_id
        and q.oem_modulo_codigo = f.codigo
        and (q.status in ('pendente', 'processando', 'erro', 'aguardando_aprovacao')
             or q.processado_em > l.last_sync_oem)
   );

comment on view public.v_oem_divergencia_modulo is
  'Módulos em que a ficha do cliente e a licença do OEM discordam. Só linhas com `tipo` preenchido são divergência; o resto está de acordo.';
