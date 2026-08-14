import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, ListOrdered, Eye, MessageSquareReply } from "lucide-react";

type UraAction = "route" | "auto_reply";

interface DeptUraRow {
  id: string;
  name: string;
  is_active: boolean;
  ura_option_number: number | null;
  ura_label: string | null;
  show_in_ura: boolean;
  ura_action: UraAction | null;
  ura_auto_reply_message: string | null;
  ura_auto_close_minutes: number | null;
  ura_auto_close_message: string | null;
}

interface RowEdit {
  number: string;
  label: string;
  show: boolean;
  action: UraAction;
  replyMessage: string;
  closeMinutes: string;
  closeMessage: string;
}

const MINUTOS_PADRAO = 3;

export default function UraOptionsManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: departments = [], isLoading } = useQuery<DeptUraRow[]>({
    queryKey: ["support_departments_ura", tid],
    queryFn: async () => {
      let q = supabase
        .from("support_departments")
        .select("id, name, is_active, ura_option_number, ura_label, show_in_ura, ura_action, ura_auto_reply_message, ura_auto_close_minutes, ura_auto_close_message")
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
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});

  const baseEdit = (d: DeptUraRow): RowEdit => ({
    number: d.ura_option_number?.toString() ?? "",
    label: d.ura_label ?? "",
    show: d.show_in_ura,
    action: d.ura_action === "auto_reply" ? "auto_reply" : "route",
    replyMessage: d.ura_auto_reply_message ?? "",
    closeMinutes: d.ura_auto_close_minutes?.toString() ?? "",
    closeMessage: d.ura_auto_close_message ?? "",
  });

  // Initialize edits from fetched data
  const rows = useMemo(() => {
    return departments.map((d) => ({ id: d.id, name: d.name, ...(edits[d.id] ?? baseEdit(d)) }));
  }, [departments, edits]);

  const updateField = <K extends keyof RowEdit>(id: string, field: K, value: RowEdit[K]) => {
    const dept = departments.find((d) => d.id === id);
    if (!dept) return;
    const current = edits[id] ?? baseEdit(dept);
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

  // Opção que responde sem mensagem cairia no roteamento normal: o cliente
  // escolheria "Indique e ganhe" e ia parar na fila de um atendente.
  const semMensagem = useMemo(
    () => rows.filter((r) => r.show && r.action === "auto_reply" && !r.replyMessage.trim()),
    [rows],
  );

  const hasErrors = duplicateNumbers.size > 0 || semMensagem.length > 0;

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
      const current = newEdits[dept.id] ?? baseEdit(dept);
      newEdits[dept.id] = { ...current, number: nextNum.toString() };
      usedNumbers.add(nextNum);
      nextNum++;
    }
    setEdits(newEdits);
  };

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = rows.map((r) => {
        const isAuto = r.action === "auto_reply";
        const minutos = parseInt(r.closeMinutes, 10);
        return {
          id: r.id,
          ura_option_number: r.show && r.number.trim() !== "" ? parseInt(r.number, 10) : null,
          ura_label: r.label.trim() || null,
          show_in_ura: r.show,
          ura_action: r.action,
          // Campos de autoatendimento só existem para esse tipo: trocar o tipo de
          // volta para "rotear" limpa o que ficou, senão a configuração antiga
          // voltaria a valer sozinha se alguém reativasse a opção.
          ura_auto_reply_message: isAuto ? r.replyMessage.trim() || null : null,
          ura_auto_close_minutes: isAuto && !isNaN(minutos) && minutos > 0 ? minutos : null,
          ura_auto_close_message: isAuto ? r.closeMessage.trim() || null : null,
        };
      });

      for (const u of updates) {
        const { id, ...campos } = u;
        const { error } = await supabase
          .from("support_departments")
          .update(campos)
          .eq("id", id);
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
        <div className="grid grid-cols-[1fr_80px_1fr_150px_80px] gap-2 items-center text-sm font-medium text-muted-foreground px-1">
          <span>Setor</span>
          <span className="text-center">Nº URA</span>
          <span>Label (opcional)</span>
          <span>Ao escolher</span>
          <span className="text-center">Visível</span>
        </div>

        <Separator />

        {rows.map((row) => {
          const numVal = parseInt(row.number, 10);
          const isDupe = !isNaN(numVal) && duplicateNumbers.has(numVal) && row.show;
          const isAuto = row.action === "auto_reply";
          const faltaMensagem = isAuto && row.show && !row.replyMessage.trim();

          return (
            <div key={row.id} className="space-y-2">
              <div className="grid grid-cols-[1fr_80px_1fr_150px_80px] gap-2 items-center">
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
                <Select
                  value={row.action}
                  onValueChange={(v) => updateField(row.id, "action", v as UraAction)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="route">Chamar o setor</SelectItem>
                    <SelectItem value="auto_reply">Responder e voltar</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex justify-center">
                  <Switch
                    checked={row.show}
                    onCheckedChange={(v) => updateField(row.id, "show", v)}
                  />
                </div>
              </div>

              {isAuto && (
                <div className="ml-1 rounded-lg border border-primary/25 bg-primary/[0.04] p-3 space-y-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MessageSquareReply className="h-3.5 w-3.5 text-primary" />
                    Manda a mensagem abaixo e devolve o cliente pro menu. Ninguém é
                    acionado e o atendimento não entra na fila.
                  </p>

                  <div className="space-y-1.5">
                    <Label className="text-xs">Mensagem de resposta</Label>
                    <Textarea
                      rows={3}
                      value={row.replyMessage}
                      onChange={(e) => updateField(row.id, "replyMessage", e.target.value)}
                      placeholder="Ex.: Indique e ganhe R$ 150,00 no PIX! Cadastre sua indicação aqui: https://..."
                      className={faltaMensagem ? "border-destructive ring-1 ring-destructive" : ""}
                    />
                    {faltaMensagem && (
                      <p className="text-xs text-destructive">
                        Sem mensagem, quem escolher esta opção cai na fila de um atendente.
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Encerrar após</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          className="h-9 text-center"
                          value={row.closeMinutes}
                          onChange={(e) => updateField(row.id, "closeMinutes", e.target.value)}
                          placeholder={String(MINUTOS_PADRAO)}
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">min sem falar</span>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mensagem de encerramento</Label>
                      <Input
                        className="h-9"
                        value={row.closeMessage}
                        onChange={(e) => updateField(row.id, "closeMessage", e.target.value)}
                        placeholder="Ex.: Obrigado pela indicação! 💚"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {duplicateNumbers.size > 0 && (
          <p className="text-sm text-destructive">
            ⚠️ Números duplicados: {Array.from(duplicateNumbers).join(", ")}. Corrija antes de salvar.
          </p>
        )}

        {semMensagem.length > 0 && (
          <p className="text-sm text-destructive">
            ⚠️ Sem mensagem de resposta: {semMensagem.map((r) => r.label || r.name).join(", ")}.
            Preencha antes de salvar.
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
