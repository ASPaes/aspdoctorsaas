import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addMonths, differenceInDays, parseISO } from "date-fns";
import { ShieldCheck, Plus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

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

export default function CertificadoA1Section({ clienteId, vencimento, ultimaVendaEm, ultimoVendedorId, onVencimentoChange, onVendaRegistrada, funcionarios }: Props) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [perdidoTerceiro, setPerdidoTerceiro] = useState(false);
  const [formDirty, setFormDirty] = useState(false);

  const [dataVenda, setDataVenda] = useState(new Date().toISOString().split("T")[0]);
  const [valorVenda, setValorVenda] = useState("");
  const [vendedorId, setVendedorId] = useState("");
  const [observacao, setObservacao] = useState("");
  const [dataBaseRenovacao, setDataBaseRenovacao] = useState("");
  const [motivoPerda, setMotivoPerda] = useState("");

  // beforeunload guard when modal has unsaved data
  useEffect(() => {
    if (!modalOpen || !formDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [modalOpen, formDirty]);

  // Track dirty state
  useEffect(() => {
    if (modalOpen) {
      const hasData = !!valorVenda || !!observacao || !!dataBaseRenovacao || !!motivoPerda || !!vendedorId;
      setFormDirty(hasData);
    }
  }, [modalOpen, valorVenda, observacao, dataBaseRenovacao, motivoPerda, vendedorId]);

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
        .limit(5);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!clienteId,
  });

  const previewVencimento = useMemo(() => {
    const baseDate = perdidoTerceiro ? dataBaseRenovacao : dataVenda;
    if (!baseDate) return null;
    return format(addMonths(parseISO(baseDate), 12), "dd/MM/yyyy");
  }, [perdidoTerceiro, dataVenda, dataBaseRenovacao]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        cliente_id: clienteId,
        data_venda: dataVenda,
        status: perdidoTerceiro ? "perdido_terceiro" : "ganho",
      };
      if (perdidoTerceiro) {
        payload.data_base_renovacao = dataBaseRenovacao || null;
        payload.motivo_perda = motivoPerda || null;
        payload.vendedor_id = vendedorId ? Number(vendedorId) : null;
      } else {
        payload.valor_venda = valorVenda ? Number(valorVenda) : null;
        payload.vendedor_id = vendedorId ? Number(vendedorId) : null;
        payload.observacao = observacao || null;
      }
      const { error } = await supabase.from("certificado_a1_vendas" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda de certificado registrada!");
      queryClient.invalidateQueries({ queryKey: ["cert_a1_vendas", clienteId] });
      setModalOpen(false);
      resetModal();
      onVendaRegistrada();
    },
    onError: (e: any) => toast.error("Erro ao registrar venda: " + e.message),
  });

  const resetModal = () => {
    setPerdidoTerceiro(false);
    setDataVenda(new Date().toISOString().split("T")[0]);
    setValorVenda("");
    setVendedorId("");
    setObservacao("");
    setDataBaseRenovacao("");
    setMotivoPerda("");
    setFormDirty(false);
  };

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
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {vendas.map((v: any) => (
                        <TableRow key={v.id}>
                          <TableCell className="text-xs">{format(parseISO(v.data_venda), "dd/MM/yyyy")}</TableCell>
                          <TableCell className="text-xs">{v.valor_venda ? formatBRL.format(Number(v.valor_venda)) : "—"}</TableCell>
                          <TableCell className="text-xs">{funcionarios.find((f) => f.id === v.vendedor_id)?.nome ?? "—"}</TableCell>
                          <TableCell className="text-xs">
                            {v.status === "perdido_terceiro" ? (
                              <Badge variant="outline" className={badgeClasses.warning}>Perdido p/ terceiro</Badge>
                            ) : (
                              <Badge variant="outline" className={badgeClasses.success}>Ganho</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs max-w-[150px] truncate">{v.observacao || v.motivo_perda || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={modalOpen} onOpenChange={(o) => { setModalOpen(o); if (!o) resetModal(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar Venda de Certificado A1</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox id="perdido" checked={perdidoTerceiro} onCheckedChange={(v) => setPerdidoTerceiro(v === true)} />
              <label htmlFor="perdido" className="text-sm">Já renovado com terceiro</label>
            </div>

            {perdidoTerceiro ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Data base da renovação</label>
                  <Input type="date" value={dataBaseRenovacao} onChange={(e) => setDataBaseRenovacao(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Registrado por</label>
                  <Select value={vendedorId} onValueChange={setVendedorId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {funcionarios.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Motivo / Observação</label>
                  <Textarea value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)} rows={2} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Data da Venda</label>
                  <Input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Valor R$</label>
                  <Input type="number" step="0.01" value={valorVenda} onChange={(e) => setValorVenda(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Vendedor</label>
                  <Select value={vendedorId} onValueChange={setVendedorId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {funcionarios.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Observação</label>
                  <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={2} />
                </div>
              </>
            )}

            {previewVencimento && (
              <div className="rounded-md bg-muted p-3 text-sm">
                <span className="text-muted-foreground">Novo vencimento: </span>
                <span className="font-medium">{previewVencimento}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Salvando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
