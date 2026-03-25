import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CalendarIcon, Plus, Pencil, Trash2, Loader2, CalendarOff } from "lucide-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface Exception {
  id: string;
  date: string;
  type: string;
  name: string | null;
  is_closed: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  holiday: "Feriado",
  collective_leave: "Folga coletiva",
};

export default function BusinessHoursExceptionsSection() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formType, setFormType] = useState<string>("holiday");
  const [formName, setFormName] = useState("");

  // ─── Query ────────────────────────────────────────────────────
  const { data: exceptions = [], isLoading } = useQuery<Exception[]>({
    queryKey: ["business-hours-exceptions", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_hours_exceptions" as any)
        .select("id, date, type, name, is_closed")
        .eq("tenant_id", tid!)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Exception[];
    },
  });

  // ─── Mutations ────────────────────────────────────────────────
  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!formDate || !tid) throw new Error("Data obrigatória");
      const dateStr = format(formDate, "yyyy-MM-dd");
      const payload: any = {
        tenant_id: tid,
        date: dateStr,
        type: formType,
        name: formName.trim() || null,
        is_closed: true,
      };

      if (editingId) {
        const { error } = await (supabase.from("business_hours_exceptions" as any) as any)
          .update({ type: formType, name: payload.name, date: dateStr })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("business_hours_exceptions" as any) as any)
          .insert(payload);
        if (error) {
          if (error.code === "23505") {
            throw new Error("Já existe uma exceção para esta data neste tenant.");
          }
          throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid] });
      toast({ title: editingId ? "Exceção atualizada!" : "Exceção adicionada!" });
      closeDialog();
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("business_hours_exceptions" as any) as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid] });
      toast({ title: "Exceção removida!" });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
    },
  });

  // ─── Dialog helpers ───────────────────────────────────────────
  const openAdd = useCallback(() => {
    setEditingId(null);
    setFormDate(undefined);
    setFormType("holiday");
    setFormName("");
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((ex: Exception) => {
    setEditingId(ex.id);
    setFormDate(parseISO(ex.date));
    setFormType(ex.type);
    setFormName(ex.name || "");
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setEditingId(null);
  }, []);

  return (
    <AccordionItem value="feriados" className="border rounded-lg">
      <AccordionTrigger className="px-4 hover:no-underline">
        <div className="flex items-center gap-2">
          <CalendarOff className="h-5 w-5 text-primary" />
          <span className="font-semibold text-base">Feriados e Folgas Coletivas</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Dias em que o atendimento é considerado fechado, independentemente da grade semanal.
        </p>

        <div className="flex justify-end">
          <Button size="sm" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" />
            Adicionar dia
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : exceptions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nenhum feriado ou folga coletiva cadastrado.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead className="w-24 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.map((ex) => (
                  <TableRow key={ex.id}>
                    <TableCell className="font-medium">
                      {format(parseISO(ex.date), "dd/MM/yyyy")}
                    </TableCell>
                    <TableCell>{TYPE_LABELS[ex.type] || ex.type}</TableCell>
                    <TableCell className="text-muted-foreground">{ex.name || "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => openEdit(ex)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteMutation.mutate(ex.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* ── Add/Edit Dialog ── */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Exceção" : "Adicionar Dia Fechado"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Date picker */}
              <div className="space-y-1.5">
                <Label>Data *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !formDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formDate ? format(formDate, "dd/MM/yyyy") : "Selecionar data"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formDate}
                      onSelect={setFormDate}
                      locale={ptBR}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Type */}
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="holiday">Feriado</SelectItem>
                    <SelectItem value="collective_leave">Folga coletiva</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <Label>Nome / Descrição (opcional)</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ex: Natal, Confraternização Universal..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={closeDialog}>Cancelar</Button>
              <Button
                onClick={() => upsertMutation.mutate()}
                disabled={!formDate || upsertMutation.isPending}
              >
                {upsertMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                {editingId ? "Salvar" : "Adicionar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AccordionContent>
    </AccordionItem>
  );
}
