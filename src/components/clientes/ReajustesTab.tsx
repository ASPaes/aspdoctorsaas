import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, Percent, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DefinirDatasReajusteDialog from "./DefinirDatasReajusteDialog";


interface ReajustesTabProps {
  tenantId: string | null;
}

interface ReajusteRow {
  id: string;
  tenant_id: string;
  usuario_id: string | null;
  data_lancamento: string;
  periodo_inicio: string;
  periodo_fim: string;
  percentual_padrao: number;
  status: "pendente" | "aplicado" | "estornado";
  qtd_contratos: number;
  vlr_mensal_total_antes: number;
  vlr_reajuste_total: number;
  vlr_mensal_total_depois: number;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const statusClass = (s: string) => {
  if (s === "aplicado") return "bg-green-500/10 text-green-500 border-green-500/20";
  if (s === "estornado") return "bg-red-500/10 text-red-500 border-red-500/20";
  return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
};

export default function ReajustesTab({ tenantId }: ReajustesTabProps) {
  const queryClient = useQueryClient();
  const [definirDatasOpen, setDefinirDatasOpen] = useState(false);
  const notImpl = () => toast.info("Funcionalidade em desenvolvimento");


  const { data: semDataCount } = useQuery({
    queryKey: ["contratos_sem_data_reajuste", tenantId],
    queryFn: async () => {
      let q = (supabase.from("contratos" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("status", "ativo")
        .is("data_proximo_reajuste", null);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: reajustes, isLoading } = useQuery({
    queryKey: ["reajustes_list", tenantId],
    queryFn: async () => {
      let q = (supabase.from("reajustes" as any) as any)
        .select("*")
        .order("data_lancamento", { ascending: false });
      if (tenantId) q = q.eq("tenant_id", tenantId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as ReajusteRow[];

      const userIds = Array.from(
        new Set(rows.map((r) => r.usuario_id).filter((v): v is string => !!v))
      );
      let nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles, error: pErr } = await (supabase as any)
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", userIds);
        if (pErr) throw pErr;
        nameMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p.full_name ?? ""]));
      }
      return rows.map((r) => ({
        ...r,
        usuario_nome: r.usuario_id ? nameMap.get(r.usuario_id) ?? "—" : "—",
      }));
    },
  });

  return (
    <div className="space-y-4">
      {(semDataCount ?? 0) > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm">
              <span className="font-medium">{semDataCount}</span> contratos sem data de
              reajuste definida. Defina as datas para que apareçam nos filtros de período.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setDefinirDatasOpen(true)}>
            Definir datas
          </Button>

        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Lotes de reajuste</h2>
        <Button
          onClick={notImpl}
          className="bg-green-600 hover:bg-green-700 text-white"
        >
          <Plus className="h-4 w-4 mr-1" />
          Novo reajuste
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !reajustes || reajustes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Percent className="h-12 w-12 mb-3 opacity-50" />
          <p>Nenhum reajuste registrado</p>
        </div>
      ) : (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Período</TableHead>
                <TableHead className="text-right">%</TableHead>
                <TableHead className="text-right">Contratos</TableHead>
                <TableHead className="text-right">MRR antes</TableHead>
                <TableHead className="text-right">Delta</TableHead>
                <TableHead className="text-right">MRR depois</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reajustes.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>
                    {format(parseISO(r.data_lancamento), "dd/MM/yyyy HH:mm")}
                  </TableCell>
                  <TableCell>{r.usuario_nome}</TableCell>
                  <TableCell>
                    {format(parseISO(r.periodo_inicio), "MMM/yyyy", { locale: ptBR })}
                  </TableCell>
                  <TableCell className="text-right">
                    {Number(r.percentual_padrao).toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right">{r.qtd_contratos}</TableCell>
                  <TableCell className="text-right">
                    {fmtBRL(Number(r.vlr_mensal_total_antes))}
                  </TableCell>
                  <TableCell className="text-right text-green-400">
                    +{fmtBRL(Number(r.vlr_reajuste_total))}
                  </TableCell>
                  <TableCell className="text-right">
                    {fmtBRL(Number(r.vlr_mensal_total_depois))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusClass(r.status)}>
                      {r.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DefinirDatasReajusteDialog
        open={definirDatasOpen}
        onOpenChange={setDefinirDatasOpen}
        tenantId={tenantId}
        onSuccess={() =>
          queryClient.invalidateQueries({ queryKey: ["contratos_sem_data_reajuste", tenantId] })
        }
      />
    </div>
  );
}

