import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";

// fin-sync-titulos — o conector que alimenta fin_titulos.
//
// v1 (22/09/2026). Traz os títulos a receber do Omie para a tabela única do
// módulo Financeiro. Uma empresa por vez, uma conta por vez, sempre incremental.
//
// O QUE ELE NÃO FAZ, E POR QUÊ:
//   - Não chama a API do Omie. Quem lê o Omie é o unify-bridge; aqui se lê o
//     espelho do DoctorOMIE, via ds-omie-titulos-listar. Custo de cota Omie: zero.
//   - Não apaga nada. O espelho do Omie não sabe apagar (medido em 22/09/2026:
//     198 títulos da Digi Office existem lá e não existem mais no ERP), então
//     apagar daqui por ausência repetiria o erro ao contrário. Quem some da
//     origem simplesmente para de ter `visto_em` atualizado e cai fora da
//     vw_fin_titulos_abertos sozinho.
//
// AUTH: verify_jwt=false (pg_cron não tem JWT de usuário), então a checagem mora
// aqui: segredo dedicado no vault, comparado com o Bearer recebido. Mesmo
// desenho de recon-espelho-pull-cron.
//
// CURSOR: por CONTA da origem, guardado em fin_sync_estado.cursores. A Digi
// Office tem duas contas Omie (uma por unidade) e cada uma anda no seu ritmo.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DOCTOROMIE_TITULOS =
  "https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-titulos-listar";

// Teto de páginas por conta numa execução. 1.000 títulos por página: 20 páginas
// cobrem a carga inicial de qualquer tenant de hoje (a Digi Office inteira tem
// ~17 mil) sem deixar a function rodar sem fim se algo devolver cursor parado.
const MAX_PAGINAS = 20;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Rótulo do Omie -> situação normalizada do DoctorSaaS. */
function traduzirSituacao(status: string | null): string {
  switch ((status ?? "").toUpperCase().trim()) {
    case "ATRASADO":
      return "atrasado";
    case "VENCE HOJE":
    case "VENCEHOJE":
      return "vence_hoje";
    case "A VENCER":
    case "AVENCER":
      return "a_vencer";
    case "RECEBIDO":
    case "PAGO":
    case "LIQUIDADO":
      return "pago";
    case "PAGTO_PARCIAL":
      return "parcial";
    case "CANCELADO":
      return "cancelado";
    default:
      // Rótulo novo do Omie não pode virar "a vencer" por engano: fica marcado
      // como desconhecido, some da régua e aparece para alguém olhar.
      return "desconhecida";
  }
}

