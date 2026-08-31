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

const PAGE_SIZE = 200;
const MAX_PAGES = 60;   // teto defensivo: ~12k contas
const LOTE_INSERT = 500;

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

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

    const { acao, tenant_id, id_portal: req_id_portal } = await req.json();
    const targetTenantId = profile.is_super_admin && tenant_id ? tenant_id : profile.tenant_id;
    if (!targetTenantId) return json({ ok: false, error: "tenant_id não encontrado" });

    // Reconciliar não fala com o portal: recalcula sobre o espelho que já está aqui.
    if (acao === "reconciliar") {
      const { data, error } = await supabase.rpc("hiper_reconciliar", { p_tenant_id: targetTenantId });
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true, resultado: data });
    }

    const { data: creds, error: credErr } = await supabase.rpc("hiper_integration_credentials", {
      p_tenant_id: targetTenantId,
    });
    if (credErr) return json({ ok: false, error: credErr.message });
    const cred = Array.isArray(creds) ? creds[0] : creds;
    if (!cred?.token) return json({ ok: false, error: "Integração não configurada ou inativa" });

    const baseUrl = String(cred.base_url || "https://portalhiper.com.br").replace(/\/+$/, "");
    const token = String(cred.token);
    const auth = { Authorization: `Bearer ${token}` };

    const markStatus = (status: "ok" | "erro") =>
      supabase.from("hiper_integration")
        .update({ ultimo_status: status, ultimo_teste_at: new Date().toISOString() })
        .eq("tenant_id", targetTenantId);

    const { data: integ } = await supabase
      .from("hiper_integration")
      .select("portal_tenant_id, portal_tenant_nome")
      .eq("tenant_id", targetTenantId)
      .maybeSingle();

    /** Quem é o dono do token agora. `null` = o portal ainda não expõe /me. */
    const lerIdentidade = async (): Promise<{ id: string; nome: string | null } | null | { erro: string }> => {
      let r: Response;
      try {
        r = await fetch(`${baseUrl}/api/integ/v1/me`, { headers: auth });
      } catch (e) {
        return { erro: `Falha de rede ao chamar o PortalHiper: ${(e as Error).message}` };
      }
      if (r.status === 404) return null;
      if (!r.ok) {
        return {
          erro: r.status === 401 ? "PortalHiper recusou: token inválido ou revogado"
            : r.status === 403 ? "PortalHiper recusou: escopo insuficiente"
            : `PortalHiper recusou (HTTP ${r.status})`,
        };
      }
      const b = await r.json().catch(() => ({}));
      return { id: String(b?.tenant_id ?? ""), nome: b?.tenant_nome ?? null };
    };

    if (acao === "testar") {
      const ident = await lerIdentidade();
      if (ident && "erro" in ident) {
        await markStatus("erro");
        return json({ ok: false, error: ident.erro });
      }

      let resp: Response;
      try {
        resp = await fetch(`${baseUrl}/api/integ/v1/clientes?limit=1`, { headers: auth });
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
      const primeira = Array.isArray(body?.clientes) ? body.clientes[0] : null;
      await markStatus("ok");
      return json({
        ok: true,
        resultado: {
          http: resp.status,
          amostra,
          tem_mais: !!body?.next_cursor,
          portal_tenant_nome: ident && !("erro" in ident) ? ident.nome : (integ?.portal_tenant_nome ?? null),
          // Diz na cara se o portal ainda é o antigo, em vez de deixar as abas
          // de Módulos e Filiais vazias parecendo bug.
          portal_atualizado: ident !== null && primeira !== null
            ? Array.isArray(primeira?.modulos) && Array.isArray(primeira?.filiais)
            : ident !== null,
        },
      });
    }

    // Rebuscar UMA conta no portal. A API é paginada por cursor e não tem filtro
    // por conta, então varre as páginas e fica só com a que interessa — a
    // carteira inteira leva ~4s, e o que importa aqui é não regravar as outras
    // 993 contas para conferir uma.
    if (acao === "puxar_um") {
      const alvo = String(req_id_portal ?? "").trim();
      if (!alvo) return json({ ok: false, error: "Informe a conta do portal a rebuscar." });

      let achado: Record<string, unknown> | null = null;
      let cursor: string | null = null;
      let paginas = 0;
      try {
        do {
          const u = new URL(`${baseUrl}/api/integ/v1/clientes`);
          u.searchParams.set("limit", String(PAGE_SIZE));
          if (cursor) u.searchParams.set("cursor", cursor);
          const resp = await fetch(u.toString(), { headers: auth });
          if (!resp.ok) return json({ ok: false, error: `PortalHiper recusou (HTTP ${resp.status})` });
          const body = await resp.json();
          const lista = Array.isArray(body?.clientes) ? body.clientes : [];
          achado = lista.find((c: Record<string, unknown>) => String(c.id_portal ?? "") === alvo) ?? null;
          cursor = body?.next_cursor ?? null;
          paginas++;
        } while (!achado && cursor && paginas < MAX_PAGES);
      } catch (e) {
        return json({ ok: false, error: `Falha de rede ao rebuscar: ${(e as Error).message}` });
      }

      if (!achado) {
        return json({
          ok: false,
          error: "Esta conta não está mais na carteira do portal. Rode a sincronização completa para o espelho refletir isso.",
        });
      }

      const c = achado as Record<string, any>;
      const plano = c.plano_detalhe ?? null;
      const cad = c.cadastro ?? null;
      const ult = c.ultimo_extrato ?? null;
      const { error: upErr } = await supabase.from("hiper_espelho_cadastro").update({
        cnpj: c.cnpj ?? null,
        cnpj_norm: soDigitos(c.cnpj) || null,
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
        mrr: num(c.mrr),
        a_pagar: num(c.a_pagar),
        bruto_mes: num(c.bruto_mes),
        custo_mes: num(c.custo_mes),
        mensalidade_ultima: num(c.mensalidade_ultima),
        a_pagar_ultima: num(c.a_pagar_ultima),
        extrato_mes_ultima: c.extrato_mes_ultima ?? null,
        usuarios_contratados: c.usuarios_contratados ?? null,
        usuarios_ativos_30d: c.usuarios_ativos_30d ?? null,
        qt_modulos: c.qt_modulos ?? null,
        atraso_dias: c.atraso_dias ?? null,
        total_aberto: num(c.total_aberto),
        last_scraped_at: c.last_scraped_at ?? null,
        ...(plano
          ? {
              plano_qt_usuarios: plano.qt_usuarios ?? null,
              plano_qt_caixas: plano.qt_caixas ?? null,
              plano_qt_filiais: plano.qt_filiais ?? null,
            }
          : {}),
        ...(cad
          ? {
              cad_mensalidade: num(cad.mensalidade),
              cad_custo: num(cad.custo),
              cad_repasse: num(cad.repasse),
              cad_taxa_central: num(cad.taxa_central),
            }
          : {}),
        ...(ult
          ? {
              ult_mes: ult.mes ?? null,
              ult_mensalidade: num(ult.mensalidade),
              ult_custo: num(ult.custo),
              ult_a_pagar: num(ult.a_pagar),
              ult_a_receber: num(ult.a_receber),
            }
          : {}),
        raw: c,
        pulled_at: new Date().toISOString(),
      }).eq("tenant_id", targetTenantId).eq("id_portal", alvo);
      if (upErr) return json({ ok: false, error: `Falha ao gravar o espelho: ${upErr.message}` });

      // Módulos e filiais só são substituídos quando o portal REALMENTE mandou
      // os campos: um portal desatualizado zeraria o que já tínhamos.
      let mods = 0, fils = 0;
      if (Array.isArray(c.modulos)) {
        await supabase.from("hiper_espelho_modulo").delete()
          .eq("tenant_id", targetTenantId).eq("id_portal", alvo);
        const linhas = (c.modulos as any[])
          .filter((m) => String(m.nome ?? "").trim())
          .map((m) => ({
            tenant_id: targetTenantId, id_portal: alvo, app_nome: String(m.nome).trim(),
            custo: num(m.custo) ?? 0, comprado_por: m.comprado_por ?? null, ativo: m.ativo !== false,
          }));
        if (linhas.length) await supabase.from("hiper_espelho_modulo").insert(linhas);
        mods = linhas.length;
      }
      if (Array.isArray(c.filiais)) {
        await supabase.from("hiper_espelho_filial").delete()
          .eq("tenant_id", targetTenantId).eq("id_portal", alvo);
        const linhas = (c.filiais as any[])
          .map((f) => ({ ...f, cnpj_norm: soDigitos(f.cnpj) }))
          .filter((f) => f.cnpj_norm.length === 14)
          .map((f) => ({
            tenant_id: targetTenantId, id_portal: alvo, cnpj: f.cnpj ?? null, cnpj_norm: f.cnpj_norm,
            nome: f.nome ?? null, cidade: f.cidade ?? null, uf: f.uf ?? null, ativo: f.ativo !== false,
          }));
        if (linhas.length) await supabase.from("hiper_espelho_filial").insert(linhas);
        fils = linhas.length;
      }

      const { data: rec, error: recErr } = await supabase.rpc("hiper_reconciliar", {
        p_tenant_id: targetTenantId,
      });
      if (recErr) return json({ ok: false, error: `Espelho atualizado, mas a reconciliação falhou: ${recErr.message}` });

      return json({
        ok: true,
        resultado: {
          id_portal: alvo, paginas, modulos: mods, filiais: fils,
          portal_atualizado: Array.isArray(c.modulos) && Array.isArray(c.filiais),
          recon: rec,
        },
      });
    }

    if (acao === "puxar") {
      // 1. Trava de isolamento: o token não pode ter trocado de dono no meio de
      //    uma conexão já existente. Sem esta checagem, trocar o token
      //    contamina o espelho em silêncio.
      const ident = await lerIdentidade();
      if (ident && "erro" in ident) {
        await markStatus("erro");
        return json({ ok: false, error: ident.erro });
      }
      if (ident && integ?.portal_tenant_id && ident.id !== integ.portal_tenant_id) {
        await markStatus("erro");
        return json({
          ok: false,
          error: `O token agora pertence a outro tenant do PortalHiper ("${ident.nome ?? ident.id}"). Nada foi gravado. Confira o token na aba Conexão.`,
        });
      }

      const { data: run, error: runErr } = await supabase
        .from("hiper_sync_run")
        .insert({ tenant_id: targetTenantId, disparado_por: user.id, origem: "manual", status: "rodando" })
        .select("id")
        .single();
      if (runErr) return json({ ok: false, error: `Falha ao abrir a execução: ${runErr.message}` });
      const runId = run.id as string;

      const fecharComErro = async (msg: string) => {
        await supabase.from("hiper_sync_run")
          .update({ status: "erro", erro: msg, terminado_em: new Date().toISOString() })
          .eq("id", runId);
        await markStatus("erro");
        return json({ ok: false, error: msg });
      };

      const contas = new Map<string, Record<string, unknown>>();
      const modulos = new Map<string, Record<string, unknown>>();
      const filiais = new Map<string, Record<string, unknown>>();
      let cursor: string | null = null;
      let paginas = 0;
      let maxScraped: string | null = null;

      try {
        do {
          const u = new URL(`${baseUrl}/api/integ/v1/clientes`);
          u.searchParams.set("limit", String(PAGE_SIZE));
          if (cursor) u.searchParams.set("cursor", cursor);
          const resp = await fetch(u.toString(), { headers: auth });
          if (!resp.ok) return await fecharComErro(`PortalHiper recusou (HTTP ${resp.status})`);

          const body = await resp.json();
          const lista = Array.isArray(body?.clientes) ? body.clientes : [];
          for (const c of lista) {
            const idPortal = String(c.id_portal ?? "");
            if (!idPortal) continue;
            if (c.last_scraped_at && (!maxScraped || c.last_scraped_at > maxScraped)) {
              maxScraped = c.last_scraped_at;
            }
            // Portal antigo não manda plano_detalhe. Gravar null aqui apagaria
            // os contadores que já estão no espelho — e com eles os módulos de
            // plano, que saem de qt_caixas. Ausente ≠ zero.
            const plano = c.plano_detalhe ?? null;
            // Mesma regra do plano: portal antigo não manda `cadastro`, e
            // gravar null apagaria o que já está aqui. Ausente ≠ zero.
            const cad = c.cadastro ?? null;
            const ult = c.ultimo_extrato ?? null;
            contas.set(idPortal, {
              tenant_id: targetTenantId,
              id_portal: idPortal,
              cnpj: c.cnpj ?? null,
              cnpj_norm: soDigitos(c.cnpj) || null,
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
              mrr: num(c.mrr),
              a_pagar: num(c.a_pagar),
              bruto_mes: num(c.bruto_mes),
              custo_mes: num(c.custo_mes),
              mensalidade_ultima: num(c.mensalidade_ultima),
              a_pagar_ultima: num(c.a_pagar_ultima),
              extrato_mes_ultima: c.extrato_mes_ultima ?? null,
              usuarios_contratados: c.usuarios_contratados ?? null,
              usuarios_ativos_30d: c.usuarios_ativos_30d ?? null,
              qt_modulos: c.qt_modulos ?? null,
              atraso_dias: c.atraso_dias ?? null,
              total_aberto: num(c.total_aberto),
              last_scraped_at: c.last_scraped_at ?? null,
              ...(plano
                ? {
                    plano_qt_usuarios: plano.qt_usuarios ?? null,
                    plano_qt_caixas: plano.qt_caixas ?? null,
                    plano_qt_filiais: plano.qt_filiais ?? null,
                  }
                : {}),
              ...(cad
                ? {
                    cad_mensalidade: num(cad.mensalidade),
                    cad_custo: num(cad.custo),
                    cad_repasse: num(cad.repasse),
                    cad_taxa_central: num(cad.taxa_central),
                  }
                : {}),
              ...(ult
                ? {
                    ult_mes: ult.mes ?? null,
                    ult_mensalidade: num(ult.mensalidade),
                    ult_custo: num(ult.custo),
                    ult_a_pagar: num(ult.a_pagar),
                    ult_a_receber: num(ult.a_receber),
                  }
                : {}),
              pull_run_id: runId,
              raw: c,
            });

            // Portal antigo não manda estes campos. Ausente ≠ vazio: sem eles o
            // espelho de módulo/filial simplesmente não é tocado nesta conta.
            for (const m of Array.isArray(c.modulos) ? c.modulos : []) {
              const nome = String(m.nome ?? "").trim();
              if (!nome) continue;
              modulos.set(`${idPortal}|${nome}`, {
                tenant_id: targetTenantId,
                id_portal: idPortal,
                app_nome: nome,
                custo: num(m.custo) ?? 0,
                comprado_por: m.comprado_por ?? null,
                ativo: m.ativo !== false,
                pull_run_id: runId,
              });
            }
            for (const f of Array.isArray(c.filiais) ? c.filiais : []) {
              const cnpj = soDigitos(f.cnpj);
              if (cnpj.length !== 14) continue;
              filiais.set(`${idPortal}|${cnpj}`, {
                tenant_id: targetTenantId,
                id_portal: idPortal,
                cnpj: f.cnpj ?? null,
                cnpj_norm: cnpj,
                nome: f.nome ?? null,
                cidade: f.cidade ?? null,
                uf: f.uf ?? null,
                ativo: f.ativo !== false,
                pull_run_id: runId,
              });
            }
          }
          cursor = body?.next_cursor ?? null;
          paginas++;
        } while (cursor && paginas < MAX_PAGES);
      } catch (e) {
        return await fecharComErro(`Falha de rede ao puxar: ${(e as Error).message}`);
      }

      const truncado = paginas >= MAX_PAGES && !!cursor;
      const temAgregados = modulos.size > 0 || filiais.size > 0;
      const temPlano = Array.from(contas.values()).some((c) => "plano_qt_caixas" in c);
      const temCadastro = Array.from(contas.values()).some((c) => "cad_custo" in c);
      const temUltimo = Array.from(contas.values()).some((c) => "ult_mes" in c);

      // O espelho de cadastro é regravado do zero. Quando o portal não manda os
      // contadores do plano, eles precisam vir do que já está aqui — senão o
      // delete leva junto e as contas perdem os módulos de plano.
      if ((!temPlano || !temCadastro || !temUltimo) && contas.size > 0) {
        const { data: anterior } = await supabase
          .from("hiper_espelho_cadastro")
          .select("id_portal, plano_qt_usuarios, plano_qt_caixas, plano_qt_filiais, cad_mensalidade, cad_custo, cad_repasse, cad_taxa_central, ult_mes, ult_mensalidade, ult_custo, ult_a_pagar, ult_a_receber")
          .eq("tenant_id", targetTenantId);
        for (const a of anterior ?? []) {
          const c = contas.get(String(a.id_portal));
          if (!c) continue;
          if (!temPlano) {
            c.plano_qt_usuarios = a.plano_qt_usuarios;
            c.plano_qt_caixas = a.plano_qt_caixas;
            c.plano_qt_filiais = a.plano_qt_filiais;
          }
          if (!temCadastro) {
            c.cad_mensalidade = a.cad_mensalidade;
            c.cad_custo = a.cad_custo;
            c.cad_repasse = a.cad_repasse;
            c.cad_taxa_central = a.cad_taxa_central;
          }
          if (!temUltimo) {
            c.ult_mes = a.ult_mes;
            c.ult_mensalidade = a.ult_mensalidade;
            c.ult_custo = a.ult_custo;
            c.ult_a_pagar = a.ult_a_pagar;
            c.ult_a_receber = a.ult_a_receber;
          }
        }
      }

      // Snapshot fresco por tenant. Os espelhos de módulo e filial só são
      // apagados quando o portal REALMENTE mandou esses campos — senão um portal
      // desatualizado zeraria o que já tínhamos.
      const gravar = async (tabela: string, linhas: Record<string, unknown>[]) => {
        const { error: delErr } = await supabase.from(tabela).delete().eq("tenant_id", targetTenantId);
        if (delErr) throw new Error(`Falha ao limpar ${tabela}: ${delErr.message}`);
        for (let i = 0; i < linhas.length; i += LOTE_INSERT) {
          const { error: insErr } = await supabase.from(tabela).insert(linhas.slice(i, i + LOTE_INSERT));
          if (insErr) throw new Error(`Falha ao gravar ${tabela}: ${insErr.message}`);
        }
      };

      try {
        await gravar("hiper_espelho_cadastro", Array.from(contas.values()));
        if (temAgregados) {
          await gravar("hiper_espelho_modulo", Array.from(modulos.values()));
          await gravar("hiper_espelho_filial", Array.from(filiais.values()));
        }
      } catch (e) {
        return await fecharComErro((e as Error).message);
      }

      await supabase.from("hiper_integration").update({
        ultimo_status: "ok",
        ultimo_teste_at: new Date().toISOString(),
        ultimo_pull_at: new Date().toISOString(),
        ultimo_pull_run_id: runId,
        puxar_desde: maxScraped,
        ...(ident && !("erro" in ident) && ident.id
          ? { portal_tenant_id: ident.id, portal_tenant_nome: ident.nome }
          : {}),
      }).eq("tenant_id", targetTenantId);

      const { data: recon, error: reconErr } = await supabase.rpc("hiper_reconciliar", {
        p_tenant_id: targetTenantId,
      });
      if (reconErr) return await fecharComErro(`Espelho gravado, mas a reconciliação falhou: ${reconErr.message}`);

      await supabase.from("hiper_sync_run").update({
        status: "ok",
        terminado_em: new Date().toISOString(),
        contas: contas.size,
        modulos: modulos.size,
        filiais: filiais.size,
        paginas,
        truncado,
        recon_pendentes: (recon as { pendentes?: number })?.pendentes ?? null,
        recon_novas: (recon as { novas?: number })?.novas ?? null,
      }).eq("id", runId);

      return json({
        ok: true,
        resultado: {
          run_id: runId,
          contas: contas.size,
          modulos: modulos.size,
          filiais: filiais.size,
          paginas,
          truncado,
          portal_atualizado: temAgregados,
          recon,
        },
      });
    }

    return json({ ok: false, error: `Ação desconhecida: ${acao}` });
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message || "Erro interno" }, 500);
  }
});
