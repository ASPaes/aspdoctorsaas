-- DEM-0374 (2a parte) — a tela passou a deixar corrigir a quantidade do modulo
-- da jornada, mas SO no que foi lancado dentro dela. O que veio da calculadora
-- e o espelho da venda: alterar aqui faria a jornada e a ficha do cliente
-- discordarem sem deixar rastro de qual das duas esta certa. Quem precisa mudar
-- corrige a venda na ficha.
--
-- O gate da UI nao basta: a policy de UPDATE da tabela libera qualquer
-- authenticated do tenant, entao o portao vive aqui tambem.
--
-- INVOKER de proposito: dentro de SECURITY DEFINER o current_user vira o dono da
-- funcao (postgres) e a checagem nunca dispararia. Medido no banco local.
--
-- Nao alcanca service_role/postgres de proposito: o intake grava por ali (so
-- INSERT hoje) e uma correcao de dados pelo SQL Editor continua possivel.

CREATE OR REPLACE FUNCTION public.fn_journey_module_intake_qtd_imutavel()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF new.quantidade IS DISTINCT FROM old.quantidade
     AND old.origem = 'intake'
     AND current_user IN ('authenticated', 'anon')
  THEN
    RAISE EXCEPTION 'Este módulo veio da calculadora de vendas; a quantidade não pode ser alterada aqui. Corrija a venda na ficha do cliente.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_journey_module_intake_qtd_imutavel
  ON public.onboarding_journey_modules;

CREATE TRIGGER trg_journey_module_intake_qtd_imutavel
  BEFORE UPDATE OF quantidade ON public.onboarding_journey_modules
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_journey_module_intake_qtd_imutavel();
