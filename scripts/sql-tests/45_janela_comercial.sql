-- Janela comercial: cadastro e leitura.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_col    int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FIXTURE: nenhuma linha em configuracoes'; END IF;

  -- 1. as colunas existem, com os tipos certos
  SELECT count(*) INTO v_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='configuracoes'
    AND ((column_name='horario_comercial' AND data_type='jsonb')
      OR (column_name='horario_comercial_enabled' AND data_type='boolean'));
  IF v_col <> 2 THEN
    RAISE EXCEPTION 'FALHOU: esperava 2 colunas novas, achei %', v_col;
  END IF;

  -- 2. o default é false: tenant que não cadastrou não muda de comportamento
  IF EXISTS (SELECT 1 FROM public.configuracoes WHERE horario_comercial_enabled IS NULL) THEN
    RAISE EXCEPTION 'FALHOU: horario_comercial_enabled aceitou NULL';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='configuracoes'
        AND column_name='horario_comercial_enabled') NOT LIKE 'false%' THEN
    RAISE EXCEPTION 'FALHOU: default de horario_comercial_enabled não é false';
  END IF;

  RAISE NOTICE 'OK: task 1';
END $$;

DO $$
DECLARE
  v_tenant uuid;
  v_abre   time;
  v_fecha  time;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    horario_comercial_enabled = true,
    business_hours_timezone   = 'America/Sao_Paulo',
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(
               jsonb_build_object('start','08:00','end','12:00'),
               jsonb_build_object('start','13:30','end','18:18'))),
      'tue', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'wed', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'thu', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'fri', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','17:00'))),
      'sat', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'sun', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- Segunda com almoço: a janela do DIA vai da primeira borda à última.
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-24 15:00-03'::timestamptz);
  IF v_abre <> '08:00' OR v_fecha <> '18:18' THEN
    RAISE EXCEPTION 'FALHOU segunda: esperava 08:00-18:18, veio %-%', v_abre, v_fecha;
  END IF;

  -- Sexta fecha mais cedo.
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-28 15:00-03'::timestamptz);
  IF v_fecha <> '17:00' THEN
    RAISE EXCEPTION 'FALHOU sexta: esperava fechar 17:00, veio %', v_fecha;
  END IF;

  -- Sábado inativo => sem janela (tudo que acontecer nele é plantão).
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-29 15:00-03'::timestamptz);
  IF v_abre IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU sabado: esperava janela nula, veio %', v_abre;
  END IF;

  -- Desligado => cai na janela de disponibilidade. Com VALORES CONCRETOS:
  -- comparar com fn_expediente_janela_do_dia(tenant, NULL, at) seria tautológico
  -- (é literalmente a linha que a função executa no ramo do fallback) e foi por
  -- isso que a revisão de 25/08 passou batido por C1 e C2.
  -- Discrimina: se a flag fosse ignorada, viria 08:00-18:18 (o comercial acima).
  UPDATE public.configuracoes SET
    horario_comercial_enabled = false,
    business_hours_enabled    = true,
    business_hours = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','22:00'))))
  WHERE tenant_id = v_tenant;

  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-24 15:00-03'::timestamptz);
  IF v_abre <> '09:00' OR v_fecha <> '22:00' THEN
    RAISE EXCEPTION 'FALHOU fallback: desligado deveria devolver 09:00-22:00 (disponibilidade), veio %-%', v_abre, v_fecha;
  END IF;

  RAISE NOTICE 'OK: task 2';
END $$;

