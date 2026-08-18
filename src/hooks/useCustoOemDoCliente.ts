import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOemIntegracaoAtiva } from "./useOemIntegracaoAtiva";

// ============================================================================
// Quanto as licenças do OEM deste cliente custam — a mesma regra que a aba
// Custos e o card "Licenças no OEM" usam, num lugar só.
//
// O VÍNCULO VALE PELO CÓDIGO GRAVADO NA FICHA, não por `ds_customer_id`.
// O ds_customer_id é palpite do casamento automático por CNPJ, e num grupo que
// repete o CNPJ ele aponta TODAS as filiais para o mesmo cadastro — foi assim
// que uma ficha somou o custo de 38 lojas contra a mensalidade de uma. O que
// vale é o par grupo+filial em `cliente_produtos.oem_codigo_filial`, escrito
// só quando não há dúvida.
//
// SÓ LICENÇA ATIVA ENTRA NO CUSTO. Regra do Alexandre: desativado não cobra,
// bloqueado cobra. Cliente sem nenhuma licença ativa devolve `estado:
// "sem-licenca-ativa"` em vez de custo zero — zero seria lido como "o OEM não
// cobra nada", quando o certo é "não há com o que comparar".
// ============================================================================

export type CustoOemCliente =
  | { estado: "sem-integracao" | "sem-vinculo" | "sem-licenca-ativa"; custoOem: null; licencas: 0 }
  | { estado: "ok"; custoOem: number; licencas: number };

export function useCustoOemDoCliente(clienteId?: string): CustoOemCliente {
  const { effectiveTenantId: tid } = useTenantFilter();
  const temConta = useOemIntegracaoAtiva();
  const ativo = !!tid && !!clienteId && temConta === true;

  const { data: codigos = [] } = useQuery({
    queryKey: ["oem-codigos-cliente", tid, clienteId],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produtos" as any) as any)
        .select("oem_codigo_filial")
        .eq("cliente_id", clienteId)
        .not("oem_codigo_filial", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => String(r.oem_codigo_filial));
    },
  });

  const { data: licencas = [] } = useQuery({
    // Chave PRÓPRIA, não a do IntegracaoOemCard. Os dois pedem a mesma tabela,
    // mas com listas de colunas diferentes: com a chave compartilhada, quem
    // resolvesse primeiro encheria o cache e o outro receberia um objeto sem
    // os campos que ele usa. Uma requisição a mais vale menos que esse bug.
    queryKey: ["oem-custo-cliente", tid, clienteId, codigos.join(",")],
    enabled: ativo && codigos.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("reconciliacao_oem" as any) as any)
        .select("filial_codigo, custo_oem, status_oem")
        .eq("tenant_id", tid)
        .in("filial_codigo", codigos);
      if (error) throw error;
      return (data ?? []) as { custo_oem: number | null; status_oem: string | null }[];
    },
  });

  if (temConta !== true) return { estado: "sem-integracao", custoOem: null, licencas: 0 };
  if (codigos.length === 0) return { estado: "sem-vinculo", custoOem: null, licencas: 0 };

  const ativas = licencas.filter((l) => l.status_oem === "Ativo");
  if (ativas.length === 0) return { estado: "sem-licenca-ativa", custoOem: null, licencas: 0 };

  return {
    estado: "ok",
    custoOem: ativas.reduce((a, l) => a + Number(l.custo_oem || 0), 0),
    licencas: ativas.length,
  };
}

// A chave dos CÓDIGOS é a mesma do IntegracaoOemCard de propósito — ali a
// query é idêntica, colunas inclusive, e os dois componentes aparecem juntos na
// ficha: o react-query resolve uma vez e serve aos dois.
