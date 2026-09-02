-- ============================================================================
-- Ativar/Desativar e Bloquear/Desbloquear a licença no OEM, pela ficha do
-- cliente.
--
-- Duas coisas entram aqui:
--
--   1. O REGISTRO de toda tentativa (`oem_estado_licenca_log`).
--   2. O TEXTO da permissão que passa a cobrir os dois botões novos.
--
-- ---------------------------------------------------------------------------
-- 1. POR QUE UM LOG PRÓPRIO, E NÃO UMA COLUNA A MAIS NO LOG DE CADASTRO
-- ---------------------------------------------------------------------------
-- É escrita no sistema do parceiro, numa rota que salva a filial INTEIRA, e
-- desliga o sistema de um cliente real. Sem registro isso não se audita
-- depois. Mesmo desenho da `oem_cadastro_licenca_log` e da
-- `oem_baixa_modulo_log`: guarda a recusa e a simulação também, porque é
-- justamente a recusa que interessa quando alguém pergunta "por que não foi?".
--
-- `bloqueado_antes` / `desativado_antes` vêm do que o PARCEIRO tinha na hora
-- da leitura, não do que o espelho daqui achava. São coisas diferentes quando
-- o espelho está atrasado, e a que importa é a do parceiro.
--
-- `confirmado` é a releitura da licença depois de gravar, e ela é TRÊS
-- ESTADOS de propósito:
--   true  = releu e bate
--   false = releu e não bate  → NÃO quer dizer "falhou". Medido em 28/08/2026:
--           a releitura do parceiro atrasa, e não de forma constante.
--   null  = não deu para reler
-- Nada bloqueia por causa dela; ela marca e deixa à vista.
--
-- ---------------------------------------------------------------------------
-- 2. A PERMISSÃO É A MESMA DE MÓDULOS, POR DECISÃO DO ALEXANDRE
-- ---------------------------------------------------------------------------
-- Quem pode mexer nos módulos do cliente passa a poder ligar e desligar a
-- licença. Não nasce uma chave nova: `clientes.modulos` cobre as duas coisas.
-- O que muda é o texto, para o "?" da tela de Acessos & Permissões dizer o que
-- a chave abrange agora — permissão cujo rótulo mente é pior que permissão
-- inexistente, porque alguém a libera achando que está liberando menos.
-- ============================================================================

begin;

create table if not exists public.oem_estado_licenca_log (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  conta_integration_id uuid,
  cliente_id           uuid,
  empresa_codigo       text,
  filial_codigo        text,
  -- O que a pessoa pediu, com o nome que ela viu no botão.
  acao                 text not null check (acao in ('ativar', 'desativar', 'bloquear', 'desbloquear')),
  bloqueado_antes      boolean,
  bloqueado_depois     boolean,
  desativado_antes     boolean,
  desativado_depois    boolean,
  simulado             boolean not null default false,
  ok                   boolean not null default false,
  http                 integer,
  confirmado           boolean,
  resposta             jsonb,
  usuario_id           uuid,
  criado_em            timestamptz not null default now()
);

comment on table public.oem_estado_licenca_log is
  'Toda tentativa de ligar/desligar ou bloquear/desbloquear uma licença no OEM, inclusive as recusadas e as simuladas. Os campos _antes são o que o parceiro tinha na leitura, não o que o espelho daqui dizia. confirmado é a releitura: false = não deu para confirmar, não "falhou".';

create index if not exists idx_oem_estado_log_tenant_data
  on public.oem_estado_licenca_log (tenant_id, criado_em desc);

create index if not exists idx_oem_estado_log_filial
  on public.oem_estado_licenca_log (filial_codigo)
  where filial_codigo is not null;

alter table public.oem_estado_licenca_log enable row level security;

-- Leitura pelo tenant, como o resto. `or is_super_admin()` não é opcional: sem
-- ele o super admin simulando um tenant não enxerga nada.
drop policy if exists "oem_estado_log_select" on public.oem_estado_licenca_log;
create policy "oem_estado_log_select"
  on public.oem_estado_licenca_log for select
  to authenticated
  using (
    public.is_super_admin()
    or tenant_id in (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );

-- Quem escreve é a edge function, com service_role. Não existe caminho de
-- INSERT pelo navegador de propósito: log que o cliente pode forjar não é log.
grant select on public.oem_estado_licenca_log to authenticated;
grant all    on public.oem_estado_licenca_log to service_role;

-- --------------------------------------------------------------- permissão
update public.resources
   set label = 'Módulos e licença no OEM',
       description = 'Libera os botões de escrita do card Produtos & Módulos: adicionar módulo, editar, inativar, excluir e cancelar. Libera também, na seção OEM do card Integração, os botões Ativar/Desativar e Bloquear/Desbloquear a licença, que agem direto no OEM: desativada, a licença deixa de ser cobrada pelo parceiro; bloqueada, o cliente perde o acesso ao sistema mas a licença continua sendo cobrada.',
       where_it_appears = 'Ficha do cliente > Produtos & Módulos, e Ficha do cliente > Integração > OEM'
 where key = 'clientes.modulos';

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura):
--   select key, label, description from public.resources where key = 'clientes.modulos';
--   select criado_em, filial_codigo, acao, bloqueado_antes, bloqueado_depois,
--          desativado_antes, desativado_depois, simulado, ok, http, confirmado
--     from public.oem_estado_licenca_log order by criado_em desc limit 20;
-- ---------------------------------------------------------------------------
