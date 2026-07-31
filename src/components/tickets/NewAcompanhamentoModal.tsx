import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, ChevronsUpDown, Check } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string | null;
  onCreated?: (ticketId: string) => void;
}

/**
 * Abre um ticket livre de acompanhamento de uso.
 *
 * Modal próprio, e não o CreateSupportTicketModal, porque aquele exige produto, categoria,
 * subcategoria, tipo de serviço e setor — é o fluxo de classificação de suporte. Acompanhamento
 * não tem nada disso: é cliente + motivo.
 */
export function NewAcompanhamentoModal({ open, onOpenChange, tenantId, onCreated }: Props) {
  const [clienteId, setClienteId] = useState("");
  const [clienteLabel, setClienteLabel] = useState("");
  const [clienteBusca, setClienteBusca] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);

  const buscaDebounced = useDebouncedValue(clienteBusca, 300);

  useEffect(() => {
    if (!open) {
      setClienteId("");
      setClienteLabel("");
      setClienteBusca("");
      setMotivo("");
    }
  }, [open]);

  const clientesQuery = useQuery({
    queryKey: ["acomp-clientes-search", tenantId, buscaDebounced],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("search_clientes", {
        p_tenant_id: tenantId,
        p_termo: buscaDebounced,
        p_limit: 30,
      });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; nome_fantasia: string | null; razao_social: string | null; cnpj: string | null;
      }>;
    },
  });

  async function handleSave() {
    if (!tenantId || !clienteId) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase.rpc as any)("create_acompanhamento_ticket", {
        p_tenant_id: tenantId,
        p_cliente_id: clienteId,
        p_motivo: motivo.trim() || null,
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(
          data?.reason === "ja_existe"
            ? "Este cliente já tem um acompanhamento aberto."
            : "Não foi possível abrir o acompanhamento",
        );
        return;
      }
      toast.success("Acompanhamento aberto");
      onCreated?.(data.ticket_id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Erro ao abrir acompanhamento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo acompanhamento</DialogTitle>
          <DialogDescription>
            Abre um ticket de acompanhamento de uso para qualquer cliente, sem vínculo com implantação.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={popoverOpen}
                  className="w-full justify-between font-normal"
                >
                  <span className={cn("truncate", !clienteLabel && "text-muted-foreground")}>
                    {clienteLabel || "Buscar cliente por nome ou CNPJ..."}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Digite nome ou CNPJ..."
                    value={clienteBusca}
                    onValueChange={setClienteBusca}
                  />
                  <CommandList>
                    {clientesQuery.isFetching && (
                      <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Buscando...
                      </div>
                    )}
                    {!clientesQuery.isFetching && (clientesQuery.data ?? []).length === 0 && (
                      <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                    )}
                    <CommandGroup>
                      {(clientesQuery.data ?? []).map((c) => {
                        const label = c.nome_fantasia || c.razao_social || "—";
                        return (
                          <CommandItem
                            key={c.id}
                            value={c.id}
                            onSelect={() => {
                              setClienteId(c.id);
                              setClienteLabel(label);
                              setPopoverOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", clienteId === c.id ? "opacity-100" : "opacity-0")} />
                            <div className="flex flex-col min-w-0">
                              <span className="truncate">{label}</span>
                              {c.cnpj && <span className="text-xs text-muted-foreground">{c.cnpj}</span>}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label>Por que vai acompanhar? (opcional)</Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              placeholder="Ex: cliente antigo, quero observar o uso por algumas semanas"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !clienteId}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Abrir acompanhamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
