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

// O botão "Atualizar espelho" é chamado do navegador. Sem responder ao
// preflight OPTIONS, o fetch nem sai: o supabase-js devolve "Failed to send a
// request to the Edge Function" — que parece erro de rede, mas é CORS. Nasceu
// sem isso porque só tinha sido exercitada por chamada de servidor.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (corpo: unknown, status = 200) =>
  Response.json(corpo, { status, headers: cors });

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");

/**
 * Quando o OEM já agendou a baixa da licença.
 *
 * Cancelar no portal do OEM não desliga nada na hora: a licença fica ATIVA até
 * o último dia do mês e só depois vira "Desativado". Nenhuma das rotas de
 * status conta isso — a listagem devolve só `ativo: true` e o detalhe do
 * pdvlegal só `status: "AT"`. A data existe em UM lugar: a `datavalidade` de
 * cada módulo, que vem junto no `modulos_ativos`.
 *
 * TODOS OS MÓDULOS ATIVOS PRECISAM TER DATA. A licença só cai quando não sobra
 * nada de pé; enquanto um módulo ativo estiver sem prazo, o que vence é aquele
 * módulo, não a licença.
 *
 * Corrigido em 24/08/2026, com o CAMPINA VERDE na mão: a versão anterior pegava
 * a maior data entre os módulos ativos e IGNORAVA os sem data — o cliente
 * cancelou o iFood, o módulo ficou com validade 31/08, e a tela anunciou que a
 * LICENÇA seria desativada. Medido na base: de 24 licenças marcadas, 7 eram
 * disso (Licença PDV, Delivery e iFood vencendo sozinhos), e cinco delas ainda
 * apareciam no alerta "o OEM vai desativar e o cliente está ativo aqui".
 *
 * Entre as que sobram, a data é a MAIOR: se um módulo vence em 31/08 e outro em
 * 30/09, a licença ainda está de pé em setembro.
 *
 * Só olha módulo ativo: inativo vem com `datavalidade: null` de qualquer jeito.
 *
 * 2099 é sentinela de "sem prazo" (3 filiais em 22/08/2026). Tratar como data
 * real marcaria a licença como programada para daqui a 73 anos; devolver null
 * mantém o alerta de pé, que é o lado seguro do erro.
 */
function desativacaoProgramada(modulos: unknown): string | null {
  if (!Array.isArray(modulos)) return null;
  const ativos = (modulos as Record<string, unknown>[]).filter((m) => m && m.ativo === true);
  if (!ativos.length) return null;

  let maior: string | null = null;
  for (const m of ativos) {
    const d = typeof m.datavalidade === "string" ? m.datavalidade.slice(0, 10) : null;
    // Um único módulo ativo sem prazo já basta: a licença continua viva.
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    if (d >= "2099-01-01") return null;
    if (!maior || d > maior) maior = d;
  }
  return maior;
}

// Comparar nome cru marcaria quase tudo como divergente: acento, caixa,
// pontuação e sufixo societário mudam sem que a empresa seja outra. O que sobra
// depois disso é diferença de verdade — "FILIAL 1" contra "Padaria do João" —,
// e mesmo essa é comum, porque o OEM guarda nome de loja e o DoctorSaaS guarda
// razão social. Por isso divergência de nome é aviso fraco; a de CNPJ é a forte.
const normNome = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\b(LTDA|ME|EPP|EIRELI|MEI|CIA|S\/A|SA)\b/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

/**
 * O que não bate entre os dois lados de um vínculo já feito.
 *
 * NOME É COMPARADO POR CONJUNTO, não campo a campo — e isso não é preciosismo.
 * A primeira versão comparava `razao_social ?? nome_fantasia` dos dois lados e
 * acusou 994 divergências. Medido em 16/08/2026: **994 de 994** eram casos em
 * que o OEM não tinha razão social e o código caiu na fantasia, comparando
 * nome de loja contra razão social. Zero eram empresa diferente. Um alarme que
 * erra 100% das vezes é pior que não ter alarme: treina a ignorar a tela.
 *
 * A regra certa é: se QUALQUER nome de um lado bate com QUALQUER nome do outro,
 * é a mesma empresa. Só divergem quando nada cruza.
 */
