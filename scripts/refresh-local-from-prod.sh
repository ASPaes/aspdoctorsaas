#!/usr/bin/env bash
#
# Deixa o banco LOCAL (Docker) identico ao de PRODUCAO -- estrutura + DADOS REAIS.
#
# Diferenca para setup-local-db.sh:
#   setup-local-db.sh  traz SO A ESTRUTURA e ABORTA se o dump vier com dados (guarda LGPD).
#   este script        traz OS DADOS DE PROPOSITO. E uma decisao consciente do Alexandre:
#                      base de testes real para reproduzir bug de cliente e para validar
#                      ESCRITA (fechamento de mes) sem tocar em producao.
#
# ATENCAO LGPD: ao final o banco local tera conversas, telefones e e-mails de clientes
# reais. Disco criptografado e pasta fora de backup em nuvem sao parte do controle.
# Os arquivos de dump sao apagados ao final -- nao ficam em disco.
#
# O que ele NAO faz:
#   - Nao escreve dado nenhum em producao. O acesso remoto e so pg_dump (leitura).
#     Obs.: a propria CLI cria um login role temporario no remoto ("Initialising login
#     role"). Isso e comportamento da CLI, nao deste script.
#   - Nao toca em supabase/migrations/.
#   - Nao roda `supabase db reset` nem `db push`.
#
# Uso:  ./scripts/refresh-local-from-prod.sh [--yes]
# Pre-requisitos: Docker rodando com o stack local de pe, Supabase CLI, `supabase login`.

set -euo pipefail

PROJECT_REF="vbngjzovjhkmietztffo"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${TMPDIR:-/tmp}/ds-refresh-$$"
SCHEMA_SQL="$WORK/schema.sql"
DATA_SQL="$WORK/data.sql"
ASSUME_YES="${1:-}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

