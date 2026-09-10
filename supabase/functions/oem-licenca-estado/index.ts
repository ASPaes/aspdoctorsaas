// ============================================================================
// oem-licenca-estado — liga/desliga e bloqueia/desbloqueia a licença de UMA
// filial no OEM, a partir da ficha do cliente.
//
// São duas dimensões INDEPENDENTES, e a regra comercial é do Alexandre:
// desativado não cobra, bloqueado cobra. Por isso são dois botões e não um
// seletor de estado — cada clique muda um flag e deixa o outro como está.
//
// A chave do DoctorOEM nunca sai daqui: o navegador chama esta função, ela lê
// a chave do Vault e conversa com o parceiro. Mesmo desenho da
// `oem-atualizar-cadastro-licenca` e da `oem-cancelar-modulo`.
//
// ---------------------------------------------------------------------------
// SIMULAR NÃO É UM EXTRA. É O PRIMEIRO PASSO DO CLIQUE.
// ---------------------------------------------------------------------------
// A rota do parceiro salva a FILIAL INTEIRA, e a leitura que a alimenta nunca
// foi conferida para o flag de desativação: a carga do OEM (`oem-sync-passo`)
// lê do pdvlegal só o `bloqueado` e tira o Ativo/Desativado da listagem do
// tabletcloud, anotando que o `ativo` do pdvlegal é inconsistente.
//
// Então a tela chama esta função DUAS vezes: `simular: true` para mostrar à
// pessoa o estado que o parceiro tem AGORA e o que vai mudar, e só depois a
// gravação. Se a leitura não trouxer os dois flags, a simulação volta com
// `pode_gravar: false` e o botão de confirmar nem aparece. Foi a simulação que
// evitou zerar o preço dos módulos de uma licença real em 21/08/2026.
//
// ---------------------------------------------------------------------------
// O QUE MUDA NO DOCTORSAAS: NADA ALÉM DO ESPELHO
// ---------------------------------------------------------------------------
// Contrato, MRR e ficha não se mexem — é ação no sistema do parceiro. O espelho
// (`reconciliacao_oem` e `oem_espelho_filial`) é atualizado SÓ quando a
// releitura confirma, e ainda assim provisoriamente: quem tem a palavra final é
// a próxima carga. Sem isso a tela diria "desativado" e continuaria mostrando
// "Ativo" por até 6 horas, logo depois de dizer que deu certo.
//
// TODA tentativa vira linha em `oem_estado_licenca_log`, inclusive a recusa e a
// simulação. A exceção é a ação `reler`, que não é tentativa de alterar nada e
// está explicada onde o log é gravado.
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

// A ação da pessoa, traduzida para o flag que o parceiro entende. O nome do
// botão vai junto para o log: "desbloquear" e "ativar" acabam os dois em
// `false`, e sem o verbo o histórico não distingue os dois cliques.
const ACOES = {
  ativar:      { campo: "novo_desativado", valor: false },
  desativar:   { campo: "novo_desativado", valor: true  },
  desbloquear: { campo: "novo_bloqueado",  valor: false },
  bloquear:    { campo: "novo_bloqueado",  valor: true  },
} as const;

