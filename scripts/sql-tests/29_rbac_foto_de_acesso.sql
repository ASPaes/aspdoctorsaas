-- Foto de acesso do RBAC: chama get_my_permissions() COMO CADA USUÁRIO e grava o
-- resultado. É a prova de que uma mudança não alterou o acesso de ninguém.
--
-- Uso (banco LOCAL):
--   1. docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres < scripts/sql-tests/29_rbac_foto_de_acesso.sql
--   2. select rbac_test.capturar('antes');    -- ANTES da mudança
--   3. ...aplica a mudança...
--   4. select rbac_test.capturar('depois');
--   5. o diff abaixo tem que listar só o que foi mudado DE PROPÓSITO.
--
-- Chamar a função real (e não replicar a lógica numa query) é o que dá valor à
-- prova: se o motor tiver bug, a foto pega.
create schema if not exists rbac_test;

create or replace function rbac_test.capturar(p_tabela text) returns bigint
language plpgsql as $$
declare u record; n bigint := 0;
begin
  execute format('drop table if exists rbac_test.%I', p_tabela);
  execute format('create table rbac_test.%I (user_id uuid, resource_key text, can_view boolean,
                  can_insert boolean, can_update boolean, can_delete boolean)', p_tabela);
  for u in select user_id from public.profiles where user_id is not null loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.user_id)::text, true);
    execute format(
      'insert into rbac_test.%I select %L::uuid, resource_key, can_view, can_insert, can_update, can_delete
         from public.get_my_permissions()', p_tabela, u.user_id);
  end loop;
  perform set_config('request.jwt.claims', '', true);
  execute format('select count(*) from rbac_test.%I', p_tabela) into n;
  return n;
end $$;

-- Diff (troque 'antes'/'depois' pelos nomes usados):
--   select t.nome empresa, p.role, a.resource_key, a.can_view antes, d.can_view depois, count(*) pessoas
--   from rbac_test.antes a
--   join rbac_test.depois d on d.user_id=a.user_id and d.resource_key=a.resource_key
--   join public.profiles p on p.user_id=a.user_id
--   join public.tenants t on t.id=p.tenant_id
--   where a.can_view is distinct from d.can_view
--   group by 1,2,3,4,5 order by 1,3;
