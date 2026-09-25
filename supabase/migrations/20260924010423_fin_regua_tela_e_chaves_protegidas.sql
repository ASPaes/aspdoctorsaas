-- =============================================================================
-- Régua de cobrança — escrita pela tela, e proteção das chaves de liberação.
--
-- Duas coisas que só apareceram quando a tela foi desenhada:
--
-- 1. Os toques nasceram legíveis mas não graváveis. `fin_regua_toques` só tinha
--    `select` para `authenticated`, então configurar a régua exigia SQL. Para
--    uma tabela de configuração isso está errado.
--
-- 2. ⚠️ As chaves que liberam automação moram em `configuracoes`, e a policy
--    dessa tabela permite escrita a QUALQUER membro ativo do tenant. Ou seja:
--    hoje um admin da Digi Office poderia ligar a régua e a 2ª via sozinho,
--    pela API, sem passar por ninguém. Nenhuma tela oferece isso, mas "nenhuma
--    tela oferece" nunca foi controle de acesso neste projeto.
--
--    Isso contraria diretamente a regra do Alexandre de que nada fala com
--    cliente antes de ele testar. Enquanto o motor não tem caminho de envio o
--    risco é zero, e é justamente por isso que se fecha agora: depois fica caro
--    e alguém esquece.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A tela pode configurar os toques
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Mesmo portão da leitura: super admin E tenant com o Financeiro ligado.
-- `fin_cobranca_envios` continua só de leitura de propósito: envio é fato
-- consumado, ninguém edita o que já saiu.
grant insert, update, delete on public.fin_regua_toques to authenticated;

drop policy if exists fin_regua_toques_write on public.fin_regua_toques;
create policy fin_regua_toques_write on public.fin_regua_toques
  for all
  using (
    (select public.is_super_admin()) is true
    and exists (
      select 1 from public.tenants t
       where t.id = fin_regua_toques.tenant_id
         and t.financeiro_enabled is true
    )
  )
  with check (
    (select public.is_super_admin()) is true
    and exists (
      select 1 from public.tenants t
       where t.id = fin_regua_toques.tenant_id
         and t.financeiro_enabled is true
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. As chaves de liberação só mudam por super admin
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Trigger e não policy porque o controle é por COLUNA: o resto de
-- `configuracoes` continua sendo do tenant, como sempre foi. Trocar a policy
-- inteira tiraria do tenant coisas que são dele.
--
-- `coalesce(..., false)`: `is_super_admin()` devolve NULL para quem não é, e
-- NULL num `if not` nunca dispara. Esse buraco já abriu portão neste projeto.
create or replace function public.fn_fin_protege_chaves_de_liberacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- O motor e os conectores escrevem como service_role e precisam passar.
  if current_user = 'service_role' then
    return new;
  end if;

  if coalesce(public.is_super_admin(), false) is true then
    return new;
  end if;

  if new.fin_regua_liberada is distinct from old.fin_regua_liberada then
    raise exception 'Só super admin pode liberar ou parar a régua de cobrança';
  end if;

  if new.fin_2via_liberado is distinct from old.fin_2via_liberado then
    raise exception 'Só super admin pode liberar ou parar a 2ª via automática';
  end if;

  if new.fin_regua_instance_id is distinct from old.fin_regua_instance_id then
    raise exception 'Só super admin pode trocar o número por onde a cobrança sai';
  end if;

  if new.fin_regua_telefones_teste is distinct from old.fin_regua_telefones_teste
     or new.fin_2via_telefones_teste is distinct from old.fin_2via_telefones_teste then
    raise exception 'Só super admin pode mexer na lista de telefones de teste';
  end if;

  return new;
end;
$$;

revoke all on function public.fn_fin_protege_chaves_de_liberacao() from public;

drop trigger if exists trg_fin_protege_chaves on public.configuracoes;
create trigger trg_fin_protege_chaves
  before update on public.configuracoes
  for each row execute function public.fn_fin_protege_chaves_de_liberacao();

comment on function public.fn_fin_protege_chaves_de_liberacao() is
  'Impede que membro comum do tenant ligue a régua, a 2ª via, troque o número de cobrança ou a lista de telefones de teste. O resto de configuracoes continua sendo do tenant.';
