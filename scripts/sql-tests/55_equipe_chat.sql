-- Equipe DS (chat interno) — permissões, privacidade e não lidas.
-- Pré-requisito: migration 20260929153000_equipe_chat_interno.sql aplicada no local.
-- Tudo dentro de BEGIN/ROLLBACK: nada persiste.
--
-- Elenco (tenant "DS Local"):
--   carla  (user, setor Suporte)   diego (user, Suporte)   fernanda (user, Financeiro)
--   rodrigo (head, Suporte)        dev (admin + super admin; movido para outro tenant no teste 7)
BEGIN;

create temp table ids (k text primary key, v uuid);
insert into ids values
 ('tenant',  'd0000000-0000-0000-0000-00000000dead'),
 ('carla',   'e7360000-0000-0000-0000-000000000001'),
 ('diego',   'e7360000-0000-0000-0000-000000000002'),
 ('fernanda','e7360000-0000-0000-0000-000000000007'),
 ('rodrigo', 'e7360000-0000-0000-0000-000000000006'),
 ('dev',     'd0000000-0000-0000-0000-0000000000a1'),
 ('suporte', 'd0000000-0000-0000-0000-0000000000c1'),
 ('financ',  'e7360000-0000-0000-0000-0000000000d2');
grant select on ids to authenticated;
create temp table r (k text primary key, v uuid);
grant all on r to authenticated;

create or replace function pg_temp.id(p text) returns uuid language sql as $$ select v from ids where k = p $$;
create or replace function pg_temp.como(p text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.id(p), 'role','authenticated')::text, true);
end $$;
create or replace function pg_temp.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok  %', msg;
end $$;

-- 1. Canais automáticos: #geral + 1 por setor, idempotente
select pg_temp.como('carla');
set local role authenticated;
select count(*) from public.equipe_minhas_conversas(pg_temp.id('tenant'));
select count(*) from public.equipe_minhas_conversas(pg_temp.id('tenant'));
reset role;
select pg_temp.ok((select count(*) from equipe_canais where tipo='geral') = 1, '#geral único após 2 chamadas');
select pg_temp.ok((select count(*) from equipe_canais where tipo='setor') = 2, 'um canal por setor');
set local role authenticated;
-- Carla vê #geral e #Suporte na lista, não #Financeiro
select pg_temp.ok((select array_agg(nome order by nome collate "C") from equipe_minhas_conversas(pg_temp.id('tenant')))
                  = array['Suporte','geral'], 'lista da Carla = geral + Suporte');
-- ... e pela RLS também não lê o canal do Financeiro
select pg_temp.ok(not exists (select 1 from equipe_canais where tipo='setor' and department_id = pg_temp.id('financ')),
                  'operador não enxerga canal de outro setor');

-- 2. Operador não cria canal
do $$ begin
  perform public.equipe_criar_canal(pg_temp.id('tenant'), 'bagunca');
  raise exception 'FALHOU: operador criou canal';
exception when insufficient_privilege then raise notice 'ok  operador não cria canal';
end $$;

-- 3. Mensagem no #geral, não lida para os outros, menção conta
insert into r select 'geral', id from equipe_canais where tipo='geral';
select id is not null from public.equipe_enviar((select v from r where k='geral'), 'Bom dia @Diego',
       null, array[pg_temp.id('diego')]);
reset role;
select pg_temp.como('diego');
set local role authenticated;
select pg_temp.ok((select nao_lidas from equipe_minhas_conversas(pg_temp.id('tenant')) where tipo='geral') = 1, 'Diego tem 1 não lida no #geral');
select pg_temp.ok((select mencoes from equipe_minhas_conversas(pg_temp.id('tenant')) where tipo='geral') = 1, 'e 1 menção');
select public.equipe_marcar_lido((select v from r where k='geral'));
select pg_temp.ok((select nao_lidas from equipe_minhas_conversas(pg_temp.id('tenant')) where tipo='geral') = 0, 'marcar lido zera');
-- Carla (autora) não tem a própria como não lida
reset role; select pg_temp.como('carla'); set local role authenticated;
select pg_temp.ok((select nao_lidas from equipe_minhas_conversas(pg_temp.id('tenant')) where tipo='geral') = 0, 'autor não conta a própria');

