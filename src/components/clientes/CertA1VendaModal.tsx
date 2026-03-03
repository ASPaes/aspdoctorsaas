import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format, addMonths, parseISO } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface FormData {
  perdidoTerceiro: boolean;
  dataVenda: string;
  valorVenda: string;
  vendedorId: string;
  observacao: string;
  dataBaseRenovacao: string;
  motivoPerda: string;
}

const INITIAL_FORM: FormData = {
  perdidoTerceiro: false,
  dataVenda: new Date().toISOString().split("T")[0],
  valorVenda: "",
  vendedorId: "",
  observacao: "",
  dataBaseRenovacao: "",
  motivoPerda: "",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  funcionarios: { id: number; nome: string }[];
  onVendaRegistrada: () => void;
}

function buildDraftKey(tenantId: string | null, userId: string | null, clienteId: string) {
  return `draft:cert_a1:${tenantId ?? "t"}:${userId ?? "u"}:new:${clienteId}`;
}

export default function CertA1VendaModal({ open, onOpenChange, clienteId, funcionarios, onVendaRegistrada }: Props) {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const draftKey = buildDraftKey(profile?.tenant_id ?? null, user?.id ?? null, clienteId);

  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [showDraftPrompt, setShowDraftPrompt] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirty = useRef(false);

  // Track if form has been touched
  const updateField = useCallback(<K extends keyof FormData>(key: K, value: FormData[K]) => {
    setForm(prev => ({ ...prev, [key]: value }));
    isDirty.current = true;
  }, []);

  // Check for existing draft when modal opens
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        setShowDraftPrompt(true);
      } else {
        setForm({ ...INITIAL_FORM, dataVenda: new Date().toISOString().split("T")[0] });
        isDirty.current = false;
      }
    } catch {
      // ignore
    }
  }, [open, draftKey]);

  // Debounce-save draft
  useEffect(() => {
    if (!open || !isDirty.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setDraftStatus("saving");
    timerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(form));
        setDraftStatus("saved");
      } catch {
        setDraftStatus("idle");
      }
    }, 600);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [form, open, draftKey]);

  // beforeunload guard while modal is open and dirty
  useEffect(() => {
    if (!open || !isDirty.current) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [open, form]); // form in deps to re-evaluate isDirty

  const restoreDraft = useCallback(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw) as FormData;
        setForm(parsed);
        isDirty.current = true;
      }
    } catch { /* ignore */ }
    setShowDraftPrompt(false);
  }, [draftKey]);

  const dismissDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setForm({ ...INITIAL_FORM, dataVenda: new Date().toISOString().split("T")[0] });
    isDirty.current = false;
    setShowDraftPrompt(false);
  }, [draftKey]);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setDraftStatus("idle");
    isDirty.current = false;
  }, [draftKey]);

  const handleClose = useCallback(() => {
    if (isDirty.current) {
      // Draft is already saved via debounce, just close
      // The draft prompt will appear next time they open
    }
    setForm({ ...INITIAL_FORM, dataVenda: new Date().toISOString().split("T")[0] });
    isDirty.current = false;
    setDraftStatus("idle");
    setShowDraftPrompt(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const previewVencimento = useMemo(() => {
    const baseDate = form.perdidoTerceiro ? form.dataBaseRenovacao : form.dataVenda;
    if (!baseDate) return null;
    return format(addMonths(parseISO(baseDate), 12), "dd/MM/yyyy");
  }, [form.perdidoTerceiro, form.dataVenda, form.dataBaseRenovacao]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        cliente_id: clienteId,
        data_venda: form.dataVenda,
        status: form.perdidoTerceiro ? "perdido_terceiro" : "ganho",
      };
      if (form.perdidoTerceiro) {
        payload.data_base_renovacao = form.dataBaseRenovacao || null;
        payload.motivo_perda = form.motivoPerda || null;
        payload.vendedor_id = form.vendedorId ? Number(form.vendedorId) : null;
      } else {
        payload.valor_venda = form.valorVenda ? Number(form.valorVenda) : null;
        payload.vendedor_id = form.vendedorId ? Number(form.vendedorId) : null;
        payload.observacao = form.observacao || null;
      }
      const { error } = await supabase.from("certificado_a1_vendas" as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Venda de certificado registrada!");
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["cert_a1_vendas", clienteId] });
      setForm({ ...INITIAL_FORM, dataVenda: new Date().toISOString().split("T")[0] });
      isDirty.current = false;
      setDraftStatus("idle");
      onOpenChange(false);
      onVendaRegistrada();
    },
    onError: (e: any) => toast.error("Erro ao registrar venda: " + e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else onOpenChange(o); }}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Registrar Venda de Certificado A1</DialogTitle>
            {draftStatus === "saved" && isDirty.current && (
              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30 ml-2">
                Rascunho salvo
              </Badge>
            )}
            {draftStatus === "saving" && (
              <Badge variant="outline" className="text-xs bg-muted text-muted-foreground ml-2">
                Salvando…
              </Badge>
            )}
          </div>
        </DialogHeader>

        {showDraftPrompt ? (
          <div className="space-y-4">
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
              <p className="font-medium text-amber-700">Rascunho não salvo encontrado.</p>
              <p className="text-muted-foreground mt-1">Deseja restaurar os dados preenchidos anteriormente?</p>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={dismissDraft}>Descartar</Button>
              <Button size="sm" onClick={restoreDraft}>Restaurar</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Checkbox id="perdido" checked={form.perdidoTerceiro} onCheckedChange={(v) => updateField("perdidoTerceiro", v === true)} />
                <label htmlFor="perdido" className="text-sm">Já renovado com terceiro</label>
              </div>

              {form.perdidoTerceiro ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Data base da renovação</label>
                    <Input type="date" value={form.dataBaseRenovacao} onChange={(e) => updateField("dataBaseRenovacao", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Registrado por</label>
                    <Select value={form.vendedorId} onValueChange={(v) => updateField("vendedorId", v)}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {funcionarios.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Motivo / Observação</label>
                    <Textarea value={form.motivoPerda} onChange={(e) => updateField("motivoPerda", e.target.value)} rows={2} />
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Data da Venda</label>
                    <Input type="date" value={form.dataVenda} onChange={(e) => updateField("dataVenda", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Valor R$</label>
                    <Input type="number" step="0.01" value={form.valorVenda} onChange={(e) => updateField("valorVenda", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Vendedor</label>
                    <Select value={form.vendedorId} onValueChange={(v) => updateField("vendedorId", v)}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {funcionarios.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Observação</label>
                    <Textarea value={form.observacao} onChange={(e) => updateField("observacao", e.target.value)} rows={2} />
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
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? "Salvando..." : "Registrar"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
