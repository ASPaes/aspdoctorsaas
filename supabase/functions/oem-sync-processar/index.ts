// oem-sync-processar
//
// Tira as linhas pendentes da oem_sync_fila e manda cada uma para a licença do
// parceiro. É o único caminho de escrita DS -> OEM: quem quer mexer na licença
// enfileira (fn_oem_enfileirar) e quem grava é aqui.
//
// Chamada por dois lados, e os dois passam pela mesma checagem:
//   - o cron (cron_oem_sync), de 2 em 2 minutos, com o segredo do Vault;
//   - a tela, logo depois de enfileirar, para não fazer ninguém esperar 2
//     minutos pelo caminho feliz. Aí vem o JWT de quem clicou.
//
// verify_jwt = false no config.toml de propósito: o Bearer do cron NÃO é um
// JWT, e o gateway recusaria antes de chegar aqui. A autenticação acontece
// abaixo, e é ela que vale.

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

type Linha = {
  id: string;
  tenant_id: string;
  cliente_produto_id: string | null;
  modulo_linha_id: string | null;
  acao: string;
  empresa_codigo: string | null;
  filial_codigo: string | null;
  oem_modulo_codigo: number | null;
  quantidade: number | null;
  valor_unitario: number | null;
  tentativas: number;
};

// Espera entre tentativas, em minutos, indexada por número de tentativas já
// feitas. Depois da última a linha vira 'invalido' e para de consumir chamada.
const ESPERA = [2, 5, 15, 60];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const ds: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    if (!token) return json({ ok: false, mensagem: "Sem token." }, 401);

    // 1) É o cron? O segredo vive no Vault e é conferido lá dentro — ele não
    //    trafega para cá em momento nenhum.
    const { data: ehCron } = await ds.rpc("fn_oem_cron_secret_ok", { p_token: token });
    let autorizado = ehCron === true;

    // 2) Não sendo o cron, tem que ser gente com permissão.
    if (!autorizado) {
      const comoUsuario = createClient(
        Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
      );
      const { data: u } = await comoUsuario.auth.getUser();
      if (u?.user) {
        const { data: perfil } = await ds
          .from("profiles")
          .select("role, is_super_admin")
          .eq("user_id", u.user.id)
          .maybeSingle();
        autorizado = perfil?.is_super_admin === true
          || perfil?.role === "admin" || perfil?.role === "head";
      }
    }
    if (!autorizado) return json({ ok: false, mensagem: "Não autorizado." }, 401);

    const corpo = await req.json().catch(() => ({} as Record<string, unknown>));
    const limite = Math.min(Math.max(Number(corpo.limite ?? 20) || 20, 1), 50);
    // Uma linha só, pedida pelo clique que acabou de enfileirar: quem cancelou
    // um módulo não pode esperar os 2 minutos do cron para saber o resultado.
    const filaId = typeof corpo.fila_id === "string" ? corpo.fila_id : null;

    // ------------------------------------------------------------- simular
    // Mostra o payload que IRIA para a licença, sem gravar nada — nem no
    // parceiro, nem na fila, nem no log. A rota do parceiro tem `simular` e é
    // ela que monta o payload de verdade; simular por aqui, remontando à mão,
    // provaria só que os dois códigos concordam entre si.
    //
    // A linha NÃO é reivindicada: simular não pode consumir uma tentativa nem
    // tirar a linha da fila.
    if (corpo.simular === true) {
      if (!filaId) return json({ ok: false, mensagem: "Informe fila_id para simular." }, 400);

      const { data: l, error: errL } = await ds
        .from("oem_sync_fila")
        .select("tenant_id, empresa_codigo, filial_codigo, oem_modulo_codigo, quantidade, valor_unitario")
        .eq("id", filaId)
        .maybeSingle();
      if (errL || !l) return json({ ok: false, mensagem: "Linha não encontrada." }, 404);

      const { data: c } = await ds
        .from("oem_integration")
        .select("id, api_url")
        .eq("tenant_id", l.tenant_id)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      if (!c) return json({ ok: false, mensagem: "Nenhuma conta OEM ativa neste tenant." }, 409);
      const { data: chave } = await ds.rpc("obter_chave_oem_por_conta", { p_integration_id: c.id });
      if (!chave) return json({ ok: false, mensagem: "Chave do OEM não encontrada no Vault." }, 409);

      const resp = await fetch(`${String(c.api_url).replace(/\/+$/, "")}/oem-licenca-modulo`, {
        method: "POST",
        headers: { "x-api-key": String(chave), "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa: l.empresa_codigo,
          filial: l.filial_codigo,
          modulo_codigo: l.oem_modulo_codigo,
          nova_quantidade: Number(l.quantidade ?? 0),
          ...(l.valor_unitario != null ? { valor_unitario: Number(l.valor_unitario) } : {}),
          simular: true,
        }),
      });
      const corpoResp = await resp.json().catch(() => null);
      return json({ ok: resp.ok, simulado: true, http: resp.status, resposta: corpoResp });
    }

    const { data: linhas, error: errC } = await ds.rpc("fn_oem_fila_claim", {
      p_limite: filaId ? 1 : limite,
      p_id: filaId,
    });
    if (errC) return json({ ok: false, mensagem: `Não deu para pegar a fila: ${errC.message}` }, 500);

    const fila = (linhas ?? []) as Linha[];
    if (fila.length === 0) return json({ ok: true, processadas: 0, ok_count: 0, erros: 0 });

    // A conta e a chave são por tenant e a fila costuma vir do mesmo cliente;
    // buscar por linha seria repetir a mesma leitura do Vault N vezes.
    const contas = new Map<string, { api_url: string; chave: string } | null>();
    async function conta(tenantId: string) {
      if (contas.has(tenantId)) return contas.get(tenantId)!;
      const { data: c } = await ds
        .from("oem_integration")
        .select("id, api_url")
        .eq("tenant_id", tenantId)
        .eq("ativo", true)
        .limit(1)
        .maybeSingle();
      if (!c) { contas.set(tenantId, null); return null; }
      const { data: chave } = await ds.rpc("obter_chave_oem_por_conta", { p_integration_id: c.id });
      if (!chave) { contas.set(tenantId, null); return null; }
      const v = { api_url: String(c.api_url).replace(/\/+$/, ""), chave: String(chave) };
      contas.set(tenantId, v);
      return v;
    }

    let okCount = 0, erros = 0;

    for (const l of fila) {
      // Falta de dado não é falha temporária: repetir não conserta. A linha para
      // como 'invalido' e o motivo fica escrito.
      if (!l.empresa_codigo || !l.filial_codigo || !l.oem_modulo_codigo) {
        await ds.from("oem_sync_fila").update({
          status: "invalido",
          ultimo_erro: "Linha sem empresa, filial ou código do módulo no OEM.",
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
        erros++;
        continue;
      }

      const c = await conta(l.tenant_id);
      if (!c) {
        await ds.from("oem_sync_fila").update({
          status: "invalido",
          ultimo_erro: "Nenhuma conta OEM ativa neste tenant, ou chave ausente no Vault.",
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
        erros++;
        continue;
      }

      const novaQtd = Number(l.quantidade ?? 0);
      let resposta: unknown = null;
      let http: number | null = null;
      let sucesso = false;
      let motivo = "";

      try {
        const resp = await fetch(`${c.api_url}/oem-licenca-modulo`, {
          method: "POST",
          headers: { "x-api-key": c.chave, "Content-Type": "application/json" },
          body: JSON.stringify({
            empresa: l.empresa_codigo,
            filial: l.filial_codigo,
            modulo_codigo: l.oem_modulo_codigo,
            nova_quantidade: novaQtd,
            // Só serve para acrescentar módulo que ainda não está na licença; o
            // parceiro recusa incluir sem preço.
            ...(l.valor_unitario != null ? { valor_unitario: Number(l.valor_unitario) } : {}),
          }),
        });
        http = resp.status;
        resposta = await resp.json().catch(() => null);
        const r = resposta as Record<string, unknown> | null;
        sucesso = resp.ok && r?.ok === true;
        if (!sucesso) {
          motivo = String(r?.mensagem ?? r?.erro ?? `HTTP ${resp.status}`);
        }
      } catch (e) {
        motivo = e instanceof Error ? e.message : String(e);
      }

      // O log de tentativas já existia para o cancelamento; a fila escreve nele
      // também, para não haver dois históricos contando a mesma coisa.
      await ds.from("oem_baixa_modulo_log").insert({
        tenant_id: l.tenant_id,
        cliente_produto_id: l.cliente_produto_id,
        empresa_codigo: l.empresa_codigo,
        filial_codigo: l.filial_codigo,
        oem_modulo_codigo: l.oem_modulo_codigo,
        nova_quantidade: novaQtd,
        simulado: false,
        ok: sucesso,
        http,
        resposta: resposta as Record<string, unknown> | null,
      });

      if (sucesso) {
        // O parceiro aceitou. SÓ AGORA a ficha muda — é esta ordem que impede
        // as duas bases de divergirem, e é a mesma de antes da fila existir.
        //
        // Se a gravação daqui falhar, a linha NÃO volta para 'erro': repetir
        // reenviaria ao OEM uma baixa que ele já fez. Fica 'invalido' com o
        // motivo, para gente decidir.
        const { data: aplic, error: errA } = await ds.rpc("fn_oem_fila_aplicar", { p_id: l.id });
        if (errA) {
          erros++;
          await ds.from("oem_sync_fila").update({
            status: "invalido",
            ultimo_erro: `O OEM aceitou, mas a ficha não foi atualizada: ${errA.message}`,
            resposta: resposta as Record<string, unknown> | null,
            http,
            processado_em: new Date().toISOString(),
          }).eq("id", l.id);
          continue;
        }
        okCount++;
        await ds.from("oem_sync_fila").update({
          status: "ok",
          ultimo_erro: null,
          resposta: {
            oem: resposta as Record<string, unknown> | null,
            ficha: aplic as Record<string, unknown> | null,
          },
          http,
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
        continue;
      }

      erros++;
      const espera = ESPERA[l.tentativas - 1];
      if (espera === undefined) {
        // Esgotou. Fica visível e parada, esperando decisão de gente — repetir
        // para sempre só enche o log e a fatura.
        await ds.from("oem_sync_fila").update({
          status: "invalido",
          ultimo_erro: `${motivo} (desistiu após ${l.tentativas} tentativas)`,
          resposta: resposta as Record<string, unknown> | null,
          http,
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
      } else {
        await ds.from("oem_sync_fila").update({
          status: "erro",
          ultimo_erro: motivo,
          resposta: resposta as Record<string, unknown> | null,
          http,
          proxima_tentativa_em: new Date(Date.now() + espera * 60_000).toISOString(),
          processado_em: new Date().toISOString(),
        }).eq("id", l.id);
      }
    }

    return json({ ok: true, processadas: fila.length, ok_count: okCount, erros });
  } catch (e) {
    return json({ ok: false, mensagem: e instanceof Error ? e.message : String(e) }, 500);
  }
});
