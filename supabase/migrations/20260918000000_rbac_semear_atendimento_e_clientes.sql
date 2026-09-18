-- ============================================================================
-- RBAC — semeadura das 35 permissões de Atendimento e Clientes
--
-- Esta migration é INERTE: nenhuma tela consulta estas chaves ainda. Ela existe
-- para que, quando os portões entrarem, cada chave JÁ ESTEJA com o valor que
-- reproduz o acesso de hoje. A ordem inversa (portão antes da semeadura) nega
-- em massa — é a armadilha R12 do plano.
--
-- As três fontes de valor, levantadas item a item contra o código em 17/09:
--   A. TELA SEM RESTRIÇÃO HOJE  -> liga para os três papéis.
--   B. HOJE É `admin ou gestor` -> liga admin e head, desliga user.
--   C. HOJE É SÓ `admin`        -> liga só admin.
--   D. HOJE HERDA OUTRA CHAVE   -> copia linha a linha daquela chave, inclusive
--      os ajustes por empresa (senão a conta muda para quem tem exceção).
--
-- FICAM DE FORA, de propósito:
--   · `atendimento_chat` e `tickets` já têm portão (rota + menu). Não se semeia
--     o que já responde — mexer ali mudaria acesso de verdade.
--   · `clientes.oem_aprovacao` tem portão próprio no banco com exceção POR
--     PESSOA (`user_permissions`). Semear por papel apagaria as exceções.
-- ============================================================================
begin;

-- ---------------------------------------------------------------- A) abertas
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select p.role, k.key, true, false, false, false
  from (values ('admin'),('head'),('user')) as p(role)
 cross join (values
   -- Clientes: abas e seções que hoje aparecem para qualquer um que abre o módulo
   ('fin.movimentos'), ('clientes.reajuste'), ('clientes.dados'), ('clientes.contatos'),
   ('clientes.venda_produto'), ('clientes.contratos'), ('clientes.parametros_atendimento'),
   ('clientes.tickets'), ('clientes.filiais'), ('clientes.integracao'),
   -- Chat: o trabalho do atendimento, hoje sem nenhuma restrição
   ('atendimento_filtros'), ('atendimento_transferir'), ('atend.assumir'), ('atend.enviar'),
   ('atend.agendar'), ('atend.encaminhar'), ('atend.historico_terceiros'),
   ('atend.acesso_remoto'), ('atend.contatos'), ('atend.busca'),
   -- Tickets: idem
   ('tickets.criar'), ('tickets.editar'), ('tickets.encerrar'), ('tickets.reabrir'),
   ('tickets.transferir'), ('tickets.anexos'), ('tickets.mencoes')
 ) as k(key)
on conflict (role, resource_key) do nothing;

-- ------------------------------------------------- B) hoje é admin ou gestor
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select p.role, k.key, p.role in ('admin','head'), false, false, false
  from (values ('admin'),('head'),('user')) as p(role)
 cross join (values
   ('clientes.divergencias_hiper'), ('clientes.cadastro_incompleto'),
   ('clientes.cancelar'), ('tickets.excluir')
 ) as k(key)
on conflict (role, resource_key) do nothing;

-- ------------------------------------------------------------ C) hoje só admin
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select p.role, 'clientes.purge', p.role = 'admin', false, false, false
  from (values ('admin'),('head'),('user')) as p(role)
on conflict (role, resource_key) do nothing;

-- -------------------------------------------------- D) herdam outra chave
-- `clientes.ficha` responde como `clientes` (a ficha é aberta por quem abre o
-- módulo) e `clientes.financeiro` como `clientes.custos` (o card já some hoje
-- para quem não tem custos). Copia padrão global E ajuste por empresa.
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, d.destino, rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
  from (values ('clientes','clientes.ficha'), ('clientes.custos','clientes.financeiro')) as d(origem, destino)
  join public.role_permissions rp on rp.resource_key = d.origem
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, d.destino, trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from (values ('clientes','clientes.ficha'), ('clientes.custos','clientes.financeiro')) as d(origem, destino)
  join public.tenant_role_permissions trp on trp.resource_key = d.origem
on conflict (tenant_id, role, resource_key) do nothing;

-- -------------------------------- valor MORTO que viraria restrição de verdade
-- `atendimento_filtros` e `atendimento_transferir` são chaves ANTIGAS que já
-- tinham valor guardado dizendo "operador: não" — no padrão global e em 9
-- empresas. Só que NENHUMA linha de código jamais leu esse valor: o botão de
-- Filtros e o de Transferir sempre apareceram para todo mundo (confirmado no
-- código em 17/09: ConversationFiltersPopover e QueueIndicator não consultam
-- permissão nenhuma).
--
-- Ligar o portão sem mexer nisso faria um valor que nunca teve efeito virar
-- restrição real da noite para o dia, em 9 empresas. É a mesma regra que já
-- usamos ao fundir duplicatas: chave sem portão → o valor guardado é descartado,
-- vale o que a tela faz. Quem quiser restringir agora tem a chave na mão.
update public.role_permissions
   set can_view = true
 where role = 'user' and resource_key in ('atendimento_filtros','atendimento_transferir')
   and can_view = false;

update public.tenant_role_permissions
   set can_view = true
 where role = 'user' and resource_key in ('atendimento_filtros','atendimento_transferir')
   and can_view = false;

