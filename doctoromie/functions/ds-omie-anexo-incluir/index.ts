// ============================================================================
// ds-omie-anexo-incluir  (DoctorOMIE)   v3
//
// v3 (17/07/2026) -- O LOG NAO GRAVAVA. Duas linhas.
//     A v2 mandava evento:'incluir' / evento:'excluir'. O integrations_log tem
//     CHECK (evento IN ('criar','atualizar','cancelar','reativar','testar','vincular')).
//     Nenhum dos dois existe. O insert era rejeitado, o supabase-js devolve {error}
//     em vez de lancar, o retorno nunca era lido -- e o log morria em silencio.
//     Medido em producao: anexo nIdAnexo 6841576127 entrou no contrato 7486220198
//     (SERROTINHOS, 17/07 19:54) e integrations_log ficou VAZIO para
//     entidade='contrato_anexo'.
//     E a mesma familia de defeito que o cabecalho da v10 do ds-omie-contrato-alterar
//     descreve: "o que se escreve e o que se le nao conversam". Ali era a chave da
//     referencia; aqui e o vocabulario do evento.
//     Conserto: anexar/remover anexo E atualizar o contrato -> evento='atualizar'.
//     Quem distingue e entidade='contrato_anexo'. Sem migration em tabela que outras
//     cinco funcoes escrevem.
//     E o retorno do insert passa a ser LIDO. Silencio nao e sucesso.
//
// v2 (17/07/2026) -- validacao do nome era CONTAGEM de pontos, igual ao CHECK
//     do banco. Ambas aceitavam ".emptyFolderPlaceholder" (um ponto, nome vazio) e
//     "Nota Fiscal.pdf" (espaco -- nunca testado contra o Omie). Agora as duas usam
//     o MESMO regex: ^[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,10}$
//
// Anexa (ou remove) um arquivo no contrato de servico do Omie.
// Esqueleto copiado do ds-omie-contrato-alterar v10: auth por API key ->
// contracts_mapping -> tenant_credentials -> Omie -> integrations_log.
//
// POR QUE AQUI E NAO NO DS:
//   O DS nao tem as credenciais da Omie. Ele tem a chave dmie_live_, que e o
//   cracha para entrar aqui. Quem guarda omie_app_key/omie_app_secret e o
//   tenant_credentials deste projeto.
//
// POR QUE arquivo_url E NAO base64 NO BODY:
//   O arquivo mora no Storage do DS, que este projeto nao enxerga. Um PDF de 10 MB
//   viraria ~13,5 MB de base64 no corpo do POST; a signed URL tem 200 bytes.
//
// O DE/PARA E O contracts_mapping. Nao existe segunda fonte.
//
// Omie (geral/anexo/):
//   IncluirAnexo { cTabela:'contrato-servico', nId, cNomeArquivo, cTipoArquivo,
//                  cArquivo, cMd5, cCodIntAnexo } -> { nIdAnexo }
//   ExcluirAnexo { cTabela, nId, nIdAnexo }
//   NAO existe AlterarAnexo. Substituir = Incluir + Excluir, nessa ordem.
//
//   cArquivo = base64(zip(arquivo))
//   cMd5     = md5(base64(zip(arquivo)))   <- md5 da STRING base64, nao do binario
//   CONFIRMADO EM PRODUCAO 17/07/2026: nIdAnexo 6841576127, PDF de 16.222 bytes,
//   contrato 7486220198. A regra veio de codigo de terceiro no GitHub, nao da doc
//   oficial -- e se sustentou contra o Omie real.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const OMIE_ANEXO = "https://app.omie.com.br/api/v1/geral/anexo/";
const C_TABELA = "contrato-servico";
const MAX_BYTES = 10 * 1024 * 1024;
// MESMO regex do CHECK contrato_anexos_nome_omie_ck no DS. Se mudar la, muda aqui.
const NOME_VALIDO = /^[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9]{1,10}$/;
const EXT_PROIBIDAS = [
  "exe",
  "bat",
  "com",
  "cmd",
  "scr",
  "js",
  "vbs"
];
// v3: vocabulario do integrations_log. NAO inventar valor novo -- tem CHECK.
// CHECK (evento IN ('criar','atualizar','cancelar','reativar','testar','vincular'))
const EVENTO = "atualizar";
const ENTIDADE = "contrato_anexo";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(b, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
// v3: o insert do log era rejeitado em silencio. Agora o retorno e lido.
// O log nao pode derrubar a resposta -- mas tambem nao pode sumir sem avisar.
async function logar(supa, linha) {
  const { error } = await supa.from("integrations_log").insert(linha);
  if (error) {
    console.error("LOG_FALHOU:", error.message, "| linha:", JSON.stringify(linha).slice(0, 300));
    return false;
  }
  return true;
}
// --- ZIP "stored", sem compressao. O nome interno tem que bater com cNomeArquivo.
function crc32(buf) {
  let c = ~0;
  for(let i = 0; i < buf.length; i++){
    c ^= buf[i];
    for(let k = 0; k < 8; k++)c = c >>> 1 ^ 0xedb88320 & -(c & 1);
  }
  return ~c >>> 0;
}
function storedZip(name, data) {
  const enc = new TextEncoder().encode(name);
  const crc = crc32(data);
  const lh = new DataView(new ArrayBuffer(30));
  lh.setUint32(0, 0x04034b50, true);
  lh.setUint16(4, 20, true);
  lh.setUint32(14, crc, true);
  lh.setUint32(18, data.length, true);
  lh.setUint32(22, data.length, true);
  lh.setUint16(26, enc.length, true);
  const ch = new DataView(new ArrayBuffer(46));
  ch.setUint32(0, 0x02014b50, true);
  ch.setUint16(4, 20, true);
  ch.setUint16(6, 20, true);
  ch.setUint32(16, crc, true);
  ch.setUint32(20, data.length, true);
  ch.setUint32(24, data.length, true);
  ch.setUint16(28, enc.length, true);
  const localLen = 30 + enc.length + data.length;
  const centralLen = 46 + enc.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, 1, true);
  eocd.setUint16(10, 1, true);
  eocd.setUint32(12, centralLen, true);
  eocd.setUint32(16, localLen, true);
  const out = new Uint8Array(localLen + centralLen + 22);
  let o = 0;
  out.set(new Uint8Array(lh.buffer), o);
  o += 30;
  out.set(enc, o);
  o += enc.length;
  out.set(data, o);
  o += data.length;
  out.set(new Uint8Array(ch.buffer), o);
  o += 46;
  out.set(enc, o);
  o += enc.length;
  out.set(new Uint8Array(eocd.buffer), o);
  return out;
}
function toBase64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for(let i = 0; i < bytes.length; i += CHUNK){
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
// --- MD5 puro. O Web Crypto do Deno NAO faz MD5 (so SHA). Sem dependencia externa.
function md5Hex(s) {
  const rl = (n, c)=>n << c | n >>> 32 - c;
  const au = (x, y)=>{
    const l = (x & 0xffff) + (y & 0xffff);
    return (x >> 16) + (y >> 16) + (l >> 16) << 16 | l & 0xffff;
  };
  const cmn = (q, a, b, x, s2, t)=>au(rl(au(au(a, q), au(x, t)), s2), b);
  const ff = (a, b, c, d, x, s2, t)=>cmn(b & c | ~b & d, a, b, x, s2, t);
  const gg = (a, b, c, d, x, s2, t)=>cmn(b & d | c & ~d, a, b, x, s2, t);
  const hh = (a, b, c, d, x, s2, t)=>cmn(b ^ c ^ d, a, b, x, s2, t);
  const ii = (a, b, c, d, x, s2, t)=>cmn(c ^ (b | ~d), a, b, x, s2, t);
  const bytes = new TextEncoder().encode(s);
  const n = bytes.length;
  const words = [];
  for(let i = 0; i < n; i++)words[i >> 2] = (words[i >> 2] || 0) | bytes[i] << i % 4 * 8;
  words[n >> 2] = (words[n >> 2] || 0) | 0x80 << n % 4 * 8;
  const len = ((n + 8 >> 6) + 1) * 16;
  for(let i = words.length; i < len; i++)words[i] = 0;
  words[len - 2] = n * 8;
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for(let i = 0; i < len; i += 16){
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, words[i + 0], 7, -680876936);
    d = ff(d, a, b, c, words[i + 1], 12, -389564586);
    c = ff(c, d, a, b, words[i + 2], 17, 606105819);
    b = ff(b, c, d, a, words[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, words[i + 4], 7, -176418897);
    d = ff(d, a, b, c, words[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, words[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, words[i + 7], 22, -45705983);
    a = ff(a, b, c, d, words[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, words[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, words[i + 10], 17, -42063);
    b = ff(b, c, d, a, words[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, words[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, words[i + 13], 12, -40341101);
    c = ff(c, d, a, b, words[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, words[i + 15], 22, 1236535329);
    a = gg(a, b, c, d, words[i + 1], 5, -165796510);
    d = gg(d, a, b, c, words[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, words[i + 11], 14, 643717713);
    b = gg(b, c, d, a, words[i + 0], 20, -373897302);
    a = gg(a, b, c, d, words[i + 5], 5, -701558691);
    d = gg(d, a, b, c, words[i + 10], 9, 38016083);
    c = gg(c, d, a, b, words[i + 15], 14, -660478335);
    b = gg(b, c, d, a, words[i + 4], 20, -405537848);
    a = gg(a, b, c, d, words[i + 9], 5, 568446438);
    d = gg(d, a, b, c, words[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, words[i + 3], 14, -187363961);
    b = gg(b, c, d, a, words[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, words[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, words[i + 2], 9, -51403784);
    c = gg(c, d, a, b, words[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, words[i + 12], 20, -1926607734);
    a = hh(a, b, c, d, words[i + 5], 4, -378558);
    d = hh(d, a, b, c, words[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, words[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, words[i + 14], 23, -35309556);
    a = hh(a, b, c, d, words[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, words[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, words[i + 7], 16, -155497632);
    b = hh(b, c, d, a, words[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, words[i + 13], 4, 681279174);
    d = hh(d, a, b, c, words[i + 0], 11, -358537222);
    c = hh(c, d, a, b, words[i + 3], 16, -722521979);
    b = hh(b, c, d, a, words[i + 6], 23, 76029189);
    a = hh(a, b, c, d, words[i + 9], 4, -640364487);
    d = hh(d, a, b, c, words[i + 12], 11, -421815835);
    c = hh(c, d, a, b, words[i + 15], 16, 530742520);
    b = hh(b, c, d, a, words[i + 2], 23, -995338651);
    a = ii(a, b, c, d, words[i + 0], 6, -198630844);
    d = ii(d, a, b, c, words[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, words[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, words[i + 5], 21, -57434055);
    a = ii(a, b, c, d, words[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, words[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, words[i + 10], 15, -1051523);
    b = ii(b, c, d, a, words[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, words[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, words[i + 15], 10, -30611744);
    c = ii(c, d, a, b, words[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, words[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, words[i + 4], 6, -145523070);
    d = ii(d, a, b, c, words[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, words[i + 2], 15, 718787259);
    b = ii(b, c, d, a, words[i + 9], 21, -343485551);
    a = au(a, oa);
    b = au(b, ob);
    c = au(c, oc);
    d = au(d, od);
  }
  const hex = (num)=>{
    let s2 = "";
    for(let j = 0; j < 4; j++)s2 += (num >> j * 8 + 4 & 0x0f).toString(16) + (num >> j * 8 & 0x0f).toString(16);
    return s2;
  };
  return hex(a) + hex(b) + hex(c) + hex(d);
}
async function omieCall(call, param, creds) {
  const res = await fetch(OMIE_ANEXO, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      call,
      app_key: creds.app_key,
      app_secret: creds.app_secret,
      param: [
        param
      ]
    })
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch  {
    parsed = {
      raw: text.slice(0, 400)
    };
  }
  return {
    httpOk: res.ok,
    status: res.status,
    body: parsed,
    faultstring: parsed?.faultstring ?? null
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "Metodo nao permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  let tenant_id = null;
  let logPayload = null;
  try {
    // 1) Auth -- mesmo padrao do ds-omie-contrato-alterar.
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!apiKey) return json({
      ok: false,
      error: "Chave ausente"
    }, 401);
    const { data: t, error: vErr } = await supa.rpc("validar_api_key", {
      p_key: apiKey
    });
    if (vErr || !t) return json({
      ok: false,
      error: "Chave invalida"
    }, 401);
    tenant_id = t;
    const body = await req.json().catch(()=>({}));
    const modo = body?.modo === "excluir" ? "excluir" : "incluir";
    const ds_contract_id = body?.ds_contract_id ? String(body.ds_contract_id) : null;
    if (!ds_contract_id) return json({
      ok: false,
      error: "ds_contract_id obrigatorio"
    }, 400);
    // A signed URL NAO entra no log: e credencial de acesso ao arquivo, ainda que curta.
    logPayload = {
      ...body,
      arquivo_url: body?.arquivo_url ? "[signed url omitida]" : undefined
    };
    // 2) De/para -- fonte unica, igual ao alterar. Sem vinculo, nada acontece no Omie.
    const { data: mapC } = await supa.from("contracts_mapping").select("omie_contract_id").eq("tenant_id", tenant_id).eq("ds_contract_id", ds_contract_id).maybeSingle();
    if (!mapC?.omie_contract_id) {
      return json({
        ok: false,
        bloqueado: "sem_depara",
        error: "Contrato nao vinculado no Omie (sem de/para). Anexo nao enviado."
      }, 409);
    }
    const nCodCtr = Number(mapC.omie_contract_id);
    // 3) Credenciais reais da Omie.
    const { data: cred } = await supa.from("tenant_credentials").select("omie_app_key, omie_app_secret").eq("tenant_id", tenant_id).maybeSingle();
    if (!cred?.omie_app_key) return json({
      ok: false,
      error: "Credenciais ausentes"
    }, 400);
    const creds = {
      app_key: cred.omie_app_key,
      app_secret: cred.omie_app_secret
    };
    // ---------------------------------------------------------------- EXCLUIR
    if (modo === "excluir") {
      const nIdAnexo = Number(body?.omie_id_anexo);
      if (!nIdAnexo) return json({
        ok: false,
        error: "omie_id_anexo obrigatorio no modo excluir"
      }, 400);
      // nId vem do caller (o omie_ncodctr CONGELADO no DS), nao deste mapping.
      // Se o contrato foi revinculado depois do envio, o anexo antigo mora no
      // nCodCtr ANTIGO -- resolver de novo aqui deixaria ele orfao no Omie.
      const nIdCtrAlvo = Number(body?.omie_ncodctr ?? nCodCtr);
      const del = await omieCall("ExcluirAnexo", {
        cTabela: C_TABELA,
        nId: nIdCtrAlvo,
        nIdAnexo
      }, creds);
      if (del.faultstring) {
        await logar(supa, {
          tenant_id,
          evento: EVENTO,
          entidade: ENTIDADE,
          status: "erro",
          referencia: ds_contract_id,
          payload: logPayload,
          response: {
            ...del.body,
            nCodCtr: nIdCtrAlvo,
            nIdAnexo,
            acao: "excluir_anexo"
          },
          error_message: del.faultstring
        });
        return json({
          ok: false,
          fase: "excluir",
          error: del.faultstring
        }, 502);
      }
      await logar(supa, {
        tenant_id,
        evento: EVENTO,
        entidade: ENTIDADE,
        status: "sucesso",
        referencia: ds_contract_id,
        payload: logPayload,
        response: {
          ...del.body,
          nCodCtr: nIdCtrAlvo,
          nIdAnexo,
          acao: "excluir_anexo"
        }
      });
      return json({
        ok: true,
        modo: "excluir",
        nCodCtr: nIdCtrAlvo,
        nIdAnexo
      });
    }
    // ---------------------------------------------------------------- INCLUIR
    const nome = String(body?.nome_arquivo ?? "").trim();
    const arquivo_url = String(body?.arquivo_url ?? "").trim();
    if (!nome || !arquivo_url) return json({
      ok: false,
      error: "nome_arquivo e arquivo_url obrigatorios"
    }, 400);
    if (!NOME_VALIDO.test(nome)) {
      return json({
        ok: false,
        bloqueado: "nome_invalido",
        error: `Nome invalido para o Omie: "${nome}". Use letras, numeros, _ ou -, com uma unica extensao.`
      }, 400);
    }
    const ext = nome.split(".").pop().toLowerCase();
    if (EXT_PROIBIDAS.indexOf(ext) !== -1) {
      return json({
        ok: false,
        bloqueado: "extensao_invalida",
        error: `Extensao ${ext} nao aceita.`
      }, 400);
    }
    // 4) Baixa do Storage do DS pela signed URL.
    const dl = await fetch(arquivo_url);
    if (!dl.ok) return json({
      ok: false,
      fase: "download",
      error: `HTTP ${dl.status} ao baixar o arquivo`
    }, 502);
    const bytes = new Uint8Array(await dl.arrayBuffer());
    if (bytes.length === 0) return json({
      ok: false,
      bloqueado: "arquivo_vazio",
      error: "Arquivo vazio"
    }, 400);
    if (bytes.length > MAX_BYTES) {
      return json({
        ok: false,
        bloqueado: "arquivo_grande",
        error: `Arquivo tem ${(bytes.length / 1048576).toFixed(1)} MB; teto atual e 10 MB.`
      }, 413);
    }
    // 5) zip -> base64 -> md5(base64). Confirmado em producao 17/07. Ver cabecalho.
    const cArquivo = toBase64(storedZip(nome, bytes));
    const cMd5 = md5Hex(cArquivo);
    const cCodIntAnexo = String(body?.cod_int_anexo ?? "").slice(0, 20) || undefined;
    // 6) Envia.
    const inc = await omieCall("IncluirAnexo", {
      cTabela: C_TABELA,
      nId: nCodCtr,
      cNomeArquivo: nome,
      cTipoArquivo: ext,
      cArquivo,
      cMd5,
      ...cCodIntAnexo ? {
        cCodIntAnexo
      } : {}
    }, creds);
    if (inc.faultstring) {
      await logar(supa, {
        tenant_id,
        evento: EVENTO,
        entidade: ENTIDADE,
        status: "erro",
        referencia: ds_contract_id,
        payload: logPayload,
        response: {
          ...inc.body,
          nCodCtr,
          acao: "incluir_anexo"
        },
        error_message: inc.faultstring
      });
      return json({
        ok: false,
        fase: "incluir",
        error: inc.faultstring
      }, 502);
    }
    const nIdAnexo = Number(inc.body?.nIdAnexo);
    if (!nIdAnexo) {
      // Sem nIdAnexo nao ha como excluir depois. Nao e sucesso.
      await logar(supa, {
        tenant_id,
        evento: EVENTO,
        entidade: ENTIDADE,
        status: "erro",
        referencia: ds_contract_id,
        payload: logPayload,
        response: {
          ...inc.body,
          nCodCtr,
          acao: "incluir_anexo"
        },
        error_message: "IncluirAnexo respondeu sem nIdAnexo"
      });
      return json({
        ok: false,
        fase: "incluir",
        error: "Omie nao devolveu nIdAnexo"
      }, 502);
    }
    const logOk = await logar(supa, {
      tenant_id,
      evento: EVENTO,
      entidade: ENTIDADE,
      status: "sucesso",
      referencia: ds_contract_id,
      payload: logPayload,
      response: {
        ...inc.body,
        nCodCtr,
        nIdAnexo,
        bytes: bytes.length,
        nome,
        acao: "incluir_anexo"
      }
    });
    // log_gravado vai no retorno: o DS registra 'enviado' de qualquer jeito (o anexo
    // ESTA no Omie), mas quem ler o response sabe se ficou rastro ou nao.
    return json({
      ok: true,
      modo: "incluir",
      nCodCtr,
      nIdAnexo,
      cCodIntAnexo: cCodIntAnexo ?? null,
      log_gravado: logOk
    });
  } catch (e) {
    const msg = e?.message ?? String(e);
    if (tenant_id) {
      await logar(supa, {
        tenant_id,
        evento: EVENTO,
        entidade: ENTIDADE,
        status: "erro",
        payload: logPayload,
        error_message: msg
      });
    }
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
