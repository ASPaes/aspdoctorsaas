import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Loader2, X, ChevronDown, Phone, Mail, MessageSquare, Building2, UserPlus, Paperclip, Plus, Trash2, Tag as TagIcon, Send, Clock, User as UserIcon, Calendar, Check, Lock, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { useClienteSearch, type ClienteSearchResult } from "@/components/whatsapp/hooks/useClienteSearch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  defaultDepartmentId?: string;
}

const Req = () => <span className="text-destructive">*</span>;

const PRIORIDADES = [
  { id: "baixa", name: "Baixa", color: "#10b981" },
  { id: "media", name: "Média", color: "#f59e0b" },
  { id: "alta", name: "Alta", color: "#ef4444" },
];

const CANAIS = [
  { id: "telefone", name: "Telefone", icon: Phone },
  { id: "presencial", name: "Presencial", icon: Building2 },
  { id: "email", name: "E-mail", icon: Mail },
  { id: "whatsapp", name: "WhatsApp", icon: MessageSquare },
];

const defaultPrevisao = () => {
  const d = new Date(Date.now() + 20 * 60 * 1000);
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
};

export function CreateSupportTicketModal({ open, onOpenChange, onCreated, defaultDepartmentId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();

  const [clienteSearchTerm, setClienteSearchTerm] = useState("");
  const [selectedCliente, setSelectedCliente] = useState<ClienteSearchResult | null>(null);
  const { results: clienteResults, isLoading: isSearchingClientes } = useClienteSearch(clienteSearchTerm);
  const [produtoId, setProdutoId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [serviceTypeId, setServiceTypeId] = useState<string>("");
  const [canalOrigem, setCanalOrigem] = useState<string>("telefone");
  const [tipoHorario, setTipoHorario] = useState<string>("comercial");
  const [prioridade, setPrioridade] = useState<string>("media");
  const [statusId, setStatusId] = useState<string>("");
  const [agendadoPara, setAgendadoPara] = useState<string>("");
  const [observacaoAgente, setObservacaoAgente] = useState<string>("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [contatoSolicitante, setContatoSolicitante] = useState("");
  const [contatoSelectedId, setContatoSelectedId] = useState<string | null>(null);
  const [contatoResults, setContatoResults] = useState<Array<{ id: string; name: string; phone_number: string | null; email: string | null; role: string | null }>>([]);
  const [contatoDropdownOpen, setContatoDropdownOpen] = useState(false);
  const [newContactDialogOpen, setNewContactDialogOpen] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactEmail, setNewContactEmail] = useState("");
  const [newContactRole, setNewContactRole] = useState("");
  const [savingNewContact, setSavingNewContact] = useState(false);
  const [previsaoEncerramento, setPrevisaoEncerramento] = useState(defaultPrevisao);
  const [checklistItems, setChecklistItems] = useState<{ text: string; done: boolean }[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [quickTagName, setQuickTagName] = useState("");
  const [quickTagColor, setQuickTagColor] = useState("#3b82f6");
  const [creatingTag, setCreatingTag] = useState(false);
  const [firstNote, setFirstNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setSelectedCliente(null);
    setClienteSearchTerm("");
    setProdutoId("");
    setCategoryId("");
    setSubcategoryId("");
    setServiceTypeId("");
    setCanalOrigem("telefone");
    setTipoHorario("comercial");
    setPrioridade("media");
    setStatusId("");
    setAgendadoPara("");
    setObservacaoAgente("");
    setDepartamentoId("");
    setContatoSolicitante("");
    setContatoSelectedId(null);
    setContatoResults([]);
    setContatoDropdownOpen(false);
    setPrevisaoEncerramento(defaultPrevisao());
    setChecklistItems([]);
    setNewChecklistItem("");
    setSelectedTagIds([]);
    setFirstNote("");
    setQuickTagName("");
    setQuickTagColor("#3b82f6");
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  useEffect(() => {
    if (open) {
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.id) setResponsavelId(data.user.id);
      });
    }
  }, [open]);

  const { data: produtos = [] } = useQuery({
    queryKey: ["create_manual_ticket_produtos", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: number; nome: string }>;
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["create_manual_ticket_categories", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_categories" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const { data: categoryProductLinks = [] } = useQuery({
    queryKey: ["create_manual_ticket_cat_links", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_category_products" as any) as any)
        .select("category_id, produto_id")
        .eq("tenant_id", tid);
      if (error) throw error;
      return (data ?? []) as Array<{ category_id: string; produto_id: number }>;
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ["create_manual_ticket_subcategories", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_subcategories" as any) as any)
        .select("id, nome, category_id")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; category_id: string }>;
    },
  });

  const { data: serviceTypes = [] } = useQuery({
    queryKey: ["create_manual_ticket_service_types", tid],
    enabled: open && !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("service_types" as any) as any)
        .select("id, nome")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string }>;
    },
  });

  const { data: departamentos = [] } = useQuery({
    queryKey: ["create_ticket_departamentos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_departments" as any) as any)
        .select("id, name")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .eq("usa_tickets", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const { data: userDepartmentId } = useQuery({
    queryKey: ["user_department", responsavelId],
    enabled: !!responsavelId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_department_members" as any) as any)
        .select("department_id")
        .eq("user_id", responsavelId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as any)?.department_id as string | null;
    },
  });

  useEffect(() => {
    if (!open) return;
    if (departamentoId) return;
    if (defaultDepartmentId && defaultDepartmentId !== "all") {
      setDepartamentoId(defaultDepartmentId);
    } else if (userDepartmentId) {
      setDepartamentoId(userDepartmentId);
    }
  }, [open, defaultDepartmentId, userDepartmentId]);

  const { data: ticketStatuses = [] } = useQuery({
    queryKey: ["create_ticket_statuses", tid, departamentoId],
    enabled: !!tid && !!departamentoId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_statuses" as any) as any)
        .select("id, name, color, position, is_initial, is_terminal")
        .eq("tenant_id", tid)
        .eq("department_id", departamentoId)
        .eq("is_active", true)
        .order("position");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string; position: number; is_initial: boolean; is_terminal: boolean }>;
    },
  });

  const { data: agentes = [] } = useQuery({
    queryKey: ["create_ticket_agentes", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionarios:funcionario_id(nome)")
        .eq("tenant_id", tid)
        .not("funcionario_id", "is", null);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((p: any) => p.funcionarios?.nome)
        .map((p: any) => ({ user_id: p.user_id as string, nome: p.funcionarios.nome as string }))
        .sort((a: any, b: any) => a.nome.localeCompare(b.nome));
    },
  });

  const { data: availableTags = [], refetch: refetchAvailableTags } = useQuery({
    queryKey: ["create_ticket_tags", tid],
    enabled: !!tid && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("ticket_tags" as any) as any)
        .select("id, name, color, department_id")
        .eq("tenant_id", tid)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; color: string; department_id: string | null }>;
    },
  });

  const { data: currentUserName } = useQuery({
    queryKey: ["create_ticket_current_user", responsavelId],
    enabled: !!responsavelId,
    queryFn: async () => {
      const { data } = await (supabase.from("profiles" as any) as any)
        .select("funcionarios:funcionario_id(nome)")
        .eq("user_id", responsavelId)
        .maybeSingle();
      return ((data as any)?.funcionarios?.nome as string) || null;
    },
  });

  useEffect(() => {
    const clienteId = selectedCliente?.id;
    if (!clienteId) {
      setContatoSolicitante("");
      return;
    }
    (supabase.from("whatsapp_contacts" as any) as any)
      .select("name, phone_number")
      .eq("client_id", clienteId)
      .eq("is_primary", true)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.name) setContatoSolicitante(data.name);
        else setContatoSolicitante("");
      });
  }, [selectedCliente?.id]);

  // Search whatsapp_contacts as user types
  useEffect(() => {
    const clienteId = selectedCliente?.id;
    const term = contatoSolicitante.trim();
    if (!clienteId || term.length < 1 || contatoSelectedId) {
      setContatoResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await (supabase.from("whatsapp_contacts" as any) as any)
        .select("id, name, phone_number, email, role")
        .eq("client_id", clienteId)
        .ilike("name", `%${term}%`)
        .limit(8);
      if (!cancelled) {
        setContatoResults((data as any) ?? []);
        setContatoDropdownOpen(true);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [contatoSolicitante, selectedCliente?.id, contatoSelectedId]);

  const produtoIdNum = produtoId ? Number(produtoId) : null;

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.produto_id === produtoIdNum || c.produto_id === null),
    [categories, produtoIdNum]
  );

  const filteredSubcategories = useMemo(
    () => subcategories.filter((s) => s.category_id === categoryId),
    [subcategories, categoryId]
  );

  useEffect(() => {
    setSubcategoryId("");
  }, [categoryId]);

  useEffect(() => {
    setCategoryId("");
    setSubcategoryId("");
  }, [produtoId]);

  useEffect(() => {
    if (ticketStatuses.length > 0) {
      const initial = ticketStatuses.find((s) => s.is_initial);
      if (initial) setStatusId(initial.id);
      else setStatusId(ticketStatuses[0].id);
    } else {
      setStatusId("");
    }
  }, [ticketStatuses]);

  const addChecklistItem = () => {
    const t = newChecklistItem.trim();
    if (!t) return;
    setChecklistItems((prev) => [...prev, { text: t, done: false }]);
    setNewChecklistItem("");
  };

  const handleCreateAndAddTag = async () => {
    if (!quickTagName.trim() || !tid) return;
    setCreatingTag(true);
    try {
      const { data: newTag, error } = await (supabase.from("ticket_tags" as any) as any)
        .insert({
          tenant_id: tid,
          name: quickTagName.trim(),
          color: quickTagColor,
          department_id: departamentoId || null,
          is_active: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      if ((newTag as any)?.id) {
        setSelectedTagIds((prev) => [...prev, (newTag as any).id]);
      }
      setQuickTagName("");
      setQuickTagColor("#3b82f6");
      refetchAvailableTags();
      toast.success("Tag criada");
    } catch (err: any) {
      toast.error("Erro ao criar tag: " + (err?.message ?? ""));
    } finally {
      setCreatingTag(false);
    }
  };

  const handleSubmit = async () => {
    if (!selectedCliente) {
      toast.error("Selecione um cliente");
      return;
    }
    if (!produtoId || !categoryId || !subcategoryId || !serviceTypeId || !canalOrigem) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }
    if (!departamentoId) {
      toast.error("Selecione o setor");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: rpcData, error } = await (supabase.rpc as any)("create_manual_ticket", {
        p_cliente_id: selectedCliente.id,
        p_produto_id: Number(produtoId),
        p_category_id: categoryId,
        p_subcategory_id: subcategoryId,
        p_service_type_id: serviceTypeId,
        p_canal_origem: canalOrigem,
        p_tipo_horario: tipoHorario,
        p_observacao_agente: observacaoAgente || null,
        p_status_id: statusId || null,
        p_agendado_para: agendadoPara ? new Date(agendadoPara).toISOString() : null,
        p_contact_id: null,
        p_department_id: departamentoId,
        p_responsavel_user_id: responsavelId || null,
        p_cliente_contato_id: null,
        p_previsao_encerramento: previsaoEncerramento ? new Date(previsaoEncerramento).toISOString() : null,
      });

      if (error) throw error;

      const ticketId =
        typeof rpcData === "string"
          ? rpcData
          : (rpcData as any)?.ticket_id ?? (rpcData as any)?.id ?? null;

      if (ticketId) {
        if (selectedTagIds.length > 0) {
          await (supabase.from("ticket_tag_assignments" as any) as any).insert(
            selectedTagIds.map((tagId) => ({ ticket_id: ticketId, tag_id: tagId }))
          );
        }
        if (firstNote.trim() && responsavelId) {
          await (supabase.from("support_ticket_events" as any) as any).insert({
            tenant_id: tid,
            ticket_id: ticketId,
            user_id: responsavelId,
            event_type: "note",
            content: firstNote.trim(),
          });
        }
        if (checklistItems.length > 0) {
          await (supabase.from("support_tickets" as any) as any)
            .update({ checklist: checklistItems })
            .eq("id", ticketId);
        }
      }

      toast.success("Ticket criado com sucesso");
      onCreated?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao criar ticket: " + (err?.message || "desconhecido"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentStatus = ticketStatuses.find((s) => s.id === statusId);
  const currentPrioridade = PRIORIDADES.find((p) => p.id === prioridade);
  const currentCanal = CANAIS.find((c) => c.id === canalOrigem);
  const CanalIcon = currentCanal?.icon ?? Phone;

  const handleSaveNewContact = async () => {
    if (!selectedCliente || !tid) return;
    if (!newContactName.trim()) {
      toast.error("Informe o nome");
      return;
    }
    setSavingNewContact(true);
    try {
      const { data, error } = await (supabase.from("whatsapp_contacts" as any) as any)
        .insert({
          tenant_id: tid,
          client_id: selectedCliente.id,
          name: newContactName.trim(),
          phone_number: newContactPhone.trim() || null,
          email: newContactEmail.trim() || null,
          role: newContactRole.trim() || null,
          is_primary: false,
        })
        .select("id, name")
        .single();
      if (error) throw error;
      toast.success("Contato cadastrado");
      setContatoSolicitante((data as any).name);
      setContatoSelectedId((data as any).id);
      setContatoResults([]);
      setContatoDropdownOpen(false);
      setNewContactDialogOpen(false);
    } catch (err: any) {
      toast.error("Erro ao salvar contato: " + (err?.message ?? ""));
    } finally {
      setSavingNewContact(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[900px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col shadow-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pr-12 pt-4 pb-3 border-b">
          <h3 className="text-base font-medium">Novo ticket</h3>
          <div className="flex items-center gap-1.5">
            {(() => {
              const currentStatus = ticketStatuses.find(s => s.id === statusId);
              const isTerminal = currentStatus?.is_terminal ?? false;
              const initialStatus = ticketStatuses.find(s => s.is_initial);
              const terminalStatus = ticketStatuses.find(s => s.is_terminal);
              if (!departamentoId || ticketStatuses.length === 0) return null;
              return (
                <>
                  {!isTerminal ? (
                    <>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/25">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                        Aberto
                      </div>
                      {terminalStatus && (
                        <button type="button"
                          onClick={() => setStatusId(terminalStatus.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors">
                          <Check className="h-3.5 w-3.5" /> Encerrar
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-muted text-muted-foreground border border-border">
                        <Lock className="h-3 w-3" /> Encerrado
                      </div>
                      {initialStatus && (
                        <button type="button"
                          onClick={() => setStatusId(initialStatus.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors">
                          <RefreshCw className="h-3.5 w-3.5" /> Reabrir
                        </button>
                      )}
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Top strip */}
        <div className="flex items-center gap-2 px-5 py-2.5 border-b flex-wrap">
          {/* Prioridade */}
          <Select value={prioridade} onValueChange={setPrioridade}>
            <SelectTrigger className="h-auto w-auto border rounded-md px-3 py-1.5 text-xs gap-1.5 bg-muted/30 [&>svg]:hidden [&>span]:!flex [&>span]:!overflow-visible">
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: currentPrioridade?.color ?? "#6b7280" }}
                />
                {currentPrioridade?.name ?? "Prioridade"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {PRIORIDADES.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                    {p.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Canal */}
          <Select value={canalOrigem} onValueChange={setCanalOrigem}>
            <SelectTrigger className="h-auto w-auto border rounded-md px-3 py-1.5 text-xs gap-1.5 bg-muted/30 [&>svg]:hidden [&>span]:!flex [&>span]:!overflow-visible">
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <CanalIcon className="h-3 w-3 shrink-0" />
                {currentCanal?.name ?? "Canal"}
                <ChevronDown className="h-3 w-3 opacity-60" />
              </span>
            </SelectTrigger>
            <SelectContent>
              {CANAIS.map((c) => {
                const Ic = c.icon;
                return (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="flex items-center gap-2">
                      <Ic className="h-3.5 w-3.5" />
                      {c.name}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <div className="flex-1" />

          {/* Tipo horário */}
          <div className="flex gap-1">
            {["comercial", "plantao"].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipoHorario(t)}
                className={`px-3 py-1 text-[11px] rounded-md border transition-colors ${
                  tipoHorario === t
                    ? "bg-primary/10 text-primary border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "comercial" ? "Comercial" : "Plantão"}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-[1fr_260px] flex-1 overflow-hidden">
          {/* Left panel */}
          <div className="p-4 pr-4 border-r space-y-4 overflow-y-auto">
            {/* Setor + Status + Responsável */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Setor <Req /></Label>
                <Select value={departamentoId} onValueChange={setDepartamentoId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {departamentos.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Status</Label>
                <Select value={statusId} onValueChange={setStatusId} disabled={!departamentoId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue>
                      {currentStatus ? (
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: currentStatus.color }} />
                          {currentStatus.name}
                        </span>
                      ) : "Status"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ticketStatuses.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                          {s.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Responsável <Req /></Label>
                <Select value={responsavelId} onValueChange={setResponsavelId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {agentes.map((a) => (
                      <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Cliente */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Cliente <Req /></Label>
              {selectedCliente ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/30 px-3 py-2">
                  <span className="text-sm truncate">
                    <span className="text-muted-foreground">#{selectedCliente.codigo_sequencial}</span>{" "}
                    {selectedCliente.nome_fantasia || selectedCliente.razao_social || "Sem nome"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0"
                    onClick={() => {
                      setSelectedCliente(null);
                      setProdutoId("");
                      setClienteSearchTerm("");
                      setContatoSolicitante("");
                    }}
                  >
                    Trocar
                  </Button>
                </div>
              ) : (
                <div className="relative space-y-1">
                  <Input
                    value={clienteSearchTerm}
                    onChange={(e) => setClienteSearchTerm(e.target.value)}
                    placeholder="Buscar por nome, CNPJ ou código..."
                    className="h-9 text-xs"
                  />
                  {isSearchingClientes && (
                    <div className="absolute right-3 top-2.5">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {clienteResults.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded-md border border-input bg-popover">
                      {clienteResults.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors"
                          onClick={() => {
                            setSelectedCliente(c);
                            setClienteSearchTerm("");
                            (supabase.from("clientes" as any) as any)
                              .select("produto_id")
                              .eq("id", c.id)
                              .maybeSingle()
                              .then(({ data }: any) => {
                                if (data?.produto_id) setProdutoId(String(data.produto_id));
                              });
                          }}
                        >
                          <span className="text-muted-foreground">#{c.codigo_sequencial}</span>{" "}
                          {c.nome_fantasia || c.razao_social}
                        </button>
                      ))}
                    </div>
                  )}
                  {clienteResults.length === 0 && clienteSearchTerm.length >= 2 && !isSearchingClientes && (
                    <p className="text-xs text-muted-foreground px-1">Nenhum cliente encontrado</p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs font-medium">Contato solicitante</Label>
                <div className="flex gap-1.5">
                  <div className="relative flex-1">
                    <Input
                      value={contatoSolicitante}
                      onChange={(e) => {
                        setContatoSolicitante(e.target.value);
                        setContatoSelectedId(null);
                      }}
                      onFocus={() => { if (contatoResults.length > 0) setContatoDropdownOpen(true); }}
                      onBlur={() => setTimeout(() => setContatoDropdownOpen(false), 150)}
                      placeholder="Nome do solicitante"
                      className="h-9 text-xs"
                      disabled={!selectedCliente}
                    />
                    {contatoDropdownOpen && contatoResults.length > 0 && (
                      <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-input bg-popover shadow-md">
                        {contatoResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="w-full text-left px-3 py-2 text-xs hover:bg-accent transition-colors"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setContatoSolicitante(c.name);
                              setContatoSelectedId(c.id);
                              setContatoDropdownOpen(false);
                              setContatoResults([]);
                            }}
                          >
                            <div className="font-medium">{c.name}</div>
                            {(c.phone_number || c.role) && (
                              <div className="text-[10px] text-muted-foreground">
                                {[c.role, c.phone_number].filter(Boolean).join(" • ")}
                              </div>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={!selectedCliente}
                    onClick={() => {
                      setNewContactName(contatoSolicitante);
                      setNewContactPhone("");
                      setNewContactEmail("");
                      setNewContactRole("");
                      setNewContactDialogOpen(true);
                    }}
                    title="Cadastrar novo contato"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">Busca nos contatos do cliente. Use + para cadastrar.</p>
              </div>
            </div>

            {/* Classificação */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Classificação</Label>
              <div className="grid grid-cols-4 gap-2">
                <Select value={produtoId} onValueChange={setProdutoId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Produto *" /></SelectTrigger>
                  <SelectContent>
                    {produtos.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={categoryId} onValueChange={setCategoryId} disabled={!produtoId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Categoria *" /></SelectTrigger>
                  <SelectContent>
                    {filteredCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Subcategoria *" /></SelectTrigger>
                  <SelectContent>
                    {filteredSubcategories.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={serviceTypeId} onValueChange={setServiceTypeId}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Tipo *" /></SelectTrigger>
                  <SelectContent>
                    {serviceTypes.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Descrição */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Descrição</Label>
              <Textarea
                value={observacaoAgente}
                onChange={(e) => {
                  setObservacaoAgente(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = e.target.scrollHeight + "px";
                }}
                placeholder="Descreva o atendimento..."
                className="text-xs min-h-[80px] overflow-hidden"
                style={{ resize: "none" }}
              />
            </div>

            {/* Previsão + Agendado */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Label className="text-xs font-medium">Previsão de encerramento</Label>
                  <span className="text-[9px] uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded">auto</span>
                </div>
                <Input
                  type="datetime-local"
                  value={previsaoEncerramento}
                  onChange={(e) => setPrevisaoEncerramento(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Agendado para</Label>
                <Input
                  type="datetime-local"
                  className="h-9 text-xs"
                  value={agendadoPara}
                  onChange={(e) => setAgendadoPara(e.target.value)}
                />
              </div>
            </div>

            {/* Checklist */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Checklist</Label>
              {checklistItems.length > 0 && (
                <div className="space-y-1">
                  {checklistItems.map((item, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-input bg-muted/20 px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() =>
                          setChecklistItems((prev) =>
                            prev.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it))
                          )
                        }
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <span className={`flex-1 text-xs ${item.done ? "line-through text-muted-foreground" : ""}`}>
                        {item.text}
                      </span>
                      <button
                        type="button"
                        onClick={() => setChecklistItems((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-1.5">
                <Input
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addChecklistItem();
                    }
                  }}
                  placeholder="Adicionar item..."
                  className="h-9 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  onClick={addChecklistItem}
                  disabled={!newChecklistItem.trim()}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Anexos */}
            <div className="space-y-2">
              <Label className="text-xs font-medium">Anexos</Label>
              <Button type="button" variant="outline" size="sm" className="h-9 text-xs gap-1.5" disabled>
                <Paperclip className="h-3.5 w-3.5" />
                Anexar arquivo
              </Button>
            </div>
          </div>

          {/* Right panel */}
          <div className="p-3.5 space-y-3 overflow-y-auto bg-muted/10">
            {/* Tags */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Tags</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {selectedTagIds.map((tagId) => {
                  const tag = availableTags.find((t) => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <span
                      key={tag.id}
                      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded font-medium"
                      style={{ background: tag.color + "22", color: tag.color }}
                    >
                      {tag.name}
                      <button
                        type="button"
                        onClick={() => setSelectedTagIds((prev) => prev.filter((id) => id !== tag.id))}
                        className="hover:opacity-70"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
                <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-6 px-2 text-[11px] gap-1">
                      <TagIcon className="h-3 w-3" />
                      Tag
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-56 p-1.5">
                    <div className="space-y-0.5 max-h-60 overflow-y-auto">
                      {availableTags
                        .filter((t) => !selectedTagIds.includes(t.id))
                        .map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setSelectedTagIds((prev) => [...prev, t.id]);
                              setTagPopoverOpen(false);
                            }}
                            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-sm flex items-center gap-2"
                          >
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.color }} />
                            {t.name}
                          </button>
                        ))}
                      {availableTags.filter((t) => !selectedTagIds.includes(t.id)).length === 0 && (
                        <p className="text-xs text-muted-foreground text-center py-3">Nenhuma tag disponível</p>
                      )}
                    </div>
                    <div className="border-t mt-2 pt-2">
                      <p className="text-[10px] text-muted-foreground mb-1.5 px-1">Criar nova</p>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="color"
                          value={quickTagColor}
                          onChange={(e) => setQuickTagColor(e.target.value)}
                          className="h-8 w-8 p-0.5 shrink-0"
                        />
                        <Input
                          value={quickTagName}
                          onChange={(e) => setQuickTagName(e.target.value)}
                          placeholder="Nome..."
                          className="h-8 text-xs flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleCreateAndAddTag();
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2"
                          onClick={handleCreateAndAddTag}
                          disabled={!quickTagName.trim() || creatingTag}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <Separator className="my-3" />

            {/* Timeline */}
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">Timeline</div>
              <div className="flex gap-1.5">
                <Input
                  value={firstNote}
                  onChange={(e) => setFirstNote(e.target.value)}
                  placeholder="Primeira ocorrência..."
                  className="h-9 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0"
                  disabled
                  title="Será registrada ao criar o ticket"
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Será registrada como primeira ocorrência ao criar o ticket.
              </p>
            </div>

            <Separator className="my-3" />

            {/* Metadata */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="text-[10px] uppercase tracking-wide">Aberto em</span>
              </div>
              <p className="text-xs pl-5">
                {new Date().toLocaleString("pt-BR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>

              <div className="flex items-center gap-2 text-muted-foreground pt-1">
                <UserIcon className="h-3 w-3 shrink-0" />
                <span className="text-[10px] uppercase tracking-wide">Criado por</span>
              </div>
              <p className="text-xs pl-5 truncate">{currentUserName ?? "—"}</p>

              <div className="flex items-center gap-2 text-muted-foreground pt-1">
                <Clock className="h-3 w-3 shrink-0" />
                <span className="text-[10px] uppercase tracking-wide">Tempo agente</span>
              </div>
              <p className="text-xs pl-5">0 min</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Criar ticket
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={newContactDialogOpen} onOpenChange={setNewContactDialogOpen}>
      <DialogContent className="max-w-md">
        <div className="space-y-4">
          <div>
            <h3 className="text-base font-semibold">Novo contato</h3>
            <p className="text-xs text-muted-foreground">
              {selectedCliente ? (selectedCliente.nome_fantasia || selectedCliente.razao_social) : ""}
            </p>
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome <Req /></Label>
              <Input value={newContactName} onChange={(e) => setNewContactName(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Telefone</Label>
              <Input value={newContactPhone} onChange={(e) => setNewContactPhone(e.target.value)} className="h-9 text-xs" placeholder="(11) 99999-9999" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">E-mail</Label>
              <Input type="email" value={newContactEmail} onChange={(e) => setNewContactEmail(e.target.value)} className="h-9 text-xs" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Cargo</Label>
              <Input value={newContactRole} onChange={(e) => setNewContactRole(e.target.value)} className="h-9 text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewContactDialogOpen(false)} disabled={savingNewContact}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSaveNewContact} disabled={savingNewContact}>
              {savingNewContact && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