// `reler` não muda nada: é a leitura ao vivo que a simulação já fazia, virada
// botão, para quem olha a ficha poder conferir o parceiro sem abrir um diálogo
// de bloquear nem correr risco de clicar em confirmar. Fica fora de `ACOES`
// porque não tem flag para pedir.
type Acao = keyof typeof ACOES | "reler";

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
    const clienteId = String(corpo.cliente_id ?? "");
    const acao = String(corpo.acao ?? "") as Acao;
    const ehReler = acao === "reler";
    // `reler` é leitura, e vai SEMPRE com `simular: true`. Não existe forma de
    // pedir uma releitura que grave.
    const simular = corpo.simular === true || ehReler;
    if (!reconId || !clienteId || !(acao in ACOES || ehReler)) {
      return json({
        ok: false,
        mensagem: 'Informe recon_id, cliente_id e acao ("ativar", "desativar", "bloquear", "desbloquear" ou "reler").',
      }, 400);
    }

    // ------------------------------------------------------------ contexto
    const { data: linha, error: errL } = await ds
      .from("reconciliacao_oem")
      .select("id, tenant_id, conta_integration_id, empresa_codigo, filial_codigo, razao_oem, status_oem, bloqueado_oem, desativa_em")
      .eq("id", reconId)
      .maybeSingle();
    if (errL || !linha) {
      return json({ ok: false, mensagem: "Licença não encontrada na conferência. Atualize o espelho." }, 404);
    }
    if (!linha.empresa_codigo || !linha.filial_codigo) {
      return json({ ok: false, mensagem: "A linha não tem grupo/filial do OEM para escrever." }, 409);
    }

    // O VÍNCULO É CONFERIDO AQUI, NÃO NO NAVEGADOR.
    //
    // A ficha só mostra as licenças cujo código está gravado em
    // `cliente_produtos.oem_codigo_filial` — é essa a fonte da verdade do
    // vínculo, e não o `ds_customer_id` da reconciliação, que é palpite do
    // casamento por CNPJ (num grupo que repete o CNPJ, ele aponta todas as
    // filiais para o mesmo cadastro). Refazer a conferência aqui é o que
    // impede um recon_id trocado de desligar a licença de outro cliente.
    const { data: vinculo } = await ds
      .from("cliente_produtos")
      .select("id")
      .eq("cliente_id", clienteId)
      .eq("oem_codigo_filial", linha.filial_codigo)
      .limit(1)
      .maybeSingle();
    if (!vinculo) {
      return json({
        ok: false,
        mensagem: `A filial ${linha.filial_codigo} não está vinculada a este cliente. Confirme o vínculo em Configurações › Integrações › OEM antes de agir sobre a licença.`,
      }, 409);
    }

    // --------------------------------------------------------- permissão
    //
    // Mesma chave dos módulos (`clientes.modulos`), por decisão do Alexandre:
    // quem pode mexer nos módulos do cliente pode ligar e desligar a licença.
    // O nome e a descrição da chave foram atualizados junto (migration
    // 20260901140000) para o "?" da tela de permissões dizer isso.
    //
    // `get_my_permissions` roda COM O TOKEN DA PESSOA e já resolve super admin,
    // rbac desligado, papel e exceção por usuário — reimplementar a régua aqui
    // criaria uma segunda verdade que ia divergir da tela.
    const { data: perms, error: errPerm } = await comoUsuario.rpc("get_my_permissions");
    if (errPerm) return json({ ok: false, mensagem: `Não deu para conferir a permissão: ${errPerm.message}` }, 403);
    const podeModulos = (perms ?? []).some(
      (p: { resource_key: string; can_view: boolean }) =>
        p.resource_key === "clientes.modulos" && p.can_view === true,
    );

    // Permissão diz O QUE a pessoa pode fazer; o tenant diz EM QUEM. As duas
    // são necessárias: `get_my_permissions` não recebe tenant, então sozinha
    // ela liberaria agir sobre a licença de um cliente de outra empresa.
    const { data: perfil } = await ds
      .from("profiles")
      .select("tenant_id, is_super_admin")
      .eq("user_id", u.user.id)
      .maybeSingle();
    const mesmoTenant = perfil?.is_super_admin === true || perfil?.tenant_id === linha.tenant_id;
    if (!podeModulos || !mesmoTenant) {
      return json({ ok: false, mensagem: "Sem permissão para alterar a licença deste cliente no OEM." }, 403);
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

    // ------------------------------------------------------------------------
    // A LEITURA AO VIVO CORRIGE O ESPELHO, MESMO QUANDO NADA É ENVIADO
    // ------------------------------------------------------------------------
    // Toda chamada daqui — inclusive a simulação — faz um GET ao vivo na licença
    // do parceiro, e é esse estado que volta em `antes`. Até 09/09/2026 ele era
    // descartado: o espelho só era tocado depois de uma gravação confirmada.
    //
    // O caso que mostrou o preço disso: a filial 22658 (158 PIZZA & BURGER) foi
    // bloqueada às 08:58, o parceiro respondeu `LicencaBloqueada: true` e a
    // releitura confirmou. Até as 14:06 alguém desfez o bloqueio no OEM, fora do
    // DoctorSaaS. O card continuou afirmando "BLOQUEADO Sim" porque o espelho é
    // uma foto de 6 em 6 horas (cron `17 */6 * * *`), e a operadora clicou em
    // Desbloquear QUATRO vezes: as quatro leram `bloqueado: false` no parceiro,
    // e as quatro jogaram fora a única informação que consertaria a tela.
    //
    // Ler e não gravar é o pior dos dois mundos: paga a chamada e mantém a
    // afirmação errada. Corrigir aqui não custa nenhuma chamada nova.
    //
    // Só entra o que foi REALMENTE lido. `null` num flag quer dizer "não deu
    // para ler" — a guarda do DoctorOEM é sem valor de reserva de propósito — e
    // sobrescrever o espelho com isso trocaria um dado velho por nenhum dado.
    async function corrigirEspelhoComLeitura(
      lido: { bloqueado: boolean | null; desativado: boolean | null; baixa_em?: string | null } | null,
    ) {
      if (!lido) return null;
      const dia = (v: unknown) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);

      const patchRecon: Record<string, unknown> = {};
      const patchEspelho: Record<string, unknown> = {};
      const mudou: { campo: string; de: unknown; para: unknown }[] = [];

      if (typeof lido.bloqueado === "boolean" && lido.bloqueado !== linha.bloqueado_oem) {
        patchRecon.bloqueado_oem = lido.bloqueado;
        patchEspelho.bloqueado = lido.bloqueado;
        mudou.push({ campo: "bloqueado", de: linha.bloqueado_oem, para: lido.bloqueado });
      }

      if (typeof lido.desativado === "boolean") {
        const status = lido.desativado ? "Desativado" : "Ativo";
        if (status !== linha.status_oem) {
          patchRecon.status_oem = status;
          patchEspelho.status = status;
          mudou.push({ campo: "status", de: linha.status_oem, para: status });
        }
      }

      // `baixa_em` sai da leitura documentada, que o modo estado sempre faz, e
      // ali `null` é "não há baixa marcada" de verdade — diferente dos flags.
      // Por isso ela pode ser apagada, e precisa ser: uma baixa cancelada no
      // portal deixaria a ficha prometendo uma data que o parceiro já esqueceu.
      if (lido.baixa_em !== undefined) {
        const novo = dia(lido.baixa_em);
        if (novo !== dia(linha.desativa_em)) {
          patchRecon.desativa_em = novo;
          patchEspelho.desativa_em = novo;
          mudou.push({ campo: "desativa_em", de: linha.desativa_em, para: novo });
        }
      }

      // O CARIMBO VAI MESMO QUANDO NADA DIVERGIU, e é aí que ele mais serve.
      //
      // A carga periódica copia a varredura do DoctorOEM por cima do espelho
      // sem olhar idade, e a varredura pode ser mais velha que esta leitura.
      // Se ele só fosse gravado quando houvesse diferença, uma leitura que
      // CONFIRMA o estado certo não protegeria nada: a carga seguinte poderia
      // trazer o estado antigo da varredura e desfazer a verdade que acabamos
      // de conferir. `estado_lido_em` é o que a `oem-espelho-sync` usa para
      // saber que o dado dela é o velho. Ver a migration 20260910003000.
      patchEspelho.estado_lido_em = new Date().toISOString();

      // `reconciliacao_oem` não tem a coluna e nem precisa: a carga reconstrói
      // o de/para a partir das linhas do espelho, então preservar lá já chega
      // aqui. Sem divergência, não há o que escrever nela.
      if (mudou.length > 0) {
        await ds.from("reconciliacao_oem").update(patchRecon)
          .eq("tenant_id", linha.tenant_id).eq("filial_codigo", linha.filial_codigo);
      }
      await ds.from("oem_espelho_filial").update(patchEspelho)
        .eq("conta_integration_id", conta.id).eq("filial_codigo", linha.filial_codigo);
      return mudou;
    }

    // O modo estado do DoctorOEM não existe sem um pedido: ele precisa de
    // `novo_bloqueado` ou `novo_desativado` para saber que o assunto é a
    // licença e não um módulo. Numa releitura o pedido vai INERTE, com o valor
    // que o espelho já tem, e como `simular` é sempre true nada é enviado ao
    // parceiro: só as duas leituras acontecem, e é delas que sai o `antes`.
    const { campo, valor } = ehReler
      ? { campo: "novo_bloqueado", valor: linha.bloqueado_oem === true }
      : ACOES[acao as keyof typeof ACOES];
    const resp = await fetch(
      `${String(conta.api_url).replace(/\/+$/, "")}/oem-licenca-modulo`,
      {
        method: "POST",
        headers: { "x-api-key": String(chave), "Content-Type": "application/json" },
        body: JSON.stringify({
          empresa: linha.empresa_codigo,
          filial: linha.filial_codigo,
          [campo]: valor,
          simular,
        }),
      },
    );
    const http = resp.status;
    const oem = await resp.json().catch(() => null) as Record<string, any> | null;
    const ok = resp.ok && oem?.ok === true;

    const antes = (oem?.antes ?? null) as { bloqueado: boolean | null; desativado: boolean | null; baixa_em?: string | null } | null;
    const depois = (oem?.depois ?? null) as { bloqueado: boolean | null; desativado: boolean | null } | null;
    const confirmado = oem?.conferencia?.confirmado ?? null;
    // A data em que a licença cai, quando o OEM agendou a baixa em vez de
    // desligar na hora. É o sinal que confirma uma desativação: o `status` da
    // licença só muda no dia.
    const baixaEm = (oem?.conferencia?.baixa_em ?? null) as string | null;

    // A releitura NÃO vira linha no log de estado, e isso é escolha, não
    // esquecimento: aquela tabela é o histórico de tentativas de ALTERAR a
    // licença, e é dela que a conferência diária tira a última intenção de cada
    // filial (`v_oem_divergencia_estado`). Encher de leitura o registro que
    // responde "o que foi pedido aqui" atrapalharia as duas leituras, a humana
    // e a da view. O `acao_check` da tabela também só admite os quatro verbos.
    // O que a releitura muda continua rastreável: ela devolve `espelho_corrigido`
    // com de/para de cada campo.
    if (!ehReler) await ds.from("oem_estado_licenca_log").insert({
      tenant_id: linha.tenant_id,
      conta_integration_id: conta.id,
      cliente_id: clienteId,
      empresa_codigo: linha.empresa_codigo,
      filial_codigo: linha.filial_codigo,
      acao,
      bloqueado_antes: antes?.bloqueado ?? null,
      bloqueado_depois: depois?.bloqueado ?? null,
      desativado_antes: antes?.desativado ?? null,
      desativado_depois: depois?.desativado ?? null,
      simulado: simular,
      ok,
      http,
      confirmado: typeof confirmado === "boolean" ? confirmado : null,
      resposta: oem,
      usuario_id: u.user.id,
    });

    if (!ok) {
      return json({
        ok: false,
        etapa: "oem",
        // A mensagem sobe inteira: "a leitura não trouxe o campo" e "o parceiro
        // recusou" pedem providências diferentes, e resumir apaga a diferença.
        mensagem: String(oem?.mensagem ?? "O OEM recusou a alteração."),
        detalhe: oem,
        http,
      }, 502);
    }

    // --------------------------------------------------------- a releitura
    // Nada foi enviado. O valor todo dela está em `antes` (o estado que o
    // parceiro tem AGORA) e em `espelho_corrigido` (o que a ficha estava
    // dizendo de errado). `leitura_completa: false` é a mesma guarda da
    // simulação: sem os dois flags, o que voltou não dá para acreditar.
    if (ehReler) {
      return json({
        ok: true,
        acao: "reler",
        antes,
        espelho_corrigido: await corrigirEspelhoComLeitura(antes),
        leitura_completa: oem?.pode_gravar === true,
        faltando: oem?.faltando ?? [],
        lido_em: new Date().toISOString(),
      });
    }

    // ------------------------------------------------------- a simulação
    // Devolve o estado do parceiro para a tela montar a confirmação. Nada foi
    // ENVIADO — mas o que foi LIDO corrige o espelho, porque é leitura ao vivo
    // e mais nova que a foto de 6 em 6 horas que a tela está mostrando.
    if (simular) {
      return json({
        ok: true,
        simulado: true,
        acao,
        espelho_corrigido: await corrigirEspelhoComLeitura(antes),
        pode_gravar: oem?.pode_gravar === true,
        faltando: oem?.faltando ?? [],
        sem_mudanca: oem?.sem_mudanca === true,
        antes,
        depois,
        // Só na simulação, e só quando não dá para gravar: é o que resolve um
        // nome de campo divergente em uma tentativa.
        campos_vistos: oem?.pode_gravar === true ? undefined : oem?.campos_vistos ?? null,
      });
    }

    if (oem?.sem_mudanca === true) {
      // "Nada a fazer" quase sempre quer dizer que a TELA estava errada: a
      // pessoa clicou porque o card mostrava o estado contrário. Aqui o espelho
      // também se corrige com a leitura ao vivo, senão o clique seguinte cai no
      // mesmo lugar.
      //
      // A mensagem de lá distingue "já está assim" de "a baixa já está marcada
      // para tal dia", e é a segunda que explica por que o clique não fez nada.
      return json({
        ok: true,
        acao,
        sem_mudanca: true,
        antes,
        espelho_corrigido: await corrigirEspelhoComLeitura(antes),
        mensagem: oem?.mensagem ?? null,
      });
    }

    // ---------------------------------------------------------- o espelho
    //
    // Só com a releitura confirmando. `confirmado: false` quer dizer "não deu
    // para confirmar", não "falhou" — a releitura do parceiro atrasa (medido em
    // 28/08/2026) — e escrever no espelho um estado que não se conseguiu ler
    // seria trocar uma tela atrasada por uma tela errada.
    //
    // Mesmo confirmado, isto é provisório: `status_oem` normalmente vem da
    // listagem do tabletcloud e aqui está vindo da releitura do pdvlegal. Quem
    // tem a palavra final continua sendo a próxima carga do espelho.
    if (confirmado === true && depois) {
      const patchRecon: Record<string, unknown> = {};
      const patchEspelho: Record<string, unknown> = {};
      if (campo === "novo_bloqueado") {
        patchRecon.bloqueado_oem = depois.bloqueado;
        patchEspelho.bloqueado = depois.bloqueado;
      } else if (depois.desativado === true && baixaEm) {
        // DESATIVAR NÃO DESLIGA NA HORA: o OEM marca a baixa para o fim do mês
        // e a licença fica de pé (e cobrando) até lá. Gravar "Desativado" aqui
        // seria a tela contradizendo o portal do parceiro por até 30 dias. O
        // que muda é a DATA, que é o que a ficha já sabe desenhar como
        // "Ativo até 30/09/2026".
        patchRecon.desativa_em = baixaEm;
        patchEspelho.desativa_em = baixaEm;
      } else {
        patchRecon.status_oem = depois.desativado ? "Desativado" : "Ativo";
        patchEspelho.status = depois.desativado ? "Desativado" : "Ativo";
        // Reativar tira a baixa marcada. Deixar a data seria a ficha dizendo
        // que a licença cai numa data que o parceiro já esqueceu.
        if (depois.desativado === false) {
          patchRecon.desativa_em = null;
          patchEspelho.desativa_em = null;
        }
      }
      await ds.from("reconciliacao_oem").update(patchRecon)
        .eq("tenant_id", linha.tenant_id).eq("filial_codigo", linha.filial_codigo);
      await ds.from("oem_espelho_filial").update(patchEspelho)
        .eq("conta_integration_id", conta.id).eq("filial_codigo", linha.filial_codigo);
    }

    return json({
      ok: true,
      acao,
      antes,
      depois,
      confirmado: typeof confirmado === "boolean" ? confirmado : null,
      baixa_em: baixaEm,
      mensagem: oem?.conferencia?.mensagem ?? null,
    });
  } catch (e) {
    return json({ ok: false, mensagem: e instanceof Error ? e.message : String(e) }, 500);
  }
});
