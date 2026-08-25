// ============================================================================
// oem-atualizar-cadastro-licenca — manda para o OEM o nome ou o CNPJ que o
// DoctorSaaS tem, quando quem está desatualizado é o parceiro.
//
// É o espelho do botão "Atualizar no DoctorSaaS": lá a ficha recebe o valor do
// OEM; aqui a licença recebe o valor da ficha. A tela oferece os dois porque a
// divergência não diz sozinha qual lado está certo — quem sabe é a pessoa.
//
// A chave do DoctorOEM nunca sai daqui: o navegador chama esta função, ela lê
// a chave do Vault e conversa com o parceiro. Mesmo desenho da
// `oem-cancelar-modulo` e da `oem-espelho-sync`.
//
// O VALOR VEM DO BANCO, NÃO DO NAVEGADOR. A tela manda só qual linha e qual
// campo; o que vai para o parceiro é lido de `clientes` aqui dentro. Aceitar o
// texto do cliente seria deixar qualquer um gravar qualquer coisa no cadastro
// do OEM através da nossa chave.
//
// Nada muda no DoctorSaaS depois. A ficha já está certa — é o OEM que estava
// errado — e o espelho confirma na próxima carga. Por isso não há a "ordem
// OEM primeiro, ficha depois" da baixa de módulo: aqui só existe um lado.
//
// TODA tentativa vira linha em `oem_cadastro_licenca_log`, inclusive a recusa
// e a simulação.
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

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

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

    const comoUsuario = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
    );
    const { data: u, error: errU } = await comoUsuario.auth.getUser();
    if (errU || !u?.user) return json({ ok: false, mensagem: "Token inválido." }, 401);

    const corpo = await req.json().catch(() => ({} as Record<string, unknown>));
    const reconId = String(corpo.recon_id ?? "");
    const campo = corpo.campo === "cnpj" ? "cnpj" : corpo.campo === "nome" ? "nome" : null;
    const simular = corpo.simular === true;
    if (!reconId || !campo) {
      return json({ ok: false, mensagem: 'Informe recon_id e campo ("nome" ou "cnpj").' }, 400);
    }

    // ------------------------------------------------------------ contexto
    const { data: linha, error: errL } = await ds
      .from("reconciliacao_oem")
      .select("id, tenant_id, conta_integration_id, empresa_codigo, filial_codigo, ds_customer_id, razao_oem, cnpj_norm")
      .eq("id", reconId)
      .maybeSingle();
    if (errL || !linha) {
      return json({ ok: false, mensagem: "Linha da conferência não encontrada. Atualize o espelho." }, 404);
    }
    if (!linha.ds_customer_id) {
      return json({ ok: false, mensagem: "Esta licença ainda não tem cliente no DoctorSaaS." }, 409);
    }
    if (!linha.empresa_codigo || !linha.filial_codigo) {
      return json({ ok: false, mensagem: "A linha não tem grupo/filial do OEM para escrever." }, 409);
    }

    // A permissão roda COM O TOKEN DA PESSOA: é a mesma régua das outras
    // decisões da aba, e é `pode_decidir_oem` que a define.
    const { data: pode, error: errP } = await comoUsuario.rpc("pode_decidir_oem", {
      p_tenant_id: linha.tenant_id,
    });
    if (errP || pode !== true) {
      return json({ ok: false, mensagem: "Sem permissão para decidir divergências do OEM." }, 403);
    }

    // ------------------------------------------------- o valor sai do banco
    const { data: cliente } = await ds
      .from("clientes")
      .select("id, nome_fantasia, razao_social, cnpj")
      .eq("id", linha.ds_customer_id)
      .maybeSingle();
    if (!cliente) return json({ ok: false, mensagem: "Cliente não encontrado." }, 404);

    // Nome: o mesmo campo que a conferência compara (nome fantasia, com a
    // razão social como reserva). Enviar a razão quando a comparação é de
    // fantasia resolveria outra divergência que não é esta.
    const valorNovo = campo === "cnpj"
      ? digitos(cliente.cnpj)
      : String(cliente.nome_fantasia ?? cliente.razao_social ?? "").trim();

    if (!valorNovo) {
      return json({
        ok: false,
        mensagem: campo === "cnpj"
          ? "A ficha deste cliente não tem CNPJ para mandar ao OEM."
          : "A ficha deste cliente não tem nome para mandar ao OEM.",
      }, 409);
    }
    if (campo === "cnpj" && valorNovo.length !== 11 && valorNovo.length !== 14) {
      return json({
        ok: false,
        mensagem: `O CNPJ da ficha tem ${valorNovo.length} dígitos. Corrija o cadastro antes de mandar ao parceiro.`,
      }, 409);
    }

    // --------------------------------------------------------------- o OEM
    const { data: conta } = await ds
      .from("oem_integration")
      .select("id, api_url")
      .eq("id", linha.conta_integration_id)
      .maybeSingle();
    if (!conta) return json({ ok: false, mensagem: "Conta do OEM não encontrada." }, 409);

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
          empresa: linha.empresa_codigo,
          filial: linha.filial_codigo,
          ...(campo === "cnpj" ? { novo_cnpj: valorNovo } : { novo_nome: valorNovo }),
          simular,
        }),
      },
    );
    const http = resp.status;
    const respostaOem = await resp.json().catch(() => null) as Record<string, unknown> | null;
    const ok = resp.ok && respostaOem?.ok === true;

    // O "antes" que vale é o que o parceiro tinha na hora da leitura, não o
    // que o espelho daqui achava. A função de lá devolve os dois campos.
    const antes = (respostaOem?.antes ?? null) as Record<string, unknown> | null;
    const valorAnterior = campo === "cnpj"
      ? (antes?.cpfCnpj == null ? null : String(antes.cpfCnpj))
      : (antes?.nomeLoja == null ? null : String(antes.nomeLoja));

    await ds.from("oem_cadastro_licenca_log").insert({
      tenant_id: linha.tenant_id,
      conta_integration_id: conta.id,
      cliente_id: cliente.id,
      empresa_codigo: linha.empresa_codigo,
      filial_codigo: linha.filial_codigo,
      campo,
      valor_anterior: valorAnterior,
      valor_novo: valorNovo,
      simulado: simular,
      ok,
      http,
      resposta: respostaOem,
      usuario_id: u.user.id,
    });

    if (!ok) {
      return json({
        ok: false,
        etapa: "oem",
        // A mensagem sobe inteira: "faltou codigoTipoNegocio" e "o parceiro
        // recusou" pedem providências diferentes, e resumir apaga a diferença.
        mensagem: String(respostaOem?.mensagem ?? "O OEM recusou a alteração."),
        detalhe: respostaOem,
        http,
      }, 502);
    }

    // A MESMA fotografia desatualizada que mordeu do outro lado (ver a migration
    // 20260825120000): a aba lê `reconciliacao_oem`, não o parceiro. Sem isto a
    // linha continuaria na tela com o nome antigo até a próxima carga, logo
    // depois de a tela dizer que atualizou.
    //
    // Só o NOME. `cnpj_norm` é o documento do parceiro E chave de match em meia
    // dúzia de consultas; e aqui, ao contrário do lado DS, o valor não foi
    // relido do OEM — foi o que mandamos e ele aceitou. Trocar uma chave com
    // base nisso é apostar. Para CNPJ, quem confirma é a próxima carga.
    if (!simular && campo === "nome" && respostaOem?.sem_mudanca !== true) {
      await ds.from("reconciliacao_oem")
        .update({ razao_oem: valorNovo })
        .eq("tenant_id", linha.tenant_id)
        .eq("filial_codigo", linha.filial_codigo);
      // O array sai por RPC: PostgREST não tem array_remove, e ler-modificar-
      // gravar aqui abriria corrida com a carga do espelho.
      await ds.rpc("oem_tirar_divergencia_da_linha", {
        p_recon_id: linha.id, p_tipo: "nome",
      });
    }

    return json({
      ok: true,
      simulado: simular,
      campo,
      // sem_mudanca = o parceiro já estava com esse valor. A divergência sai
      // sozinha na próxima carga do espelho.
      sem_mudanca: respostaOem?.sem_mudanca === true,
      valor_anterior: valorAnterior,
      valor_novo: valorNovo,
      oem: respostaOem,
    });
  } catch (e) {
    return json({ ok: false, mensagem: e instanceof Error ? e.message : String(e) }, 500);
  }
});
