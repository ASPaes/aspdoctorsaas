-- DEM-0374 — a jornada perdia a quantidade do modulo vendido.
--
-- A calculadora manda `produtos[].modulos[].quantidade` e o intake grava certo
-- em cliente_produto_modulos (WAVE DRINKS: Licenca PDV = 13). O que nunca
-- existiu foi o campo do lado da JORNADA: onboarding_journey_modules copiava
-- nome + produto_modulo_id e mais nada, entao o card "Modulos da jornada"
-- mostrava "Licenca PDV" seco e o especialista nao tinha como saber quantas
-- licencas implantar. Nao e falha da integracao — e coluna que faltava.
--
-- Default 1 porque e o que as 426 linhas existentes valem: modulo adicionado
-- a mao ou escolhido do produto sempre foi uma unidade.

ALTER TABLE public.onboarding_journey_modules
  ADD COLUMN IF NOT EXISTS quantidade integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.onboarding_journey_modules'::regclass
       AND conname  = 'onboarding_journey_modules_quantidade_min'
  ) THEN
    ALTER TABLE public.onboarding_journey_modules
      ADD CONSTRAINT onboarding_journey_modules_quantidade_min CHECK (quantidade >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.onboarding_journey_modules.quantidade IS
  'Quantas unidades do modulo entraram nesta jornada. Copiada de cliente_produto_modulos.quantidade quando a linha nasce do intake ou da importacao do cliente; 1 para modulo manual.';

-- Backfill das jornadas ja abertas: a quantidade vem da ficha do cliente, que e
-- onde o intake gravou o numero certo. So mexe em linha que casa com um modulo
-- ativo do cliente E vale mais de 1 — as demais ja estao corretas no default.
UPDATE public.onboarding_journey_modules jm
   SET quantidade = sub.qtd
  FROM (
    SELECT jm2.id, max(m.quantidade) AS qtd
      FROM public.onboarding_journey_modules jm2
      JOIN public.onboarding_journeys j        ON j.id = jm2.journey_id
      JOIN public.cliente_produtos cp          ON cp.cliente_id = j.cliente_id AND cp.ativo
      JOIN public.cliente_produto_modulos m    ON m.cliente_produto_id = cp.id
                                              AND m.ativo
                                              AND m.modulo_id = jm2.produto_modulo_id
     WHERE jm2.produto_modulo_id IS NOT NULL
     GROUP BY jm2.id
  ) sub
 WHERE sub.id = jm.id
   AND sub.qtd > 1
   AND jm.quantidade = 1;