-- 4. Reação liga e desliga
insert into r select 'msg', id from equipe_mensagens where corpo like 'Bom dia%';
select public.equipe_reagir((select v from r where k='msg'), '👍');
select pg_temp.ok((select reacoes->'👍' from equipe_mensagens where id=(select v from r where k='msg')) = jsonb_build_array(pg_temp.id('carla')::text), 'reação ligada');
select public.equipe_reagir((select v from r where k='msg'), '👍');
select pg_temp.ok((select reacoes from equipe_mensagens where id=(select v from r where k='msg')) = '{}'::jsonb, 'reação desligada');

-- 5. Só o autor edita; Diego não
reset role; select pg_temp.como('diego'); set local role authenticated;
do $$ begin
  perform public.equipe_editar((select v from r where k='msg'), 'hackeado');
  raise exception 'FALHOU: outro editou';
exception when insufficient_privilege then raise notice 'ok  só o autor edita';
end $$;
do $$ begin
  perform public.equipe_apagar((select v from r where k='msg'));
  raise exception 'FALHOU: operador apagou mensagem alheia';
exception when insufficient_privilege then raise notice 'ok  operador não apaga mensagem alheia';
end $$;

-- 6. DM Carla ↔ Diego: privada, única e fora da vista da Fernanda
reset role; select pg_temp.como('carla'); set local role authenticated;
insert into r values ('dm', public.equipe_abrir_dm(pg_temp.id('tenant'), array[pg_temp.id('diego')]));
select pg_temp.ok(public.equipe_abrir_dm(pg_temp.id('tenant'), array[pg_temp.id('diego')]) = (select v from r where k='dm'), 'mesma DM ao reabrir');
select id is not null from public.equipe_enviar((select v from r where k='dm'), 'segredo');
reset role; select pg_temp.como('diego'); set local role authenticated;
select pg_temp.ok(public.equipe_abrir_dm(pg_temp.id('tenant'), array[pg_temp.id('carla')]) = (select v from r where k='dm'), 'Diego abrindo com Carla cai na mesma DM');
select pg_temp.ok((select nao_lidas from equipe_minhas_conversas(pg_temp.id('tenant')) where id=(select v from r where k='dm')) = 1, 'DM chega como não lida');
reset role; select pg_temp.como('fernanda'); set local role authenticated;
select pg_temp.ok(not exists (select 1 from equipe_mensagens where corpo='segredo'), 'Fernanda não lê a DM');
do $$ begin
  perform public.equipe_enviar((select v from r where k='dm'), 'intrusa');
  raise exception 'FALHOU: Fernanda escreveu na DM';
exception when insufficient_privilege then raise notice 'ok  Fernanda não escreve na DM';
end $$;
-- head do setor também não lê DM
reset role; select pg_temp.como('rodrigo'); set local role authenticated;
select pg_temp.ok(not exists (select 1 from equipe_mensagens where corpo='segredo'), 'head não lê DM');
-- head lê canal de outro setor (Financeiro), mas ele não aparece na lista dele
select pg_temp.ok(exists (select 1 from equipe_canais where tipo='setor' and department_id = pg_temp.id('financ')), 'head enxerga canal do Financeiro');
select pg_temp.ok(not exists (select 1 from equipe_minhas_conversas(pg_temp.id('tenant')) where department_id = pg_temp.id('financ')), 'mas não entra na lista dele sem entrar');

