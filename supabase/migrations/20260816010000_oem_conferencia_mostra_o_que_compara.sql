-- ============================================================================
-- A conferência tem que exibir o par que ela comparou
--
-- Flagrado pelo Alexandre em 16/08/2026 num print: a linha mostrava
--   OEM  SABOR DA PRACA        DS  SABOR DA PRACA
-- em vermelho, como nome divergente. Duas strings idênticas na tela.
--
-- Não era falso positivo do algoritmo — era a tela mentindo. A comparação usa
-- RAZÃO SOCIAL dos dois lados (`razao_social ?? nome_fantasia`), enquanto
-- `razao_oem` e `razao_ds` guardam o NOME FANTASIA. Campos diferentes: as
-- fantasias podem coincidir e as razões sociais não, e aí a linha aponta uma
-- divergência que ninguém enxerga.
--
-- Um alerta que o usuário não consegue verificar é pior que alerta nenhum: ele
-- ensina a desconfiar da tela. Então o valor comparado passa a ser gravado, e é
-- ele que a conferência exibe.
--
-- As colunas antigas continuam como estão — as abas Escolher candidato, Margem
-- e Pendências mostram nome fantasia de propósito, que é como a pessoa reconhece
-- a loja.
-- ============================================================================

begin;

alter table public.reconciliacao_oem
  add column if not exists razao_social_oem text,
  add column if not exists razao_social_ds  text;

comment on column public.reconciliacao_oem.razao_social_oem is
  'Razão social no OEM — é ESTE valor que a conferência compara, não razao_oem (fantasia).';
comment on column public.reconciliacao_oem.razao_social_ds is
  'Razão social no DoctorSaaS — o outro lado da mesma comparação.';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--
-- ⚠️ A primeira versão desta query usava
--     upper(coalesce(razao_social_oem,'')) = upper(coalesce(razao_social_ds,''))
--   e deu 994 — exatamente o total de divergências de nome. Não era defeito no
--   dado: quem preenche as colunas é a edge function, e antes de "Atualizar
--   espelho" as duas estão NULL. O coalesce transformou NULL em '' e a query
--   contou "vazio igual a vazio" como falso positivo. Comparar campo que ainda
--   não foi preenchido só serve para inventar alarme.
--
-- A versão certa separa "ainda não rodou" de "rodou e bateu":
--
--   select
--     count(*)                                                      as div_nome,
--     count(*) filter (where razao_social_oem is null
--                        and razao_social_ds  is null)              as ainda_nao_conferido,
--     count(*) filter (where coalesce(razao_social_oem,'') <> ''
--                        and coalesce(razao_social_ds ,'') <> ''
--                        and upper(razao_social_oem) = upper(razao_social_ds)) as falso_positivo
--   from public.reconciliacao_oem
--   where 'nome' = any(divergencias);
--
--   falso_positivo tem que ser 0. ainda_nao_conferido tem que ser 0 depois de
--   uma atualização do espelho.
-- ---------------------------------------------------------------------------
