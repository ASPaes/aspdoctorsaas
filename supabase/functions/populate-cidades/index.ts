import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Fetch estados from IBGE
    const estadosRes = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/estados"
    );
    if (!estadosRes.ok) throw new Error("Falha ao buscar estados do IBGE");
    const estadosIbge = await estadosRes.json();

    // 2. Upsert estados
    const estadosData = estadosIbge.map((e: any) => ({
      codigo_ibge: String(e.id),
      sigla: e.sigla,
      nome: e.nome,
    }));

    const { error: errEstados } = await supabase
      .from("estados")
      .upsert(estadosData, { onConflict: "sigla" });
    if (errEstados) throw new Error(`Erro ao inserir estados: ${errEstados.message}`);

    // 3. Build codigo_ibge->id map
    const { data: estadosDb, error: errFetch } = await supabase
      .from("estados")
      .select("id, codigo_ibge");
    if (errFetch) throw new Error(`Erro ao buscar estados: ${errFetch.message}`);

    const codigoToId: Record<string, number> = {};
    for (const e of estadosDb!) {
      if (e.codigo_ibge) codigoToId[e.codigo_ibge] = e.id;
    }

    // 4. Fetch all cidades from IBGE
    const cidadesRes = await fetch(
      "https://servicodados.ibge.gov.br/api/v1/localidades/municipios"
    );
    if (!cidadesRes.ok) throw new Error("Falha ao buscar cidades do IBGE");
    const cidadesIbge = await cidadesRes.json();

    // 5. Map cidades - UF info is nested under microrregiao.mesorregiao.UF
    const cidadesData = cidadesIbge.map((c: any) => {
      const ufId = String(c.microrregiao?.mesorregiao?.UF?.id);
      return {
        codigo_ibge: String(c.id),
        nome: c.nome,
        estado_id: codigoToId[ufId],
      };
    }).filter((c: any) => c.estado_id != null);

    // 6. Upsert cidades in batches
    const BATCH = 500;
    for (let i = 0; i < cidadesData.length; i += BATCH) {
      const batch = cidadesData.slice(i, i + BATCH);
      const { error } = await supabase
        .from("cidades")
        .upsert(batch, { onConflict: "codigo_ibge" });
      if (error) throw new Error(`Erro ao inserir cidades (batch ${i}): ${error.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        estados: estadosData.length,
        cidades: cidadesData.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