-- 7. Super admin de OUTRO tenant simulando: lê #geral, NÃO lê DM
reset role;
select set_config('request.jwt.claims', '', true);  -- gatilho de perfil barra troca de tenant com JWT de usuário
insert into tenants (id, nome) values ('a0000000-0000-0000-0000-00000000beef', 'Outro tenant (teste)');
update profiles set tenant_id = 'a0000000-0000-0000-0000-00000000beef' where user_id = pg_temp.id('dev');
select pg_temp.como('dev'); set local role authenticated;
select pg_temp.ok(exists (select 1 from equipe_mensagens where corpo like 'Bom dia%'), 'super admin lê #geral do tenant simulado');
select pg_temp.ok(not exists (select 1 from equipe_mensagens where corpo='segredo'), 'super admin NÃO lê DM');
select pg_temp.ok(not exists (select 1 from equipe_canais where id=(select v from r where k='dm')), 'super admin nem vê que a DM existe');
do $$ begin
  perform public.equipe_abrir_dm(pg_temp.id('tenant'), array[pg_temp.id('carla')]);
  raise exception 'FALHOU: super admin abriu DM em tenant alheio';
exception when insufficient_privilege then raise notice 'ok  super admin não abre DM em tenant alheio';
end $$;

-- 8. Head cria canal privado com Carla; Diego não vê; fio conta respostas
reset role; select set_config('request.jwt.claims', '', true);
update profiles set tenant_id = pg_temp.id('tenant') where user_id = pg_temp.id('dev');
select pg_temp.como('rodrigo'); set local role authenticated;
insert into r values ('priv', public.equipe_criar_canal(pg_temp.id('tenant'), 'Casos Críticos', 'N2', true, array[pg_temp.id('carla')]));
select pg_temp.ok((select nome from equipe_canais where id=(select v from r where k='priv')) = 'casos-críticos', 'nome normalizado');
reset role; select pg_temp.como('diego'); set local role authenticated;
select pg_temp.ok(not exists (select 1 from equipe_canais where id=(select v from r where k='priv')), 'Diego não vê canal privado');
reset role; select pg_temp.como('carla'); set local role authenticated;
insert into r select 'raiz', (public.equipe_enviar((select v from r where k='priv'), 'raiz do fio')).id;
select (public.equipe_enviar((select v from r where k='priv'), 'resposta 1', (select v from r where k='raiz'))).id is not null;
select (public.equipe_enviar((select v from r where k='priv'), 'resposta 2', (select v from r where k='raiz'))).id is not null;
select pg_temp.ok((select respostas from equipe_mensagens where id=(select v from r where k='raiz')) = 2, 'fio conta 2 respostas');
select pg_temp.ok((select respondentes from equipe_mensagens where id=(select v from r where k='raiz')) = array[pg_temp.id('carla')], 'respondente sem repetição');

-- 9. Escrita direta nas tabelas é barrada
do $$ begin
  insert into equipe_mensagens (tenant_id, canal_id, corpo) values (pg_temp.id('tenant'), (select v from r where k='geral'), 'direto');
  raise exception 'FALHOU: insert direto passou';
exception when insufficient_privilege then raise notice 'ok  insert direto barrado';
end $$;

-- 10. Pessoas: lista o tenant com presença
select pg_temp.ok((select count(*) from equipe_pessoas(pg_temp.id('tenant'))) = 10, 'equipe_pessoas lista os 10 do tenant');

-- 11. Fio: responder não marca o canal como lido; quem foi mencionado acompanha
reset role; select pg_temp.como('carla'); set local role authenticated;
select public.equipe_marcar_lido((select v from r where k='geral'));
reset role; select pg_temp.como('diego'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='geral'), 'raiz nova do Diego')).id is not null;
reset role; select pg_temp.como('carla'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='geral'), 'Marquei a reunião, @Diego Souza', (select v from r where k='msg'), array[pg_temp.id('diego')])).id is not null;
select pg_temp.ok((select nao_lidas from equipe_minhas_conversas(pg_temp.id('tenant')) where tipo='geral') = 1,
                  'responder no fio não esconde a mensagem nova do canal');
