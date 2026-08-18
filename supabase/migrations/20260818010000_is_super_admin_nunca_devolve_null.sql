-- 18/08/2026 — is_super_admin() para de devolver NULL.
--
-- O corpo atual e:
--     SELECT coalesce(p.is_super_admin, false) FROM profiles WHERE user_id = auth.uid() LIMIT 1
-- Sem linha em profiles ela nao devolve false: nao devolve LINHA, e o resultado e
-- NULL. (O coalesce ali e letra morta -- profiles.is_super_admin e NOT NULL, entao
-- a coluna nunca foi a fonte do NULL. A ausencia da linha e.)
--
-- Em RLS isso e inofensivo: NULL numa policy nega. Em plpgsql e o furo --
--     if not is_super_admin() and (...) then raise
--     -> not NULL and TRUE -> NULL -> o IF nao dispara -> o raise nunca acontece.
--
-- Varredura do dump de producao em 17/08 (508 funcoes, 390 plpgsql): 91 usam
-- is_super_admin() e >=51 tem portao que falha ABRINDO desse jeito. O numero e
-- piso, nao exato.
--
-- Medido ponta a ponta no Postgres local, com a versao de PRODUCAO da
-- update_ticket_fields carregada: usuario autenticado sem linha em profiles
-- gravou "INVADIDO" em observacao_agente de um ticket de outro tenant e deixou
-- evento na timeline. Depois desta migration, o mesmo caso e barrado com
-- "Sem permissao para alterar este ticket" e o valor fica intacto.
--
-- Por que EXISTS resolve sem efeito colateral:
--   - profiles_pkey e PRIMARY KEY (user_id): no maximo 1 linha por usuario, entao
--     EXISTS e exatamente equivalente ao LIMIT 1 de hoje para quem TEM perfil.
--     Medido: is_super_admin=true -> true, is_super_admin=false -> false,
--     identicos antes e depois. So o caso sem perfil muda, de NULL para false.
--   - "is_super_admin() IS NULL" tem 0 ocorrencias no dump inteiro: ninguem
--     distingue NULL de false, entao nada depende do comportamento atual.
--   - CREATE OR REPLACE mantem a assinatura, entao os GRANTs sobrevivem
--     (conferido no local: grant a authenticated segue de pe).
--
-- ATENCAO -- isto NAO fecha tudo. Sete funcoes tem um SEGUNDO bug de NULL que
-- este conserto nao alcanca: "v_role NOT IN ('admin','head') AND NOT
-- is_super_admin()", onde v_role tambem e NULL sem perfil e "NULL NOT IN (...)"
-- ja e NULL por conta propria. Sao elas: aplicar_reajuste, atualizar_reajuste_item,
-- estornar_reajuste, preparar_reajuste, soft_delete_ticket,
-- trg_protect_terminal_ticket e set_group_monitor -- esta ultima ja tinha
-- COALESCE(v_is_sa,false) e mesmo assim caiu no v_role ao lado. Ficam para a
-- proxima migration, com coalesce(v_role,''). O padrao correto ja existe em
-- link_cliente_to_attendance: "IF v_caller_role IS NULL OR v_caller_role NOT IN".

CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = (SELECT auth.uid()) AND p.is_super_admin
  );
$$;
