-- O atendimento que morreu numa opção de autoatendimento da URA não pode contar
-- como cliente ignorado.
--
-- Ele fecha sem nunca ter sido assumido, então entrava em "não atendido" na
-- Velocidade e aparecia com nome no card "Não atendidos" — como se alguém
-- tivesse largado o cliente falando sozinho.
--
-- O teste roda a MESMA linha duas vezes, mudando só o closed_reason, e compara:
-- como 'manual' ela conta; como 'ura_autoatendimento' ela some. Assim a prova
-- não depende do volume da base nem de fixture sintética.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/40_sla_ignora_autoatendimento.sql
BEGIN;

-- Guardas de tenant fora do caminho: aqui o assunto é a contagem, não o RLS.
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
CREATE OR REPLACE FUNCTION public.assert_tenant_scope(p_tenant_id uuid) RETURNS void LANGUAGE sql STABLE AS $$ SELECT NULL::void $$;
CREATE OR REPLACE FUNCTION public.user_effective_unidades() RETURNS bigint[] LANGUAGE sql STABLE AS $$ SELECT NULL::bigint[] $$;

DO $$
DECLARE
  v_att     uuid;
  v_tenant  uuid;
  v_de      timestamptz;
  v_ate     timestamptz;
  v_r       jsonb;
  -- como 'manual'
  v_nao_atendido_1 int; v_encerrados_1 int; v_card_1 int; v_volume_1 int; v_painel_1 int;
  -- como 'ura_autoatendimento'
  v_nao_atendido_2 int; v_encerrados_2 int; v_card_2 int; v_volume_2 int; v_painel_2 int;
BEGIN
  -- Um atendimento real que fechou sem ninguém assumir: é exatamente a forma que
  -- o autoatendimento tem ao fechar.
  SELECT id, tenant_id, opened_at INTO v_att, v_tenant, v_de
    FROM support_attendances
   WHERE status = 'closed' AND assumed_at IS NULL
     AND (msg_customer_count > 0 OR last_customer_message_at IS NOT NULL)
   ORDER BY opened_at DESC LIMIT 1;
  IF v_att IS NULL THEN RAISE EXCEPTION 'fixture: nenhum atendimento fechado sem assumir'; END IF;

  v_ate := v_de + interval '1 min';
  v_de  := v_de - interval '1 min';

  -- ---------------------------------------------------------------- rodada 1
  UPDATE support_attendances SET closed_reason = 'manual' WHERE id = v_att;

  v_r := public.get_atendimento_velocidade(v_tenant, v_de, v_ate);
  v_nao_atendido_1 := (v_r->>'nao_atendido')::int;
  v_encerrados_1   := (v_r->>'total_encerrados')::int;

  v_r := public.get_atendimento_nao_atendidos(v_tenant, v_de, v_ate);
  v_card_1 := (v_r->>'total_card')::int;

  v_r := public.get_atendimento_volume(v_tenant, v_de, v_ate);
  v_volume_1 := (v_r->>'total')::int;

  v_r := public.get_attendance_metrics(v_tenant, v_de, v_ate);
  v_painel_1 := (v_r->'agent'->>'total')::int;

  -- ---------------------------------------------------------------- rodada 2
  UPDATE support_attendances SET closed_reason = 'ura_autoatendimento' WHERE id = v_att;

  v_r := public.get_atendimento_velocidade(v_tenant, v_de, v_ate);
  v_nao_atendido_2 := (v_r->>'nao_atendido')::int;
  v_encerrados_2   := (v_r->>'total_encerrados')::int;

  v_r := public.get_atendimento_nao_atendidos(v_tenant, v_de, v_ate);
  v_card_2 := (v_r->>'total_card')::int;

  v_r := public.get_atendimento_volume(v_tenant, v_de, v_ate);
  v_volume_2 := (v_r->>'total')::int;

  v_r := public.get_attendance_metrics(v_tenant, v_de, v_ate);
  v_painel_2 := (v_r->'agent'->>'total')::int;

  -- ------------------------------------------------------------------ provas
  IF v_nao_atendido_1 < 1 THEN
    RAISE EXCEPTION 'fixture furada: como manual a linha nem contava em nao_atendido';
  END IF;
  IF v_nao_atendido_2 <> v_nao_atendido_1 - 1 THEN
    RAISE EXCEPTION 'FALHOU Velocidade/nao_atendido: % -> % (esperado %)',
      v_nao_atendido_1, v_nao_atendido_2, v_nao_atendido_1 - 1;
  END IF;
  IF v_encerrados_2 <> v_encerrados_1 - 1 THEN
    RAISE EXCEPTION 'FALHOU Velocidade/total_encerrados: % -> %', v_encerrados_1, v_encerrados_2;
  END IF;
  IF v_card_2 <> v_card_1 - 1 THEN
    RAISE EXCEPTION 'FALHOU card Não atendidos: % -> %', v_card_1, v_card_2;
  END IF;
  IF v_volume_2 <> v_volume_1 - 1 THEN
    RAISE EXCEPTION 'FALHOU Volume/total: % -> %', v_volume_1, v_volume_2;
  END IF;
  IF v_painel_2 <> v_painel_1 - 1 THEN
    RAISE EXCEPTION 'FALHOU painel de atendimento/total: % -> %', v_painel_1, v_painel_2;
  END IF;

  RAISE EXCEPTION 'SMOKE_OK | nao_atendido %->% | encerrados %->% | card %->% | volume %->% | painel %->%',
    v_nao_atendido_1, v_nao_atendido_2, v_encerrados_1, v_encerrados_2,
    v_card_1, v_card_2, v_volume_1, v_volume_2, v_painel_1, v_painel_2;
END $$;

ROLLBACK;
