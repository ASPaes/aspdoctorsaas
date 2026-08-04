import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
// Tipos fixos do Omie (confirmados na doc da API). Não são sincronizados.
const TIPOS_FATURAMENTO = [
  {
    codigo: "01",
    descricao: "Todo Mês (mensal)"
  },
  {
    codigo: "02",
    descricao: "A cada 2 meses (bimestral)"
  },
  {
    codigo: "03",
    descricao: "A cada 3 meses (trimestral)"
  },
  {
    codigo: "06",
    descricao: "A cada 6 meses (semestral)"
  },
  {
    codigo: "12",
    descricao: "A cada 12 meses (anual)"
  }
];
// Tipos de vencimento (cTpVenc) confirmados no gabarito (002 = fixar dia do mês)
const TIPOS_VENCIMENTO = [
  {
    codigo: "002",
    descricao: "Fixar dia do mês (1 a 31)"
  },
  {
    codigo: "001",
    descricao: "Dias após o faturamento"
  }
];
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "Método não permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  try {
    // Autenticação por chave (tenant vem da CHAVE)
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!apiKey) return json({
      ok: false,
      error: "Chave de API ausente"
    }, 401);
    const { data: tenantData, error: validErr } = await supa.rpc("validar_api_key", {
      p_key: apiKey
    });
    if (validErr) {
      console.error("ERRO_VALIDAR_KEY:", JSON.stringify(validErr));
      return json({
        ok: false,
        error: "Falha ao validar chave"
      }, 500);
    }
    if (!tenantData) return json({
      ok: false,
      error: "Chave inválida ou revogada"
    }, 401);
    const tenant_id = tenantData;
    let body = {};
    try {
      body = await req.json();
    } catch  {}
    const operacao = body?.operacao ?? "ler";
    // ===== LER =====
    if (operacao === "ler") {
      const [padraoRes, contasRes, servicosRes] = await Promise.all([
        supa.from("settings_default").select("*").eq("tenant_id", tenant_id).maybeSingle(),
        supa.from("omie_contas_correntes").select("codigo, descricao").eq("tenant_id", tenant_id).order("descricao"),
        // Serviços: só os com LC116 preenchido (filtra lixo de serviços autogerados por adquirência)
        supa.from("omie_servicos").select("codigo, descricao, cod_lc116").eq("tenant_id", tenant_id).not("cod_lc116", "is", null).order("descricao")
      ]);
      const erros = [
        padraoRes.error,
        contasRes.error,
        servicosRes.error
      ].filter(Boolean);
      if (erros.length) {
        console.error("ERRO_LER:", JSON.stringify(erros));
        return json({
          ok: false,
          error: "Falha ao ler padrões"
        }, 500);
      }
      return json({
        ok: true,
        padroes: padraoRes.data ?? null,
        contas: contasRes.data ?? [],
        servicos: servicosRes.data ?? [],
        tipos_faturamento: TIPOS_FATURAMENTO,
        tipos_vencimento: TIPOS_VENCIMENTO
      });
    }
    // ===== SALVAR =====
    if (operacao === "salvar") {
      const p = body?.padroes ?? {};
      // Monta o registro: códigos (uso) + nomes (exibição). Campos NOT NULL legados recebem fallback seguro.
      const row = {
        tenant_id,
        // códigos (o que o Omie usa)
        conta_corrente_codigo: p.conta_corrente_codigo ?? null,
        tipo_faturamento_codigo: p.tipo_faturamento_codigo ?? null,
        servico_omie_codigo: p.servico_omie_codigo ?? null,
        // vencimento fallback (prioridade é o cadastro do cliente)
        dia_vencimento: p.dia_vencimento ?? null,
        tipo_vencimento: p.tipo_vencimento ?? null,
        postergar_vencimento: p.postergar_vencimento ?? true,
        // modelos de contrato permitidos p/ envio ao Omie (trava). Array de nomes. null = bloqueia tudo.
        modelos_permitidos: Array.isArray(p.modelos_permitidos) ? p.modelos_permitidos : null,
        // nomes / legados (exibição) — mantém as colunas NOT NULL existentes preenchidas
        conta_corrente: p.conta_corrente_nome ?? p.conta_corrente ?? "",
        tipo_faturamento: p.tipo_faturamento_nome ?? p.tipo_faturamento ?? "",
        dia_faturamento: p.dia_faturamento ?? 1,
        servico_descricao: p.servico_descricao ?? "",
        servico_codigo: p.servico_lc116 ?? p.servico_codigo ?? "",
        numero_parcelas: p.numero_parcelas ?? 1,
        enviar_link_nfse: p.enviar_link_nfse ?? true,
        enviar_boleto: p.enviar_boleto ?? true,
        postergar_finais_semana: p.postergar_finais_semana ?? true,
        adicionar_periodo_referencia: p.adicionar_periodo_referencia ?? true,
        adicionar_vencimento_parcela: p.adicionar_vencimento_parcela ?? true,
        updated_at: new Date().toISOString()
      };
      const { error } = await supa.from("settings_default").upsert(row, {
        onConflict: "tenant_id"
      });
      if (error) {
        console.error("ERRO_SALVAR_PADROES:", JSON.stringify(error));
        return json({
          ok: false,
          error: "Falha ao salvar padrões: " + error.message
        }, 500);
      }
      return json({
        ok: true,
        salvo: true
      });
    }
    return json({
      ok: false,
      error: "operação inválida (use 'ler' ou 'salvar')"
    }, 400);
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
