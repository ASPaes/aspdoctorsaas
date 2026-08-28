-- ============================================================================
-- Aprovação OEM (passo 4 de 4): A VIRADA.
--
-- É aqui que o comportamento muda. A partir deste arquivo, adicionar módulo,
-- somar/alterar quantidade e cancelar módulo de cliente COM licença no OEM
-- nascem em 'aguardando_aprovacao': nada vai ao parceiro e nada entra na ficha
-- até um admin aprovar em Clientes › Aprovação OEM.
--
-- Cinco funções mudam. Nenhuma muda de assinatura, então CREATE OR REPLACE
-- preserva os GRANT.
--
--   1. fn_oem_enfileirar        nasce aguardando, e a guarda de pedido vivo conta o novo estado
--   2. fn_oem_enfileirar_novo   idem
--   3. fn_oem_fila_reprocessar  FECHA UM DESVIO (leia abaixo)
--   4. fn_oem_pendencias_do_cliente  a ficha do cliente passa a dizer o que houve
--   5. fn_oem_fila_listar       o painel de Sincronização para de mostrar o que ainda não foi enviado
--
-- ⚠️ O DESVIO QUE ESTE ARQUIVO FECHA
-- `fn_oem_fila_reprocessar` devolvia para 'pendente' QUALQUER linha que não
-- estivesse 'ok'. Com os estados novos, isso significaria que um head podia
-- pegar um pedido recusado por um admin e empurrá-lo ao parceiro pelo botão
-- "Tentar de novo" do painel de Sincronização. A aprovação seria decorativa.
-- Agora ela recusa os dois estados novos, com o motivo escrito.
--
-- O QUE NÃO MUDA, e é de propósito:
--   · Produto do cliente SEM licença no OEM continua gravando direto na ficha.
--     Não há o que enviar ao parceiro, e a aprovação existe para o que sai daqui.
--   · `fn_oem_fila_aplicar` não é tocada. O upsell, o downsell, a ativação e a
--     ordem OEM-primeiro-ficha-depois continuam exatamente como estavam: aprovar
--     só devolve a linha ao estado em que ela nascia antes.
--   · O portão de QUEM PEDE continua `is_admin_or_head`. Head pede, admin aprova.
--
-- ⚠️ ATENÇÃO A QUEM FOR MEXER NA `fn_oem_fila_listar` DEPOIS DAQUI
-- Em 27/08/2026 havia outra frente trabalhando nessa mesma função (recorte por
-- conta OEM, campo `sem_conta`). Ela é `CREATE OR REPLACE`: quem aplicar por
-- último leva a sua e apaga a do outro. O filtro dos dois estados novos no
-- WHERE precisa sobreviver — sem ele, a linha que espera aprovação reaparece no
-- painel de Sincronização junto com o botão de reprocessar.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Quantidade e cancelamento: nascem esperando um admin.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao text,
  p_quantidade numeric DEFAULT NULL,
  p_payload jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_mod    public.cliente_produto_modulos;
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_id     uuid;
BEGIN
  IF p_acao NOT IN ('ativar','quantidade','cancelar') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_acao USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mod FROM public.cliente_produto_modulos WHERE id = p_modulo_linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_mod.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = v_mod.cliente_produto_id;

  -- Único motivo legítimo de não enfileirar: não existe licença no parceiro.
  --
  -- `origem` saiu daqui de propósito. Módulo digitado à mão dentro de um produto
  -- COM licença é justamente o caso em que a ficha e o parceiro divergem — e era
  -- o único que nunca chegava lá.
  IF v_cp.oem_codigo_filial IS NULL THEN
    RETURN NULL;
  END IF;

  -- O código do parceiro na linha da ficha só é preenchido pelo espelho; o
  -- módulo criado à mão tem o código no catálogo. Faltando os dois, a linha
  -- ainda entra: o processador a deixa `invalido` com o motivo, à vista.
  v_codigo := coalesce(
    v_mod.oem_modulo_codigo,
    (SELECT pm.oem_modulo_codigo FROM public.produto_modulos pm WHERE pm.id = v_mod.modulo_id)
  );

  -- Uma ação viva por módulo. 'aguardando_aprovacao' entrou na lista: sem ele,
  -- pedir duas vezes encheria a fila de aprovação com o mesmo módulo e o admin
  -- teria que adivinhar qual dos dois vale.
  -- 'recusado' fica de fora de propósito, como 'invalido': depois de corrigir o
  -- que o admin apontou, a pessoa PRECISA poder pedir de novo.
  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.modulo_linha_id = v_mod.id
       AND f.status IN ('aguardando_aprovacao','pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo em andamento.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id, status
  )
  SELECT
    v_mod.tenant_id,
    (SELECT id FROM public.oem_integration
      WHERE tenant_id = v_mod.tenant_id AND ativo = true ORDER BY criado_em LIMIT 1),
    v_cp.id, v_mod.id, v_mod.modulo_id,
    p_acao, v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_codigo,
    -- No cancelamento o que vai ao parceiro é QUANTO SOBRA na licença; nas
    -- outras ações, a quantidade que a licença deve passar a ter.
    CASE WHEN p_acao = 'cancelar'
         THEN greatest(coalesce(v_mod.quantidade, 1)
                       - least(greatest(coalesce(p_quantidade, coalesce(v_mod.quantidade, 1)), 1),
                               greatest(coalesce(v_mod.quantidade, 1), 1)), 0)
         ELSE coalesce(p_quantidade, v_mod.quantidade, 1) END,
    v_mod.vlr_custo,
    p_payload,
    -- auth.uid() basta aqui (só gente logada chama), mas fn_acting_user cobre
    -- também a chamada por service_role, onde auth.uid() é NULL e a autoria
    -- nasceria órfã sem erro nenhum.
    public.fn_acting_user(),
    'aguardando_aprovacao'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ============================================================================
