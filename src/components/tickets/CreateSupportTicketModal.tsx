import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Ticket } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { toast } from "sonner";
import { useClienteSearch, type ClienteSearchResult } from "@/components/whatsapp/hooks/useClienteSearch";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const Req = () => <span className="text-destructive">*</span>;

export function CreateSupportTicketModal({ open, onOpenChange, onCreated }: Props) {
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
  const [statusId, setStatusId] = useState<string>("");
  const [agendadoPara, setAgendadoPara] = useState<string>("");
  const [observacaoAgente, setObservacaoAgente] = useState<string>("");
  const [departamentoId, setDepartamentoId] = useState("");
  const [responsavelId, setResponsavelId] = useState("");
  const [clienteContatoId, setClienteContatoId] = useState("");
  const [previsaoEncerramento, setPrevisaoEncerramento] = useState("");
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
    setStatusId("");
    setAgendadoPara("");
    setObservacaoAgente("");
    setDepartamentoId("");
    setResponsavelId("");
    setClienteContatoId("");
    setPrevisaoEncerramento("");
  };

  useEffect(() => {
    if (open) reset();
  }, [open]);

  useEffect(() => {
    if (open && !responsavelId) {
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
        .select("id, nome, produto_id")
        .eq("tenant_id", tid)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; nome: string; produto_id: number | null }>;
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
        .order("name");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

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

  const { data: clienteContatos = [] } = useQuery({
    queryKey: ["cliente_contatos_ticket", selectedCliente?.id],
    enabled: !!selectedCliente?.id,
    queryFn: async () => {
      const { data: cli } = await (supabase.from("clientes" as any) as any)
        .select("contato_nome, contato_fone")
        .eq("id", selectedCliente!.id)
        .maybeSingle();
      const { data: contatos, error } = await (supabase.from("cliente_contatos" as any) as any)
        .select("id, nome, fone, email, cargo")
        .eq("cliente_id", selectedCliente!.id)
        .order("nome");
      if (error) throw error;
      const result: Array<{ id: string; nome: string; fone: string | null; email: string | null; cargo: string | null; isPrincipal: boolean }> = [];
      if (cli?.contato_nome) {
        result.push({
          id: "principal",
          nome: cli.contato_nome,
          fone: cli.contato_fone ?? null,
          email: null,
          cargo: "Contato principal",
          isPrincipal: true,
        });
      }
      (contatos ?? []).forEach((c: any) => {
        result.push({
          id: c.id,
          nome: c.nome,
          fone: c.fone ?? null,
          email: c.email ?? null,
          cargo: c.cargo ?? null,
          isPrincipal: false,
        });
      });
      return result;
    },
  });

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
      const terminal = ticketStatuses.find((s) => s.is_terminal);
      if (terminal) setStatusId(terminal.id);
      else setStatusId(ticketStatuses[0].id);
    } else {
      setStatusId("");
    }
  }, [ticketStatuses]);

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
      const { error } = await (supabase.rpc as any)("create_manual_ticket", {
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
        p_cliente_contato_id: clienteContatoId && clienteContatoId !== "principal" ? clienteContatoId : null,
        p_previsao_encerramento: previsaoEncerramento ? new Date(previsaoEncerramento).toISOString() : null,
      });

      if (error) throw error;

      toast.success("Ticket criado com sucesso");
      onCreated?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Erro ao criar ticket: " + (err?.message || "desconhecido"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Ticket className="h-5 w-5 text-primary" />
            Novo ticket manual
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Cliente */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Cliente <Req /></Label>
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
                  className="h-10"
                  autoFocus
                />
                {isSearchingClientes && (
                  <div className="absolute right-3 top-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {clienteResults.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border border-input bg-popover">
                    {clienteResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                        onClick={() => {
                          setSelectedCliente(c);
                          setClienteSearchTerm("");
                          setClienteContatoId("");
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
          </div>

          {/* Produto */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Produto <Req /></Label>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {produtos.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Categoria + Subcategoria */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Categoria <Req /></Label>
              <Select value={categoryId} onValueChange={setCategoryId} disabled={!produtoId}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {filteredCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Subcategoria <Req /></Label>
              <Select value={subcategoryId} onValueChange={setSubcategoryId} disabled={!categoryId}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {filteredSubcategories.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tipo de serviço */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Tipo de serviço <Req /></Label>
            <Select value={serviceTypeId} onValueChange={setServiceTypeId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {serviceTypes.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Contato + Previsão */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Contato do cliente</Label>
              <Select value={clienteContatoId} onValueChange={setClienteContatoId} disabled={!selectedCliente}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder={selectedCliente ? "Selecione o contato..." : "Selecione um cliente primeiro"} />
                </SelectTrigger>
                <SelectContent>
                  {clienteContatos.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <span>{c.nome}</span>
                        {c.isPrincipal && <span className="text-[10px] text-primary font-medium">Principal</span>}
                        {c.cargo && !c.isPrincipal && <span className="text-[10px] text-muted-foreground">({c.cargo})</span>}
                      </div>
                    </SelectItem>
                  ))}
                  {clienteContatos.length === 0 && selectedCliente && (
                    <div className="p-2 text-xs text-muted-foreground text-center">Nenhum contato cadastrado</div>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Previsão de encerramento</Label>
              <Input
                type="datetime-local"
                value={previsaoEncerramento}
                onChange={(e) => setPrevisaoEncerramento(e.target.value)}
                className="h-10"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Setor</Label>
              <Select value={departamentoId} onValueChange={setDepartamentoId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Selecione o setor..." />
                </SelectTrigger>
                <SelectContent>
                  {departamentos.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Responsável <Req /></Label>
              <Select value={responsavelId} onValueChange={setResponsavelId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {agentes.map((a) => (
                    <SelectItem key={a.user_id} value={a.user_id}>{a.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Canal de origem <Req /></Label>
              <Select value={canalOrigem} onValueChange={setCanalOrigem}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="telefone">Telefone</SelectItem>
                  <SelectItem value="presencial">Presencial</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Tipo de horário</Label>
              <Select value={tipoHorario} onValueChange={setTipoHorario}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="comercial">Comercial</SelectItem>
                  <SelectItem value="plantao">Plantão</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Status + Agendamento */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="concluido">Concluído</SelectItem>
                  <SelectItem value="aberto">Aberto</SelectItem>
                  <SelectItem value="agendado">Agendado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {status === "agendado" && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">Agendado para <Req /></Label>
                <Input
                  type="datetime-local"
                  className="h-10"
                  value={agendadoPara}
                  onChange={(e) => setAgendadoPara(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Observação */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Observação do agente</Label>
            <Textarea
              rows={4}
              value={observacaoAgente}
              onChange={(e) => setObservacaoAgente(e.target.value)}
              placeholder="Descreva o atendimento..."
              className="resize-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Criar ticket
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
