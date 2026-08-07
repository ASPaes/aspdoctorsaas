-- F2b (parte 3): troca a chave do espelho de (tenant, codigo) para (conta, codigo) e exige a conta.
--
-- APLICAR SO DEPOIS do deploy das recon-*. Antes disso o recon-espelho-pull em producao ainda faz
-- upsert com onConflict "tenant_id,codigo_cliente_omie" e quebraria sem a constraint antiga.
-- Foi por isso que estes dois comandos ficaram de fora da migration da F1.
--
-- Por que a chave antiga nao serve: codigo_cliente_omie e sequencial DENTRO de uma conta Omie.
-- Duas contas geram o mesmo codigo para clientes diferentes. Medido no smoke local: com a
-- UNIQUE(tenant_id, codigo_cliente_omie), semear o espelho das duas contas falha com
-- "duplicate key ... Key (tenant_id, codigo_cliente_omie)=(..., 900) already exists" -- ou seja,
-- o cliente 900 da Digi Up nao caberia no espelho enquanto o 900 da Digi Office existisse.

begin;

alter table public.omie_espelho_cadastro
  drop constraint if exists omie_espelho_cadastro_tenant_id_codigo_cliente_omie_key;

-- o indice unico por conta ja existe desde a migration da F1 (omie_espelho_cadastro_conta_codigo_key)

do $$
declare v_esp int; v_rec int;
begin
  select count(*) into v_esp from public.omie_espelho_cadastro  where conta_integration_id is null;
  select count(*) into v_rec from public.reconciliacao_cadastro where conta_integration_id is null;
  if v_esp > 0 or v_rec > 0 then
    raise exception
      'Ainda ha linhas sem conta: espelho=%, reconciliacao=%. Rode o pull e a deteccao de cada conta antes.',
      v_esp, v_rec;
  end if;
end $$;

-- Sem conta, a linha e invisivel para as telas (que agora filtram por conta) e para a limpeza de
-- orfaos. Melhor recusar a escrita do que acumular linha fantasma.
alter table public.omie_espelho_cadastro  alter column conta_integration_id set not null;
alter table public.reconciliacao_cadastro alter column conta_integration_id set not null;

commit;
