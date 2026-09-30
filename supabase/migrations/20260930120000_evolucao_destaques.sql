-- ============================================================================
-- Evolução DS: prazo de cada destaque  (30/09/2026)
--
-- O destaque do topo da aba virou carrossel: pode haver mais de um ao mesmo
-- tempo. Cada um fica no ar 7 dias por padrão, ou o prazo pedido na publicação
-- (ex.: "essa demanda por 10 dias"). Decisão do Alexandre em 30/09.
--
-- POR QUE AQUI e não no DoctorDev: a release e o flag `destaque` moram lá, mas o
-- `releases-feed` escolhe os campos um a um e não tem prazo. Mudar o banco e o
-- feed de outro sistema, fora do repositório dele, para um detalhe que só o
-- DoctorSaaS exibe, não compensa. O flag continua lá; o prazo mora aqui.
--
-- Quem escreve: `scripts/novidade/destacar.mjs` (service_role). A tela só lê.
-- Release em destaque SEM linha aqui fica 7 dias contados da publicação.
-- Conteúdo público (é a vitrine de novidades de todos os clientes): qualquer
-- usuário logado lê, de qualquer empresa.
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.evolucao_destaques (
  release_id    uuid PRIMARY KEY,          -- releases.id do DoctorDev (sem FK: outro banco)
  demanda       text NOT NULL,             -- DEM-0000, para quem ler a tabela
  dias          int  NOT NULL,
  destaque_ate  timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evolucao_destaques_dias_chk CHECK (dias BETWEEN 1 AND 90)
);

COMMENT ON TABLE public.evolucao_destaques IS
  'Prazo de cada destaque do carrossel da Evolução DS. Escrita só por scripts/novidade/destacar.mjs. Sem linha = 7 dias da publicação.';

ALTER TABLE public.evolucao_destaques ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evolucao_destaques_select ON public.evolucao_destaques;
CREATE POLICY evolucao_destaques_select ON public.evolucao_destaques
  FOR SELECT TO authenticated USING (true);

-- Default privileges dão ALL a anon/authenticated em tabela nova. Só leitura.
REVOKE ALL ON public.evolucao_destaques FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evolucao_destaques TO authenticated;
GRANT ALL    ON public.evolucao_destaques TO service_role;

COMMIT;
