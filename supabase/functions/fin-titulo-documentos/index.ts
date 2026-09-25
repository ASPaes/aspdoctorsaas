import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";

// fin-titulo-documentos — nota fiscal, ordem de serviço e XML de um título.
//
// v1 (25/09/2026). Irmã da `fin-titulo-boleto`, e de propósito: o cliente pede
// boleto, mas também pede a nota — e quando o título não tem nota de serviço
// emitida, o que vale é a ordem de serviço. As duas seguem o mesmo desenho para
// que quem entender uma entenda a outra.
//
// AUTORIZAÇÃO: quem pode ver o título é quem o RLS deixa ver. A consulta é
// feita COM O TOKEN DO USUÁRIO; se ele não enxerga o título, não recebe
// documento nenhum. O service_role entra depois, só para pegar a chave da conta
// e gravar o resultado.
//
// ⚠️ OS LINKS SÃO PERECÍVEIS, e isso foi medido: duas chamadas seguidas para a
// mesma OS devolveram endereços DIFERENTES, e a resposta do Omie diz
// "Documentos gerados com sucesso" — ele gera o arquivo a cada pedido. Não
// sabemos a validade exata; o link de boleto do mesmo ERP morre em 24 h.
// Tratamos como 12 h para ficar do lado seguro: reaproveitar por engano entrega
// link quebrado ao cliente, e buscar de novo à toa custa duas chamadas.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DOCTOROMIE_DOCS =
  "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-documentos-obter";

/** Idade a partir da qual os endereços são buscados de novo. Ver nota acima. */
const VALIDADE_MS = 12 * 60 * 60 * 1000;

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
    // `forcar` existe para o caso em que o cliente diz que o link não abriu:
    // insistir com o endereço guardado seria repetir o problema.
    const forcar: boolean = body?.forcar === true;

    const { data: titulo, error: tErr } = await userClient
      .from("fin_titulos")
      .select(
        "id, tenant_id, origem, origem_conta_id, origem_id, origem_os_id, numero_nf, documentos, documentos_em",
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
        motivo: "origem_sem_documentos",
        error: `Ainda não sabemos buscar documento na origem "${titulo.origem}".`,
      }, 501);
    }

    // Sem ordem de serviço não há documento para mostrar. Acontece em ~1,6% dos
    // títulos: são os que não nasceram de uma OS.
    if (!titulo.origem_os_id) {
      return json({
        ok: false,
        motivo: "titulo_sem_os",
        error: "Este título não está ligado a uma ordem de serviço, então não tem nota nem OS para mostrar.",
      }, 409);
    }

    const idade = titulo.documentos_em ? Date.now() - new Date(titulo.documentos_em).getTime() : Infinity;
    if (!forcar && titulo.documentos && idade < VALIDADE_MS) {
      return json({
        ok: true,
        reaproveitado: true,
        buscado_em: titulo.documentos_em,
        tem_nota: !!(titulo.documentos as any)?.pdf_nfse,
        documentos: titulo.documentos,
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

    const resp = await fetch(DOCTOROMIE_DOCS, {
      method: "POST",
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: JSON.stringify({ codigo_lancamento_omie: Number(titulo.origem_id) }),
    });
    const corpo = await resp.json().catch(() => ({}));

    if (!resp.ok || corpo?.ok === false) {
      const erro = corpo?.error ?? `HTTP ${resp.status}`;
      console.error("ERRO_DOCS_ORIGEM:", titulo.origem_id, erro);
      return json({ ok: false, motivo: corpo?.motivo ?? null, error: String(erro) }, 502);
    }

    const documentos = corpo?.documentos ?? {};

    const { error: upErr } = await service
      .from("fin_titulos")
      .update({
        documentos,
        documentos_em: new Date().toISOString(),
        // `link_nfse` já existia e é o que a tela lê há mais tempo: mantido em
        // dia para não haver duas verdades sobre o mesmo endereço.
        link_nfse: documentos?.pdf_nfse ?? null,
        numero_nf: documentos?.numero_nf ?? titulo.numero_nf,
        atualizado_em: new Date().toISOString(),
      })
      .eq("id", titulo.id);
    if (upErr) console.error("ERRO_GRAVAR_DOCS:", upErr.message);

    return json({
      ok: true,
      reaproveitado: false,
      buscado_em: new Date().toISOString(),
      tem_nota: corpo?.tem_nota === true,
      documentos,
      avisos: corpo?.avisos ?? [],
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
