-- ============================================================================
-- Reconciliação diária do ESTADO da licença no OEM (bloqueio e desativação)
-- ============================================================================
-- A reconciliação que já existia (`v_oem_divergencia_modulo`) compara MÓDULO:
-- ficha do cliente contra o espelho da licença. O estado da licença não tinha
-- conferência nenhuma, e é um estado que o DoctorSaaS MANDA e não controla.
--
-- O caso que abriu isto, em 09/09/2026: a filial 22658 (158 PIZZA & BURGER,
-- Digi Office) foi bloqueada às 08:58, o parceiro respondeu
-- `LicencaBloqueada: true` e a releitura confirmou. Até as 14:06 o bloqueio
-- tinha sido desfeito no OEM, fora do DoctorSaaS: sem gravação nossa, sem linha
-- na fila, sem log. A ficha seguiu afirmando "Bloqueado: Sim" e ninguém tinha
-- como saber que o bloqueio não valia mais. Cliente sem pagar, com o sistema
-- no ar, e a tela dizendo o contrário.
--
-- ---------------------------------------------------------------------------
-- O QUE ESTA VIEW COMPARA, E POR QUE NÃO É "ESPELHO CONTRA ESPELHO"
-- ---------------------------------------------------------------------------
-- Ela compara O QUE O DOCTORSAAS MANDOU (a última ação de estado registrada em
-- `oem_estado_licenca_log`) com O QUE O PARCEIRO MOSTRA na última leitura
-- (`oem_espelho_filial`). Zero chamada à API do OEM.
--
-- A "última ação" é POR DIMENSÃO, não por filial. Bloqueio e desativação são
-- independentes (desativada não cobra, bloqueada cobra): anexar as duas na
-- mesma linha faria um bloqueio recente apagar a conferência de uma
-- desativação anterior que também precisa valer.
--
-- ---------------------------------------------------------------------------
-- ⚠️ A GUARDA DE IDADE É O CORAÇÃO DISTO, E FOI MEDIDA
-- ---------------------------------------------------------------------------
-- `last_sync_oem > pedido_em`: o espelho só acusa se a leitura do parceiro for
-- MAIS NOVA que a ação. Sem isso, toda ação feita depois da última varredura
-- vira alarme: a foto de antes mostra, corretamente, o estado de antes.
--
-- Medido em 09/09/2026 sobre as 36 ações do dia: com a guarda, **1** achado, e
-- ele verdadeiro (a 22658). Sem a guarda, **8** achados, sendo 7 falsos, todos
-- de licença desbloqueada minutos antes cuja varredura ainda não tinha rodado.
-- Alarme que dispara com tudo certo ensina a fechar a notificação sem ler.
--
-- `last_sync_oem > now() - 24h`: mesma escolha da view de módulo. Espelho
-- parado não serve de testemunha contra ninguém.
--
-- ---------------------------------------------------------------------------
-- COMO O ALARME SE CALA SOZINHO, SEM TABELA DE "RECONHECIDO"
-- ---------------------------------------------------------------------------
-- A âncora é a ÚLTIMA ação. Se a pessoa reagir e bloquear de novo, a ação nova
-- vira a âncora e o achado sai da lista quando a próxima varredura confirmar.
-- E se ela aceitar o estado do parceiro, o caminho é clicar a ação contrária:
-- a `oem-licenca-estado` devolve `sem_mudanca`, grava a linha no log do mesmo
-- jeito, e essa linha satisfaz a própria conferência. Aceitar e corrigir usam
-- o registro que já existe, sem inventar um "ignorar" que ninguém revisa.
--
-- `security_invoker = on` como na view de módulo: quem consulta vê pelo RLS
-- dele, não pelo do dono da view. Sem isso a view seria um furo de tenant.
-- ============================================================================

