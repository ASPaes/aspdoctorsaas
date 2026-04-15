import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Search, User, Building2, Phone, CheckCircle2 } from "lucide-react";
import { useWhatsAppInstances } from "../hooks/useWhatsAppInstances";
import { useCreateConversation } from "../hooks/useCreateConversation";
import { useClienteSearch, type ClienteSearchResult } from "../hooks/useClienteSearch";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { maskCNPJ, maskPhoneBR, normalizePhoneBR } from "@/lib/masks";
import { normalizeBRPhone, formatBRPhone, coreDigits } from "@/lib/phoneBR";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, Info } from "lucide-react";

interface ContactOption {
  label: string;
  name: string;
  phone: string; // normalized digits
  displayPhone: string; // masked
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (conversationId: string) => void;
  initialPhone?: string;
  initialName?: string;
  initialInstanceId?: string;
}

function useCheckOpenConversation(phone: string, instanceId: string) {
  const { user } = useAuth();
  const cleanPhone = phone.replace(/\D/g, '');

  return useQuery({
    queryKey: ['check-open-conversation', cleanPhone, instanceId],
    queryFn: async () => {
      if (!cleanPhone || cleanPhone.length < 10 || !instanceId) return null;

      // Buscar contato pelo número
      const { data: contact } = await supabase
        .from('whatsapp_contacts')
        .select('id')
        .ilike('phone_number', `%${cleanPhone.slice(-10)}%`)
        .limit(1)
        .maybeSingle();

      if (!contact) return null;

      // Buscar conversa ativa com attendance aberto
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select('id, assigned_to')
        .eq('contact_id', contact.id)
        .eq('instance_id', instanceId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

      if (!conv) return null;

      const { data: att } = await supabase
        .from('support_attendances')
        .select('id, assigned_to')
        .eq('conversation_id', conv.id)
        .in('status', ['waiting', 'in_progress'])
        .limit(1)
        .maybeSingle();

      if (!att) return null;

      const assignedTo = att.assigned_to || conv.assigned_to;
      const isOwnUser = assignedTo === user?.id;

      // Buscar nome do técnico
      let techName = 'outro técnico';
      if (assignedTo) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('funcionario_id')
          .eq('user_id', assignedTo)
          .maybeSingle();

        if (profile?.funcionario_id) {
          const { data: func } = await supabase
            .from('funcionarios')
            .select('nome')
            .eq('id', profile.funcionario_id)
            .maybeSingle();
          if (func?.nome) techName = func.nome;
        }
      }

      return {
        exists: true,
        conversationId: conv.id,
        assignedTo,
        isOwnUser,
        techName,
      };
    },
    enabled: cleanPhone.length >= 10 && !!instanceId,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchInterval: 5_000,
  });
}