DO $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    horario_comercial_enabled = true,
    business_hours_timezone   = 'America/Sao_Paulo',
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(
               jsonb_build_object('start','08:00','end','12:00'),
               jsonb_build_object('start','13:30','end','18:00'))),
      'fri', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','17:00'))),
      'sat', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- Almoço NÃO é plantão: a tolerância vale sobre a janela do dia (08:00-18:00).
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 12:45-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: 12:45 de segunda (almoço) marcou plantão';
  END IF;

  -- Tolerância de 5 min na borda de fechamento.
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 18:04-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: 18:04 deveria estar dentro da tolerância de 5 min';
  END IF;
  IF NOT public.fn_instante_fora_comercial(v_tenant, '2026-08-24 18:06-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: 18:06 deveria ser plantão';
  END IF;

  -- Sexta fecha 17:00: 17:30 é plantão na sexta e não é na segunda.
  IF NOT public.fn_instante_fora_comercial(v_tenant, '2026-08-28 17:30-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: sexta 17:30 deveria ser plantão';
  END IF;
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 17:30-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: segunda 17:30 não é plantão';
  END IF;

  -- Dia inativo: tudo é plantão.
  IF NOT public.fn_instante_fora_comercial(v_tenant, '2026-08-29 15:00-03'::timestamptz) THEN
    RAISE EXCEPTION 'FALHOU: sábado 15:00 deveria ser plantão';
  END IF;

  -- Clamp: janela colada na meia-noite não pode dar a volta e marcar o dia inteiro.
  UPDATE public.configuracoes SET horario_comercial = jsonb_build_object(
    'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','00:10','end','23:45'))))
  WHERE tenant_id = v_tenant;
  IF public.fn_instante_fora_comercial(v_tenant, '2026-08-24 12:00-03'::timestamptz, 30) THEN
    RAISE EXCEPTION 'FALHOU clamp: meio-dia virou plantão numa janela 00:10-23:45';
  END IF;

  RAISE NOTICE 'OK: task 3';
END $$;



-- ---------------------------------------------------------------------------
-- Correção de 26/08/2026 — a promessa "flag OFF = comportamento IDÊNTICO ao de
-- antes deste branch" tinha dois furos, medidos em produção (25 atendimentos
-- mudando de classificação em 7 dias, em 5 tenants que não pediram nada):
--
--   C1 — fn_atendimento_plantao_em ficou com p_tolerancia_min DEFAULT 5, e o
--        trigger trg_zz_set_plantao chama sem passar tolerância. Era 30.
--   C2 — o fallback jogava fora o p_department_id, perdendo o override de
--        support_departments.business_hours (10 setores em produção).
--
-- Cada asserção abaixo DISCRIMINA: o comentário diz o que sairia com o defeito.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant uuid;
  v_dept   uuid;
  v_open   timestamptz := '2026-08-24 09:30-03';  -- segunda
  v_close  timestamptz := '2026-08-24 23:00-03';
  v_res    timestamptz;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  -- Disponibilidade seg 09:00-18:00 com almoço 12:00-13:30 (a janela do DIA
  -- resultante é 09:00-18:00). Janela comercial cadastrada mas DESLIGADA, e de
  -- propósito diferente, para provar que ninguém a está lendo.
  UPDATE public.configuracoes SET
    business_hours_timezone   = 'America/Sao_Paulo',
    business_hours_enabled    = true,
    business_hours = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(
               jsonb_build_object('start','09:00','end','12:00'),
               jsonb_build_object('start','13:30','end','18:00')))),
    horario_comercial_enabled = false,
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','15:00'))))
  WHERE tenant_id = v_tenant;

  -- A1. Flag OFF: a tolerância continua sendo 30 min, NÃO 5.
  -- Sem passar p_tolerancia_min, como faz o trigger.
  -- Com o defeito C1 (default 5): 18:20 > 18:05 => viraria plantão.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_open, v_close, NULL, '2026-08-24 18:20-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU A1 (C1): 18:20 está dentro da tolerância de 30 min, veio %', v_res;
  END IF;

  -- Contraprova de A1: passada a tolerância de 30, aí sim é plantão.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_open, v_close, NULL, '2026-08-24 18:40-03'::timestamptz);
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'FALHOU A1 contraprova: 18:40 passa dos 30 min e deveria ser plantão';
  END IF;

  -- A2. Flag OFF: o override de horário por SETOR continua valendo.
  INSERT INTO public.support_departments (tenant_id, name, slug, business_hours_enabled, business_hours)
  VALUES (v_tenant, 'ZZ Teste Janela Comercial', 'zz-teste-janela-comercial', true,
          jsonb_build_object('mon', jsonb_build_object('active', true, 'slots',
            jsonb_build_array(jsonb_build_object('start','09:00','end','12:00')))))
  RETURNING id INTO v_dept;

  -- 14:00 de segunda: DENTRO da janela do tenant (09-18) e FORA da do setor
  -- (09-12, +30 = 12:30). Com o defeito C2 (setor descartado): viria NULL.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, v_dept, NULL, v_open, v_close, NULL, '2026-08-24 14:00-03'::timestamptz);
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'FALHOU A2 (C2): 14:00 é plantão pela janela do SETOR (09-12) e o setor foi ignorado';
  END IF;

  -- Controle de A2: o mesmo instante, sem setor, NÃO é plantão. Sem esta linha
  -- a asserção acima passaria mesmo se tudo virasse plantão.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_open, v_close, NULL, '2026-08-24 14:00-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU A2 controle: 14:00 sem setor está dentro de 09-18, veio %', v_res;
  END IF;

  -- A4. Flag ON: aí sim a tolerância é 5 min, sobre a janela COMERCIAL.
  UPDATE public.configuracoes SET
    horario_comercial_enabled = true,
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_open, v_close, NULL, '2026-08-24 18:04-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU A4: 18:04 está dentro da tolerância de 5 min, veio %', v_res;
  END IF;

  -- Se a tolerância tivesse ficado em 30 com a flag ligada, 18:06 viria NULL.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_open, v_close, NULL, '2026-08-24 18:06-03'::timestamptz);
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'FALHOU A4: 18:06 passa dos 5 min e deveria ser plantão';
  END IF;

  RAISE NOTICE 'OK: correcao C1/C2 — A1, A2, A4';
