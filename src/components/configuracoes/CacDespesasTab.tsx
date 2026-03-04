import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const CATEGORIAS = [
  { value: "marketing", label: "Marketing" },
  { value: "custos_vendas", label: "Custos com Vendas" },
  { value: "comissoes", label: "Comissões" },
  { value: "salarios_diretos", label: "Salários Diretos" },
  { value: "salarios_parciais", label: "Salários Parciais (Rateio)" },
  { value: "ferramentas", label: "Ferramentas" },
  { value: "outros_vendas", label: "Outros (Vendas)" },
] as const;

const categoriaLabel = (v: string) =>
  CATEGORIAS.find((c) => c.value === v)?.label ?? v;

type Despesa = {
  id: string;
  mes_inicial: string;
  mes_final: string | null;
  ativo: boolean;
  categoria: string;
  descricao: string;
  valor_total: number;
  percentual_alocado_vendas: number | null;
  valor_alocado: number;
  unidade_base_id: number | null;
  created_at: string;
};

type FormState = {
  mes_inicial: string;
  mes_final: string;
  categoria: string;
  descricao: string;
  valor_total: number;
  percentual_alocado_vendas: number;
  unidade_base_id: string;
  ativo: boolean;
};

const emptyForm: FormState = {
  mes_inicial: "",
  mes_final: "",
  categoria: "marketing",
  descricao: "",
  valor_total: 0,
  percentual_alocado_vendas: 100,
  unidade_base_id: "",
  ativo: true,
};

