-- A busca de cliente nao ignorava acento, e foi isso que criou cadastro duplicado.
--
-- Caso VARANDAO BAR, 11/09/2026: o cadastro de 31/07 esta gravado com "Ã". A agente
-- digitou "VARANDAO", o ILIKE nao casou (ele ignora maiuscula, nao acento), ela
-- concluiu que o cliente nao existia e cadastrou de novo. Ficaram DUAS implantacoes
-- em andamento para o mesmo cliente, com a mesma responsavel, e a conversa de
-- WhatsApp presa no cadastro velho — foi assim que ele apareceu como "sem 1o
-- contato" no painel de onboarding.
--
-- 74 clientes so da Digi Office tem acento no nome. Medido com a RLS da propria
-- agente: digitar "varandao" achava 1 (o duplicado); agora acha 2. "sao" ia de 17
-- para 23 — "DECK SÃO BENTO", "PADARIA SÃO MIGUEL" e companhia estavam invisiveis.
--
-- f_unaccent existe porque unaccent e STABLE (depende do dicionario) e coluna gerada
-- exige IMMUTABLE. Passar o dicionario explicito e a forma canonica de prometer
-- imutabilidade.
--
-- A COLUNA e o unico caminho que serve tambem para as telas que filtram via
-- PostgREST: .ilike() nao chama funcao na coluna. De quebra troca o
-- .or(nome_fantasia.ilike…,razao_social.ilike…) por predicado unico — e .or() anula
-- indice ordenado (CLAUDE.md). Nao vaza para o export: as colunas do CSV/XLSX sao
-- lista fixa, nao Object.keys (exportClientesCsv.ts:9).
--
-- Tabela: 5.377 linhas / 8 MB — rewrite instantaneo. Indice criado CONCURRENTLY.

CREATE OR REPLACE FUNCTION public.f_unaccent(p_texto text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
SET search_path TO 'public', 'extensions'
AS $function$
  SELECT extensions.unaccent('extensions.unaccent'::regdictionary, p_texto);
$function$;

COMMENT ON FUNCTION public.f_unaccent(text) IS
  'unaccent com dicionario explicito para poder ser IMMUTABLE (coluna gerada/indice).';

ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS busca_nome text
  GENERATED ALWAYS AS (
    public.f_unaccent(upper(coalesce(nome_fantasia, '') || ' ' || coalesce(razao_social, '')))
  ) STORED;

COMMENT ON COLUMN public.clientes.busca_nome IS
  'Nome fantasia + razao social, sem acento e em maiuscula, para busca. Sempre casar com f_unaccent(upper(termo)).';

-- CONCURRENTLY nao roda em transacao: aplicado via execute_sql, fora desta migration.
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_clientes_busca_nome_trgm
--   ON public.clientes USING gin (busca_nome extensions.gin_trgm_ops);

-- search_clientes e a busca da tela de criar jornada — foi nela que o duplicado
-- nasceu. Os DOIS lados precisam usar f_unaccent; se um deles ficar de fora, a busca
-- volta a errar em silencio.
CREATE OR REPLACE FUNCTION public.search_clientes(p_tenant_id uuid, p_termo text DEFAULT NULL::text, p_limit integer DEFAULT 30)
RETURNS TABLE(id uuid, nome_fantasia text, razao_social text, cnpj text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT c.id, c.nome_fantasia, c.razao_social, c.cnpj
  FROM public.clientes c
  WHERE c.tenant_id = p_tenant_id
    AND (
      public.is_super_admin()
      OR p_tenant_id = (SELECT pr.tenant_id FROM public.profiles pr WHERE pr.user_id = auth.uid())
    )
    AND (
      btrim(coalesce(p_termo, '')) = ''
      OR c.busca_nome LIKE '%' || public.f_unaccent(upper(p_termo)) || '%'
      OR (
        regexp_replace(coalesce(p_termo, ''), '[^0-9]', '', 'g') <> ''
        AND regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g')
            LIKE '%' || regexp_replace(p_termo, '[^0-9]', '', 'g') || '%'
      )
    )
  ORDER BY c.nome_fantasia NULLS LAST
  LIMIT LEAST(COALESCE(p_limit, 30), 50);
$function$;
