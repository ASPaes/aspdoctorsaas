import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onLinked: () => void;
}

interface ClienteRow {
  id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
}

export function GroupLinkClienteModal({ open, onOpenChange, conversationId, onLinked }: Props) {
  const { effectiveTenantId } = useTenantFilter();
  const [term, setTerm] = useState("");
  const debounced = useDebouncedValue(term, 300);
  const [selected, setSelected] = useState<ClienteRow | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["group-link-cliente-search", effectiveTenantId, debounced],
    enabled: open && !!effectiveTenantId && debounced.trim().length >= 2,
    queryFn: async () => {
      const t = debounced.trim();
      const { data, error } = await (supabase.from("clientes" as any) as any)
        .select("id, nome_fantasia, razao_social")
        .eq("tenant_id", effectiveTenantId)
        .or(`nome_fantasia.ilike.%${t}%,razao_social.ilike.%${t}%`)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as ClienteRow[];
    },
  });

  const handleLink = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("set_group_cliente", {
        p_conversation_id: conversationId,
        p_cliente_id: selected.id,
      });
      if (error) throw error;
      onLinked();
      onOpenChange(false);
      setTerm("");
      setSelected(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao vincular cliente");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Vincular grupo a um cliente</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            autoFocus
            placeholder="Buscar por nome fantasia ou razão social..."
            value={term}
            onChange={(e) => { setTerm(e.target.value); setSelected(null); }}
            className="px-3"
          />
          <ScrollArea className="h-64 border rounded-md">
            <div className="p-1">
              {debounced.trim().length < 2 && (
                <div className="text-sm text-muted-foreground p-3">Digite ao menos 2 caracteres.</div>
              )}
              {debounced.trim().length >= 2 && isLoading && (
                <div className="text-sm text-muted-foreground p-3">Buscando...</div>
              )}
              {debounced.trim().length >= 2 && !isLoading && results.length === 0 && (
                <div className="text-sm text-muted-foreground p-3">Nenhum cliente encontrado.</div>
              )}
              {results.map((c) => {
                const isSel = selected?.id === c.id;
                const label = c.nome_fantasia || c.razao_social || "(sem nome)";
                const sub = c.nome_fantasia && c.razao_social ? c.razao_social : null;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelected(c)}
                    className={`w-full text-left px-3 py-2 rounded-sm hover:bg-accent ${isSel ? "bg-accent" : ""}`}
                  >
                    <div className="text-sm font-medium">{label}</div>
                    {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleLink} disabled={!selected || saving}>
            Vincular e iniciar atendimento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GroupLinkClienteModal;
