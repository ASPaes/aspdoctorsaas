#!/usr/bin/env bash
#
# Cria no banco LOCAL o mínimo para abrir o app e logar: tenant, configurações,
# setor, funcionário e dois usuários com senha conhecida.
#
# POR QUE ISTO EXISTE
# O setup-local-db.sh copia a ESTRUTURA da produção e mais nada — o banco sobe
# sem um único usuário, e sem usuário não se abre nenhuma tela. Recriar isso na
# mão custa meia hora e envolve coisas que ninguém adivinha: a senha tem que ser
# gravada em bcrypt direto no auth.users, o perfil precisa de is_super_admin
# para passar pelo RequirePermission (a RPC get_my_permissions não tem linha
# nenhuma num banco recém-montado) e o tenant precisa de linha em
# `configuracoes`, senão metade das telas abre vazia.
#
# Como ninguém queria pagar esse preço, ninguém reconstruía o local — e ele foi
# ficando para trás. Em 16/09/2026 estava com 35 tabelas, 114 colunas e 142
# funções a menos que a produção. O seed existe para tornar a reconstrução
# barata, que é o que destrava rodar o setup-local-db.sh sem medo.
#
# SEGURANÇA
# Só fala com o container Docker local, por `docker exec` — não existe caminho
# neste script que alcance a produção, nem por engano de variável. Antes de
# escrever, confere que o banco NÃO é produção (pg_cron ausente é o sinal: em
# produção ele está instalado). Ao terminar, imprime o estado de isolamento.
#
# USO
#   ./scripts/seed-local-fixtures.sh
#   SENHA_LOCAL='outra' ./scripts/seed-local-fixtures.sh
#
# É idempotente: rodar de novo atualiza o que já existe em vez de duplicar.
set -euo pipefail

SENHA="${SENHA_LOCAL:-DevLocal123!}"

# UUIDs fixos: o mesmo banco reconstruído dez vezes mantém os mesmos ids, então
# link salvo, fixture de teste e print de tela continuam valendo.
TENANT="d0000000-0000-0000-0000-00000000dead"
ADMIN_UID="d0000000-0000-0000-0000-0000000000a1"
OPER_UID="d0000000-0000-0000-0000-0000000000b2"
SETOR="d0000000-0000-0000-0000-0000000000c1"

EMAIL_ADMIN="dev@local.dev"
EMAIL_OPER="operador@local.dev"

die() { echo "ERRO: $*" >&2; exit 2; }

command -v docker >/dev/null || die "Docker não encontrado."
docker info >/dev/null 2>&1 || die "Docker não está rodando."
DB=$(docker ps --format '{{.Names}}' | grep "supabase_db_" | head -1)
[ -n "$DB" ] || die "container do banco local não encontrado. Rode ./scripts/setup-local-db.sh."

psql_local() { MSYS_NO_PATHCONV=1 docker exec -i "$DB" psql -U postgres -d postgres "$@"; }

# Trava de produção. pg_cron está instalado em produção e não no local; se um dia
# alguém apontar este container para outro lugar, o script para aqui.
CRON=$(psql_local -tAc "select count(*) from pg_extension where extname='pg_cron';" | tr -d '[:space:]')
[ "$CRON" = "0" ] || die "este banco tem pg_cron instalado — cheira a PRODUÇÃO. Abortado sem escrever nada."

echo "Semeando em $DB ..."

psql_local -v ON_ERROR_STOP=1 -q \
  -v tenant="$TENANT" -v admin_uid="$ADMIN_UID" -v oper_uid="$OPER_UID" \
  -v setor="$SETOR" \
  -v email_admin="$EMAIL_ADMIN" -v email_oper="$EMAIL_OPER" -v senha="$SENHA" <<'SQL'
create extension if not exists pgcrypto with schema extensions;

insert into public.tenants (id, nome, status)
values (:'tenant', 'DS Local', 'ativo')
on conflict (id) do update set nome = excluded.nome, status = excluded.status;

