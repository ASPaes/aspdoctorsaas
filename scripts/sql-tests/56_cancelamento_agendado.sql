-- DEM-0425: smoke do cancelamento agendado. SÓ NO LOCAL: usa o tenant de teste d0000000-...-dead, que não existe em produção (lá falha na FK de tenants).
-- entre begin/rollback. Resultado sai no RAISE 'SMOKE|...' (a exception é o teste passando).
-- Espera: ok:hoje-recusado ok:dup-recusado ativos-antes=2, c1=cancelado c2=ativo, churn -245 e downsell -100, cliente cancelado só no fim.
begin;
do $$
declare
  T uuid := 'd0000000-0000-0000-0000-00000000dead';
  U uuid := 'd0000000-0000-0000-0000-0000000000a1';
  cli uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  pa uuid := gen_random_uuid(); pb uuid := gen_random_uuid(); pd uuid := gen_random_uuid();
  mot bigint; ag uuid; res jsonb; out text := ''; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  n int; ub bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',U,'role','authenticated')::text, true);
  insert into motivos_cancelamento(tenant_id, descricao) values (T,'Teste DEM-0425') returning id into mot;
  insert into unidades_base(tenant_id, nome) values (T,'UB DEM0425') returning id into ub; insert into clientes(id, tenant_id, razao_social, unidade_base_id) values (cli, T, 'CLIENTE DEM0425', ub);
  insert into cliente_produtos(id,tenant_id,cliente_id,produto_id,vlr_mensal,vlr_custo) values
    (pa,T,cli,9360001,245,122.5),(pb,T,cli,9360002,100,50),(pd,T,cli,9360001,80,40);
  insert into contratos(id,tenant_id,cliente_id,status,vlr_total_mensal) values (c1,T,cli,'ativo',245),(c2,T,cli,'ativo',180);
  insert into contrato_itens(contrato_id,cliente_produto_id,vlr_mensal) values (c1,pa,245),(c2,pb,100),(c2,pd,80);

  -- 1. data de hoje é recusada
  begin perform agendar_cancelamento('produto', pa, hoje, mot, null); out := out||'FALHA:hoje-aceito ';
  exception when others then out := out||'ok:hoje-recusado '; end;
  -- 2. agenda A (único item de C1) e B (C2 com 2 itens)
  ag := agendar_cancelamento('produto', pa, hoje+1, mot, 'aviso previo');
  perform agendar_cancelamento('produto', pb, hoje+1, mot, null);
  -- 3. duplicado recusado
  begin perform agendar_cancelamento('produto', pa, hoje+5, mot, null); out := out||'FALHA:dup ';
  exception when others then out := out||'ok:dup-recusado '; end;
  -- 4. nada mudou antes da data
  perform fn_processar_cancelamentos_agendados();
  select count(*) into n from cliente_produtos where id in (pa,pb) and ativo; out := out||'ativos-antes='||n||' ';
  -- 5. chega o dia
  update cancelamentos_agendados set data_efetiva = hoje where cliente_id = cli;
  res := fn_processar_cancelamentos_agendados(); out := out||'proc='||res::text||' ';
  out := out||(select string_agg(status,',') from cancelamentos_agendados where cliente_id=cli);
  select out||' c1='||(select status from contratos where id=c1)||' c2='||(select status from contratos where id=c2)
       ||' pa='||(select ativo from cliente_produtos where id=pa)||' pb='||(select ativo from cliente_produtos where id=pb)
       ||' churn='||coalesce((select string_agg(valor_delta::text||'@'||data_movimento, ',') from movimentos_mrr where cliente_id=cli and tipo='churn'),'-')
       ||' downsell='||coalesce((select string_agg(valor_delta::text, ',') from movimentos_mrr where cliente_id=cli and tipo='downsell'),'-')
       ||' cancelado='||coalesce((select cancelado::text from clientes where id=cli),'null')
       ||' autor='||coalesce((select usuario_id::text from contrato_eventos where contrato_id=c1),'-')
    into out;
  -- 6. desfazer
  ag := agendar_cancelamento('contrato', c2, hoje+3, mot, null);
  perform desfazer_cancelamento_agendado(ag);
  out := out||' desfeito='||(select status from cancelamentos_agendados where id=ag);
  -- 7. contrato C2 agendado e executado -> cliente cancelado
  perform agendar_cancelamento('contrato', c2, hoje+3, mot, null);
  update cancelamentos_agendados set data_efetiva = hoje where contrato_id = c2 and status='agendado';
  res := fn_processar_cancelamentos_agendados();
  out := out||' | c2='||(select status from contratos where id=c2)||' cancelado='||coalesce((select cancelado::text from clientes where id=cli),'null')||' st='||(select string_agg(status,',') from cancelamentos_agendados where cliente_id=cli);
  raise exception 'SMOKE|%', out;
end $$;
rollback;
