-- Licença NOVA no OEM, pela fila de aprovação (25/09/2026).
--
-- Até aqui o DoctorSaaS só mexia em licença que já existia. Cliente novo com
-- produto do OEM ficava sem licença até alguém criá-la no portal do parceiro
-- e vir vincular à mão.
--
-- Regra do Alexandre (25/09): cliente novo segue o MESMO caminho do módulo.
-- Pedido → Clientes › Aprovação OEM → aprovado → OEM. Criar licença gera
-- cobrança no parceiro, então nada sai daqui sem alguém aprovar.
--
-- As peças:
--   fn_oem_licenca_contexto   o que a tela precisa para montar o pedido
--   fn_oem_solicitar_licenca  enfileira `criar_licenca` aguardando aprovação
--   fn_oem_licenca_criada     o processador grava o código que o OEM devolveu
--   acao 'criar_licenca'      aceita pela fila, pela aprovação e pelos avisos
--
-- Quem fala com o parceiro é a `oem-licenca-criar` (DoctorOEM), chamada pela
-- `oem-sync-processar`. Diferente das outras ações, `criar_licenca` NÃO
-- repete sozinha: uma tentativa que o OEM gravou e respondeu com erro,
-- repetida, criaria uma SEGUNDA licença cobrada. Falhou, para, e quem decide
-- é gente. O reprocessar manual é seguro porque a `oem-licenca-criar` recusa
-- criar a mesma loja duas vezes no mesmo grupo e devolve o código da que já
-- existe.

------------------------------------------------------------------------------
-- 1. A fila aceita a ação nova
------------------------------------------------------------------------------
ALTER TABLE public.oem_sync_fila DROP CONSTRAINT chk_oem_sync_acao;
ALTER TABLE public.oem_sync_fila ADD CONSTRAINT chk_oem_sync_acao
  CHECK (acao = ANY (ARRAY['ativar'::text, 'quantidade'::text, 'cancelar'::text, 'criar_licenca'::text]));