-- Sem linha aqui, metade das telas abre vazia sem dizer por quê. Horário ligado
-- e mensagem preenchida para as telas de atendimento terem o que mostrar.
--
-- Sem ON CONFLICT: `configuracoes` tem PK em `id` e NENHUM unique em
-- `tenant_id`, então `on conflict (tenant_id)` não compila. O WHERE NOT EXISTS
-- é idempotente do mesmo jeito e ainda preserva o que o dev tiver ajustado
-- numa rodada anterior.
insert into public.configuracoes (tenant_id, business_hours_enabled, business_hours_message)
select :'tenant', true, 'Olá! Nosso horário é das {{start}} às {{end}}. Retornamos às {{next_start}}!'
where not exists (select 1 from public.configuracoes where tenant_id = :'tenant');

insert into public.support_departments (id, tenant_id, name, slug)
values (:'setor', :'tenant', 'Suporte', 'suporte')
on conflict (id) do update set name = excluded.name;

-- profiles.funcionario_id -> funcionarios.nome é de onde sai o nome na tela.
-- Não existe full_name nem nome em profiles.
--
-- Sem id cravado: `funcionarios.id` é bigserial, não uuid. Cravar um número
-- alto funcionaria hoje e quebraria no dia em que a sequência chegasse nele.
-- A identidade repetível aqui é o par (tenant, email).
-- department_id é obrigatório aqui: o gatilho
-- funcionario_require_email_and_department_when_active() recusa funcionário
-- ativo sem setor. E é o setor que o motor de distribuição lê, via
-- support_department_members (a UI escreve em funcionarios.department_id e um
-- gatilho espelha) — sem ele o funcionário existe e nunca recebe atendimento.
insert into public.funcionarios (nome, email, ativo, tenant_id, department_id)
select v.nome, v.email, true, :'tenant', :'setor'
  from (values ('Dev Local', :'email_admin'), ('Operador Local', :'email_oper')) as v(nome, email)
 where not exists (
   select 1 from public.funcionarios f
    where f.tenant_id = :'tenant' and f.email = v.email
 );

update public.funcionarios
   set ativo = true, department_id = coalesce(department_id, :'setor')
 where tenant_id = :'tenant' and email in (:'email_admin', :'email_oper');
SQL

