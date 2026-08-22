import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOmieContaDoCliente } from "@/hooks/useOmieContaDoCliente";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cloud } from "lucide-react";
import EnviarOmieComPreviaButton, {
  type ContratoParaEnvioOmie,
} from "./EnviarOmieComPreviaButton";

interface Props {
  clienteId: string;
}

// O botão (dry_run → confirmação → criar) saiu daqui para EnviarOmieComPreviaButton: o diálogo de
// fim do cadastro de produto promete a mesma pré-visualização e precisava do mesmo botão.
interface ContratoAtivo extends ContratoParaEnvioOmie {
  vlr_total_mensal: number | null;
  modelos_contrato?: { nome: string } | null;
}

const brl = (v: any) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(v ?? 0));

export default function IntegracaoOmieCard({ clienteId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();

  // A conta Omie vem da UNIDADE DO CLIENTE, não do tenant: com duas contas, o .maybeSingle()
  // por tenant erra ("multiple rows returned"), a query falha e o card some da tela.
  const contaOmieQuery = useOmieContaDoCliente(clienteId);
  const integracaoAtivaQuery = { data: contaOmieQuery.data?.ativo === true, isLoading: contaOmieQuery.isLoading };

  const contratosQuery = useQuery({
    queryKey: ["contratos_ativos_omie", tid, clienteId],
    enabled: !!clienteId && !!tid && integracaoAtivaQuery.data === true,
    queryFn: async () => {
      let q = (supabase.from("contratos") as any)
        .select("id, numero, vlr_total_mensal, status, modelos_contrato:modelo_contrato_id(nome)")
        .eq("cliente_id", clienteId)
        .eq("status", "ativo")
        .order("numero", { ascending: false });
      if (tid) q = q.eq("tenant_id", tid);
      const { data: contratos, error } = await q;
      if (error) throw error;

      const ids = (contratos ?? []).map((c: any) => c.id);
      let vinculos: any[] = [];
      if (ids.length > 0) {
        const { data: v, error: vError } = await supabase
          .from("reconciliacao_cadastro")
          .select("ds_contract_id, codigo_contrato_omie")
          .eq("tenant_id", tid)
          .eq("estado_match", "CASADO")
          .not("codigo_contrato_omie", "is", null)
          .in("ds_contract_id", ids);
        if (vError) throw vError;
        vinculos = v ?? [];
      }

      const vinculoMap = new Map<string, string | number>(
        vinculos.map((v) => [v.ds_contract_id, v.codigo_contrato_omie])
      );

      return (contratos ?? []).map((c: any) => {
        const codigo = vinculoMap.get(c.id) ?? null;
        return {
          ...c,
          sincronizado: codigo != null,
          codigo_contrato_omie: codigo,
        } as ContratoAtivo;
      });
    },
  });

  // Não renderiza nada enquanto não souber se a integração está ativa.
  if (!tid || integracaoAtivaQuery.data !== true) {
    return null;
  }

  const contratos = contratosQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cloud className="h-5 w-5" />
          Integração Omie
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contratosQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando contratos...</div>
        ) : contratos.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Este cliente não possui contratos ativos para enviar ao Omie.
          </div>
        ) : contratos.length === 1 ? (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-sm min-w-0">
              <div className="font-medium">
                Contrato Nº {contratos[0].numero ?? "—"}
              </div>
              <div className="text-muted-foreground text-xs">
                {brl(contratos[0].vlr_total_mensal)}/mês
                {contratos[0].modelos_contrato?.nome
                  ? ` · ${contratos[0].modelos_contrato.nome}`
                  : ""}
              </div>
            </div>
            <EnviarOmieComPreviaButton
              tenantId={tid}
              contrato={contratos[0]}
              clienteId={clienteId}
              onEnviado={() => contratosQuery.refetch()}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Este cliente possui {contratos.length} contratos ativos. Escolha qual enviar:
            </div>
            {contratos.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 border rounded-md p-3 flex-wrap"
              >
                <div className="text-sm min-w-0">
                  <div className="font-medium font-mono">Nº {c.numero ?? "—"}</div>
                  <div className="text-muted-foreground text-xs flex items-center gap-2">
                    <Badge variant="secondary">{brl(c.vlr_total_mensal)}/mês</Badge>
                    {c.modelos_contrato?.nome && <span>{c.modelos_contrato.nome}</span>}
                  </div>
                </div>
                <EnviarOmieComPreviaButton
                  tenantId={tid}
                  contrato={c}
                  clienteId={clienteId}
                  onEnviado={() => contratosQuery.refetch()}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