------------------------------------------------------------------------------
-- 2. Contexto do pedido: conta, produto do parceiro, módulos da ficha, padrões
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_licenca_contexto(p_cliente_produto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp       public.cliente_produtos;
  v_cli      public.clientes;
  v_conta    uuid;
  v_prod_cod text;
  v_prod_nom text;
  v_modulos  jsonb;
  v_sem_cod  jsonb;
  v_pedido   jsonb;
  v_padroes  jsonb;
BEGIN
  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = p_cliente_produto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto do cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
       current_setting('role', true) = 'service_role'
       OR v_cp.tenant_id = public.current_tenant_id()
       OR public.is_super_admin(),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cli FROM public.clientes WHERE id = v_cp.cliente_id;

  -- Conta pela unidade do cliente (NULL = todas) e, dentro dela, o produto do
  -- parceiro deste produto: a mesma regra da fn_oem_tabela_do_produto.
  SELECT i.id INTO v_conta
    FROM public.oem_integration i
   WHERE i.tenant_id = v_cp.tenant_id AND i.ativo = true
     AND (i.unidades_base_ids IS NULL OR v_cli.unidade_base_id = ANY(i.unidades_base_ids))
   ORDER BY i.criado_em
   LIMIT 1;

  IF v_conta IS NOT NULL THEN
    SELECT v.produto_codigo, v.produto_nome INTO v_prod_cod, v_prod_nom
      FROM public.oem_produto_vinculo v
      LEFT JOIN LATERAL (
        SELECT count(*) AS n FROM public.oem_espelho_filial f
         WHERE f.conta_integration_id = v.conta_integration_id
           AND f.status = 'Ativo' AND f.produto_principal = v.produto_nome) u ON true
     WHERE v.conta_integration_id = v_conta
       AND v.produto_id = v_cp.produto_id
     ORDER BY u.n DESC, v.produto_codigo
     LIMIT 1;
  END IF;

  -- Os módulos que vão na licença são os da FICHA, não os que a tela mandar:
  -- o pedido não pode dizer uma coisa e a ficha outra.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'nome', pm.nome, 'codigo', m.oem_modulo_codigo,
           'quantidade', m.quantidade, 'custo_unit', m.vlr_custo)
           ORDER BY pm.nome), '[]'::jsonb)
    INTO v_modulos
    FROM public.cliente_produto_modulos m
    JOIN public.produto_modulos pm ON pm.id = m.modulo_id
   WHERE m.cliente_produto_id = v_cp.id AND m.ativo = true
     AND m.oem_modulo_codigo IS NOT NULL;

  SELECT coalesce(jsonb_agg(pm.nome ORDER BY pm.nome), '[]'::jsonb)
    INTO v_sem_cod
    FROM public.cliente_produto_modulos m
    JOIN public.produto_modulos pm ON pm.id = m.modulo_id
   WHERE m.cliente_produto_id = v_cp.id AND m.ativo = true
     AND m.oem_modulo_codigo IS NULL;

  SELECT jsonb_build_object('id', f.id, 'status', f.status, 'ultimo_erro', f.ultimo_erro)
    INTO v_pedido
    FROM public.oem_sync_fila f
   WHERE f.cliente_produto_id = v_cp.id
     AND f.acao = 'criar_licenca'
     AND f.status IN ('aguardando_aprovacao','pendente','processando','erro','invalido')
   ORDER BY f.enfileirado_em DESC
   LIMIT 1;

  -- "Padrão por tenant" = o último pedido desta conta. Quem vende sempre o
  -- mesmo tipo de negócio não escolhe de novo, e nenhuma tela de configuração
  -- nova precisa existir para isso.
  SELECT jsonb_build_object(
           'tipo_negocio',         f.payload->'tipo_negocio',
           'detalhe_tipo_negocio', f.payload->'detalhe_tipo_negocio',
           'origem_venda',         f.payload->'origem_venda')
    INTO v_padroes
    FROM public.oem_sync_fila f
   WHERE f.conta_integration_id = v_conta AND f.acao = 'criar_licenca'
   ORDER BY f.enfileirado_em DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'tem_licenca',        v_cp.oem_codigo_filial IS NOT NULL,
    'grupo_codigo',       v_cp.oem_codigo_grupo,
    'filial_codigo',      v_cp.oem_codigo_filial,
    'conta_id',           v_conta,
    'produto_codigo',     v_prod_cod,
    'produto_nome',       v_prod_nom,
    'cliente', jsonb_build_object(
      'nome_fantasia', v_cli.nome_fantasia, 'razao_social', v_cli.razao_social,
      'cnpj', v_cli.cnpj, 'email', v_cli.email),
    'modulos',            v_modulos,
    'modulos_sem_codigo', v_sem_cod,
    'custo_previsto',     (SELECT coalesce(sum((x->>'custo_unit')::numeric * (x->>'quantidade')::numeric), 0)
                             FROM jsonb_array_elements(v_modulos) x),
    'pedido_vivo',        v_pedido,
    'padroes',            coalesce(v_padroes, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_licenca_contexto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_licenca_contexto(uuid) TO authenticated, service_role;

------------------------------------------------------------------------------
-- 3. O pedido
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_solicitar_licenca(p_cliente_produto_id uuid, p_dados jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp      public.cliente_produtos;
  v_ctx     jsonb;
  v_modo    text := p_dados->>'modo';
  v_grupo   text := nullif(regexp_replace(coalesce(p_dados->>'grupo_codigo',''), '\D', '', 'g'), '');
  v_gnome   text;
  v_loja    text := nullif(btrim(coalesce(p_dados->>'nome_loja','')), '');
  v_cnpj    text := regexp_replace(coalesce(p_dados->>'cnpj_loja',''), '\D', '', 'g');
  v_email   text := nullif(btrim(coalesce(p_dados->>'email','')), '');
  v_tipo    integer := nullif(p_dados->>'tipo_negocio','')::integer;
  v_det     integer := nullif(p_dados->>'detalhe_tipo_negocio','')::integer;
  v_origem  integer := nullif(p_dados->>'origem_venda','')::integer;
  v_id      uuid;
BEGIN
  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = p_cliente_produto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto do cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesmo portão do pedido de módulo (fn_oem_enfileirar_novo).
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT coalesce(
       (v_cp.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
       AND coalesce(public.is_admin_or_head(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão para pedir licença ao OEM.' USING ERRCODE = '42501';
  END IF;

  IF v_cp.oem_codigo_filial IS NOT NULL THEN
    RAISE EXCEPTION 'Este produto já tem licença no OEM (filial %).', v_cp.oem_codigo_filial USING ERRCODE = '23505';
  END IF;
  IF v_cp.ativo IS NOT TRUE THEN
    RAISE EXCEPTION 'Produto inativo não recebe licença.' USING ERRCODE = '22023';
  END IF;

  v_ctx := public.fn_oem_licenca_contexto(p_cliente_produto_id);

  IF jsonb_typeof(v_ctx->'pedido_vivo') = 'object' THEN
    RAISE EXCEPTION 'Já existe um pedido de licença para este produto em andamento.' USING ERRCODE = '23505';
  END IF;
  IF v_ctx->>'conta_id' IS NULL THEN
    RAISE EXCEPTION 'A unidade deste cliente não tem conta do OEM conectada.' USING ERRCODE = '22023';
  END IF;
  IF v_ctx->>'produto_codigo' IS NULL THEN
    RAISE EXCEPTION 'Este produto não está ligado a um produto do OEM (Configurações › Integrações › OEM).' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_ctx->'modulos') = 0 THEN
    RAISE EXCEPTION 'O produto não tem nenhum módulo do OEM na ficha. Adicione os módulos antes de pedir a licença.' USING ERRCODE = '22023';
  END IF;

  IF v_modo NOT IN ('avulsa','grupo') THEN
    RAISE EXCEPTION 'Escolha licença avulsa ou filial de grupo.' USING ERRCODE = '22023';
  END IF;
  IF v_loja IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da loja.' USING ERRCODE = '22023';
  END IF;
  IF length(v_cnpj) NOT IN (11, 14) THEN
    RAISE EXCEPTION 'CNPJ/CPF da loja inválido.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_tipo, 0) <= 0 OR coalesce(v_det, 0) <= 0 OR coalesce(v_origem, 0) <= 0 THEN
    RAISE EXCEPTION 'Tipo de negócio, detalhe e origem da venda são obrigatórios no OEM.' USING ERRCODE = '22023';
  END IF;

  IF v_modo = 'grupo' THEN
    -- O grupo tem que existir na MESMA conta: grupo de outra unidade seria
    -- criado com a chave errada.
    SELECT ef.grupo_economico INTO v_gnome
      FROM public.oem_espelho_filial ef
     WHERE ef.conta_integration_id = (v_ctx->>'conta_id')::uuid
       AND ef.empresa_codigo = v_grupo
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Grupo % não encontrado nesta conta do OEM.', coalesce(v_grupo, '(vazio)') USING ERRCODE = '22023';
    END IF;
  ELSE
    v_grupo := NULL;
    IF v_email IS NULL OR v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
      RAISE EXCEPTION 'Licença avulsa cria um grupo novo no OEM e ele exige e-mail.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, acao,
    empresa_codigo, filial_codigo, payload, usuario_id, status
  ) VALUES (
    v_cp.tenant_id, (v_ctx->>'conta_id')::uuid, v_cp.id, 'criar_licenca',
    v_grupo, NULL,
    jsonb_build_object(
      'modo',                 v_modo,
      'grupo_codigo',         v_grupo,
      'nome_grupo',           coalesce(v_gnome, v_loja),
      'nome_loja',            v_loja,
      'cnpj_loja',            v_cnpj,
      'email',                v_email,
      'tipo_negocio',         v_tipo,
      'tipo_negocio_nome',    p_dados->>'tipo_negocio_nome',
      'detalhe_tipo_negocio', v_det,
      'detalhe_nome',         p_dados->>'detalhe_nome',
      'origem_venda',         v_origem,
      'origem_venda_nome',    p_dados->>'origem_venda_nome',
      'produto_codigo',       (v_ctx->>'produto_codigo')::integer,
      'produto_nome',         v_ctx->>'produto_nome',
      'modulos',              v_ctx->'modulos',
      'custo_previsto',       v_ctx->'custo_previsto'),
    public.fn_acting_user(),
    'aguardando_aprovacao'
  ) RETURNING id INTO v_id;

  INSERT INTO public.cliente_produto_modulo_eventos
    (tenant_id, cliente_produto_id, modulo_nome, acao, usuario_id, usuario_nome, motivo, fonte)
  SELECT v_cp.tenant_id, v_cp.id, 'Licença OEM', 'licenca_solicitada',
         public.fn_acting_user(), fu.nome,
         CASE v_modo WHEN 'grupo' THEN 'Filial no grupo ' || v_grupo || coalesce(' (' || v_gnome || ')', '')
                     ELSE 'Licença avulsa' END,
         public.fn_acting_source()
    FROM (SELECT 1) x
    LEFT JOIN public.profiles p ON p.user_id = public.fn_acting_user()
    LEFT JOIN public.funcionarios fu ON fu.id = p.funcionario_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_solicitar_licenca(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_solicitar_licenca(uuid, jsonb) TO authenticated, service_role;

------------------------------------------------------------------------------
-- 4. O OEM criou: grava o código na ficha. Só o processador chama.
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_licenca_criada(p_fila_id uuid, p_grupo text, p_filial text, p_resposta jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_f    public.oem_sync_fila;
  v_cp   public.cliente_produtos;
  v_dono uuid;
BEGIN
  SELECT * INTO v_f FROM public.oem_sync_fila WHERE id = p_fila_id FOR UPDATE;
  IF NOT FOUND OR v_f.acao <> 'criar_licenca' THEN
    RAISE EXCEPTION 'Linha de criação de licença não encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF nullif(p_grupo,'') IS NULL OR nullif(p_filial,'') IS NULL THEN
    RAISE EXCEPTION 'Grupo e filial são obrigatórios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = v_f.cliente_produto_id FOR UPDATE;

  -- Nunca sobrescreve: se alguém vinculou outra licença enquanto o pedido
  -- andava, a decisão é de gente.
  IF v_cp.oem_codigo_filial IS NOT NULL AND v_cp.oem_codigo_filial <> p_filial THEN
    RAISE EXCEPTION 'O produto já está ligado à filial %, não à % que o OEM criou.',
      v_cp.oem_codigo_filial, p_filial USING ERRCODE = '23505';
  END IF;

  SELECT cp.id INTO v_dono
    FROM public.cliente_produtos cp
   WHERE cp.tenant_id = v_cp.tenant_id AND cp.oem_codigo_filial = p_filial AND cp.id <> v_cp.id
   LIMIT 1;
  IF v_dono IS NOT NULL THEN
    RAISE EXCEPTION 'A filial % já está ligada a outro produto.', p_filial USING ERRCODE = '23505';
  END IF;

  UPDATE public.cliente_produtos
     SET oem_codigo_grupo = p_grupo, oem_codigo_filial = p_filial, updated_at = now()
   WHERE id = v_cp.id AND oem_codigo_filial IS DISTINCT FROM p_filial;

  UPDATE public.oem_sync_fila
     SET status = 'ok', empresa_codigo = p_grupo, filial_codigo = p_filial,
         ultimo_erro = NULL, resposta = p_resposta, processado_em = now()
   WHERE id = p_fila_id;

  -- Quem responde pelo evento é quem APROVOU: foi a decisão dele que criou a
  -- licença. O processador roda sem usuário.
  INSERT INTO public.cliente_produto_modulo_eventos
    (tenant_id, cliente_produto_id, modulo_nome, acao, usuario_id, usuario_nome, motivo, fonte)
  SELECT v_cp.tenant_id, v_cp.id, 'Licença OEM', 'licenca_criada', v_f.decidido_por, fu.nome,
         'Grupo ' || p_grupo || ' · filial ' || p_filial, 'oem'
    FROM (SELECT 1) x
    LEFT JOIN public.profiles p ON p.user_id = v_f.decidido_por
    LEFT JOIN public.funcionarios fu ON fu.id = p.funcionario_id;

  RETURN jsonb_build_object('ok', true, 'grupo', p_grupo, 'filial', p_filial);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_licenca_criada(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_licenca_criada(uuid, text, text, jsonb) TO service_role;

------------------------------------------------------------------------------
-- 5. Aprovação: a linha de licença leva o pedido inteiro para a tela
--    (corpo de produção de 25/09 + a chave 'licenca')
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_listar(p_tenant_id uuid DEFAULT NULL::uuid, p_unidades bigint[] DEFAULT NULL::bigint[], p_limite integer DEFAULT 200, p_historico integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
BEGIN
  IF NOT public.fn_oem_aprovacao_pode(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    WITH linhas AS (
      SELECT
        f.id,
        f.acao,
        f.status,
        f.quantidade,
        f.enfileirado_em,
        f.decidido_em,
        f.motivo_recusa,
        f.ultimo_erro,
        f.payload,
        f.cliente_produto_id,
        cp.cliente_id,
        coalesce(c.nome_fantasia, c.razao_social)                    AS cliente,
        -- Os três separados, para a tela poder mostrar o de baixo sem repetir o
        -- de cima e sem ninguém precisar abrir a ficha para conferir quem é.
        c.razao_social,
        c.nome_fantasia,
        c.cnpj,
        c.unidade_base_id,
        ub.nome                                                      AS unidade,
        pr.nome                                                      AS produto,
        coalesce(pm_cat.nome, pm_linha.nome)                         AS modulo,
        -- Só faz sentido em 'quantidade': é o "de" do "de 2 para 5".
        cpm.quantidade                                               AS quantidade_atual,
        -- O "de" de quem JÁ foi aplicado. Ver o aviso no cabeçalho: aqui a
        -- linha do módulo já mudou, e `quantidade_atual` diria o número novo.
        coalesce(
          nullif(f.resposta->'ficha'->'ficha'->>'quantidade_antes', ''),
          nullif(f.resposta->'oem'->'conferencia'->>'antes', ''),
          nullif(f.resposta->'conferencia'->>'antes', '')
        )::numeric                                                   AS quantidade_antes,
        fp.nome                                                      AS pedido_por,
        fd.nome                                                      AS decidido_por,
        CASE WHEN f.status = 'aguardando_aprovacao' THEN 0 ELSE 1 END AS ordem
      FROM public.oem_sync_fila f
      LEFT JOIN public.cliente_produtos cp        ON cp.id = f.cliente_produto_id
      LEFT JOIN public.clientes c                 ON c.id  = cp.cliente_id
      LEFT JOIN public.unidades_base ub           ON ub.id = c.unidade_base_id
      LEFT JOIN public.produtos pr                ON pr.id = cp.produto_id
      LEFT JOIN public.produto_modulos pm_cat     ON pm_cat.id = f.modulo_catalogo_id
      LEFT JOIN public.cliente_produto_modulos cpm ON cpm.id = f.modulo_linha_id
      LEFT JOIN public.produto_modulos pm_linha   ON pm_linha.id = cpm.modulo_id
      LEFT JOIN public.profiles prof_p            ON prof_p.user_id = f.usuario_id
      LEFT JOIN public.funcionarios fp            ON fp.id = prof_p.funcionario_id
      LEFT JOIN public.profiles prof_d            ON prof_d.user_id = f.decidido_por
      LEFT JOIN public.funcionarios fd            ON fd.id = prof_d.funcionario_id
      WHERE f.tenant_id = v_tenant
        AND (f.status = 'aguardando_aprovacao' OR f.decidido_em IS NOT NULL)
        AND (p_unidades IS NULL
             OR c.unidade_base_id IS NULL
             OR c.unidade_base_id = ANY(p_unidades))
    ),
    recorte AS (
      (SELECT * FROM linhas WHERE ordem = 0
        ORDER BY enfileirado_em
        LIMIT greatest(coalesce(p_limite, 200), 1))
      UNION ALL
      (SELECT * FROM linhas WHERE ordem = 1
        ORDER BY decidido_em DESC
        LIMIT greatest(coalesce(p_historico, 30), 0))
    )
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',                 r.id,
               'acao',               r.acao,
               'status',             r.status,
               -- O que a tela precisa dizer em uma palavra. 'aprovado' cobre a
               -- linha que já foi ao parceiro e a que ele recusou: o resultado
               -- do envio vai em `status`/`ultimo_erro`, separado da decisão de
               -- quem aprovou. Misturar os dois faria uma recusa do OEM parecer
               -- recusa do admin.
               'situacao',           CASE WHEN r.status = 'aguardando_aprovacao' THEN 'aguardando'
                                          WHEN r.status = 'recusado'             THEN 'recusado'
                                          ELSE 'aprovado' END,
               'cliente_id',         r.cliente_id,
               'cliente',            r.cliente,
               'razao_social',       r.razao_social,
               'nome_fantasia',      r.nome_fantasia,
               'cnpj',               r.cnpj,
               'unidade_base_id',    r.unidade_base_id,
               'unidade',            r.unidade,
               'produto',            r.produto,
               'modulo',             r.modulo,
               'quantidade',         r.quantidade,
               'quantidade_atual',   r.quantidade_atual,
               'quantidade_antes',   r.quantidade_antes,
               'quantidade_cancelar',nullif(r.payload->>'quantidade_cancelar','')::numeric,
               'vlr_mensal',         nullif(r.payload->>'vlr_mensal','')::numeric,
               'vlr_custo',          nullif(r.payload->>'vlr_custo','')::numeric,
               'vlr_ativacao',       coalesce(nullif(r.payload->>'vlr_ativacao','')::numeric,
                                              nullif(r.payload->>'vlr_ativacao_somar','')::numeric),
               'valor_downsell',     nullif(r.payload->>'valor_downsell','')::numeric,
               'motivo',             r.payload->>'motivo',
               -- Pedido de licença nova: grupo ou avulsa, loja, CNPJ, módulos e
               -- custo previsto. É o que quem aprova precisa ver para decidir.
               'licenca',            CASE WHEN r.acao = 'criar_licenca' THEN r.payload END,
               'pedido_por',         r.pedido_por,
               -- Pedido sem usuário não é anônimo: veio de uma integração, e a
               -- tela precisa poder dizer qual.
               'fonte',              nullif(r.payload->>'fonte',''),
               'enfileirado_em',     r.enfileirado_em,
               'decidido_por',       r.decidido_por,
               'decidido_em',        r.decidido_em,
               'motivo_recusa',      r.motivo_recusa,
               'ultimo_erro',        r.ultimo_erro
             )
             -- Aguardando primeiro, do mais antigo para o mais novo (FIFO: quem
             -- pediu antes espera menos). O histórico embaixo, do mais recente.
             ORDER BY r.ordem,
                      CASE WHEN r.ordem = 0 THEN r.enfileirado_em END ASC,
                      r.decidido_em DESC
           )
      FROM recorte r
  ), '[]'::jsonb);
END;
$function$;


------------------------------------------------------------------------------
-- 6. Aviso de pedido aguardando aprovação (corpo de produção + criar_licenca)
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_notificar(p_fila_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f          record;
  v_cli      text;
  v_cli_id   uuid;
  v_produto  text;
  v_modulo   text;
  v_pediu    text;
  v_qtd_hoje numeric;
  v_titulo   text;
  v_corpo    text;
  v_efeito   text;
  v_mensal   numeric;
  v_ativacao numeric;
  v_downsell numeric;
  v_alvos    uuid[];
BEGIN
  SELECT * INTO f FROM public.oem_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mesmo caminho de join da fn_oem_aprovacao_listar, para o aviso falar o
  -- mesmo nome que a aba mostra.
  SELECT coalesce(c.nome_fantasia, c.razao_social), c.id, pr.nome
    INTO v_cli, v_cli_id, v_produto
    FROM public.cliente_produtos cp
    LEFT JOIN public.clientes c   ON c.id  = cp.cliente_id
    LEFT JOIN public.produtos  pr ON pr.id = cp.produto_id
   WHERE cp.id = f.cliente_produto_id;

  -- No 'ativar' a linha da ficha ainda não existe: o nome vem do catálogo.
  SELECT coalesce(
           (SELECT pm.nome FROM public.produto_modulos pm WHERE pm.id = f.modulo_catalogo_id),
           (SELECT pm.nome FROM public.cliente_produto_modulos cpm
              JOIN public.produto_modulos pm ON pm.id = cpm.modulo_id
             WHERE cpm.id = f.modulo_linha_id))
    INTO v_modulo;

  SELECT fu.nome INTO v_pediu
    FROM public.profiles p
    LEFT JOIN public.funcionarios fu ON fu.id = p.funcionario_id
   WHERE p.user_id = f.usuario_id;

  SELECT cpm.quantidade INTO v_qtd_hoje
    FROM public.cliente_produto_modulos cpm WHERE cpm.id = f.modulo_linha_id;

  v_mensal   := nullif(f.payload->>'vlr_mensal', '')::numeric;
  v_ativacao := coalesce(nullif(f.payload->>'vlr_ativacao', '')::numeric,
                         nullif(f.payload->>'vlr_ativacao_somar', '')::numeric);
  v_downsell := nullif(f.payload->>'valor_downsell', '')::numeric;

  v_titulo := 'Aprovação OEM: '
           || CASE f.acao
                WHEN 'ativar'     THEN 'ativar ' || coalesce(v_modulo, 'módulo')
                WHEN 'quantidade' THEN coalesce(v_modulo, 'módulo')
                                       || ' para ' || coalesce(f.quantidade::text, '?')
                WHEN 'cancelar'   THEN 'cancelar ' || coalesce(v_modulo, 'módulo')
                WHEN 'criar_licenca' THEN 'criar licença'
                ELSE coalesce(f.acao, 'alteração')
              END
           || coalesce(' · ' || v_cli, '');

  -- `fmt_brl` devolve "R$ 0,00" para NULL, não NULL. Então cada valor é testado
  -- antes de entrar no texto: sem isso, módulo sem valor mensal anunciaria
  -- "soma R$ 0,00/mês no MRR", que parece número conferido e não é.
  v_efeito := CASE f.acao
    WHEN 'ativar' THEN
      'ativa o módulo na licença do parceiro'
      || CASE WHEN coalesce(v_mensal, 0) > 0
              THEN ' e soma ' || public.fmt_brl(v_mensal * greatest(coalesce(f.quantidade, 1), 1))
                   || '/mês no MRR do cliente'
              ELSE ' (sem valor mensal informado: não mexe no MRR)' END
      || CASE WHEN coalesce(v_ativacao, 0) > 0
              THEN ', com ' || public.fmt_brl(v_ativacao) || ' de ativação'
              ELSE '' END
    WHEN 'quantidade' THEN
      'muda a quantidade na licença de ' || coalesce(v_qtd_hoje::text, '?')
      || ' para ' || coalesce(f.quantidade::text, '?')
      || CASE WHEN coalesce(v_mensal, 0) > 0
                   AND coalesce(f.quantidade, 0) > coalesce(v_qtd_hoje, 0)
              THEN ', somando ' || public.fmt_brl(v_mensal * (f.quantidade - coalesce(v_qtd_hoje, 0)))
                   || '/mês no MRR do cliente'
              ELSE '' END
      || CASE WHEN coalesce(v_ativacao, 0) > 0
              THEN ', com ' || public.fmt_brl(v_ativacao) || ' de ativação'
              ELSE '' END
    WHEN 'cancelar' THEN
      'dá baixa de ' || coalesce(nullif(f.payload->>'quantidade_cancelar', ''), '1')
      || CASE WHEN coalesce(nullif(f.payload->>'quantidade_cancelar', '')::numeric, 1) > 1
              THEN ' unidades' ELSE ' unidade' END
      -- No cancelamento, f.quantidade é o que SOBRA na licença, não o que sai.
      || CASE WHEN coalesce(f.quantidade, 0) > 0
              THEN ' (sobram ' || f.quantidade::text || ' na licença)'
              ELSE ' (zera o módulo na licença)' END
      || CASE WHEN coalesce(v_downsell, 0) > 0
              THEN ' e tira ' || public.fmt_brl(v_downsell) || '/mês do MRR (downsell)'
              ELSE ' e NÃO mexe no MRR (baixa informada: zero)' END
    WHEN 'criar_licenca' THEN
      'cria no OEM '
      || CASE f.payload->>'modo' WHEN 'grupo'
              THEN 'a filial ' || coalesce(f.payload->>'nome_loja', '?') || ' no grupo '
                   || coalesce(f.payload->>'grupo_codigo', '?') || coalesce(' (' || (f.payload->>'nome_grupo') || ')', '')
              ELSE 'a licença avulsa ' || coalesce(f.payload->>'nome_loja', '?') END
      || ', com ' || jsonb_array_length(coalesce(f.payload->'modulos', '[]'::jsonb))::text || ' módulo(s)'
      || CASE WHEN coalesce(nullif(f.payload->>'custo_previsto','')::numeric, 0) > 0
              THEN '. Custo previsto no parceiro: ' || public.fmt_brl((f.payload->>'custo_previsto')::numeric) || '/mês'
              ELSE '' END
    ELSE 'aplica a alteração no parceiro'
  END;

  v_corpo := coalesce(v_pediu, 'Alguém') || ' pediu '
          || CASE f.acao
               WHEN 'ativar'     THEN 'a ativação de '
               WHEN 'quantidade' THEN 'a alteração de quantidade de '
               WHEN 'cancelar'   THEN 'o cancelamento de '
               WHEN 'criar_licenca' THEN 'uma licença nova no OEM para '
               ELSE 'uma alteração em '
             END
          || CASE WHEN f.acao = 'criar_licenca' THEN coalesce('o produto ' || v_produto, 'o produto')
                  ELSE coalesce(v_modulo, 'um módulo') || coalesce(' no produto ' || v_produto, '') END
          || coalesce(', para ' || v_cli, '') || '.'
          || E'\n\nSe aprovado: ' || v_efeito || '.'
          || coalesce(E'\nMotivo informado: ' || nullif(f.payload->>'motivo',''), '')
          || E'\n\nNada foi enviado ao OEM e nada entrou na ficha do cliente ainda.'
          || E'\n\n👉 O que fazer: abra Clientes › Aprovação OEM e aprove ou recuse. '
          || 'Recusar exige motivo e fica no histórico.';

  -- Os admins do tenant do cliente MAIS os super admins, de qualquer tenant.
  -- O super admin simula o tenant para agir nele, mas continua pertencendo ao
  -- seu; sem esta união ele nunca veria o aviso que ele mesmo vai aprovar.
  SELECT array_agg(DISTINCT u) INTO v_alvos
    FROM (
      SELECT unnest(coalesce(public.fn_notif_admins_do_tenant(f.tenant_id), '{}'::uuid[])) AS u
      UNION
      SELECT p.user_id
        FROM public.profiles p
       WHERE p.is_super_admin = true
         AND p.access_status = 'active'
         AND coalesce(p.status, 'ativo') = 'ativo'
    ) t
   WHERE u IS NOT NULL;

  PERFORM public.notify_event(
    f.tenant_id,
    'oem_aprovacao_pendente',
    'fila:' || f.id::text,
    v_titulo,
    v_corpo,
    jsonb_build_object(
      'fila_id',            f.id,
      'cliente_id',         v_cli_id,
      'cliente_produto_id', f.cliente_produto_id,
      'modulo_linha_id',    f.modulo_linha_id,
      'acao',               f.acao,
      'sistema',            'oem',
      -- Sem `toast_somente_para`: chave ausente = toast para todos que recebem.
      'target_user_ids',    to_jsonb(coalesce(v_alvos, '{}'::uuid[]))),
    '/clientes?tab=aprovacao-oem&fila=' || f.id::text);
END;
$function$;


------------------------------------------------------------------------------
-- 7. Aviso de falha (corpo de produção + criar_licenca)
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_oem_notificar_falha(p_fila_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f record; v_cli text; v_cli_id uuid; v_produto text; v_modulo text;
  v_title text; v_body text; v_op text; v_hint text;
BEGIN
  SELECT * INTO f FROM public.oem_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mesmo caminho de join da fn_oem_fila_listar, para a notificacao falar o mesmo nome
  -- que a tela mostra.
  SELECT coalesce(c.nome_fantasia, c.razao_social), c.id, pr.nome
    INTO v_cli, v_cli_id, v_produto
  FROM public.cliente_produtos cp
  LEFT JOIN public.clientes c  ON c.id  = cp.cliente_id
  LEFT JOIN public.produtos  pr ON pr.id = cp.produto_id
  WHERE cp.id = f.cliente_produto_id;

  SELECT pm.nome INTO v_modulo
  FROM public.cliente_produto_modulos cpm
  JOIN public.produto_modulos pm ON pm.id = cpm.modulo_id
  WHERE cpm.id = f.modulo_linha_id;

  v_op := CASE f.acao
    WHEN 'ativar'     THEN 'ativação de módulo'
    WHEN 'quantidade' THEN 'alteração de quantidade'
    WHEN 'cancelar'   THEN 'cancelamento de módulo'
    WHEN 'criar_licenca' THEN 'criação de licença'
    ELSE coalesce(f.acao, 'alteração')
  END;

  v_hint := CASE
    -- Criar licença não repete sozinha (segunda licença seria cobrada). O
    -- reprocessar é seguro: a oem-licenca-criar recusa a mesma loja duas vezes
    -- no mesmo grupo e devolve o código da que já existe.
    WHEN f.acao = 'criar_licenca' THEN
      '👉 O que fazer: confira no portal do OEM se a licença foi criada. Reprocessar é seguro: '
      || 'se ela já existir, o DoctorSaaS só grava o código na ficha em vez de criar outra.'
    -- O parceiro ACEITOU e a ficha daqui nao acompanhou. Reprocessar reenviaria a mesma
    -- baixa. Este e o unico caso em que o certo e mexer na ficha na mao.
    WHEN f.ultimo_erro LIKE 'O OEM aceitou%' THEN
      '👉 O que fazer: o OEM já aplicou a alteração na licença, mas a ficha daqui não acompanhou. '
      || 'NÃO reprocesse: isso mandaria o mesmo pedido de novo. Ajuste o módulo na ficha do cliente '
      || 'para bater com a licença e descarte a linha.'
    WHEN f.ultimo_erro LIKE 'Linha sem empresa%' THEN
      '👉 O que fazer: falta cadastro. Confira se o módulo do catálogo tem o código do OEM '
      || '(Configurações → Integrações → OEM → Módulos) e se o produto do cliente está vinculado a uma filial. '
      || 'Depois de preencher, reprocesse a linha.'
    WHEN f.ultimo_erro LIKE 'Nenhuma conta OEM ativa%' THEN
      '👉 O que fazer: não há conta OEM ativa neste tenant, ou a chave sumiu do cofre. '
      || 'Reconecte em Configurações → Integrações → OEM (aba Conexão) e reprocesse a linha.'
    WHEN f.ultimo_erro LIKE '%desistiu após%' THEN
      '👉 O que fazer: o OEM recusou a alteração em todas as tentativas. Leia o motivo acima, '
      || 'corrija o que ele apontou e reprocesse a linha. Simule antes de gravar.'
    ELSE
      '👉 O que fazer: verifique a linha em Configurações → Integrações → OEM (aba Fila). '
      || 'Simule para ver o que seria enviado e reprocesse depois de corrigir a causa.'
  END;

  v_title := 'OEM não sincronizou: ' || coalesce(v_modulo, CASE WHEN f.acao = 'criar_licenca' THEN 'licença nova' ELSE 'módulo' END) || ' — ' || coalesce(v_cli, 'cliente');
  v_body  := 'A ' || v_op || ' de ' || coalesce(v_modulo, CASE WHEN f.acao = 'criar_licenca' THEN 'licença' ELSE 'um módulo' END)
           || coalesce(' no produto ' || v_produto, '')
           || ' não chegou ao OEM e a linha parou na fila.'
           || E'\nMotivo: ' || coalesce(left(f.ultimo_erro, 300), '(sem detalhe)')
           || E'\n\nEnquanto isso, a licença no parceiro está diferente do que a ficha diz aqui.'
           || E'\n\n' || v_hint;

  PERFORM public.notify_event(
    f.tenant_id, 'oem_sync_falhou',
    public.fn_oem_fila_chave(f.modulo_linha_id, f.cliente_produto_id, f.oem_modulo_codigo),
    v_title, v_body,
    jsonb_build_object('fila_id', f.id, 'cliente_id', v_cli_id, 'acao', f.acao,
                       'status', f.status, 'erro', f.ultimo_erro, 'http', f.http,
                       'cliente_produto_id', f.cliente_produto_id,
                       'modulo_linha_id', f.modulo_linha_id,
                       'oem_modulo_codigo', f.oem_modulo_codigo,
                       'sistema', 'oem',
                       -- Quem mandou fazer. E so para ele que o toast aparece.
                       'toast_somente_para', f.usuario_id),
    '/configuracoes?section=integracoes-oem&aba=fila&fila=' || f.id::text);
END; $function$;

