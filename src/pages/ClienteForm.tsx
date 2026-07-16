import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useLookups } from "@/hooks/useLookups";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { getNavIds } from "@/hooks/useClientesFilters";
import { useFormDraftPersistence } from "@/hooks/useFormDraftPersistence";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { Form } from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Building2, FileText, XCircle, ChevronLeft, ChevronRight, Eye, EyeOff, ShieldAlert, History, AlertTriangle, Pencil } from "lucide-react";
import EditarCancelamentoDialog from "@/components/clientes/EditarCancelamentoDialog";
import { MovimentosMrrModal } from "@/components/clientes/MovimentosMrrModal";
import DadosClienteTab from "@/components/clientes/DadosClienteTab";
import VendaProdutoTab from "@/components/clientes/VendaProdutoTab";
import FinanceiroTab from "@/components/clientes/FinanceiroTab";
import FinanceiroCard from "@/components/clientes/FinanceiroCard";
import FiliaisSection from "@/components/clientes/FiliaisSection";
import CertificadoA1Section from "@/components/clientes/CertificadoA1Section";
import ClienteProdutosSection from "@/components/clientes/ClienteProdutosSection";
import ClienteContratosSection from "@/components/clientes/ClienteContratosSection";
import IntegracaoOmieCard from "@/components/clientes/IntegracaoOmieCard";
import OmieIntegrationLogCard from "@/components/clientes/OmieIntegrationLogCard";
import { ClienteTicketsSection } from "@/components/cs/ClienteTicketsSection";
import { ClientAlertsManager } from "@/components/clientes/ClientAlertsManager";
import DeleteClienteDialog from "@/components/clientes/DeleteClienteDialog";
import { useAuth } from "@/contexts/AuthContext";
import { ProtectedElement } from "@/components/auth/ProtectedElement";
import { normalizeBRPhone, isValidBRPhone, formatBRPhone } from "@/lib/phoneBR";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import type { Database } from "@/integrations/supabase/types";

const noFutureDate = (fieldName: string) =>
  z.string().nullable().refine(
    (v) => {
      if (!v) return true;
      const d = new Date(v + "T00:00:00");
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return d <= today;
    },
    { message: `${fieldName} não pode ser uma data futura` }
  );

const clienteSchema = z.object({
  data_cadastro: noFutureDate("Data de Cadastro"),
  razao_social: z.string().nullable(),
  nome_fantasia: z.string().nullable(),
  cnpj: z.string().nullable().refine(v => {
    if (!v) return false;
    const digits = v.replace(/\D/g, "").length;
    return digits === 11 || digits >= 14;
  }, { message: "CNPJ ou CPF obrigatório" }),
  email: z.preprocess(
    (v) => (typeof v === "string" ? v.toLowerCase().trim() : v),
    z.string().min(1, "E-mail obrigatório").email("E-mail inválido")
  ),
  telefone_contato: z.string().nullable(),
  telefone_whatsapp: z.string().nullable().refine(v => {
    if (!v) return false;
    const normalized = normalizeBRPhone(v);
    return isValidBRPhone(normalized);
  }, { message: "WhatsApp inválido. Use formato: (DD) NNNNN-NNNN" }),
  telefone_whatsapp_contato: z.string().nullable().refine(v => {
    if (!v) return true; // not required
    const normalized = normalizeBRPhone(v);
    return isValidBRPhone(normalized);
  }, { message: "WhatsApp inválido. Use formato: (DD) NNNNN-NNNN" }),
  estado_id: z.number().nullable(),
  cidade_id: z.number().nullable(),
  area_atuacao_id: z.number().nullable(),
  segmento_id: z.number().nullable(),
  modelo_contrato_id: z.number().nullable(),
  observacao_cliente: z.string().nullable(),
  data_venda: noFutureDate("Data da Venda"),
  data_reajuste: z.string().nullable(),
  funcionario_id: z.number().nullable(),
  origem_venda_id: z.number().nullable(),
  recorrencia: z.enum(["mensal", "anual", "semestral", "semanal"]).nullable(),
  produto_id: z.number().nullable(),
  observacao_negociacao: z.string().nullable(),
  data_ativacao: noFutureDate("Data de Ativação"),
  fornecedor_id: z.number().nullable(),
  codigo_fornecedor: z.string().nullable(),
  link_portal_fornecedor: z.string().nullable(),
  valor_ativacao: z.number().nullable(),
  forma_pagamento_ativacao_id: z.number().nullable(),
  mensalidade: z.number().nullable(),
  forma_pagamento_mensalidade_id: z.number().nullable(),
  custo_operacao: z.number().nullable(),
  imposto_percentual: z.number().min(0).max(100).nullable(),
  custo_fixo_percentual: z.number().min(0).max(100).nullable(),
  cancelado: z.boolean(),
  data_cancelamento: noFutureDate("Data de Cancelamento"),
  motivo_cancelamento_id: z.number().nullable(),
  observacao_cancelamento: z.string().nullable(),
  cert_a1_vencimento: z.string().nullable(),
  cert_a1_ultima_venda_em: noFutureDate("Data Última Venda Cert. A1"),
  cert_a1_ultimo_vendedor_id: z.number().nullable(),
  contato_nome: z.string().nullable(),
  contato_cpf: z.string().nullable(),
  contato_fone: z.string().nullable(),
  contato_aniversario: z.string().nullable(),
  unidade_base_id: z.number({ invalid_type_error: "Selecione a unidade base" }).nullable().refine((v) => v != null, { message: "Selecione a unidade base" }),
  matriz_id: z.string().nullable(),
  cep: z.string().nullable(),
  endereco: z.string().nullable(),
  numero: z.string().nullable(),
  complemento: z.string().nullable(),
  bairro: z.string().nullable(),
  dia_vencimento_mrr: z.number().nullable(),
});

