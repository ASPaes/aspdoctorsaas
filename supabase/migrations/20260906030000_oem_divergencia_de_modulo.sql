-- Reconciliação de módulos DS × OEM
--
-- POR QUE ELA EXISTE
-- Em 03/09/2026 três cancelamentos na DEGUST CONCEITO voltaram `ok` com HTTP
-- 200 e nenhum ficou de pé no parceiro: cada gravação na filial apagava a
-- `datavalidade` que a anterior tinha registrado. O defeito foi corrigido nos
-- dois caminhos (uma gravação por filial, e reafirmar os cancelados em vez de
-- ecoar a leitura), mas nada no sistema era capaz de PERCEBER a divergência.
-- Ela só apareceu porque um cliente reclamou.
--
-- Esta é a rede embaixo dos dois consertos. Ela não conserta nada: ela avisa.
--
-- Custo: zero chamada ao parceiro. Compara a ficha com o espelho, que já é
-- atualizado de 6 em 6 horas pelo cron `oem-espelho-atualizar`.

-- ---------------------------------------------------------------- o evento
insert into public.notification_event_types (key, label, descricao, categoria, default_severity, cooldown_minutes)
values (
  'oem_divergencia_modulo',
  'Módulo divergente entre DoctorSaaS e OEM',
  'A ficha do cliente e a licença do parceiro discordam sobre um módulo: cobrança que continua depois do cancelamento, módulo pago que caiu no OEM, ou quantidade diferente.',
  'integracao', 'warning', 720
)
on conflict (key) do nothing;