# Dump com dado de cliente nunca sobrevive ao script.
cleanup() { rm -rf "$WORK" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
mkdir -p "$WORK"; chmod 700 "$WORK"

cd "$ROOT"

DB="supabase_db_${PROJECT_REF}"
# q  = roda uma query e devolve o valor (sem stdin, para nao competir com o `read`)
# sh = manda um script pelo stdin
q()  { docker exec "$DB" psql -U postgres -d postgres -tAc "$1" 2>/dev/null || echo "__ERR__"; }
sh_() { docker exec -i "$DB" psql -U postgres -d postgres -q; }

# A API da CLI falha de forma transitoria (timeout de telemetria, rede). Sem retry,
# o script morre no primeiro tropego depois de ja ter dropado o banco local.
retry() {
  local n="$1"; shift; local i=1
  while true; do
    if "$@"; then return 0; fi
    [ "$i" -ge "$n" ] && return 1
    warn "tentativa $i/$n falhou, repetindo em 10s..."
    i=$((i+1)); sleep 10
  done
}

# --- 0. Pre-requisitos ----------------------------------------------------
say "0/9  Conferindo pre-requisitos"
command -v docker   >/dev/null || die "Docker nao encontrado."
docker info >/dev/null 2>&1    || die "Docker nao esta rodando."
command -v supabase >/dev/null || die "Supabase CLI nao encontrado: brew install supabase/tap/supabase"
retry 3 supabase projects list >/dev/null 2>&1 || die "Nao consegui falar com a API da Supabase (3 tentativas). Logado? supabase login"
ok "Docker, CLI e login"

# --- 1. Alvo: tem que ser o container LOCAL -------------------------------
say "1/9  Identificando o banco LOCAL"
docker ps --format '{{.Names}}' | grep -qx "$DB" \
  || die "container $DB nao esta de pe. Rode ./scripts/setup-local-db.sh primeiro."

# Guarda estrutural: toda escrita deste script passa por `docker exec` neste container.
# Nao existe caminho aqui que aponte escrita para uma URL remota.
#
# Prova de localidade: o alvo e um container Docker DESTA maquina, alcancado por nome,
# com a porta publicada em 54322. Producao e um host remoto -- nao tem container aqui
# nem mapeamento de porta. Isso e prova; "vault vazio" era so um proxy, e proxy vence
# validade (em 19/07 apareceu um segredo no local e o proxy passou a barrar sem motivo).
docker port "$DB" 2>/dev/null | grep -q '54322' \
  || die "container $DB nao publica a porta 54322. Nao consigo provar que e o banco local. Abortando."
ok "alvo = $DB (container local, porta 54322)"

# Segredos no vault nao dizem nada sobre localidade, mas dizem sobre isolamento:
# com credencial viva, uma edge function local pode falar com servico externo de verdade.
# Avisa (com nome, nunca com valor) e segue -- o refresh nao toca no schema vault.
SEG_ANTES="$(q "select count(*) from vault.secrets")"
if [ "$SEG_ANTES" != "0" ] && [ "$SEG_ANTES" != "__ERR__" ]; then
  warn "$SEG_ANTES segredo(s) no vault local: $(q "select string_agg(name, ', ') from vault.secrets")"
  warn "o CLAUDE.md assume vault.secrets = 0. Sobrevivem ao refresh -- avalie se devem ficar."
fi

if [ "$ASSUME_YES" != "--yes" ]; then
  printf '\n\033[33mIsto APAGA o banco local e o substitui pelos dados REAIS de producao.\033[0m\n'
  read -r -p "Digite 'sim' para continuar: " RESP
  [ "$RESP" = "sim" ] || die "cancelado pelo usuario."
fi

# --- 2. Dump da ESTRUTURA (leitura pura) ----------------------------------
say "2/9  Baixando a estrutura da producao (leitura)"
retry 3 supabase db dump --linked --schema public -f "$SCHEMA_SQL" </dev/null >/dev/null 2>&1 \
  || die "falha no dump de estrutura (3 tentativas)"
[ -s "$SCHEMA_SQL" ] || die "dump de estrutura vazio"
N_TAB_DUMP="$(grep -c '^CREATE TABLE' "$SCHEMA_SQL" || true)"
ok "$N_TAB_DUMP tabelas na estrutura"

# --- 3. Dump dos DADOS (leitura pura) -------------------------------------
say "3/9  Baixando os dados da producao (leitura) -- pode levar alguns minutos"
# A propria CLI ja emite `SET session_replication_role = replica;` no topo do arquivo
# e exclui o schema `vault` (nenhuma credencial e copiada).
retry 3 supabase db dump --linked --data-only --use-copy -f "$DATA_SQL" </dev/null >/dev/null 2>&1 \
  || die "falha no dump de dados (3 tentativas)"
[ -s "$DATA_SQL" ] || die "dump de dados vazio"
grep -q '^SET session_replication_role' "$DATA_SQL" \
  || die "o dump NAO trouxe 'SET session_replication_role = replica'. Carga com trigger vivo e proibida."
grep -qE '^COPY ' "$DATA_SQL" || die "dump de dados sem nenhum COPY. Abortando."
if grep -q '^COPY "vault"' "$DATA_SQL"; then die "o dump trouxe vault.secrets. Abortando (credenciais)."; fi
ok "$(du -h "$DATA_SQL" | cut -f1) / $(grep -cE '^COPY ' "$DATA_SQL" || true) tabelas com dados"

# --- 4. Zera o banco local ------------------------------------------------
# DROP SCHEMA public CASCADE tambem derruba policies de outros schemas que dependam
# de funcoes do public (storage, por exemplo). No local isso e aceitavel: o storage
# ja nao funciona por falta das policies do bucket.
say "4/9  Limpando o banco local"
sh_ >/dev/null 2>&1 <<'SQL'
SET session_replication_role = replica;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL   ON SCHEMA public TO postgres, service_role;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables
           WHERE schemaname IN ('auth','storage','supabase_functions')
             AND tablename NOT LIKE '%migrations%'
  LOOP
    EXECUTE format('TRUNCATE TABLE %I.%I CASCADE', r.schemaname, r.tablename);
  END LOOP;
END $$;
SQL
ok "schema public recriado, auth/storage zerados"

# --- 5. Carrega a ESTRUTURA ----------------------------------------------
say "5/9  Carregando a estrutura"
sh_ < "$SCHEMA_SQL" > "$WORK/schema-load.log" 2>&1 || true
TABELAS="$(q "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
ok "$TABELAS tabelas (erros ignoraveis: $(grep -c '^ERROR' "$WORK/schema-load.log" || true))"

# --- 6. NO-OPS ANTES DOS DADOS (requisito inegociavel) --------------------
# A carga da estrutura acabou de recriar as 3 funcoes REAIS, que fazem net.http_post
# contra a URL de producao. fn_onboarding_send_welcome e TRIGGER: dispara sozinha e
# mandaria WhatsApp real para cliente real. Desarmar AGORA, antes de qualquer dado.
say "6/9  Desarmando as funcoes de egress (ANTES dos dados)"
# NAO lista nomes fixos. O CLAUDE.md fala em "3 funcoes"; em 30/07 a estrutura de
# producao ja tinha 4 (apareceu cron_anexo_omie). Lista fixa apodrece em silencio --
# a proxima funcao de egress entraria viva no banco de testes. Entao descobrimos.
#
# Filtra por prosrc (coluna de texto), nao por pg_get_functiondef(): esta ultima estoura
# em agregados, porque o Postgres nao garante a ordem de avaliacao do WHERE e ela alcanca
# pg_catalog.array_agg antes do filtro de schema.
sh_ > "$WORK/egress.log" 2>&1 <<'SQL'
DO $do$
DECLARE r record; corpo text; n int := 0;
BEGIN
  FOR r IN
    SELECT p.proname,
           -- pg_get_function_arguments (nao _identity_) porque preserva os DEFAULT:
           -- CREATE OR REPLACE recusa remover default de funcao existente.
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid)    AS ret
    FROM pg_proc p JOIN pg_namespace nm ON nm.oid = p.pronamespace
    WHERE nm.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosrc ~* '(net\.http_(post|get))|supabase_functions\.http_request|\.supabase\.co/functions'
  LOOP
    IF r.ret = 'trigger' THEN
      corpo := 'BEGIN RAISE NOTICE ''LOCAL: desarmada (chamaria producao)''; RETURN NEW; END;';
    ELSIF r.ret = 'void' THEN
      corpo := 'BEGIN RAISE NOTICE ''LOCAL: desarmada (chamaria producao)''; END;';
    ELSIF r.ret ~* '^(SETOF|TABLE)' THEN
      corpo := 'BEGIN RAISE NOTICE ''LOCAL: desarmada (chamaria producao)''; RETURN; END;';
    ELSE
      -- Qualquer retorno escalar/composto: plpgsql aceita RETURN NULL para todos.
      corpo := 'BEGIN RAISE NOTICE ''LOCAL: desarmada (chamaria producao)''; RETURN NULL; END;';
    END IF;
    EXECUTE format('CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql AS $f$%s$f$',
                   r.proname, r.args, r.ret, corpo);
    RAISE NOTICE 'desarmada: %', r.proname;
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'total desarmadas: %', n;
END $do$;
SQL
grep -E '^(NOTICE|ERROR)' "$WORK/egress.log" | sed 's/^/  /' || true
EGRESS="$(q "select count(*) from pg_proc p join pg_namespace nm on nm.oid=p.pronamespace
             where nm.nspname='public' and p.prokind='f'
               and p.prosrc ~* '(net\.http_(post|get))|supabase_functions\.http_request|\.supabase\.co/functions'")"
