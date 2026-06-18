import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Loader2, AlertTriangle, Check, ChevronsUpDown, Trash2, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeleteClienteDialogProps {
  clienteId: string;
  clienteNome: string;
  open: boolean;
  onOpenChange: (b: boolean) => void;
}

interface PreviewData {
  cliente: { id: string; razao_social: string; nome_fantasia: string | null; cancelado: boolean };
  is_matriz: boolean;
  filiais_count: number;
  mrr_ativo: number;
  tem_historico_financeiro: boolean;
  vinculos: Record<string, number>;
  transferencia?: {
    target_id: string | null;
    target_razao_social: string | null;
    aviso: string | null;
    produtos_duplicados: any[];
  };
}

const VINCULO_LABELS: Record<string, string> = {
  contratos: "contrato(s)",
  cliente_produtos: "produto(s) do cliente",
  movimentos_mrr: "movimento(s) de MRR",
  support_tickets: "ticket(s) de suporte",
  support_attendances: "atendimento(s)",
  cs_tickets: "ticket(s) de CS",
  cliente_avaliacoes_atendimento: "avaliação(ões) de atendimento",
  cliente_contatos: "contato(s)",
  clientes_reativacoes_historico: "reativação(ões) no histórico",
  whatsapp_contacts: "contato(s) WhatsApp",
  client_alerts: "alerta(s)",
  certificado_a1_vendas: "venda(s) de Cert. A1",
};

