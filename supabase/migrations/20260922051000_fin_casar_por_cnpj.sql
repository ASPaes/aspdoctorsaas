-- =============================================================================
-- Financeiro — casar título com cliente do DoctorSaaS pelo CNPJ.
--
-- O título chega da origem com o CNPJ do sacado, não com o id do cliente daqui.
-- Esta função faz o vínculo, e é chamada pelo conector no fim de cada leitura.
--
-- Duas regras que não são negociáveis:
--   1. Só casa quando o CNPJ aponta para UM cliente. Dois clientes com o mesmo
--      CNPJ (acontece: duplicado, matriz e filial mal cadastradas) deixam o
--      título sem vínculo, para alguém decidir. Cobrar o cliente errado é pior
--      que não cobrar.
--   2. Nunca desfaz vínculo existente. Quem vinculou à mão manda.
-- =============================================================================

-- ⚠️ REESCRITA EM 22/09/2026, DEPOIS DE ESTOURAR O TEMPO NA 1ª CARGA REAL.
-- A v1 contava os ambíguos com um EXISTS correlacionado que agregava clientes
-- POR TÍTULO: com 18 mil títulos em produção, "canceling statement due to
-- statement timeout". Agora a contagem por CNPJ é feita UMA vez e entra por
-- junção. O statement_timeout da função também sobe: ela roda no fim de uma
-- carga e pode varrer a base inteira na primeira vez.

create or replace function public.fn_fin_casar_titulos_por_cnpj(p_tenant_id uuid)
returns table (casados integer, ambiguos integer, sem_cliente integer)
language plpgsql
security definer
set search_path = public
set statement_timeout = '120s'
as $$
declare
  v_casados integer := 0;
  v_ambiguos integer := 0;
  v_sem integer := 0;
begin
  if p_tenant_id is null then
    raise exception 'fn_fin_casar_titulos_por_cnpj: p_tenant_id é obrigatório';
  end if;

  with cnpjs as (
    -- Uma passada só pelos clientes do tenant: CNPJ, quantos clientes tem e,
    -- quando só tem um, qual é. Não existe min(uuid) no Postgres, daí o array.
    select c.cnpj_digits,
           count(*) as qtd,
           (array_agg(c.id))[1] as cliente_id
      from public.clientes c
     where c.tenant_id = p_tenant_id
       and coalesce(c.cnpj_digits, '') <> ''
     group by c.cnpj_digits
  ),
  atualizados as (
    update public.fin_titulos t
       set cliente_id = k.cliente_id,
           atualizado_em = now()
      from cnpjs k
     where t.tenant_id = p_tenant_id
       and t.cliente_id is null
       and t.cnpj_cpf_digits = k.cnpj_digits
       and k.qtd = 1
    returning 1
  )
  select count(*) into v_casados from atualizados;

  -- Ficaram de fora porque o CNPJ aponta para mais de um cliente.
  select count(*) into v_ambiguos
    from public.fin_titulos t
    join (
      select c.cnpj_digits, count(*) as qtd
        from public.clientes c
       where c.tenant_id = p_tenant_id
         and coalesce(c.cnpj_digits, '') <> ''
       group by c.cnpj_digits
    ) k on k.cnpj_digits = t.cnpj_cpf_digits and k.qtd > 1
   where t.tenant_id = p_tenant_id
     and t.cliente_id is null;

  select count(*) into v_sem
    from public.fin_titulos t
   where t.tenant_id = p_tenant_id
     and t.cliente_id is null;

  return query select v_casados, v_ambiguos, v_sem;
end;
$$;

comment on function public.fn_fin_casar_titulos_por_cnpj(uuid) is
  'Vincula títulos sem cliente ao cliente do tenant com o mesmo CNPJ, só quando o CNPJ é único. Devolve quantos casaram, quantos ficaram ambíguos e quantos seguem sem cliente. Chamada pelo conector.';

revoke all on function public.fn_fin_casar_titulos_por_cnpj(uuid) from public;
revoke all on function public.fn_fin_casar_titulos_por_cnpj(uuid) from anon, authenticated;
grant execute on function public.fn_fin_casar_titulos_por_cnpj(uuid) to service_role;
