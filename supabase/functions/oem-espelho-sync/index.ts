// ============================================================================
// oem-espelho-sync — traz as filiais do DoctorOEM para o espelho e monta o de/para
//
// FLUXO
//   DoctorOEM (oem-exportar, autenticado por chave)
//     -> oem_espelho_filial   (cópia aqui, para poder cruzar com `clientes`)
//     -> reconciliacao_oem    (o vínculo filial <-> cliente)
//
// UMA CONTA POR UNIDADE BASE, igual ao Omie.
// O tenant Digi Office tem 4 unidades e já tem duas contas Omie. Cada conta OEM
// tem chave, espelho e de/para próprios — e nada de uma pode aparecer na outra.
// Por isso tudo aqui é percorrido por CONTA, e os clientes de cada conta são
// filtrados por `unidade_base_id = any(unidades_base_ids)`. Sem esse filtro, as
// filiais da Digi Up casariam com clientes da Digi Office.
//
// A CHAVE NÃO ESTÁ EM COLUNA NENHUMA. Ela vive no Vault e sai por
// obter_chave_oem_por_conta(id), que só o service_role executa.
//
// Esta função NÃO fala com a API do OEM. Quem faz isso é o motor do DoctorOEM
// (oem-sync-passo, lá). Aqui só trazemos o que ele já apurou — uma fonte só.
// ============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

type FilialOem = {
  empresa_codigo: string | null; filial_codigo: string | null;
  nome_fantasia: string | null; razao_social: string | null; grupo_economico: string | null;
  cnpj_cpf: string | null; produto_principal: string | null;
  status: string | null; bloqueado: boolean | null; custo_total: number | null;
  qtd_pdv: number | null; qtd_comandas: number | null; usuarios_adicionais: number | null;
  numero_filiais: number | null; modulos_ativos: unknown; last_sync: string | null;
};

type ClienteDs = {
  id: string; nome_fantasia: string | null; razao_social: string | null;
  cnpj_digits: string | null; cnpj: string | null;
  mensalidade: number | null; cancelado: boolean | null;
};

type Conta = {
  id: string; tenant_id: string;
  unidades_base_ids: number[] | null; api_url: string;
};

/** Lê tudo paginando — PostgREST corta em 1000 sem avisar. */
async function lerTudo<T>(query: (de: number, ate: number) => any): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; de < 100_000; de += 1000) {
    const { data, error } = await query(de, de + 999);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    tudo.push(...lote);
    if (lote.length < 1000) break;
  }
  return tudo;
}

/**
 * verify_jwt garante apenas que quem chamou está logado — e esta função roda
 * com service_role, que ignora RLS. Sem esta checagem, qualquer usuário do
 * sistema poderia disparar a recarga do espelho de qualquer empresa.
 */
