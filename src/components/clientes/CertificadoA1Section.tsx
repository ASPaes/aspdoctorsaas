import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format, differenceInDays, differenceInMinutes, parseISO } from "date-fns";
import { ShieldCheck, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import CertA1VendaModal from "./CertA1VendaModal";

interface Props {
  clienteId?: string;
  vencimento: string | null;
  ultimaVendaEm: string | null;
  ultimoVendedorId: number | null;
  onVencimentoChange: (v: string | null) => void;
  onVendaRegistrada: () => void;
  funcionarios: { id: number; nome: string }[];
}

function getCertStatus(vencimento: string | null) {
  if (!vencimento) return { label: "Sem certificado", variant: "secondary" as const };
  const diff = differenceInDays(parseISO(vencimento), new Date());
  if (diff < 0) return { label: "Vencido", variant: "destructive" as const };
  if (diff <= 30) return { label: "Vence em breve", variant: "warning" as const };
  return { label: "Válido", variant: "success" as const };
}

const badgeClasses: Record<string, string> = {
  destructive: "bg-primary/15 text-primary border-primary/30",
  warning: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  success: "bg-green-500/15 text-green-600 border-green-500/30",
  secondary: "",
};

const formatBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function detectDuplicates(vendas: any[]): Set<string> {
  const dupeIds = new Set<string>();
  for (let i = 0; i < vendas.length; i++) {
    for (let j = i + 1; j < vendas.length; j++) {
      const a = vendas[i], b = vendas[j];
      if (a.data_venda === b.data_venda && a.status === b.status) {
        const diff = Math.abs(differenceInMinutes(parseISO(a.created_at), parseISO(b.created_at)));
        if (diff < 5) {
          dupeIds.add(a.id);
          dupeIds.add(b.id);
        }
      }
    }
  }
  return dupeIds;
}

export default function CertificadoA1Section({ clienteId, vencimento, ultimaVendaEm, ultimoVendedorId, onVencimentoChange, onVendaRegistrada, funcionarios }: Props) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin;
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const status = getCertStatus(vencimento);
  const vendedorNome = useMemo(
    () => funcionarios.find((f) => f.id === ultimoVendedorId)?.nome ?? "—",
    [funcionarios, ultimoVendedorId]
  );

  const { data: vendas, isLoading: vendasLoading } = useQuery({
    queryKey: ["cert_a1_vendas", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("certificado_a1_vendas" as any)
        .select("*")
        .eq("cliente_id", clienteId)
        .order("data_venda", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!clienteId,
  });

  const dupeIds = useMemo(() => detectDuplicates(vendas ?? []), [vendas]);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("certificado_a1_vendas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Registro excluído.");
      queryClient.invalidateQueries({ queryKey: ["cert_a1_vendas", clienteId] });
      queryClient.invalidateQueries({ queryKey: ["cert-a1-dashboard"] });
      setDeleteId(null);
      onVendaRegistrada();
    },
    onError: (e: any) => toast.error("Erro ao excluir: " + e.message),
  });

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Certificado Digital A1
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Vencimento</label>
              <Input
                type="date"
                value={vencimento ?? ""}
                onChange={(e) => onVencimentoChange(e.target.value || null)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <div className="pt-2">
                <Badge variant="outline" className={badgeClasses[status.variant] || ""}>
                  {status.label}
                </Badge>
              </div>
            </div>
            {clienteId && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Última Venda</label>
                <p className="text-sm pt-2">
                  {ultimaVendaEm ? format(parseISO(ultimaVendaEm), "dd/MM/yyyy") : "—"}
                  {ultimaVendaEm && <span className="text-muted-foreground"> por {vendedorNome}</span>}
                </p>
              </div>
            )}
          </div>

          {clienteId ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Registrar Venda
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Salve o cliente para registrar vendas de certificado.</p>
          )}

          {clienteId && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-medium mb-2">Histórico de Vendas</h4>
                {vendasLoading ? (
                  <Skeleton className="h-20 w-full" />
                ) : !vendas || vendas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma venda registrada.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Data</TableHead>
                        <TableHead className="text-xs">Valor</TableHead>
                        <TableHead className="text-xs">Vendedor</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs">Obs.</TableHead>
                        {isAdmin && <TableHead className="text-xs w-[50px]">Ações</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendas.map((v: any) => {
                        const isDupe = dupeIds.has(v.id);
                        return (
                          <TableRow key={v.id}>
                            <TableCell className="text-xs">{format(parseISO(v.data_venda), "dd/MM/yyyy")}</TableCell>
                            <TableCell className="text-xs">{v.valor_venda ? formatBRL.format(Number(v.valor_venda)) : "—"}</TableCell>
                            <TableCell className="text-xs">{funcionarios.find((f) => f.id === v.vendedor_id)?.nome ?? "—"}</TableCell>
                            <TableCell className="text-xs">
                              <div className="flex items-center gap-1">
                                {v.status === "perdido_terceiro" ? (
                                  <Badge variant="outline" className={badgeClasses.warning}>Perdido p/ terceiro</Badge>
                                ) : (
                                  <Badge variant="outline" className={badgeClasses.success}>Ganho</Badge>
                                )}
                                {isDupe && (
                                  <Badge variant="outline" className="bg-amber-500/15 text-amber-600 border-amber-500/30 text-[10px]">
                                    Possível duplicidade
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs max-w-[150px] truncate">{v.observacao || v.motivo_perda || "—"}</TableCell>
                            {isAdmin && (
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(v.id)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {clienteId && (
        <CertA1VendaModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          clienteId={clienteId}
          funcionarios={funcionarios}
          onVendaRegistrada={onVendaRegistrada}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir registro de venda?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O registro será permanentemente removido.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo…" : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
