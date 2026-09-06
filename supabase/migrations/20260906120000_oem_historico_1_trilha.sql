-- ============================================================================
-- Trilha do que a integração OEM mudou, com desfazer. Bloco 1 de 2: a tabela,
-- o ajudante de gravação, o desfazer e a listagem.
--
-- Mesmo desenho da `hiper_alteracao_log` (20260901090000), pelo mesmo motivo: a
-- aba Integrações › OEM escreve em dado de cliente a partir do que um portal
-- externo diz. Sem trilha, um clique errado vira um valor trocado que ninguém
-- sabe de onde veio nem qual era antes. Guardar o VALOR ANTIGO é o que permite
-- voltar; guardar quem e quando é o que permite entender.
--
-- Uma linha por campo alterado. `lote_id` agrupa o que saiu de um clique só —
-- "aplicar custo em todos" é um lote com centenas de linhas, e desfazer devolve
-- o lote inteiro do jeito que ele foi feito.
--
-- ---------------------------------------------------------------------------
-- O QUE ENTRA AQUI E O QUE NÃO ENTRA
-- ---------------------------------------------------------------------------
-- Entra toda ação da aba OEM. As que mexem no cadastro do DoctorSaaS nascem
-- com `reversivel = true`; as outras ficam registradas e sem botão:
--
--   custo, nome, cnpj, vinculo, desvinculo, codigo_filial   → dá para voltar
--   ignorar_divergencia, reexibir_divergencia                → dá para voltar
--       (uma é o inverso da outra e as duas já são botão na aba)
--   chave                                                    → só registro,
--       e sem valor nenhum: o que se guarda é o prefixo, nunca a credencial
--
-- A escrita no sistema do PARCEIRO (corrigir nome/CNPJ da filial no OEM) não
-- vive nesta tabela: ela já tem log próprio desde 24/08 (`oem_cadastro_licenca_log`,
-- com a resposta crua dele). A listagem une as duas, marcando essas linhas como
-- não reversíveis — desfazer uma gravação em sistema de terceiro é outra
-- gravação nele, não um UPDATE aqui.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.oem_alteracao_log (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null,
  conta_integration_id uuid,
  lote_id              uuid not null,
  recon_id             uuid,
  cliente_id           uuid,
  cliente_produto_id   uuid,
  -- O código da filial no OEM é o "código do cadastro" desta integração: é por
  -- ele que a pessoa reconhece a linha no portal do parceiro.
  filial_codigo        text,
  cliente_nome         text,
  acao                 text not null,
  tabela               text,
  registro_id          uuid,
  campo                text,
  valor_antes          jsonb,
  valor_depois         jsonb,
  reversivel           boolean not null default true,
  feito_por            uuid,
  feito_em             timestamptz not null default now(),
  revertido_em         timestamptz,
  revertido_por        uuid
);

COMMENT ON TABLE public.oem_alteracao_log IS
  'O que a integracao OEM mudou: quem, quando, qual campo, valor antes e depois. Append-only para quem usa a tela: reverter GRAVA a volta e marca a linha, nunca apaga o historico.';

CREATE INDEX IF NOT EXISTS oem_log_tenant_data ON public.oem_alteracao_log (tenant_id, feito_em desc);
CREATE INDEX IF NOT EXISTS oem_log_lote        ON public.oem_alteracao_log (lote_id);
CREATE INDEX IF NOT EXISTS oem_log_cliente     ON public.oem_alteracao_log (tenant_id, cliente_id);

ALTER TABLE public.oem_alteracao_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oem_log_select ON public.oem_alteracao_log;
CREATE POLICY oem_log_select ON public.oem_alteracao_log FOR SELECT TO authenticated
USING ((select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id()) and (select public.is_tenant_admin_or_head())));

-- Sem INSERT/UPDATE/DELETE para `authenticated`, igual ao Hiper: quem escreve
-- aqui são as RPCs (SECURITY DEFINER). Trilha que o próprio operador pode
-- reescrever não é trilha.
GRANT SELECT ON public.oem_alteracao_log TO authenticated;
GRANT ALL    ON public.oem_alteracao_log TO service_role;