create or replace view public.v_oem_divergencia_estado
with (security_invoker = on) as
with acao as (
  select
    l.tenant_id,
    l.conta_integration_id,
    l.filial_codigo,
    l.cliente_id,
    l.acao,
    l.criado_em as pedido_em,
    l.confirmado,
    case when l.acao in ('bloquear', 'desbloquear') then 'bloqueio' else 'desativacao' end as dimensao,
    row_number() over (
      partition by l.tenant_id, l.filial_codigo,
                   case when l.acao in ('bloquear', 'desbloquear') then 'bloqueio' else 'desativacao' end
      order by l.criado_em desc
    ) as rn
  from public.oem_estado_licenca_log l
  -- Simulação não pede nada ao parceiro, e recusa (`ok = false`) não chegou a
  -- pedir. Nem uma nem outra cria expectativa para conferir.
  where l.simulado = false
    and l.ok = true
), base as (
  select
    a.tenant_id, a.conta_integration_id, a.filial_codigo, a.cliente_id,
    a.dimensao, a.acao, a.pedido_em, a.confirmado,
    e.status as status_oem,
    e.bloqueado as bloqueado_oem,
    e.desativa_em,
    e.last_sync_oem,
    e.nome_fantasia as licenca,
    -- BAIXA VIGENTE, NÃO "TEM DATA". Data vencida não é baixa: ela sobra em
    -- centenas de filiais nunca tocadas, com o módulo seguindo ativo. Foi o que
    -- produziu 81 falsos de 86 na reconciliação de módulo. Mesmo corte do
    -- frontend (`baixaMarcada` em OemLicencaEstadoBotoes.tsx), e no fuso da
    -- operação: às 21h de 30/09 no Brasil o UTC já é 01/10.
    (e.desativa_em is not null
      and e.desativa_em >= (now() at time zone 'America/Sao_Paulo')::date) as baixa_vigente
  from acao a
  join public.oem_espelho_filial e
    on e.filial_codigo = a.filial_codigo
   and e.conta_integration_id = a.conta_integration_id
  where a.rn = 1
    and e.last_sync_oem > a.pedido_em
    and e.last_sync_oem > now() - interval '24 hours'
)
select
  b.tenant_id,
  b.conta_integration_id,
  b.cliente_id,
  c.nome_fantasia as cliente,
  b.filial_codigo,
  b.licenca,
  b.dimensao,
  b.acao,
  b.pedido_em,
  b.confirmado,
  b.status_oem,
  b.bloqueado_oem,
  b.desativa_em,
  b.baixa_vigente,
  b.last_sync_oem,
  case
    -- Bloqueio aplica na hora e se lê direto no `bloqueado`.
    when b.dimensao = 'bloqueio' and b.bloqueado_oem is distinct from (b.acao = 'bloquear')
      then case when b.acao = 'bloquear' then 'bloqueio_nao_vale' else 'desbloqueio_nao_vale' end
    -- DESATIVAR NÃO DESLIGA NA HORA: o OEM agenda a baixa para o fim do mês de
    -- cobrança e mantém a licença de pé (e cobrando) até lá, com o `status`
    -- ainda "AT". Cobrar `status = 'Desativado'` aqui reprovaria toda
    -- desativação certa pelos primeiros 30 dias.
    when b.dimensao = 'desativacao' and b.acao = 'desativar'
      and not (b.status_oem = 'Desativado' or b.baixa_vigente)
      then 'desativacao_nao_vale'
    -- Ativar precisa das duas coisas. Licença de pé com baixa marcada não está
    -- ativa: ela cai na data, e dizer "ativada" seria mentira por até 30 dias.
    when b.dimensao = 'desativacao' and b.acao = 'ativar'
      and not (b.status_oem = 'Ativo' and not b.baixa_vigente)
      then 'ativacao_nao_vale'
  end as tipo
from base b
left join public.clientes c on c.id = b.cliente_id;

comment on view public.v_oem_divergencia_estado is
  'Estado da licença que o DoctorSaaS mandou contra o que o parceiro mostra na última leitura, por dimensão (bloqueio e desativação). Só acusa quando a leitura do espelho é mais nova que a ação. Zero chamada à API do OEM. Ver a migration 20260909213000 para o caso que a originou.';

-- ----------------------------------------------------------------- o alarme
insert into public.notification_event_types
  (key, label, descricao, categoria, default_severity, cooldown_minutes, ativo, whatsapp_extra_only)
