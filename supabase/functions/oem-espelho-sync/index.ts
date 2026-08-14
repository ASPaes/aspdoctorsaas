// ============================================================================
// oem-espelho-sync — traz as filiais do DoctorOEM para o espelho e monta o de/para
//
// FLUXO
//   DoctorOEM (projeto furohpfhukwajhvnnbiw, já sincronizado com a API do OEM)
//     -> oem_espelho_filial   (cópia aqui, para poder cruzar com `clientes`)
//     -> reconciliacao_oem    (o vínculo filial <-> cliente)
//
// Este função NÃO fala com a API do OEM. Quem faz isso é o motor do DoctorOEM
// (edge function oem-sync-passo, lá). Aqui só trazemos o que ele já apurou —
// uma fonte só, sem duas implementações do mesmo mapeamento.
//
// POR QUE O GRÃO É A FILIAL
// Medido em 14/08/2026: 188 CNPJs têm mais de uma filial (633 no total), um
// deles com 38, e um CPF de teste "01234567890" aparece em 29 cadastros. Cada
// filial é uma licença com custo próprio. O CNPJ só SUGERE candidatos.
//
// SEGREDOS NECESSÁRIOS
//   DOCTOROEM_URL          https://furohpfhukwajhvnnbiw.supabase.co
//   DOCTOROEM_SERVICE_KEY  service_role do projeto DoctorOEM (só leitura aqui)
//   OEM_MAPA_TENANTS       {"<tenant no DoctorOEM>":"<tenant no DoctorSaaS>"}
// ============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

type FilialOem = {
  tenant_id: string;
  empresa_codigo: string | null;
  filial_codigo: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  grupo_economico: string | null;
  cnpj_cpf: string | null;
  produto_principal: string | null;
  status: string | null;
  bloqueado: boolean | null;
  custo_total: number | null;
  qtd_pdv: number | null;
  qtd_comandas: number | null;
  usuarios_adicionais: number | null;
  numero_filiais: number | null;
  modulos_ativos: unknown;
  last_sync: string | null;
};

type ClienteDs = {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj_digits: string | null;
  cnpj: string | null;
  mensalidade: number | null;
  cancelado: boolean | null;
};

/** Lê tudo de uma tabela paginando — PostgREST corta em 1000. */
async function lerTudo<T>(db: SupabaseClient, query: (from: number, to: number) => any): Promise<T[]> {
  const tudo: T[] = [];
  const passo = 1000;
  for (let from = 0; from < 100_000; from += passo) {
    const { data, error } = await query(from, from + passo - 1);
    if (error) throw new Error(error.message);
    const lote = (data ?? []) as T[];
    tudo.push(...lote);
    if (lote.length < passo) break;
  }
  return tudo;
}

