-- Smoke test da vw_onboarding_stage_attribution. Rollback automático via exception.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -f - < este arquivo
DO $$
DECLARE
  v_linhas int;
  v_sem_dono int;
  v_donos int;
  v_orfas int;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE responsavel_user_id IS NULL),
         count(DISTINCT responsavel_user_id)
    INTO v_linhas, v_sem_dono, v_donos
    FROM public.vw_onboarding_stage_attribution;

  -- Nenhuma linha pode apontar para um responsável que não estava vigente na entrada.
  SELECT count(*) INTO v_orfas
    FROM public.vw_onboarding_stage_attribution a
   WHERE a.responsavel_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.onboarding_responsavel_history rh
        WHERE rh.journey_id = a.journey_id
          AND rh.user_id = a.responsavel_user_id
          AND rh.de <= a.entrou_em
          AND (rh.ate IS NULL OR rh.ate > a.entrou_em));

  RAISE EXCEPTION 'SMOKE_OK|linhas=% sem_dono=% donos=% orfas=%', v_linhas, v_sem_dono, v_donos, v_orfas;
END $$;
