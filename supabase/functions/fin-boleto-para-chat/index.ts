// Prepara o PDF do boleto para uma PESSOA mandar no chat (botão "Enviar 2ª via"
// da Visão 360° do cliente).
//
// Não envia nada. Devolve o caminho do PDF no Storage e quem manda é a tela,
// pela `send-whatsapp-message`, igual a qualquer anexo que o operador envia: a
// mensagem sai com a assinatura dele e conta no atendimento dele. É o oposto da
// `fin-segunda-via`, que é o robô respondendo sozinho.
//
// Por que guardar o PDF em vez de mandar o link do Omie: o link é assinado e
// morre em 24 h, e a bolha do chat guarda o endereço, então no dia seguinte o
// anexo abriria quebrado. Mesmo caminho de arquivo da `fin-segunda-via`
// (`<tenant>/boletos/<titulo>.pdf`, bucket whatsapp-media), o que faz o boleto
// pedido pelo robô e o mandado pela pessoa serem o mesmo arquivo.
//
// O título é lido com o TOKEN DO USUÁRIO (RLS): quem não enxerga o financeiro
// da empresa não prepara boleto nenhum. O link vem da `fin-titulo-boleto`,
// chamada com o mesmo token, para existir um só jeito de falar com o Omie.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const fmtData = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ ok: false, error: "Não autenticado" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return json({ ok: false, error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const tituloId: string | null = typeof body?.titulo_id === "string" ? body.titulo_id : null;
    if (!tituloId) return json({ ok: false, error: "titulo_id é obrigatório" }, 400);

    const { data: titulo } = await userClient
      .from("fin_titulos")
      .select("id, tenant_id, vencimento, valor, codigo_barras, pix_copia_cola, boleto_gerado")
      .eq("id", tituloId)
      .maybeSingle();
    if (!titulo) return json({ ok: false, error: "Título não encontrado" }, 404);
    if (!titulo.boleto_gerado) return json({ ok: false, motivo: "sem_boleto", error: "Este título não tem boleto gerado no Omie." });

    const base = {
      vencimento: titulo.vencimento,
      valor: Number(titulo.valor) || 0,
      codigo_barras: titulo.codigo_barras,
      pix_copia_cola: titulo.pix_copia_cola,
    };

    // Link do boleto pela função que já existe para isso.
    const r = await fetch(`${url}/functions/v1/fin-titulo-boleto`, {
      method: "POST",
      headers: { Authorization: authHeader, apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ titulo_id: tituloId }),
      signal: AbortSignal.timeout(15000),
    });
    const rb = await r.json().catch(() => ({}));
    const link: string | null = rb?.ok && rb?.link_boleto ? rb.link_boleto : null;
    if (!link) return json({ ok: false, motivo: "sem_link", error: rb?.error ?? "Não deu para buscar o boleto no Omie.", ...base });

    // Daqui para baixo, qualquer tropeço devolve o link: a tela manda o link em
    // texto em vez do anexo, e o cliente recebe de todo jeito.
    const falhaPdf = (motivo: string) => {
      console.warn("[fin-boleto-para-chat] PDF:", motivo, tituloId);
      return json({ ok: true, pdf: null, link, ...base });
    };

    const resp = await fetch(link, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!resp?.ok) return falhaPdf(`download ${resp?.status ?? "sem resposta"}`);
    const tipo = (resp.headers.get("content-type") ?? "").toLowerCase();
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const ehPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
    // O CDN do Omie responde HTML quando a assinatura venceu.
    if (tipo.includes("html") || !ehPdf) return falhaPdf(`nao e PDF (${tipo}, ${bytes.length} bytes)`);
    if (bytes.length > 15 * 1024 * 1024) return falhaPdf("grande demais para WhatsApp");

    const path = `${titulo.tenant_id}/boletos/${titulo.id}.pdf`;
    const { error: up } = await service.storage
      .from("whatsapp-media")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (up) return falhaPdf(`upload: ${up.message}`);

    return json({
      ok: true,
      link,
      pdf: { storagePath: path, fileName: `boleto-${fmtData(titulo.vencimento).replace(/\//g, "-")}.pdf`, bytes: bytes.length },
      ...base,
    });
  } catch (e) {
    console.error("[fin-boleto-para-chat] erro:", e);
    return json({ ok: false, error: (e as Error)?.message ?? "Erro interno" }, 500);
  }
});
