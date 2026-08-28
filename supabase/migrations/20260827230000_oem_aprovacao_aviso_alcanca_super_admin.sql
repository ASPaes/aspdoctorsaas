-- ============================================================================
-- Aprovação OEM: o aviso alcança o super admin, e volta a estourar toast.
--
-- POR QUE (27/08/2026, no primeiro teste real)
-- O Alexandre pediu uma alteração de quantidade num cliente da Digi Office,
-- simulando aquele tenant, e o sino dele ficou quieto. Não era defeito: o aviso
-- foi entregue, a 4 pessoas — os admins da Digi Office. Ele é admin do tenant
-- ASP e super admin, e `fn_notif_admins_do_tenant` só pega super admin DAQUELE
-- tenant (`p.tenant_id = p_tenant_id AND (role='admin' OR is_super_admin)`).
-- Simular um tenant faz agir nele, não pertencer a ele.
--
-- Consequência prática: quem administra a plataforma inteira nunca veria este
-- aviso, justamente na hora em que ele é mais usado — testando e acompanhando
-- a operação de um cliente.
--
-- O QUE MUDA, E O QUE DELIBERADAMENTE NÃO MUDA
--
--   1. A lista de destinatários passa a ser montada AQUI: admins do tenant do
--      cliente (a mesma de antes) MAIS os super admins ativos, de qualquer
--      tenant. `fn_notif_admins_do_tenant` NÃO é tocada — ela serve também aos
--      alertas de fila do Omie e de falha do OEM, e mexer nela mudaria o
--      destinatário daqueles avisos sem ninguém ter pedido.
--
--   2. `toast_somente_para` sai do metadata. Chave ausente = toast para todo
--      mundo que recebe (é assim que o NotificationContext lê: presente com
--      null era "ninguém"). Decisão do Alexandre, contrariando a minha: eu
--      tinha desligado o toast por achar que adição de módulo é rotina demais
--      para interromper tela. Fica o registro de que, se o toast começar a
--      incomodar, o conserto é devolver `'toast_somente_para', NULL` ao
--      jsonb_build_object abaixo.
--
-- ⚠️ EFEITO COLATERAL DE USAR `target_user_ids`: no notify_event, alvo
-- explícito entrega SÓ in-app e não passa pela lista de inscritos nem pelo
-- canal WhatsApp. É exatamente o que este aviso já fazia pelo caminho dos
-- admins, então nada muda na prática — mas quem for acrescentar WhatsApp a
-- este evento um dia precisa saber que este ramo não o alcança.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_notificar(p_fila_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    ELSE 'aplica a alteração no parceiro'
  END;

  v_corpo := coalesce(v_pediu, 'Alguém') || ' pediu '
          || CASE f.acao
               WHEN 'ativar'     THEN 'a ativação de '
               WHEN 'quantidade' THEN 'a alteração de quantidade de '
               WHEN 'cancelar'   THEN 'o cancelamento de '
               ELSE 'uma alteração em '
             END
          || coalesce(v_modulo, 'um módulo')
          || coalesce(' no produto ' || v_produto, '')
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
$fn$;

ALTER FUNCTION public.fn_oem_aprovacao_notificar(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_notificar(uuid) TO service_role;

COMMIT;