function apurarDivergencias(
  oemNomes: (string | null)[], oemCnpj: string | null,
  dsNomes: (string | null)[], dsCnpj: string | null,
): string[] {
  const d: string[] = [];
  const a = new Set(oemNomes.map(normNome).filter(Boolean));
  const b = new Set(dsNomes.map(normNome).filter(Boolean));
  // Lado sem nenhum nome não é divergência: é cadastro incompleto, outro assunto.
  if (a.size && b.size && ![...a].some((x) => b.has(x))) d.push("nome");

  const ca = digitos(oemCnpj), cb = digitos(dsCnpj);
  if (ca && cb && ca !== cb) d.push("cnpj");
  return d;
}

type FilialOem = {
  empresa_codigo: string | null; filial_codigo: string | null;
  nome_fantasia: string | null; razao_social: string | null; grupo_economico: string | null;
  cnpj_cpf: string | null; produto_principal: string | null;
  status: string | null; bloqueado: boolean | null; custo_total: number | null;
  qtd_pdv: number | null; qtd_comandas: number | null; usuarios_adicionais: number | null;
  numero_filiais: number | null; modulos_ativos: unknown; last_sync: string | null;
};

// Uma célula da grade de preços do parceiro: quanto o módulo custa naquele
// produto. Vem pronto do oem-exportar — aqui não se calcula preço nenhum.
type ItemPrecoOem = {
  produto_codigo: string; produto_nome: string;
  modulo_codigo: number; modulo_nome: string;
  quantidade: number; valor_unitario: number; valor_total: number;
};

