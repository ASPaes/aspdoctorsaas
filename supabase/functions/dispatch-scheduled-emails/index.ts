import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

/**
 * Motor do e-mail agendado (16/09/2026, mockup "E-mail etapa 2" aprovado).
 *
 * O pg_cron chama a cada minuto. Pega os vencidos (fn_email_agendados_pegar,
 * que marca 'enviando' com skip locked: duas execuções nunca pegam o mesmo) e
 * manda cada um pela send-email, como chamada interna em nome de quem agendou.
 * A send-email é a porta única de saída: assinatura, anexos, conversa completa,
 * registro em email_envios e apagar o anexo temporário continuam sendo dela.
 *
 * A permissão de conta foi conferida no agendamento (fn_email_agendar); aqui a
 * chamada é interna e a send-email não refaz essa conferência.
 *
 * verify_jwt = true, como os outros crons: o portão é o JWT do projeto.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** por execução; o resto fica para o minuto seguinte */
const LOTE = 20;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: lote, error } = await supabase.rpc('fn_email_agendados_pegar', { p_limite: LOTE });
  if (error) {
    console.error(`[dispatch-scheduled-emails] fila não lida: ${error.message}`);
    return json(500, { ok: false, error: error.message });
  }

  let enviados = 0;
  let falhas = 0;

  for (const a of lote ?? []) {
    let ok = false;
    let erro: string | null = null;
    let envioId: string | null = null;

    try {
      const resposta = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: a.tenant_id,
          enviado_por: a.agendado_por,
          account_id: a.account_id,
          to: a.para,
          cc: a.cc,
          bcc: a.cco,
          subject: a.assunto,
          text: a.texto ?? undefined,
          html: a.html ?? undefined,
          historico_html: a.historico_html ?? undefined,
          historico_texto: a.historico_texto ?? undefined,
          origem: a.origem,
          referencia_id: a.referencia_id,
          cliente_id: a.cliente_id,
          department_id: a.department_id,
          anexos: a.anexos,
        }),
      });
      const saida = await resposta.json().catch(() => ({}));
      ok = resposta.ok && saida?.ok === true;
      envioId = saida?.envio_id ?? null;
      if (!ok) erro = String(saida?.mensagem || saida?.error || `A send-email respondeu ${resposta.status}.`);
    } catch (e) {
      erro = `Não foi possível falar com a send-email: ${e instanceof Error ? e.message : String(e)}`;
    }

    const { error: fimErr } = await supabase.rpc('fn_email_agendado_finalizar', {
      p_id: a.id,
      p_ok: ok,
      p_erro: erro,
      p_envio_id: envioId,
    });
    if (fimErr) console.error(`[dispatch-scheduled-emails] ${a.id} ${ok ? 'saiu' : 'falhou'} mas não foi marcado: ${fimErr.message}`);

    if (ok) enviados++;
    else {
      falhas++;
      console.error(`[dispatch-scheduled-emails] ${a.id} não saiu: ${erro}`);
    }
  }

  return json(200, { ok: true, processados: (lote ?? []).length, enviados, falhas });
});