reset role; select pg_temp.como('diego'); set local role authenticated;
select pg_temp.ok((select nao_lidas from equipe_meus_fios(pg_temp.id('tenant')) where raiz_id=(select v from r where k='msg')) = 1, 'mencionado no fio vê 1 resposta nova');
select pg_temp.ok((select mencoes from equipe_meus_fios(pg_temp.id('tenant')) where raiz_id=(select v from r where k='msg')) = 1, 'e a menção conta');
select public.equipe_marcar_fio_lido((select v from r where k='msg'));
select pg_temp.ok((select nao_lidas from equipe_meus_fios(pg_temp.id('tenant')) where raiz_id=(select v from r where k='msg')) = 0, 'marcar fio lido zera');
-- Fernanda não participa: o fio não aparece para ela
reset role; select pg_temp.como('fernanda'); set local role authenticated;
select pg_temp.ok(not exists (select 1 from equipe_meus_fios(pg_temp.id('tenant')) where raiz_id=(select v from r where k='msg')), 'fio não aparece para quem não participa');

-- 12. Busca: sem acento, sem maiúscula, e nunca acha DM alheia
select pg_temp.ok(not exists (select 1 from equipe_buscar(pg_temp.id('tenant'), 'segredo')), 'Fernanda não acha texto de DM alheia');
select pg_temp.ok(exists (select 1 from equipe_buscar(pg_temp.id('tenant'), 'REUNIAO')), 'busca ignora acento e maiúscula');
select pg_temp.ok(not exists (select 1 from equipe_buscar(pg_temp.id('tenant'), '%')), 'curinga % não vira "tudo"');
reset role; select pg_temp.como('diego'); set local role authenticated;
select pg_temp.ok((select count(*) from equipe_buscar(pg_temp.id('tenant'), 'segredo')) = 1, 'Diego acha a própria DM');

-- 13. Fixar: operador não fixa em canal aberto; na DM qualquer um fixa
do $$ begin
  perform public.equipe_fixar((select v from r where k='msg'), true);
  raise exception 'FALHOU: operador fixou no #geral';
exception when insufficient_privilege then raise notice 'ok  operador não fixa no #geral';
end $$;
select public.equipe_fixar((select id from equipe_mensagens where corpo='segredo'), true);
select pg_temp.ok((select fixada_por from equipe_mensagens where corpo='segredo') = pg_temp.id('diego'), 'na DM o operador fixa');

-- 14. Salvos: só meus
select public.equipe_salvar((select v from r where k='msg'), true);
select pg_temp.ok((select count(*) from equipe_meus_salvos(pg_temp.id('tenant'))) = 1, 'Diego tem 1 salvo');
reset role; select pg_temp.como('fernanda'); set local role authenticated;
select pg_temp.ok((select count(*) from equipe_meus_salvos(pg_temp.id('tenant'))) = 0, 'salvo de um não aparece para outro');

-- 15. Cartões vivos: anexo tem de existir no tenant; o conteúdo vem com a permissão de quem vê
reset role;
select set_config('request.jwt.claims', '', true);
insert into r select 'ticket', id from support_tickets where tenant_id = pg_temp.id('tenant') and deleted_at is null limit 1;
-- atendimento de conversa SEM setor (todos veem) e outro do setor Financeiro (Carla, do Suporte, não vê)
insert into r select 'atend', a.id from support_attendances a join whatsapp_conversations c on c.id = a.conversation_id where a.tenant_id = pg_temp.id('tenant') and c.department_id is null limit 1;
insert into r select 'atend_fin', a.id from support_attendances a join whatsapp_conversations c on c.id = a.conversation_id where a.tenant_id = pg_temp.id('tenant') and c.department_id = pg_temp.id('financ') limit 1;
insert into r select 'cliente', id from clientes where tenant_id = pg_temp.id('tenant') limit 1;
insert into r values ('outro_tenant', gen_random_uuid());
select pg_temp.como('carla'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='geral'), 'olhem esse', null, '{}', false, '[]',
        jsonb_build_array(jsonb_build_object('tipo','ticket','id',(select v from r where k='ticket')),
                          jsonb_build_object('tipo','atendimento','id',(select v from r where k='atend'))))).id is not null;
