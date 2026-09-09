import { describe, it, expect } from "vitest";
import { PARAMS_ACEITOS, montarParamsAtendimento } from "./useDadosDaSecao";
import { FILTROS_PADRAO } from "./filtrosDaSecao";
import { kpiCatalog } from "@/lib/kpiCatalog";

/** Assinaturas REAIS das funções, copiadas de
 *  `pg_get_function_identity_arguments` em 09/09/2026. Se alguém mudar uma
 *  RPC no banco, este teste não pega sozinho — mas ele impede que a gente
 *  invente parâmetro, que foi o erro que quase subiu: um objeto genérico com
 *  "todos os filtros" quebrava 5 das 11 chamadas. */
const ASSINATURA_REAL: Record<string, string[]> = {
  "atendimento.volume": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.velocidade": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_sla_frt_seconds", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.velocidade_timeline": ["p_tenant_id", "p_date_from", "p_date_to", "p_bucket", "p_department_id", "p_sla_frt_seconds", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.backlog": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id", "p_segmento_ids", "p_area_ids", "p_estado_ids", "p_cidade_ids", "p_fornecedor_ids", "p_produto_ids"],
  "atendimento.agentes": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_is_group", "p_plantao"],
  "atendimento.satisfacao": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.ura": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_plantao"],
  "atendimento.taxonomia": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id", "p_segmento_ids", "p_area_ids", "p_estado_ids", "p_cidade_ids", "p_fornecedor_ids", "p_produto_ids", "p_plantao"],
  "atendimento.clientes": ["p_tenant_id", "p_date_from", "p_date_to", "p_unidade_base_id", "p_segmento_ids", "p_area_ids", "p_estado_ids", "p_cidade_ids", "p_fornecedor_ids", "p_produto_ids"],
  "atendimento.latencia": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_agent_id", "p_is_group"],
  "atendimento.tempo_real": ["p_tenant_id", "p_department_id", "p_sla_threshold_min", "p_unidade_base_id", "p_is_group"],
};

describe("parâmetros das RPCs de Atendimento", () => {
  it("todo parâmetro que a gente manda existe na assinatura da função", () => {
    const invalidos: string[] = [];
    for (const [provider, aceitos] of Object.entries(PARAMS_ACEITOS)) {
      const reais = ASSINATURA_REAL[provider];
      expect(reais, `assinatura real não registrada para ${provider}`).toBeDefined();
      for (const p of aceitos) {
        if (!reais.includes(p)) invalidos.push(`${provider} → ${p}`);
      }
    }
    expect(invalidos).toEqual([]);
  });

  it("o objeto montado nunca leva chave fora da lista aceita", () => {
    for (const provider of Object.keys(PARAMS_ACEITOS)) {
      const params = montarParamsAtendimento(provider as never, "tenant-1", FILTROS_PADRAO, null);
      const sobrando = Object.keys(params).filter(
        (k) => !ASSINATURA_REAL[provider].includes(k),
      );
      expect(sobrando, `sobrou parâmetro em ${provider}`).toEqual([]);
    }
  });

  it("tempo real não recebe intervalo de datas — é foto do agora", () => {
    const params = montarParamsAtendimento(
      "atendimento.tempo_real" as never, "tenant-1", FILTROS_PADRAO, null,
    );
    expect(params.p_date_from).toBeUndefined();
    expect(params.p_date_to).toBeUndefined();
  });

  it("todo provider de Atendimento usado no catálogo tem lista de parâmetros", () => {
    const usados = new Set(
      kpiCatalog
        .filter((e) => e.area === "atendimento" && !e.pending)
        .map((e) => e.source.provider),
    );
    const semLista = [...usados].filter((p) => !(p in PARAMS_ACEITOS));
    expect(semLista).toEqual([]);
  });
});