[ "$EGRESS" = "0" ] || die "restam $EGRESS funcoes chamando producao. NAO carregue dados."
ok "0 funcoes de egress vivas"

# --- 7. Carrega os DADOS --------------------------------------------------
# Constraints CHECK marcadas NOT VALID sao armadilha: elas isentam as linhas ANTIGAS
# de producao, mas valem para insercao nova -- e COPY e insercao. Producao tem 8
# clientes com unidade_base_id nulo, herdados por `clientes_unidade_base_obrigatoria`.
# O COPY bate no primeiro e derruba a tabela INTEIRA (fica com 0 linhas, sem alarde).
# Entao: guardamos, removemos, carregamos, e recriamos identicas (o proprio
# pg_get_constraintdef ja devolve o "NOT VALID" no texto).
say "7/9  Carregando os dados (triggers desligados pelo proprio dump)"
sh_ >/dev/null 2>&1 <<'SQL'
CREATE TABLE IF NOT EXISTS public._refresh_nv_checks(tabela text, nome text, def text);
TRUNCATE public._refresh_nv_checks;
INSERT INTO public._refresh_nv_checks
SELECT c.conrelid::regclass::text, c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace nm ON nm.oid=t.relnamespace
WHERE nm.nspname='public' AND c.contype='c' AND NOT c.convalidated;
DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM public._refresh_nv_checks LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tabela, r.nome);
  END LOOP;