select pg_temp.ok((select jsonb_array_length(refs) from equipe_mensagens where corpo='olhem esse') = 2, 'mensagem guarda os 2 anexos');
select (public.equipe_enviar((select v from r where k='geral'), '', null, '{}', false, '[]',
        jsonb_build_array(jsonb_build_object('tipo','cliente','id',(select v from r where k='cliente'))))).id is not null;
select pg_temp.ok(true, 'mensagem só com cartão, sem texto, é aceita');
do $$ begin
  perform public.equipe_enviar((select v from r where k='geral'), 'x', null, '{}', false, '[]',
          jsonb_build_array(jsonb_build_object('tipo','ticket','id',(select v from r where k='outro_tenant'))));
  raise exception 'FALHOU: anexo inexistente passou';
exception when raise_exception then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'ok  anexo que não existe no tenant é recusado';
end $$;
do $$ begin
  perform public.equipe_enviar((select v from r where k='geral'), 'x', null, '{}', false, '[]',
          '[{"tipo":"planilha","id":"00000000-0000-0000-0000-000000000000"}]'::jsonb);
  raise exception 'FALHOU: tipo inventado passou';
exception when raise_exception then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'ok  tipo de anexo desconhecido é recusado';
end $$;
select pg_temp.ok((select count(*) from equipe_cartoes((select refs from equipe_mensagens where corpo='olhem esse'))) = 2, 'cartões montados para quem pode ver');
select pg_temp.ok((select dados->>'codigo' from equipe_cartoes((select refs from equipe_mensagens where corpo='olhem esse')) where tipo='ticket') is not null, 'cartão do ticket traz o código');
select pg_temp.ok(not exists (select 1 from equipe_cartoes(jsonb_build_array(jsonb_build_object('tipo','atendimento','id',(select v from r where k='atend_fin'))))),
                  'atendimento de outro setor não vira cartão para quem não vê a conversa');
-- Fernanda movida para OUTRO tenant não monta cartão nenhum, mesmo passando os ids na mão
reset role; select set_config('request.jwt.claims', '', true);
update profiles set tenant_id = 'a0000000-0000-0000-0000-00000000beef' where user_id = pg_temp.id('fernanda');
select pg_temp.como('fernanda'); set local role authenticated;
select pg_temp.ok((select count(*) from equipe_cartoes(jsonb_build_array(
    jsonb_build_object('tipo','ticket','id',(select v from r where k='ticket')),
    jsonb_build_object('tipo','cliente','id',(select v from r where k='cliente'))))) = 0, 'outro tenant não lê cartão por id');


-- 16. Anexos: só arquivo da pasta desta conversa
reset role; select set_config('request.jwt.claims', '', true);
update profiles set tenant_id = pg_temp.id('tenant') where user_id = pg_temp.id('fernanda');
-- o que a edge function grava ao entregar o link de upload
insert into r values ('arq', gen_random_uuid());
insert into equipe_uploads (path, tenant_id, canal_id, user_id)
values (pg_temp.id('tenant')::text || '/' || (select v from r where k='geral')::text || '/' || (select v from r where k='arq')::text || '.pdf',
        pg_temp.id('tenant'), (select v from r where k='geral'), pg_temp.id('carla'));
create or replace function pg_temp.arq() returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('path', pg_temp.id('tenant')::text || '/' || (select v from r where k='geral')::text || '/' || (select v from r where k='arq')::text || '.pdf',
                                              'nome', 'Checklist 5.8.pdf', 'mime', 'application/pdf', 'tamanho', 412000)) $$;
