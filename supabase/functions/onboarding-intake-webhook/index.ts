// onboarding-intake-webhook — recebe a proposta finalizada no sistema comercial
// externo e cria, numa unica transacao, cliente + contrato + modulos + jornada
// (ou movimento de MRR, ou cobranca avulsa, ou so a jornada).
//
// Autenticacao: x-webhook-secret comparado a ONBOARDING_INTAKE_SECRET.
// verify_jwt=false declarado no config.toml: quem chama e servidor de terceiro.
//
// A REGRA QUE ORGANIZA TUDO: o payload e gravado em onboarding_intake_log ANTES
// de qualquer validacao, numa chamada separada da RPC. Se a transacao da RPC
// falhar, o rollback nao alcanca essa linha — nenhuma proposta se perde, nem as
// recusadas.
//
// A chave unica (tenant_id, external_ticket_id) faz o reenvio ser seguro: clique
// duplo do vendedor, retentativa de rede ou replay devolvem o que ja foi criado,
// em vez de duplicar cliente e contrato (e o MRR junto).
//
// A versao anterior desta function (v59, no ar desde 11/07/2026) NUNCA pode ter
// funcionado: ela chamava create_onboarding_journey com service_role, e a guarda
// can_access_tenant_row devolve false para service_role. Era codigo morto. Por
// isso o formato antigo de payload nao foi preservado aqui.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Chaves ordenadas recursivamente. O payload guardado e jsonb, que o Postgres ja
// normaliza (reordena chave, remove duplicata); comparar assim evita acusar
// alteracao so porque o JSON chegou noutra ordem.
function canonico(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonico).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canonico(v[k])).join(',') + '}';
}

// Qual bloco financeiro veio. Espelha a decisao da fn_intake_proposta; serve so
// para rotular o log — quem decide de verdade e a RPC.
function modoDoPayload(body: any): string {
  if (Array.isArray(body?.produtos) && body.produtos.length > 0) return 'venda_nova';
  if (body?.alteracao) return 'alteracao';
  if (body?.avulso) return 'avulso';
  return 'jornada';
}

// A RPC levanta excecao com um JSON na mensagem, para caber a lista inteira de
// problemas numa resposta so. Um erro por chamada obrigaria o vendedor a
// descobrir os campos errados de um em um.
function traduzErro(msg: string): { status: number; body: Record<string, unknown> } {
  let parsed: any = null;
  const inicio = msg.indexOf('{');
  if (inicio >= 0) {
    try { parsed = JSON.parse(msg.slice(inicio)); } catch { /* nao era JSON nosso */ }
  }
  if (!parsed?.error) {
    return { status: 500, body: { ok: false, error: 'internal_error', detail: msg } };
  }
  const porTipo: Record<string, number> = {
    validacao: 422,
    tenant_not_found: 404,
    cliente_nao_encontrado: 422,
    produto_nao_contratado: 422,
    blocos_conflitantes: 422,
    payload_mal_formatado: 400,
  };
  return { status: porTipo[parsed.error] ?? 500, body: { ok: false, ...parsed } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const expected = Deno.env.get('ONBOARDING_INTAKE_SECRET');
  const received = req.headers.get('x-webhook-secret') || '';
  if (!expected || received !== expected) {
    return json({ ok: false, error: 'unauthorized' }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const tenantId = body?.tenant_id;
  const externalId = String(body?.external_ticket_id ?? '').trim();
  if (!tenantId) return json({ ok: false, error: 'tenant_id_required' }, 400);
  if (!externalId) return json({ ok: false, error: 'external_ticket_id_required' }, 400);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) Grava o payload cru ANTES de validar. Fora da transacao da RPC de proposito.
  const { data: log, error: logErr } = await supabase
    .from('onboarding_intake_log')
    .insert({
      tenant_id: tenantId,
      external_ticket_id: externalId,
      modo: modoDoPayload(body),
      payload: body,
      status: 'recebido',
    })
    .select('id')
    .maybeSingle();

  // 2) Ticket ja visto.
  //
  // So o SUCESSO e idempotente. Tentativa que falhou nao criou nada, entao
  // reenviar e seguro e TEM de reprocessar: o external_ticket_id e o id do ticket
  // no sistema de origem e nunca muda, entao recusar o reenvio deixaria um ticket
  // recusado impossivel de corrigir.
  let logId = log?.id ?? null;
  if (logErr) {
    if (logErr.code === '23505') {
      const { data: anterior } = await supabase
        .from('onboarding_intake_log')
        .select('id, status, modo, payload, cliente_id, contrato_id, journey_id, cliente_reusado')
        .eq('tenant_id', tenantId)
        .eq('external_ticket_id', externalId)
        .maybeSingle();

      if (anterior?.status === 'processado') {
        const { id: _id, payload: payloadAnterior, ...dados } = anterior as any;
        // Retentativa pura (rede caiu, clique duplo): devolve o que foi criado.
        if (canonico(payloadAnterior) === canonico(body)) {
          return json({ ok: true, ja_processado: true, ...dados });
        }
        // Mesmo ticket, conteudo diferente: a venda ja esta registrada e a
        // alteracao NAO e aplicada. Responder 200 aqui faria o vendedor acreditar
        // que a correcao chegou — e ela nao chega.
        return json({
          ok: false,
          error: 'ticket_ja_processado_com_alteracao',
          detail: 'este ticket ja foi registrado no DoctorSaaS e o conteudo mudou desde entao; a alteracao NAO foi aplicada. Ajuste direto no DoctorSaaS pelo ticket abaixo',
          alteracao_ignorada: true,
          ...dados,
        }, 409);
      }

      // Falhou antes: reaproveita a linha, com o payload novo, e tenta de novo.
      logId = anterior?.id ?? null;
      if (!logId) {
        return json({ ok: false, error: 'internal_error', detail: 'log anterior nao encontrado' }, 500);
      }
      await supabase.from('onboarding_intake_log')
        .update({ payload: body, modo: modoDoPayload(body), status: 'recebido', erro: null, avisos: null })
        .eq('id', logId);
      console.log('[intake] reprocessando tentativa que falhou:', externalId);
    } else {
      console.error('[intake] falha ao gravar log:', logErr);
      return json({ ok: false, error: 'internal_error', detail: logErr.message }, 500);
    }
  }

  // 3) A transacao: tudo ou nada.
  const { data: resultado, error: rpcErr } = await supabase.rpc('fn_intake_proposta', { p_payload: body });

  if (rpcErr) {
    const { status, body: corpo } = traduzErro(rpcErr.message ?? '');
    await supabase.from('onboarding_intake_log')
      .update({ status: 'erro', erro: corpo })
      .eq('id', logId);
    console.error('[intake] recusado:', externalId, rpcErr.message);
    return json(corpo, status);
  }

  await supabase.from('onboarding_intake_log')
    .update({
      status: 'processado',
      cliente_id: resultado?.cliente_id ?? null,
      contrato_id: resultado?.contrato_id ?? null,
      journey_id: resultado?.journey_id ?? null,
      cliente_reusado: resultado?.cliente_reusado ?? null,
      // Venda aceita mas com lacuna — produto que entrou sem modulo nao registra o
      // que foi vendido. Guardado para dar para consultar depois quais vendas
      // precisam de complemento manual.
      avisos: (resultado?.avisos?.length ?? 0) > 0 ? resultado.avisos : null,
    })
    .eq('id', logId);

  const nAvisos = resultado?.avisos?.length ?? 0;
  console.log('[intake] ok:', externalId, resultado?.ticket_code, nAvisos > 0 ? `(${nAvisos} aviso(s))` : '');
  return json(resultado);
});