-- ------------------------------------------------------------------ a view
--
-- Uma linha por (produto do cliente × módulo) em que os dois lados discordam.
create or replace view public.v_oem_divergencia_modulo as
with ficha as (
  -- O estado do módulo na ficha, JÁ RESOLVIDO por módulo.
  --
  -- ⚠️ Um módulo pode ter várias linhas: cancelar e vender de novo deixa a
  -- velha cancelada e a nova ativa. Olhar linha a linha diria "cancelado" para
  -- um cliente que voltou a pagar — foi por um triz na NECTAR DA SERRA VALEMAR
  -- em 28/08/2026 (IFood a R$ 48, cancelado como erro de lançamento, reativado
  -- a R$ 18 no mesmo dia). Vivo vence cancelado, e é por isso que se agrupa.
  select cp.tenant_id,
         cp.id                       as cliente_produto_id,
         cp.cliente_id,
         cp.oem_codigo_filial        as filial_codigo,
         cpm.oem_modulo_codigo       as codigo,
         sum(case when cpm.ativo then greatest(coalesce(cpm.quantidade, 1), 1) else 0 end) as qtd_ficha,
         bool_or(cpm.ativo)          as vivo_na_ficha,
         bool_or(coalesce(cpm.cancelado_manual, false) and not cpm.ativo) as cancelado_na_ficha,
         max(cpm.data_inativacao) filter (where not cpm.ativo) as cancelado_em,
         -- ⚠️ O NOME VEM DAQUI, do módulo que a ficha de fato aponta.
         -- Buscá-lo lá fora por (produto × código do OEM) MULTIPLICA a linha,
         -- porque o catálogo tem mais de um módulo com o mesmo código: em
         -- "PDV Legal - Raspberry" existem `Licença PDV` e `PDV/Comandas`, os
         -- dois com código 10. A primeira versão desta view anunciou 14
         -- divergências onde havia 12, e as duas sobrando eram a mesma linha
         -- com dois nomes.
         min(pmf.nome)               as modulo
    from public.cliente_produto_modulos cpm
    join public.cliente_produtos cp on cp.id = cpm.cliente_produto_id
    left join public.produto_modulos pmf on pmf.id = cpm.modulo_id
   where cpm.oem_modulo_codigo is not null
     and cp.oem_codigo_filial is not null
   group by 1, 2, 3, 4, 5
),
licenca as (
  select e.tenant_id,
         e.filial_codigo,
         e.conta_integration_id,
         e.last_sync_oem,
         -- A baixa da LICENÇA inteira, quando existe. Ela carimba a mesma data
         -- em todos os módulos, e sem isto uma desativação pedida de propósito
         -- viraria uma divergência por módulo — medido na BEDA PIZZARIA, que
         -- foi desativada em 01/09/2026 para cair em 30/09.
         e.desativa_em,
         (m->>'codigo')::int                          as codigo,
         coalesce((m->>'ativo')::boolean, true)        as ativo_no_oem,
         coalesce((m->>'quantidade')::numeric, 0)      as qtd_oem,
         -- É ela, e não `ativo`, que desliga o módulo para o cliente.
         nullif(m->>'datavalidade', '')::timestamptz   as baixa_em,
         -- ⚠️ SÓ DATA FUTURA É BAIXA. Medido em 28/08/2026: `datavalidade`
         -- existe em centenas de filiais nunca tocadas, com datas de 2025 em
         -- diante, e os módulos seguem ativos com a data vencida. Ali é campo
         -- de rotina, não baixa agendada.
         --
         -- Isto não é teoria: a primeira versão desta view, sem a comparação
         -- com `now()`, acusou 86 divergências — e 81 delas eram exatamente
         -- essas datas velhas, em 79 filiais, indo de 28/02/2025 a 31/08/2026.
         -- Teria nascido gritando sobre clientes que estão certos.
         --
         -- ⚠️ O `coalesce` fica POR FORA da expressão inteira, e não é
         -- preciosismo: sem data, `data > now()` é NULL, `false or NULL` é
         -- NULL, e `not NULL` reprova OS DOIS lados da classificação em
         -- silêncio. Medido: com o NULL solto, as 12 divergências de
         -- quantidade sumiram do resultado e a view anunciou "está tudo certo".
         -- É o mesmo NULL que já abriu portão de permissão neste projeto.
         coalesce(nullif(m->>'datavalidade', '')::timestamptz > now(), false) as baixa_futura
    from public.oem_espelho_filial e
    cross join lateral jsonb_array_elements(e.modulos) m
   where jsonb_typeof(e.modulos) = 'array'
)
select f.tenant_id,
       f.cliente_id,
       f.cliente_produto_id,
       f.filial_codigo,
       f.codigo,
       f.modulo,
       c.nome_fantasia        as cliente,
       l.conta_integration_id,
       l.last_sync_oem,
       f.qtd_ficha, f.vivo_na_ficha, f.cancelado_na_ficha, f.cancelado_em,
       l.qtd_oem, l.ativo_no_oem, l.baixa_em, l.baixa_futura,
       case
         -- 1. Cancelado aqui e vivo lá: o cliente segue sendo cobrado.
         --    "Vivo lá" precisa das DUAS metades: ativo E sem baixa marcada.
         --    Só `not baixa_futura` acusaria um módulo que o OEM já desligou —
         --    aconteceu com o IFood da CAMPINA VERDE, em que os dois lados
         --    concordam e a view dizia que não.
         when f.cancelado_na_ficha and not f.vivo_na_ficha
              and l.ativo_no_oem and not l.baixa_futura
           then 'cancelado_ativo_no_oem'
         -- 2. Vivo aqui e INATIVO lá: o cliente perde um módulo que paga.
         --    Vira reclamação, não prejuízo, e por isso conta tanto quanto.
         --
         --    ⚠️ Repare que aqui é `not ativo_no_oem`, e não `desligado_no_oem`.
         --    Data futura no módulo NÃO significa que ele vai morrer: o OEM
         --    aplica tudo no fim do mês de cobrança, então uma redução de 5
         --    para 4 aparece como quantidade 5 com data 30/09 até virar o mês.
         --    Tratar isso como perda pintaria de vermelho uma gravação certa —
         --    conclusão errada que já foi tirada duas vezes neste projeto, em
         --    28/08 e 05/09/2026, e derrubada pelo dado nas duas.
         --
         --    E fora quando a data é a da baixa da LICENÇA: aí não é
         --    divergência, é a desativação que alguém pediu, e ela carimba
         --    todos os módulos de uma vez.
         when f.vivo_na_ficha and not l.ativo_no_oem
              and l.baixa_em::date is distinct from l.desativa_em
           then 'ativo_desligado_no_oem'
         -- 3. Os dois vivos, contando diferente E SEM NADA AGENDADO.
         --    Com data futura, a diferença é esperada: é a mudança que ainda
         --    não virou o mês. Cobrar coerência antes da data é alarme falso.
         when f.vivo_na_ficha and l.ativo_no_oem and not l.baixa_futura
              and f.qtd_ficha <> l.qtd_oem
           then 'quantidade_divergente'
       end as tipo
  from ficha f
  join licenca l
    on l.tenant_id = f.tenant_id
   and l.filial_codigo = f.filial_codigo
   and l.codigo = f.codigo
  left join public.clientes c on c.id = f.cliente_id
 where
   -- O código 8 é o produto da licença, não um módulo: ele não se cancela nem
   -- se conta, e compará-lo só produziria ruído.
   f.codigo <> 8
   -- ⚠️ ESPELHO VELHO NÃO É DIVERGÊNCIA. Ele é uma cópia de uma tabela do
   -- DoctorOEM, não uma leitura ao vivo do parceiro; parado, ele acusaria como
   -- erro tudo o que foi feito depois da última carga.
   and l.last_sync_oem > now() - interval '24 hours'
   -- Nem escrita que o espelho ainda não pôde ter visto. A leitura do parceiro
   -- atrasa (medido em 28/08/2026: um cancelamento de 4 para 3 foi aceito, a
   -- releitura devolveu 4, e o portal já mostrava 3), então cobrar coerência
   -- antes da próxima carga é fabricar alarme.
   and not exists (
     select 1 from public.oem_sync_fila q
      where q.cliente_produto_id = f.cliente_produto_id
        and q.oem_modulo_codigo = f.codigo
        and (q.status in ('pendente', 'processando', 'erro', 'aguardando_aprovacao')
             or q.processado_em > l.last_sync_oem)
   );

