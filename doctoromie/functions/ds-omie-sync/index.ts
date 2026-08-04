// ============================================================================
// FUNÇÃO DESCONTINUADA / ARQUIVADA — NÃO USAR.
//
// Substituída pela integração validada:
//   - Cliente: ds-omie-cliente-upsert (UpsertCliente, anti-dup por codigo_cliente_integracao)
//   - Contrato (futuro): função própria via IncluirContrato, com campos validados.
//
// Motivo do arquivamento: esta versão usava nomes de campo Omie NÃO validados
// (info_cadastro, codigo_servico_municipal, departamentos[].valor, etc.) e
// NUNCA executou em produção (zero registros em integrations_log, zero invocações).
// Mantida desativada para evitar DUAS integrações concorrentes escrevendo nas
// mesmas tabelas (customers_mapping, contracts_mapping).
//
// O código original está preservado no comentário ao final como referência.
// Arquivada em 2026-06-25.
// ============================================================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
Deno.serve((req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  console.error("CHAMADA_A_FUNCAO_DESCONTINUADA: ds-omie-sync foi invocada, mas est\u00e1 arquivada.");
  return new Response(JSON.stringify({
    ok: false,
    descontinuada: true,
    error: "Fun\u00e7\u00e3o descontinuada. Use ds-omie-cliente-upsert para cliente; a integra\u00e7\u00e3o de contrato ser\u00e1 feita por fun\u00e7\u00e3o pr\u00f3pria validada."
  }), {
    status: 410,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}); /* ===========================================================================
   CÓDIGO ORIGINAL PRESERVADO PARA REFERÊNCIA (NÃO EXECUTA)
   ---------------------------------------------------------------------------
   import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

   const OMIE_BASE = "https://app.omie.com.br/api/v1";
   type OmieCreds = { app_key: string; app_secret: string };

   async function omieCall(endpoint, call, param, creds) {
     const res = await fetch(OMIE_BASE + endpoint, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ call, app_key: creds.app_key, app_secret: creds.app_secret, param: [param] }),
     });
     // ... lança erro se !res.ok; retorna JSON
   }

   proximoMes01(): "01/MM/AAAA" do próximo mês
   hojeBR(): "DD/MM/AAAA" de hoje

   upsertClienteOmie(creds, cliente):
     - ConsultarCliente por cnpj_cpf -> se achar, AlterarCliente; senão IncluirCliente
     - (Substituído por UpsertCliente em ds-omie-cliente-upsert)

   Deno.serve handler:
     body = { tenant_id, evento, contrato }
     - se contrato.modelo_contrato != "Cobrança Direta" -> loga 'ignorado' e sai
     - lê tenant_credentials e settings_default
     - upsertClienteOmie -> grava customers_mapping
     - monta contratoOmie com blocos:
         cabecalho { codigo_cliente, data_primeiro_vencimento, valor_total, numero_parcelas }
         departamentos [{ valor: mrr }]
         itens [{ item: { codigo_servico_municipal, descricao_servico, valor_total, quantidade } }]
         info_cadastro { vendedor, categoria, conta_corrente, tipo_faturamento,
                         dia_vencimento, dia_faturamento, vigencia_final,
                         postergar_fds, adicionar_periodo_referencia, adicionar_vencimento_parcela }
         observacoes { obs_contrato }
         email_cliente { enviar_link_nfse, enviar_boleto }
     - evento 'cancelar' -> AlterarContrato com data_vigencia_final = hoje
     - evento 'reativar' -> AlterarContrato com data_vigencia_final = ""
     - existe contrato -> AlterarContrato (+ nota up-sell/down-sell se mrr mudou)
     - senão -> IncluirContrato + AtivarContrato
     - grava contracts_mapping e integrations_log

   OBS IMPORTANTE: os nomes de campo acima (info_cadastro, codigo_servico_municipal,
   departamentos[].valor, codigo_cliente, codigo_contrato) NÃO foram validados contra
   a API Omie. Ao construir a função de contrato nova, confirmar cada um na fonte,
   como feito em ds-omie-contract-update (nCodCtr, infAdic, itensContrato, etc.).
=========================================================================== */ 
