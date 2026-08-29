// ============================================================================
// oem-licenca-modulo — escreve na licença de UMA filial do OEM: dá baixa (ou
// reduz a quantidade) de UM módulo, e desde 24/08/2026 também corrige o
// CADASTRO da filial (nome da loja e CNPJ).
//
// Os dois casos passam pelo mesmo ler-modificar-gravar porque a API do
// parceiro tem uma rota só, que salva a filial inteira. Quem manda
// novo_nome/novo_cnpj sem modulo_codigo cai no modo cadastro: os módulos
// voltam idênticos aos lidos e só os campos pedidos mudam.
//
// POR QUE ELA É ASSIM
//
// A API do parceiro não tem rota de módulo. O que existe é
// `POST /v1/licenciamento/filial`, que salva a FILIAL INTEIRA: tipo de
// negócio, origem da venda, bloqueio, desativação, usuários, PDVs e a lista
// de módulos. Mandar um payload incompleto não dá erro — ele grava o que
// veio, e some com o resto.
//
// Por isso o desenho é LER-MODIFICAR-GRAVAR: busca a filial em
// `GET /v1/licenciamento/{empresa}/{filial}`, troca só o módulo alvo e devolve
// tudo o mais como estava. E, antes de gravar, confere se os campos que não
// temos como inventar vieram na leitura — `codigoTipoNegocio`,
// `codigoDetalhesTipoNegocio`, `codigoOrigemVenda`, `codProduto`. Faltando
// qualquer um, ela NÃO grava: devolve o que faltou e o payload cru da leitura.
// Perder o tipo de negócio de um cliente é pior do que não dar a baixa.
//
// `simular: true` devolve exatamente o que seria enviado, sem enviar. É assim
// que se confere um mapeamento de campo antes de escrever no sistema do
// parceiro.
//
// Autentica por x-api-key, igual à `oem-exportar`: quem chama é o DoctorSaaS.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b)=>b.toString(16).padStart(2, "0")).join("");
}
async function carregarCreds(db, tenantId) {
  const { data, error } = await db.rpc("obter_credenciais_oem", {
    p_tenant_id: tenantId
  });
  if (error) throw new Error(`obter_credenciais_oem: ${error.message}`);
  if (!data) throw new Error("Credenciais OEM não cadastradas para esta empresa.");
  const c = data;
  const faltando = [
    "username",
    "password",
    "client_id",
    "client_secret"
  ].filter((k)=>!c[k]);
  if (faltando.length) throw new Error(`Credenciais OEM incompletas: ${faltando.join(", ")}.`);
  return {
    baseUrl: (c.base_url ?? "https://api.pdvlegal.com.br").replace(/\/+$/, ""),
    username: c.username,
    password: c.password,
    clientId: c.client_id,
    clientSecret: c.client_secret,
    method: c.method ?? "password"
  };
}
async function obterToken(base, creds) {
  const resp = await fetch(`${base}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: new URLSearchParams({
      username: creds.username,
      password: creds.password,
      grant_type: creds.method || "password",
      client_id: creds.clientId,
      client_secret: creds.clientSecret
    }).toString()
  });
  if (!resp.ok) {
    const t = await resp.text().catch(()=>"");
    throw new Error(`Autenticação em ${base} falhou (HTTP ${resp.status}): ${t.slice(0, 180)}`);
  }
  const j = await resp.json();
  if (!j?.access_token) throw new Error(`Resposta de token sem access_token em ${base}.`);
  return j.access_token;
}
// A leitura e a escrita não usam o mesmo nome para o mesmo campo, e nem sempre
// a mesma caixa. Em vez de adivinhar, procura por todos os apelidos plausíveis
// — e quem decide se achou é o guarda lá embaixo, não esta função.
function pega(obj, ...nomes) {
  for (const n of nomes){
    for (const k of Object.keys(obj)){
      if (k.toLowerCase() === n.toLowerCase() && obj[k] !== null && obj[k] !== undefined) {
        return obj[k];
      }
    }
  }
  return undefined;
}
const num = (v)=>{
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: cors
  });
  try {
    const chave = req.headers.get("x-api-key") ?? (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!chave) {
      return Response.json({
        ok: false,
        mensagem: "Informe a chave em x-api-key."
      }, {
        status: 401,
        headers: cors
      });
    }
    const db = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: {
        persistSession: false
      }
    });
    const { data: registro } = await db.from("oem_api_chaves").select("id, tenant_id, ativa, revogada_em").eq("token_hash", await sha256Hex(chave)).maybeSingle();
    if (!registro || !registro.ativa || registro.revogada_em) {
      return Response.json({
        ok: false,
        mensagem: "Chave inválida."
      }, {
        status: 401,
        headers: cors
      });
    }
    const corpo = await req.json().catch(()=>({}));
    const empresa = String(corpo.empresa ?? "").replace(/\D/g, "");
    const filial = String(corpo.filial ?? "").replace(/\D/g, "");
    const moduloCodigo = num(corpo.modulo_codigo);
    // null/0 = desliga o módulo. Número > 0 = fica ligado com essa quantidade.
    const novaQtd = num(corpo.nova_quantidade) ?? 0;
    const simular = corpo.simular === true;
    // Modo cadastro: sem modulo_codigo e com pelo menos um campo de cadastro.
    const novoNome = corpo.novo_nome === undefined || corpo.novo_nome === null ? undefined : String(corpo.novo_nome).trim();
    const novoCnpj = corpo.novo_cnpj === undefined || corpo.novo_cnpj === null ? undefined : String(corpo.novo_cnpj).replace(/\D/g, "");
    const modoCadastro = moduloCodigo === undefined && (novoNome !== undefined || novoCnpj !== undefined);
    if (!empresa || !filial || (moduloCodigo === undefined && !modoCadastro)) {
      return Response.json({
        ok: false,
        mensagem: 'Informe empresa e filial, mais modulo_codigo (módulo) ou novo_nome/novo_cnpj (cadastro). Ex.: {"empresa":"32801","filial":"39751","modulo_codigo":10,"nova_quantidade":1}'
      }, {
        status: 400,
        headers: cors
      });
    }
    // Documento inválido não vai para o parceiro: é ele que fatura por este
    // número, e a rota salva a filial inteira sem validar nada.
    if (novoCnpj !== undefined && novoCnpj.length !== 11 && novoCnpj.length !== 14) {
      return Response.json({
        ok: false,
        etapa: "entrada",
        mensagem: `novo_cnpj precisa ter 11 (CPF) ou 14 (CNPJ) dígitos. Recebi ${novoCnpj.length}. Nada foi enviado.`
      }, {
        status: 400,
        headers: cors
      });
    }
    if (novoNome !== undefined && novoNome === "") {
      return Response.json({
        ok: false,
        etapa: "entrada",
        mensagem: "novo_nome vazio apagaria o nome da loja no OEM. Nada foi enviado."
      }, {
        status: 400,
        headers: cors
      });
    }
    const creds = await carregarCreds(db, String(registro.tenant_id));
    const token = await obterToken(creds.baseUrl, creds);
    // ------------------------------------------------------------------ ler
    const rLer = await fetch(`${creds.baseUrl}/v1/licenciamento/${empresa}/${filial}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
    const cruTexto = await rLer.text().catch(()=>"");
    let cru = {};
    try {
      cru = JSON.parse(cruTexto);
    } catch  {}
    if (!rLer.ok) {
      return Response.json({
        ok: false,
        etapa: "leitura",
        http: rLer.status,
        corpo: cruTexto.slice(0, 500)
      }, {
        status: 502,
        headers: cors
      });
    }
    const f = cru.filial ?? cru;
    // A leitura do host de ESCRITA chama o preço do módulo de `valor` — não de
    // `valorUnitario`. Sem esse apelido, `?? 0` zerava o preço de todos os
    // módulos da licença a cada gravação (pego na simulação de 21/08/2026, na
    // filial 4517/5089: NFCE 19,69 e Estoque 25,95 iriam a zero).
    const unitDe = (m)=>num(pega(m, "valorUnitario", "valor_unitario", "valorunitario", "valor"));
    const qtdDe = (m)=>num(pega(m, "quantidade", "qtd")) ?? 0;
    // A leitura não traz total por módulo; o total é unitário × quantidade.
    const totalDe = (m)=>num(pega(m, "valorTotal", "valor_total", "valortotal")) ?? Math.round((unitDe(m) ?? 0) * qtdDe(m) * 100) / 100;
    const modulosCrus = pega(f, "modulos") ?? pega(cru, "modulos");
    const payload = {
      codEmpresa: num(pega(f, "codEmpresa", "codempresa", "codgrupoeconomico", "codgrupo")) ?? Number(empresa),
      codFilial: num(pega(f, "codFilial", "codfilial", "codloja")) ?? Number(filial),
      // codProduto vem na RAIZ da resposta, não dentro de `filial` — foi o que
      // barrou a primeira gravação real (21/08/2026). Mesmo tratamento que
      // `modulos` já tinha: procura nos dois lugares.
      codProduto: num(pega(f, "codProduto", "codproduto") ?? pega(cru, "codProduto", "codproduto")),
      nomeLoja: pega(f, "nomeLoja", "nomeloja", "nomefilial", "nome"),
      cpfCnpj: pega(f, "cpfCnpj", "cpf_cnpj", "cnpjloja", "cnpJloja", "cnpj"),
      // Os apelidos textuais (`tipoNegocio`, `detalhesTipoNegocio`, `origemVenda`)
      // trazem "Varejo", "Outros" e "Migração" — TEXTO, não código. Eles passavam
      // pela guarda como se estivessem preenchidos e a gravação iria adiante com
      // tipo de negócio e origem errados, numa rota que salva a filial inteira.
      // Os códigos de verdade estão em codTipoNegocio / codDetalhesTipoNegocio /
      // codOrigemVenda.
      codigoTipoNegocio: num(pega(f, "codTipoNegocio", "codigoTipoNegocio", "codtiponegocio")),
      codigoDetalhesTipoNegocio: num(pega(f, "codDetalhesTipoNegocio", "codigoDetalhesTipoNegocio", "coddetalhestiponegocio")),
      codigoOrigemVenda: num(pega(f, "codOrigemVenda", "codigoOrigemVenda", "codorigemvenda")),
      bloquearLicenca: pega(f, "bloquearLicenca", "bloqueado", "bloquear") === true,
      desativarLicenca: pega(f, "desativarLicenca", "desativado") === true || pega(f, "ativo") === false,
      usuarios: num(pega(f, "usuarios", "usuariosAdicionais", "usuariosadicionais")) ?? 0,
      pdvComandas: num(pega(f, "pdvComandas", "pdvcomandas")) ?? 0
    };
    // ------------------------------------------------------------- o guarda
    const faltando = [];
    for (const k of [
      "codProduto",
      "codigoTipoNegocio",
      "codigoDetalhesTipoNegocio",
      "codigoOrigemVenda"
    ]){
      if (payload[k] === undefined) faltando.push(k);
    }
    if (!Array.isArray(modulosCrus) || modulosCrus.length === 0) faltando.push("modulos");
    // Zero legítimo existe (o NFE custa 0 de verdade). AUSENTE, não: é sintoma
    // de nome de campo divergente, e gravar mandaria zero para uma licença que
    // cobra. Como a rota salva a filial inteira, um preço perdido aqui some da
    // cobrança do parceiro sem ninguém pedir.
    if (Array.isArray(modulosCrus)) {
      const semValor = modulosCrus.filter((m)=>unitDe(m) === undefined).map((m)=>num(pega(m, "codigo", "codModulo", "cod")));
      if (semValor.length) faltando.push(`valor dos módulos ${semValor.join(", ")}`);
    }
    if (faltando.length) {
      return Response.json({
        ok: false,
        etapa: "mapeamento",
        mensagem: "A leitura da filial não trouxe campos obrigatórios da gravação. Nada foi enviado ao OEM.",
        faltando,
        // O payload cru é a resposta: com ele o mapeamento se conserta numa
        // tentativa, em vez de tentar nome por nome no escuro.
        leitura_crua: cru
      }, {
        status: 422,
        headers: cors
      });
    }
    // Reconstrói modulos[] igual ao que veio. A rota salva a filial inteira:
    // omitir a lista some com todos os módulos da licença.
    const espelharModulos = ()=>modulosCrus.map((m)=>({
          codigo: num(pega(m, "codigo", "codModulo", "cod")),
          ativo: pega(m, "ativo") !== false,
          quantidade: num(pega(m, "quantidade", "qtd")) ?? 0,
          valorUnitario: unitDe(m) ?? 0,
          valorTotal: totalDe(m)
        }));
    // ------------------------------------------------------- modo cadastro
    //
    // Corrige nome da loja e/ou CNPJ, sem tocar em módulo nenhum. A guarda
    // acima já garantiu tipo de negócio, origem da venda e preço dos módulos;
    // aqui falta a dos dois campos deste modo: o que NÃO vai ser trocado
    // precisa ter vindo na leitura, senão a gravação da filial inteira o
    // apagaria em silêncio.
    if (modoCadastro) {
      const faltaCadastro = [];
      if (novoNome === undefined && (payload.nomeLoja === undefined || payload.nomeLoja === null)) faltaCadastro.push("nomeLoja");
      if (novoCnpj === undefined && (payload.cpfCnpj === undefined || payload.cpfCnpj === null)) faltaCadastro.push("cpfCnpj");
      if (faltaCadastro.length) {
        return Response.json({
          ok: false,
          etapa: "mapeamento",
          mensagem: "A leitura da filial não trouxe um campo de cadastro que seria regravado. Nada foi enviado ao OEM.",
          faltando: faltaCadastro,
          leitura_crua: cru
        }, {
          status: 422,
          headers: cors
        });
      }
      const antes = {
        nomeLoja: payload.nomeLoja ?? null,
        cpfCnpj: payload.cpfCnpj ?? null
      };
      payload.modulos = espelharModulos();
      if (novoNome !== undefined) payload.nomeLoja = novoNome;
      if (novoCnpj !== undefined) payload.cpfCnpj = novoCnpj;
      const depois = {
        nomeLoja: payload.nomeLoja ?? null,
        cpfCnpj: payload.cpfCnpj ?? null
      };
      if (antes.nomeLoja === depois.nomeLoja && antes.cpfCnpj === depois.cpfCnpj) {
        return Response.json({
          ok: true,
          modo: "cadastro",
          sem_mudanca: true,
          antes,
          mensagem: "O OEM já está com esses valores. Nada foi enviado."
        }, {
          headers: cors
        });
      }
      if (simular) {
        return Response.json({
          ok: true,
          simulado: true,
          modo: "cadastro",
          antes,
          depois,
          payload,
          leitura_crua: cru
        }, {
          headers: cors
        });
      }
      const rCad = await fetch(`${creds.baseUrl}/v1/licenciamento/filial`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });
      const txtCad = await rCad.text().catch(()=>"");
      let respCad = txtCad;
      try {
        respCad = JSON.parse(txtCad);
      } catch  {}
      return Response.json({
        ok: rCad.ok,
        http: rCad.status,
        modo: "cadastro",
        antes,
        depois,
        payload,
        resposta: respCad
      }, {
        status: rCad.ok ? 200 : 502,
        headers: cors
      });
    }
    // ------------------------------------------------------- a conferência
    // Gravar e receber 200 é o parceiro dizendo "aceitei o pedido", NÃO "a
    // licença ficou assim". Por isso a filial é RELIDA depois de gravar.
    //
    // ⚠️ A RELEITURA ATRASA, e isso foi medido em 28/08/2026, não suposto:
    // um cancelamento de 4 para 3 foi aceito, a releitura imediata devolveu 4,
    // e o portal do parceiro já mostrava 3. No mesmo dia, um aumento de 3 para
    // 4 releu 4 na hora. Ou seja: o atraso existe e não é constante.
    //
    // Duas consequências desenharam o que está abaixo:
    //
    //   1. TENTAR MAIS DE UMA VEZ. Uma leitura só, logo depois de gravar,
    //      transforma escrita certa em alarme.
    //   2. NÃO AFIRMAR CAUSA. A versão anterior deste código chamava
    //      "leu o valor antigo numa redução" de baixa agendada para o fim do
    //      mês. Era interpretação, e estava errada. O que dá para afirmar é o
    //      fato: pedimos X e a licença mostrava Y depois de N leituras. Por que,
    //      só o parceiro sabe.
    //
    // `confirmado: false` NÃO quer dizer "falhou" — quer dizer "não deu para
    // confirmar". Quem consome não bloqueia nada com isso (ver a
    // oem-sync-processar): marca e deixa à vista.
    const CONF_TENTATIVAS = 3;
    const CONF_ESPERA_MS = 1500;
    // O módulo cru da última leitura, para o veredito poder olhar campos que a
    // normalização do payload joga fora (e para mostrá-los quando não confirmar).
    let ultimoModuloLido = null;

    async function lerCampoAgora(campoAlvo) {
      const r = await fetch(`${creds.baseUrl}/v1/licenciamento/${empresa}/${filial}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const depois = await r.json().catch(()=>null);
      if (!depois) throw new Error("a releitura não devolveu JSON");
      const d = depois.filial ?? depois;
      if (campoAlvo === "usuarios" || campoAlvo === "pdvComandas") {
        return campoAlvo === "usuarios" ? num(pega(d, "usuarios", "usuariosAdicionais", "usuariosadicionais")) ?? 0 : num(pega(d, "pdvComandas", "pdvcomandas")) ?? 0;
      }
      const lista = pega(d, "modulos") ?? pega(depois, "modulos");
      const alvo = (Array.isArray(lista) ? lista : []).find((m)=>num(pega(m, "codigo", "codModulo", "cod")) === moduloCodigo);
      // Sumiu da lista depois de um pedido de baixa: é baixa feita, não leitura
      // incompleta. Inativo conta como zero pelo mesmo motivo.
      ultimoModuloLido = alvo ?? null;
      return alvo === undefined ? 0 : pega(alvo, "ativo") === false ? 0 : num(pega(alvo, "quantidade", "qtd")) ?? 0;
    }

    // Até quando o módulo continua valendo depois de desmarcado.
    //
    // O portal do parceiro mostra "IFood - Válido até: 31/08/2026" ao lado do
    // módulo desmarcado: desativar CANCELA, mas a licença o mantém válido até o
    // fim do mês. A leitura ainda o conta nesse intervalo, e sem isto um
    // cancelamento CERTO vira observação de alarme na tela (foi o que aconteceu
    // em 28/08/2026).
    //
    // ⚠️ Os nomes dos campos aqui são TENTATIVA, não contrato conhecido. O que
    // se sabe é que a rota de custos chama de `datavalidade`; se a leitura da
    // escrita usar outro nome, nada disto dispara e a conferência segue exatamente
    // como antes. Por isso o módulo cru vai junto no retorno quando não confirma:
    // é ele que mostra os nomes de verdade na próxima ocorrência, em vez de
    // deixar a gente adivinhando de novo.
    function validoAte(m) {
      const v = pega(m, "datavalidade", "dataValidade", "data_validade", "validade", "dataValidadeModulo");
      if (typeof v !== "string" || v.length < 10) return null;
      const d = v.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
      // Data no passado não é baixa combinada: é outra coisa, e não pode virar
      // "está tudo certo".
      return d >= new Date().toISOString().slice(0, 10) ? d : null;
    }

    async function conferir(campoAlvo, esperado, antes) {
      const alvoNum = Number(esperado);
      const antesNum = Number(antes);
      let encontrado;
      let ultimoMotivo = null;
      for(let i = 1; i <= CONF_TENTATIVAS; i++){
        if (i > 1) await new Promise((r)=>setTimeout(r, CONF_ESPERA_MS));
        try {
          encontrado = await lerCampoAgora(campoAlvo);
        } catch (e) {
          ultimoMotivo = e instanceof Error ? e.message : String(e);
          continue;
        }
        if (encontrado === alvoNum) {
          // Módulo LIGADO que continua carregando uma data de validade futura.
          //
          // O contrato de escrita não tem campo de validade: ao reativar, a
          // gente manda `ativo: true` e NÃO limpa a data que ficou do
          // cancelamento anterior. Se o parceiro também não limpar, o módulo
          // volta a funcionar e é desligado na data assim mesmo — e a
          // conferência diria "confirmado", porque a quantidade bate.
          //
          // MEDIDO em 28/08/2026, no portal: marcar o módulo de volta LIMPA a
          // data sozinho. Então, se a gravação por aqui tiver o mesmo efeito
          // que o clique no portal, este aviso nunca dispara — e é justamente
          // por não haver como provar isso daqui que ele existe. Rede de
          // segurança que custa nada quando não é necessária.
          //
          // Não dá para consertar daqui (não há campo de validade para mandar).
          // Dá para NÃO deixar passar calado, que é o que esta linha faz.
          const pendente = alvoNum > 0 && ultimoModuloLido ? validoAte(ultimoModuloLido) : null;
          if (pendente) return {
            confirmado: true,
            campo: campoAlvo,
            esperado: alvoNum,
            antes: antesNum,
            encontrado,
            valido_ate: pendente,
            tentativas: i,
            modulo_lido: ultimoModuloLido,
            mensagem: `Relido no OEM: a licença está com o valor pedido, MAS o módulo segue com validade até ${pendente.split("-").reverse().join("/")}. Enquanto essa data existir, ele será desativado nesse dia mesmo estando ativo agora. Marcar o módulo no portal do parceiro limpa a data.`
          };
          return {
            confirmado: true,
            campo: campoAlvo,
            esperado: alvoNum,
            antes: antesNum,
            encontrado,
            tentativas: i,
            mensagem: "Relido no OEM: a licença está com o valor pedido."
          };
        }
      }
      // Nunca conseguiu ler. Diferente de "leu e não bateu", e a diferença
      // importa: aqui não se sabe nada sobre a licença.
      if (encontrado === undefined) return {
        confirmado: null,
        campo: campoAlvo,
        esperado: alvoNum,
        antes: antesNum,
        tentativas: CONF_TENTATIVAS,
        mensagem: `Não deu para reler a licença depois de gravar: ${ultimoMotivo ?? "motivo desconhecido"}.`
      };
      // Desativação de módulo que o parceiro mantém válido até uma data futura:
      // ele foi cancelado, e a leitura ainda o conta até lá. Isso é o certo
      // acontecendo, não falha — ver o comentário da `validoAte`.
      const ate = alvoNum === 0 && ultimoModuloLido ? validoAte(ultimoModuloLido) : null;
      if (ate) return {
        confirmado: true,
        campo: campoAlvo,
        esperado: alvoNum,
        antes: antesNum,
        encontrado,
        valido_ate: ate,
        tentativas: CONF_TENTATIVAS,
        mensagem: `Módulo cancelado no OEM. A licença o mantém válido até ${ate.split("-").reverse().join("/")}, e até lá a leitura ainda o conta.`
      };

      return {
        confirmado: false,
        campo: campoAlvo,
        esperado: alvoNum,
        antes: antesNum,
        encontrado,
        tentativas: CONF_TENTATIVAS,
        // O módulo como o parceiro devolveu, sem normalizar. É ele que mostra os
        // nomes de campo de verdade quando a `validoAte` não achar a data.
        modulo_lido: ultimoModuloLido,
        mensagem: `O parceiro aceitou o pedido (${alvoNum}), mas a licença ainda mostrava ${encontrado} depois de ${CONF_TENTATIVAS} leituras. A leitura do parceiro às vezes atrasa: confira no portal antes de concluir que não foi.`
      };
    }
    // ------------------------------------------------- nem tudo é "módulo"
    // O contrato de gravação tem CAMPOS PRÓPRIOS para dois deles, fora de
    // modulos[]: `usuarios` e `pdvComandas`. O espelho do lado do DoctorSaaS
    // achata tudo numa lista só, então o pedido chega como "módulo 9" ou
    // "módulo 10" — mas gravar isso dentro de modulos[] não muda a quantidade
    // que o parceiro cobra: cria uma linha espúria e deixa o contador intacto.
    // Conferido na filial 4517/5089 em 21/08/2026: espelho diz Usuário Cloud
    // qtd 2 e Licença PDV qtd 1; a leitura da escrita diz usuarios 2 e
    // pdvComandas 1. São o mesmo número em nomes diferentes.
    const CAMPO_PROPRIO = {
      9: "usuarios",
      10: "pdvComandas"
    };
    // O código 8 é o produto (GESTAO LEGAL), não um módulo: mexer nele por aqui
    // não tem significado.
    if (moduloCodigo === 8) {
      return Response.json({
        ok: false,
        etapa: "modulo",
        mensagem: "O código 8 é o produto da licença, não um módulo. Nada foi enviado."
      }, {
        status: 400,
        headers: cors
      });
    }
    if (CAMPO_PROPRIO[moduloCodigo]) {
      const campo = CAMPO_PROPRIO[moduloCodigo];
      payload.modulos = modulosCrus.map((m)=>({
          codigo: num(pega(m, "codigo", "codModulo", "cod")),
          ativo: pega(m, "ativo") !== false,
          quantidade: num(pega(m, "quantidade", "qtd")) ?? 0,
          valorUnitario: unitDe(m) ?? 0,
          valorTotal: totalDe(m)
        }));
      // Antes de sobrescrever: é este número que diz se o pedido sobe ou desce,
      // e a régua da conferência depende disso.
      const antes = num(payload[campo]) ?? 0;
      payload[campo] = novaQtd;
      if (simular) {
        return Response.json({
          ok: true,
          simulado: true,
          campo,
          payload,
          leitura_crua: cru
        }, {
          headers: cors
        });
      }
      const rC = await fetch(`${creds.baseUrl}/v1/licenciamento/filial`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(payload)
      });
      const txtC = await rC.text().catch(()=>"");
      let respC = txtC;
      try {
        respC = JSON.parse(txtC);
      } catch  {}
      return Response.json({
        ok: rC.ok,
        http: rC.status,
        campo,
        payload,
        resposta: respC,
        conferencia: rC.ok ? await conferir(campo, novaQtd, antes) : null
      }, {
        status: rC.ok ? 200 : 502,
        headers: cors
      });
    }
    // Quanto o módulo tinha ANTES, para a conferência saber se o pedido sobe ou
    // desce. Módulo que não está na licença, ou está inativo, vale zero.
    const moduloAntes = modulosCrus.find((m)=>num(pega(m, "codigo", "codModulo", "cod")) === moduloCodigo);
    const antesDoModulo = moduloAntes === undefined ? 0 : pega(moduloAntes, "ativo") === false ? 0 : qtdDe(moduloAntes);
    let achou = false;
    payload.modulos = modulosCrus.map((m)=>{
      const cod = num(pega(m, "codigo", "codModulo", "cod"));
      const qtd = num(pega(m, "quantidade", "qtd")) ?? 0;
      const unit = unitDe(m) ?? 0;
      const total = totalDe(m);
      const ativo = pega(m, "ativo") !== false;
      if (cod !== moduloCodigo) {
        return {
          codigo: cod,
          ativo,
          quantidade: qtd,
          valorUnitario: unit,
          valorTotal: total
        };
      }
      achou = true;
      if (novaQtd > 0) {
        return {
          codigo: cod,
          ativo: true,
          quantidade: novaQtd,
          valorUnitario: unit,
          valorTotal: Math.round(unit * novaQtd * 100) / 100
        };
      }
      return {
        codigo: cod,
        ativo: false,
        quantidade: 0,
        valorUnitario: unit,
        valorTotal: 0
      };
    });
    // Módulo que ainda não está na licença só entra se vier valor: sem preço,
    // ele seria acrescentado valendo zero e o parceiro deixaria de cobrar algo
    // que o cliente passou a usar.
    if (!achou && novaQtd > 0) {
      const unit = num(corpo.valor_unitario);
      if (unit === undefined) {
        return Response.json({
          ok: false,
          etapa: "modulo",
          mensagem: `O módulo ${moduloCodigo} não está na licença ${empresa}/${filial}. Para acrescentá-lo, informe valor_unitario.`
        }, {
          status: 400,
          headers: cors
        });
      }
      payload.modulos.push({
        codigo: moduloCodigo,
        ativo: true,
        quantidade: novaQtd,
        valorUnitario: unit,
        valorTotal: Math.round(unit * novaQtd * 100) / 100
      });
      achou = true;
    }
    if (!achou) {
      return Response.json({
        ok: false,
        etapa: "modulo",
        mensagem: `A licença ${empresa}/${filial} não tem o módulo ${moduloCodigo}. Nada foi enviado.`,
        modulos_na_licenca: modulosCrus.map((m)=>pega(m, "codigo", "codModulo", "cod"))
      }, {
        status: 404,
        headers: cors
      });
    }
    if (simular) {
      return Response.json({
        ok: true,
        simulado: true,
        payload,
        leitura_crua: cru
      }, {
        headers: cors
      });
    }
    // ---------------------------------------------------------------- gravar
    const rGravar = await fetch(`${creds.baseUrl}/v1/licenciamento/filial`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });
    const respTexto = await rGravar.text().catch(()=>"");
    let resposta = respTexto;
    try {
      resposta = JSON.parse(respTexto);
    } catch  {}
    return Response.json({
      ok: rGravar.ok,
      http: rGravar.status,
      payload,
      resposta,
      conferencia: rGravar.ok ? await conferir(`modulos[${moduloCodigo}]`, novaQtd, antesDoModulo) : null
    }, {
      status: rGravar.ok ? 200 : 502,
      headers: cors
    });
  } catch (e) {
    return Response.json({
      ok: false,
      mensagem: e instanceof Error ? e.message : String(e)
    }, {
      status: 500,
      headers: cors
    });
  }
});