interface TituloOrigem {
  codigo_lancamento_omie: number;
  cnpj_cpf_digits: string | null;
  codigo_cliente_omie: number | null;
  numero_documento: string | null;
  parcela: string | null;
  data_emissao: string | null;
  data_vencimento: string | null;
  valor_documento: number | null;
  status_titulo: string | null;
  boleto_gerado: boolean;
  numero_boleto: string | null;
  codigo_barras: string | null;
  visto_em: string;
  /**
   * Preenchido quando a origem já sabe que este título não existe mais no ERP.
   *
   * Ele CHEGA em vez de sumir, e é essa a diferença: enquanto a listagem
   * escondia a linha excluída, o título ficava parado aqui para sempre com o
   * estado do dia em que sumiu. Eram 218 assim em 25/09/2026.
   */
  excluido_em?: string | null;
  /** Código da OS na origem. É a chave para chegar ao PDF da nota e da OS. */
  os_id?: string | null;
  numero_nf?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ---- AUTH ----
  const authHeader = req.headers.get("Authorization") ?? "";
  const recebido = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  const { data: esperado, error: segErr } = await service.rpc("obter_segredo_cron_fin_sync");
  if (segErr || !esperado) {
    console.error("SEGREDO_AUSENTE:", JSON.stringify(segErr));
    return json({ ok: false, error: "Segredo do cron não configurado" }, 500);
  }
  if (!recebido || recebido !== esperado) {
    return json({ ok: false, error: "Não autorizado" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const tenantFiltro: string | null = typeof body?.tenant_id === "string" ? body.tenant_id : null;
  // `recomecar` ignora o cursor e relê tudo. Serve para a carga inicial e para
  // quando o espelho da origem for reconstruído.
  const recomecar = body?.recomecar === true;

  try {
    // Só empresas com o módulo ligado. A flag é o mesmo portão da tela.
    let tq = service.from("tenants").select("id, nome").eq("financeiro_enabled", true);
    if (tenantFiltro) tq = tq.eq("id", tenantFiltro);
    const { data: tenants, error: tErr } = await tq;
    if (tErr) throw new Error(`falha ao listar empresas: ${tErr.message}`);
    if (!tenants?.length) return json({ ok: true, aviso: "Nenhuma empresa com o Financeiro ligado", resultados: [] });

    const resultados: unknown[] = [];

    for (const tenant of tenants) {
      const inicio = Date.now();
      const { data: contas, error: cErr } = await service
        .from("omie_integration")
        .select("id, ativo, integracao_pausada")
        .eq("tenant_id", tenant.id)
        .eq("ativo", true);
      if (cErr) throw new Error(`falha ao listar contas Omie: ${cErr.message}`);

      const { data: estadoAtual } = await service
        .from("fin_sync_estado")
        .select("cursores")
        .eq("tenant_id", tenant.id)
        .eq("origem", "omie")
        .maybeSingle();

      // Cursor por conta: PAR (carimbo, id do título). Só o carimbo não serve —
      // o espelho grava em lote e dezenas de títulos ficam com o mesmo
      // `synced_at`, então um cursor de data pula os que sobraram na borda da
      // página. A v1 perdeu 858 títulos da Digi Office exatamente assim.
      // Cursor gravado pela v1 era string; é lido e convertido.
      const cursores: Record<string, { visto_em: string; id: number | null }> = {};
      if (!recomecar) {
        const antigos = (estadoAtual?.cursores ?? {}) as Record<string, unknown>;
        for (const [conta, valor] of Object.entries(antigos)) {
          if (typeof valor === "string") cursores[conta] = { visto_em: valor, id: null };
          else if (valor && typeof valor === "object") {
            const v = valor as { visto_em?: string; id?: number };
            if (v.visto_em) cursores[conta] = { visto_em: v.visto_em, id: v.id ?? null };
          }
        }
      }

      let lidos = 0;
      let gravados = 0;
      const erros: string[] = [];
      // Leitura mais RECENTE entre as contas: quanto mais novo este carimbo,
      // mais título velho fica de fora da régua. Conta que parou de ser lida
      // perde os títulos dela, que é o comportamento seguro.
      let leituraOk: string | null = null;

      for (const conta of contas ?? []) {
        const { data: chave, error: chaveErr } = await service.rpc("obter_chave_omie_por_conta", {
          p_integration_id: conta.id,
        });
        if (chaveErr || !chave) {
          erros.push(`conta ${conta.id}: chave indisponível`);
          continue;
        }

        let desde: string | null = cursores[conta.id]?.visto_em ?? null;
        let desdeId: number | null = cursores[conta.id]?.id ?? null;
        for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
          const resp = await fetch(DOCTOROMIE_TITULOS, {
            method: "POST",
            headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
            body: JSON.stringify({ desde, desde_id: desdeId, limite: 1000 }),
          });
          const corpo = await resp.json().catch(() => ({}));
          if (!resp.ok || corpo?.ok === false) {
            erros.push(`conta ${conta.id}: ${corpo?.error ?? `HTTP ${resp.status}`}`);
            break;
          }

          const titulos: TituloOrigem[] = corpo?.titulos ?? [];
          lidos += titulos.length;

          const leituraDaConta: string | null = corpo?.origem?.ultima_leitura_ok ?? null;
          if (leituraDaConta && (!leituraOk || leituraDaConta > leituraOk)) leituraOk = leituraDaConta;

          if (titulos.length) {
            const linhas = titulos.map((t) => ({
              tenant_id: tenant.id,
              origem: "omie",
              origem_conta_id: conta.id,
              origem_id: String(t.codigo_lancamento_omie),
              origem_cliente_id: t.codigo_cliente_omie != null ? String(t.codigo_cliente_omie) : null,
              cnpj_cpf_digits: t.cnpj_cpf_digits,
              numero_documento: t.numero_documento,
              parcela: t.parcela,
              emissao: t.data_emissao,
              vencimento: t.data_vencimento,
              valor: t.valor_documento ?? 0,
              situacao: traduzirSituacao(t.status_titulo),
              situacao_origem: t.status_titulo,
              boleto_gerado: !!t.boleto_gerado,
              numero_boleto: t.numero_boleto,
              codigo_barras: t.codigo_barras,
              visto_em: t.visto_em,
              // Carimbo, não exclusão: a linha fica para responder o que sumiu
              // do ERP e quando. Quem impede de cobrar é a view, que barra o
              // carimbado.
              //
              // Repare que ele é gravado nos DOIS sentidos: quando vem nulo,
              // limpa um carimbo anterior. Título excluído por engano no ERP e
              // depois restaurado precisa voltar a ser cobrável sozinho, sem
              // alguém lembrar de limpar na mão.
              removido_na_origem_em: t.excluido_em ?? null,
              // Vinham no bruto do Omie e se perdiam na listagem. Não são o
              // link do documento: são o que permite ir buscá-lo.
              origem_os_id: t.os_id ?? null,
              numero_nf: t.numero_nf ?? null,
              atualizado_em: new Date().toISOString(),
            }));

            // Em lotes: o upsert vai por PostgREST e payload grande demais volta 413.
            for (let i = 0; i < linhas.length; i += 250) {
              const { error: upErr } = await service
                .from("fin_titulos")
                .upsert(linhas.slice(i, i + 250), { onConflict: "tenant_id,origem,origem_id" });
              if (upErr) throw new Error(`upsert fin_titulos: ${upErr.message}`);
              gravados += Math.min(250, linhas.length - i);
            }
          }

          if (corpo?.proximo_desde) {
            desde = corpo.proximo_desde;
            desdeId = corpo.proximo_desde_id ?? null;
            cursores[conta.id] = { visto_em: desde as string, id: desdeId };
          }
          if (!corpo?.tem_mais) break;
        }
      }

      // Casa com o cliente do DoctorSaaS por CNPJ. Só quando o CNPJ aponta para
      // um cliente só; duplicado fica sem vínculo de propósito.
      let casados = 0;
      let ambiguos = 0;
      let semCliente = 0;
      const { data: casamento, error: casErr } = await service.rpc("fn_fin_casar_titulos_por_cnpj", {
        p_tenant_id: tenant.id,
      });
      if (casErr) {
        erros.push(`casamento por CNPJ: ${casErr.message}`);
      } else if (Array.isArray(casamento) && casamento[0]) {
        casados = casamento[0].casados ?? 0;
        ambiguos = casamento[0].ambiguos ?? 0;
        semCliente = casamento[0].sem_cliente ?? 0;
      }

      // Empresa ligada e sem conta ativa não é sucesso: é configuração faltando.
      // Sem isto a execução voltaria "ok" tendo lido zero, e o painel diria que a
      // origem está em dia.
      if (!contas?.length) erros.push("nenhuma conta ativa da origem para esta empresa");

      const houveErro = erros.length > 0;
      const { error: estErr } = await service.from("fin_sync_estado").upsert(
        {
          tenant_id: tenant.id,
          origem: "omie",
          cursores,
          // Só avança a referência de frescor quando a leitura foi limpa E a
          // origem disse quando leu o ERP pela última vez. Nunca carimbar com a
          // hora de agora: "rodei" não é a mesma coisa que "a origem leu", e
          // essa diferença é o que impede a régua de cobrar com dado velho.
          ...(houveErro || !leituraOk ? {} : { ultima_leitura_ok: leituraOk }),
          ultima_tentativa: new Date().toISOString(),
          ultimo_status: houveErro ? "erro" : "sucesso",
          ultimo_erro: houveErro ? erros.join(" | ").slice(0, 500) : null,
          titulos_lidos: lidos,
          atualizado_em: new Date().toISOString(),
        },
        { onConflict: "tenant_id,origem" },
      );
      if (estErr) throw new Error(`fin_sync_estado: ${estErr.message}`);

      resultados.push({
        tenant_id: tenant.id,
        tenant: tenant.nome,
        contas: contas?.length ?? 0,
        lidos,
        gravados,
        casados,
        ambiguos,
        sem_cliente: semCliente,
        erros,
        duracao_ms: Date.now() - inicio,
      });
    }

    return json({ ok: true, resultados });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
