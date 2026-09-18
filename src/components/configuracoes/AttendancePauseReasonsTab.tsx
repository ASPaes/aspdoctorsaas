import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Plus, Pencil, Loader2, MessageSquareText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { NumericInput } from "@/components/ui/numeric-input";

interface PauseReason {
  id: string;
  name: string;
  average_minutes: number;
  is_active: boolean;
  sort_order: number;
  tenant_id: string;
  auto_message: string | null;
}

export default function AttendancePauseReasonsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PauseReason | null>(null);
  const [name, setName] = useState("");
  const [averageMinutes, setAverageMinutes] = useState<number>(15);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [autoMessage, setAutoMessage] = useState("");

  const { data: reasons = [], isLoading } = useQuery({
    queryKey: ["support_pause_reasons", tid],
    queryFn: async () => {
      // auto_message (DEM-0341) ainda não está no types.ts gerado.
      let q = (supabase.from("support_pause_reasons" as any) as any)
        .select("*")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PauseReason[];
    },
    enabled: !!tid,
  });

  const openNew = () => {
    setEditing(null);
    setName("");
    setAverageMinutes(15);
    setIsActive(true);
    setSortOrder((reasons.length + 1) * 10);
    setAutoMessage("");
    setDialogOpen(true);
  };

  const openEdit = (r: PauseReason) => {
    setEditing(r);
    setName(r.name);
    setAverageMinutes(r.average_minutes);
    setIsActive(r.is_active);
    setSortOrder(r.sort_order);
    setAutoMessage(r.auto_message ?? "");
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Nome é obrigatório");
      if (averageMinutes < 1) throw new Error("Tempo médio deve ser no mínimo 1 minuto");
      if (!tid) throw new Error("Tenant não selecionado");

      const payload = {
        name: name.trim(),
        average_minutes: averageMinutes,
        is_active: isActive,
        sort_order: sortOrder,
        auto_message: autoMessage.trim() || null,
      };

      if (editing) {
        const { error } = await (supabase.from("support_pause_reasons" as any) as any)
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("support_pause_reasons" as any) as any)
          .insert({ ...payload, tenant_id: tid });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support_pause_reasons", tid] });
      toast({ title: "Salvo!", description: editing ? "Motivo atualizado." : "Motivo criado." });
      setDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Motivos de Pausa</CardTitle>
          <CardDescription>Gerencie os motivos disponíveis para pausas dos atendentes.</CardDescription>
        </div>
        <Button onClick={openNew} size="sm">
          <Plus className="mr-2 h-4 w-4" />Novo motivo
        </Button>
      </CardHeader>
      <CardContent>
        {reasons.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Nenhum motivo cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ordem</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tempo médio (min)</TableHead>
                <TableHead>Mensagem ao cliente</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead className="w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {reasons.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.sort_order}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.average_minutes} min</TableCell>
                  <TableCell className="max-w-[280px]">
                    {r.auto_message ? (
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground" title={r.auto_message}>
                        <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="truncate">{r.auto_message}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Não envia</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={r.is_active ? "text-green-600" : "text-muted-foreground"}>
                      {r.is_active ? "Sim" : "Não"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar motivo" : "Novo motivo de pausa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nome *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Almoço" />
            </div>
            <div className="space-y-2">
              <Label>Tempo médio (minutos) *</Label>
              <NumericInput value={averageMinutes} onChange={setAverageMinutes} placeholder="15" suffix="min" />
            </div>
            <div className="space-y-2">
              <Label>Mensagem automática ao cliente</Label>
              <Textarea
                value={autoMessage}
                onChange={(e) => setAutoMessage(e.target.value)}
                placeholder="Ex: Estou em horário de almoço e retorno em breve. Sua mensagem já está registrada."
                rows={3}
                maxLength={1000}
              />
              <p className="text-xs text-muted-foreground">
                Enviada uma vez por pausa, quando o cliente escreve num atendimento de quem está pausado.
                Sai com "Mensagem automática" no início. Em branco, nada é enviado.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Ordem de exibição</Label>
              <NumericInput value={sortOrder} onChange={setSortOrder} placeholder="0" />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label>Ativo</Label>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