END $do$;
SQL
NV="$(q "select count(*) from public._refresh_nv_checks")"
ok "$NV constraint(s) NOT VALID removidas durante a carga"

sh_ < "$DATA_SQL" > "$WORK/data-load.log" 2>&1 || true

sh_ >/dev/null 2>&1 <<'SQL'
DO $do$ DECLARE r record; BEGIN
  FOR r IN SELECT * FROM public._refresh_nv_checks LOOP
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', r.tabela, r.nome, r.def);
  END LOOP;
END $do$;
DROP TABLE public._refresh_nv_checks;
SQL
ok "constraints NOT VALID recriadas"

# Um COPY que falha deixa a tabela curta ou vazia -- e a versao anterior deste script
# seguia dizendo "Pronto". O psql marca a tabela culpada no CONTEXT.
#
# AVISO, nao morte: as tabelas de `auth` e `storage` falham por diferenca de versao de
# schema entre o stack local e producao, e isso e aceitavel (o `public` e o que importa).
# Matar aqui era pior que o problema: numa execucao anterior o script morreu neste
# ponto e o passo 8 -- que reaplica a Entrega A do onboarding -- nunca rodou, deixando
# o banco sem 3 tabelas, 1 view e 11 funcoes. A checagem dura ficou no fim, sobre as
# tabelas centrais do public.
FALHOU="$(grep -oE '^CONTEXT:  COPY [a-zA-Z_0-9]+' "$WORK/data-load.log" 2>/dev/null | awk '{print $3}' | sort -u | tr '\n' ' ' || true)"
if [ -n "$FALHOU" ]; then
  warn "COPY falhou (tabela curta ou vazia): $FALHOU"
  warn "esperado em auth/storage. Se aparecer tabela do public aqui, investigue."
else
  ok "carga concluida, nenhum COPY falhou"
fi

# --- 8. Reaplica o que existe SO no local ---------------------------------
# Producao nao tem a Entrega A do onboarding (3 tabelas + 11 funcoes: onboarding_phases,
# onboarding_indicators, onboarding_journey_indicators, advance_onboarding_phase,
# journey_go_live, fn_onboarding_next_phase, ...). Recarregar da producao apaga tudo isso.
# As migrations estao versionadas e commitadas -- basta reaplicar as posteriores ao que
# ja subiu para producao.
#
# ATUALIZE ESTE CORTE conforme as migrations forem para producao.
#
# 13/08/2026 — DESLIGADO, e o motivo importa mais que o valor.
#
# A Entrega A ja esta em producao (conferido: as 3 tabelas e as 4 funcoes-chave
# existem no remoto). Com isso NAO EXISTE mais objeto que so viva no local, e o
# replay perdeu a razao de ser.
#
# Pior: com o corte em 20260727 o script reaplicava 106 migrations POR CIMA do dump
# fresco de producao. Como quase toda migration e CREATE OR REPLACE, isso sobrescrevia
# o corpo VIVO de producao pela versao do repo -- que e mais velha sempre que a funcao
# foi corrigida direto em prod, ou quando a correcao veio numa migration anterior ao
# corte. Foi assim que o local terminou com fn_assign_conversation_if_ready ainda
# carregando o ramo "multi-setor" removido de prod em 06/08, e sem a guarda de 11/08
# em fn_track_awaiting_agent. Gerar migration a partir desse local reverte correcao em
# producao sem avisar (quase aconteceu em 13/08).
#
# Para religar: so faz sentido se voltar a existir objeto exclusivo do local. Nesse
# caso, aponte o corte para as migrations DAQUELE objeto, nunca para uma data ampla.
LOCAL_ONLY_DESDE="99999999"
say "8/9  Reaplicando as migrations que so existem no local (>= $LOCAL_ONLY_DESDE)"
N_MIGR=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  sh_ < "$ROOT/supabase/migrations/$f" >> "$WORK/migr.log" 2>&1 || true
  N_MIGR=$((N_MIGR+1))