Deno.serve(async (req) => {
  const inicio = Date.now();
  try {
    const ds = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const oemUrl = Deno.env.get("DOCTOROEM_URL");
    const oemKey = Deno.env.get("DOCTOROEM_SERVICE_KEY");
    const mapaRaw = Deno.env.get("OEM_MAPA_TENANTS");
    if (!oemUrl || !oemKey || !mapaRaw) {
      throw new Error("Faltam DOCTOROEM_URL, DOCTOROEM_SERVICE_KEY ou OEM_MAPA_TENANTS.");
    }
    const mapa = JSON.parse(mapaRaw) as Record<string, string>;
    const oem = createClient(oemUrl, oemKey, { auth: { persistSession: false } });

    const resultados: Record<string, unknown>[] = [];

    for (const [tenantOem, tenantDs] of Object.entries(mapa)) {
      // ---------------------------------------------------- 1. espelho
      const filiais = await lerTudo<FilialOem>(oem, (a, b) =>
        oem.from("clientes_oem").select("*").eq("tenant_id", tenantOem).order("id").range(a, b));

      const linhas = filiais
        .filter((f) => f.filial_codigo)
        .map((f) => ({
          tenant_id: tenantDs,
          empresa_codigo: f.empresa_codigo ?? "",
          filial_codigo: String(f.filial_codigo),
          grupo_economico: f.grupo_economico,
          nome_fantasia: f.nome_fantasia,
          razao_social: f.razao_social,
          cnpj_oem: f.cnpj_cpf,
          cnpj_norm: digitos(f.cnpj_cpf) || null,
          produto_principal: f.produto_principal,
          status: f.status,
          bloqueado: f.bloqueado === true,
          custo_total: f.custo_total,
          qtd_pdv: f.qtd_pdv,
          qtd_comandas: f.qtd_comandas,
          usuarios_adicionais: f.usuarios_adicionais,
          numero_filiais: f.numero_filiais,
          modulos: f.modulos_ativos,
          last_sync_oem: f.last_sync,
          atualizado_em: new Date().toISOString(),
        }));

      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await ds.from("oem_espelho_filial")
          .upsert(linhas.slice(i, i + 500), { onConflict: "tenant_id,filial_codigo" });
        if (error) throw new Error(`oem_espelho_filial: ${error.message}`);
      }

      // Filial que sumiu do OEM sai do espelho — senão vira órfã silenciosa.
      const vivos = new Set(linhas.map((l) => l.filial_codigo));
      const atuais = await lerTudo<{ filial_codigo: string }>(ds, (a, b) =>
        ds.from("oem_espelho_filial").select("filial_codigo").eq("tenant_id", tenantDs).range(a, b));
      const mortas = atuais.map((r) => r.filial_codigo).filter((c) => !vivos.has(c));
      if (mortas.length) {
        await ds.from("oem_espelho_filial").delete().eq("tenant_id", tenantDs).in("filial_codigo", mortas);
      }

      // ------------------------------------------------ 2. clientes do DS
      const clientes = await lerTudo<ClienteDs>(ds, (a, b) =>
        ds.from("clientes")
          .select("id, nome_fantasia, razao_social, cnpj_digits, cnpj, mensalidade, cancelado")
          .eq("tenant_id", tenantDs).order("id").range(a, b));

      const porCnpj = new Map<string, ClienteDs[]>();
      for (const c of clientes) {
        const k = c.cnpj_digits || digitos(c.cnpj);
        if (!k) continue;
        if (!porCnpj.has(k)) porCnpj.set(k, []);
        porCnpj.get(k)!.push(c);
      }

      // ------------------------- 3. preserva as decisões humanas já tomadas
      const antigas = await lerTudo<any>(ds, (a, b) =>
        ds.from("reconciliacao_oem")
          .select("filial_codigo, ds_customer_id, candidato_escolhido, status_usuario, observacao, resolvido_em, resolvido_por")
          .eq("tenant_id", tenantDs).neq("status_usuario", "novo").range(a, b));
      const decidido = new Map<string, any>();
      for (const d of antigas) if (d.filial_codigo) decidido.set(String(d.filial_codigo), d);

      // ------------------------------------------------ 4. monta o de/para
      await ds.from("reconciliacao_oem").delete().eq("tenant_id", tenantDs);

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
          tenant_id: tenantDs,
          cnpj_norm: l.cnpj_norm,
          empresa_codigo: l.empresa_codigo,
          filial_codigo: l.filial_codigo,
          razao_oem: l.nome_fantasia,
          custo_oem: l.custo_total,
          status_oem: l.status,
          bloqueado_oem: l.bloqueado,
          ds_customer_id: alvo?.id ?? null,
          razao_ds: cli?.nome_fantasia ?? cli?.razao_social ?? null,
          mensalidade_ds: cli?.mensalidade ?? null,
          cancelado_ds: cli?.cancelado ?? null,
          qtd_candidatos_ds: cands.length,
          estado_match: estado,
          acao_sugerida: acao,
          status_usuario: anterior?.status_usuario ?? (estado === "CASADO" ? "vinculado" : "novo"),
          candidato_escolhido: anterior?.candidato_escolhido ?? null,
          observacao: anterior?.observacao ?? null,
          resolvido_em: anterior?.resolvido_em ?? null,
          resolvido_por: anterior?.resolvido_por ?? null,
        });
      }

      // Clientes do DS que não têm nenhuma filial no OEM — aparecem também,
      // senão some do diagnóstico quem está sendo cobrado sem licença.
      for (const c of clientes) {
        if (comFilial.has(c.id)) continue;
        const k = c.cnpj_digits || digitos(c.cnpj);
        if (k && linhas.some((l) => l.cnpj_norm === k)) continue;
        recon.push({
          tenant_id: tenantDs,
          cnpj_norm: k || null,
          ds_customer_id: c.id,
          razao_ds: c.nome_fantasia ?? c.razao_social,
          mensalidade_ds: c.mensalidade,
          cancelado_ds: c.cancelado,
          qtd_candidatos_ds: 0,
          estado_match: "SO_NO_DS",
          acao_sugerida: c.cancelado ? "fora_do_escopo" : "escolher_candidato",
          status_usuario: "novo",
        });
      }

      for (let i = 0; i < recon.length; i += 500) {
        const { error } = await ds.from("reconciliacao_oem").insert(recon.slice(i, i + 500));
        if (error) throw new Error(`reconciliacao_oem: ${error.message}`);
      }

      const conta = (f: string) =>
        recon.reduce((m: Record<string, number>, r) => {
          const k = String(r[f]); m[k] = (m[k] || 0) + 1; return m;
        }, {});
      resultados.push({
        tenantDs, filiais: linhas.length, removidas: mortas.length,
        clientesDs: clientes.length, linhasRecon: recon.length,
        decisoesPreservadas: decidido.size,
        estado_match: conta("estado_match"), acao_sugerida: conta("acao_sugerida"),
      });
    }

    return Response.json({ ok: true, duracaoMs: Date.now() - inicio, resultados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oem-espelho-sync]", msg);
    return Response.json({ ok: false, duracaoMs: Date.now() - inicio, mensagem: msg }, { status: 500 });
  }
});
