import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOemIntegracaoAtiva } from "@/hooks/useOemIntegracaoAtiva";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, Lock, TrendingDown } from "lucide-react";

// ============================================================================
// As licenças do OEM deste cliente.
//
// A mensalidade é do CLIENTE e o custo é da FILIAL: um cliente com três lojas
// paga uma mensalidade e consome três licenças. Por isso a margem aqui é
// mensalidade − SOMA dos custos, e não uma conta por linha.
//
// "Desativado" e "Bloqueado" são dimensões independentes, e a regra comercial
// é do Alexandre: desativado não cobra, bloqueado cobra. O custo total só
// soma as licenças ativas.
// ============================================================================

type Licenca = {
  id: string;
  filial_codigo: string | null;
  empresa_codigo: string | null;
  razao_oem: string | null;
  custo_oem: number | null;
  status_oem: string | null;
  bloqueado_oem: boolean | null;
  mensalidade_ds: number | null;
  status_usuario: string;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function IntegracaoOemCard({ clienteId }: { clienteId: string }) {
  const { effectiveTenantId: tid } = useTenantFilter();

  // Sem conta OEM conectada o card nem existe — não é para aparecer vazio nos
  // tenants que não usam a integração.
  const temConta = useOemIntegracaoAtiva();

  const { data: licencas = [] } = useQuery({
    queryKey: ["oem-licencas-cliente", tid, clienteId],
    enabled: !!tid && !!clienteId && temConta === true,
    queryFn: async () => {
      const { data, error } = await (supabase.from("reconciliacao_oem" as any) as any)
        .select(
          "id, filial_codigo, empresa_codigo, razao_oem, custo_oem, status_oem, " +
          "bloqueado_oem, mensalidade_ds, status_usuario",
        )
        .eq("ds_customer_id", clienteId)
        .not("filial_codigo", "is", null)
        .order("filial_codigo");
      if (error) throw error;
      return (data ?? []) as Licenca[];
    },
  });

  if (!tid || temConta !== true || licencas.length === 0) return null;

  const ativas = licencas.filter((l) => l.status_oem === "Ativo");
  const custo = ativas.reduce((a, l) => a + Number(l.custo_oem || 0), 0);
  const mensalidade = Number(licencas[0]?.mensalidade_ds || 0);
  const margem = mensalidade - custo;
  const bloqueadas = ativas.filter((l) => l.bloqueado_oem).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4" /> Licenças no OEM
          <Badge variant="secondary">{licencas.length}</Badge>
          {bloqueadas > 0 && (
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" /> {bloqueadas} bloqueada{bloqueadas > 1 ? "s" : ""}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Custo das ativas: <strong className="tabular-nums">{brl(custo)}</strong></span>
          <span>Mensalidade: <strong className="tabular-nums">{brl(mensalidade)}</strong></span>
          <span className={margem < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}>
            Margem: <strong className="tabular-nums">{brl(margem)}</strong>
            {margem < 0 && <TrendingDown className="inline h-3.5 w-3.5 ml-1" />}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y border-t">
          {licencas.map((l) => (
            <div key={l.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{l.razao_oem ?? `Filial ${l.filial_codigo}`}</p>
                <p className="text-xs text-muted-foreground">
                  filial {l.filial_codigo} · grupo {l.empresa_codigo}
                  {l.status_usuario === "vinculado" && " · vinculada à mão"}
                </p>
              </div>
              {l.bloqueado_oem && <Badge variant="destructive" className="text-xs">bloqueada</Badge>}
              <Badge variant={l.status_oem === "Ativo" ? "secondary" : "outline"} className="text-xs">
                {l.status_oem ?? "—"}
              </Badge>
              <span className="tabular-nums text-muted-foreground w-24 text-right">
                {l.status_oem === "Ativo" ? brl(l.custo_oem) : "—"}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
