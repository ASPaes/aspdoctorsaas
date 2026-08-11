import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * Qual conta Omie atende ESTE cliente (ou este contrato).
 *
 * Um tenant pode ter uma conta Omie por unidade base — Digi Office e Digi Up, hoje. As telas do
 * detalhe do cliente perguntavam "existe integração ativa neste tenant?" com
 * `.eq("tenant_id", tid).maybeSingle()`, que com duas linhas **erra** ("multiple rows returned"):
 * a query falha, o hook devolve nada e o card de integração some da tela — foi o que aconteceu com
 * a Digi Up assim que ela virou a segunda conta.
 *
 * A conta certa vem da unidade do cliente, que é a mesma regra que o `enfileirar_sync_omie` usa
 * para carimbar a fila e que a `omie-integration-call` usa para escolher a chave. Assim a tela
 * concorda com o motor por construção, em vez de por coincidência.
 *
 * Cliente sem unidade, ou de unidade que não pertence a nenhuma conta (Nutrebem, por exemplo),
 * devolve `conta: null` — e aí o card não aparece mesmo, que é o correto: esse cliente não vai
 * para o Omie.
 */
export type OmieContaDoCliente = {
  id: string;
  ativo: boolean;
  integracao_pausada: boolean;
  integrar_a_partir_de: string | null;
  unidades_base_ids: number[] | null;
};

export function useOmieContaDoCliente(
  clienteId: string | null | undefined,
  /** Alternativa quando a tela só tem o contrato em mãos (ex.: o botão "Enviar ao Omie"). */
  contratoId?: string | null,
) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["omie_conta_do_cliente", tid, clienteId, contratoId],
    enabled: !!tid && (!!clienteId || !!contratoId),
    queryFn: async (): Promise<OmieContaDoCliente | null> => {
      let alvoCliente = clienteId ?? null;
      if (!alvoCliente && contratoId) {
        const { data: ctr, error: ctrErr } = await (supabase.from("contratos" as any) as any)
          .select("cliente_id")
          .eq("id", contratoId)
          .maybeSingle();
        if (ctrErr) throw ctrErr;
        alvoCliente = (ctr as any)?.cliente_id ?? null;
      }
      if (!alvoCliente) return null;

      const [cliRes, contasRes] = await Promise.all([
        (supabase.from("clientes" as any) as any)
          .select("unidade_base_id")
          .eq("id", alvoCliente)
          .maybeSingle(),
        (supabase.from("omie_integration" as any) as any)
          .select("id, ativo, integracao_pausada, integrar_a_partir_de, unidades_base_ids")
          .eq("tenant_id", tid as string),
      ]);
      if (cliRes.error) throw cliRes.error;
      if (contasRes.error) throw contasRes.error;

      const contas = (contasRes.data ?? []) as OmieContaDoCliente[];
      if (contas.length === 0) return null;

      const unidade = (cliRes.data as any)?.unidade_base_id ?? null;
      // Escopo vazio significa "todas as unidades" — é como fica o tenant que nunca precisou
      // separar por unidade, e o comportamento tem de continuar idêntico para ele.
      const cobre = (c: OmieContaDoCliente) =>
        !c.unidades_base_ids || c.unidades_base_ids.length === 0 || (unidade != null && c.unidades_base_ids.includes(Number(unidade)));

      if (contas.length === 1) return cobre(contas[0]) ? contas[0] : null;
      if (unidade == null) return null;
      return contas.find(cobre) ?? null;
    },
  });
}