export default function CacDespesasTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq("tenant_id", tid) : q;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Lookup unidades_base
  const { data: unidades } = useQuery({
    queryKey: ["unidades_base", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        supabase.from("unidades_base").select("id, nome").order("nome")
      );
      if (error) throw error;
      return data;
    },
  });

  // Fetch despesas
  const { data: despesas, isLoading } = useQuery({
    queryKey: ["cac_despesas", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        (supabase.from("cac_despesas" as any) as any)
          .select("*")
          .order("mes_inicial", { ascending: false })
      );
      if (error) throw error;
      return data as unknown as Despesa[];
    },
  });

  const unidadeMap = useMemo(() => {
    const m = new Map<number, string>();
    unidades?.forEach((u) => m.set(u.id, u.nome));
    return m;
  }, [unidades]);

  const calcValorAlocado = (f: FormState) =>
    f.categoria === "salarios_parciais"
      ? f.valor_total * (f.percentual_alocado_vendas / 100)
      : f.valor_total;

  const saveMutation = useMutation({
    mutationFn: async (f: FormState) => {
      const payload: any = {
        mes_inicial: f.mes_inicial,
        mes_final: f.mes_final || null,
        categoria: f.categoria,
        descricao: f.descricao,
        valor_total: f.valor_total,
        percentual_alocado_vendas:
          f.categoria === "salarios_parciais" ? f.percentual_alocado_vendas / 100 : null,
        valor_alocado: calcValorAlocado(f),
        unidade_base_id: f.unidade_base_id ? Number(f.unidade_base_id) : null,
        ativo: f.ativo,
      };
      if (editingId) {
        const { error } = await (supabase.from("cac_despesas" as any) as any)
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("cac_despesas" as any) as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cac_despesas"] });
      toast({ title: editingId ? "Despesa atualizada!" : "Despesa criada!" });
      closeDialog();
    },
    onError: (e: any) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("cac_despesas" as any) as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cac_despesas"] });
      toast({ title: "Despesa excluída!" });
      setDeleteId(null);
    },
    onError: (e: any) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const toggleAtivoMutation = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase.from("cac_despesas" as any) as any)
        .update({ ativo })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cac_despesas"] }),
    onError: (e: any) =>
      toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (d: Despesa) => {
    setEditingId(d.id);
    setForm({
      mes_inicial: d.mes_inicial,
      mes_final: d.mes_final ?? "",
      categoria: d.categoria,
      descricao: d.descricao,
      valor_total: d.valor_total,
      percentual_alocado_vendas:
        d.percentual_alocado_vendas != null ? d.percentual_alocado_vendas * 100 : 100,
      unidade_base_id: d.unidade_base_id?.toString() ?? "",
      ativo: d.ativo,
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
  };

  const fmtMoney = (v: number) =>
    v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  const fmtPeriod = (ini: string, fim: string | null) => {
    const i = format(new Date(ini + "T12:00:00"), "MM/yyyy");
    if (!fim) return `${i} →`;
    return `${i} – ${format(new Date(fim + "T12:00:00"), "MM/yyyy")}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Gerencie as despesas que compõem o CAC (Custo de Aquisição de Clientes).
        </p>
        <Button onClick={openNew} size="sm">
          <Plus className="h-4 w-4" /> Nova Despesa
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Categoria</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Valor Total</TableHead>
              <TableHead className="text-right">Valor Alocado</TableHead>
              <TableHead>Unidade Base</TableHead>
              <TableHead>Ativo</TableHead>
              <TableHead className="w-[80px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {(!despesas || despesas.length === 0) && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  Nenhuma despesa cadastrada.
                </TableCell>
              </TableRow>
            )}
            {despesas?.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{categoriaLabel(d.categoria)}</TableCell>
                <TableCell>{d.descricao}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtPeriod(d.mes_inicial, d.mes_final)}</TableCell>
                <TableCell className="text-right">{fmtMoney(d.valor_total)}</TableCell>
                <TableCell className="text-right">{fmtMoney(d.valor_alocado)}</TableCell>
                <TableCell>
                  {d.unidade_base_id ? unidadeMap.get(d.unidade_base_id) ?? "—" : "Geral"}
                </TableCell>
                <TableCell>
                  <Switch
                    checked={d.ativo}
                    onCheckedChange={(v) => toggleAtivoMutation.mutate({ id: d.id, ativo: v })}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(d)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteId(d.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Despesa" : "Nova Despesa CAC"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Mês Inicial *</Label>
                <Input
                  type="month"
                  value={form.mes_inicial.slice(0, 7)}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, mes_inicial: e.target.value + "-01" }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Mês Final</Label>
                <Input
                  type="month"
                  value={form.mes_final ? form.mes_final.slice(0, 7) : ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      mes_final: e.target.value ? e.target.value + "-01" : "",
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Categoria *</Label>
              <Select
                value={form.categoria}
                onValueChange={(v) => setForm((f) => ({ ...f, categoria: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Descrição *</Label>
              <Input
                value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                placeholder="Ex: Google Ads"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Valor Total (R$) *</Label>
                <NumericInput
                  value={form.valor_total}
                  onChange={(v) => setForm((f) => ({ ...f, valor_total: v ?? 0 }))}
                  placeholder="0,00"
                  prefix="R$ "
                />
              </div>
              {form.categoria === "salarios_parciais" && (
                <div className="space-y-1.5">
                  <Label>% Alocado Vendas</Label>
                  <NumericInput
                    value={form.percentual_alocado_vendas}
                    onChange={(v) =>
                      setForm((f) => ({ ...f, percentual_alocado_vendas: v ?? 0 }))
                    }
                    placeholder="100"
                    suffix="%"
                  />
                </div>
              )}
            </div>

            {form.categoria === "salarios_parciais" && (
              <p className="text-xs text-muted-foreground">
                Valor alocado: {fmtMoney(calcValorAlocado(form))}
              </p>
            )}

            <div className="space-y-1.5">
              <Label>Unidade Base</Label>
              <Select
                value={form.unidade_base_id}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, unidade_base_id: v === "geral" ? "" : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Geral (todas)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="geral">Geral (todas)</SelectItem>
                  {unidades?.map((u) => (
                    <SelectItem key={u.id} value={u.id.toString()}>
                      {u.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={form.ativo}
                onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v }))}
              />
              <Label>Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancelar
            </Button>
            <Button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || !form.mes_inicial || !form.descricao}
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir despesa?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
