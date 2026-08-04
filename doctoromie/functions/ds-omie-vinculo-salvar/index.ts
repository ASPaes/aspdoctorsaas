import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// ds-omie-vinculo-salvar  v3
//
// v3 (23/07/2026) -- GANHA O TIPO 'cliente'.
//   Faltava a peca que permite ao usuario escolher, na tela, QUAL cadastro do Omie um cliente
//   do DS representa. Sem ela, CNPJ com mais de um cadastro no Omie virava beco sem saida:
//   o ds-omie-cliente-upsert bloqueia com 'cnpj_ambiguo_no_omie' e nao havia caminho de
//   resolucao dentro do produto -- so limpando o duplicado no proprio Omie.
//   Caso real, 24/07: BEM ITALIANO MASSAS (CNPJ 59.719.754/0001-49) tem DOIS cadastros ativos
//   no Omie -- 7248322601 (2025) e 7663247653 FOFINHOS AMERICA DO SUL (21/07/2026). Mesmo CNPJ,
//   operacoes diferentes. Nao e sujeira para limpar, e realidade para representar.
//   Escala medida no espelho do Digi Office: 278 CNPJs com mais de um cadastro, 215 com dois ou
//   mais ATIVOS, sobre 2.181 clientes -- ~13% da base. Nao e caso de borda.
//
//   GUARDA OBRIGATORIA: o codigo escolhido tem que EXISTIR no espelho DESTE tenant. Sem isso o
//   backend obedeceria qualquer omie_customer_id vindo do front, e um payload adulterado
//   amarraria o cliente em cadastro de terceiro. O cpf_cnpj gravado vem do ESPELHO, nao do body.
//
//   REVERSIVEL: remover_vinculo passa a aceitar alvo='cliente'. Escolha errada tem volta.
//
// v2: tipos vendedor / produto / ignorar_* / remover_vinculo.
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
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  if (req.method !== "POST") return json({
    ok: false,
    error: "M\u00e9todo n\u00e3o permitido"
  }, 405);
  const supa = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  try {
    // Autenticação por chave (tenant vem da CHAVE)
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
    if (!apiKey) return json({
      ok: false,
      error: "Chave de API ausente"
    }, 401);
    const { data: tenantData, error: validErr } = await supa.rpc("validar_api_key", {
      p_key: apiKey
    });
    if (validErr) {
      console.error("ERRO_VALIDAR_KEY:", JSON.stringify(validErr));
      return json({
        ok: false,
        error: "Falha ao validar chave"
      }, 500);
    }
    if (!tenantData) return json({
      ok: false,
      error: "Chave inv\u00e1lida ou revogada"
    }, 401);
    const tenant_id = tenantData;
    // Corpo
    let body;
    try {
      body = await req.json();
    } catch  {
      return json({
        ok: false,
        error: "JSON inv\u00e1lido"
      }, 400);
    }
    const tipo = body?.tipo;
    // ======================================================================
    // v3 --- CLIENTE: vincular a UM cadastro especifico do Omie.
    // Usado quando o CNPJ tem mais de um cadastro e o usuario escolhe na tela.
    // Com o de/para gravado, o ds-omie-cliente-upsert resolve por ele e nem chega a
    // buscar por CNPJ -- a ambiguidade deixa de existir para este cliente.
    // ======================================================================
    if (tipo === "cliente") {
      const ds_customer_id = body?.ds_customer_id;
      const omie_customer_id = body?.omie_customer_id;
      if (!ds_customer_id || omie_customer_id === undefined || omie_customer_id === null || omie_customer_id === "") {
        return json({
          ok: false,
          error: "ds_customer_id e omie_customer_id s\u00e3o obrigat\u00f3rios"
        }, 400);
      }
      const codigo = Number(omie_customer_id);
      if (!Number.isFinite(codigo) || codigo <= 0) {
        return json({
          ok: false,
          error: "omie_customer_id inv\u00e1lido"
        }, 400);
      }
      // GUARDA: o cadastro escolhido tem que existir no espelho DESTE tenant.
      // Nunca confiar no cpf_cnpj vindo do body -- ele vem daqui.
      const { data: alvo, error: erroAlvo } = await supa.from("omie_clientes").select("codigo_cliente_omie, cnpj_cpf, razao_social").eq("tenant_id", tenant_id).eq("codigo_cliente_omie", codigo).maybeSingle();
      if (erroAlvo) {
        console.error("ERRO_LER_ESPELHO:", JSON.stringify(erroAlvo));
        return json({
          ok: false,
          error: "Falha ao validar o cadastro escolhido."
        }, 500);
      }
      if (!alvo) {
        // Falha FECHADA: espelho desatualizado e melhor que vinculo errado gravado.
        return json({
          ok: false,
          bloqueado: "codigo_omie_desconhecido",
          error: `O c\u00f3digo ${codigo} n\u00e3o foi encontrado no espelho deste tenant. ` + `Aguarde a pr\u00f3xima sincroniza\u00e7\u00e3o e tente de novo.`
        }, 409);
      }
      const { error: erroMap } = await supa.from("customers_mapping").upsert({
        tenant_id,
        ds_customer_id: String(ds_customer_id),
        omie_customer_id: String(codigo),
        cpf_cnpj: alvo.cnpj_cpf,
        sync_status: "sincronizado",
        last_updated: new Date().toISOString()
      }, {
        onConflict: "tenant_id,ds_customer_id"
      });
      if (erroMap) {
        console.error("ERRO_UPSERT_CLIENTE_MAP:", JSON.stringify(erroMap));
        return json({
          ok: false,
          error: "Falha ao salvar o v\u00ednculo do cliente."
        }, 500);
      }
      // Rastro de QUEM escolheu. Vinculo manual e decisao humana -- tem que ficar registrada.
      // Falhar em logar nao pode derrubar um vinculo que ja foi gravado.
      try {
        await supa.from("integrations_log").insert({
          tenant_id,
          evento: "vincular",
          entidade: "cliente",
          status: "sucesso",
          referencia: String(ds_customer_id),
          payload: {
            tipo: "cliente",
            omie_customer_id: codigo,
            usuario: body?.usuario ?? null,
            origem: body?.origem ?? "escolha_manual"
          },
          response: {
            acao: "vinculo_cliente",
            omie_customer_id: codigo,
            razao_social_omie: alvo.razao_social ?? null,
            cpf_cnpj: alvo.cnpj_cpf ?? null
          }
        });
      } catch (e) {
        console.error("FALHA_LOG_VINCULO_CLIENTE:", e.message);
      }
      return json({
        ok: true,
        tipo: "cliente",
        ds_customer_id: String(ds_customer_id),
        omie_customer_id: codigo,
        razao_social_omie: alvo.razao_social ?? null
      });
    }
    // --- VENDEDOR: vincular ---
    if (tipo === "vendedor") {
      const ds_funcionario_id = body?.ds_funcionario_id;
      const nCodVend = body?.nCodVend;
      if (!ds_funcionario_id || nCodVend === undefined || nCodVend === null || nCodVend === "") {
        return json({
          ok: false,
          error: "ds_funcionario_id e nCodVend s\u00e3o obrigat\u00f3rios"
        }, 400);
      }
      const { error } = await supa.from("vendedores_mapping").upsert({
        tenant_id,
        ds_funcionario_id: String(ds_funcionario_id),
        nome_ds: body?.nome_ds ?? null,
        nCodVend: Number(nCodVend),
        nome_omie: body?.nome_omie ?? null,
        origem: "confirmado",
        updated_at: new Date().toISOString()
      }, {
        onConflict: "tenant_id,ds_funcionario_id"
      });
      if (error) {
        console.error("ERRO_UPSERT_VEND:", JSON.stringify(error));
        return json({
          ok: false,
          error: "Falha ao salvar v\u00ednculo de vendedor"
        }, 500);
      }
      return json({
        ok: true,
        tipo: "vendedor",
        ds_funcionario_id: String(ds_funcionario_id),
        nCodVend: Number(nCodVend)
      });
    }
    // --- VENDEDOR: ignorar (sem c\u00f3digo, origem ignorado) ---
    if (tipo === "ignorar_vendedor") {
      const ds_funcionario_id = body?.ds_funcionario_id;
      if (!ds_funcionario_id) return json({
        ok: false,
        error: "ds_funcionario_id \u00e9 obrigat\u00f3rio"
      }, 400);
      const { error } = await supa.from("vendedores_mapping").upsert({
        tenant_id,
        ds_funcionario_id: String(ds_funcionario_id),
        nome_ds: body?.nome_ds ?? null,
        nCodVend: null,
        nome_omie: null,
        origem: "ignorado",
        updated_at: new Date().toISOString()
      }, {
        onConflict: "tenant_id,ds_funcionario_id"
      });
      if (error) {
        console.error("ERRO_IGNORAR_VEND:", JSON.stringify(error));
        return json({
          ok: false,
          error: "Falha ao ignorar vendedor"
        }, 500);
      }
      return json({
        ok: true,
        tipo: "ignorar_vendedor",
        ds_funcionario_id: String(ds_funcionario_id)
      });
    }
    // --- PRODUTO: vincular ---
    if (tipo === "produto") {
      const ds_produto_id = body?.ds_produto_id;
      const cCodCateg = body?.cCodCateg;
      if (!ds_produto_id || !cCodCateg) {
        return json({
          ok: false,
          error: "ds_produto_id e cCodCateg s\u00e3o obrigat\u00f3rios"
        }, 400);
      }
      const { error } = await supa.from("produtos_mapping").upsert({
        tenant_id,
        ds_produto_id: String(ds_produto_id),
        nome_ds: body?.nome_ds ?? null,
        cCodCateg: String(cCodCateg),
        nome_omie: body?.nome_omie ?? null,
        origem: "confirmado",
        updated_at: new Date().toISOString()
      }, {
        onConflict: "tenant_id,ds_produto_id"
      });
      if (error) {
        console.error("ERRO_UPSERT_PROD:", JSON.stringify(error));
        return json({
          ok: false,
          error: "Falha ao salvar v\u00ednculo de produto"
        }, 500);
      }
      return json({
        ok: true,
        tipo: "produto",
        ds_produto_id: String(ds_produto_id),
        cCodCateg: String(cCodCateg)
      });
    }
    // --- PRODUTO: ignorar ---
    if (tipo === "ignorar_produto") {
      const ds_produto_id = body?.ds_produto_id;
      if (!ds_produto_id) return json({
        ok: false,
        error: "ds_produto_id \u00e9 obrigat\u00f3rio"
      }, 400);
      const { error } = await supa.from("produtos_mapping").upsert({
        tenant_id,
        ds_produto_id: String(ds_produto_id),
        nome_ds: body?.nome_ds ?? null,
        cCodCateg: null,
        nome_omie: null,
        origem: "ignorado",
        updated_at: new Date().toISOString()
      }, {
        onConflict: "tenant_id,ds_produto_id"
      });
      if (error) {
        console.error("ERRO_IGNORAR_PROD:", JSON.stringify(error));
        return json({
          ok: false,
          error: "Falha ao ignorar produto"
        }, 500);
      }
      return json({
        ok: true,
        tipo: "ignorar_produto",
        ds_produto_id: String(ds_produto_id)
      });
    }
    // --- REVERTER: remove a linha do mapping (volta a ser pendente) ---
    if (tipo === "remover_vinculo") {
      const alvo = body?.alvo; // 'vendedor' | 'produto' | 'cliente'
      // v3: cliente. Escolha manual errada tem que ter volta.
      if (alvo === "cliente") {
        const ds_customer_id = body?.ds_customer_id;
        if (!ds_customer_id) return json({
          ok: false,
          error: "ds_customer_id \u00e9 obrigat\u00f3rio"
        }, 400);
        const { error } = await supa.from("customers_mapping").delete().eq("tenant_id", tenant_id).eq("ds_customer_id", String(ds_customer_id));
        if (error) {
          console.error("ERRO_REMOVER_CLIENTE_MAP:", JSON.stringify(error));
          return json({
            ok: false,
            error: "Falha ao remover v\u00ednculo do cliente"
          }, 500);
        }
        try {
          await supa.from("integrations_log").insert({
            tenant_id,
            evento: "vincular",
            entidade: "cliente",
            status: "ignorado",
            referencia: String(ds_customer_id),
            payload: {
              tipo: "remover_vinculo",
              alvo: "cliente",
              usuario: body?.usuario ?? null
            },
            error_message: "V\u00ednculo do cliente removido; volta a resolver por CNPJ."
          });
        } catch (e) {
          console.error("FALHA_LOG_REMOVER_CLIENTE:", e.message);
        }
        return json({
          ok: true,
          tipo: "remover_vinculo",
          alvo: "cliente",
          ds_customer_id: String(ds_customer_id)
        });
      }
      if (alvo === "vendedor") {
        const ds_funcionario_id = body?.ds_funcionario_id;
        if (!ds_funcionario_id) return json({
          ok: false,
          error: "ds_funcionario_id \u00e9 obrigat\u00f3rio"
        }, 400);
        const { error } = await supa.from("vendedores_mapping").delete().eq("tenant_id", tenant_id).eq("ds_funcionario_id", String(ds_funcionario_id));
        if (error) {
          console.error("ERRO_REMOVER_VEND:", JSON.stringify(error));
          return json({
            ok: false,
            error: "Falha ao remover v\u00ednculo"
          }, 500);
        }
        return json({
          ok: true,
          tipo: "remover_vinculo",
          alvo: "vendedor",
          ds_funcionario_id: String(ds_funcionario_id)
        });
      }
      if (alvo === "produto") {
        const ds_produto_id = body?.ds_produto_id;
        if (!ds_produto_id) return json({
          ok: false,
          error: "ds_produto_id \u00e9 obrigat\u00f3rio"
        }, 400);
        const { error } = await supa.from("produtos_mapping").delete().eq("tenant_id", tenant_id).eq("ds_produto_id", String(ds_produto_id));
        if (error) {
          console.error("ERRO_REMOVER_PROD:", JSON.stringify(error));
          return json({
            ok: false,
            error: "Falha ao remover v\u00ednculo"
          }, 500);
        }
        return json({
          ok: true,
          tipo: "remover_vinculo",
          alvo: "produto",
          ds_produto_id: String(ds_produto_id)
        });
      }
      return json({
        ok: false,
        error: "alvo inv\u00e1lido (use 'vendedor', 'produto' ou 'cliente')"
      }, 400);
    }
    return json({
      ok: false,
      error: "tipo inv\u00e1lido"
    }, 400);
  } catch (e) {
    const msg = e.message ?? String(e);
    console.error("ERRO_GERAL:", msg);
    return json({
      ok: false,
      error: msg
    }, 500);
  }
});
