import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { maskCPF } from "@/lib/masks";
import { normalizeBRPhone, formatBRPhone } from "@/lib/phoneBR";
import { PhoneInputBR } from "@/components/ui/PhoneInputBR";

interface Props {
  clienteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ContatoForm {
  nome: string;
  cpf: string;
  fone: string;
  email: string;
  cargo: string;
  aniversario: string;
  observacao: string;
}

const emptyForm: ContatoForm = { nome: "", cpf: "", fone: "", email: "", cargo: "", aniversario: "", observacao: "" };

export default function ContatosAdicionaisModal({ clienteId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ContatoForm>(emptyForm);

  const { data: contatos, isLoading } = useQuery({
    queryKey: ["cliente_contatos", clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cliente_contatos" as any)
        .select("*")
        .eq("cliente_id", clienteId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: open,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const normalizedFone = form.fone ? normalizeBRPhone(form.fone) : null;
      const { error } = await supabase.from("cliente_contatos" as any).insert({
        cliente_id: clienteId,
        nome: form.nome,
        cpf: form.cpf || null,
        fone: normalizedFone || null,
        email: form.email || null,
        cargo: form.cargo || null,
        aniversario: form.aniversario || null,
        observacao: form.observacao || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contato adicionado!");
      queryClient.invalidateQueries({ queryKey: ["cliente_contatos", clienteId] });
      setForm(emptyForm);
      setShowForm(false);
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cliente_contatos" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Contato removido.");
      queryClient.invalidateQueries({ queryKey: ["cliente_contatos", clienteId] });
    },
    onError: (e: any) => toast.error("Erro: " + e.message),
  });

  const updateField = (key: keyof ContatoForm, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contatos Adicionais</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !contatos || contatos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum contato adicional cadastrado.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Nome</TableHead>
                <TableHead className="text-xs">Fone</TableHead>
                <TableHead className="text-xs">Email</TableHead>
                <TableHead className="text-xs">Cargo</TableHead>
                <TableHead className="text-xs w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contatos.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs">{c.nome}</TableCell>
                  <TableCell className="text-xs">{c.fone ? formatBRPhone(normalizeBRPhone(c.fone)) : "—"}</TableCell>
                  <TableCell className="text-xs">{c.email ?? "—"}</TableCell>
                  <TableCell className="text-xs">{c.cargo ?? "—"}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => deleteMutation.mutate(c.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {showForm ? (
          <div className="space-y-3 border rounded-lg p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Nome *</label>
                <Input value={form.nome} onChange={(e) => updateField("nome", e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">CPF</label>
                <Input placeholder="000.000.000-00" value={form.cpf} onChange={(e) => updateField("cpf", maskCPF(e.target.value))} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Fone</label>
                <PhoneInputBR
                  value={form.fone}
                  onChange={(v) => updateField("fone", v)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Email</label>
                <Input type="email" value={form.email} onChange={(e) => updateField("email", e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Cargo</label>
                <Input value={form.cargo} onChange={(e) => updateField("cargo", e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Aniversário</label>
                <Input type="date" value={form.aniversario} onChange={(e) => updateField("aniversario", e.target.value)} />
              </div>
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-medium">Observação</label>
                <Textarea rows={2} value={form.observacao} onChange={(e) => updateField("observacao", e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => { setShowForm(false); setForm(emptyForm); }}>
                Cancelar
              </Button>
              <Button type="button" size="sm" disabled={!form.nome.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>
                Salvar Contato
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Adicionar Contato
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
