-- ============================================================================
-- Fora do horario: liberar para a fila na abertura do setor — 2/3, a varredura
-- (06/09/2026)  Ver o arquivo 1/3 para o porque.
--
-- A funcao nao atribui ninguem. Ela so apaga `opened_out_of_hours`, que e o
-- unico motivo de o chat estar na aba laranja em vez da Fila.
--
-- As quatro guardas, e o que cada uma evita:
--
-- 1) So setor com a flag ligada e ativo. Com a flag `false` em todo mundo (o
--    padrao), a varredura le support_departments e termina sem tocar em
--    conversa nenhuma.
--
-- 2) So dentro da janela do dia (`fn_expediente_janela_do_dia`, a mesma cascata
--    de setor > tenant > feriado que o resto do sistema usa). Sem isso a
--    varredura das 20h "liberaria" o chat que acabou de chegar fora do horario.
--    A janela e do primeiro inicio ao ultimo fim: o intervalo de almoco NAO
--    fecha o setor, e chat nenhum volta para o laranja no meio do dia.
--
-- 3) So conversa com atendimento `waiting`. Esta e a guarda que impede o chat
--    de SUMIR: getConversationBucket devolve 'closed' para conversa sem
--    atendimento (conversationBucket.ts:53), entao limpar a flag de uma
--    conversa orfa a tiraria da aba laranja e a jogaria em "Encerrados", nao na
--    Fila. Atendimento `in_progress` tambem fica de fora — esse ja tem dono e o
--    trg_clear_out_of_hours_on_assign ja limpou a flag.
--
-- 4) So o ciclo recente (4 dias). Medido em producao em 06/09/2026: dos 30
--    chats parados no laranja, 6 da Digi Office tem mais de 7 dias, um da Feax
--    e de 27/06 e um da DEMO e de 24/10/2025. Ressuscitar isso na Fila seria
--    pior que o problema. 4 dias cobre sexta 18h -> segunda 08h (62h) e uma
--    segunda de feriado (86h); feriadao mais longo simplesmente nao e liberado
--    sozinho, que e a direcao segura — nada se perde, o chat continua na aba.
--
-- Grupo fica de fora: o ciclo de atendimento em grupo e outro e nao passa por
-- esta fila. Conversa sem `department_id` tambem — sem setor nao ha horario de
-- abertura para acionar, e ela continua na aba.
-- ============================================================================
begin;

create or replace function public.fn_release_off_hours_on_open()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_dept        record;
  v_abre        time;
  v_fecha       time;
  v_agora       time;
  v_n           integer;
  v_liberados   integer := 0;
  v_setores     integer := 0;
  -- Guarda 4: teto do ciclo. Ver o cabecalho.
  v_ciclo_max   constant interval := interval '4 days';
begin
  for v_dept in
    select d.id,
           d.tenant_id,
           coalesce(c.business_hours_timezone, 'America/Sao_Paulo') as tz
      from public.support_departments d
      left join public.configuracoes c on c.tenant_id = d.tenant_id
     where d.is_active = true
       and d.off_hours_release_to_queue = true
  loop
    select j.abre, j.fecha
      into v_abre, v_fecha
      from public.fn_expediente_janela_do_dia(v_dept.tenant_id, v_dept.id, now()) j;

    -- Guarda 2a: hoje nao tem expediente (fim de semana, feriado fechado).
    continue when v_abre is null or v_fecha is null;

    v_agora := (now() at time zone v_dept.tz)::time;

    -- Guarda 2b: ainda nao abriu, ou o dia ja fechou.
    continue when v_agora < v_abre or v_agora >= v_fecha;

    update public.whatsapp_conversations c
       set opened_out_of_hours   = false,
           out_of_hours_cleared_at = now(),
           updated_at            = now()
     where c.tenant_id       = v_dept.tenant_id
       and c.department_id   = v_dept.id
       and c.opened_out_of_hours = true
       and coalesce(c.is_group, false) = false
       and c.status not in ('closed', 'inactive_closed')
       -- Guarda 4
       and c.opened_out_of_hours_at is not null
       and c.opened_out_of_hours_at >= now() - v_ciclo_max
       -- Guarda 3
       and exists (
         select 1
           from public.support_attendances sa
          where sa.conversation_id = c.id
            and sa.status = 'waiting'
       );

    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_liberados := v_liberados + v_n;
      v_setores   := v_setores + 1;
      raise log '[release_off_hours] setor % (tenant %): % chat(s) liberados para a fila',
        v_dept.id, v_dept.tenant_id, v_n;
    end if;
  end loop;

  return jsonb_build_object('liberados', v_liberados, 'setores', v_setores);
end;
$function$;

comment on function public.fn_release_off_hours_on_open() is
  'Tira da aba "Fora do horario" e devolve para a Fila os chats que chegaram fora do expediente, quando o setor abre. Nao atribui ninguem: so limpa opened_out_of_hours. Roda pelo cron release-off-hours-on-open.';

-- REVOKE de authenticated e obrigatorio: o default privilege do banco ja da
-- EXECUTE para authenticated em toda funcao nova, entao REVOKE FROM PUBLIC
-- sozinho nao restringe nada.
revoke all on function public.fn_release_off_hours_on_open() from public;
revoke all on function public.fn_release_off_hours_on_open() from authenticated;
grant execute on function public.fn_release_off_hours_on_open() to service_role;

commit;