values (
  'oem_divergencia_estado',
  'Estado da licença no OEM não bate com o pedido',
  'O DoctorSaaS bloqueou, desbloqueou, ativou ou desativou uma licença no OEM, o parceiro aceitou, e a leitura seguinte mostra a licença em outro estado. Costuma ser mudança feita no portal do parceiro por fora daqui. Enquanto isso a ficha do cliente afirma um estado que não está valendo.',
  'integracao',
  'warning',
  720,
  true,
  false
)
on conflict (key) do nothing;

create or replace function public.fn_oem_alertar_divergencia_estado()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_t       record;
  v_total   int := 0;
  v_tenants int := 0;
begin
  -- Um alerta POR TENANT, como na conferência de módulo. Uma rodada de
  -- bloqueio em massa que não pegou viraria trinta avisos sobre o mesmo fato.
  for v_t in
    select tenant_id,
           count(*)                                                as qtd,
           count(*) filter (where tipo = 'bloqueio_nao_vale')       as bloqueio,
           count(*) filter (where tipo = 'desbloqueio_nao_vale')    as desbloqueio,
           count(*) filter (where tipo = 'desativacao_nao_vale')    as desativacao,
           count(*) filter (where tipo = 'ativacao_nao_vale')       as ativacao
      from public.v_oem_divergencia_estado
     where tipo is not null
     group by tenant_id
  loop
    v_tenants := v_tenants + 1;
    v_total := v_total + v_t.qtd;
    perform public.notify_event(
      v_t.tenant_id,
      'oem_divergencia_estado',
      -- Uma vez por dia por tenant. O cooldown do tipo (720 min) segura o
      -- resto; a chave por dia impede o mesmo dia alertar duas vezes se alguém
      -- rodar a função na mão.
      'oem_diverg_estado:' || v_t.tenant_id::text || ':' ||
        to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
      format('%s licença(s) com estado diferente do que foi pedido ao OEM', v_t.qtd),
      trim(both ' ' from concat_ws(' ',
        case when v_t.bloqueio > 0
             then format('%s continua(m) liberada(s) no parceiro depois de bloqueada(s) aqui, ou seja, o cliente segue usando o sistema.', v_t.bloqueio) end,
        case when v_t.desbloqueio > 0
             then format('%s continua(m) bloqueada(s) no parceiro depois de liberada(s) aqui, ou seja, o cliente está sem acesso.', v_t.desbloqueio) end,
        case when v_t.desativacao > 0
             then format('%s sem a baixa registrada no parceiro depois de desativada(s) aqui.', v_t.desativacao) end,
        case when v_t.ativacao > 0
             then format('%s sem a ativação valendo no parceiro, ou ainda com baixa marcada.', v_t.ativacao) end
      )),
      jsonb_build_object(
        'total', v_t.qtd,
        'bloqueio_nao_vale', v_t.bloqueio,
        'desbloqueio_nao_vale', v_t.desbloqueio,
        'desativacao_nao_vale', v_t.desativacao,
        'ativacao_nao_vale', v_t.ativacao
      ),
      '/configuracoes?tab=integracoes&sub=oem'
    );
  end loop;

  return jsonb_build_object('tenants', v_tenants, 'divergencias', v_total);
end;
$function$;

-- Só o cron chama. `revoke from public` sozinho não restringe nada: os default
-- privileges dão EXECUTE a `authenticated` em toda função nova, e é dele que
-- precisa ser revogado explicitamente.
revoke all on function public.fn_oem_alertar_divergencia_estado() from public;
revoke all on function public.fn_oem_alertar_divergencia_estado() from anon;
revoke all on function public.fn_oem_alertar_divergencia_estado() from authenticated;
grant execute on function public.fn_oem_alertar_divergencia_estado() to service_role;

-- ------------------------------------------------------------------- o cron
-- 09:25 UTC = 06:25 em São Paulo, cinco minutos depois da conferência de
-- módulo, para as duas não caírem no mesmo minuto.
do $$
begin
  perform cron.unschedule('oem-divergencia-estado');
exception when others then
  null;
end $$;

select cron.schedule(
  'oem-divergencia-estado',
  '25 9 * * *',
  $$ select public.fn_oem_alertar_divergencia_estado(); $$
);
