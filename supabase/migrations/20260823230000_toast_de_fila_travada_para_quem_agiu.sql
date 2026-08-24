-- 23/08/2026 - O toast de fila travada vai so para quem fez a acao.
--
-- POR QUE EXISTE
-- Desde a entrega de hoje, o alerta de fila parada e entregue a todo admin do tenant. So que
-- o NotificationContext nao filtra tipo nenhum: TODA notificacao que chega vira toast no canto
-- da tela. Resultado nao intencional: um modulo que falhou por causa de UMA pessoa acendia um
-- toast em todos os admins ao mesmo tempo, e nenhum deles sabia de quem era a acao.
--
-- A regra passa a ser: o sino continua sendo de todo admin (o problema e do tenant), mas o
-- toast e de quem MANDOU FAZER. Fila que trava sem ninguem por tras -- o watchdog, o gatilho
-- de churn -- nao acende toast em ninguem.
--
-- COMO O FRONTEND SABE: a chave `toast_somente_para` no metadata da notificacao. Presente com
-- um uuid, so aquele usuario recebe o toast; presente com NULL, ninguem recebe. Ausente (todo
-- o resto do sistema, chat inclusive), nada muda. Foi de proposito que o sinal e a chave e nao
-- a categoria do evento: assim o frontend nao precisa carregar o catalogo de eventos para
-- decidir se toca um toast.
--
-- O QUE FALTAVA NO BANCO: `oem_sync_fila` ja guardava `usuario_id` (as duas funcoes de
-- enfileiramento gravam `auth.uid()`). `omie_sync_fila` nao guardava ninguem -- e essa coluna
-- e o bloco 1.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) Autor na fila do Omie   [BLOCO 1 - trava omie_sync_fila por instantes]
--    ADD COLUMN sem default nao reescreve a tabela (so o catalogo), mas ainda pede
--    ACCESS EXCLUSIVE: se a fila estiver sendo processada agora, o bloco desiste em 5s.
-- ---------------------------------------------------------------------------
ALTER TABLE public.omie_sync_fila ADD COLUMN IF NOT EXISTS usuario_id uuid;