select pg_temp.como('carla'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='geral'), '', null, '{}', false, pg_temp.arq())).id is not null;
select pg_temp.ok(true, 'arquivo da pasta do canal é aceito');
do $$ begin
  -- caminho da pasta da DM (outro canal) anexado no #geral
  perform public.equipe_enviar((select v from r where k='geral'), 'x', null, '{}', false,
          jsonb_build_array(jsonb_build_object('path', pg_temp.id('tenant')::text || '/' || (select v from r where k='dm')::text || '/' || gen_random_uuid()::text || '.pdf',
                                               'nome', 'roubado.pdf', 'mime', 'application/pdf', 'tamanho', 10)));
  raise exception 'FALHOU: anexo de outra conversa passou';
exception when raise_exception then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'ok  arquivo de outra conversa é recusado';
end $$;
do $$ begin
  perform public.equipe_enviar((select v from r where k='geral'), 'x', null, '{}', false,
          jsonb_build_array(jsonb_build_object('path', pg_temp.id('tenant')::text || '/' || (select v from r where k='geral')::text || '/../../outro/x.pdf',
                                               'nome', 'x.pdf', 'mime', 'application/pdf', 'tamanho', 10)));
  raise exception 'FALHOU: caminho com .. passou';
exception when raise_exception then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'ok  caminho forjado com .. é recusado';
end $$;
select pg_temp.ok((select previa from equipe_minhas_conversas(pg_temp.id('tenant')) where tipo='geral') = 'Enviou Checklist 5.8.pdf', 'prévia da lista diz o arquivo');
do $$ begin
  -- o mesmo arquivo de novo: foi assim que se "ressuscitava" um arquivo apagado
  perform public.equipe_enviar((select v from r where k='geral'), 'de novo', null, '{}', false, pg_temp.arq());
  raise exception 'FALHOU: arquivo reaproveitado';
exception when raise_exception then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'ok  arquivo já usado não vai em outra mensagem';
end $$;
reset role;
insert into r values ('arq2', gen_random_uuid());
insert into equipe_uploads (path, tenant_id, canal_id, user_id)
values (pg_temp.id('tenant')::text || '/' || (select v from r where k='geral')::text || '/' || (select v from r where k='arq2')::text || '.png',
        pg_temp.id('tenant'), (select v from r where k='geral'), pg_temp.id('carla'));
select pg_temp.como('diego'); set local role authenticated;
do $$ begin
  -- upload da Carla usado pelo Diego
  perform public.equipe_enviar((select v from r where k='geral'), 'x', null, '{}', false,
          jsonb_build_array(jsonb_build_object('path', pg_temp.id('tenant')::text || '/' || (select v from r where k='geral')::text || '/' || (select v from r where k='arq2')::text || '.png',
                                               'nome', 'a.png', 'mime', 'image/png', 'tamanho', 10)));
  raise exception 'FALHOU: arquivo de outra pessoa passou';
exception when raise_exception then
  if sqlerrm like 'FALHOU%' then raise; end if;
  raise notice 'ok  arquivo subido por outra pessoa é recusado';
end $$;
reset role; select pg_temp.como('carla'); set local role authenticated;


-- 17. Avisos (sino + push)
reset role; select set_config('request.jwt.claims', '', true);
create or replace function pg_temp.avisos(p text) returns int language sql as $$
  select count(*)::int from notification_recipients nr join notifications n on n.id = nr.notification_id
   where nr.user_id = pg_temp.id(p) and n.type = 'equipe_mensagem' and nr.read_at is null $$;
delete from notification_recipients where notification_id in (select id from notifications where type = 'equipe_mensagem');
select pg_temp.como('carla'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='dm'), 'primeira')).id is not null;
select (public.equipe_enviar((select v from r where k='dm'), 'segunda')).id is not null;
reset role;
select pg_temp.ok(pg_temp.avisos('diego') = 1, 'rajada na DM vira 1 aviso só');
select pg_temp.ok((select (n.metadata->>'unread_count')::int from notifications n join notification_recipients nr on nr.notification_id = n.id
                    where nr.user_id = pg_temp.id('diego') and n.type='equipe_mensagem') = 2, 'e o aviso conta 2 mensagens');