done < <(ls "$ROOT/supabase/migrations" | awk -v c="$LOCAL_ONLY_DESDE" '$0 >= c' | sort)
ok "$N_MIGR migrations reaplicadas (erros: $(grep -c '^ERROR' "$WORK/migr.log" 2>/dev/null || true))"

# --- 9. Verificacoes ------------------------------------------------------
say "9/9  Conferindo isolamento"
FALHAS=0
chk() { if [ "$2" = "$3" ]; then ok "$1: $2"; else warn "$1: $2 (esperado $3)"; FALHAS=$((FALHAS+1)); fi; }
# vault: informativo. O refresh nao mexe nele, entao o estado e o mesmo de antes.
SEG_DEPOIS="$(q 'select count(*) from vault.secrets')"
if [ "$SEG_DEPOIS" = "0" ]; then ok "vault.secrets: 0"; else warn "vault.secrets: $SEG_DEPOIS (inalterado pelo refresh)"; fi
chk "pg_cron instalado"             "$(q "select count(*) from pg_extension where extname='pg_cron'")" "0"
chk "funcoes de egress vivas"       "$(q "select count(*) from pg_proc p join pg_namespace nm on nm.oid=p.pronamespace where nm.nspname='public' and p.prokind='f' and p.prosrc ~* '(net\.http_(post|get))|supabase_functions\.http_request|\.supabase\.co/functions'")" "0"
chk "triggers http_request"         "$(q "select count(*) from pg_trigger t where not t.tgisinternal and pg_get_triggerdef(t.oid) ilike '%http_request%'")" "0"
# Entrega A do onboarding: so existe no local. Se sumir, o replay de migrations falhou.
chk "Entrega A: 3 tabelas"          "$(q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('onboarding_phases','onboarding_indicators','onboarding_journey_indicators')")" "3"
chk "Entrega A: funcoes-chave"      "$(q "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('advance_onboarding_phase','journey_go_live','fn_onboarding_next_phase','fn_sync_onboarding_journey_phase')")" "4"

# Sanidade de DADO. A versao anterior deste script conferiu so isolamento e disse
# "Pronto" com clientes = 0 linhas. Tabela central vazia e falha, nao detalhe.
for T in clientes contratos cliente_produtos movimentos_mrr tenants profiles; do
  N="$(q "select count(*) from public.$T")"
  if [ "$N" = "0" ] || [ "$N" = "__ERR__" ]; then
    warn "tabela central $T VAZIA"; FALHAS=$((FALHAS+1))
  fi
done

say "Contagens no local"
docker exec "$DB" psql -U postgres -d postgres -c "
select 'clientes' t, count(*) n from public.clientes
union all select 'contratos', count(*) from public.contratos
union all select 'cliente_produtos', count(*) from public.cliente_produtos
union all select 'movimentos_mrr', count(*) from public.movimentos_mrr
union all select 'contrato_eventos', count(*) from public.contrato_eventos
union all select 'whatsapp_messages', count(*) from public.whatsapp_messages
union all select 'whatsapp_conversations', count(*) from public.whatsapp_conversations
union all select 'profiles', count(*) from public.profiles
union all select 'tenants', count(*) from public.tenants
order by 1;" || true

if [ "$FALHAS" -gt 0 ]; then
  die "$FALHAS verificacao(oes) de isolamento falharam. NAO use este banco ate resolver."
fi

say "Pronto."
echo "  Banco local identico a producao (estrutura + dados), isolado."
echo "  Dumps apagados de $WORK"
echo "  Para o app apontar para producao de novo: apague .env.local"