-- 2. Módulo novo: idem.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar_novo(
  p_cliente_produto_id uuid,
  p_modulo_id uuid,
  p_quantidade numeric,
  p_payload jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_id     uuid;
BEGIN
  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = p_cliente_produto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto do cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_cp.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT oem_modulo_codigo INTO v_codigo
    FROM public.produto_modulos WHERE id = p_modulo_id;

  -- Único motivo legítimo de não enfileirar: não existe licença no parceiro.
  -- Quem chamou trata o NULL gravando direto na ficha, como sempre fez.
  IF v_cp.oem_codigo_filial IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.cliente_produto_id = p_cliente_produto_id
       AND coalesce(f.modulo_catalogo_id, '00000000-0000-0000-0000-000000000000'::uuid) = p_modulo_id
       AND f.status IN ('aguardando_aprovacao','pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo em andamento.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id, status
  ) VALUES (
    v_cp.tenant_id,
    (SELECT id FROM public.oem_integration
      WHERE tenant_id = v_cp.tenant_id AND ativo = true ORDER BY criado_em LIMIT 1),
    v_cp.id, p_modulo_id,
    'ativar', v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_codigo,
    greatest(coalesce(p_quantidade, 1), 1),
    nullif(p_payload->>'vlr_custo', '')::numeric,
    p_payload,
    public.fn_acting_user(),
    'aguardando_aprovacao'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

-- ============================================================================
-- 3. Reprocessar: fecha o desvio.
--
-- "Tentar de novo" existe para a linha que JÁ FOI autorizada e falhou no
-- caminho. Aplicar isso a um pedido que espera decisão, ou que foi recusado,
-- transformaria o botão do painel de Sincronização numa porta dos fundos da
-- aprovação.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_reprocessar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_linha public.oem_sync_fila;
BEGIN
  SELECT * INTO v_linha FROM public.oem_sync_fila WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_linha.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  IF v_linha.status = 'ok' THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Esta linha já foi gravada no OEM.');
  END IF;

  IF v_linha.status = 'aguardando_aprovacao' THEN
    RETURN jsonb_build_object('ok', false,
      'mensagem', 'Este pedido ainda espera aprovação. Ele sai daqui em Clientes › Aprovação OEM.');
  END IF;

  IF v_linha.status = 'recusado' THEN
    RETURN jsonb_build_object('ok', false,
      'mensagem', 'Este pedido foi recusado' ||
        coalesce(': ' || v_linha.motivo_recusa, '') ||
        '. Para mandá-lo ao OEM, faça o pedido de novo na ficha do cliente.');
  END IF;

  UPDATE public.oem_sync_fila
     SET status = 'pendente',
         tentativas = 0,
         proxima_tentativa_em = now(),
         ultimo_erro = NULL
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'mensagem', 'Linha devolvida para a fila.');
END;
$fn$;

-- ============================================================================
-- 4. A ficha do cliente conta o que houve.
--
-- Dois estados entram, por motivos diferentes:
--
--   'aguardando_aprovacao' — sem ele, quem adiciona um módulo vê a tela não
--     mudar e não tem como saber por quê. É o selo "aguardando aprovação".
--
--   'recusado' (7 dias) — este é o mais importante. Head e user NÃO enxergam a
--     aba Aprovação OEM, então a ficha do cliente é o ÚNICO lugar onde quem
--     pediu descobre que foi recusado, e por quê. Sem isto, o módulo
--     simplesmente nunca aparece e ninguém avisa nada, que é exatamente o
--     silêncio que a fila existe para não repetir.
--     A janela de 7 dias existe porque 'recusado' é terminal: sem corte, a ficha
--     acumularia para sempre recusa de meses atrás.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_pendencias_do_cliente(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente_id;
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'fila_id',            f.id,
             'cliente_produto_id', f.cliente_produto_id,
             'modulo_linha_id',    f.modulo_linha_id,
             'modulo_catalogo_id', f.modulo_catalogo_id,
             'modulo',             pm.nome,
             'acao',               f.acao,
             'quantidade',         f.quantidade,
             'status',             f.status,
             'ultimo_erro',        f.ultimo_erro,
             'motivo_recusa',      f.motivo_recusa,
             'decidido_em',        f.decidido_em,
             'enfileirado_em',     f.enfileirado_em))
      FROM public.oem_sync_fila f
      JOIN public.cliente_produtos cp ON cp.id = f.cliente_produto_id
      LEFT JOIN public.produto_modulos pm ON pm.id = f.modulo_catalogo_id
     WHERE cp.cliente_id = p_cliente_id
       AND (
         f.status IN ('aguardando_aprovacao','pendente','processando','erro','invalido')
         OR (f.status = 'recusado' AND f.decidido_em > now() - interval '7 days')
       )
  ), '[]'::jsonb);