select pg_temp.ok((select n.body from notifications n join notification_recipients nr on nr.notification_id = n.id
                    where nr.user_id = pg_temp.id('diego') and n.type='equipe_mensagem') = 'Nova mensagem direta', 'o aviso NÃO leva o texto da DM');
select pg_temp.ok(not exists (select 1 from notifications where type='equipe_mensagem'
                               and (body ilike '%segunda%' or body ilike '%primeira%' or title ilike '%segunda%')), 'nenhum aviso guarda texto de mensagem');
select pg_temp.ok(pg_temp.avisos('carla') = 0, 'quem envia não é avisado');
select pg_temp.como('diego'); set local role authenticated;
select public.equipe_marcar_lido((select v from r where k='dm'));
reset role;
select pg_temp.ok(pg_temp.avisos('diego') = 0, 'ler a conversa tira o aviso do sino');
-- silenciou: DM nova não avisa
select pg_temp.como('diego'); set local role authenticated;
select public.equipe_silenciar((select v from r where k='dm'), true);
reset role; select pg_temp.como('carla'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='dm'), 'terceira')).id is not null;
reset role;
select pg_temp.ok(pg_temp.avisos('diego') = 0, 'conversa silenciada não avisa');
-- menção no #geral avisa só o mencionado
select pg_temp.como('carla'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='geral'), 'olha isso @Fernanda Teles', null, array[pg_temp.id('fernanda')])).id is not null;
reset role;
select pg_temp.ok(pg_temp.avisos('fernanda') = 1, 'mencionada é avisada');
select pg_temp.ok((select n.title from notifications n join notification_recipients nr on nr.notification_id = n.id
                    where nr.user_id = pg_temp.id('fernanda') and n.type='equipe_mensagem') = 'Carla Menezes mencionou você em #geral', 'título diz quem e onde');
select pg_temp.ok(pg_temp.avisos('diego') = 0, 'quem não foi mencionado não é avisado');
-- menção em canal privado a quem não está nele: não avisa (nem vazaria o texto)
select pg_temp.como('carla'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='priv'), 'segredo do canal @Diego Souza', null, array[pg_temp.id('diego')])).id is not null;
reset role;
select pg_temp.ok(pg_temp.avisos('diego') = 0, 'menção em canal privado não avisa quem não está nele');
-- resposta no fio avisa quem começou
select pg_temp.como('fernanda'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='geral'), 'respondendo no fio', (select v from r where k='msg'))).id is not null;
reset role;
select pg_temp.ok((select count(*) from notification_recipients nr join notifications n on n.id = nr.notification_id
                    where nr.user_id = pg_temp.id('carla') and n.type='equipe_mensagem' and n.metadata->>'motivo' = 'fio') = 1, 'resposta no fio avisa quem começou');
select pg_temp.como('carla'); set local role authenticated;
select public.equipe_marcar_fio_lido((select v from r where k='msg'));
reset role;
select pg_temp.ok((select count(*) from notification_recipients nr join notifications n on n.id = nr.notification_id
                    where nr.user_id = pg_temp.id('carla') and n.type='equipe_mensagem' and nr.read_at is null and n.metadata->>'motivo' = 'fio') = 0, 'ler o fio tira o aviso do fio');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.fn_equipe_avisar(public.equipe_mensagens)', 'execute'), 'ninguém chama o aviso direto');

-- @todos: vai para o sino sem push (silent_mode)
create temp table entrega_antes as
  select nr.id, nr.delivered_at from notification_recipients nr join notifications n on n.id = nr.notification_id
   where nr.user_id = pg_temp.id('fernanda') and n.type='equipe_mensagem' and n.metadata->>'canal_id' = (select v from r where k='geral')::text;