comment on view public.v_oem_divergencia_modulo is
  'Módulos em que a ficha do cliente e a licença do OEM discordam. Só linhas com `tipo` preenchido são divergência; o resto está de acordo.';

-- --------------------------------------------------------------- o alerta
create or replace function public.fn_oem_alertar_divergencia_modulo()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t      record;
  v_total  int := 0;
  v_tenants int := 0;
begin
  -- Um alerta POR TENANT, não um por módulo. Uma gravação errada numa filial
  -- com dez módulos viraria dez avisos sobre o mesmo fato, e é assim que se
  -- ensina alguém a fechar a notificação sem ler.
  for v_t in
    select tenant_id,
           count(*) as qtd,
           count(*) filter (where tipo = 'cancelado_ativo_no_oem')  as cobrando_cancelado,
           count(*) filter (where tipo = 'ativo_desligado_no_oem')  as perdeu_modulo,
           count(*) filter (where tipo = 'quantidade_divergente')   as qtd_diferente
      from public.v_oem_divergencia_modulo
     where tipo is not null
     group by tenant_id
  loop
    v_tenants := v_tenants + 1;
    v_total := v_total + v_t.qtd;
    perform public.notify_event(
      v_t.tenant_id,
      'oem_divergencia_modulo',
      -- Uma vez por dia por tenant. O cooldown do tipo (720 min) segura o
      -- resto; a chave por dia é o que impede o mesmo dia alertar duas vezes
      -- se alguém rodar a função na mão.
      'oem_diverg_modulo:' || v_t.tenant_id::text || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
      format('%s módulo(s) divergentes entre o DoctorSaaS e o OEM', v_t.qtd),
      trim(both ' ' from concat_ws(' ',
        case when v_t.cobrando_cancelado > 0
             then format('%s continua(m) sendo cobrado(s) no OEM depois de cancelado(s) aqui.', v_t.cobrando_cancelado) end,
        case when v_t.perdeu_modulo > 0
             then format('%s está(ão) desligado(s) no OEM mas ativo(s) na ficha, ou seja, o cliente perdeu o que paga.', v_t.perdeu_modulo) end,
        case when v_t.qtd_diferente > 0
             then format('%s com quantidade diferente entre os dois.', v_t.qtd_diferente) end
      )),
      jsonb_build_object(
        'total', v_t.qtd,
        'cobrando_cancelado', v_t.cobrando_cancelado,
        'perdeu_modulo', v_t.perdeu_modulo,
        'quantidade_divergente', v_t.qtd_diferente
      ),
      '/configuracoes?tab=integracoes&sub=oem'
    );
  end loop;

  return jsonb_build_object('tenants', v_tenants, 'divergencias', v_total);
end;
$function$;

revoke all on function public.fn_oem_alertar_divergencia_modulo() from public;
-- ⚠️ Sem este REVOKE de `authenticated` a função continua executável por
-- qualquer usuário logado: os default privileges do banco já dão EXECUTE, e
-- `revoke from public` sozinho não alcança isso.
revoke all on function public.fn_oem_alertar_divergencia_modulo() from authenticated;
grant execute on function public.fn_oem_alertar_divergencia_modulo() to service_role;

-- ------------------------------------------------------------------ o cron
-- Uma vez por dia, 06:20 em São Paulo (09:20 UTC). Depois da carga das 6h do
-- espelho (`17 */6 * * *`) e antes de a operação começar, para o aviso chegar
-- com o dia inteiro pela frente em vez de no fim do expediente.
select cron.unschedule('oem-divergencia-modulo')
 where exists (select 1 from cron.job where jobname = 'oem-divergencia-modulo');

select cron.schedule(
  'oem-divergencia-modulo',
  '20 9 * * *',
  $cron$ select public.fn_oem_alertar_divergencia_modulo(); $cron$
);
