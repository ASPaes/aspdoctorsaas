-- Autoatendimento da URA sai dos indicadores de atendimento
--
-- Quem escolhe uma opção 'auto_reply' (ex.: "Indique e ganhe") recebe o link e o
-- atendimento encerra sozinho, sem nunca chegar num atendente. Contado junto,
-- ele aparece como cliente IGNORADO: `assumed_at` é nulo, então entra em
-- "não atendido" na Velocidade e com nome e sobrenome no card "Não atendidos".
--
-- Os indicadores de TEMPO já são imunes e não precisam de mudança: TME, FRT,
-- TMA, TMR e o % de SLA só somam registro com o valor `> 0`, e este fecha
-- zerado. CSAT idem — nem chega a ser enviado.
--
-- Ficam de fora desta migration, de propósito, as funções que só somam volume em
-- relatório secundário: theo_kpis_janela, theo_daily_payload,
-- build_management_digest_block, collect_tenant_daily_metrics,
-- get_atendimento_cobertura, get_atendimento_clientes, get_atendimento_chats,
-- get_atendimento_chats_timeline, get_atendimento_satisfacao,
-- get_attendance_summary_metrics, get_atendimento_velocidade_timeline e
-- get_monitor_maintenance_metrics. Combinado com o Alexandre em 14/08/2026:
-- essas entram noutro horário.
--
-- get_atendimento_ura NÃO entra nunca: lá o autoatendimento é o assunto.
--
-- Por que patch e não CREATE OR REPLACE do corpo inteiro: são funções longas e o
-- banco é editado por fora do repo. Reescrever o corpo que eu leio hoje apaga em
-- silêncio qualquer mudança que tenha entrado no meio do caminho — foi assim que
-- este banco já perdeu função antes. Aqui o texto vivo é lido, conferido e só
-- então recebe a linha nova; se a âncora não bater exatamente, a migration morre
-- em vez de escrever.

DO $$
DECLARE
  -- proname | âncora | quantas vezes a âncora tem de aparecer
  v_alvos CONSTANT text[][] := ARRAY[
    ['get_atendimento_velocidade',    'AND sa.status = ''closed''',      '1'],
    ['get_atendimento_nao_atendidos', 'AND sa.status = ''closed''',      '1'],
    -- Âncora precisa cair no nível de cima do WHERE. A primeira tentativa usou
    -- 'sa.scheduled_until <= now()', que mora DENTRO de um "(A OR B)": a linha
    -- nova virou "(A OR B AND novo)" e, com scheduled_until nulo (o caso comum),
    -- o OR já dava verdadeiro e o filtro não valia nada. O teste 40 pegou.
    ['get_attendance_metrics',        'WHERE sa.tenant_id = p_tenant_id', '2'],
    ['get_atendimento_volume',        'WHERE a.tenant_id = v_tenant',    '2'],
    ['get_atendimento_volume',        'WHERE tenant_id = v_tenant',      '1']
  ];
  v_i        int;
  v_nome     text;
  v_ancora   text;
  v_esperado int;
  v_def      text;
  v_novo     text;
  v_qtd      int;
  v_alias    text;
  v_troca    text;
BEGIN
  FOR v_i IN 1 .. array_length(v_alvos, 1) LOOP
    v_nome     := v_alvos[v_i][1];
    v_ancora   := v_alvos[v_i][2];
    v_esperado := v_alvos[v_i][3]::int;

    SELECT count(*) INTO v_qtd
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_nome;
    IF v_qtd <> 1 THEN
      RAISE EXCEPTION '% tem % versões — o patch só serve para função sem sobrecarga', v_nome, v_qtd;
    END IF;

    SELECT pg_get_functiondef(p.oid) INTO v_def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_nome;

    -- O alias muda conforme a função (sa. ou a.), e uma delas não usa alias.
    v_alias := CASE
                 WHEN v_ancora LIKE '%sa.%'                     THEN 'sa.'
                 WHEN v_ancora = 'WHERE a.tenant_id = v_tenant' THEN 'a.'
                 ELSE ''
               END;
    -- A âncora tem de ser um pedaço do WHERE de fora. Dentro de parêntese com
    -- OR, o AND novo se prende só ao último termo e não filtra nada.
    IF v_ancora NOT LIKE 'WHERE %' AND v_ancora NOT LIKE 'AND %' THEN
      RAISE EXCEPTION 'âncora "%" não começa em WHERE/AND — o filtro pode cair dentro de um OR', v_ancora;
    END IF;
    v_troca := v_ancora || ' AND ' || v_alias || 'closed_reason IS DISTINCT FROM ''ura_autoatendimento''';

    IF position(v_troca IN v_def) > 0 THEN
      RAISE NOTICE '% já estava com o filtro nesta âncora — nada a fazer', v_nome;
      CONTINUE;
    END IF;

    v_qtd := (length(v_def) - length(replace(v_def, v_ancora, ''))) / length(v_ancora);
    IF v_qtd <> v_esperado THEN
      RAISE EXCEPTION 'âncora "%" apareceu % vez(es) em % — esperado %. A função mudou; refaça o patch olhando o corpo atual',
        v_ancora, v_qtd, v_nome, v_esperado;
    END IF;

    v_novo := replace(v_def, v_ancora, v_troca);
    IF v_novo = v_def THEN
      RAISE EXCEPTION 'nada foi trocado em % — patch abortado', v_nome;
    END IF;

    EXECUTE v_novo;
    RAISE NOTICE '% : % ocorrência(s) filtrada(s)', v_nome, v_qtd;
  END LOOP;
END $$;

-- Prova: as quatro precisam mencionar o motivo depois do patch.
DO $$
DECLARE v_faltando text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_faltando
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('get_atendimento_velocidade','get_atendimento_nao_atendidos',
                       'get_attendance_metrics','get_atendimento_volume')
     AND pg_get_functiondef(p.oid) NOT LIKE '%ura_autoatendimento%';
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'ficaram sem o filtro: %', v_faltando;
  END IF;
END $$;