END;
$fn$;

-- ============================================================================
-- 5. O painel de Sincronização mostra o que foi ENVIADO, não o que espera gente.
--
-- Misturar os dois faria a tela que hoje significa "problema com o parceiro"
-- passar a ter linhas que não são problema nenhum — e, pior, com um botão
-- "Tentar de novo" ao lado (que a mudança 3 agora recusa, mas o botão não
-- deveria nem estar à vista).
--
-- ⚠️ CREATE OR REPLACE. Se houver outra alteração pendente nesta função (em
-- 27/08 havia: recorte por conta OEM), MESCLE — não substitua. O que não pode
-- se perder é o filtro de status no WHERE.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_listar(
  p_tenant_id uuid DEFAULT NULL,
  p_limite    integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
BEGIN
  -- coalesce POR FORA da expressão inteira: com v_tenant e current_tenant_id()
  -- ambos NULL, `v = v` é NULL, `NULL OR false` é NULL e `NOT NULL` é NULL —
  -- o IF não dispara e o portão libera justamente para quem não tem perfil.
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x.ordem, x.enfileirado_em DESC)
      FROM (
        SELECT f.id, f.acao, f.status, f.tentativas, f.ultimo_erro, f.http,
               f.quantidade, f.oem_modulo_codigo, f.empresa_codigo, f.filial_codigo,
               f.enfileirado_em, f.processado_em, f.proxima_tentativa_em,
               coalesce(c.nome_fantasia, c.razao_social) AS cliente,
               pr.nome  AS produto,
               pm.nome  AS modulo,
               -- Erro em cima: é o que precisa de gente. 'ok' desce.
               CASE f.status WHEN 'invalido' THEN 0 WHEN 'erro' THEN 1
                             WHEN 'processando' THEN 2 WHEN 'pendente' THEN 3
                             ELSE 4 END AS ordem
          FROM public.oem_sync_fila f
          LEFT JOIN public.cliente_produtos cp ON cp.id = f.cliente_produto_id
          LEFT JOIN public.clientes c          ON c.id = cp.cliente_id
          LEFT JOIN public.produtos pr         ON pr.id = cp.produto_id
          LEFT JOIN public.cliente_produto_modulos cpm ON cpm.id = f.modulo_linha_id
          LEFT JOIN public.produto_modulos pm  ON pm.id = cpm.modulo_id
         WHERE (v_tenant IS NULL OR f.tenant_id = v_tenant)
           -- O recorte desta tela: o que já foi autorizado. Pedido esperando
           -- decisão e pedido recusado vivem na aba Aprovação OEM.
           AND f.status NOT IN ('aguardando_aprovacao','recusado')
         ORDER BY ordem, f.enfileirado_em DESC
         LIMIT greatest(coalesce(p_limite, 100), 1)
      ) x
  ), '[]'::jsonb);
END;
$fn$;

COMMIT;
