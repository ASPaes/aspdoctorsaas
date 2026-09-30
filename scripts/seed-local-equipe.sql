-- Equipe DS: conversas de exemplo no banco LOCAL (tenant "DS Local").
-- Só roda se o #geral ainda estiver vazio: não pisa no que você testou.
-- Uso: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres < scripts/seed-local-equipe.sql
--
-- Tudo passa pelas RPCs (como a tela faria), com o JWT de cada pessoa; depois
-- as datas são espalhadas em horários plausíveis de hoje e ontem.

do $$
declare
  t      uuid := 'd0000000-0000-0000-0000-00000000dead';
  dev    uuid := 'd0000000-0000-0000-0000-0000000000a1';
  op     uuid := 'd0000000-0000-0000-0000-0000000000b2';
  carla  uuid := 'e7360000-0000-0000-0000-000000000001';
  diego  uuid := 'e7360000-0000-0000-0000-000000000002';
  paula  uuid := 'e7360000-0000-0000-0000-000000000003';
  rodrigo uuid := 'e7360000-0000-0000-0000-000000000006';
  fernanda uuid := 'e7360000-0000-0000-0000-000000000007';
  geral uuid; suporte uuid; dm uuid; grupo uuid; c uuid; m uuid;
  -- "hoje" do roteiro = ontem de verdade: as mensagens vão até ~12h e nunca caem no futuro
  hoje timestamptz := date_trunc('day', (now() - interval '1 day') at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if to_regclass('public.equipe_canais') is null then
    raise exception 'Aplique a migration 20260929153000_equipe_chat_interno.sql antes';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', op)::text, true);
  perform public.equipe_garantir_canais(t);
  select id into geral from equipe_canais where tenant_id = t and tipo = 'geral';
  select id into suporte from equipe_canais where tenant_id = t and tipo = 'setor' and nome = 'Suporte';

  if exists (select 1 from equipe_mensagens where canal_id = geral) then
    raise notice 'Já tem conversa no #geral: seed não roda de novo.';
    return;
  end if;

  -- helper local: envia como alguém e carimba a hora
  create temp table if not exists _seed (id uuid, quando timestamptz) on commit drop;

  -- #geral (ontem e hoje)
  perform set_config('request.jwt.claims', json_build_object('sub', rodrigo)::text, true);
  m := (public.equipe_enviar(geral, 'Pessoal, a versão 5.8 do Hiper saiu hoje. Leiam o *checklist de reinstalação* antes de escalar para o N2.')).id;
  insert into _seed values (m, hoje - interval '1 day' + interval '17 hours 42 minutes');
  perform public.equipe_fixar(m, true);
  perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
  perform public.equipe_reagir(m, '👍');
  perform set_config('request.jwt.claims', json_build_object('sub', diego)::text, true);
  perform public.equipe_reagir(m, '👍');
  perform public.equipe_reagir(m, '🙏');
  perform set_config('request.jwt.claims', json_build_object('sub', fernanda)::text, true);
  m := (public.equipe_enviar(geral, 'Lembrete: fechamento do mês é sexta. Reembolso até quinta, por favor.')).id;
  insert into _seed values (m, hoje - interval '1 day' + interval '18 hours 5 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', dev)::text, true);
  m := (public.equipe_enviar(geral, 'Bom dia, equipe! Hoje às 14h tem alinhamento rápido de 15 minutos. @todos', null, '{}', true)).id;
  insert into _seed values (m, hoje + interval '8 hours 1 minute');
  perform set_config('request.jwt.claims', json_build_object('sub', paula)::text, true);
  perform public.equipe_reagir(m, '👋');

  -- #Suporte (hoje)
  perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
  m := (public.equipe_enviar(suporte, 'Alguém já pegou rejeição `539` depois da 5.8? Terceiro cliente hoje.', null, '{}', false, '[]',
        coalesce((select jsonb_build_array(jsonb_build_object('tipo','ticket','id',id)) from support_tickets
                   where tenant_id = t and deleted_at is null and concluido_em is null and ticket_code is not null limit 1), '[]'))).id;
  insert into _seed values (m, hoje + interval '9 hours 14 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', diego)::text, true);
  perform public.equipe_reagir(m, '👀');
  m := (public.equipe_enviar(suporte, 'Peguei 2 também. É o certificado A1: a 5.8 lê de outro caminho.')).id;
  insert into _seed values (m, hoje + interval '9 hours 22 minutes');
  m := (public.equipe_enviar(suporte, 'Reinstalando o certificado passa. Testei na Mercearia Silva.')).id;
  insert into _seed values (m, hoje + interval '9 hours 23 minutes');
  perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
  perform public.equipe_reagir(m, '✅');
  perform set_config('request.jwt.claims', json_build_object('sub', rodrigo)::text, true);
  m := (public.equipe_enviar(suporte, 'Boa, @Diego Souza. Vou abrir um ticket pai e vincular os casos. Procedimento: https://docs.hiper.com.br/certificado-a1', null, array[diego])).id;
  insert into _seed values (m, hoje + interval '9 hours 31 minutes');
  -- fio na mensagem do Rodrigo, com o operador mencionado
  declare raiz uuid := m; begin
    perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
    m := (public.equipe_enviar(suporte, 'Vinculei os 3 da manhã no ticket pai.', raiz)).id;
    insert into _seed values (m, hoje + interval '9 hours 40 minutes');
    perform set_config('request.jwt.claims', json_build_object('sub', diego)::text, true);
    m := (public.equipe_enviar(suporte, '@Operador Local se cair mais algum com 539 hoje, joga nesse ticket também.', raiz, array[op])).id;
    insert into _seed values (m, hoje + interval '9 hours 52 minutes');
    update equipe_mensagens set ultima_resposta_em = hoje + interval '9 hours 52 minutes' where id = raiz;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', carla)::text, true);
  -- pedido de ajuda com o atendimento anexado (conversa sem setor: todo o tenant enxerga)
  m := (public.equipe_enviar(suporte, '@Operador Local consegue me dar uma mão na Padaria Pão Nosso? O TEF parou de passar débito e eu estou com 4 abertos.', null, array[op], false, '[]',
        coalesce((select jsonb_build_array(jsonb_build_object('tipo','atendimento','id',a.id)) from support_attendances a
                    join whatsapp_conversations cv on cv.id = a.conversation_id
                   where a.tenant_id = t and cv.department_id is null order by a.opened_at desc limit 1), '[]'))).id;
  insert into _seed values (m, hoje + interval '10 hours 31 minutes');

  -- DM Carla ↔ Operador
  dm := public.equipe_abrir_dm(t, array[op]);
  m := (public.equipe_enviar(dm, 'Oi! Te chamei no canal, mas é mais rápido aqui.')).id;
  insert into _seed values (m, hoje + interval '10 hours 33 minutes');
  m := (public.equipe_enviar(dm, 'O cliente disse que o PinPad mostra *erro 12*. Já viu esse?')).id;
  insert into _seed values (m, hoje + interval '10 hours 34 minutes');

  -- grupo Paula, Diego, Operador
  perform set_config('request.jwt.claims', json_build_object('sub', paula)::text, true);
  grupo := public.equipe_abrir_dm(t, array[diego, op]);
  m := (public.equipe_enviar(grupo, 'Quem cobre meu horário de almoço hoje? Saio às 12h.')).id;
  insert into _seed values (m, hoje + interval '11 hours 40 minutes');

  -- canal manual criado pelo head
  perform set_config('request.jwt.claims', json_build_object('sub', rodrigo)::text, true);
  c := public.equipe_criar_canal(t, 'casos-criticos', 'Clientes parados ou com risco de cancelar', false, array[carla, diego, op]);
  update equipe_mensagens set created_at = hoje - interval '2 days' where canal_id = c;
  m := (public.equipe_enviar(c, 'Athuz Comércio segue sem emitir NFC-e. Prioridade máxima hoje.')).id;
  insert into _seed values (m, hoje + interval '8 hours 45 minutes');

  -- aplica as datas e acerta "última mensagem" dos canais
  update equipe_mensagens x set created_at = s.quando from _seed s where x.id = s.id;
  update equipe_canais k set ultima_mensagem_em = (select max(created_at) from equipe_mensagens where canal_id = k.id and parent_id is null)
   where tenant_id = t;
  -- quem enviou leu até a própria mensagem (as datas mudaram depois)
  update equipe_membros mb set lido_ate = (select max(created_at) from equipe_mensagens where canal_id = mb.canal_id and autor_id = mb.user_id)
   where tenant_id = t and exists (select 1 from equipe_mensagens where canal_id = mb.canal_id and autor_id = mb.user_id);
  -- abrir DM/grupo e criar canal gravam "lido até agora" para todos; como as
  -- datas foram voltadas, o operador precisa ficar para trás para ver não lidas
  update equipe_membros set lido_ate = hoje where user_id = op and canal_id in (dm, grupo, c);
  -- operador leu o #geral até ontem: as de hoje ficam como não lidas
  insert into equipe_membros (canal_id, user_id, tenant_id, lido_ate, saiu_em)
  values (geral, op, t, hoje - interval '1 day' + interval '19 hours', now())
  on conflict (canal_id, user_id) do update set lido_ate = excluded.lido_ate;
  insert into equipe_membros (canal_id, user_id, tenant_id, lido_ate, saiu_em)
  values (suporte, op, t, hoje + interval '9 hours 20 minutes', now())
  on conflict (canal_id, user_id) do update set lido_ate = excluded.lido_ate;

  -- presença: uns no turno, um em pausa, um atendendo
  insert into support_agent_presence (user_id, tenant_id, status, shift_started_at, last_heartbeat_at, pause_started_at)
  values (carla, t, 'active', hoje + interval '8 hours', now(), null),
         (diego, t, 'active', hoje + interval '8 hours', now(), null),
         (rodrigo, t, 'active', hoje + interval '8 hours', now(), null),
         (paula, t, 'paused', hoje + interval '8 hours', now(), now())
  on conflict (user_id) do update set status = excluded.status, last_heartbeat_at = now();

  raise notice 'Seed da Equipe DS criado.';
end $$;