export function NewConversationModal({ open, onOpenChange, onCreated, initialPhone, initialName, initialInstanceId }: Props) {
  const { instances } = useWhatsAppInstances();
  const createConversation = useCreateConversation();
  const { selectedDepartmentId } = useDepartmentFilter();
  const { user } = useAuth();
  const [instanceId, setInstanceId] = useState("");
  const [phone, setPhone] = useState(initialPhone || "");
  const [name, setName] = useState(initialName || "");
  const [tab, setTab] = useState(initialPhone ? "avulso" : "cliente");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCliente, setSelectedCliente] = useState<ClienteSearchResult | null>(null);
  const [selectedContactPhone, setSelectedContactPhone] = useState<string | null>(null);

  const { data: openConv, isLoading: isCheckingOpen } = useCheckOpenConversation(phone, instanceId);
  const queryClient = useQueryClient();

  // Invalidar cache quando phone ou instanceId mudar
  useEffect(() => {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length >= 10 && instanceId) {
      queryClient.invalidateQueries({ 
        queryKey: ['check-open-conversation', cleanPhone, instanceId] 
      });
    }
  }, [phone, instanceId, queryClient]);

  useEffect(() => {
    if (open && initialPhone) {
      setPhone(initialPhone);
      setName(initialName || '');
      setTab('avulso');
    }
  }, [open, initialPhone, initialName]);

  useEffect(() => {
    if (open && !instanceId) {
      if (initialInstanceId) {
        setInstanceId(initialInstanceId);
      } else if (instances.length === 1) {
        setInstanceId(instances[0].id);
      }
    }
  }, [open, initialInstanceId, instances, instanceId]);

  const { results, isLoading: isSearching } = useClienteSearch(searchTerm);

  // Fetch additional contacts for selected cliente
  const { data: clienteContatos } = useQuery({
    queryKey: ['cliente-contatos-for-chat', selectedCliente?.id],
    queryFn: async () => {
      if (!selectedCliente?.id) return [];
      const { data } = await supabase
        .from('cliente_contatos')
        .select('id, nome, fone')
        .eq('cliente_id', selectedCliente.id)
        .not('fone', 'is', null);
      return data || [];
    },
    enabled: !!selectedCliente?.id,
  });

  // Build deduplicated contact options
  const contactOptions = useMemo((): ContactOption[] => {
    if (!selectedCliente) return [];
    const seen = new Set<string>();
    const opts: ContactOption[] = [];

    const addOption = (label: string, contactName: string, rawPhone: string | null) => {
      if (!rawPhone) return;
      const normalized = normalizeBRPhone(rawPhone);
      const core = coreDigits(rawPhone);
      if (core.length < 10 || seen.has(core)) return;
      seen.add(core);
      opts.push({
        label,
        name: contactName,
        phone: normalized,
        displayPhone: formatBRPhone(normalized),
      });
    };

    // Principal
    addOption(
      "WhatsApp Principal",
      selectedCliente.nome_fantasia || selectedCliente.razao_social || "",
      selectedCliente.telefone_whatsapp
    );

    // Additional contacts
    if (clienteContatos) {
      for (const c of clienteContatos) {
        addOption(c.nome || "Contato", c.nome || "", c.fone);
      }
    }

    return opts;
  }, [selectedCliente, clienteContatos]);

  // Auto-select when only one valid option
  useEffect(() => {
    if (selectedCliente && contactOptions.length === 1 && !selectedContactPhone) {
      const opt = contactOptions[0];
      setSelectedContactPhone(opt.phone);
      setPhone(opt.phone);
      setName(opt.name || selectedCliente.nome_fantasia || selectedCliente.razao_social || "");
    }
  }, [contactOptions, selectedCliente, selectedContactPhone]);

  const handleSelectCliente = (cliente: ClienteSearchResult) => {
    setSelectedCliente(cliente);
    setSelectedContactPhone(null);
    setPhone("");
    setName("");
  };

  const handleSelectContact = (opt: ContactOption) => {
    setSelectedContactPhone(opt.phone);
    setPhone(opt.phone);
    setName(opt.name || selectedCliente?.nome_fantasia || selectedCliente?.razao_social || "");
  };

  const handleCreate = () => {
    if (!instanceId || !phone.trim()) {
      toast.error("Preencha instância e telefone");
      return;
    }

    // Bloquear se há atendimento aberto com outro técnico
    if (openConv?.exists && !openConv?.isOwnUser) {
      toast.error(`Este contato já está em atendimento com ${openConv.techName}`);
      return;
    }

    // Redirecionar se é o próprio usuário
    if (openConv?.exists && openConv?.isOwnUser) {
      onOpenChange(false);
      resetForm();
      onCreated?.(openConv.conversationId);
      return;
    }

    const cleanPhone = normalizePhoneBR(phone);
    createConversation.mutate(
      { instanceId, phoneNumber: cleanPhone, contactName: name.trim() || cleanPhone, departmentId: selectedDepartmentId || undefined },
      {
        onSuccess: (data) => {
          if (selectedCliente) {
            supabase
              .from("whatsapp_conversations")
              .update({ metadata: { cliente_id: selectedCliente.id } as any })
              .eq("id", data.conversation.id)
              .then();
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
    setSelectedContactPhone(null);
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

          <Tabs value={tab} onValueChange={(v) => { setTab(v); setSelectedCliente(null); setSelectedContactPhone(null); }}>
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
                          {c.telefone_whatsapp ? formatBRPhone(normalizeBRPhone(c.telefone_whatsapp)) : "Sem WhatsApp"} {c.cnpj ? `· ${maskCNPJ(c.cnpj)}` : ""}
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
                <div className="bg-muted rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      #{selectedCliente.codigo_sequencial} — {selectedCliente.nome_fantasia || selectedCliente.razao_social}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => { setSelectedCliente(null); setPhone(""); setName(""); setSelectedContactPhone(null); }}
                    >
                      Trocar
                    </Button>
                  </div>

                  {/* Contact picker */}
                  {contactOptions.length > 1 && (
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground font-medium">Escolha o contato:</p>
                      {contactOptions.map((opt) => (
                        <button
                          key={opt.phone}
                          type="button"
                          onClick={() => handleSelectContact(opt)}
                          className={cn(
                            "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors border",
                            selectedContactPhone === opt.phone
                              ? "border-primary bg-primary/5"
                              : "border-transparent hover:bg-background"
                          )}
                        >
                          <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium truncate">{opt.label}</p>
                            <p className="text-[11px] text-muted-foreground">{opt.displayPhone}</p>
                          </div>
                          {selectedContactPhone === opt.phone && (
                            <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {contactOptions.length === 1 && (
                    <p className="text-xs text-muted-foreground">
                      <Phone className="h-3 w-3 inline mr-1" />
                      {contactOptions[0].displayPhone}
                    </p>
                  )}

                  {contactOptions.length === 0 && (
                    <p className="text-xs text-muted-foreground">Nenhum telefone cadastrado</p>
                  )}
                </div>
              )}

              {selectedCliente && contactOptions.length === 0 && (
                <div>
                  <Label className="text-xs font-medium text-muted-foreground">Telefone (cliente sem WhatsApp cadastrado)</Label>
                  <Input
                    placeholder="+55 (11) 99999-9999"
                    value={maskPhoneBR(phone)}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="avulso" className="space-y-3 mt-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Telefone</Label>
                <Input
                  placeholder="+55 (11) 99999-9999"
                  value={maskPhoneBR(phone)}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
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

          {isCheckingOpen && phone.replace(/\D/g,'').length >= 10 && instanceId && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 p-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Verificando atendimentos abertos...</span>
            </div>
          )}

          {openConv?.exists && !isCheckingOpen && (
            openConv.isOwnUser ? (
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/40 p-3">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="space-y-1.5 flex-1">
                  <p className="text-xs font-medium text-blue-800 dark:text-blue-300">Você já tem um atendimento aberto com este contato.</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs text-blue-700 dark:text-blue-400"
                    onClick={() => {
                      onOpenChange(false);
                      resetForm();
                      onCreated?.(openConv.conversationId);
                    }}
                  >
                    Ir para a conversa →
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/40 p-3">
                <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="text-xs font-medium text-yellow-800 dark:text-yellow-300">Contato em atendimento</p>
                  <p className="text-xs text-yellow-700 dark:text-yellow-400">Este contato já está sendo atendido por {openConv.techName}. Não é possível abrir nova conversa.</p>
                </div>
              </div>
            )
          )}

          <Button onClick={handleCreate} disabled={createConversation.isPending || isCheckingOpen || (tab === "cliente" && !!selectedCliente && !phone) || (!!openConv?.exists && !openConv?.isOwnUser)} className="w-full">
            {createConversation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Iniciar Conversa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