# Os usuários entram por função para não repetir o bloco duas vezes. A senha vai
# em bcrypt pelo pgcrypto: o GoTrue valida bcrypt, então o login pela tela
# funciona sem precisar da API de admin nem de service_role.
seed_usuario() {
  local uid="$1" email="$2" super="$3" papel="$4"
  psql_local -v ON_ERROR_STOP=1 -q \
    -v uid="$uid" -v email="$email" -v super="$super" \
    -v papel="$papel" -v tenant="$TENANT" -v senha="$SENHA" <<'SQL'
-- Duas colunas que não parecem importar e são a diferença entre logar e não
-- logar, medidas em 16/09/2026 comparando esta linha com a de um usuário que
-- já logava:
--   instance_id  o GoTrue filtra por ele; NULL nunca casa, e o erro que chega
--                na tela é "Invalid login credentials", como se fosse a senha.
--   email_change o Go lê a coluna numa string não-anulável; NULL quebra o scan.
-- Os demais campos de token vão como '' pelo mesmo motivo.
insert into auth.users (instance_id, id, email, encrypted_password, email_confirmed_at,
                        aud, role, raw_app_meta_data, raw_user_meta_data,
                        email_change, confirmation_token, recovery_token, email_change_token_new)
values ('00000000-0000-0000-0000-000000000000',
        :'uid', :'email', extensions.crypt(:'senha', extensions.gen_salt('bf')), now(),
        'authenticated', 'authenticated',
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        '', '', '', '')
on conflict (id) do update
   set instance_id = '00000000-0000-0000-0000-000000000000',
       email = excluded.email,
       encrypted_password = excluded.encrypted_password,
       email_confirmed_at = coalesce(auth.users.email_confirmed_at, now());

-- Normaliza a linha DEPOIS do upsert, e não só no INSERT, porque o caminho
-- `do update` não passa por quem já existia — foi assim que a 1ª versão deste
-- script continuou sem logar mesmo depois do conserto. O GoTrue lê estas
-- colunas em string não-anulável do Go: qualquer NULL vira
-- "Database error querying schema", que não fala de coluna nenhuma.
update auth.users
   set email_change            = coalesce(email_change, ''),
       confirmation_token      = coalesce(confirmation_token, ''),
       recovery_token          = coalesce(recovery_token, ''),
       email_change_token_new  = coalesce(email_change_token_new, ''),
       created_at              = coalesce(created_at, now()),
       updated_at              = now()
 where id = :'uid';

-- Sem identity o login por e-mail/senha falha em algumas versões do GoTrue.
-- created_at/updated_at não têm default aqui e o Go lê os dois em *time.Time:
-- NULL derruba a busca do usuário inteira, com "unable to fetch records".
insert into auth.identities (provider, provider_id, user_id, identity_data,
                             created_at, updated_at, last_sign_in_at)
values ('email', :'uid', :'uid',
        jsonb_build_object('sub', :'uid', 'email', :'email', 'email_verified', true),
        now(), now(), now())
on conflict (provider, provider_id) do update
   set created_at     = coalesce(auth.identities.created_at, now()),
       updated_at     = now(),
       last_sign_in_at = coalesce(auth.identities.last_sign_in_at, now());

-- status 'ativo' é obrigatório: perfil pendente passa pelo login e depois lê 0
-- linhas em tudo, porque as policies por tenant exigem perfil ativo.
insert into public.profiles (user_id, tenant_id, role, is_super_admin, status, funcionario_id)
values (:'uid', :'tenant', :'papel', :'super'::boolean, 'ativo',
        (select id from public.funcionarios
          where tenant_id = :'tenant' and email = :'email' limit 1))
on conflict (user_id) do update
   set tenant_id = excluded.tenant_id,
       role = excluded.role,
       is_super_admin = excluded.is_super_admin,
       status = 'ativo',
       funcionario_id = excluded.funcionario_id;
SQL
}

# O super admin abre tudo (é bypass do RequirePermission). O operador existe para
# testar o que o RBAC de verdade barra — com um super admin só, todo teste de
# permissão passa e não prova nada.
seed_usuario "$ADMIN_UID" "$EMAIL_ADMIN" true  admin
seed_usuario "$OPER_UID"  "$EMAIL_OPER"  false user

echo
echo "Pronto. Login em http://localhost:8080 (com .env.local apontando para o Docker):"
echo "  $EMAIL_ADMIN  / $SENHA   (super admin, abre tudo)"
echo "  $EMAIL_OPER   / $SENHA   (operador, para testar o que o RBAC barra)"
echo

# Relatório de isolamento. A regra antiga do CLAUDE.md era "vault.secrets = 0",
# mas hoje o local tem segredos de teste legítimos (contas de e-mail apontando
# para o inbucket). O que importa não é a contagem: é nenhum deles apontar para
# fora. Por isso o relatório mostra os dois números e deixa a leitura na mão de
# quem roda.
echo "Isolamento deste banco:"
psql_local -tAc "
select '  pg_cron:        ' || case when count(*) = 0 then 'ausente (nada dispara sozinho)' else 'INSTALADO — CUIDADO' end
  from pg_extension where extname = 'pg_cron';
select '  vault.secrets:  ' || count(*)::text || ' (confira se algum aponta para fora)' from vault.secrets;
select '  contas e-mail:  ' || count(*) filter (where smtp_host not like '%local%' and smtp_host not like '%docker%')
       || ' com host externo, de ' || count(*)::text from public.email_accounts;
"