-- ---------------------------------------------------------------------------
-- O ajudante que as RPCs chamam para gravar uma linha.
--
-- Ele NÃO é chamável pelo navegador de propósito (sem GRANT para
-- `authenticated`). Quem o alcança são as funções da aba, que são SECURITY
-- DEFINER de `postgres` — dentro delas o usuário efetivo é o dono, então o
-- portão do GRANT não atrapalha.
--
-- `fn_acting_user()` em vez de `auth.uid()`: se um dia alguma dessas ações
-- passar por edge function, `auth.uid()` seria NULL e a autoria nasceria órfã
-- sem erro nenhum.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_log_alteracao(
  p_tenant_id            uuid,
  p_lote_id              uuid,
  p_acao                 text,
  p_cliente_id           uuid    DEFAULT NULL,
  p_tabela               text    DEFAULT NULL,
  p_registro_id          uuid    DEFAULT NULL,
  p_campo                text    DEFAULT NULL,
  p_valor_antes          jsonb   DEFAULT NULL,
  p_valor_depois         jsonb   DEFAULT NULL,
  p_recon_id             uuid    DEFAULT NULL,
  p_cliente_produto_id   uuid    DEFAULT NULL,
  p_filial_codigo        text    DEFAULT NULL,
  p_conta_integration_id uuid    DEFAULT NULL,
  p_reversivel           boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_id   uuid;
  v_nome text;
BEGIN
  IF p_cliente_id IS NOT NULL THEN
    SELECT coalesce(nullif(btrim(c.nome_fantasia), ''), c.razao_social)
      INTO v_nome FROM public.clientes c WHERE c.id = p_cliente_id;
  END IF;

  INSERT INTO public.oem_alteracao_log (
    tenant_id, conta_integration_id, lote_id, recon_id, cliente_id,
    cliente_produto_id, filial_codigo, cliente_nome, acao, tabela, registro_id,
    campo, valor_antes, valor_depois, reversivel, feito_por
  ) VALUES (
    p_tenant_id, p_conta_integration_id, p_lote_id, p_recon_id, p_cliente_id,
    p_cliente_produto_id, p_filial_codigo, v_nome, p_acao, p_tabela, p_registro_id,
    p_campo, p_valor_antes, p_valor_depois, p_reversivel, public.fn_acting_user()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.fn_oem_log_alteracao(uuid,uuid,text,uuid,text,uuid,text,jsonb,jsonb,uuid,uuid,text,uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_log_alteracao(uuid,uuid,text,uuid,text,uuid,text,jsonb,jsonb,uuid,uuid,text,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_log_alteracao(uuid,uuid,text,uuid,text,uuid,text,jsonb,jsonb,uuid,uuid,text,uuid,boolean) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_log_alteracao(uuid,uuid,text,uuid,text,uuid,text,jsonb,jsonb,uuid,uuid,text,uuid,boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_log_alteracao(uuid,uuid,text,uuid,text,uuid,text,jsonb,jsonb,uuid,uuid,text,uuid,boolean) TO service_role;

-- ---------------------------------------------------------------------------
-- Desfazer. Volta os valores do lote e MARCA as linhas — o histórico fica.
--
-- Ordem inversa dentro do lote: o que foi feito por último volta primeiro. Uma
-- linha que não dá para voltar não derruba o lote: ela entra em `falhas` com o
-- motivo, e o resto volta. Um lote meio revertido é pior que nenhum, mas pior
-- ainda é o botão não fazer nada porque um item de cem não coube.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.oem_reverter_lote(p_tenant_id uuid, p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  l        record;
  v_voltou integer := 0;
  v_falhou jsonb   := '[]'::jsonb;
BEGIN
  -- coalesce POR FORA da expressão inteira: com os dois lados NULL, `NOT NULL`
  -- é NULL, o IF não dispara e o portão liberaria para quem não tem perfil.
  IF NOT coalesce(public.pode_decidir_oem(p_tenant_id), false) THEN
    RAISE EXCEPTION 'Sem permissão para desfazer alterações do OEM.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.oem_alteracao_log
                  WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id
                    AND revertido_em IS NULL AND reversivel) THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Este lote já foi desfeito, ou não tem nada que dê para voltar.');
  END IF;

  FOR l IN
    SELECT * FROM public.oem_alteracao_log
     WHERE tenant_id = p_tenant_id AND lote_id = p_lote_id AND revertido_em IS NULL
     ORDER BY feito_em DESC, id DESC
  LOOP
    BEGIN
      IF NOT l.reversivel THEN
        v_falhou := v_falhou || jsonb_build_object(
          'campo', l.acao, 'cliente', l.cliente_nome,
          'motivo', 'Esta ação não é desfeita por aqui.');
        CONTINUE;
      END IF;

      IF l.acao = 'custo' THEN
        UPDATE public.cliente_produtos
           SET vlr_custo = nullif(l.valor_antes #>> '{}', '')::numeric,
               updated_at = now()
         WHERE id = l.registro_id;

      ELSIF l.acao IN ('nome', 'cnpj') THEN
        -- O campo volta ao que era, e a fotografia da conferência acompanha:
        -- sem isso a linha continuaria na tela mostrando o valor novo.
        IF l.campo = 'nome_fantasia' THEN
          UPDATE public.clientes SET nome_fantasia = l.valor_antes #>> '{}', updated_at = now()
           WHERE id = l.registro_id;
          UPDATE public.reconciliacao_oem SET razao_ds = l.valor_antes #>> '{}'
           WHERE tenant_id = l.tenant_id AND ds_customer_id = l.cliente_id;
        ELSE
          UPDATE public.clientes SET cnpj = l.valor_antes #>> '{}', updated_at = now()
           WHERE id = l.registro_id;
          UPDATE public.reconciliacao_oem SET cnpj_ds = l.valor_antes #>> '{}'
           WHERE tenant_id = l.tenant_id AND ds_customer_id = l.cliente_id;
        END IF;

      ELSIF l.acao = 'codigo_filial' THEN
        -- Devolve empresa+filial ao produto do cliente. É a mesma função que
        -- gravou, com os valores de antes.
        -- As chaves são `grupo` e `filial` porque são esses os parâmetros da
        -- função que grava; `oem_codigo_grupo` é o código da EMPRESA no OEM.
        PERFORM public.oem_gravar_codigos_no_produto(
          l.cliente_id,
          nullif(l.valor_antes->>'grupo', ''),
          nullif(l.valor_antes->>'filial', ''));

      ELSIF l.acao = 'vinculo' THEN
        -- Desfazer um vínculo é desvincular. Se a licença era de OUTRO cliente
        -- antes, ela volta para ele: `valor_antes` guarda quem era.
        PERFORM public.desvincular_filial_oem(l.recon_id);
        IF nullif(l.valor_antes->>'cliente_id', '') IS NOT NULL THEN
          PERFORM public.vincular_filial_oem(
            l.recon_id, (l.valor_antes->>'cliente_id')::uuid);
        END IF;

      ELSIF l.acao = 'desvinculo' THEN
        IF nullif(l.valor_antes->>'cliente_id', '') IS NOT NULL THEN
          PERFORM public.vincular_filial_oem(
            l.recon_id, (l.valor_antes->>'cliente_id')::uuid);
        ELSE
          v_falhou := v_falhou || jsonb_build_object(
            'campo', l.acao, 'cliente', l.cliente_nome,
            'motivo', 'A linha não tinha cliente antes: não há vínculo para devolver.');
          CONTINUE;
        END IF;

      -- Marcar como certa e trazer de volta são uma o inverso da outra, e as
      -- duas já existem como botão na aba. Desfazer aqui é chamar a irmã.
      -- `campo` guarda o tipo da divergência; a assinatura, que é o que o
      -- "ignorar" precisa para saber o que estava sendo comparado, vai no
      -- `valor_antes`.
      ELSIF l.acao = 'ignorar_divergencia' THEN
        PERFORM public.oem_reexibir_divergencia(
          l.campo,
          l.recon_id,
          nullif(l.valor_antes->>'cliente_id', '')::uuid,
          nullif(l.valor_antes->>'conta', '')::uuid);

      ELSIF l.acao = 'reexibir_divergencia' THEN
        PERFORM public.oem_ignorar_divergencia(
          l.campo,
          coalesce(nullif(l.valor_antes->>'assinatura', ''), l.campo),
          l.recon_id,
          nullif(l.valor_antes->>'cliente_id', '')::uuid,
          nullif(l.valor_antes->>'conta', '')::uuid);

      ELSE
        v_falhou := v_falhou || jsonb_build_object(
          'campo', l.acao, 'cliente', l.cliente_nome,
          'motivo', 'Ação sem caminho de volta conhecido.');
        CONTINUE;
      END IF;

      UPDATE public.oem_alteracao_log
         SET revertido_em = now(), revertido_por = public.fn_acting_user()
       WHERE id = l.id;
      v_voltou := v_voltou + 1;

    EXCEPTION WHEN others THEN
      v_falhou := v_falhou || jsonb_build_object(
        'campo', l.acao, 'cliente', l.cliente_nome, 'motivo', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'revertidos', v_voltou, 'falhas', v_falhou);
END;
$fn$;

ALTER FUNCTION public.oem_reverter_lote(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.oem_reverter_lote(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.oem_reverter_lote(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.oem_reverter_lote(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A listagem da aba.
--
-- Une a trilha do cadastro com o log das gravações no PARCEIRO. As duas são
-- "coisas que a aba OEM fez"; separá-las em duas listas obrigaria a pessoa a
-- lembrar em qual procurar. As do parceiro entram com `reversivel = false` e
-- cada uma como seu próprio lote — foi um clique, uma licença.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_historico_listar(
  p_tenant_id uuid    DEFAULT NULL,
  p_limite    integer DEFAULT 500
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant uuid    := coalesce(p_tenant_id, public.current_tenant_id());
  v_lim    integer := least(greatest(coalesce(p_limite, 500), 1), 2000);
BEGIN
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    WITH linhas AS (
      SELECT g.id::text        AS id,
             g.lote_id::text   AS lote_id,
             g.feito_em        AS feito_em,
             g.acao            AS acao,
             g.campo           AS campo,
             g.cliente_id::text AS cliente_id,
             g.cliente_nome    AS cliente_nome,
             g.filial_codigo   AS filial_codigo,
             g.valor_antes     AS valor_antes,
             g.valor_depois    AS valor_depois,
             g.reversivel      AS reversivel,
             g.revertido_em    AS revertido_em,
             f.nome            AS feito_por,
             g.feito_por::text AS feito_por_id
        FROM public.oem_alteracao_log g
        LEFT JOIN public.profiles prof ON prof.user_id = g.feito_por
        LEFT JOIN public.funcionarios f ON f.id = prof.funcionario_id
       WHERE g.tenant_id = v_tenant

      UNION ALL

      -- Gravação no OEM feita pela aba Divergências. Já tinha log desde 24/08 e
      -- nenhuma tela lia. `valor_anterior` aqui é o que o PARCEIRO tinha, não o
      -- que o espelho daqui achava que ele tinha.
      SELECT c.id::text, c.id::text, c.criado_em,
             CASE WHEN c.campo = 'cnpj' THEN 'parceiro_cnpj' ELSE 'parceiro_nome' END,
             c.campo,
             c.cliente_id::text,
             coalesce(nullif(btrim(cl.nome_fantasia), ''), cl.razao_social),
             c.filial_codigo,
             to_jsonb(c.valor_anterior),
             to_jsonb(c.valor_novo),
             false,
             NULL::timestamptz,
             f.nome,
             c.usuario_id::text
        FROM public.oem_cadastro_licenca_log c
        LEFT JOIN public.clientes cl     ON cl.id = c.cliente_id
        LEFT JOIN public.profiles prof   ON prof.user_id = c.usuario_id
        LEFT JOIN public.funcionarios f  ON f.id = prof.funcionario_id
       WHERE c.tenant_id = v_tenant
         -- Simulação é leitura, não gravação: não entra na trilha do que foi feito.
         AND c.simulado = false
    )
    SELECT jsonb_agg(x ORDER BY x.feito_em DESC)
      FROM (SELECT * FROM linhas ORDER BY feito_em DESC LIMIT v_lim) x
  ), '[]'::jsonb);
END;
$fn$;

ALTER FUNCTION public.fn_oem_historico_listar(uuid, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_historico_listar(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_historico_listar(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_historico_listar(uuid, integer) TO authenticated, service_role;

COMMIT;