type ClienteDs = {
  id: string; nome_fantasia: string | null; razao_social: string | null;
  cnpj_digits: string | null; cnpj: string | null;
  mensalidade: number | null; cancelado: boolean | null;
  unidade_base_id: number | null;
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

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
      return json({
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
        desativa_em: desativacaoProgramada(f.modulos_ativos),
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

      // Lê o TENANT INTEIRO e filtra por unidade aqui dentro, em vez de filtrar
      // no banco, porque as duas coisas têm alcances diferentes:
      //
      //   - o CASAMENTO só pode olhar os clientes das unidades desta conta,
      //     senão uma unidade puxaria a filial de outra. Desde 24/08/2026 isso
      //     vale também para o vínculo por CÓDIGO: "já foi decidido" não torna
      //     o cliente de outra unidade parte desta conta, e três deles (todos
      //     da unidade 10) estavam somando R$ 891 na margem da unidade 6;
      //   - a BUSCA POR ID continua alcançando o tenant inteiro, e só ela: é o
      //     que preenche nome, CNPJ e mensalidade de uma linha já existente.
      //
      // Filtrando no banco, esses ficavam de fora e a linha saía com
      // mensalidade, CNPJ e "cancelado" NULOS — 3 clientes assim em 18/08/2026,
      // aparecendo na aba Custos com mensalidade zero e sem markup.
      const todosDoTenant = await lerTudo<ClienteDs>((a, b) =>
        ds.from("clientes")
          .select("id, nome_fantasia, razao_social, cnpj_digits, cnpj, mensalidade, cancelado, unidade_base_id")
          .eq("tenant_id", conta.tenant_id).order("id").range(a, b));

      const clientes = unidades.length
        ? todosDoTenant.filter((c) => unidades.includes(Number(c.unidade_base_id)))
        : todosDoTenant;

      // MENSALIDADE = MRR ATUAL, NÃO A BASE.
      //
      // `clientes.mensalidade` é o MRR Base. O que vale para margem e markup é
      // o saldo de hoje: base + movimentos vigentes (upsell, cross-sell,
      // downsell, reajuste). No TROPEIRÃO DO JUCÃO a base é R$ 3.113,84 e o
      // atual R$ 1.869,99 — um downsell de R$ 1.568,31 no meio. Medido nesta
      // conta: 359 dos 1.063 clientes vivos têm os dois valores diferentes.
      //
      // Uma chamada para todos: a fonte canônica (`fn_mrr_cliente_em`) é por
      // cliente, e 1.063 idas ao banco não cabem aqui.
      const mrrAtual = new Map<string, number>();
      try {
        const { data: mapa, error: errM } = await ds.rpc("fn_mrr_por_cliente_em", {
          p_tenant: conta.tenant_id,
        });
        if (errM) throw new Error(errM.message);
        for (const [id, v] of Object.entries((mapa ?? {}) as Record<string, unknown>)) {
          if (v != null) mrrAtual.set(id, Number(v));
        }
      } catch (e) {
        // Sem o MRR atual o espelho ainda vale — ele cai para a base, que é o
        // comportamento antigo. Ficar sem espelho por causa disto seria pior,
        // e o motivo tem que aparecer no log em vez de sumir.
        console.error("[oem-espelho] fn_mrr_por_cliente_em:",
          e instanceof Error ? e.message : String(e));
      }
      // Cliente sem entrada no mapa mantém a base — nunca vira zero.
      const mensalidadeDe = (c: ClienteDs | null | undefined) =>
        (c ? (mrrAtual.get(c.id) ?? c.mensalidade ?? null) : null);

      // --------------- 3c. quem pode ter licença aqui: o cliente do PARCEIRO
      //
      // "Cliente sem licença no OEM" só quer dizer alguma coisa para quem vende
      // o produto do parceiro. A Digi Office também revende Gula Menu, e esse
      // cliente nunca vai ter licença no OEM. Medido em 23/08/2026: dos 107 da
      // lista, 50 eram Gula — metade do alarme apontando para o que não é erro.
      // Exemplo: A PADOCA, cujo único produto ativo é o Gula.
      //
      // O critério é o VÍNCULO DE PRODUTO, não `cliente_produtos.fornecedor_id`:
      // a tabela de fornecedores tem SEIS cadastros diferentes chamados "PDV
      // Legal" (ids 13, 25, 28, 34, 36, 41), então casar por fornecedor erraria
      // por duplicidade de cadastro. O vínculo é decidido dentro da própria
      // integração, na aba Módulos, e é o que a conta afirma sobre si mesma.
      const doParceiro = new Set<string>();
      // O conjunto AMPLO inclui produto do OEM inativo. Ele é o que decide quem
      // pode CASAR com uma filial: 318 dos vínculos de hoje são cliente
      // cancelado cujo produto do OEM foi inativado no cancelamento — cortá-los
      // deixaria 318 licenças órfãs e apagaria o histórico da conta.
      const doParceiroAmplo = new Set<string>();
      let temVinculoDeProduto = false;
      {
        const vinc = await lerTudo<{ produto_id: number }>((a, b) =>
          ds.from("oem_produto_vinculo").select("produto_id")
            .eq("conta_integration_id", conta.id).order("produto_id").range(a, b));
        const produtosDoOem = new Set(vinc.map((v) => Number(v.produto_id)));
        temVinculoDeProduto = produtosDoOem.size > 0;

        if (temVinculoDeProduto) {
          const cps = await lerTudo<{ cliente_id: string; produto_id: number; ativo: boolean }>(
            (a, b) => ds.from("cliente_produtos")
              .select("cliente_id, produto_id, ativo")
              .eq("tenant_id", conta.tenant_id)
              .order("cliente_id").range(a, b));
          for (const cp of cps) {
            if (!produtosDoOem.has(Number(cp.produto_id))) continue;
            doParceiroAmplo.add(cp.cliente_id);
            if (cp.ativo !== false) doParceiro.add(cp.cliente_id);
          }
        }
      }

      // SÓ CLIENTE DO PARCEIRO ENTRA NO CASAMENTO AUTOMÁTICO.
      //
      // Tirar o código da ficha não bastava: quem não é do OEM voltava a casar
      // por CNPJ ou por nome na carga seguinte. Foi o que aconteceu em
      // 24/08/2026 com ZOOM ZOOM BAR, CANJA e a rede PASTELANDIA — os 8 têm
      // produto "Gula", do fornecedor Gula Menu, e nenhuma licença do OEM é
      // deles; ainda assim casavam, e a receita deles entrava na margem da aba.
      //
      // Medido na mesma base: dos 1.071 vínculos com cliente, 326 são de gente
      // sem produto do OEM ativo — mas 318 desses são cliente CANCELADO cujo
      // produto foi inativado junto, e esses continuam valendo (é o histórico
      // da conta). Sobram exatamente os 8. Por isso o corte usa o conjunto
      // amplo, que aceita produto inativo.
      const podeCasar = (c: ClienteDs) => !temVinculoDeProduto || doParceiroAmplo.has(c.id);

      const porCnpj = new Map<string, ClienteDs[]>();
      for (const c of clientes) {
        if (!podeCasar(c)) continue;
        const k = c.cnpj_digits || digitos(c.cnpj);
        if (!k) continue;
        if (!porCnpj.has(k)) porCnpj.set(k, []);
        porCnpj.get(k)!.push(c);
      }

      // ------------------------------------------- 3c. quando o CNPJ é do GRUPO
      //
      // Medido no grupo 8201 (Bem Docado) em 16/08/2026: **23 filiais, 1 CNPJ**.
      // O OEM manda o CNPJ do grupo em toda filial, não o da loja. No
      // DoctorSaaS cada loja tem o seu, e só uma delas bate com o do grupo —
      // então o casamento por CNPJ jogou as 23 licenças no mesmo cadastro.
      //
      // O sinal é objetivo e sai do próprio espelho: CNPJ que aparece em mais
      // de uma filial não identifica loja nenhuma. Aí quem desempata é o NOME,
      // que nesse grupo bate quase um a um (MAIS DOCADO SAPOPEMBA, BEM DOCADO
      // JARDIM, BEM DOCADO SAO RAFAEL...).
      const filiaisPorCnpj = new Map<string, number>();
      for (const l of linhas) {
        if (!l.cnpj_norm) continue;
        filiaisPorCnpj.set(l.cnpj_norm, (filiaisPorCnpj.get(l.cnpj_norm) ?? 0) + 1);
      }
      const cnpjDeGrupo = (c: string | null) => !!c && (filiaisPorCnpj.get(c) ?? 0) > 1;

      // Razão social e fantasia entram as duas: o OEM guarda nome de loja e o
      // DoctorSaaS às vezes guarda a mesma coisa na fantasia, às vezes na razão.
      const porNome = new Map<string, ClienteDs[]>();
      for (const c of clientes) {
        if (!podeCasar(c)) continue;
        for (const n of [c.nome_fantasia, c.razao_social]) {
          const k = normNome(n);
          if (!k) continue;
          if (!porNome.has(k)) porNome.set(k, []);
          if (!porNome.get(k)!.some((x) => x.id === c.id)) porNome.get(k)!.push(c);
        }
      }

      // Do TENANT inteiro: é por ela que o vínculo já confirmado encontra o
      // cliente, mesmo que ele seja de outra unidade.
      const porId = new Map<string, ClienteDs>(todosDoTenant.map((c) => [c.id, c]));

      // ------------------ 3b. o vínculo DURÁVEL: o código na ficha do cliente
      // Desde 15/08/2026 o par grupo+filial fica gravado em cliente_produtos.
      // É a chave que sobrevive a tudo: o de/para é apagado e refeito a cada
      // carga, e o CNPJ pode mudar dos dois lados — o código, não. Por isso ele
      // vem ANTES do casamento por CNPJ e antes até da decisão manual antiga.
      const porCodigo = new Map<string, string>();
      {
        const vinculados = await lerTudo<{ cliente_id: string; oem_codigo_filial: string; produto_id: number }>(
          (a, b) => ds.from("cliente_produtos")
            .select("cliente_id, oem_codigo_filial, produto_id")
            .eq("tenant_id", conta.tenant_id)
            .not("oem_codigo_filial", "is", null)
            .order("cliente_id").range(a, b));
        // A conta é de UMA unidade base, e isso vale também para o vínculo por
        // código. Até 24/08/2026 esta busca alcançava o tenant inteiro, com o
        // argumento de que o código já tinha sido decidido — o efeito foi
        // FLORICULTURA VITRINE DAS FLORES, DISTRIBUIDORA DE BEBIDAS PAULO VI e
        // ESPONTANEO BAR E RESTAURANTE, os três da unidade 10, entrando na
        // conta da unidade 6 e somando R$ 891 na margem dela.
        const daUnidade = new Set(clientes.map((c) => c.id));
        for (const v of vinculados) {
          if (!daUnidade.has(v.cliente_id)) continue;
          // Código gravado num produto que não é do OEM não vale como vínculo:
          // foi assim que 8 clientes do Gula Menu entraram na conta do parceiro.
          // A ficha continua com o número até alguém limpar; a conciliação
          // deixa de acreditar nele.
          if (temVinculoDeProduto && !doParceiroAmplo.has(v.cliente_id)) continue;
          porCodigo.set(String(v.oem_codigo_filial), v.cliente_id);
        }
      }

      // ---------------------- 4. preserva as decisões humanas já tomadas
      //
      // O filtro é `resolvido_em is not null`, e NÃO `status_usuario <> 'novo'`.
      // A própria sincronização grava status_usuario='vinculado' no casamento
      // automático, então o filtro antigo tratava palpite da máquina como
      // decisão a preservar: as 23 licenças que o CNPJ de grupo jogou no
      // cadastro errado sobreviveriam a qualquer melhoria do algoritmo, e a
      // correção do CNPJ de grupo não teria efeito nenhum sobre elas.
      //
      // Só existe decisão humana onde alguém carimbou quem e quando — é o que
      // as RPCs vincular/ignorar/desvincular gravam.
      //
      // `ignoradas` entra no mesmo balde: marcar "está certo assim" é decisão
      // humana como qualquer outra, e sem ser copiada ela duraria até a próxima
      // carga — seis horas. Por isso o filtro deixou de ser só `resolvido_em`:
      // ignorar não resolve o vínculo, não carimba resolvido_em, e a linha
      // ficaria de fora.
      const antigas = await lerTudo<any>((a, b) =>
        ds.from("reconciliacao_oem")
          .select("filial_codigo, ds_customer_id, candidato_escolhido, status_usuario, observacao, resolvido_em, resolvido_por, ignoradas")
          .eq("conta_integration_id", conta.id)
          .or("resolvido_em.not.is.null,ignoradas.not.is.null")
          .range(a, b));
      const decidido = new Map<string, any>();
      // Linha sem filial (o cliente que não tem licença nenhuma) não tem código
      // para servir de chave: para ela, quem identifica é o cliente.
      const decididoPorCliente = new Map<string, any>();
      for (const d of antigas) {
        if (d.filial_codigo) decidido.set(String(d.filial_codigo), d);
        else if (d.ds_customer_id) decididoPorCliente.set(String(d.ds_customer_id), d);
      }

      // ------------------------------------------------ 5. monta o de/para
      await ds.from("reconciliacao_oem").delete().eq("conta_integration_id", conta.id);

      const recon: Record<string, unknown>[] = [];
      const comFilial = new Set<string>();

      // A escolha automática de uma filial, isolada num lugar só porque agora é
      // usada duas vezes: uma para descobrir quem está sendo disputado, outra
      // para montar a linha.
      const escolhaAuto = (l: typeof linhas[number]) => {
        // CNPJ de grupo não identifica loja: quando ele se repete entre filiais,
        // o critério passa a ser o nome. Não é preferência — é o único campo
        // que sobra distinguindo uma loja da outra.
        const porGrupo = cnpjDeGrupo(l.cnpj_norm);
        const cands = porGrupo
          ? [...new Map(
              [l.nome_fantasia, l.razao_social]
                .flatMap((n) => porNome.get(normNome(n)) ?? [])
                .map((c) => [c.id, c] as const),
            ).values()]
          : (l.cnpj_norm ? (porCnpj.get(l.cnpj_norm) ?? []) : []);
        // Cliente ativo tem preferência: o cancelado costuma ser cadastro velho.
        const ativos = cands.filter((c) => !c.cancelado);
        return {
          porGrupo,
          cands,
          escolha: ativos.length === 1 ? ativos[0] : cands.length === 1 ? cands[0] : null,
        };
      };

      // ------------------------------- 5a. a trava: 1 filial = 1 cliente
      //
      // Regra do Alexandre. Até aqui cada filial escolhia seu cliente sozinha,
      // e nada impedia duas de escolherem o mesmo — foi assim que um cadastro
      // acumulou as licenças de um grupo inteiro. Amontoar em silêncio é pior
      // que não casar: quem olha a ficha vê custo que não é daquele cliente, e
      // ninguém é perguntado porque a máquina se deu por satisfeita.
      //
      // Cliente disputado por mais de uma filial — ou já preso por código ou
      // decisão humana — sai do automático e as filiais candidatas vão para a
      // fila de escolha. O número de "resolvidos" piora na tela e melhora na
      // verdade.
      const fixado = new Set<string>();
      for (const l of linhas) {
        const cod = porCodigo.get(String(l.filial_codigo));
        const hum = decidido.get(l.filial_codigo)?.ds_customer_id;
        if (cod) fixado.add(cod);
        else if (hum) fixado.add(hum);
      }
      const pretendido = new Map<string, number>();
      for (const l of linhas) {
        if (porCodigo.get(String(l.filial_codigo))) continue;
        if (decidido.get(l.filial_codigo)?.ds_customer_id) continue;
        const id = escolhaAuto(l).escolha?.id;
        if (id) pretendido.set(id, (pretendido.get(id) ?? 0) + 1);
      }
      const disputado = new Set<string>();
      for (const [id, n] of pretendido) if (n > 1 || fixado.has(id)) disputado.add(id);

      for (const l of linhas) {
        const { porGrupo, cands, escolha: escolhaBruta } = escolhaAuto(l);
        const criterio: "cnpj" | "nome" = porGrupo ? "nome" : "cnpj";
        // Aqui a trava age: pretendente de cliente disputado não vira vínculo.
        const escolha = escolhaBruta && disputado.has(escolhaBruta.id) ? null : escolhaBruta;
        const anterior = decidido.get(l.filial_codigo);

        let estado: string, acao: string, alvo: ClienteDs | null = escolha;
        if (cands.length === 0) { estado = "SO_NO_OEM"; acao = "criar_cliente"; }
        else if (escolha) { estado = "CASADO"; acao = "vinculo_auto_ok"; }
        else { estado = "AMBIGUO"; acao = "escolher_candidato"; alvo = null; }
        // Um candidato só, mas disputado, não é ambiguidade de nome — é falta
        // de cadastro. Dizer isso na tela evita mandar procurar "o outro
        // candidato" que não existe.
        const travado = !!escolhaBruta && !escolha;

        // Decisão humana anterior vence a sugestão automática...
        if (anterior?.ds_customer_id) {
          alvo = cands.find((c) => c.id === anterior.ds_customer_id)
            ?? ({ id: anterior.ds_customer_id } as ClienteDs);
        }
        // ...e o código gravado na ficha vence tudo. É o único elo que não
        // depende de o CNPJ continuar igual dos dois lados — e é justamente
        // quando ele deixa de estar igual que a conferência tem serviço.
        const porCod = porCodigo.get(String(l.filial_codigo));
        if (porCod) {
          alvo = porId.get(porCod) ?? ({ id: porCod } as ClienteDs);
          estado = "CASADO";
          acao = "vinculo_auto_ok";
        }

        if (alvo?.id) comFilial.add(alvo.id);
        const cli = alvo && "mensalidade" in alvo
          ? alvo
          : porId.get(String(alvo?.id)) ?? cands.find((c) => c.id === alvo?.id) ?? null;

        // Só faz sentido conferir o que já está vinculado: sem vínculo não há
        // dois lados para comparar.
        // Razão social contra razão social. Comparar com nome fantasia jogaria
        // nome de loja ("FILIAL 1") contra nome de empresa e daria divergência
        // em praticamente tudo.
        // Os dois valores comparados são gravados junto. A tela precisa exibir
        // exatamente o par que decidiu a divergência: mostrar fantasia e
        // comparar razão social fazia a linha acusar diferença entre duas
        // strings idênticas na tela, e alerta que não se consegue verificar
        // ensina a desconfiar da tela.
        // Guarda a razão social CRUA, sem cair na fantasia: a tela precisa
        // poder mostrar "—" quando o OEM não tem esse campo, em vez de repetir
        // a fantasia e dar a impressão de que havia o que comparar.
        const nomeOem = l.razao_social ?? null;
        const nomeDs  = cli?.razao_social ?? null;
        const cnpjDs  = cli ? (cli.cnpj_digits || digitos(cli.cnpj) || null) : null;
        // Com CNPJ de grupo não há o que conferir nesse campo: o OEM não mandou
        // o CNPJ da loja. Comparar o do grupo com o do cliente acusaria
        // divergência em toda filial do grupo — alarme garantido e sempre falso.
        const divs = cli
          ? apurarDivergencias(
              [l.razao_social, l.nome_fantasia], porGrupo ? null : l.cnpj_norm,
              [cli.razao_social, cli.nome_fantasia], porGrupo ? null : cnpjDs,
            )
          : [];

        recon.push({
          tenant_id: conta.tenant_id, conta_integration_id: conta.id,
          cnpj_norm: l.cnpj_norm, empresa_codigo: l.empresa_codigo,
          filial_codigo: l.filial_codigo, razao_oem: l.nome_fantasia,
          custo_oem: l.custo_total, status_oem: l.status, bloqueado_oem: l.bloqueado,
          // A data vai junto para a tela não precisar abrir o jsonb de módulos
          // de 2.500 filiais só para saber se a baixa já está marcada.
          desativa_em: l.desativa_em,
          ds_customer_id: alvo?.id ?? null,
          razao_ds: cli?.nome_fantasia ?? cli?.razao_social ?? null,
          cnpj_ds: cnpjDs,
          razao_social_oem: nomeOem, razao_social_ds: nomeDs,
          criterio_match: porCod ? "codigo" : criterio,
          observacao: travado
            ? "Este cliente já é de outra filial. Falta o cadastro de cliente desta loja — ou o vínculo vai para o cadastro errado."
            : (anterior?.observacao ?? null),
          divergencias: divs.length ? divs : null,
          mensalidade_ds: mensalidadeDe(cli), cancelado_ds: cli?.cancelado ?? null,
          qtd_candidatos_ds: cands.length,
          estado_match: estado, acao_sugerida: acao,
          status_usuario: anterior?.status_usuario ?? (estado === "CASADO" ? "vinculado" : "novo"),
          candidato_escolhido: anterior?.candidato_escolhido ?? null,
          resolvido_em: anterior?.resolvido_em ?? null,
          resolvido_por: anterior?.resolvido_por ?? null,
          ignoradas: anterior?.ignoradas ?? null,
        });
      }

      // Clientes desta conta sem nenhuma filial — senão some do diagnóstico
      // quem está sendo cobrado sem licença.
      for (const c of clientes) {
        if (comFilial.has(c.id)) continue;
        // Cliente de outro fornecedor não é pendência do OEM (ver 3c). Sem
        // vínculo de produto nenhum a conta não sabe quem é dela, e aí a regra
        // não vale: filtrar tudo esvaziaria a lista de uma conta recém ligada.
        if (temVinculoDeProduto && !doParceiro.has(c.id)) continue;
        const k = c.cnpj_digits || digitos(c.cnpj);
        // ATÉ 23/08/2026 ESTE CLIENTE SUMIA. O corte era `continue` quando
        // existia filial com o mesmo CNPJ: a ideia era não dizer "sem licença"
        // de quem tem uma. Só que o cliente saía da reconciliação INTEIRA — e,
        // com ela, da receita da aba.
        //
        // Medido na Digi Office: 58 clientes, R$ 20 mil de mensalidade, todos
        // com o mesmo desenho — o CNPJ tem DUAS filiais no OEM (RESERVA BAMBU,
        // ROUTE EMPORIUM, BERNINI…), a máquina não sabe qual é a dele e as duas
        // ficam em "escolher_candidato". Do lado da licença o caso aparecia; do
        // lado do cliente, não, e a margem da conta saía R$ 20 mil menor.
        //
        // Agora ele entra com ação PRÓPRIA: não é "sem licença" (ele tem, e
        // mais de uma), é "falta escolher qual". A tela troca o rótulo e o
        // botão por isso.
        const filiaisDoCnpj = k ? linhas.filter((l) => l.cnpj_norm === k).length : 0;
        recon.push({
          tenant_id: conta.tenant_id, conta_integration_id: conta.id,
          cnpj_norm: k || null, ds_customer_id: c.id,
          razao_ds: c.nome_fantasia ?? c.razao_social,
          mensalidade_ds: mensalidadeDe(c), cancelado_ds: c.cancelado,
          // Cliente sem filial não tem o que escolher — marcá-lo como
          // "escolher_candidato" enchia a fila de decisão com centenas de
          // linhas sem filial e sem candidato nenhum.
          // O número aqui é de LICENÇAS candidatas, não de clientes: é ele que
          // a tela usa para dizer "2 licenças com este CNPJ".
          qtd_candidatos_ds: filiaisDoCnpj,
          estado_match: "SO_NO_DS",
          acao_sugerida: c.cancelado
            ? "fora_do_escopo"
            : filiaisDoCnpj > 0 ? "escolher_licenca" : "sem_licenca",
          status_usuario: "novo",
          ignoradas: decididoPorCliente.get(c.id)?.ignoradas ?? null,
        });
      }

      for (let i = 0; i < recon.length; i += 500) {
        const { error } = await ds.from("reconciliacao_oem").insert(recon.slice(i, i + 500));
        if (error) throw new Error(`reconciliacao_oem: ${error.message}`);
      }

      // O código na ficha é a chave durável do vínculo. Gravá-lo só no backfill
      // e no vínculo manual deixava todo vínculo automático novo sem chave —
      // fora da ficha do cliente e fora da conferência.
      const { data: codigosGravados } = await ds.rpc("oem_gravar_codigos_em_lote", {
        p_conta: conta.id,
      });

      // ------------------------------------- 6. tabela de preços dos módulos
      //
      // Outro nível do mesmo assunto: acima veio o que CADA FILIAL paga; aqui
      // vem quanto CADA MÓDULO custa de tabela em cada produto do catálogo do
      // parceiro. É a grade de "Regras comerciais" do portal do OEM, e ela não
      // tem cliente dentro. Os dois valores diferem de propósito — no grupo
      // 8201 o módulo "Gestao" é 39,90 na tabela e 25,12 na loja.
      //
      // FALHA AQUI NÃO INVALIDA O ESPELHO. As filiais já estão gravadas neste
      // ponto e são o que sustenta Custos, Margem e Conferência; perder tudo
      // isso porque o catálogo não respondeu seria trocar o certo pelo ruim.
      // O motivo sobe no resultado e a tela mostra.
      const precosPayload = corpo.precos as
        | { itens?: ItemPrecoOem[]; atualizado_em?: string }
        | null | undefined;
      let precosGravados = 0;
      let precosErro: string | null = (corpo.precosErro as string | null) ?? null;

      if (precosPayload?.itens?.length) {
        const agora = precosPayload.atualizado_em ?? new Date().toISOString();
        const precos = precosPayload.itens
          .filter((i) => i.produto_codigo && Number.isFinite(Number(i.modulo_codigo)))
          .map((i) => ({
            tenant_id: conta.tenant_id,
            conta_integration_id: conta.id,
            produto_codigo: String(i.produto_codigo),
            produto_nome: String(i.produto_nome ?? i.produto_codigo),
            modulo_codigo: Number(i.modulo_codigo),
            modulo_nome: String(i.modulo_nome ?? `Módulo ${i.modulo_codigo}`),
            quantidade: Number(i.quantidade ?? 1) || 1,
            valor_unitario: Number(i.valor_unitario ?? 0) || 0,
            valor_total: Number(i.valor_total ?? 0) || 0,
            atualizado_em: agora,
          }));

        const { error: errP } = await ds.from("oem_espelho_modulo_preco")
          .upsert(precos, { onConflict: "conta_integration_id,produto_codigo,modulo_codigo" });
        if (errP) {
          precosErro = `oem_espelho_modulo_preco: ${errP.message}`;
          console.error("[oem-espelho-sync]", precosErro);
        } else {
          precosGravados = precos.length;
          // Módulo que saiu do catálogo do parceiro sai da grade. Sem isto ele
          // ficaria para sempre com o último preço lido, e ninguém saberia que
          // aquele preço não vale mais.
          //
          // A limpeza é RESTRITA AOS PRODUTOS QUE VIERAM nesta carga. Lá no
          // DoctorOEM, produto cujo GET falha é pulado para não derrubar os
          // outros — se apagássemos tudo o que ficou velho, um erro de rede num
          // produto sumiria com a coluna inteira dele. Melhor a coluna com o
          // preço da carga anterior do que a tela dizendo que não existe preço.
          const produtosVindos = [...new Set(precos.map((p) => p.produto_codigo))];
          const { error: errD } = await ds.from("oem_espelho_modulo_preco")
            .delete()
            .eq("conta_integration_id", conta.id)
            .in("produto_codigo", produtosVindos)
            .lt("atualizado_em", agora);
          if (errD) console.error("[oem-espelho-sync] limpeza de preços:", errD.message);
        }
      } else if (!precosErro) {
        precosErro = "O DoctorOEM não devolveu a tabela de preços.";
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
        codigosGravados: codigosGravados ?? 0,
        precosGravados, precosErro,
        ultimaSincronizacaoOem: corpo.ultimaSincronizacao ?? null,
        estado_match: conta_("estado_match"), acao_sugerida: conta_("acao_sugerida"),
      });
    }

    return json({ ok: true, duracaoMs: Date.now() - inicio, resultados });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[oem-espelho-sync]", msg);
    // Falta de permissão não é erro do servidor: 500 esconde a causa e some com
    // a mensagem na tela, que é justamente a que o usuário precisa ler.
    const semPermissao = /token|autentic|administrador/i.test(msg);
    return json({ ok: false, duracaoMs: Date.now() - inicio, mensagem: msg }, semPermissao ? 403 : 500);
  }
});
