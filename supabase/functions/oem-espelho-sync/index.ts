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
        for (const n of [c.nome_fantasia, c.razao_social]) {
          const k = normNome(n);
          if (!k) continue;
          if (!porNome.has(k)) porNome.set(k, []);
          if (!porNome.get(k)!.some((x) => x.id === c.id)) porNome.get(k)!.push(c);
        }
      }

      const porId = new Map<string, ClienteDs>(clientes.map((c) => [c.id, c]));

      // ------------------ 3b. o vínculo DURÁVEL: o código na ficha do cliente
      // Desde 15/08/2026 o par grupo+filial fica gravado em cliente_produtos.
      // É a chave que sobrevive a tudo: o de/para é apagado e refeito a cada
      // carga, e o CNPJ pode mudar dos dois lados — o código, não. Por isso ele
      // vem ANTES do casamento por CNPJ e antes até da decisão manual antiga.
      const porCodigo = new Map<string, string>();
      {
        const vinculados = await lerTudo<{ cliente_id: string; oem_codigo_filial: string }>(
          (a, b) => ds.from("cliente_produtos")
            .select("cliente_id, oem_codigo_filial")
            .eq("tenant_id", conta.tenant_id)
            .not("oem_codigo_filial", "is", null)
            .order("cliente_id").range(a, b));
        for (const v of vinculados) porCodigo.set(String(v.oem_codigo_filial), v.cliente_id);
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
      const antigas = await lerTudo<any>((a, b) =>
        ds.from("reconciliacao_oem")
          .select("filial_codigo, ds_customer_id, candidato_escolhido, status_usuario, observacao, resolvido_em, resolvido_por")
          .eq("conta_integration_id", conta.id).not("resolvido_em", "is", null).range(a, b));
      const decidido = new Map<string, any>();
      for (const d of antigas) if (d.filial_codigo) decidido.set(String(d.filial_codigo), d);

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
          ds_customer_id: alvo?.id ?? null,
          razao_ds: cli?.nome_fantasia ?? cli?.razao_social ?? null,
          cnpj_ds: cnpjDs,
          razao_social_oem: nomeOem, razao_social_ds: nomeDs,
          criterio_match: porCod ? "codigo" : criterio,
          observacao: travado
            ? "Este cliente já é de outra filial. Falta o cadastro de cliente desta loja — ou o vínculo vai para o cadastro errado."
            : (anterior?.observacao ?? null),
          divergencias: divs.length ? divs : null,
          mensalidade_ds: cli?.mensalidade ?? null, cancelado_ds: cli?.cancelado ?? null,
          qtd_candidatos_ds: cands.length,
          estado_match: estado, acao_sugerida: acao,
          status_usuario: anterior?.status_usuario ?? (estado === "CASADO" ? "vinculado" : "novo"),
          candidato_escolhido: anterior?.candidato_escolhido ?? null,
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

      // O código na ficha é a chave durável do vínculo. Gravá-lo só no backfill
      // e no vínculo manual deixava todo vínculo automático novo sem chave —
      // fora da ficha do cliente e fora da conferência.
      const { data: codigosGravados } = await ds.rpc("oem_gravar_codigos_em_lote", {
        p_conta: conta.id,
      });

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
