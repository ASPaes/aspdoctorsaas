import { useState, useCallback, useMemo } from "react";
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
import { Switch } from "@/components/ui/switch";
import { CalendarIcon, Plus, Pencil, Trash2, Loader2, CalendarOff, Download } from "lucide-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface Exception {
  id: string;
  date: string;
  type: string;
  name: string | null;
  is_closed: boolean;
  use_template: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  holiday: "Feriado",
  collective_leave: "Folga coletiva",
};

function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function addDias(d: Date, n: number): Date {
  const novo = new Date(d);
  novo.setDate(novo.getDate() + n);
  return novo;
}

function ymd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getFeriadosNacionais(ano: number): { date: string; name: string }[] {
  const pascoa = calcularPascoa(ano);
  const sextaSanta = addDias(pascoa, -2);
  const corpusChristi = addDias(pascoa, 60);

  return [
    { date: `${ano}-01-01`, name: "Confraternização Universal" },
    { date: ymd(sextaSanta), name: "Sexta-feira da Paixão" },
    { date: `${ano}-04-21`, name: "Tiradentes" },
    { date: `${ano}-05-01`, name: "Dia do Trabalhador" },
    { date: ymd(corpusChristi), name: "Corpus Christi" },
    { date: `${ano}-09-07`, name: "Independência do Brasil" },
    { date: `${ano}-10-12`, name: "Nossa Senhora Aparecida" },
    { date: `${ano}-11-02`, name: "Finados" },
    { date: `${ano}-11-15`, name: "Proclamação da República" },
    { date: `${ano}-11-20`, name: "Consciência Negra" },
    { date: `${ano}-12-25`, name: "Natal" },
  ];
}

const ANOS_DISPONIVEIS = (() => {
  const atual = new Date().getFullYear();
  return [atual, atual + 1, atual + 2];
})();

export default function BusinessHoursExceptionsSection() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState<Date | undefined>();
  const [formType, setFormType] = useState<string>("holiday");
  const [formName, setFormName] = useState("");

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importAno, setImportAno] = useState(ANOS_DISPONIVEIS[0]);

  const { data: exceptions = [], isLoading } = useQuery<Exception[]>({
    queryKey: ["business-hours-exceptions", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("business_hours_exceptions" as any)
        .select("id, date, type, name, is_closed, use_template")
        .eq("tenant_id", tid!)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Exception[];
    },
  });

  const { data: template } = useQuery<any>({
    queryKey: ["tenant-holiday-template", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenant_holiday_template" as any) as any)
        .select("*")
        .eq("tenant_id", tid)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const templateValido = !!(template?.open_at && template?.close_at);
  const formatTemplateRange = () => {
    if (!templateValido) return "—";
    return `${template.open_at.slice(0, 5)}–${template.close_at.slice(0, 5)}`;
  };

  const datasJaCadastradas = useMemo(
    () => new Set(exceptions.map((e) => e.date)),
    [exceptions]
  );

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
        use_template: false,
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

  const importMutation = useMutation({
    mutationFn: async (ano: number) => {
      if (!tid) throw new Error("tenant_id ausente");
      const lista = getFeriadosNacionais(ano);
      const novos = lista.filter((f) => !datasJaCadastradas.has(f.date));
      if (novos.length === 0) {
        return { inseridos: 0, ignorados: lista.length };
      }
      const payload = novos.map((f) => ({
        tenant_id: tid,
        date: f.date,
        type: "holiday",
        name: f.name,
        is_closed: true,
        use_template: false,
      }));
      const { error } = await (supabase.from("business_hours_exceptions" as any) as any)
        .insert(payload);
      if (error) {
        if (error.code !== "23505") throw error;
      }
      return { inseridos: novos.length, ignorados: lista.length - novos.length };
    },
    onSuccess: ({ inseridos, ignorados }) => {
      qc.invalidateQueries({ queryKey: ["business-hours-exceptions", tid] });
      if (inseridos === 0) {
        toast({ title: "Nenhum feriado novo", description: `Todos os ${ignorados} feriados nacionais já estavam cadastrados.` });
      } else {
        toast({ title: "Feriados importados!", description: `${inseridos} adicionado${inseridos > 1 ? "s" : ""}${ignorados > 0 ? `, ${ignorados} já existia${ignorados > 1 ? "m" : ""}` : ""}.` });
      }
      setImportDialogOpen(false);
    },
    onError: (err: any) => {
      toast({ title: "Erro ao importar", description: err.message, variant: "destructive" });
    },
  });

  const previewImport = useMemo(() => {
    const lista = getFeriadosNacionais(importAno);
    return lista.map((f) => ({
      ...f,
      jaExiste: datasJaCadastradas.has(f.date),
    }));
  }, [importAno, datasJaCadastradas]);

  const totalNovos = previewImport.filter((p) => !p.jaExiste).length;

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

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Download className="h-4 w-4 mr-1" />
            Importar feriados nacionais
          </Button>
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

        {/* ── Import Dialog ── */}
        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col gap-0 p-0">
            <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
              <DialogTitle>Importar feriados nacionais</DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto px-6 py-2 space-y-4 min-h-0">
              <p className="text-sm text-muted-foreground">
                Importa os feriados nacionais oficiais brasileiros (não-facultativos). Feriados já cadastrados são ignorados.
              </p>

              <div className="space-y-1.5">
                <Label>Ano</Label>
                <Select value={String(importAno)} onValueChange={(v) => setImportAno(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ANOS_DISPONIVEIS.map((a) => (
                      <SelectItem key={a} value={String(a)}>{a}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Data</TableHead>
                      <TableHead className="text-xs">Nome</TableHead>
                      <TableHead className="text-xs text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewImport.map((f) => (
                      <TableRow key={f.date} className={f.jaExiste ? "opacity-50" : ""}>
                        <TableCell className="text-xs font-medium">
                          {format(parseISO(f.date), "dd/MM/yyyy")}
                        </TableCell>
                        <TableCell className="text-xs">{f.name}</TableCell>
                        <TableCell className="text-xs text-right">
                          {f.jaExiste ? (
                            <span className="text-muted-foreground">Já existe</span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400">Será adicionado</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                {totalNovos === 0
                  ? "Todos os feriados nacionais deste ano já estão cadastrados."
                  : `${totalNovos} novo${totalNovos > 1 ? "s" : ""} feriado${totalNovos > 1 ? "s" : ""} ser${totalNovos > 1 ? "ão" : "á"} adicionado${totalNovos > 1 ? "s" : ""}.`}
              </p>
            </div>
            <DialogFooter className="px-6 py-4 border-t shrink-0">
              <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => importMutation.mutate(importAno)}
                disabled={totalNovos === 0 || importMutation.isPending}
              >
                {importMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                <Download className="h-4 w-4 mr-1" />
                Importar {totalNovos > 0 ? `(${totalNovos})` : ""}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AccordionContent>
    </AccordionItem>
  );
}
