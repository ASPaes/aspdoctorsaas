import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Sem autorização" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) return json({ ok: false, error: "Usuário não autenticado" });

    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, role, is_super_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile || (profile.role !== "admin" && !profile.is_super_admin)) {
      return json({ ok: false, error: "Acesso negado: apenas admins podem operar integrações" });
    }

    const { acao, tenant_id } = await req.json();
    const targetTenantId = profile.is_super_admin && tenant_id ? tenant_id : profile.tenant_id;
    if (!targetTenantId) return json({ ok: false, error: "tenant_id não encontrado" });

    // credenciais do Vault (base_url + token) — só integração ativa
    const { data: creds, error: credErr } = await supabase.rpc("hiper_integration_credentials", {
      p_tenant_id: targetTenantId,
    });
    if (credErr) return json({ ok: false, error: credErr.message });
    const cred = Array.isArray(creds) ? creds[0] : creds;
    if (!cred?.token) return json({ ok: false, error: "Integração não configurada ou inativa" });

    const baseUrl = String(cred.base_url || "https://portalhiper.com.br").replace(/\/+$/, "");
    const token = String(cred.token);

    const markStatus = (status: "ok" | "erro") =>
      supabase.from("hiper_integration")
        .update({ ultimo_status: status, ultimo_teste_at: new Date().toISOString() })
        .eq("tenant_id", targetTenantId);

    if (acao === "testar") {
      let resp: Response;
      try {
        resp = await fetch(`${baseUrl}/api/integ/v1/clientes?limit=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (e) {
        await markStatus("erro");
        return json({ ok: false, error: `Falha de rede ao chamar o PortalHiper: ${(e as Error).message}` });
      }

      if (!resp.ok) {
        await markStatus("erro");
        const detalhe = resp.status === 401 ? "token inválido ou revogado"
          : resp.status === 403 ? "escopo insuficiente"
          : `HTTP ${resp.status}`;
        return json({ ok: false, error: `PortalHiper recusou: ${detalhe}` });
      }

      const body = await resp.json().catch(() => ({}));
      const amostra = Array.isArray(body?.clientes) ? body.clientes.length : 0;
      await markStatus("ok");
      return json({ ok: true, resultado: { http: resp.status, amostra, tem_mais: !!body?.next_cursor } });
    }

    if (acao === "puxar") {
      const pageSize = 200;
      const MAX_PAGES = 60; // teto defensivo (~12k clientes)
      let cursor: string | null = null;
      let paginas = 0;
      let maxScraped: string | null = null;
      const porPortal = new Map<string, any>();

      try {
        do {
          const u = new URL(`${baseUrl}/api/integ/v1/clientes`);
          u.searchParams.set("limit", String(pageSize));
          if (cursor) u.searchParams.set("cursor", cursor);
          const resp = await fetch(u.toString(), { headers: { Authorization: `Bearer ${token}` } });
          if (!resp.ok) {
            await markStatus("erro");
            return json({ ok: false, error: `PortalHiper recusou (HTTP ${resp.status})` });
          }
          const body = await resp.json();
          const lista = Array.isArray(body?.clientes) ? body.clientes : [];
          for (const c of lista) {
            const idPortal = String(c.id_portal ?? "");
            if (!idPortal) continue;
            if (c.last_scraped_at && (!maxScraped || c.last_scraped_at > maxScraped)) maxScraped = c.last_scraped_at;
            porPortal.set(idPortal, {
              tenant_id: targetTenantId,
              id_portal: idPortal,
              cnpj: c.cnpj ?? null,
              cnpj_norm: (String(c.cnpj ?? "").replace(/\D/g, "") || null),
              razao_social: c.razao_social ?? null,
              nome_fantasia: c.nome_fantasia ?? null,
              cidade: c.cidade ?? null,
              uf: c.uf ?? null,
              situacao: c.situacao ?? null,
              responsavel_tipo: c.responsavel_tipo ?? null,
              plano: c.plano ?? null,
              cliente_desde: c.cliente_desde ?? null,
              cancelada_em: c.cancelada_em ?? null,
              cancelada_por: c.cancelada_por ?? null,
              saude: c.saude ?? null,
              ultimo_acesso: c.ultimo_acesso ?? null,
              mrr: c.mrr ?? null,
              a_pagar: c.a_pagar ?? null,
              bruto_mes: c.bruto_mes ?? null,
              custo_mes: c.custo_mes ?? null,
              mensalidade_ultima: c.mensalidade_ultima ?? null,
              a_pagar_ultima: c.a_pagar_ultima ?? null,
              extrato_mes_ultima: c.extrato_mes_ultima ?? null,
              usuarios_contratados: c.usuarios_contratados ?? null,
              usuarios_ativos_30d: c.usuarios_ativos_30d ?? null,
              qt_modulos: c.qt_modulos ?? null,
              atraso_dias: c.atraso_dias ?? null,
              total_aberto: c.total_aberto ?? null,
              last_scraped_at: c.last_scraped_at ?? null,
              raw: c,
            });
          }
          cursor = body?.next_cursor ?? null;
          paginas++;
        } while (cursor && paginas < MAX_PAGES);
      } catch (e) {
        await markStatus("erro");
        return json({ ok: false, error: `Falha de rede ao puxar: ${(e as Error).message}` });
      }

      const registros = Array.from(porPortal.values());

      // Snapshot fresco: apaga o espelho do tenant e regrava.
      const { error: delErr } = await supabase.from("hiper_espelho_cadastro").delete().eq("tenant_id", targetTenantId);
      if (delErr) return json({ ok: false, error: `Falha ao limpar espelho: ${delErr.message}` });

      for (let i = 0; i < registros.length; i += 500) {
        const { error: insErr } = await supabase.from("hiper_espelho_cadastro").insert(registros.slice(i, i + 500));
        if (insErr) return json({ ok: false, error: `Falha ao gravar espelho: ${insErr.message}` });
      }

      await supabase.from("hiper_integration")
        .update({ ultimo_status: "ok", ultimo_teste_at: new Date().toISOString(), puxar_desde: maxScraped })
        .eq("tenant_id", targetTenantId);

      return json({
        ok: true,
        resultado: { total: registros.length, paginas, truncado: paginas >= MAX_PAGES && !!cursor },
      });
    }

    return json({ ok: false, error: `Ação desconhecida: ${acao}` });
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message || "Erro interno" }, 500);
  }
});
