import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, User, Building2 } from "lucide-react";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useCreateConversation } from "../hooks/useCreateConversation";
import { useClienteSearch, type ClienteSearchResult } from "../hooks/useClienteSearch";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { maskCNPJ, maskPhoneBR, normalizePhoneBR } from "@/lib/masks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (conversationId: string) => void;
}

export function NewConversationModal({ open, onOpenChange, onCreated }: Props) {
  const { instances } = useWhatsAppInstances();
  const createConversation = useCreateConversation();
  const [instanceId, setInstanceId] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [tab, setTab] = useState("cliente");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCliente, setSelectedCliente] = useState<ClienteSearchResult | null>(null);

  const { results, isLoading: isSearching } = useClienteSearch(searchTerm);

  const handleSelectCliente = (cliente: ClienteSearchResult) => {
    setSelectedCliente(cliente);
    const cleanPhone = (cliente.telefone_whatsapp || "").replace(/\D/g, "");
    setPhone(cleanPhone);
    setName(cliente.nome_fantasia || cliente.razao_social || "");
  };

  const handleCreate = () => {
    if (!instanceId || !phone.trim()) {
      toast.error("Preencha instância e telefone");
      return;
    }

    const cleanPhone = phone.replace(/\D/g, "");
    createConversation.mutate(
      { instanceId, phoneNumber: cleanPhone, contactName: name.trim() || cleanPhone },
      {
        onSuccess: (data) => {
          // If a cliente was selected, save cliente_id in metadata
          if (selectedCliente) {
            import("@/integrations/supabase/client").then(({ supabase }) => {
              supabase
                .from("whatsapp_conversations")
                .update({ metadata: { cliente_id: selectedCliente.id } as any })
                .eq("id", data.conversation.id)
                .then();
            });
          }
          toast.success("Conversa criada com sucesso");
          onOpenChange(false);
          resetForm();
          onCreated?.(data.conversation.id);
        },
        onError: () => toast.error("Erro ao criar conversa"),
      }
    );
  };

  const resetForm = () => {
    setPhone("");
    setName("");
    setSearchTerm("");
    setSelectedCliente(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova Conversa</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Instância</Label>
            <Select value={instanceId} onValueChange={setInstanceId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione a instância" />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.id} value={inst.id}>
                    {inst.display_name || inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={tab} onValueChange={(v) => { setTab(v); setSelectedCliente(null); }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="cliente" className="gap-1 text-xs">
                <Building2 className="h-3.5 w-3.5" /> Buscar Cliente
              </TabsTrigger>
              <TabsTrigger value="avulso" className="gap-1 text-xs">
                <User className="h-3.5 w-3.5" /> Número Avulso
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cliente" className="space-y-3 mt-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, CNPJ, código ou telefone..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              {isSearching && (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {results.length > 0 && !selectedCliente && (
                <ScrollArea className="h-[200px] border rounded-md">
                  <div className="space-y-1 p-1">
                    {results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left p-2 rounded-md hover:bg-muted transition-colors text-sm"
                        onClick={() => handleSelectCliente(c)}
                      >
                        <p className="font-medium text-foreground">
                          #{c.codigo_sequencial} — {c.nome_fantasia || c.razao_social || "Sem nome"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {c.telefone_whatsapp || "Sem WhatsApp"} {c.cnpj ? `· ${c.cnpj}` : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {searchTerm.length >= 2 && !isSearching && results.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-2">Nenhum cliente encontrado</p>
              )}

              {selectedCliente && (
                <div className="bg-muted rounded-md p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      #{selectedCliente.codigo_sequencial} — {selectedCliente.nome_fantasia || selectedCliente.razao_social}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => { setSelectedCliente(null); setPhone(""); setName(""); }}
                    >
                      Trocar
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Tel: {selectedCliente.telefone_whatsapp || phone}</p>
                </div>
              )}

              {selectedCliente && !selectedCliente.telefone_whatsapp && (
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Telefone (cliente sem WhatsApp cadastrado)</Label>
                  <Input
                    placeholder="5511999999999"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="avulso" className="space-y-3 mt-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Telefone</Label>
                <Input
                  placeholder="5511999999999"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Nome (opcional)</Label>
                <Input
                  placeholder="Nome do contato"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </TabsContent>
          </Tabs>

          <Button onClick={handleCreate} disabled={createConversation.isPending} className="w-full">
            {createConversation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Iniciar Conversa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
