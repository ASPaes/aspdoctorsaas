import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";

// fin-titulo-boleto — devolve o link do PDF do boleto de um título.
//
// v1 (22/09/2026). É esta function que a tela (e, depois, a 2ª via no chat) usa
// para entregar o boleto ao cliente.
//
// TRÊS COISAS MEDIDAS CONTRA A API DO OMIE EM 22/09/2026:
//   1. O link vale 24 HORAS. Vem assinado, com `Expires=` na URL. Por isso o
//      link é guardado junto com a validade e só é reaproveitado enquanto vale.
//      Reenviar link vencido é entregar erro na mão do cliente.
//   2. `ObterBoleto` só consulta: se o título não tem boleto gerado no ERP, não
//      há link. Esta function NUNCA manda gerar boleto — gerar é escrita no
//      financeiro do cliente e não pode nascer de um pedido de 2ª via.
//   3. Não existe PIX nessa resposta. Só link do PDF, código de barras, número
//      do boleto, juros e multa.
//
// AUTORIZAÇÃO: quem pode ver o título é quem o RLS deixa ver. A consulta do
// título é feita COM O TOKEN DO USUÁRIO de propósito; se ele não enxerga o
// título, não recebe boleto nenhum. O service_role entra depois, só para pegar
// a chave da conta e gravar o resultado.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DOCTOROMIE_BOLETO =
  "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-boleto-obter";

// Margem antes de considerar o link reaproveitável. Um link que vence em 3
// minutos não serve para mandar a um cliente que vai abrir depois do almoço.
const MARGEM_MS = 30 * 60 * 1000;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ ok: false, error: "Não autenticado" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const tituloId: string | null = typeof body?.titulo_id === "string" ? body.titulo_id : null;
    if (!tituloId) return json({ ok: false, error: "titulo_id é obrigatório" }, 400);

    // Com o token do usuário: o RLS decide se ele pode ver este título.
    const { data: titulo, error: tErr } = await userClient
      .from("fin_titulos")
      .select(
        "id, tenant_id, origem, origem_conta_id, origem_id, boleto_gerado, link_boleto, link_boleto_expira_em, codigo_barras, vencimento, valor",
      )
      .eq("id", tituloId)
      .maybeSingle();

    if (tErr) {
      console.error("ERRO_LEITURA_TITULO:", tErr.message);
      return json({ ok: false, error: "Falha ao ler o título" }, 500);
    }
    if (!titulo) return json({ ok: false, error: "Título não encontrado" }, 404);

    if (titulo.origem !== "omie") {
      return json({
        ok: false,
        motivo: "origem_sem_boleto",
        error: `Ainda não sabemos buscar boleto na origem "${titulo.origem}".`,
      }, 501);
    }

    if (!titulo.boleto_gerado) {
      return json({
        ok: false,
        motivo: "boleto_nao_gerado",
        error: "Este título não tem boleto gerado no Omie.",
      }, 409);
    }

    // Link ainda bom: devolve sem gastar chamada na origem.
    const validade = titulo.link_boleto_expira_em ? new Date(titulo.link_boleto_expira_em).getTime() : 0;
    if (titulo.link_boleto && validade - Date.now() > MARGEM_MS) {
      return json({
        ok: true,
        reaproveitado: true,
        link_boleto: titulo.link_boleto,
        expira_em: titulo.link_boleto_expira_em,
        codigo_barras: titulo.codigo_barras,
      });
    }

    if (!titulo.origem_conta_id) {
      return json({ ok: false, error: "Título sem conta de origem registrada" }, 409);
    }

    const { data: chave, error: chaveErr } = await service.rpc("obter_chave_omie_por_conta", {
      p_integration_id: titulo.origem_conta_id,
    });
    if (chaveErr || !chave) {
      console.error("ERRO_CHAVE:", JSON.stringify(chaveErr));
      return json({ ok: false, error: "Credencial da conta Omie indisponível" }, 500);
    }

    const resp = await fetch(DOCTOROMIE_BOLETO, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ codigo_lancamento_omie: Number(titulo.origem_id) }),
    });
    const corpo = await resp.json().catch(() => ({}));

    if (!resp.ok || corpo?.ok === false) {
      const motivo = corpo?.motivo ?? null;
      const erro = corpo?.error ?? `HTTP ${resp.status}`;
      console.error("ERRO_BOLETO_ORIGEM:", titulo.origem_id, erro);
      return json({ ok: false, motivo, error: String(erro) }, motivo === "boleto_nao_gerado" ? 409 : 502);
    }

    // Guarda para o próximo pedido, com a validade junto.
    const { error: upErr } = await service
      .from("fin_titulos")
      .update({
        link_boleto: corpo.link_boleto,
        link_boleto_expira_em: corpo.expira_em ?? null,
        codigo_barras: corpo.codigo_barras ?? titulo.codigo_barras,
        numero_boleto: corpo.numero_boleto ?? null,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", titulo.id);
    if (upErr) console.error("ERRO_GRAVAR_LINK:", upErr.message);

    return json({
      ok: true,
      reaproveitado: false,
      link_boleto: corpo.link_boleto,
      expira_em: corpo.expira_em ?? null,
      codigo_barras: corpo.codigo_barras ?? null,
      numero_boleto: corpo.numero_boleto ?? null,
      juros_percentual: corpo.juros_percentual ?? null,
      multa_percentual: corpo.multa_percentual ?? null,
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