END $$;

-- A3 fica em bloco separado porque precisa de auth.uid(): check_tipo_horario
-- resolve o tenant por profiles, e o SET LOCAL role vale até o fim da transação
-- (depois dele o UPDATE em configuracoes esbarraria em RLS).
DO $$
DECLARE
  v_tenant uuid;
  v_uid    uuid;
  v_r      text;
BEGIN
  SELECT p.tenant_id, p.user_id INTO v_tenant, v_uid
    FROM public.profiles p
    JOIN public.configuracoes c ON c.tenant_id = p.tenant_id
   LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'FALHOU setup A3: nenhum tenant com profile+configuracoes no banco local';
  END IF;

  -- Disponibilidade com almoço 12:00-13:30 e janela comercial DESLIGADA.
  UPDATE public.configuracoes SET
    business_hours_timezone   = 'America/Sao_Paulo',
    business_hours_enabled    = true,
    business_hours = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(
               jsonb_build_object('start','09:00','end','12:00'),
               jsonb_build_object('start','13:30','end','18:00')))),
    horario_comercial_enabled = false
  WHERE tenant_id = v_tenant;

  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- A3. Flag OFF: check_tipo_horario avalia SLOT A SLOT (is_within_business_hours),
  -- não pela janela do dia. 12:45 cai no almoço => plantao.
  -- Com o defeito C2 (fn_instante_fora_comercial, que mede a janela do DIA
  -- 09:00-18:00): viria 'comercial'.
  v_r := public.check_tipo_horario(NULL, '2026-08-24 12:45-03'::timestamptz, v_tenant);
  IF v_r <> 'plantao' THEN
    RAISE EXCEPTION 'FALHOU A3 (C2): 12:45 está no almoço e deveria ser plantao, veio %', v_r;
  END IF;

  -- Controle de A3: dentro de um slot é comercial.
  v_r := public.check_tipo_horario(NULL, '2026-08-24 10:00-03'::timestamptz, v_tenant);
  IF v_r <> 'comercial' THEN
    RAISE EXCEPTION 'FALHOU A3 controle: 10:00 deveria ser comercial, veio %', v_r;
  END IF;

  RAISE NOTICE 'OK: correcao C1/C2 — A3';
END $$;

ROLLBACK;