COMMENT ON COLUMN public.omie_sync_fila.usuario_id IS
  'Quem mandou fazer a alteracao que gerou esta linha, quando ha alguem: e para ele que vai o toast de falha. NULL em linha nascida de gatilho ou cron (churn em lote, reajuste automatico), e nesse caso o alerta existe so no sino dos admins.';

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- 2) [BLOCO 2 - so codigo, nao trava tabela nenhuma]
--
-- enfileirar_sync_omie passa a gravar o autor. `fn_acting_user()` e nao `auth.uid()`:
-- quase tudo aqui chega por gatilho, e gatilho disparado de dentro de uma edge function
-- roda como service_role, onde auth.uid() e NULL. Ver a migration do historico de modulos.
--
-- Na coalescencia (linha pendente que recebe outra alteracao antes de ser processada) o
-- autor e SOBRESCRITO pelo mais recente, e nao mantido: quem acabou de mexer e quem esta
-- com a tela aberta esperando aquilo funcionar. `coalesce` por fora para uma enfileirada
-- automatica em cima de uma manual nao apagar a pessoa.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."enfileirar_sync_omie"("p_contrato_id" "uuid", "p_origem" "text" DEFAULT NULL::"text", "p_campos" "text"[] DEFAULT NULL::"text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant_id uuid;
  v_unidade_id bigint;
  v_ativa boolean;
  v_pausada boolean;
  v_escopo bigint[];
  v_id_pendente uuid;
  v_campos text[] := p_campos;
  v_sincroniza boolean;
  v_conta_id uuid;
BEGIN
  SELECT c.tenant_id, cl.unidade_base_id, COALESCE(mc.sincroniza_omie, true)
    INTO v_tenant_id, v_unidade_id, v_sincroniza
  FROM contratos c
  LEFT JOIN clientes cl ON cl.id = c.cliente_id
  LEFT JOIN modelos_contrato mc ON mc.id = c.modelo_contrato_id
  WHERE c.id = p_contrato_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- 17/07/2026 (portao 1): modelo marcado para nao sincronizar nao entra na fila. Sem isso,
  -- editar o cadastro desses clientes geraria linha -> sem de/para -> 'ignorado' terminal, que
  -- so sai no Reprocessar -- que reenfileiraria e daria 'ignorado' de novo. Trabalho manual
  -- eterno para contrato que nunca deveria ir ao Omie.
  IF v_sincroniza IS NOT TRUE THEN RETURN; END IF;

  SELECT id, sync_automatica_ativa, integracao_pausada, unidades_base_ids
    INTO v_conta_id, v_ativa, v_pausada, v_escopo
  FROM omie_integration
  WHERE tenant_id = v_tenant_id
    AND (unidades_base_ids IS NULL OR v_unidade_id = ANY(unidades_base_ids))
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_ativa IS NOT TRUE OR v_pausada IS TRUE THEN RETURN; END IF;

  -- 16/07/2026: TRADUZ ORIGEM -> CAMPO 'vigencia_final'. Ver v8 do omie-sync-processar.
  IF p_origem IN ('reajuste', 'movimento_reajuste', 'reativacao') THEN
    v_campos := COALESCE(v_campos, '{}'::text[]) || ARRAY['vigencia_final'];
  END IF;

  SELECT id INTO v_id_pendente
  FROM omie_sync_fila
  WHERE tenant_id = v_tenant_id AND contrato_id = p_contrato_id
    AND status IN ('pendente','processando')
  LIMIT 1;

  IF v_id_pendente IS NOT NULL THEN
    UPDATE omie_sync_fila
    SET enfileirado_em = now(), proxima_tentativa_em = now(),
        -- 04/08/2026: origem de SITUACAO e pegajosa. Ver cabecalho da migration
        -- 20260804140000. Era `COALESCE(p_origem, origem)`, e o ultimo a enfileirar vencia --
        -- o que fazia o 'valor' disparado por reativar_contrato apagar a 'reativacao' que a
        -- propria transacao tinha acabado de criar, 3 linhas antes.
        origem = CASE
                   WHEN p_origem IN ('churn','reativacao') THEN p_origem
                   WHEN omie_sync_fila.origem IN ('churn','reativacao') THEN omie_sync_fila.origem
                   ELSE COALESCE(p_origem, omie_sync_fila.origem)
                 END,
        status = 'pendente', ultimo_erro = NULL,
        -- Quem mexeu por ultimo e quem esta esperando aquilo funcionar.
        usuario_id = coalesce(public.fn_acting_user(), omie_sync_fila.usuario_id),
        conta_integration_id = v_conta_id,
        campos_alterados = CASE
          WHEN v_campos IS NULL THEN campos_alterados
          ELSE (SELECT array_agg(DISTINCT x)
                  FROM unnest(COALESCE(campos_alterados, '{}'::text[]) || v_campos) x)
        END
    WHERE id = v_id_pendente;
  ELSE
    INSERT INTO omie_sync_fila (tenant_id, contrato_id, origem, campos_alterados, conta_integration_id, usuario_id)
    VALUES (v_tenant_id, p_contrato_id, p_origem, v_campos, v_conta_id, public.fn_acting_user());
  END IF;
END;
$$;

-- Metadata com o autor: e a chave que o frontend le para decidir o toast.

CREATE OR REPLACE FUNCTION public.fn_omie_notificar_falha(p_fila_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f record; v_num text; v_cli text; v_cli_id uuid; v_unidade_id bigint; v_conta_id uuid;
  v_title text; v_body text; v_op text; v_hint text; v_res jsonb;
BEGIN
  SELECT * INTO f FROM public.omie_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT c.numero, c.cliente_id, coalesce(cl.nome_fantasia, cl.razao_social), cl.unidade_base_id
    INTO v_num, v_cli_id, v_cli, v_unidade_id
  FROM public.contratos c LEFT JOIN public.clientes cl ON cl.id = c.cliente_id
  WHERE c.id = f.contrato_id;

  -- Mesma resolucao de conta usada por enfileirar_sync_omie (escopos sao disjuntos por
  -- trg_omie_integration_unidades_disjuntas, entao no maximo 1 conta casa com a unidade).
  v_conta_id := f.conta_integration_id;
  IF v_conta_id IS NULL AND v_unidade_id IS NOT NULL THEN
    SELECT oi.id INTO v_conta_id
    FROM public.omie_integration oi
    WHERE oi.tenant_id = f.tenant_id
      AND (oi.unidades_base_ids IS NULL OR v_unidade_id = ANY(oi.unidades_base_ids))
    LIMIT 1;
  END IF;

  -- Antes o ELSE devolvia a origem crua. Com o gatilho aberto, isso viraria
  -- "movimento_cross_sell" na tela e no WhatsApp do cliente interno.
  v_op := CASE f.origem
    WHEN 'churn'                 THEN 'cancelamento'
    WHEN 'reativacao'            THEN 'reativação'
    WHEN 'cadastro'              THEN 'atualização de cadastro'
    WHEN 'observacao'            THEN 'atualização de observação'
    WHEN 'manual'                THEN 'envio manual'
    WHEN 'valor'                 THEN 'alteração de valor'
    WHEN 'reajuste'              THEN 'reajuste'
    WHEN 'movimento_reajuste'    THEN 'reajuste'
    WHEN 'movimento_upsell'      THEN 'upsell'
    WHEN 'movimento_downsell'    THEN 'downsell'
    WHEN 'movimento_cross_sell'  THEN 'venda cruzada'
    ELSE coalesce(f.origem, 'alteração')
  END;

  v_hint := CASE
    WHEN f.ultimo_erro LIKE 'bloqueio:troca_de_produto%' THEN
      '👉 O que fazer: o produto deste contrato mudou no DS e o OMIE continua com a categoria do '
      || 'produto antigo. REPROCESSAR NÃO RESOLVE — a integração ainda não troca produto sozinha. '
      || 'Ajuste o item do contrato direto no OMIE (categoria e código de serviço) e reprocesse. '
      || 'Se as duas categorias forem o mesmo produto na prática, registre a equivalência em '
      || 'Configurações → Integração OMIE.'
    WHEN f.ultimo_erro LIKE 'bloqueio:depara_aponta_cancelado%' THEN
      '👉 O que fazer: o vínculo aponta para um contrato JÁ CANCELADO no OMIE. '
      || CASE WHEN f.origem = 'reativacao'
              THEN 'Reative o contrato direto no OMIE, '
              ELSE 'Cancele/ajuste o contrato certo direto no OMIE, ' END
      || 'OU corrija o vínculo em Configurações → Integração OMIE → Conferência. Depois reprocesse a linha na fila.'
    WHEN f.ultimo_erro LIKE 'bloqueio:produto_sem_mapeamento%' THEN
      '👉 O que fazer: o produto deste contrato não tem categoria mapeada no OMIE. '
      || 'Mapeie o produto em Configurações → Integração OMIE e reprocesse a linha.'
    WHEN f.ultimo_erro LIKE 'bloqueio:%' THEN
      '👉 O que fazer: resolva a pendência do contrato em Configurações → Integração OMIE (Conferência) e reprocesse a linha na fila.'
    WHEN f.ultimo_erro LIKE 'validacao:%' THEN
      '👉 O que fazer: os dados do contrato não passaram na validação. Ajuste o contrato/Padrões OMIE e reprocesse a linha na fila.'
    ELSE
      '👉 O que fazer: verifique a linha em Configurações → Integração OMIE e reprocesse após corrigir a causa.'
  END;

  v_title := 'OMIE não sincronizou: ' || coalesce(v_num,'contrato') || ' — ' || coalesce(v_cli,'cliente');
  -- Frase neutra de genero: serve para "upsell", "reativação" e "venda cruzada" sem concordancia errada.
  v_body  := 'A sincronização do contrato ' || coalesce(v_num, f.contrato_id::text)
           || ' com o OMIE falhou (' || v_op || ') e a fila travou em "' || f.status || '".'
           || E'\nMotivo: ' || coalesce(left(f.ultimo_erro,300),'(sem detalhe)')
           || E'\n\n' || v_hint;

  v_res := public.notify_event(
    f.tenant_id, 'omie_sync_falhou', f.contrato_id::text, v_title, v_body,
    jsonb_build_object('fila_id',f.id,'contrato_id',f.contrato_id,'cliente_id',v_cli_id,
                       'origem',f.origem,'status',f.status,'erro',f.ultimo_erro,
                       'conta_integration_id',v_conta_id,'unidade_base_id',v_unidade_id,
                       'sistema','omie',
                       -- Quem mandou fazer. E so para ele que o toast aparece.
                       'toast_somente_para', f.usuario_id),
    -- O destino util e a linha da fila, com o botao de reprocessar e o diagnostico.
    -- Ficha do cliente nao mostra fila nenhuma; era um clique que nao levava a lugar nenhum.
    '/configuracoes?section=integracoes-omie&aba=conferencia&fila=' || f.id::text);

  -- cooldown/evento inativo => nao notificou; a lista configurada tambem nao recebe
  IF coalesce((v_res->>'sent')::boolean, false) THEN
    PERFORM public.fn_omie_wpp_extra((v_res->>'notification_id')::uuid, f.tenant_id, 'omie_sync_falhou', v_title, v_body, v_conta_id);
  END IF;
END; $function$;

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
    ELSE coalesce(f.acao, 'alteração')
  END;

  v_hint := CASE
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

  v_title := 'OEM não sincronizou: ' || coalesce(v_modulo, 'módulo') || ' — ' || coalesce(v_cli, 'cliente');
  v_body  := 'A ' || v_op || ' de ' || coalesce(v_modulo, 'um módulo')
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

CREATE OR REPLACE FUNCTION public.fn_integracao_fila_watchdog()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  v_title text; v_body text; v_url text; v_rotulo text;
  v_vistos text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    WITH paradas AS (
      -- Omie: 'erro' e terminal, entao so 'pendente'/'processando' contam como "nao andou".
      SELECT 'omie'::text AS sistema, tenant_id, proxima_tentativa_em
        FROM public.omie_sync_fila
       WHERE status IN ('pendente', 'processando')
         AND proxima_tentativa_em <= now() - interval '30 minutes'
      UNION ALL
      -- OEM: 'erro' e retentativa, entao ele conta.
      SELECT 'oem'::text, tenant_id, proxima_tentativa_em
        FROM public.oem_sync_fila
       WHERE status IN ('pendente', 'erro', 'processando')
         AND proxima_tentativa_em <= now() - interval '30 minutes'
    )
    SELECT sistema, tenant_id, count(*) AS qtd, min(proxima_tentativa_em) AS mais_antiga
      FROM paradas
     GROUP BY sistema, tenant_id
  LOOP
    v_vistos := v_vistos || (r.tenant_id::text || '|' || r.sistema);
    v_rotulo := CASE r.sistema WHEN 'omie' THEN 'Omie' ELSE 'OEM' END;
    v_url := CASE r.sistema
               WHEN 'omie' THEN '/configuracoes?section=integracoes-omie&aba=conferencia'
               ELSE '/configuracoes?section=integracoes-oem&aba=fila'
             END;

    v_title := 'Fila do ' || v_rotulo || ' não está andando: ' || r.qtd || ' registro(s) esperando';
    v_body  := r.qtd || ' registro(s) na fila de sincronização do ' || v_rotulo
             || ' passaram da hora de serem enviados. O mais antigo espera desde '
             || to_char(r.mais_antiga AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') || '.'
             || E'\n\nIsso não é erro de conteúdo: ninguém tentou enviar. Normalmente é o processador parado, '
             || 'ou uma linha que ficou presa em "enviando" quando o envio anterior morreu no meio.'
             || E'\n\n👉 O que fazer: abra a fila e use "Rodar agora". Se as linhas continuarem paradas, '
             || 'o processador não está sendo chamado.';

    PERFORM public.notify_event(
      r.tenant_id, 'integracao_fila_parada', r.sistema, v_title, v_body,
      jsonb_build_object('sistema', r.sistema, 'qtd', r.qtd, 'mais_antiga', r.mais_antiga,
                         -- Sem autor: fila que nao anda nao e culpa de ninguem em
                         -- particular. A chave presente com NULL e o que impede o
                         -- toast de acordar todo admin de madrugada.
                         'toast_somente_para', NULL::uuid),
      v_url);
  END LOOP;

  -- Fecha o incidente do que voltou a andar. Sem isto, o alerta so sumiria do painel de
  -- incidentes quando alguem o resolvesse na mao, e a proxima parada de verdade cairia no
  -- cooldown de um incidente velho -- ou seja, nao avisaria.
  FOR r IN
    SELECT i.tenant_id, i.dedupe_key
      FROM public.notification_incidents i
     WHERE i.event_type_key = 'integracao_fila_parada'
       AND i.resolved_at IS NULL
       AND NOT ((i.tenant_id::text || '|' || i.dedupe_key) = ANY(v_vistos))
  LOOP
    PERFORM public.resolve_notification_incident(r.tenant_id, 'integracao_fila_parada', r.dedupe_key);
  END LOOP;
END;
$function$;

COMMIT;


-- Conferencia. Esperado: 1 | 1 | 3
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'omie_sync_fila' AND column_name = 'usuario_id')
    AS coluna_autor,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'enfileirar_sync_omie'
      AND pg_get_functiondef(p.oid) LIKE '%fn_acting_user%')
    AS enfileirar_grava_autor,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('fn_omie_notificar_falha', 'fn_oem_notificar_falha', 'fn_integracao_fila_watchdog')
      AND pg_get_functiondef(p.oid) LIKE '%toast_somente_para%')
    AS funcoes_com_a_chave;
