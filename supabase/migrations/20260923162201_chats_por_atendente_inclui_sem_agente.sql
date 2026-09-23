-- get_atendimento_chats: o card "Atendimentos por Atendente" nao fechava com o total.
-- A CTE do grafico descartava assigned_to IS NULL, mas o 'total' contava tudo — na Look
-- Sistemas eram 299 de 1.388 atendimentos (22%) que sumiam da soma sem aviso.
-- Alem disso o rotulo "(nao atribuido)" mentia: caia em quem TEM agente mas nao tem
-- funcionario vinculado no tenant. Os dois casos agora sao linhas distintas.
--
-- Patch textual sobre a definicao viva, e nao um CREATE OR REPLACE do corpo inteiro:
-- o corpo desta funcao no banco diverge do repo (ver CLAUDE.md), entao colar uma copia
-- daqui reverteria mudancas que so existem em producao.
DO $patch$
DECLARE
  v_oid oid;
  v_def text;
  v_old1 text := 'FROM at WHERE assigned_to IS NOT NULL GROUP BY assigned_to)';
  v_new1 text := 'FROM at GROUP BY assigned_to)';
  v_old2 text := 'jsonb_build_object(''nome'', COALESCE(f.nome,''(não atribuído)''), ''qtd'', atd.qtd)';
  v_new2 text := 'jsonb_build_object(''user_id'', atd.assigned_to, ''nome'', CASE WHEN atd.assigned_to IS NULL THEN ''(sem atendente)'' ELSE COALESCE(f.nome, ''(sem cadastro)'') END, ''qtd'', atd.qtd)';
BEGIN
  SELECT p.oid INTO STRICT v_oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_chats';
  v_def := pg_get_functiondef(v_oid);

  IF position(v_new2 IN v_def) > 0 THEN
    RAISE NOTICE 'get_atendimento_chats ja corrigida — nada a fazer';
    RETURN;
  END IF;

  IF (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1 THEN
    RAISE EXCEPTION 'trecho 1 nao esta exatamente 1x na funcao - abortado';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 THEN
    RAISE EXCEPTION 'trecho 2 nao esta exatamente 1x na funcao - abortado';
  END IF;

  v_def := replace(v_def, v_old1, v_new1);
  v_def := replace(v_def, v_old2, v_new2);
  EXECUTE v_def;
END
$patch$;