select pg_temp.como('rodrigo'); set local role authenticated;
select (public.equipe_enviar((select v from r where k='geral'), 'Reunião às 14h @todos', null, '{}', true)).id is not null;
reset role;
select pg_temp.ok((select bool_and(nr.silent_mode) from notification_recipients nr join notifications n on n.id = nr.notification_id
                    where n.type='equipe_mensagem' and n.metadata->>'motivo' = 'todos'
                      and (n.metadata->>'unread_count')::int = 1) is true, '@todos novo vai ao sino sem push');
-- quem já tinha aviso não lido do canal (a menção da Fernanda) só tem o texto atualizado, sem tocar de novo
select pg_temp.ok((select count(*) from entrega_antes) = 1
              and (select nr.delivered_at = a.delivered_at from notification_recipients nr join entrega_antes a on a.id = nr.id),
                  '@todos não faz tocar de novo quem já tinha aviso (delivered_at igual)');
select pg_temp.ok((select count(*) from notification_recipients nr join notifications n on n.id = nr.notification_id
                    where n.type='equipe_mensagem' and n.metadata->>'motivo' = 'todos') >= 5, '@todos chega a todo o tenant');


-- 19. Correções da revisão
reset role; select set_config('request.jwt.claims', '', true);
-- silenciar o canal do setor não vira participação
insert into r select 'suporte', id from equipe_canais where tipo='setor' and department_id = pg_temp.id('suporte');
select pg_temp.como('diego'); set local role authenticated;
select public.equipe_silenciar((select v from r where k='suporte'), true);
reset role;
select pg_temp.ok((select saiu_em is not null from equipe_membros where canal_id=(select v from r where k='suporte') and user_id=pg_temp.id('diego')),
                  'silenciar o setor não cria participação');
-- saiu do canal privado: não edita mais o que escreveu lá
select pg_temp.como('carla'); set local role authenticated;
insert into r select 'msgpriv', (public.equipe_enviar((select v from r where k='priv'), 'vou sair')).id;
select public.equipe_sair((select v from r where k='priv'));
do $$ begin
  perform public.equipe_editar((select v from r where k='msgpriv'), 'editado depois de sair');
  raise exception 'FALHOU: editou depois de sair';
exception when insufficient_privilege then raise notice 'ok  quem saiu do canal privado não edita mais';
end $$;
reset role;
-- auxiliares fechadas
select pg_temp.ok(not has_function_privilege('authenticated', 'public.fn_equipe_participo(uuid,uuid)', 'execute'), 'participo fechada para authenticated');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.fn_equipe_refs_validas(jsonb,uuid)', 'execute'), 'refs_validas fechada para authenticated');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.fn_equipe_anexos_validos(jsonb,uuid,uuid)', 'execute'), 'anexos_validos fechada para authenticated');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.equipe_uploads', 'select'), 'equipe_uploads fechada');
-- canais fora do Realtime
select pg_temp.ok(not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='equipe_canais'), 'equipe_canais fora do Realtime');
-- lista não escreve quando nada mudou
select pg_temp.como('carla'); set local role authenticated;
select count(*) from equipe_minhas_conversas(pg_temp.id('tenant'));
reset role;
create temp table xmin_antes as select id, xmin::text as x from equipe_canais where tenant_id = pg_temp.id('tenant');
select pg_temp.como('carla'); set local role authenticated;
select count(*) from equipe_minhas_conversas(pg_temp.id('tenant'));
reset role;
select pg_temp.ok(not exists (select 1 from equipe_canais c join xmin_antes a on a.id = c.id where c.xmin::text <> a.x), 'abrir a lista de novo não reescreve canal nenhum');

reset role;
do $$ begin raise notice 'SMOKE_OK equipe_chat'; end $$;
ROLLBACK;