export type ClienteFormValues = z.infer<typeof clienteSchema>;

function ContratoEventosHistorico({ clienteId }: { clienteId: string }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.is_super_admin === true;
  const [editEvt, setEditEvt] = useState<any | null>(null);

  const eventosQuery = useQuery({
    queryKey: ["contrato_eventos_historico", tid, clienteId],
    queryFn: async () => {
      let q = (supabase.from("contrato_eventos" as any) as any)
        .select("id, acao, data_acao, observacao, mensalidade_contrato_snapshot, mensalidade_cliente_snapshot, contrato_id, created_at, motivo_cancelamento_id")
        .eq("cliente_id", clienteId)
        .order("data_acao", { ascending: false });

      if (tid) q = q.eq("tenant_id", tid);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!clienteId,
  });

  // Buscar números dos contratos
  const contratoIds = [...new Set((eventosQuery.data ?? []).map((e: any) => e.contrato_id).filter(Boolean))];

  const contratosQuery = useQuery({
    queryKey: ["contratos_numeros_evt", contratoIds.join(",")],
    queryFn: async () => {
      const { data } = await (supabase.from("contratos" as any) as any)
        .select("id, numero")
        .in("id", contratoIds);

      const map: Record<string, string> = {};
      (data ?? []).forEach((c: any) => { map[c.id] = c.numero; });
      return map;
    },
    enabled: contratoIds.length > 0,
  });

  const eventos = eventosQuery.data ?? [];
  if (eventos.length === 0) return null;

  const fmtDate = (d: string | null) => {
    if (!d) return "—";
    const [y, m, day] = d.split("T")[0].split("-");
    return `${day}/${m}/${y}`;
  };

  const fmtBRL = (n: number | null | undefined) =>
    (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const contratoNumMap = contratosQuery.data ?? {};

  return (
    <div className="mt-4">
      <Separator className="mb-4" />
      <div className="flex items-center gap-2 mb-3">
        <History className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Histórico de Eventos</span>
        <Badge variant="secondary" className="text-[10px]">{eventos.length}</Badge>
      </div>
      <div className="space-y-2">
        {eventos.map((evt: any) => {
          const isCancelamento = evt.acao === "cancelamento";
          return (
            <div
              key={evt.id}
              className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
                isCancelamento
                  ? "border-destructive/30 bg-destructive/5"
                  : "border-emerald-500/30 bg-emerald-500/5"
              }`}
            >
              <div className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
                isCancelamento ? "bg-destructive" : "bg-emerald-500"
              }`} />
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant={isCancelamento ? "destructive" : "default"}
                    className={!isCancelamento ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                  >
                    {isCancelamento ? "Cancelamento" : "Reativação"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{fmtDate(evt.data_acao)}</span>
                  {evt.contrato_id && contratoNumMap[evt.contrato_id] && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {contratoNumMap[evt.contrato_id]}
                    </span>
                  )}
                  {isCancelamento && isAdmin && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 ml-auto"
                      onClick={() => setEditEvt(evt)}
                    >
                      <Pencil className="h-3 w-3" />
                      <span className="text-xs">Editar</span>
                    </Button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  MRR Contrato: R$ {fmtBRL(Number(evt.mensalidade_contrato_snapshot))}
                  {evt.mensalidade_cliente_snapshot != null && (
                    <span className="ml-3">MRR Cliente: R$ {fmtBRL(Number(evt.mensalidade_cliente_snapshot))}</span>
                  )}
                </div>
                {evt.observacao && (
                  <p className="text-xs text-muted-foreground/80 truncate" title={evt.observacao}>
                    {evt.observacao}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <EditarCancelamentoDialog
        open={!!editEvt}
        onOpenChange={(o) => !o && setEditEvt(null)}
        evento={editEvt}
        clienteId={clienteId}
      />
    </div>
  );
}

export default function ClienteForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!id;
  const [mrrModalOpen, setMrrModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq('tenant_id', tid) : q;
  const { selectedUnidadeId } = useUnidadeFilter();


  // Navigation between records
  const navInfo = useMemo(() => {
    if (!id) return null;
    const ids = getNavIds();
    if (!ids.length) return null;
    const idx = ids.indexOf(id);
    if (idx === -1) return null;
    return {
      currentIndex: idx,
      total: ids.length,
      prevId: idx > 0 ? ids[idx - 1] : null,
      nextId: idx < ids.length - 1 ? ids[idx + 1] : null,
    };
  }, [id]);

  const form = useForm<ClienteFormValues>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      data_cadastro: new Date().toISOString().split("T")[0],
      razao_social: null, nome_fantasia: null, cnpj: null, email: "",
      telefone_contato: null, telefone_whatsapp: null, telefone_whatsapp_contato: null, estado_id: null, cidade_id: null,
      area_atuacao_id: null, segmento_id: null, modelo_contrato_id: null, observacao_cliente: null,
      data_venda: null, data_reajuste: null, funcionario_id: null, origem_venda_id: null, recorrencia: null,
      produto_id: null, observacao_negociacao: null,
      data_ativacao: null, fornecedor_id: null, codigo_fornecedor: null, link_portal_fornecedor: null,
      valor_ativacao: null as any,
      forma_pagamento_ativacao_id: null, mensalidade: null as any, forma_pagamento_mensalidade_id: null,
      custo_operacao: null as any, imposto_percentual: null, custo_fixo_percentual: null,
      cancelado: false, data_cancelamento: null, motivo_cancelamento_id: null, observacao_cancelamento: null,
      cert_a1_vencimento: null, cert_a1_ultima_venda_em: null, cert_a1_ultimo_vendedor_id: null,
      contato_nome: null, contato_cpf: null, contato_fone: null, contato_aniversario: null,
      unidade_base_id: isEditing ? null : (selectedUnidadeId ?? null),
      matriz_id: null,
      cep: null, endereco: null, numero: null, complemento: null, bairro: null,
      dia_vencimento_mrr: null,
    },
  });

  const estadoId = form.watch("estado_id");
  const cancelado = form.watch("cancelado");
  const [forceShowContracts, setForceShowContracts] = useState(false);

  const { data: hasNonImplicitContracts } = useQuery({
    queryKey: ["has_non_implicit_contratos", tid, id],
    enabled: isEditing && !!id,
    staleTime: 0,
    queryFn: async () => {
      let q = (supabase.from("contratos" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", id!)
        .eq("is_implicit", false);
      if (tid) q = q.eq("tenant_id", tid);
      const { count, error } = await q;
      if (error) return false;
      return (count ?? 0) > 0;
    },
  });
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'head' || profile?.is_super_admin;
  const canDelete = profile?.role === 'admin' || profile?.is_super_admin;
  const lookups = useLookups(estadoId);

  // Draft persistence
  const { draftStatus, hasPendingDraft, restoreDraft, dismissDraft, clearDraft } = useFormDraftPersistence(form, {
    keyParts: ["cliente", id || "new"],
  });

  // Unsaved changes guard
  const isDirty = form.formState.isDirty;
  const { isBlocked, confirmLeave, cancelLeave, guardedNavigate } = useUnsavedChangesGuard(isDirty);

  // Fetch MC% ponderada for auto-filling custo_operacao on new clients
  const mcPonderadaQuery = useQuery({
    queryKey: ["mc-ponderada-global"],
    queryFn: async () => {
      const { data, error } = await tf(supabase
        .from("vw_clientes_financeiro")
        .select("mensalidade, custo_operacao, cancelado"));
      if (error) throw error;
      const ativos = (data ?? []).filter(c => !c.cancelado);
      let receita = 0, cogs = 0;
      ativos.forEach(c => {
        const m = Number(c.mensalidade) || 0;
        receita += m;
        cogs += Number(c.custo_operacao) || 0;
      });
      const mc = receita - cogs;
      return receita > 0 ? mc / receita : 0;
    },
    enabled: !isEditing,
    staleTime: 10 * 60 * 1000,
  });

  // Load config defaults for new clients
  useEffect(() => {
    if (!isEditing && lookups.configuracoes.data) {
      const cfg = lookups.configuracoes.data;
      if (form.getValues("imposto_percentual") === null || form.getValues("imposto_percentual") === undefined) {
        form.setValue("imposto_percentual", Number(cfg.imposto_percentual) * 100, { shouldDirty: false });
      }
      if (form.getValues("custo_fixo_percentual") === null || form.getValues("custo_fixo_percentual") === undefined) {
        form.setValue("custo_fixo_percentual", Number(cfg.custo_fixo_percentual) * 100, { shouldDirty: false });
      }
    }
  }, [isEditing, lookups.configuracoes.data]);

  // Auto-fill custo_operacao based on MC% ponderada when mensalidade changes (new client only)
  const mensalidadeWatch = form.watch("mensalidade");
  useEffect(() => {
    if (isEditing) return;
    const mcPct = mcPonderadaQuery.data;
    if (mcPct === undefined || mcPct === null) return;
    const m = mensalidadeWatch ?? 0;
    if (m <= 0) return;
    const suggestedCogs = Math.max(0, Math.round(m * (1 - mcPct) * 100) / 100);
    const current = form.getValues("custo_operacao");
    if (current === null || current === undefined || current === 0) {
      form.setValue("custo_operacao", suggestedCogs, { shouldDirty: false });
    }
  }, [isEditing, mensalidadeWatch, mcPonderadaQuery.data]);

  // Load existing client for editing
  const clienteLoadedRef = useRef(false);

  // Reset loaded ref when id changes (navigating between clients)
  useEffect(() => {
    clienteLoadedRef.current = false;
  }, [id]);

  const clienteQuery = useQuery({
    queryKey: ["cliente", id],
    queryFn: async () => {
      const { data, error } = await tf(supabase.from("clientes").select("*").eq("id", id!)).single();
      if (error) throw error;
      return data;
    },
    enabled: isEditing,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!clienteQuery.data || clienteLoadedRef.current) return;
    clienteLoadedRef.current = true;
    const c = clienteQuery.data;
    form.reset({
      data_cadastro: c.data_cadastro, razao_social: c.razao_social, nome_fantasia: c.nome_fantasia,
      cnpj: c.cnpj ? (c.cnpj.replace(/\D/g, "").length === 11 ? maskCPF(c.cnpj) : maskCNPJ(c.cnpj)) : null, email: c.email ?? "",
      telefone_contato: c.telefone_contato ? formatBRPhone(normalizeBRPhone(c.telefone_contato)) : null,
      telefone_whatsapp: c.telefone_whatsapp ? formatBRPhone(normalizeBRPhone(c.telefone_whatsapp)) : null,
      telefone_whatsapp_contato: (c as any).telefone_whatsapp_contato ? formatBRPhone(normalizeBRPhone((c as any).telefone_whatsapp_contato)) : (c.telefone_whatsapp ? formatBRPhone(normalizeBRPhone(c.telefone_whatsapp)) : null),
      estado_id: c.estado_id, cidade_id: c.cidade_id,
      area_atuacao_id: c.area_atuacao_id, segmento_id: c.segmento_id, modelo_contrato_id: (c as any).modelo_contrato_id,
      observacao_cliente: c.observacao_cliente, data_venda: c.data_venda, data_reajuste: (c as any).data_reajuste ?? null,
      funcionario_id: c.funcionario_id, origem_venda_id: (c as any).origem_venda_id ?? null,
      recorrencia: c.recorrencia as any, produto_id: c.produto_id,
      observacao_negociacao: c.observacao_negociacao,
      data_ativacao: (c as any).data_ativacao ?? null,
      fornecedor_id: (c as any).fornecedor_id ?? null,
      codigo_fornecedor: (c as any).codigo_fornecedor ?? null,
      link_portal_fornecedor: (c as any).link_portal_fornecedor ?? null,
      valor_ativacao: c.valor_ativacao ? Number(c.valor_ativacao) : (null as any),
      forma_pagamento_ativacao_id: c.forma_pagamento_ativacao_id,
      mensalidade: c.mensalidade ? Number(c.mensalidade) : (null as any),
      forma_pagamento_mensalidade_id: c.forma_pagamento_mensalidade_id,
      custo_operacao: c.custo_operacao ? Number(c.custo_operacao) : (null as any),
      imposto_percentual: c.imposto_percentual ? Number(c.imposto_percentual) * 100 : (null as any),
      custo_fixo_percentual: c.custo_fixo_percentual ? Number(c.custo_fixo_percentual) * 100 : (null as any),
      cancelado: c.cancelado, data_cancelamento: c.data_cancelamento,
      motivo_cancelamento_id: c.motivo_cancelamento_id,
      observacao_cancelamento: c.observacao_cancelamento,
      cert_a1_vencimento: (c as any).cert_a1_vencimento ?? null,
      cert_a1_ultima_venda_em: (c as any).cert_a1_ultima_venda_em ?? null,
      cert_a1_ultimo_vendedor_id: (c as any).cert_a1_ultimo_vendedor_id ?? null,
      contato_nome: (c as any).contato_nome ?? null,
      contato_cpf: (c as any).contato_cpf ?? null,
      contato_fone: (c as any).contato_fone ? formatBRPhone(normalizeBRPhone((c as any).contato_fone)) : null,
      contato_aniversario: (c as any).contato_aniversario ?? null,
      unidade_base_id: (c as any).unidade_base_id ?? null,
      matriz_id: (c as any).matriz_id ?? null,
      cep: (c as any).cep ?? null,
      endereco: (c as any).endereco ?? null,
      numero: (c as any).numero ?? null,
      complemento: (c as any).complemento ?? null,
      bairro: (c as any).bairro ?? null,
      dia_vencimento_mrr: (c as any).dia_vencimento_mrr ?? null,
    });
    // Clear any stale draft after loading DB data — user hasn't edited yet
    clearDraft();
  }, [clienteQuery.data]);

  // Sync trigger-controlled fields (mensalidade + custo_operacao recalculados por DB triggers)
  useEffect(() => {
    if (!clienteQuery.data || !clienteLoadedRef.current) return;
    const dbMensalidade = Number(clienteQuery.data.mensalidade) || 0;
    const dbCusto = Number(clienteQuery.data.custo_operacao) || 0;
    const currentMensalidade = form.getValues("mensalidade");
    const currentCusto = form.getValues("custo_operacao");
    if (dbMensalidade !== currentMensalidade) {
      form.setValue("mensalidade", dbMensalidade, { shouldDirty: false });
    }
    if (dbCusto !== currentCusto) {
      form.setValue("custo_operacao", dbCusto, { shouldDirty: false });
    }
  }, [clienteQuery.data?.mensalidade, clienteQuery.data?.custo_operacao]);

  const mutation = useMutation({
    mutationFn: async (values: ClienteFormValues) => {
      const payload: any = {
        ...values,
        email: values.email?.trim().toLowerCase() || null,
        telefone_whatsapp: values.telefone_whatsapp ? normalizeBRPhone(values.telefone_whatsapp) : null,
        telefone_whatsapp_contato: values.telefone_whatsapp_contato ? normalizeBRPhone(values.telefone_whatsapp_contato) : null,
        telefone_contato: values.telefone_contato ? normalizeBRPhone(values.telefone_contato) : null,
        contato_fone: values.contato_fone ? normalizeBRPhone(values.contato_fone) : null,
        imposto_percentual: values.imposto_percentual != null ? values.imposto_percentual / 100 : null,
        custo_fixo_percentual: values.custo_fixo_percentual != null ? values.custo_fixo_percentual / 100 : null,
      };

      if (isEditing) {
        // Whitelist explícito das colunas atualmente existentes na tabela `clientes`.
        // Campos derivados (cancelado, mensalidade, custo_operacao) são gerenciados por RPCs/triggers.
        // Campos legados (codigo_fornecedor, link_portal_fornecedor, fornecedor_id, produto_id, etc.)
        // foram migrados para `cliente_produtos` e NÃO devem ir no UPDATE — a coluna nem existe mais.
        const ALLOWED_UPDATE_COLS = [
          "data_cadastro","razao_social","nome_fantasia","cnpj","email",
          "telefone_contato","telefone_whatsapp","telefone_whatsapp_contato",
          "estado_id","cidade_id","area_atuacao_id","segmento_id",
          "observacao_cliente","observacao_negociacao",
          "imposto_percentual","custo_fixo_percentual",
          "cert_a1_vencimento","cert_a1_ultima_venda_em","cert_a1_ultimo_vendedor_id",
          "contato_nome","contato_cpf","contato_fone","contato_aniversario",
          "unidade_base_id","matriz_id",
          "cep","endereco","numero","complemento","bairro",
          "dia_vencimento_mrr",
        ] as const;
        const updatePayload: Record<string, any> = {};
        for (const k of ALLOWED_UPDATE_COLS) {
          if (k in payload) updatePayload[k] = payload[k];
        }

        const { error } = await supabase.from("clientes").update(updatePayload as any).eq("id", id!);
        if (error) throw error;
      } else {

        if (profile?.is_super_admin && !tid) {
          throw new Error("Selecione um tenant no seletor antes de criar um cliente.");
        }
        // CRIAÇÃO: whitelist explícito. Campos legacy foram migrados para cliente_produtos.
        const ALLOWED_INSERT_COLS = [
          "data_cadastro","razao_social","nome_fantasia","cnpj","email",
          "telefone_contato","telefone_whatsapp","telefone_whatsapp_contato",
          "estado_id","cidade_id","area_atuacao_id","segmento_id",
          "observacao_cliente","observacao_negociacao",
          "imposto_percentual","custo_fixo_percentual",
          "cert_a1_vencimento","cert_a1_ultima_venda_em","cert_a1_ultimo_vendedor_id",
          "contato_nome","contato_cpf","contato_fone","contato_aniversario",
          "unidade_base_id","matriz_id",
          "cep","endereco","numero","complemento","bairro",
          "dia_vencimento_mrr",
        ] as const;
        const insertPayload: Record<string, any> = {};
        for (const k of ALLOWED_INSERT_COLS) {
          if (k in payload) insertPayload[k] = payload[k];
        }
        const { data, error } = await supabase.from("clientes").insert({ ...insertPayload, tenant_id: tid }).select("id").single();
        if (error) throw error;
        return (data as any)?.id as string;
      }
    },
    onSuccess: (newId) => {
      clienteLoadedRef.current = false;
      queryClient.invalidateQueries({ queryKey: ["clientes"] });
      queryClient.invalidateQueries({ queryKey: ["cliente", id] });
      clearDraft();
      toast({ title: isEditing ? "Cliente atualizado!" : "Cliente criado!", description: "Dados salvos com sucesso." });
      if (!isEditing && newId) navigate(`/clientes/${newId}`);
    },
    onError: (error) => {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (values: ClienteFormValues) => mutation.mutate(values);

  const onInvalid = (errors: any) => {
    const firstKey = Object.keys(errors)[0];
    const msg = errors[firstKey]?.message || "Verifique os campos obrigatórios";
    toast({ title: "Erro de validação", description: `Campo "${firstKey}": ${msg}`, variant: "destructive" });
  };

  // Enter key moves to next field instead of submitting the form
  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter") {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();
      if (tagName === "textarea" || tagName === "button") return;
      e.preventDefault();
      const formEl = e.currentTarget;
      const focusable = Array.from(
        formEl.querySelectorAll<HTMLElement>(
          'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        )
      );
      const idx = focusable.indexOf(target);
      if (idx >= 0 && idx < focusable.length - 1) {
        focusable[idx + 1].focus();
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Unsaved changes dialog */}
      <UnsavedChangesDialog open={isBlocked} onConfirm={confirmLeave} onCancel={cancelLeave} />

      {/* Draft restore banner */}
      {hasPendingDraft && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <span className="text-amber-700 dark:text-amber-400">Existe um rascunho não salvo deste formulário.</span>
          <Button type="button" variant="outline" size="sm" onClick={restoreDraft}>Restaurar rascunho</Button>
          <Button type="button" variant="ghost" size="sm" onClick={dismissDraft}>Descartar</Button>
        </div>
      )}

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => guardedNavigate("/clientes")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{isEditing ? "Editar Cliente" : "Novo Cliente"}</h1>
            <p className="text-sm text-muted-foreground">
              Preencha os dados do cliente e contrato
            </p>
            
          </div>

          {/* Prev/Next navigation */}
          {isEditing && navInfo && (
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={!navInfo.prevId}
                onClick={() => navInfo.prevId && navigate(`/clientes/${navInfo.prevId}`)}
                title="Cliente anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-muted-foreground px-2 whitespace-nowrap">
                {navInfo.currentIndex + 1} / {navInfo.total}
              </span>
              <Button
                variant="outline"
                size="icon"
                disabled={!navInfo.nextId}
                onClick={() => navInfo.nextId && navigate(`/clientes/${navInfo.nextId}`)}
                title="Próximo cliente"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {isEditing && clienteQuery.data && (clienteQuery.data as any).setup_completo === false && (
        <div className="flex items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="flex-1">
            Adicione ao menos 1 produto e 1 contrato pra finalizar o cadastro deste cliente.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              document.getElementById("cliente-produtos-section")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            Ir para Produtos
          </Button>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} onKeyDown={handleFormKeyDown} className="space-y-6">
          {/* Card: Dados Cadastrais */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Building2 className="h-5 w-5 text-primary" />
                Dados Cadastrais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DadosClienteTab
                form={form}
                estados={lookups.estados.data ?? []}
                cidades={lookups.cidades.data ?? []}
                areasAtuacao={lookups.areasAtuacao.data ?? []}
                segmentos={lookups.segmentos.data ?? []}
                unidadesBase={lookups.unidadesBase.data ?? []}
                clienteId={id}
                codigoSequencial={(clienteQuery.data as any)?.codigo_sequencial ?? null}
                onNavigate={guardedNavigate}
              />
            </CardContent>
          </Card>

          {isEditing && id && (
            <div id="cliente-produtos-section">
              <ClienteProdutosSection clienteId={id} />
            </div>
          )}

          {isEditing && id && (hasNonImplicitContracts || forceShowContracts) && (
            <ClienteContratosSection clienteId={id} />
          )}

          {isEditing && id && <IntegracaoOmieCard clienteId={id} />}

          {isEditing && id && <OmieIntegrationLogCard clienteId={id} />}


          {isEditing && id && !hasNonImplicitContracts && !forceShowContracts && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForceShowContracts(true)}
                className="text-xs text-muted-foreground"
              >
                <FileText className="h-3 w-3 mr-1" />
                Ver detalhes contratuais (avançado)
              </Button>
            </div>
          )}

          {isEditing && id && (
            <FinanceiroCard
              form={form}
              clienteId={id}
              isEditing={isEditing}
              onOpenMrrModal={() => setMrrModalOpen(true)}
            />
          )}

          {isEditing && id && (
            <div className="space-y-2">
              <Separator />
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowLegacy(!showLegacy)}
                >
                  {showLegacy ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                  {showLegacy ? "Ocultar cards legados" : "Mostrar cards legados"}
                </Button>
              </div>
            </div>
          )}

          {(isEditing && showLegacy) && (
            <>
              {/* Card: Produto / Contrato (legado) */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-1 pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FileText className="h-5 w-5 text-primary" />
                    Produto / Contrato
                    {isEditing && <Badge variant="outline" className="ml-2 text-[10px]">Legado</Badge>}
                  </CardTitle>
                  {isEditing && (
                    <CardDescription className="text-xs text-muted-foreground">
                      Apenas visualização. Os dados oficiais são gerenciados nas seções "Produtos" e "Contratos" acima.
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="space-y-0">
                  <fieldset disabled={isEditing} className="m-0 p-0 border-0 min-w-1 space-y-6">
                    <VendaProdutoTab
                      form={form}
                      funcionarios={lookups.funcionarios.data ?? []}
                      produtos={lookups.produtos.data ?? []}
                      fornecedores={lookups.fornecedores?.data ?? []}
                      origensVenda={lookups.origensVenda?.data ?? []}
                      modelosContrato={lookups.modelosContrato.data ?? []}
                    />
                    <ProtectedElement resource="clientes.custos" action="view" mode="hide">
                      <FinanceiroTab
                        form={form}
                        formasPagamento={lookups.formasPagamento.data ?? []}
                        clienteId={id}
                        isEditing={isEditing}
                        onOpenMrrModal={() => setMrrModalOpen(true)}
                      />
                    </ProtectedElement>
                  </fieldset>
                </CardContent>
              </Card>
            </>
          )}

          {/* Card: Certificado A1 */}
          <CertificadoA1Section
            clienteId={id}
            vencimento={form.watch("cert_a1_vencimento") ?? null}
            ultimaVendaEm={form.watch("cert_a1_ultima_venda_em") ?? null}
            ultimoVendedorId={form.watch("cert_a1_ultimo_vendedor_id") ?? null}
            onVencimentoChange={(v) => form.setValue("cert_a1_vencimento", v)}
            onVendaRegistrada={async () => {
              if (!id) return;
              const { data } = await tf(supabase.from("clientes").select("cert_a1_vencimento, cert_a1_ultima_venda_em, cert_a1_ultimo_vendedor_id").eq("id", id)).single();
              if (data) {
                form.setValue("cert_a1_vencimento", (data as any).cert_a1_vencimento ?? null);
                form.setValue("cert_a1_ultima_venda_em", (data as any).cert_a1_ultima_venda_em ?? null);
                form.setValue("cert_a1_ultimo_vendedor_id", (data as any).cert_a1_ultimo_vendedor_id ?? null);
              }
            }}
            funcionarios={lookups.funcionarios.data ?? []}
          />

          {/* Tickets CS (apenas em edição) */}
          {isEditing && id && (
            <ClienteTicketsSection
              clienteId={id}
              clienteNome={form.watch("razao_social") || form.watch("nome_fantasia") || ""}
            />
          )}

          {/* Avisos e Bloqueios (apenas em edição) */}
          {isEditing && id && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldAlert className="h-5 w-5 text-primary" />
                  Avisos e Bloqueios
                </CardTitle>
                <CardDescription>
                  Exibidos ao time ao abrir o atendimento. Valem para todos os contatos de WhatsApp vinculados a este cliente.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ClientAlertsManager clienteId={id} canManage={isAdmin} />
              </CardContent>
            </Card>
          )}

          {/* Filiais vinculadas (apenas em edição) */}
          {isEditing && id && <FiliaisSection clienteId={id} />}

          {/* Card: Cancelamento (read-only — derivado dos contratos) */}
          {isEditing && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <XCircle className="h-5 w-5 text-destructive" />
                  Cancelamento
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cancelado ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive">Cancelado</Badge>
                      <span className="text-sm text-muted-foreground">
                        {form.watch("data_cancelamento") && (
                          <span>
                            desde {(() => {
                              const d = form.watch("data_cancelamento");
                              if (!d) return "—";
                              const [y, m, day] = d.split("-");
                              return `${day}/${m}/${y}`;
                            })()}
                          </span>
                        )}
                      </span>
                    </div>
                    {form.watch("observacao_cancelamento") && (
                      <p className="text-sm text-muted-foreground">
                        {form.watch("observacao_cancelamento")}
                      </p>
                    )}
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
                      <p className="text-xs text-muted-foreground">
                        Para reativar o cliente, reative pelo menos um contrato na seção de Contratos acima.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Cliente ativo. O cancelamento é gerenciado individualmente por contrato na seção de Contratos acima.
                  </p>
                )}
                {/* Histórico de Cancelamentos/Reativações */}

                <ContratoEventosHistorico clienteId={id!} />

              </CardContent>
            </Card>
          )}

          {isEditing && id && canDelete && (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-base text-destructive flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Zona de Perigo
                </CardTitle>
                <CardDescription>
                  Exclusão é irreversível. Você poderá transferir vínculos para outro cliente ou apagar tudo.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)}>
                  Excluir cliente
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Botões de ação */}
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => guardedNavigate("/clientes")}>
              Cancelar
            </Button>
            <ProtectedElement resource="clientes" action={isEditing ? "update" : "insert"} mode="notify">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar Cliente
              </Button>
            </ProtectedElement>
          </div>
        </form>
      </Form>

      {isEditing && id && (
        <MovimentosMrrModal
          open={mrrModalOpen}
          onOpenChange={setMrrModalOpen}
          clienteId={id}
          tenantId={tid}
          clienteNome={form.watch("razao_social") || form.watch("nome_fantasia") || ""}
          mensalidadeBase={form.watch("mensalidade") ?? 0}
          custoBase={form.watch("custo_operacao") ?? 0}
          funcionarios={(lookups.funcionarios.data ?? []).map((f: any) => ({ id: f.id, nome: f.nome }))}
        />
      )}

      {isEditing && id && canDelete && (
        <DeleteClienteDialog
          clienteId={id}
          clienteNome={form.watch("razao_social") || form.watch("nome_fantasia") || ""}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}

    </div>
  );
}