const fmtBRL = (n: number) =>
  (n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function DeleteClienteDialog({
  clienteId,
  clienteNome,
  open,
  onOpenChange,
}: DeleteClienteDialogProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { effectiveTenantId } = useTenantFilter();

  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [targetLabel, setTargetLabel] = useState<string>("");
  const [comboOpen, setComboOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [includeChat, setIncludeChat] = useState(true);
  const [executing, setExecuting] = useState<"transfer" | "purge" | null>(null);

  const loadPreview = async (target?: string | null) => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)("preview_delete_cliente", {
        p_cliente_id: clienteId,
        p_target_id: target ?? null,
      });
      if (error) throw error;
      setPreview(data as PreviewData);
    } catch (e: any) {
      toast({ title: "Erro ao carregar prévia", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setConfirmText("");
      setTargetId(null);
      setTargetLabel("");
      setIncludeChat(true);
      loadPreview(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clienteId]);

  useEffect(() => {
    if (!comboOpen) return;
    const t = setTimeout(async () => {
      try {
        let q: any = (supabase.from("clientes") as any)
          .select("id, razao_social, nome_fantasia")
          .neq("id", clienteId)
          .limit(20);
        if (effectiveTenantId) q = q.eq("tenant_id", effectiveTenantId);
        if (search.trim()) q = q.ilike("razao_social", `%${search.trim()}%`);
        const { data } = await q;
        setSearchResults(data ?? []);
      } catch {
        setSearchResults([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [search, comboOpen, clienteId, effectiveTenantId]);

  const handleSelectTarget = async (c: any) => {
    setTargetId(c.id);
    setTargetLabel(c.razao_social || c.nome_fantasia || c.id);
    setComboOpen(false);
    await loadPreview(c.id);
  };

  const blockedByMatriz = preview?.is_matriz && (preview?.filiais_count ?? 0) > 0;
  const confirmOk =
    confirmText.trim().toLowerCase() === (clienteNome ?? "").trim().toLowerCase() &&
    clienteNome.trim().length > 0;

  const handleTransfer = async () => {
    if (!targetId || !confirmOk || blockedByMatriz) return;
    setExecuting("transfer");
    try {
      const { error } = await (supabase.rpc as any)("admin_delete_cliente", {
        p_cliente_id: clienteId,
        p_mode: "transfer",
        p_target_id: targetId,
        p_confirm: true,
      });
      if (error) throw error;
      toast({ title: "Vínculos transferidos e cliente excluído" });
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      onOpenChange(false);
      navigate("/clientes");
    } catch (e: any) {
      toast({ title: "Erro ao transferir", description: e.message, variant: "destructive" });
    } finally {
      setExecuting(null);
    }
  };

  const handlePurge = async () => {
    if (!confirmOk || blockedByMatriz) return;
    setExecuting("purge");
    try {
      const { error } = await (supabase.rpc as any)("admin_delete_cliente", {
        p_cliente_id: clienteId,
        p_mode: "purge",
        p_confirm: true,
        p_incluir_chat: includeChat,
      });
      if (error) throw error;
      toast({ title: "Cliente excluído" });
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      onOpenChange(false);
      navigate("/clientes");
    } catch (e: any) {
      toast({ title: "Erro ao excluir", description: e.message, variant: "destructive" });
    } finally {
      setExecuting(null);
    }
  };

  const vinculos = preview?.vinculos ?? {};
  const vinculosList = Object.entries(vinculos)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => ({ key: k, count: Number(n), label: VINCULO_LABELS[k] ?? k }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-destructive" />
            Excluir Cliente
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{clienteNome || "(sem nome)"}</span>
          </DialogDescription>
        </DialogHeader>

        {loading && !preview ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : preview ? (
          <div className="space-y-4">
            {/* Vínculos */}
            {vinculosList.length > 0 && (
              <div className="rounded-md border p-3">
                <p className="text-sm font-medium mb-2">Vínculos detectados</p>
                <div className="flex flex-wrap gap-2">
                  {vinculosList.map((v) => (
                    <Badge key={v.key} variant="secondary">
                      {v.count} {v.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Banner financeiro */}
            {preview.tem_historico_financeiro && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  Este cliente tem histórico financeiro (MRR ativo: {fmtBRL(Number(preview.mrr_ativo) || 0)}).
                  Excluir altera relatórios passados.
                </div>
              </div>
            )}

            {/* Banner matriz */}
            {blockedByMatriz && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm flex gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                <div>
                  Cliente é matriz de {preview.filiais_count} filial(is). Resolva as filiais antes de excluir.
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Transferir */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowRightLeft className="h-4 w-4" />
                    Transferir para outro cliente
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Popover open={comboOpen} onOpenChange={setComboOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal"
                        disabled={blockedByMatriz}
                      >
                        <span className="truncate">{targetLabel || "Selecionar cliente destino..."}</span>
                        <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command shouldFilter={false}>
                        <CommandInput
                          placeholder="Buscar por razão social..."
                          value={search}
                          onValueChange={setSearch}
                        />
                        <CommandList>
                          <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
                          <CommandGroup>
                            {searchResults.map((c) => (
                              <CommandItem key={c.id} value={c.id} onSelect={() => handleSelectTarget(c)}>
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    targetId === c.id ? "opacity-100" : "opacity-0"
                                  )}
                                />
                                <span className="truncate">
                                  {c.razao_social || c.nome_fantasia || c.id}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>

                  {preview.transferencia?.produtos_duplicados &&
                    preview.transferencia.produtos_duplicados.length > 0 && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs flex gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          {preview.transferencia.produtos_duplicados.length} produto(s) já existem no destino
                          e ficarão duplicados (MRR pode inflar).
                        </div>
                      </div>
                    )}

                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={
                      !targetId ||
                      !confirmOk ||
                      blockedByMatriz ||
                      executing !== null
                    }
                    onClick={handleTransfer}
                  >
                    {executing === "transfer" && <Loader2 className="h-4 w-4 animate-spin" />}
                    Transferir e excluir
                  </Button>
                </CardContent>
              </Card>

              {/* Purge */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2 text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Excluir tudo (irreversível)
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="incluir-chat" className="text-sm">
                      Incluir conversas/mensagens WhatsApp
                    </Label>
                    <Switch
                      id="incluir-chat"
                      checked={includeChat}
                      onCheckedChange={setIncludeChat}
                      disabled={blockedByMatriz}
                    />
                  </div>
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs flex gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      Esta ação não pode ser desfeita. Todos os vínculos serão removidos permanentemente.
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    className="w-full"
                    disabled={!confirmOk || blockedByMatriz || executing !== null}
                    onClick={handlePurge}
                  >
                    {executing === "purge" && <Loader2 className="h-4 w-4 animate-spin" />}
                    Excluir tudo
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Confirmação */}
            <div className="space-y-1.5 pt-2 border-t">
              <Label htmlFor="confirm-text" className="text-sm">
                Digite a razão social para confirmar:{" "}
                <span className="font-mono font-medium">{clienteNome}</span>
              </Label>
              <Input
                id="confirm-text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Digite a razão social..."
                autoComplete="off"
              />
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground py-4">
            Não foi possível carregar a prévia.
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={executing !== null}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
