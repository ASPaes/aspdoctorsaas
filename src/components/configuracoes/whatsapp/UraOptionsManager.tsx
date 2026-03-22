import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Save, Loader2, ListOrdered, Eye } from "lucide-react";

interface DeptUraRow {
  id: string;
  name: string;
  is_active: boolean;
  ura_option_number: number | null;
  ura_label: string | null;
  show_in_ura: boolean;
}

export default function UraOptionsManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: departments = [], isLoading } = useQuery<DeptUraRow[]>({
    queryKey: ["support_departments_ura", tid],
    queryFn: async () => {
      let q = supabase
        .from("support_departments")
        .select("id, name, is_active, ura_option_number, ura_label, show_in_ura")
        .eq("is_active", true)
        .order("ura_option_number", { nullsFirst: false });
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as DeptUraRow[];
    },
    enabled: !!tid,
  });

  // Local editable state
  const [edits, setEdits] = useState<Record<string, { number: string; label: string; show: boolean }>>({});

  // Initialize edits from fetched data
  const rows = useMemo(() => {
    return departments.map((d) => {
      const edit = edits[d.id];
      return {
        id: d.id,
        name: d.name,
        number: edit?.number ?? (d.ura_option_number?.toString() ?? ""),
        label: edit?.label ?? (d.ura_label ?? ""),
        show: edit?.show ?? d.show_in_ura,
      };
    });
  }, [departments, edits]);

  const updateField = (id: string, field: "number" | "label" | "show", value: string | boolean) => {
    const dept = departments.find((d) => d.id === id);
    if (!dept) return;
    const current = edits[id] ?? {
      number: dept.ura_option_number?.toString() ?? "",
      label: dept.ura_label ?? "",
      show: dept.show_in_ura,
    };
    setEdits((prev) => ({ ...prev, [id]: { ...current, [field]: value } }));
  };

  // Validation: check for duplicate numbers
  const duplicateNumbers = useMemo(() => {
    const nums = rows
      .filter((r) => r.show && r.number.trim() !== "")
      .map((r) => parseInt(r.number, 10))
      .filter((n) => !isNaN(n));
    const seen = new Set<number>();
    const dupes = new Set<number>();
    for (const n of nums) {
      if (seen.has(n)) dupes.add(n);
      seen.add(n);
    }
    return dupes;
  }, [rows]);

  const hasErrors = duplicateNumbers.size > 0;

  // Auto-number: fill missing numbers sequentially for show_in_ura=true rows
  const autoNumber = () => {
    const usedNumbers = new Set<number>();
    rows.forEach((r) => {
      if (r.show && r.number.trim() !== "") {
        const n = parseInt(r.number, 10);
        if (!isNaN(n)) usedNumbers.add(n);
      }
    });

    let nextNum = 1;
    const newEdits = { ...edits };
    for (const dept of departments) {
      const row = rows.find((r) => r.id === dept.id);
      if (!row || !row.show || row.number.trim() !== "") continue;

      while (usedNumbers.has(nextNum)) nextNum++;
      const current = newEdits[dept.id] ?? {
        number: "",
        label: dept.ura_label ?? "",
        show: dept.show_in_ura,
      };
      newEdits[dept.id] = { ...current, number: nextNum.toString() };
      usedNumbers.add(nextNum);
      nextNum++;
    }
    setEdits(newEdits);
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = rows.map((r) => ({
        id: r.id,
        ura_option_number: r.show && r.number.trim() !== "" ? parseInt(r.number, 10) : null,
        ura_label: r.label.trim() || null,
        show_in_ura: r.show,
      }));

      for (const u of updates) {
        const { error } = await supabase
          .from("support_departments")
          .update({
            ura_option_number: u.ura_option_number,
            ura_label: u.ura_label,
            show_in_ura: u.show_in_ura,
          })
          .eq("id", u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      setEdits({});
      queryClient.invalidateQueries({ queryKey: ["support_departments_ura"] });
      queryClient.invalidateQueries({ queryKey: ["support_departments"] });
      toast({ title: "Salvo!", description: "Opções da URA atualizadas." });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    },
  });

  // Preview: what client will see
  const preview = useMemo(() => {
    return rows
      .filter((r) => r.show && r.number.trim() !== "" && !isNaN(parseInt(r.number, 10)))
      .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10))
      .map((r) => `${r.number}. ${r.label || r.name}`)
      .concat(["0. Encerrar atendimento"])
      .join("\n");
  }, [rows]);

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListOrdered className="h-5 w-5" />
          Opções da URA
        </CardTitle>
        <CardDescription>
          Configure o número, label e visibilidade de cada setor no menu da URA.
          O número digitado pelo cliente sempre mapeia para o mesmo setor.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Header */}
        <div className="grid grid-cols-[1fr_80px_1fr_80px] gap-2 items-center text-sm font-medium text-muted-foreground px-1">
          <span>Setor</span>
          <span className="text-center">Nº URA</span>
          <span>Label (opcional)</span>
          <span className="text-center">Visível</span>
        </div>

        <Separator />

        {rows.map((row) => {
          const numVal = parseInt(row.number, 10);
          const isDupe = !isNaN(numVal) && duplicateNumbers.has(numVal) && row.show;

          return (
            <div key={row.id} className="grid grid-cols-[1fr_80px_1fr_80px] gap-2 items-center">
              <span className="text-sm font-medium truncate">{row.name}</span>
              <Input
                type="number"
                min={1}
                className={`text-center h-9 ${isDupe ? "border-destructive ring-1 ring-destructive" : ""}`}
                value={row.number}
                onChange={(e) => updateField(row.id, "number", e.target.value)}
                placeholder="—"
              />
              <Input
                className="h-9"
                value={row.label}
                onChange={(e) => updateField(row.id, "label", e.target.value)}
                placeholder={row.name}
              />
              <div className="flex justify-center">
                <Switch
                  checked={row.show}
                  onCheckedChange={(v) => updateField(row.id, "show", v)}
                />
              </div>
            </div>
          );
        })}

        {duplicateNumbers.size > 0 && (
          <p className="text-sm text-destructive">
            ⚠️ Números duplicados: {Array.from(duplicateNumbers).join(", ")}. Corrija antes de salvar.
          </p>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={autoNumber}>
            <ListOrdered className="mr-1 h-4 w-4" />
            Auto numerar
          </Button>
        </div>

        {/* Preview */}
        <Separator />
        <div>
          <Label className="flex items-center gap-1 mb-2">
            <Eye className="h-4 w-4" />
            Preview do menu
          </Label>
          <pre className="bg-muted rounded-md p-3 text-sm whitespace-pre-wrap font-mono">
            {preview || "(Nenhuma opção configurada)"}
          </pre>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={hasErrors || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Salvar Opções
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
