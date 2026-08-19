// ============================================================================
// oem-cancelar-modulo — cancela um módulo da licença no OEM e na ficha.
//
// A ORDEM IMPORTA: primeiro o parceiro, depois aqui. Se a baixa no OEM falha,
// nada muda em lugar nenhum e a pessoa vê o motivo — é o único jeito de os
// dois lados não se contradizerem. Ao contrário, a ficha diria "cancelado" e o
// OEM continuaria cobrando sem ninguém saber.
//
// A chave do DoctorOEM nunca sai daqui: o navegador chama esta função, ela lê
// a chave do Vault e conversa com o parceiro. É o mesmo desenho da
// `oem-espelho-sync`.
//
// TODA tentativa vira linha em `oem_baixa_modulo_log`, inclusive a recusa —
// escrita em sistema de terceiro sem registro não se audita depois.
// ============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const ds: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, mensagem: "Sem token de autenticação." }, 401);

    // O cancelamento é ato de pessoa: nada de service_role aqui. O RPC lá
    // embaixo roda COM ESTE TOKEN, e é assim que o histórico sabe quem foi.
    const comoUsuario = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
    );
    const { data: u, error: errU } = await comoUsuario.auth.getUser();
    if (errU || !u?.user) return json({ ok: false, mensagem: "Token inválido." }, 401);

    const corpo = await req.json().catch(() => ({} as Record<string, unknown>));
    const moduloId = String(corpo.modulo_id ?? "");
    const quantidade = Number(corpo.quantidade ?? 0) || null;
    const motivo = typeof corpo.motivo === "string" ? corpo.motivo.trim() || null : null;
    const simular = corpo.simular === true;
    if (!moduloId) return json({ ok: false, mensagem: "Informe modulo_id." }, 400);

    // ------------------------------------------------------------ contexto
    const { data: linha, error: errL } = await ds
      .from("cliente_produto_modulos")
      .select("id, tenant_id, cliente_produto_id, modulo_id, quantidade, ativo, origem, oem_modulo_codigo")
      .eq("id", moduloId)
      .maybeSingle();
    if (errL || !linha) return json({ ok: false, mensagem: "Módulo não encontrado." }, 404);
    if (linha.ativo === false) return json({ ok: false, mensagem: "Este módulo já está cancelado." }, 409);

    const { data: cp } = await ds
      .from("cliente_produtos")
      .select("id, oem_codigo_grupo, oem_codigo_filial")
      .eq("id", linha.cliente_produto_id)
      .maybeSingle();

    // Duas ações pela mesma porta, porque no OEM é a mesma escrita: a licença
    // é gravada inteira e o que muda é a quantidade do módulo. Cancelar é
    // reduzir até zero; somar um usuário é subir de 1 para 2.
    const acao = corpo.acao === "quantidade" ? "quantidade" : "cancelar";
    const atual = Math.max(Number(linha.quantidade) || 1, 1);
    const cancelar = acao === "cancelar"
      ? Math.min(Math.max(quantidade ?? atual, 1), atual)
      : 0;
    const novaQtd = acao === "cancelar"
      ? atual - cancelar
      : Math.max(Number(corpo.nova_quantidade) || 0, 1);

    if (acao === "quantidade" && novaQtd === atual) {
      return json({ ok: false, mensagem: "A quantidade informada é a mesma que já está na licença." }, 400);
    }

    // Módulo digitado à mão não tem licença no parceiro: cancela só aqui, sem
    // inventar uma baixa que não existe.
    const temLicenca = linha.origem === "oem" && !!cp?.oem_codigo_filial && !!linha.oem_modulo_codigo;

    let respostaOem: unknown = null;
    let okOem = true;
    let httpOem: number | null = null;

    if (temLicenca) {
      const { data: conta } = await ds
        .from("oem_integration")
        .select("id, api_url")
        .eq("tenant_id", linha.tenant_id)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      if (!conta) return json({ ok: false, mensagem: "Nenhuma conta OEM ativa neste tenant." }, 409);

      const { data: chave, error: errK } = await ds.rpc("obter_chave_oem_por_conta", {
        p_integration_id: conta.id,
      });
      if (errK || !chave) return json({ ok: false, mensagem: "Chave do OEM não encontrada no Vault." }, 409);

      const resp = await fetch(
        `${String(conta.api_url).replace(/\/+$/, "")}/oem-licenca-modulo`,
        {
          method: "POST",
          headers: { "x-api-key": String(chave), "Content-Type": "application/json" },
          body: JSON.stringify({
            empresa: cp!.oem_codigo_grupo,
            filial: cp!.oem_codigo_filial,
            modulo_codigo: linha.oem_modulo_codigo,
            nova_quantidade: novaQtd,
            simular,
          }),
        },
      );
      httpOem = resp.status;
      respostaOem = await resp.json().catch(() => null);
      okOem = resp.ok && (respostaOem as Record<string, unknown> | null)?.ok === true;

      await ds.from("oem_baixa_modulo_log").insert({
        tenant_id: linha.tenant_id,
        cliente_produto_id: linha.cliente_produto_id,
        modulo_id: linha.modulo_id,
        empresa_codigo: cp!.oem_codigo_grupo,
        filial_codigo: cp!.oem_codigo_filial,
        oem_modulo_codigo: linha.oem_modulo_codigo,
        quantidade_pedida: cancelar,
        nova_quantidade: novaQtd,
        simulado: simular,
        ok: okOem,
        http: httpOem,
        resposta: respostaOem,
        usuario_id: u.user.id,
      });

      if (!okOem) {
        const r = respostaOem as Record<string, unknown> | null;
        return json({
          ok: false,
          etapa: "oem",
          // A mensagem sobe inteira: "faltou codigoTipoNegocio" e "o parceiro
          // recusou" pedem providências diferentes, e resumir apaga a diferença.
          mensagem: String(r?.mensagem ?? "O OEM recusou a baixa."),
          detalhe: r,
          http: httpOem,
        }, 502);
      }
      if (simular) {
        return json({ ok: true, simulado: true, oem: respostaOem });
      }
    }

    // ------------------------------------------------------------- na ficha
    if (acao === "quantidade") {
      // `quantidade_manual` segura a nova quantidade até o espelho confirmar;
      // a própria sincronização a limpa quando o OEM devolver o mesmo número.
      const { error: errQ } = await comoUsuario
        .from("cliente_produto_modulos")
        .update({ quantidade: novaQtd, quantidade_manual: novaQtd, updated_at: new Date().toISOString() })
        .eq("id", moduloId);
      if (errQ) {
        return json({
          ok: false, etapa: "ficha",
          mensagem: `A licença foi alterada no OEM, mas a ficha não: ${errQ.message}. A próxima carga do espelho corrige.`,
        }, 500);
      }
      return json({ ok: true, quantidade: novaQtd, oem: respostaOem, baixa_no_oem: temLicenca });
    }

    const { data: resultado, error: errR } = await comoUsuario.rpc("fn_cancelar_modulo_cliente", {
      p_id: moduloId,
      p_quantidade: cancelar,
      p_motivo: motivo,
    });
    if (errR) {
      return json({
        ok: false,
        etapa: "ficha",
        mensagem: `A baixa no OEM foi feita, mas a ficha não: ${errR.message}. A próxima carga do espelho corrige.`,
      }, 500);
    }

    return json({ ok: true, ficha: resultado, oem: respostaOem, baixa_no_oem: temLicenca });
  } catch (e) {
    return json({ ok: false, mensagem: e instanceof Error ? e.message : String(e) }, 500);
  }
});
