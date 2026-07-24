import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Loader2, X, ChevronDown, Phone, Mail, MessageSquare, Building2, UserPlus, Paperclip, Plus, Trash2, Tag as TagIcon, Send, Clock, User as UserIcon, Calendar, Check, Lock, RefreshCw, Bot, ArrowLeft, ArrowRight, HelpCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { useClienteSearch, type ClienteSearchResult } from "@/components/whatsapp/hooks/useClienteSearch";
import { SupportTicketDetailDialog } from "@/components/tickets/SupportTicketDetailDialog";

function HelpBadge({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current/40 text-[10px] leading-none opacity-80 hover:opacity-100"
          aria-label="Ajuda"
        >
          ?
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-w-xs text-xs p-2.5 leading-relaxed">
        {text}
      </PopoverContent>
    </Popover>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
  defaultDepartmentId?: string;
  // Closure mode props
  fromClosure?: boolean;
  /**
   * 'initial'             → create_ticket_from_closure (atendimento encerrado sem ticket vinculado)
   * 'additional'          → create_additional_ticket_from_attendance (atendimento reaberto, ticket adicional)
   * 'demanda_externa'     → create_demand_ticket_from_attendance (ticket avulso a partir de atendimento)
   * 'classificacao_aberta'→ create_classification_ticket_open (classifica ticket ABERTO com atendimento em andamento)
   */
  mode?: "initial" | "additional" | "demanda_externa" | "classificacao_aberta";
  attendanceId?: string | null;
  closureClienteId?: string | null;
  closureClienteNome?: string | null;
  closureClienteCodigo?: number | null;
  closureProdutoId?: number | null;
  closureDepartmentId?: string | null;
  closureResponsavelId?: string | null;
  closureContactName?: string | null;
  closureHandleSeconds?: number | null;
  closureAiSummary?: string | null;
  closureAiTopics?: string[] | null;
  closureAiKeywords?: string[] | null;
  closureAiProblem?: string | null;
  closureAiSolution?: string | null;
  closureSentimentLabel?: string | null;
  closureSentimentConfidence?: number | null;
  closureSentimentSummary?: string | null;
  // Manual mode defaults (não-closure): pré-selecionar cliente/setor a partir do chat
  defaultClienteId?: string | null;
  defaultClienteNome?: string | null;
  defaultClienteCodigo?: number | null;

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

export function CreateSupportTicketModal({
  open,
  onOpenChange,
  onCreated,
  defaultDepartmentId,
  fromClosure = false,
  mode = "initial",
  attendanceId = null,
  closureClienteId = null,
  closureClienteNome = null,
  closureClienteCodigo = null,
  closureProdutoId = null,
  closureDepartmentId = null,
  closureResponsavelId = null,
  closureContactName = null,
  closureHandleSeconds = null,
  closureAiSummary = null,
  closureAiTopics = null,
  closureAiKeywords = null,
  closureAiProblem = null,
  closureAiSolution = null,
  closureSentimentLabel = null,
  closureSentimentConfidence = null,
  closureSentimentSummary = null,
  defaultClienteId = null,
  defaultClienteNome = null,
  defaultClienteCodigo = null,

}: Props) {
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
  const [modoHorario, setModoHorario] = useState<"auto" | "manual">("auto");
  const [tipoDetectado, setTipoDetectado] = useState<"comercial" | "plantao" | null>(null);
  const [horarioInicio, setHorarioInicio] = useState<string>("");
  const [horarioFim, setHorarioFim] = useState<string>("");
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
  const [submitMode, setSubmitMode] = useState<null | "close" | "continue">(null);
  const [continueTicketId, setContinueTicketId] = useState<string | null>(null);
  const [pendingContinueTicketId, setPendingContinueTicketId] = useState<string | null>(null);

  const reset = () => {
    setSelectedCliente(null);
    setClienteSearchTerm("");
    setProdutoId("");
    setCategoryId("");
    setSubcategoryId("");
    setServiceTypeId("");
    setCanalOrigem("telefone");
    setTipoHorario("comercial");
    setModoHorario("auto");
    setTipoDetectado(null);
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
    if (!open) return;
    if (fromClosure) {
      // Reset targeted — mantém dados closure
      setClienteSearchTerm("");
      setCanalOrigem("whatsapp");
      setTipoHorario("comercial");
      setModoHorario("auto");
      setTipoDetectado(null);
      setPrioridade("media");
      setAgendadoPara("");
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
      // Pré-preencher closure
      if (closureClienteId) {
        setSelectedCliente({
          id: closureClienteId,
          nome_fantasia: closureClienteNome || null,
          razao_social: null,
          codigo_sequencial: closureClienteCodigo || null,
          cnpj: null,
        } as any);
      } else {
        setSelectedCliente(null);
      }
      setProdutoId(closureProdutoId ? String(closureProdutoId) : "");
      setCategoryId("");
      setSubcategoryId("");
      setServiceTypeId("");
      setDepartamentoId(closureDepartmentId || "");
      setResponsavelId(closureResponsavelId || "");
      setContatoSolicitante(closureContactName || "");
      const descParts: string[] = [];
      if (closureAiProblem) descParts.push("PROBLEMA: " + closureAiProblem);
      if (closureAiSolution) descParts.push("SOLUÇÃO: " + closureAiSolution);
      if (descParts.length === 0 && closureAiSummary) {
        descParts.push("RESUMO: " + closureAiSummary);
      }
      setObservacaoAgente(descParts.join("\n\n"));
      if (closureAiProblem) {
        setChecklistItems([{ text: closureAiProblem, done: false }]);
      }
      setStatusId("");
    } else {
      reset();
    }
  }, [open]);

  // Dados do atendimento de origem (closure) para ancorar a detecção de horário.
  const { data: closureAttendance, isLoading: isLoadingClosureAttendance } = useQuery({
    queryKey: ["create_support_ticket_closure_attendance", attendanceId],
    enabled: open && fromClosure && !!attendanceId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("support_attendances" as any) as any)
        .select("opened_at, department_id")
        .eq("id", attendanceId)
        .maybeSingle();
      if (error) throw error;
      return data as { opened_at: string; department_id: string | null } | null;
    },
  });

  // Formatação pt-BR / America/Sao_Paulo (usada no painel lateral e no badge).
  const formatSpDateTime = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(iso));

  const formatSpShort = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(iso));

  // Detecta tipo de horário (comercial/plantão) ao abrir o modal, trocar setor
  // ou, no modo closure, quando os dados do atendimento carregam.
  useEffect(() => {
    if (!open) return;
    // No modo closure, aguardar closureAttendance carregar para não disparar
    // uma detecção com p_at=undefined (now) que depois seria substituída.
    if (fromClosure && (isLoadingClosureAttendance || !closureAttendance?.opened_at)) {
      setTipoDetectado(null);
      return;
    }
    let cancelled = false;
    setTipoDetectado(null);
    (async () => {
      const isClosure = fromClosure && closureAttendance?.opened_at;
      const p_department_id = isClosure
        ? (closureAttendance?.department_id ?? departamentoId ?? null)
        : (departamentoId || null);
      const p_at = isClosure ? closureAttendance?.opened_at : undefined;
      try {
        const { data, error } = await (supabase.rpc as any)("check_tipo_horario", {
          p_department_id,
          ...(p_at !== undefined ? { p_at } : {}),
          p_tenant_id: tid,
        });
        console.log("[check_tipo_horario]", fromClosure ? "closure" : "manual", "retorno:", data, "erro:", error);
        if (cancelled) return;
        if (error) {
          console.error("[check_tipo_horario] erro ao detectar horário:", error);
          setTipoDetectado(null);
          setTipoHorario("comercial");
          setHorarioInicio("");
          setHorarioFim("");
          return;
        }
        const raw = typeof data === "string" ? data : null;
        if (raw === "comercial" || raw === "plantao") {
          setTipoDetectado(raw);
          setModoHorario((currentMode) => {
            if (currentMode === "auto") {
              setTipoHorario(raw);
              if (raw === "comercial") {
                setHorarioInicio("");
                setHorarioFim("");
              }
            }
            return currentMode;
          });
        } else {
          console.error("[check_tipo_horario] valor inesperado:", raw);
          setTipoDetectado(null);
          setTipoHorario("comercial");
          setHorarioInicio("");
          setHorarioFim("");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[check_tipo_horario] exceção:", err);
        setTipoDetectado(null);
        setTipoHorario("comercial");
        setHorarioInicio("");
        setHorarioFim("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, departamentoId, closureAttendance, fromClosure, attendanceId, tid, isLoadingClosureAttendance]);


  useEffect(() => {
    if (open && !fromClosure) {
      supabase.auth.getUser().then(({ data }) => {
        if (data?.user?.id) setResponsavelId(data.user.id);
      });
    }
  }, [open, fromClosure]);

  // Manual mode: pré-selecionar cliente/setor a partir do chat (editáveis)
  useEffect(() => {
    if (!open || fromClosure) return;
    if (defaultClienteId) {
      setSelectedCliente({
        id: defaultClienteId,
        nome_fantasia: defaultClienteNome || null,
        razao_social: null,
        codigo_sequencial: defaultClienteCodigo || null,
        cnpj: null,
      } as any);
    }
  }, [open, fromClosure, defaultClienteId, defaultClienteNome, defaultClienteCodigo]);


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
    // No modo closure, o contato já vem preenchido do chat — não sobrescrever
    if (fromClosure) return;
    const clienteId = selectedCliente?.id;
    if (!clienteId) {
      setContatoSolicitante("");
      return;
    }
    (supabase.from("cliente_contatos" as any) as any)
      .select("name:nome, phone_number:fone")
      .eq("cliente_id", clienteId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()
      .then(({ data }: any) => {
        if (data?.name) setContatoSolicitante(data.name);
        else setContatoSolicitante("");
      });
  }, [selectedCliente?.id, fromClosure]);

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
      const { data } = await (supabase.from("cliente_contatos" as any) as any)
        .select("id, name:nome, phone_number:fone, email, role:cargo")
        .eq("cliente_id", clienteId)
        .ilike("nome", `%${term}%`)
        .limit(8);
      if (!cancelled) {
        setContatoResults((data as any) ?? []);
        setContatoDropdownOpen(true);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [contatoSolicitante, selectedCliente?.id, contatoSelectedId]);

  const produtoIdNum = produtoId ? Number(produtoId) : null;

  const filteredCategories = useMemo(() => {
    if (!produtoIdNum) return categories;
    const linkedCatIds = new Set(
      categoryProductLinks.filter((l) => l.produto_id === produtoIdNum).map((l) => l.category_id)
    );
    const catsWithAnyLink = new Set(categoryProductLinks.map((l) => l.category_id));
    return categories.filter((c) => linkedCatIds.has(c.id) || !catsWithAnyLink.has(c.id));
  }, [categories, produtoIdNum, categoryProductLinks]);

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
      if (fromClosure && mode !== "demanda_externa" && mode !== "classificacao_aberta") {
        const terminal = ticketStatuses.find((s) => s.is_terminal);
        if (terminal) setStatusId(terminal.id);
        else setStatusId(ticketStatuses[ticketStatuses.length - 1].id);
      } else {
        const initial = ticketStatuses.find((s) => s.is_initial);
        if (initial) setStatusId(initial.id);
        else setStatusId(ticketStatuses[0].id);
      }
    } else {
      setStatusId("");
    }
  }, [ticketStatuses, fromClosure, mode]);

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

  const isDirty = !!(
    selectedCliente || produtoId || categoryId || subcategoryId || serviceTypeId ||
    (observacaoAgente && observacaoAgente.trim()) || (firstNote && firstNote.trim()) ||
    checklistItems.length > 0 || selectedTagIds.length > 0 || agendadoPara ||
    (contatoSolicitante && contatoSolicitante.trim())
  );

  const requestClose = () => {
    if (isSubmitting) return;
    if (isDirty && !fromClosure) {
      if (!window.confirm("Descartar este ticket?")) return;
    }
    onOpenChange(false);
  };

  const handleSubmit = async (nextAction: "close" | "continue" = "close") => {
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
    setSubmitMode(nextAction);
    try {
      let ticketId: string | null = null;

      if (fromClosure && attendanceId) {
        if (mode === "classificacao_aberta") {
          const { data: rpcData, error } = await (supabase.rpc as any)("create_classification_ticket_open", {
            p_attendance_id: attendanceId,
            p_category_id: categoryId,
            p_subcategory_id: subcategoryId,
            p_service_type_id: serviceTypeId,
            p_produto_id: Number(produtoId),
            p_tipo_horario: tipoHorario,
            p_observacao_agente: observacaoAgente || null,
            p_observacao_ia: null,
            p_department_id: null,
            p_responsavel_user_id: null,
          });
          if (error) throw error;
          ticketId = typeof rpcData === "string" ? rpcData : (rpcData as any)?.ticket_id ?? (rpcData as any)?.id ?? null;
        } else {
          const closureRpcName =
            mode === "additional"
              ? "create_additional_ticket_from_attendance"
              : mode === "demanda_externa"
                ? "create_demand_ticket_from_attendance"
                : "create_ticket_from_closure";
          const { data: rpcData, error } = await (supabase.rpc as any)(closureRpcName, {
            p_attendance_id: attendanceId,
            p_produto_id: Number(produtoId),
            p_category_id: categoryId,
            p_subcategory_id: subcategoryId,
            p_service_type_id: serviceTypeId,
            p_observacao_agente: observacaoAgente || null,
            p_observacao_ia: closureAiSummary || null,
            p_tipo_horario: tipoHorario,
            p_department_id: departamentoId || null,
            p_responsavel_user_id: responsavelId || null,
          });
          if (error) throw error;
          ticketId = typeof rpcData === "string" ? rpcData : (rpcData as any)?.ticket_id ?? (rpcData as any)?.id ?? null;
        }

      } else {
        const { data: rpcData, error } = await (supabase.rpc as any)("create_manual_ticket", {
          p_cliente_id: selectedCliente.id,
          p_produto_id: Number(produtoId),
          p_category_id: categoryId,
          p_subcategory_id: subcategoryId,
          p_service_type_id: serviceTypeId,
          p_canal_origem: canalOrigem,
          p_tipo_horario: tipoHorario,
          p_horario_inicio: tipoHorario === "plantao" && horarioInicio ? new Date(horarioInicio).toISOString() : null,
          p_horario_fim: tipoHorario === "plantao" && horarioFim ? new Date(horarioFim).toISOString() : null,
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
        ticketId = typeof rpcData === "string" ? rpcData : (rpcData as any)?.ticket_id ?? (rpcData as any)?.id ?? null;
      }

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
        if (prioridade && prioridade !== "media") {
          await (supabase.from("support_tickets" as any) as any)
            .update({ prioridade })
            .eq("id", ticketId);
        }
        if (mode === "demanda_externa" && statusId) {
          try {
            await (supabase.rpc as any)("update_ticket_fields", {
              p_ticket_id: ticketId,
              p_fields: { status_id: statusId },
            });
          } catch (e) {
            console.warn("Falha ao aplicar status no ticket de demanda externa:", e);
          }
        }
      }

      toast.success(
        fromClosure && mode === "demanda_externa"
          ? "Ticket de demanda externa aberto!"
          : "Ticket criado com sucesso"
      );
      onCreated?.();

      if (nextAction === "continue" && ticketId) {
        try {
          setContinueTicketId(ticketId);
          onOpenChange(false);
        } catch (openErr) {
          console.warn("Falha ao abrir a tela do ticket:", openErr);
          setPendingContinueTicketId(ticketId);
        }
      } else {
        onOpenChange(false);
      }
    } catch (err: any) {
      toast.error("Erro ao criar ticket: " + (err?.message || "desconhecido"));
    } finally {
      setIsSubmitting(false);
      setSubmitMode(null);
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
      const { data, error } = await (supabase.from("cliente_contatos" as any) as any)
        .insert({
          tenant_id: tid,
          cliente_id: selectedCliente.id,
          nome: newContactName.trim(),
          fone: newContactPhone.trim() || null,
          email: newContactEmail.trim() || null,
          cargo: newContactRole.trim() || null,
        })
        .select("id, name:nome")
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
    <Dialog open={open} onOpenChange={(o) => { if (!o) { requestClose(); } else { onOpenChange(true); } }}>
      <DialogContent
        className="max-w-[900px] p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col shadow-none"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >

        {/* Header */}
        <div className="flex items-center justify-between px-5 pr-12 pt-4 pb-3 border-b">
          <h3 className="text-base font-medium">
          {fromClosure
              ? mode === "demanda_externa"
                ? "Novo ticket"
                : "Classificar atendimento"
              : "Novo ticket"}
          </h3>
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
          <Select value={canalOrigem} onValueChange={setCanalOrigem} disabled={fromClosure}>
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
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {(["auto", "comercial", "plantao"] as const).map((t) => {
                const isActive =
                  t === "auto" ? modoHorario === "auto" : modoHorario === "manual" && tipoHorario === t;
                const label = t === "auto" ? "Automático" : t === "comercial" ? "Comercial" : "Plantão";
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      if (t === "auto") {
                        setModoHorario("auto");
                        if (tipoDetectado) {
                          setTipoHorario(tipoDetectado);
                          if (tipoDetectado === "comercial") {
                            setHorarioInicio("");
                            setHorarioFim("");
                          }
                        }
                      } else {
                        setModoHorario("manual");
                        setTipoHorario(t);
                        if (t === "comercial") {
                          setHorarioInicio("");
                          setHorarioFim("");
                        }
                      }
                    }}
                    className={`px-3 py-1 text-[11px] rounded-md border transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary border-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {modoHorario === "auto" && (
              <span
                className={`text-[10px] px-2 py-0.5 rounded-md border ${
                  tipoDetectado
                    ? "border-primary/40 text-primary bg-primary/5"
                    : "border-border text-muted-foreground"
                }`}
              >
                {tipoDetectado
                  ? `Detectado: ${tipoDetectado === "comercial" ? "Comercial" : "Plantão"}${
                      fromClosure && closureAttendance?.opened_at
                        ? ` (atendimento aberto ${formatSpShort(closureAttendance.opened_at)})`
                        : " (agora)"
                    }`
                  : "Detectando..."}
              </span>
            )}
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
                  {!fromClosure && (
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
                  )}
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

            {fromClosure && ((closureAiTopics?.length ?? 0) > 0 || closureSentimentLabel || closureAiSummary || closureAiProblem) && (
              <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Bot className="h-3.5 w-3.5" />
                  Contexto IA do atendimento
                </div>
                {closureAiTopics && closureAiTopics.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tópicos</p>
                    <div className="flex flex-wrap gap-1">
                      {closureAiTopics.map((topic, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-[10px] bg-background border border-border">{topic}</span>
                      ))}
                    </div>
                  </div>
                )}
                {closureSentimentLabel && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Sentimento:</span>
                    <span className={
                      closureSentimentLabel === 'negative' ? 'text-red-400' :
                      closureSentimentLabel === 'positive' ? 'text-green-400' :
                      'text-muted-foreground'
                    }>
                      {closureSentimentLabel === 'negative' ? 'Negativo' : closureSentimentLabel === 'positive' ? 'Positivo' : 'Neutro'}
                    </span>
                  </div>
                )}
                {(closureSentimentSummary || closureAiSummary) && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Resumo</p>
                    <p className="text-xs text-muted-foreground italic">{closureSentimentSummary || closureAiSummary}</p>
                  </div>
                )}
                {closureAiProblem && (
                  <div className="space-y-1">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Problema</p>
                    <p className="text-xs text-muted-foreground">{closureAiProblem}</p>
                  </div>
                )}
              </div>
            )}

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

            {tipoHorario === "plantao" && (
              <div className="space-y-2 p-3 rounded-md border border-amber-500/30 bg-amber-500/5">
                <p className="text-xs font-medium text-amber-600 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Horários de Plantão
                </p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Início</Label>
                    <Input
                      type="datetime-local"
                      className="h-8 text-xs"
                      value={horarioInicio}
                      onChange={(e) => setHorarioInicio(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">Vazio = agora</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fim</Label>
                    <Input
                      type="datetime-local"
                      className="h-8 text-xs"
                      value={horarioFim}
                      onChange={(e) => setHorarioFim(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">Vazio = aberto</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Duração</Label>
                    <p className="text-sm h-8 flex items-center font-semibold text-amber-700">
                      {horarioInicio && horarioFim
                        ? (() => {
                            const diff = Math.round((new Date(horarioFim).getTime() - new Date(horarioInicio).getTime()) / 60000);
                            return diff > 0 ? `${Math.floor(diff / 60)}h ${diff % 60}min` : "—";
                          })()
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>
            )}

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
                rows={8}
                className="text-xs min-h-[180px] resize-y"
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
                <span className="text-[10px] uppercase tracking-wide">
                  {fromClosure && closureAttendance?.opened_at ? "Atendimento aberto em" : "Aberto em"}
                </span>
              </div>
              <p className="text-xs pl-5">
                {fromClosure && closureAttendance?.opened_at
                  ? formatSpDateTime(closureAttendance.opened_at)
                  : new Date().toLocaleString("pt-BR", {
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
              <p className="text-xs pl-5">
                {fromClosure && closureHandleSeconds
                  ? closureHandleSeconds >= 3600
                    ? `${Math.floor(closureHandleSeconds / 3600)}h ${Math.floor((closureHandleSeconds % 3600) / 60)}min`
                    : closureHandleSeconds >= 60
                      ? `${Math.floor(closureHandleSeconds / 60)} min`
                      : `${closureHandleSeconds}s`
                  : "0 min"}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t">
          <Button variant="ghost" onClick={requestClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => handleSubmit("close")}
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {submitMode === "close" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowLeft className="h-4 w-4" />
              )}
              Criar e fechar
              <HelpBadge text="Cria o ticket e volta para a lista." />
            </Button>
            <Button
              onClick={() => handleSubmit("continue")}
              disabled={isSubmitting}
              className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
            >
              {submitMode === "continue" && <Loader2 className="h-4 w-4 animate-spin" />}
              Criar e continuar
              {submitMode !== "continue" && <ArrowRight className="h-4 w-4" />}
              <HelpBadge text="Cria o ticket e permanece na tela para continuar o preenchimento (anexo, ocorrências, etc.)." />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <SupportTicketDetailDialog
      ticketId={continueTicketId}
      open={!!continueTicketId}
      onOpenChange={(o) => { if (!o) setContinueTicketId(null); }}
    />

    {pendingContinueTicketId && (
      <Dialog open={!!pendingContinueTicketId} onOpenChange={(o) => { if (!o) setPendingContinueTicketId(null); }}>
        <DialogContent className="max-w-sm">
          <div className="space-y-3">
            <h3 className="text-base font-semibold">Ticket criado</h3>
            <p className="text-sm text-muted-foreground">
              O ticket foi criado com sucesso, mas não foi possível abrir a tela dele automaticamente. Você pode abri-lo agora.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setPendingContinueTicketId(null)}>Fechar</Button>
              <Button size="sm" onClick={() => { const id = pendingContinueTicketId; setPendingContinueTicketId(null); setContinueTicketId(id); }}>
                Abrir ticket
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    )}

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