-- ------------------------------------------- motor v2: mesma conta, por grupo
-- O grupo já tem linha para quase tudo (semeadura pela âncora, em 070000). Onde
-- faltar, entra o valor que o papel base acabou de receber — assim os dois
-- motores respondem igual no dia da publicação.
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, rp.resource_key,
       coalesce(trp.can_view, rp.can_view, false), false, false, false
  from public.permission_groups g
  join public.role_permissions rp
    on rp.role = g.nivel_base
   and rp.resource_key in (
     'fin.movimentos','clientes.reajuste','clientes.dados','clientes.contatos',
     'clientes.venda_produto','clientes.contratos','clientes.parametros_atendimento',
     'clientes.tickets','clientes.filiais','clientes.integracao','clientes.ficha',
     'clientes.financeiro','clientes.divergencias_hiper','clientes.cadastro_incompleto',
     'clientes.cancelar','clientes.purge',
     'atendimento_filtros','atendimento_transferir','atend.assumir','atend.enviar',
     'atend.agendar','atend.encaminhar','atend.historico_terceiros','atend.acesso_remoto',
     'atend.contatos','atend.busca',
     'tickets.criar','tickets.editar','tickets.encerrar','tickets.reabrir',
     'tickets.excluir','tickets.transferir','tickets.anexos','tickets.mencoes')
  left join public.tenant_role_permissions trp
    on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = rp.resource_key
on conflict (group_id, resource_key) do nothing;

-- ⚠️ CORREÇÃO QUE O TESTE PEGOU (17/09, antes de publicar):
-- as empresas já no motor v2 (ASP e Digi Office) receberam ontem, na semeadura
-- por âncora, linhas de grupo com `false` para estas chaves — porque a âncora
-- delas (`tickets`, `nav.chat`) ainda não tinha valor naquele instante. O
-- `insert ... do nothing` acima não conserta linha que já existe, então o
-- Operador da ASP ficaria SEM 10 ações que hoje ele faz: filtros, transferir,
-- Movimentos MRR, criar/editar/encerrar/reabrir/transferir ticket, anexos e
-- menções.
--
-- Aqui a linha de grupo é alinhada ao valor de HOJE (ajuste da empresa, senão
-- padrão global). Só SOBE de `false` para `true`: nunca tira acesso de ninguém,
-- porque reduzir é decisão do admin na tela, não de migration.
update public.group_permissions gp
   set can_view = true, updated_at = now()
  from public.permission_groups g
 where g.id = gp.group_id
   and gp.can_view = false
   and gp.resource_key in (
     'fin.movimentos','clientes.reajuste','clientes.dados','clientes.contatos',
     'clientes.venda_produto','clientes.contratos','clientes.parametros_atendimento',
     'clientes.tickets','clientes.filiais','clientes.integracao','clientes.ficha',
     'clientes.financeiro','clientes.divergencias_hiper','clientes.cadastro_incompleto',
     'clientes.cancelar','clientes.purge',
     'atendimento_filtros','atendimento_transferir','atend.assumir','atend.enviar',
     'atend.agendar','atend.encaminhar','atend.historico_terceiros','atend.acesso_remoto',
     'atend.contatos','atend.busca',
     'tickets.criar','tickets.editar','tickets.encerrar','tickets.reabrir',
     'tickets.excluir','tickets.transferir','tickets.anexos','tickets.mencoes')
   and coalesce(
        (select trp.can_view from public.tenant_role_permissions trp
          where trp.tenant_id = g.tenant_id and trp.role = g.nivel_base
            and trp.resource_key = gp.resource_key),
        (select rp.can_view from public.role_permissions rp
          where rp.role = g.nivel_base and rp.resource_key = gp.resource_key),
        false) = true;

-- ⚠️ SEGUNDA CORREÇÃO QUE O TESTE PEGOU: grupo ACIMA da realidade.
-- A semeadura por âncora de ontem deu `true` a ações que hoje são restritas por
-- papel, porque copiou o valor da tela-mãe (`clientes` = todos entram) para
-- ações que ficam DENTRO dela e têm régua própria. São 94 linhas em 14 empresas:
-- operador com "Cancelar cliente" e "Excluir tudo", gestor com "Excluir tudo".
-- Hoje isso é inofensivo (nenhuma tela lê estas chaves); com o portão ligado,
-- viraria ACESSO NOVO — o operador da ASP poderia cancelar contrato amanhã.
--
-- Conferido antes de mexer: `permission_audit` não tem NENHUMA edição manual
-- nestas chaves (0 linhas com `changed_by`). Ninguém decidiu isso — então
-- alinhar para baixo restaura a realidade, não desfaz escolha de admin.
update public.group_permissions gp
   set can_view = false, can_insert = false, can_update = false, can_delete = false, updated_at = now()
  from public.permission_groups g
 where g.id = gp.group_id
   and gp.can_view
   and gp.resource_key in ('clientes.divergencias_hiper','clientes.cadastro_incompleto',
                           'clientes.cancelar','clientes.purge','clientes.financeiro','tickets.excluir')
   and coalesce(
        (select trp.can_view from public.tenant_role_permissions trp
          where trp.tenant_id = g.tenant_id and trp.role = g.nivel_base
            and trp.resource_key = gp.resource_key),
        (select rp.can_view from public.role_permissions rp
          where rp.role = g.nivel_base and rp.resource_key = gp.resource_key),
        false) = false
   and not exists (select 1 from public.permission_audit pa
                    where pa.group_id = gp.group_id and pa.resource_key = gp.resource_key
                      and pa.changed_by is not null);

commit;