async function exigirAdmin(req: Request, ds: SupabaseClient): Promise<void> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sem token de autenticação.");

  // Chamada de máquina (agendamento) apresenta a service_role. Não é uma
  // pessoa, não há perfil para checar. Comparar com a variável de ambiente não
  // basta: o projeto tem chave legada (JWT) e nova (sb_secret_), e a injetada
  // pode ser a outra — então olhamos o que o próprio token declara.
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return;
  try {
    const p = token.split(".");
    if (p.length === 3) {
      const payload = JSON.parse(atob(p[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (payload?.role === "service_role") return;
    }
  } catch { /* não era JWT; cai na checagem de usuário */ }

  const comoUsuario = createClient(
    Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data: u, error } = await comoUsuario.auth.getUser();
  if (error || !u?.user) throw new Error("Token inválido.");

  const { data: perfil } = await ds.from("profiles")
    .select("role, is_super_admin").eq("user_id", u.user.id).maybeSingle();
  if (!(perfil?.is_super_admin === true || ["admin", "head"].includes(String(perfil?.role)))) {
    throw new Error("Apenas administradores podem atualizar o espelho do OEM.");
  }
}

Deno.serve(async (req) => {
  const inicio = Date.now();
  try {
    const ds = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    await exigirAdmin(req, ds);

    const corpoReq = await req.json().catch(() => ({} as Record<string, unknown>));
    const soConta = typeof corpoReq.contaId === "string" ? corpoReq.contaId : null;

    let q = ds.from("oem_integration")
      .select("id, tenant_id, unidades_base_ids, api_url").eq("ativo", true);
    if (soConta) q = q.eq("id", soConta);
    const { data: contas, error: errC } = await q;
    if (errC) throw new Error(`oem_integration: ${errC.message}`);
    if (!contas?.length) {
      return Response.json({
        ok: true, duracaoMs: Date.now() - inicio, resultados: [],
        mensagem: "Nenhuma conta OEM configurada. Configure em Integrações › OEM › Conexão.",
      });
    }

    const resultados: Record<string, unknown>[] = [];

    for (const conta of contas as Conta[]) {
      const marcarErro = async (msg: string) => {
        await ds.from("oem_integration").update({
          ultimo_sync_em: new Date().toISOString(),
          ultimo_sync_status: "erro", ultimo_sync_msg: String(msg).slice(0, 400),
        }).eq("id", conta.id);
        resultados.push({ contaId: conta.id, erro: msg });
      };

      // ---------------------------------------------- 1. chave, do Vault
      const { data: chave, error: errK } = await ds.rpc("obter_chave_oem_por_conta", {
        p_integration_id: conta.id,
      });
      if (errK || !chave) { await marcarErro("Chave não encontrada no Vault."); continue; }

      // ---------------------------------------------- 2. filiais desta conta
      const resp = await fetch(`${String(conta.api_url).replace(/\/+$/, "")}/oem-exportar`, {
        method: "POST",
        headers: { "x-api-key": String(chave), "Content-Type": "application/json" },
        body: "{}",
      });
      const corpo = await resp.json().catch(() => null);
      if (!resp.ok || !corpo?.ok) {
        await marcarErro(corpo?.mensagem ?? `HTTP ${resp.status}`);
        continue;
      }
      const filiais = (corpo.filiais ?? []) as FilialOem[];

      const linhas = filiais.filter((f) => f.filial_codigo).map((f) => ({
        tenant_id: conta.tenant_id,
        conta_integration_id: conta.id,
        empresa_codigo: f.empresa_codigo ?? "",
        filial_codigo: String(f.filial_codigo),
        grupo_economico: f.grupo_economico, nome_fantasia: f.nome_fantasia,
        razao_social: f.razao_social, cnpj_oem: f.cnpj_cpf,
        cnpj_norm: digitos(f.cnpj_cpf) || null,
        produto_principal: f.produto_principal,
        status: f.status, bloqueado: f.bloqueado === true,
        custo_total: f.custo_total, qtd_pdv: f.qtd_pdv, qtd_comandas: f.qtd_comandas,
        usuarios_adicionais: f.usuarios_adicionais, numero_filiais: f.numero_filiais,
        modulos: f.modulos_ativos, last_sync_oem: f.last_sync,
        atualizado_em: new Date().toISOString(),
      }));

      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await ds.from("oem_espelho_filial")
          .upsert(linhas.slice(i, i + 500), { onConflict: "conta_integration_id,filial_codigo" });
        if (error) throw new Error(`oem_espelho_filial: ${error.message}`);
      }

      // Filial que sumiu do OEM sai do espelho — senão vira órfã silenciosa.
      const vivos = new Set(linhas.map((l) => l.filial_codigo));
      const atuais = await lerTudo<{ filial_codigo: string }>((a, b) =>
        ds.from("oem_espelho_filial").select("filial_codigo")
          .eq("conta_integration_id", conta.id).range(a, b));
      const mortas = atuais.map((r) => r.filial_codigo).filter((c) => !vivos.has(c));
      if (mortas.length) {
        await ds.from("oem_espelho_filial").delete()
          .eq("conta_integration_id", conta.id).in("filial_codigo", mortas);
      }

      // -------------------------------- 3. clientes DESTA conta (por unidade)
      const unidades = conta.unidades_base_ids ?? [];
      const clientes = await lerTudo<ClienteDs>((a, b) => {
        let c = ds.from("clientes")
          .select("id, nome_fantasia, razao_social, cnpj_digits, cnpj, mensalidade, cancelado")
          .eq("tenant_id", conta.tenant_id).order("id").range(a, b);
        // Sem unidades definidas a conta atende o tenant inteiro; com elas,
        // só os clientes daquelas unidades entram no de/para.
        if (unidades.length) c = c.in("unidade_base_id", unidades);
        return c;
      });

      const porCnpj = new Map<string, ClienteDs[]>();
      for (const c of clientes) {
        const k = c.cnpj_digits || digitos(c.cnpj);
        if (!k) continue;
        if (!porCnpj.has(k)) porCnpj.set(k, []);
        porCnpj.get(k)!.push(c);
      }

      // ---------------------- 4. preserva as decisões humanas já tomadas
      const antigas = await lerTudo<any>((a, b) =>
        ds.from("reconciliacao_oem")
          .select("filial_codigo, ds_customer_id, candidato_escolhido, status_usuario, observacao, resolvido_em, resolvido_por")
          .eq("conta_integration_id", conta.id).neq("status_usuario", "novo").range(a, b));
      const decidido = new Map<string, any>();
      for (const d of antigas) if (d.filial_codigo) decidido.set(String(d.filial_codigo), d);

      // ------------------------------------------------ 5. monta o de/para
      await ds.from("reconciliacao_oem").delete().eq("conta_integration_id", conta.id);

      const recon: Record<string, unknown>[] = [];
      const comFilial = new Set<string>();

      for (const l of linhas) {
        const cands = l.cnpj_norm ? (porCnpj.get(l.cnpj_norm) ?? []) : [];
        // Cliente ativo tem preferência: o cancelado costuma ser cadastro velho.
        const ativos = cands.filter((c) => !c.cancelado);
        const escolha = ativos.length === 1 ? ativos[0] : cands.length === 1 ? cands[0] : null;
        const anterior = decidido.get(l.filial_codigo);

        let estado: string, acao: string, alvo: ClienteDs | null = escolha;
        if (cands.length === 0) { estado = "SO_NO_OEM"; acao = "criar_cliente"; }
        else if (escolha) { estado = "CASADO"; acao = "vinculo_auto_ok"; }
        else { estado = "AMBIGUO"; acao = "escolher_candidato"; alvo = null; }

        // Decisão humana anterior sempre vence a sugestão automática.
        if (anterior?.ds_customer_id) {
          alvo = cands.find((c) => c.id === anterior.ds_customer_id)
            ?? ({ id: anterior.ds_customer_id } as ClienteDs);
        }
        if (alvo?.id) comFilial.add(alvo.id);
        const cli = alvo && "mensalidade" in alvo ? alvo : cands.find((c) => c.id === alvo?.id) ?? null;

        recon.push({
          tenant_id: conta.tenant_id, conta_integration_id: conta.id,
          cnpj_norm: l.cnpj_norm, empresa_codigo: l.empresa_codigo,
          filial_codigo: l.filial_codigo, razao_oem: l.nome_fantasia,
          custo_oem: l.custo_total, status_oem: l.status, bloqueado_oem: l.bloqueado,
          ds_customer_id: alvo?.id ?? null,
          razao_ds: cli?.nome_fantasia ?? cli?.razao_social ?? null,
          mensalidade_ds: cli?.mensalidade ?? null, cancelado_ds: cli?.cancelado ?? null,
          qtd_candidatos_ds: cands.length,
          estado_match: estado, acao_sugerida: acao,
          status_usuario: anterior?.status_usuario ?? (estado === "CASADO" ? "vinculado" : "novo"),
          candidato_escolhido: anterior?.candidato_escolhido ?? null,
          observacao: anterior?.observacao ?? null,
          resolvido_em: anterior?.resolvido_em ?? null,
          resolvido_por: anterior?.resolvido_por ?? null,
        });
      }

      // Clientes desta conta sem nenhuma filial — senão some do diagnóstico
      // quem está sendo cobrado sem licença.
      for (const c of clientes) {
        if (comFilial.has(c.id)) continue;
        const k = c.cnpj_digits || digitos(c.cnpj);
        if (k && linhas.some((l) => l.cnpj_norm === k)) continue;
        recon.push({
          tenant_id: conta.tenant_id, conta_integration_id: conta.id,
          cnpj_norm: k || null, ds_customer_id: c.id,
          razao_ds: c.nome_fantasia ?? c.razao_social,
          mensalidade_ds: c.mensalidade, cancelado_ds: c.cancelado,
          // Cliente sem filial não tem o que escolher — marcá-lo como
          // "escolher_candidato" enchia a fila de decisão com centenas de
          // linhas sem filial e sem candidato nenhum.
          qtd_candidatos_ds: 0, estado_match: "SO_NO_DS",
          acao_sugerida: c.cancelado ? "fora_do_escopo" : "sem_licenca",
          status_usuario: "novo",
        });
      }

      for (let i = 0; i < recon.length; i += 500) {
        const { error } = await ds.from("reconciliacao_oem").insert(recon.slice(i, i + 500));
        if (error) throw new Error(`reconciliacao_oem: ${error.message}`);
      }

      await ds.from("oem_integration").update({
        ultimo_sync_em: new Date().toISOString(),
        ultimo_sync_status: "sucesso",
        ultimo_status: "ok",
        ultimo_teste_at: new Date().toISOString(),
        ultimo_sync_msg: `${linhas.length} filiais · ${recon.length} vínculos`,
      }).eq("id", conta.id);

      const conta_ = (f: string) =>
        recon.reduce((m: Record<string, number>, r) => {
          const k = String(r[f]); m[k] = (m[k] || 0) + 1; return m;
        }, {});
      resultados.push({
        contaId: conta.id, unidades, filiais: linhas.length, removidas: mortas.length,
        clientesDs: clientes.length, linhasRecon: recon.length,
        decisoesPreservadas: decidido.size,
        ultimaSincronizacaoOem: corpo.ultimaSincronizacao ?? null,
        estado_match: conta_("estado_match"), acao_sugerida: conta_("acao_sugerida"),
      });
    }

    return Response.json({ ok: true, duracaoMs: Date.now() - inicio, resultados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oem-espelho-sync]", msg);
    return Response.json({ ok: false, duracaoMs: Date.now() - inicio, mensagem: msg }, { status: 500 });
  }
});
