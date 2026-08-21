import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOmieContaDoCliente } from "@/hooks/useOmieContaDoCliente";
import { useOemIntegracaoAtiva } from "@/hooks/useOemIntegracaoAtiva";
import { toast } from "@/hooks/use-toast";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Package, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
  ExternalLink, Loader2, Puzzle, Percent, AlertTriangle, Paperclip, X, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { NumericInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

import SugestaoMRRDialog from "./SugestaoMRRDialog";
import ReajusteModulosDialog from "./ReajusteModulosDialog";
import EnviarOmieComPreviaButton from "./EnviarOmieComPreviaButton";
import HistoricoModulosProduto from "./HistoricoModulosProduto";
import ContratoAnexoSection, {
  type ContratoAnexo,
  ANEXO_ACCEPT,
  validateAnexoFile,
  uploadContratoAnexo,
} from "./ContratoAnexoSection";
import { isAdminLike } from "@/lib/permissions";
import { fetchAllRows } from "@/lib/supabasePaginate";

interface Props {
  clienteId: string;
}

interface MRRDialogState {
  open: boolean;
  tipo: "upsell" | "cross_sell" | "downsell";
  valorDelta: number;
  custoDelta: number;
  descricao: string;
  moduloId?: string | null;
  // Vendedor/origem/data vêm de quem originou o movimento (hoje: o módulo).
  // Sem isso o upsell de módulo entrava sem dono e sumia do relatório de venda.
  dataMovimento?: string | null;
  funcionarioId?: number | null;
  origemVenda?: string | null;
}

interface ClienteProduto {
  id: string;
  produto_id: number;
  fornecedor_id: number | null;
  codigo_fornecedor: string | null;
  link_portal_fornecedor: string | null;
  // Gravados pelo vínculo em Integrações › OEM, nunca à mão: são a identidade
  // da licença lá, e é por eles que a conferência sabe qual filial é esta.
  oem_codigo_grupo: string | null;
  oem_codigo_filial: string | null;
  vlr_ativacao: number | null;
  vlr_mensal: number | null;
  vlr_custo: number | null;
  data_ativacao: string | null;
  data_venda?: string | null;
  funcionario_id?: number | null;
  origem_venda_id?: number | null;
  ativo: boolean;
  produtos?: { nome: string } | null;
  fornecedores?: { nome: string } | null;
}

interface ClienteProdutoModulo {
  id: string;
  cliente_produto_id: string;
  modulo_id: string;
  quantidade: number | null;
  vlr_ativacao: number | null;
  vlr_mensal: number | null;
  vlr_custo: number | null;
  // Custo TOTAL da linha como o parceiro cobra. O OEM dá unidade grátis e
  // crédito (2 totens por R$ 25,00; 1 PDV por R$ 0,00), então multiplicar o
  // unitário pela quantidade inventa um número que ele nunca cobrou.
  vlr_custo_total?: number | null;
  data_ativacao: string | null;
  data_inativacao: string | null;
  // A venda do módulo tem dono próprio: módulo somado meses depois costuma ser
  // de outro vendedor/canal que o produto original.
  data_venda?: string | null;
  funcionario_id?: number | null;
  origem_venda_id?: number | null;
  ativo: boolean;
  // 'oem' = espelhado da licença no OEM e mantido pela sincronização; 'manual'
  // = digitado aqui. A linha do OEM não se edita: a próxima carga do espelho
  // sobrescreveria, e trabalho que some sozinho é pior que trabalho barrado.
  origem?: string | null;
  produto_modulos?: { nome: string; descricao: string | null } | null;
}

const fmtBRL = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Mesma normalização de public.fn_norm_nome_modulo: é por ela que o módulo do
// catálogo casa com a linha da grade do OEM. Divergir daqui faria a tela achar
// um preço que o banco não acha (ou o contrário).
const normNomeModulo = (nome: string | null | undefined) =>
  (nome ?? "")
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

// Markup = quanto o preço de venda é do custo. Sem custo não existe markup —
// mostrar "0" ou "∞" aqui daria a impressão de uma margem medida.
const fmtMarkup = (venda: number, custo: number) =>
  custo > 0 ? `${(venda / custo).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×` : "—";

// Custo da linha do módulo: o total do parceiro manda; sem ele, multiplica.
const custoLinhaModulo = (m: { vlr_custo?: number | null; vlr_custo_total?: number | null; quantidade?: number | null }) =>
  m.vlr_custo_total != null
    ? Number(m.vlr_custo_total) || 0
    : (Number(m.vlr_custo) || 0) * (Number(m.quantidade) || 1);

// Data de hoje no fuso local. `toISOString()` devolve UTC: das 21h em diante ele
// já entrega o dia seguinte, e a venda entraria com data errada.
const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function ClienteProdutosSection({ clienteId }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const oemAtivo = useOemIntegracaoAtiva();
  const qc = useQueryClient();

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [produtoDialog, setProdutoDialog] = useState<{ open: boolean; edit?: ClienteProduto | null }>({ open: false });
  const [moduloDialog, setModuloDialog] = useState<{
    open: boolean; clienteProdutoId?: string; produtoId?: number; edit?: ClienteProdutoModulo | null;
  }>({ open: false });
  const [confirmDelete, setConfirmDelete] = useState<ClienteProduto | null>(null);
  const [confirmDeleteModulo, setConfirmDeleteModulo] = useState<ClienteProdutoModulo | null>(null);
  // Cancelamento de módulo da licença: motivo é opcional e a quantidade só
  // aparece quando há mais de uma — perguntar "quantas?" para quem tem uma só
  // é passo a mais sem decisão nenhuma.
  const [cancelarModulo, setCancelarModulo] = useState<ClienteProdutoModulo | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [motivoModuloId, setMotivoModuloId] = useState<string>("");
  const [dataCancelModulo, setDataCancelModulo] = useState("");
  const [qtdCancelamento, setQtdCancelamento] = useState(1);
  const [cancelandoModulo, setCancelandoModulo] = useState(false);
  // Cancelar produto é o caminho certo para tirar produto do cliente: a RPC
  // cancel_cliente_produto desfaz o item de contrato (ou cancela o contrato
  // inteiro, se for o único item) e inativa o produto. A lixeira só serve para
  // produto órfão — sem item de contrato, que é o único caso em que o DELETE
  // passa pela FK.
  const [cancelarProduto, setCancelarProduto] = useState<ClienteProduto | null>(null);
  const [motivoProdutoId, setMotivoProdutoId] = useState<string>("");
  const [obsCancelProduto, setObsCancelProduto] = useState("");
  const [cancelandoProduto, setCancelandoProduto] = useState(false);
  // Somar unidade é a mesma escrita no OEM, ao contrário: a licença é gravada
  // inteira e o que muda é a quantidade do módulo.
  const [mrrDialog, setMrrDialog] = useState<MRRDialogState>({
    open: false, tipo: "upsell", valorDelta: 0, custoDelta: 0, descricao: "",
  });
  const [reajusteDialog, setReajusteDialog] = useState<{
    open: boolean; clienteProdutoId?: string; produtoNome?: string;
  }>({ open: false });

  if (!clienteId) return null;

  // ---- Queries ----
  const produtosQuery = useQuery<ClienteProduto[]>({
    queryKey: ["cliente_produtos", tid, clienteId],
    queryFn: async () => {
      let q = (supabase.from("cliente_produtos" as any) as any)
        .select("*, produtos:produto_id(nome), fornecedores:fornecedor_id(nome)")
        .eq("cliente_id", clienteId)
        .order("created_at");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ClienteProduto[];
    },
  });

  const produtoIds = useMemo(() => (produtosQuery.data ?? []).map(p => p.id), [produtosQuery.data]);

  const modulosQuery = useQuery<ClienteProdutoModulo[]>({
    queryKey: ["cliente_produto_modulos", tid, clienteId, produtoIds.join(",")],
    enabled: produtoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produto_modulos" as any) as any)
        .select("*, produto_modulos:modulo_id(nome, descricao)")
        .in("cliente_produto_id", produtoIds)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as ClienteProdutoModulo[];
    },
  });

  const modulosByProduto = useMemo(() => {
    const map: Record<string, ClienteProdutoModulo[]> = {};
    (modulosQuery.data ?? []).forEach(m => {
      (map[m.cliente_produto_id] ||= []).push(m);
    });
    return map;
  }, [modulosQuery.data]);

  // ---- Anexos de contrato ----
  const contratoItensQuery = useQuery<{ cliente_produto_id: string; contrato_id: string }[]>({
    queryKey: ["contrato_itens_cliente", tid, clienteId, produtoIds.join(",")],
    enabled: produtoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("contrato_itens" as any) as any)
        .select("cliente_produto_id, contrato_id")
        .in("cliente_produto_id", produtoIds);
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const contratoIdByCliProd = useMemo(() => {
    const map: Record<string, string> = {};
    (contratoItensQuery.data ?? []).forEach(r => {
      if (r.contrato_id && !map[r.cliente_produto_id]) {
        map[r.cliente_produto_id] = r.contrato_id;
      }
    });
    return map;
  }, [contratoItensQuery.data]);

  const contratoIds = useMemo(
    () => Array.from(new Set(Object.values(contratoIdByCliProd))),
    [contratoIdByCliProd],
  );

  const anexosQueryKey = useMemo(
    () => ["contrato_anexos_cliente", tid, clienteId, contratoIds.join(",")] as const,
    [tid, clienteId, contratoIds],
  );

  const anexosQuery = useQuery<ContratoAnexo[]>({
    queryKey: anexosQueryKey,
    enabled: contratoIds.length > 0,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await (supabase.from("contrato_anexos" as any) as any)
        .select("id, contrato_id, tenant_id, storage_path, nome_original, nome_omie, mime_type, tamanho_bytes, omie_status, omie_erro, omie_enviado_em, created_at")
        .in("contrato_id", contratoIds)
        .eq("ativo", true);
      if (error) throw error;
      return (data ?? []) as ContratoAnexo[];
    },
  });

  const anexoByContrato = useMemo(() => {
    const map: Record<string, ContratoAnexo> = {};
    (anexosQuery.data ?? []).forEach(a => {
      map[a.contrato_id] = a;
    });
    return map;
  }, [anexosQuery.data]);

  const anexosMap = useMemo(() => {
    const map = new Map<string, ContratoAnexo>();
    (anexosQuery.data ?? []).forEach(a => map.set(a.contrato_id, a));
    return map;
  }, [anexosQuery.data]);

  useEffect(() => {
    console.log("[ContratoAnexoSection][diagnostico]", {
      clienteId,
      tid,
      produtoIds,
      contratoItensQuery: {
        enabled: produtoIds.length > 0,
        table: "contrato_itens",
        select: "cliente_produto_id, contrato_id",
        filter: { cliente_produto_id: produtoIds },
        rows: contratoItensQuery.data?.length ?? 0,
        error: contratoItensQuery.error?.message ?? null,
      },
      contratoIdByCliProdSize: Object.keys(contratoIdByCliProd).length,
      contratoIds,
      anexosQuery: {
        enabled: contratoIds.length > 0,
        table: "contrato_anexos",
        select: "id, contrato_id, tenant_id, storage_path, nome_original, nome_omie, mime_type, tamanho_bytes, omie_status, omie_erro",
        filter: { contrato_id: contratoIds, ativo: true },
        rows: anexosQuery.data?.length ?? 0,
        error: anexosQuery.error?.message ?? null,
      },
      anexosMapSize: anexosMap.size,
    });
  }, [
    clienteId,
    tid,
    produtoIds,
    contratoItensQuery.data,
    contratoItensQuery.error,
    contratoIdByCliProd,
    contratoIds,
    anexosQuery.data,
    anexosQuery.error,
    anexosMap,
  ]);

  const clienteTenantQuery = useQuery<{ tenant_id: string | null }>({
    queryKey: ["cliente_tenant_lookup", clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("clientes" as any) as any)
        .select("tenant_id").eq("id", clienteId).maybeSingle();
      if (error) throw error;
      return (data ?? { tenant_id: null }) as any;
    },
  });
  const lookupTenantId: string | null = (clienteTenantQuery.data?.tenant_id ?? tid) ?? null;

  const produtosLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["produtos_lookup", lookupTenantId],
    enabled: !!lookupTenantId,
    queryFn: async () => {
      let q = (supabase.from("produtos" as any) as any).select("id, nome").order("nome");
      if (lookupTenantId) q = q.eq("tenant_id", lookupTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const fornecedoresLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["fornecedores_lookup", lookupTenantId],
    enabled: !!lookupTenantId,
    queryFn: async () => {
      let q = supabase.from("fornecedores").select("id, nome").order("nome");
      if (lookupTenantId) q = q.eq("tenant_id", lookupTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["cliente_produtos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["cliente_produto_modulos", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["cliente", clienteId] });
    qc.invalidateQueries({ queryKey: ["contratos_cliente", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["contrato_itens_cliente", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["contratos_totais_check", tid, clienteId] });
    qc.invalidateQueries({ queryKey: ["has_non_implicit_contratos", tid, clienteId] });
  };

  // ---- Mutations ----
  // Módulo NUNCA bloqueia: cliente_produto_modulos.cliente_produto_id é ON DELETE
  // CASCADE. Quem bloqueia é contrato_itens.cliente_produto_id, que não tem cascade
  // — e todo produto criado por create_cliente_produto_with_contract nasce com um
  // item de contrato. Checar antes para dizer o motivo real em vez de culpar módulo.
  const deleteProdutoMut = useMutation({
    mutationFn: async (id: string) => {
      const { data: itens, error: itensErr } = await (supabase.from("contrato_itens" as any) as any)
        .select("contrato_id")
        .eq("cliente_produto_id", id)
        .limit(1);
      if (itensErr) throw itensErr;
      const contratoId = (itens ?? [])[0]?.contrato_id as string | undefined;
      if (contratoId) {
        const { data: ct } = await (supabase.from("contratos" as any) as any)
          .select("numero")
          .eq("id", contratoId)
          .maybeSingle();
        const bloqueio: any = new Error("EM_CONTRATO");
        bloqueio.contratoNumero = (ct as any)?.numero ?? null;
        throw bloqueio;
      }
      const { error } = await (supabase.from("cliente_produtos" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Produto removido" });
      invalidateAll();
    },
    onError: (err: any) => {
      if (err?.message === "EM_CONTRATO") {
        const num = err?.contratoNumero ? ` ${err.contratoNumero}` : "";
        toast({
          title: "Produto vinculado a um contrato",
          description: `Este produto é item do contrato${num}. Excluir apagaria o item e desmontaria o total do contrato — cancele o produto pelo contrato.`,
          variant: "destructive",
        });
        return;
      }
      const msg = String(err?.message || "");
      if (msg.includes("foreign key") || msg.includes("violates")) {
        toast({ title: "Não é possível excluir", description: "Há registros vinculados a este produto. O banco recusou a exclusão.", variant: "destructive" });
      } else {
        toast({ title: "Erro ao excluir", description: msg, variant: "destructive" });
      }
    },
  });

  const motivosCancelamentoQuery = useQuery<{ id: number; descricao: string }[]>({
    queryKey: ["motivos_cancelamento", lookupTenantId],
    enabled: !!cancelarProduto || !!cancelarModulo,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      let q = (supabase.from("motivos_cancelamento" as any) as any).select("id, descricao").order("descricao");
      if (lookupTenantId) q = q.eq("tenant_id", lookupTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  // O efeito do cancelamento muda conforme o contrato: item único cancela o
  // contrato (com churn); item entre vários só sai do contrato (sem churn).
  // O usuário precisa saber disso ANTES de confirmar.
  const cancelInfoQuery = useQuery<{ contratoId: string | null; numero: string | null; itens: number }>({
    queryKey: ["cancel_produto_info", cancelarProduto?.id],
    enabled: !!cancelarProduto,
    queryFn: async () => {
      const { data: itens, error } = await (supabase.from("contrato_itens" as any) as any)
        .select("contrato_id")
        .eq("cliente_produto_id", cancelarProduto!.id)
        .limit(1);
      if (error) throw error;
      const cid = (itens ?? [])[0]?.contrato_id as string | undefined;
      if (!cid) return { contratoId: null, numero: null, itens: 0 };
      const [{ count }, { data: ct }] = await Promise.all([
        (supabase.from("contrato_itens" as any) as any)
          .select("id", { count: "exact", head: true })
          .eq("contrato_id", cid),
        (supabase.from("contratos" as any) as any).select("numero").eq("id", cid).maybeSingle(),
      ]);
      return { contratoId: cid, numero: (ct as any)?.numero ?? null, itens: count ?? 0 };
    },
  });

  const cancelarProdutoAgora = async () => {
    if (!cancelarProduto || !motivoProdutoId) return;
    setCancelandoProduto(true);
    try {
      const { data, error } = await (supabase.rpc as any)("cancel_cliente_produto", {
        p_cliente_produto_id: cancelarProduto.id,
        p_motivo_id: Number(motivoProdutoId),
        p_observacao: obsCancelProduto.trim() || null,
      });
      if (error) throw error;
      const r = (data ?? {}) as { contrato_cancelado?: boolean; item_removido?: boolean; sem_contrato?: boolean };
      toast({
        title: "Produto cancelado",
        description: r.contrato_cancelado
          ? "Era o único item do contrato: o contrato foi cancelado junto e o churn ficou registrado."
          : r.item_removido
            ? "O produto saiu do contrato e os totais foram recalculados."
            : "Produto inativado (não havia contrato vinculado).",
      });
      const prod = cancelarProduto;
      setCancelarProduto(null);
      invalidateAll();
      // Só cancelar_contrato grava churn. Quando o produto apenas sai de um
      // contrato com outros itens, o MRR não registra nada sozinho — daí a
      // sugestão de downsell, igual ao que a inativação de módulo faz.
      if (!r.contrato_cancelado && (Number(prod.vlr_mensal) || 0) > 0) {
        setMrrDialog({
          open: true,
          tipo: "downsell",
          valorDelta: -(Number(prod.vlr_mensal) || 0),
          custoDelta: -(Number(prod.vlr_custo) || 0),
          descricao: `Produto ${prod.produtos?.nome ?? ""} cancelado`,
          moduloId: null,
        });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Não deu para cancelar", description: e?.message });
    } finally {
      setCancelandoProduto(false);
    }
  };

  const deleteModuloMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("cliente_produto_modulos" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Módulo excluído" });
      invalidateAll();
    },
    onError: (err: any) => toast({ title: "Erro ao excluir", description: err.message, variant: "destructive" }),
  });

  const toggleModuloMut = useMutation({
    mutationFn: async (m: ClienteProdutoModulo) => {
      const novoAtivo = !m.ativo;
      const { error } = await (supabase.from("cliente_produto_modulos" as any) as any)
        .update({
          ativo: novoAtivo,
          data_inativacao: novoAtivo ? null : new Date().toISOString().slice(0, 10),
        })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: (_, m) => {
      toast({ title: "Módulo atualizado" });
      invalidateAll();
      // Se foi inativação (estava ativo) e tinha valor mensal, sugerir downsell
      if (m.ativo && (Number(m.vlr_mensal) || 0) > 0) {
        setMrrDialog({
          open: true,
          tipo: "downsell",
          valorDelta: -((Number(m.vlr_mensal) || 0) * (Number(m.quantidade) || 1)),
          custoDelta: -custoLinhaModulo(m),
          descricao: `Módulo ${m.produto_modulos?.nome ?? ""} inativado`,
          moduloId: m.id,
        });
      }
    },
    onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
  });

  // ---- Totals ----
  const ativos = (produtosQuery.data ?? []).filter(p => p.ativo);
  const totalMensal = ativos.reduce((s, p) => s + (Number(p.vlr_mensal) || 0), 0);
  const totalCusto = ativos.reduce((s, p) => s + (Number(p.vlr_custo) || 0), 0);
  const totalAtivacao = ativos.reduce((s, p) => s + (Number(p.vlr_ativacao) || 0), 0);

  const { data: contratosInfo } = useQuery({
    queryKey: ["contratos_totais_check", tid, clienteId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("contratos" as any) as any)
        .select("vlr_total_mensal, vlr_total_ativacao")
        .eq("cliente_id", clienteId)
        .eq("status", "ativo");
      if (error) return { count: 0, totalMensal: 0, totalAtivacao: 0 };
      const rows = data ?? [];
      return {
        count: rows.length,
        totalMensal: rows.reduce((s: number, c: any) => s + (Number(c.vlr_total_mensal) || 0), 0),
        totalAtivacao: rows.reduce((s: number, c: any) => s + (Number(c.vlr_total_ativacao) || 0), 0),
      };
    },
    enabled: !!clienteId,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 !flex-row !items-center !justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Package className="h-5 w-5" />
          Produtos & Módulos
          <Badge variant="secondary" className="ml-2">{ativos.length} ativo{ativos.length === 1 ? "" : "s"}</Badge>
        </CardTitle>
        <Button type="button" size="sm" onClick={() => setProdutoDialog({ open: true, edit: null })}>
          <Plus className="h-4 w-4 mr-1" /> Adicionar Produto
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {produtosQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (produtosQuery.data ?? []).length === 0 ? (
          <div className="text-center py-8 text-muted-foreground border border-dashed rounded-md">
            <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Nenhum produto vinculado a este cliente.</p>
            <Button type="button" variant="link" size="sm" onClick={() => setProdutoDialog({ open: true, edit: null })}>
              Adicionar primeiro produto
            </Button>
          </div>
        ) : (
          (produtosQuery.data ?? []).map(p => {
            const isOpen = !!expanded[p.id];
            const mods = modulosByProduto[p.id] ?? [];
            const modsAtivos = (modulosByProduto[p.id] ?? []).filter(m => m.ativo).length;
            return (
              <Collapsible key={p.id} open={isOpen} onOpenChange={(o) => setExpanded(s => ({ ...s, [p.id]: o }))}>
                <div className="border rounded-md bg-card">
                  <div className="flex items-center gap-2 p-3">
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </CollapsibleTrigger>
                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-4 gap-2 items-center">
                      <div className="font-semibold truncate flex items-center gap-1.5">
                        {p.produtos?.nome ?? "—"}
                        {anexosMap.has(contratoIdByCliProd[p.id]) && (
                          <Tooltip>
                            <TooltipTrigger>
                              <Paperclip className="h-4 w-4 text-muted-foreground" aria-label="Contrato anexado" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Contrato anexado</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">{p.fornecedores?.nome ?? "—"}</div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={p.ativo ? "default" : "secondary"} className="shrink-0">
                          R$ {fmtBRL(p.vlr_mensal)}/mês
                        </Badge>
                        <Badge variant="outline" className="shrink-0 text-muted-foreground">
                          Custo: R$ {fmtBRL(p.vlr_custo)}
                        </Badge>
                        {Number(p.vlr_ativacao) > 0 && (
                          <Badge variant="outline" className="shrink-0 text-amber-500 border-amber-500/30">
                            Ativ: R$ {fmtBRL(p.vlr_ativacao)}
                          </Badge>
                        )}
                        {!p.ativo && (
                          <Badge variant="outline" className="shrink-0 text-destructive border-destructive/40">
                            Cancelado
                          </Badge>
                        )}
                        {/* Sem precisar expandir: é a identidade da licença no
                            OEM e a primeira coisa que se procura conferindo. */}
                        {oemAtivo === true && p.oem_codigo_filial && (
                          <Badge variant="outline"
                            className="shrink-0 text-sky-600 dark:text-sky-400 border-sky-500/30">
                            OEM {p.oem_codigo_grupo ?? "—"} · {p.oem_codigo_filial}
                          </Badge>
                        )}
                      </div>
                      <div>
                        {modsAtivos > 0 ? (
                          <Badge variant="outline">{modsAtivos} módulo{modsAtivos > 1 ? "s" : ""}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem módulos</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setProdutoDialog({ open: true, edit: p })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {p.ativo && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                              onClick={() => { setMotivoProdutoId(""); setObsCancelProduto(""); setCancelarProduto(p); }}
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Cancelar produto</p></TooltipContent>
                        </Tooltip>
                      )}
                      {/* Produto que está em contrato não pode ser excluído: a FK de
                          contrato_itens recusa. Só aparece a lixeira para o órfão. */}
                      {contratoItensQuery.isSuccess && !contratoIdByCliProd[p.id] && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setConfirmDelete(p)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent><p>Excluir (produto sem contrato)</p></TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-3">
                      <Separator />
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                        <div>
                          <div className="text-muted-foreground text-xs">Data Ativação</div>
                          <div>{p.data_ativacao ? new Date(p.data_ativacao + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Vlr Ativação</div>
                          <div>R$ {fmtBRL(p.vlr_ativacao)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground text-xs">Link Portal</div>
                          {p.link_portal_fornecedor ? (
                            <a href={p.link_portal_fornecedor} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                              Abrir <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : <div>—</div>}
                        </div>
                        {/* Só para quem usa a integração — nos outros tenants
                            seriam duas linhas em branco sem explicação. */}
                        {oemAtivo === true && (
                          <>
                            <div>
                              <div className="text-muted-foreground text-xs">Código Grupo (OEM)</div>
                              <div className="tabular-nums">{p.oem_codigo_grupo || "—"}</div>
                            </div>
                            <div>
                              <div className="text-muted-foreground text-xs">Código Filial (OEM)</div>
                              <div className="tabular-nums">{p.oem_codigo_filial || "—"}</div>
                            </div>
                          </>
                        )}
                      </div>
                      {oemAtivo === true && !p.oem_codigo_filial && (
                        <p className="text-xs text-muted-foreground">
                          Sem licença do OEM vinculada. O código é gravado aqui quando o vínculo é
                          feito em <strong>Configurações › Integrações › OEM</strong> — não se
                          preenche à mão.
                        </p>
                      )}

                      {/* Acima da tabela: com a lista do OEM a coluna cresceu
                          para 5–11 linhas, e as ações ficavam abaixo de tudo —
                          quem quer somar um módulo tinha que rolar a lista
                          inteira para achar o botão. */}
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setModuloDialog({ open: true, clienteProdutoId: p.id, produtoId: p.produto_id, edit: null })}>
                          <Plus className="h-4 w-4 mr-1" /> <Puzzle className="h-4 w-4 mr-1" /> Adicionar Módulo
                        </Button>
                        <Button
                          type="button" variant="outline" size="sm"
                          onClick={() => setReajusteDialog({ open: true, clienteProdutoId: p.id, produtoNome: p.produtos?.nome ?? '' })}
                          disabled={modsAtivos === 0}
                        >
                          <Percent className="h-4 w-4 mr-1" /> Reajuste %
                        </Button>
                      </div>

                      <div className="rounded border bg-background/50 overflow-x-auto">
                        {mods.length === 0 ? (
                          <div className="p-4 text-center text-sm text-muted-foreground">
                            Nenhum módulo vinculado.
                          </div>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Módulo</TableHead>
                                <TableHead className="text-center w-16">Qtd</TableHead>
                                <TableHead className="text-right">Vlr Mensal (unit.)</TableHead>
                                <TableHead className="text-right">Vlr Custo (unit.)</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-40 text-right">Cancelamento</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {mods.map(m => (
                                <TableRow key={m.id}>
                                  <TableCell className="font-medium">
                                    {m.produto_modulos?.nome ?? "—"}
                                    {m.origem === "oem" && (
                                      <Badge
                                        variant="outline"
                                        className="ml-2 text-[10px] font-normal"
                                        title="Vem da licença no OEM e se atualiza sozinho a cada carga do espelho."
                                      >
                                        OEM
                                      </Badge>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-center">{Number(m.quantidade) || 1}</TableCell>
                                  <TableCell className="text-right">
                                    R$ {fmtBRL(m.vlr_mensal)}
                                    {(Number(m.quantidade) || 1) > 1 && (
                                      <span className="block text-xs text-muted-foreground">
                                        = R$ {fmtBRL((Number(m.vlr_mensal) || 0) * (Number(m.quantidade) || 1))}
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    R$ {fmtBRL(m.vlr_custo)}
                                    {/* A linha do total aparece sempre que ela não for o unitário —
                                        inclusive quando o parceiro cobra menos que quantidade ×
                                        unitário, que é o caso em que o número surpreende. */}
                                    {custoLinhaModulo(m) !== (Number(m.vlr_custo) || 0) && (
                                      <span className="block text-xs text-muted-foreground">
                                        = R$ {fmtBRL(custoLinhaModulo(m))}
                                        {m.vlr_custo_total != null && " · OEM"}
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant={m.ativo ? "default" : "secondary"}>{m.ativo ? "Ativo" : "Inativo"}</Badge>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {m.origem === "oem" ? (
                                      // Só o cancelamento: editar valor ou
                                      // excluir seria desfeito na próxima carga
                                      // do espelho. O cancelamento, não — ele
                                      // trava a linha (`cancelado_manual`).
                                      m.ativo ? (
                                        <div className="flex items-center justify-end gap-0.5">
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <Button
                                                type="button" variant="ghost" size="icon"
                                                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                                onClick={() => {
                                                  setCancelarModulo(m);
                                                  setMotivoCancelamento("");
                                                  setMotivoModuloId("");
                                                  setDataCancelModulo(hojeISO());
                                                  setQtdCancelamento(Number(m.quantidade) || 1);
                                                }}
                                              >
                                                <X className="h-4 w-4" />
                                              </Button>
                                            </TooltipTrigger>
                                            <TooltipContent>Cancelamento de módulo</TooltipContent>
                                          </Tooltip>
                                        </div>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">Cancelado</span>
                                      )
                                    ) : (
                                    <div className="flex items-center justify-end gap-0.5">
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setModuloDialog({ open: true, clienteProdutoId: p.id, produtoId: p.produto_id, edit: m })}>
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => toggleModuloMut.mutate(m)} disabled={toggleModuloMut.isPending}>
                                        {m.ativo ? "Inativar" : "Reativar"}
                                      </Button>
                                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setConfirmDeleteModulo(m)} disabled={deleteModuloMut.isPending}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>

                      <HistoricoModulosProduto clienteProdutoId={p.id} />

                      <ContratoAnexoSection
                        contratoId={contratoIdByCliProd[p.id] ?? null}
                        tenantId={lookupTenantId}
                        anexo={anexoByContrato[contratoIdByCliProd[p.id] ?? ""] ?? null}
                        invalidateKey={anexosQueryKey}
                      />
                    </div>

                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })
        )}

        <Separator />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-sm">
          <div className="flex flex-wrap gap-4">
            <div className="font-semibold">Total Mensal: <span className="text-primary">R$ {fmtBRL(totalMensal)}</span></div>
            <div className="font-semibold">Total Custo: <span className="text-muted-foreground">R$ {fmtBRL(totalCusto)}</span></div>
            {totalAtivacao > 0 && (
              <div className="font-semibold">Total Ativação: <span className="text-amber-500">R$ {fmtBRL(totalAtivacao)}</span></div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">Mensalidade do cliente é recalculada automaticamente.</div>
        </div>
        {ativos.length > 0 && (() => {
          const ct = contratosInfo ?? { count: 0, totalMensal: 0, totalAtivacao: 0 };

          if (ct.count === 0) {
            return (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 mt-2 space-y-1">
                <p className="font-medium">⚠ Nenhum contrato ativo encontrado.</p>
                <p>Adicione um contrato para formalizar os produtos (R$ {fmtBRL(totalMensal)}/mês).</p>
              </div>
            );
          }

          const diffMensal = Math.abs(totalMensal - ct.totalMensal);
          const diffAtivacao = Math.abs(totalAtivacao - ct.totalAtivacao);

          if (diffMensal > 0.01 || diffAtivacao > 0.01) {
            return (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-500 mt-2 space-y-1">
                <p className="font-medium">⚠ Os valores dos contratos divergem dos produtos.</p>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <div>
                    <span className="text-muted-foreground">Mensal produtos:</span> R$ {fmtBRL(totalMensal)}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mensal contratos:</span> R$ {fmtBRL(ct.totalMensal)}
                  </div>
                  {totalAtivacao > 0 && (
                    <>
                      <div>
                        <span className="text-muted-foreground">Ativação produtos:</span> R$ {fmtBRL(totalAtivacao)}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Ativação contratos:</span> R$ {fmtBRL(ct.totalAtivacao)}
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-1">Atualize o contrato existente, insira um aditivo ou registre um movimento MRR para conciliar.</p>
              </div>
            );
          }

          return null;
        })()}
      </CardContent>

      <ProdutoDialog
        open={produtoDialog.open}
        edit={produtoDialog.edit ?? null}
        onClose={() => setProdutoDialog({ open: false })}
        clienteId={clienteId}
        tid={tid}
        produtos={produtosLookup.data ?? []}
        fornecedores={fornecedoresLookup.data ?? []}
        onSaved={invalidateAll}
        modulosNomesForEdit={produtoDialog.edit
          ? Array.from(new Set(
              (modulosByProduto[produtoDialog.edit.id] ?? [])
                .map(m => (m.produto_modulos?.nome ?? "").trim())
                .filter(Boolean),
            ))
          : []}
        editContratoId={produtoDialog.edit ? (contratoIdByCliProd[produtoDialog.edit.id] ?? null) : null}
        onProductCreated={(cliProdId) => setExpanded(s => ({ ...s, [cliProdId]: true }))}
      />


      <ModuloDialog
        open={moduloDialog.open}
        edit={moduloDialog.edit ?? null}
        clienteProdutoId={moduloDialog.clienteProdutoId}
        produtoId={moduloDialog.produtoId}
        tid={tid}
        lookupTid={lookupTenantId}
        onClose={() => setModuloDialog({ open: false })}
        onSaved={invalidateAll}
        produtoDataAtivacao={produtosQuery.data?.find(p => p.id === moduloDialog.clienteProdutoId)?.data_ativacao ?? null}
        produtoFuncionarioId={produtosQuery.data?.find(p => p.id === moduloDialog.clienteProdutoId)?.funcionario_id ?? null}
        produtoOrigemVendaId={produtosQuery.data?.find(p => p.id === moduloDialog.clienteProdutoId)?.origem_venda_id ?? null}
        oemCodigoFilial={produtosQuery.data?.find(p => p.id === moduloDialog.clienteProdutoId)?.oem_codigo_filial ?? null}
        clienteId={clienteId}
      />

      <ReajusteModulosDialog
        open={reajusteDialog.open}
        onOpenChange={(o) => setReajusteDialog(prev => ({ ...prev, open: o }))}
        clienteProdutoId={reajusteDialog.clienteProdutoId ?? ''}
        produtoNome={reajusteDialog.produtoNome ?? ''}
        modulos={(modulosByProduto[reajusteDialog.clienteProdutoId ?? ''] ?? [])
          .filter((m: any) => m.ativo)
          .map((m: any) => ({
            id: m.id,
            nome: m.produto_modulos?.nome ?? '',
            vlr_mensal: Number(m.vlr_mensal) || 0,
            vlr_custo: Number(m.vlr_custo) || 0,
            ativo: m.ativo,
          }))}
        tenantId={tid}
        clienteId={clienteId}
        onSuccess={invalidateAll}
        onMRRSuggest={(d) => setMrrDialog({ open: true, ...d, moduloId: null })}
      />

      <SugestaoMRRDialog
        open={mrrDialog.open}
        onOpenChange={(o) => setMrrDialog(prev => ({ ...prev, open: o }))}
        clienteId={clienteId}
        tenantId={lookupTenantId}
        tipo={mrrDialog.tipo}
        valorDelta={mrrDialog.valorDelta}
        custoDelta={mrrDialog.custoDelta}
        descricaoSugerida={mrrDialog.descricao}
        moduloId={mrrDialog.moduloId}
        dataSugerida={mrrDialog.dataMovimento ?? null}
        funcionarioId={mrrDialog.funcionarioId ?? null}
        origemVenda={mrrDialog.origemVenda ?? null}
        onRegistrado={invalidateAll}
      />

      <Dialog open={!!cancelarProduto} onOpenChange={(o) => { if (!o) setCancelarProduto(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-destructive" />
              Cancelar produto
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded border bg-muted/40 px-3 py-2 text-sm">
              <span className="font-medium">{cancelarProduto?.produtos?.nome ?? "—"}</span>
              <span className="block text-xs text-muted-foreground">
                R$ {fmtBRL(cancelarProduto?.vlr_mensal)}/mês · custo R$ {fmtBRL(cancelarProduto?.vlr_custo)}
                {cancelInfoQuery.data?.numero ? ` · contrato ${cancelInfoQuery.data.numero}` : ""}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label>Motivo *</Label>
              <Select value={motivoProdutoId} onValueChange={setMotivoProdutoId}>
                <SelectTrigger><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
                <SelectContent>
                  {(motivosCancelamentoQuery.data ?? []).map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.descricao}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {motivosCancelamentoQuery.isSuccess && (motivosCancelamentoQuery.data ?? []).length === 0 && (
                <p className="text-xs text-destructive">
                  Nenhum motivo cadastrado para este tenant. Cadastre em Configurações › Cadastros › Motivos de cancelamento.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Observação <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Textarea
                rows={3}
                maxLength={500}
                placeholder="Detalhes que ajudem a entender a saída"
                value={obsCancelProduto}
                onChange={(e) => setObsCancelProduto(e.target.value)}
              />
            </div>

            {cancelInfoQuery.isLoading ? (
              <Skeleton className="h-12 w-full" />
            ) : cancelInfoQuery.data?.contratoId && (cancelInfoQuery.data?.itens ?? 0) <= 1 ? (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  É o <strong>único item</strong> do contrato {cancelInfoQuery.data?.numero ?? ""}: o contrato
                  inteiro será cancelado, com churn no MRR. Sendo o último contrato ativo, o cliente
                  passa a contar como cancelado.
                </span>
              </p>
            ) : cancelInfoQuery.data?.contratoId ? (
              <p className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  O contrato {cancelInfoQuery.data?.numero ?? ""} continua ativo com os outros
                  {" "}{(cancelInfoQuery.data?.itens ?? 1) - 1} item(ns): o produto só sai dele e os totais
                  são recalculados. Como isso <strong>não</strong> gera churn sozinho, a sugestão de
                  downsell abre em seguida.
                </span>
              </p>
            ) : null}

            {oemAtivo === true && cancelarProduto?.oem_codigo_filial && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  A baixa da licença <strong>no OEM não sai daqui</strong>. Para o parceiro parar de
                  cobrar, cancele os módulos pelo X de cada um (esse sim dá baixa) ou trate no portal.
                </span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelarProduto(null)} disabled={cancelandoProduto}>
              Voltar
            </Button>
            <Button
              type="button" variant="destructive" className="gap-1.5"
              disabled={cancelandoProduto || !motivoProdutoId}
              onClick={cancelarProdutoAgora}
            >
              {cancelandoProduto ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              Cancelar produto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelarModulo} onOpenChange={(o) => { if (!o) setCancelarModulo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar módulo</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded border bg-muted/40 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{cancelarModulo?.produto_modulos?.nome ?? "—"}</span>
                {cancelarModulo?.origem === "oem" && (
                  <Badge variant="outline" className="text-[10px] uppercase">OEM</Badge>
                )}
              </div>
              <span className="block text-xs text-muted-foreground">
                {Number(cancelarModulo?.quantidade) || 1} contratada(s) ·
                {" "}mensal R$ {fmtBRL(cancelarModulo?.vlr_mensal)} ·
                {" "}custo R$ {fmtBRL(cancelarModulo ? custoLinhaModulo(cancelarModulo) : 0)}
                {cancelarModulo?.vlr_custo_total != null && " (total cobrado pelo OEM)"}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label>Data do cancelamento</Label>
              <Input
                type="date"
                value={dataCancelModulo}
                onChange={(e) => setDataCancelModulo(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Vem preenchida com hoje. É ela que vale como data de inativação do módulo —
                mude se o cliente cancelou antes.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Motivo</Label>
              <Select value={motivoModuloId} onValueChange={setMotivoModuloId}>
                <SelectTrigger>
                  <SelectValue placeholder={motivosCancelamentoQuery.isLoading ? "Carregando..." : "Selecione"} />
                </SelectTrigger>
                <SelectContent>
                  {(motivosCancelamentoQuery.data ?? []).map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>{m.descricao}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(Number(cancelarModulo?.quantidade) || 1) > 1 && (
              <div className="space-y-1.5">
                <Label>Quantidade a cancelar</Label>
                <Select value={String(qtdCancelamento)} onValueChange={(v) => setQtdCancelamento(Number(v))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: Number(cancelarModulo?.quantidade) || 1 }, (_, i) => i + 1).map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n} {n === (Number(cancelarModulo?.quantidade) || 1) ? "(todas)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Cancelando parte, o módulo continua na ficha com a quantidade restante.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Observação <span className="text-muted-foreground font-normal">(opcional)</span></Label>
              <Textarea
                rows={3}
                placeholder="Ex.: cliente devolveu um terminal"
                value={motivoCancelamento}
                onChange={(e) => setMotivoCancelamento(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Aparece no histórico de módulos, junto com o motivo, quem cancelou e quando.
              </p>
            </div>

            {cancelarModulo?.origem === "oem" && (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  A baixa é pedida <strong>ao OEM primeiro</strong>: se o parceiro recusar, nada
                  muda aqui e você vê o motivo. Dando certo, a linha também fica travada contra a
                  próxima carga do espelho.
                </span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelarModulo(null)} disabled={cancelandoModulo}>
              Voltar
            </Button>
            <Button
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
              disabled={cancelandoModulo || !motivoModuloId || !dataCancelModulo}
              onClick={async () => {
                if (!cancelarModulo) return;
                setCancelandoModulo(true);
                try {
                  const nome = cancelarModulo.produto_modulos?.nome ?? "Módulo";
                  const detalhe = `${nome} · ${qtdCancelamento} de ${Number(cancelarModulo.quantidade) || 1}.`;
                  const payload = {
                    quantidade_cancelar: qtdCancelamento,
                    motivo: motivoCancelamento.trim() || null,
                    motivo_id: motivoModuloId ? Number(motivoModuloId) : null,
                    data: dataCancelModulo || null,
                  };

                  // A ordem continua a mesma de sempre — OEM primeiro, ficha
                  // depois —, só que agora ela mora numa linha de fila em vez de
                  // acontecer dentro deste clique. Recusa do parceiro fica
                  // escrita em Integrações › OEM › Fila, com o motivo, em vez de
                  // sumir junto com este aviso.
                  const { data: filaId, error: errF } = await (supabase.rpc as any)("fn_oem_enfileirar", {
                    p_modulo_linha_id: cancelarModulo.id,
                    p_acao: "cancelar",
                    p_quantidade: qtdCancelamento,
                    p_payload: payload,
                  });
                  if (errF) throw new Error(errF.message);

                  // Módulo digitado à mão não tem licença no parceiro: a fila
                  // devolve null e o cancelamento é só daqui.
                  if (!filaId) {
                    const { error } = await (supabase.rpc as any)("fn_cancelar_modulo_cliente", {
                      p_id: cancelarModulo.id,
                      p_quantidade: qtdCancelamento,
                      p_motivo: payload.motivo,
                      p_motivo_id: payload.motivo_id,
                      p_data: payload.data,
                    });
                    if (error) throw new Error(error.message);
                    toast({ title: "Módulo cancelado", description: detalhe });
                    setCancelarModulo(null);
                    invalidateAll();
                    return;
                  }

                  // Enfileirou: pede o processamento agora para não fazer
                  // ninguém esperar os 2 minutos do cron no caminho feliz.
                  const { data: proc } = await supabase.functions.invoke("oem-sync-processar", {
                    body: { fila_id: filaId },
                  });
                  const r = (proc ?? {}) as { ok_count?: number; erros?: number };

                  if ((r.ok_count ?? 0) > 0) {
                    toast({ title: "Cancelado no OEM e na ficha", description: detalhe });
                  } else {
                    // Nada de "deu erro e acabou": a linha está viva, o motivo
                    // está escrito e o cron tenta de novo sozinho.
                    toast({
                      title: "O OEM não aceitou agora — está na fila",
                      description: `${detalhe} A ficha só muda quando o parceiro aceitar. O motivo está em Integrações › OEM › Fila.`,
                    });
                  }
                  setCancelarModulo(null);
                  invalidateAll();
                } catch (e: any) {
                  toast({ variant: "destructive", title: "Não deu para cancelar", description: e?.message });
                } finally {
                  setCancelandoModulo(false);
                }
              }}
            >
              {cancelandoModulo ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              Cancelar módulo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteModulo} onOpenChange={(o) => !o && setConfirmDeleteModulo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir módulo?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Use apenas para corrigir lançamentos errados. Para um módulo que o cliente deixou de usar (downsell), prefira "Inativar". Os valores do produto são recalculados automaticamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDeleteModulo) deleteModuloMut.mutate(confirmDeleteModulo.id);
                setConfirmDeleteModulo(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto do cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Este produto não está em nenhum contrato: excluir apaga o registro e os módulos vinculados junto (cascata), sem histórico. Para produto de contrato, use Cancelar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => {
                if (confirmDelete) deleteProdutoMut.mutate(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ============ Produto Dialog ============
function ProdutoDialog({
  open, edit, onClose, clienteId, tid, produtos, fornecedores, onSaved,
  modulosNomesForEdit, editContratoId, onProductCreated,
}: {
  open: boolean;
  edit: ClienteProduto | null;
  onClose: () => void;
  clienteId: string;
  tid: string | null;
  produtos: { id: number; nome: string }[];
  fornecedores: { id: number; nome: string }[];
  onSaved: () => void;
  modulosNomesForEdit: string[];
  editContratoId?: string | null;
  onProductCreated?: (cliProdId: string) => void;
}) {
  const isEdit = !!edit;
  const { profile } = useAuth();
  const isSuperAdmin = profile?.is_super_admin === true;
  const isTenantAdmin = profile?.role === "admin";
  const isHead = profile?.role === "head";
  const canAttach = isAdminLike(profile);
  const canSwapProduto = isEdit && (isSuperAdmin || isTenantAdmin || isHead);
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const stagedFileInputRef = useRef<HTMLInputElement | null>(null);
  const [produtoId, setProdutoId] = useState<string>("");
  const [fornecedorId, setFornecedorId] = useState<string>("");
  const [codigo, setCodigo] = useState("");
  const [link, setLink] = useState("");
  const [dataAt, setDataAt] = useState("");
  const [vlrAt, setVlrAt] = useState<number | null>(null);
  const [vlrMensal, setVlrMensal] = useState<number | null>(null);
  const [vlrCusto, setVlrCusto] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmSwapOpen, setConfirmSwapOpen] = useState(false);
  // Após criar um novo produto/contrato, oferece o envio ao Omie no fim do fluxo
  const [postSaveContrato, setPostSaveContrato] = useState<{ id: string; numero: string | null; created_at: string | null } | null>(null);

  // Novos campos
  const [dataVenda, setDataVenda] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [prazoMeses, setPrazoMeses] = useState<number | null>(null);
  const [diaVencimento, setDiaVencimento] = useState<number | null>(null);
  const [modeloContratoId, setModeloContratoId] = useState<string>("");
  const [recorrencia, setRecorrencia] = useState<string>("");
  const [funcionarioId, setFuncionarioId] = useState<string>("");
  const [origemVendaId, setOrigemVendaId] = useState<string>("");
  const [formaPagAtivacaoId, setFormaPagAtivacaoId] = useState<string>("");
  const [formaPagMensalidadeId, setFormaPagMensalidadeId] = useState<string>("");
  const [observacoesContratuais, setObservacoesContratuais] = useState("");

  const produtoIdOriginal = edit?.produto_id ? String(edit.produto_id) : "";
  const produtoTrocou = isEdit && produtoId !== "" && produtoId !== produtoIdOriginal;

  // Lookups
  const clienteTenantQ = useQuery<{ tenant_id: string | null }>({
    queryKey: ["cliente_tenant_id", clienteId],
    enabled: open && !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("clientes" as any) as any)
        .select("tenant_id").eq("id", clienteId).maybeSingle();
      if (error) throw error;
      return (data ?? { tenant_id: null }) as any;
    },
  });
  const resolvedTenantId: string | null = (clienteTenantQ.data?.tenant_id ?? tid) ?? null;

  // Trocar produto reaponta cada módulo do cliente para o de MESMO NOME no
  // produto destino (é o que admin_swap_cliente_produto faz). Então o destino
  // só serve se tiver todos eles — e a tela precisa dizer isso antes de salvar,
  // em vez de deixar o usuário descobrir no erro do banco.
  const catalogoModulosQ = useQuery<{ produto_id: number; nome: string }[]>({
    queryKey: ["produto_modulos_catalogo", resolvedTenantId],
    enabled: open && isEdit && canSwapProduto && modulosNomesForEdit.length > 0 && !!resolvedTenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllRows<{ produto_id: number; nome: string }>(() => {
        let q = (supabase.from("produto_modulos" as any) as any).select("produto_id, nome");
        if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
        return q;
      });
      return rows ?? [];
    },
  });

  // Mesma normalização de public.fn_norm_nome_modulo, que é a que o banco usa
  // para casar os módulos na troca (e o espelho do OEM para casar catálogo):
  // tira espaço das pontas, acento, caixa e espaço duplo do meio. Só assim
  // "GESTAO" importado do OEM casa com "Gestão" digitado à mão — com
  // lower/trim puro a tela ofereceria uma troca que o banco recusaria.
  const chave = (n: string) =>
    (n ?? "")
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ");

  const faltantesPorProduto = useMemo(() => {
    const out: Record<number, string[]> = {};
    if (modulosNomesForEdit.length === 0) return out;
    const porProduto = new Map<number, Set<string>>();
    (catalogoModulosQ.data ?? []).forEach(r => {
      const set = porProduto.get(r.produto_id) ?? new Set<string>();
      set.add(chave(r.nome ?? ""));
      porProduto.set(r.produto_id, set);
    });
    produtos.forEach(p => {
      const tem = porProduto.get(p.id) ?? new Set<string>();
      const faltam = modulosNomesForEdit.filter(n => !tem.has(chave(n)));
      if (faltam.length > 0) out[p.id] = faltam;
    });
    return out;
  }, [catalogoModulosQ.data, modulosNomesForEdit, produtos]);

  const modelosContratoLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["modelos_contrato_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("modelos_contrato" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
  const funcionariosLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["funcionarios_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("funcionarios" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
  const origensVendaLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["origens_venda_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("origens_venda" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
  const formasPagamentoLookup = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["formas_pagamento_lookup", resolvedTenantId],
    enabled: open && !!resolvedTenantId,
    queryFn: async () => {
      let q = (supabase.from("formas_pagamento" as any) as any).select("id, nome").order("nome");
      if (resolvedTenantId) q = q.eq("tenant_id", resolvedTenantId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  // ========= Omie: tenant a partir do cliente + integração ativa + padrões =========

  // A conta vem da unidade DO CLIENTE. Era .eq("tenant_id").maybeSingle(), que com duas contas
  // erra e fazia o diálogo se comportar como se não houvesse Omie — sem os campos e sem a
  // mensagem de enviar ao Omie ao salvar o produto.
  const contaOmieQ = useOmieContaDoCliente(clienteId);
  const omieAtivo = contaOmieQ.data?.ativo === true;

  const omiePadroesQ = useQuery({
    queryKey: ["omie_padroes_lists_dialog", resolvedTenantId],
    enabled: open && omieAtivo && !!resolvedTenantId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("omie-integration-call", {
        body: { acao: "ler_padroes", tenant_id: resolvedTenantId, cliente_id: clienteId, dados: { operacao: "ler" } },
      });
      if (error) throw error;
      const resultado = (data as any)?.resultado ?? (data as any)?.dados ?? data ?? {};
      if (resultado?.ok === false) {
        throw new Error(resultado?.error || "Falha ao carregar opções do Omie");
      }
      return {
        contas: (resultado.contas ?? []) as Array<{ codigo: any; descricao: string }>,
        servicos: (resultado.servicos ?? []) as Array<{ codigo: any; descricao: string }>,
        tipos_faturamento: (resultado.tipos_faturamento ?? []) as Array<{ codigo: any; descricao: string }>,
      };

    },
  });

  // Carrega o produto selecionado para ler campos omie_* atuais
  const produtoOmieQ = useQuery({
    queryKey: ["produto_omie_atual", produtoId, resolvedTenantId],
    enabled: open && omieAtivo && !!produtoId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, omie_servico_codigo, omie_conta_corrente_codigo, omie_tipo_faturamento_codigo, omie_dia_faturamento, omie_numero_parcelas, omie_permite_servidor_nuvem")
        .eq("id", Number(produtoId))
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  // Estado dos campos Omie
  const [omieServico, setOmieServico] = useState<string>("");
  const [omieConta, setOmieConta] = useState<string>("");
  const [omieTipoFat, setOmieTipoFat] = useState<string>("");
  const [omieDiaFat, setOmieDiaFat] = useState<string>("");
  const [omieNumParcelas, setOmieNumParcelas] = useState<string>("");
  const [omiePermiteNuvem, setOmiePermiteNuvem] = useState<boolean>(false);

  useEffect(() => {
    const p = produtoOmieQ.data;
    setOmieServico(p?.omie_servico_codigo != null ? String(p.omie_servico_codigo) : "");
    setOmieConta(p?.omie_conta_corrente_codigo != null ? String(p.omie_conta_corrente_codigo) : "");
    setOmieTipoFat(p?.omie_tipo_faturamento_codigo ?? "");
    setOmieDiaFat(p?.omie_dia_faturamento != null ? String(p.omie_dia_faturamento) : "");
    setOmieNumParcelas(p?.omie_numero_parcelas != null ? String(p.omie_numero_parcelas) : "");
    setOmiePermiteNuvem(p?.omie_permite_servidor_nuvem === true);
  }, [produtoOmieQ.data, produtoId]);



  // Reset on open
  useMemo(() => {
    if (open) {
      const e = edit as any;
      setProdutoId(edit?.produto_id ? String(edit.produto_id) : "");
      setFornecedorId(edit?.fornecedor_id ? String(edit.fornecedor_id) : "");
      setCodigo(edit?.codigo_fornecedor ?? "");
      setLink(edit?.link_portal_fornecedor ?? "");
      setDataAt(edit?.data_ativacao ?? "");
      setVlrAt(edit?.vlr_ativacao ?? null);
      setVlrMensal(edit?.vlr_mensal ? Number(edit.vlr_mensal) || null : null);
      setVlrCusto(edit?.vlr_custo ? Number(edit.vlr_custo) || null : null);
      setDataVenda(e?.data_venda ?? "");
      setDataFim(e?.data_fim ?? "");
      setPrazoMeses(e?.prazo_meses ?? null);
      setDiaVencimento(e?.dia_vencimento ?? null);
      setModeloContratoId(e?.modelo_contrato_id ? String(e.modelo_contrato_id) : "");
      setRecorrencia(e?.recorrencia ?? "");
      setFuncionarioId(e?.funcionario_id ? String(e.funcionario_id) : "");
      setOrigemVendaId(e?.origem_venda_id ? String(e.origem_venda_id) : "");
      setFormaPagAtivacaoId(e?.forma_pagamento_ativacao_id ? String(e.forma_pagamento_ativacao_id) : "");
      setFormaPagMensalidadeId(e?.forma_pagamento_mensalidade_id ? String(e.forma_pagamento_mensalidade_id) : "");
      setObservacoesContratuais(e?.observacoes_contratuais ?? "");
      setStagedFile(null);
      setTimeout(() => setDataProximoReajuste(e?.data_proximo_reajuste ?? ""), 0);
    }
  }, [open, edit]);

  const [dataProximoReajuste, setDataProximoReajuste] = useState("");
  useEffect(() => {
    if (!dataAt) {
      setDataProximoReajuste("");
      return;
    }
    const start = new Date(dataAt + "T00:00:00");
    if (isNaN(start.getTime())) {
      setDataProximoReajuste("");
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const next = new Date(start);
    let guard = 0;
    while (next <= today && guard < 600) {
      next.setMonth(next.getMonth() + 12);
      guard++;
    }
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, "0");
    const d = String(next.getDate()).padStart(2, "0");
    setDataProximoReajuste(`${y}-${m}-${d}`);
  }, [dataAt]);



  const executeSave = async () => {
    if (!produtoId) {
      toast({ title: "Selecione um produto", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (isEdit && edit) {
        const payload: any = {
          fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
          codigo_fornecedor: codigo || null,
          link_portal_fornecedor: link || null,
          data_ativacao: dataAt || null,
          vlr_ativacao: vlrAt,
          vlr_mensal: vlrMensal || 0,
          vlr_custo: vlrCusto || 0,
          data_venda: dataVenda || null,
          data_fim: dataFim || null,
          data_proximo_reajuste: dataProximoReajuste || null,
          prazo_meses: prazoMeses,
          dia_vencimento: diaVencimento,
          modelo_contrato_id: modeloContratoId ? Number(modeloContratoId) : null,
          recorrencia: recorrencia || null,
          funcionario_id: funcionarioId ? Number(funcionarioId) : null,
          origem_venda_id: origemVendaId ? Number(origemVendaId) : null,
          forma_pagamento_ativacao_id: formaPagAtivacaoId ? Number(formaPagAtivacaoId) : null,
          forma_pagamento_mensalidade_id: formaPagMensalidadeId ? Number(formaPagMensalidadeId) : null,
          observacoes_contratuais: observacoesContratuais || null,
        };
        // Se trocou produto, chama RPC primeiro (gate + propagação contrato_itens)
        if (produtoTrocou) {
          const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
            "admin_swap_cliente_produto",
            {
              p_cliente_produto_id: edit.id,
              p_novo_produto_id: Number(produtoId),
              p_novo_fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
            }
          );
          if (rpcError) throw rpcError;
          const updated = (rpcData as any)?.contrato_itens_atualizados ?? 0;
          const remap = (rpcData as any)?.modulos_reapontados ?? 0;
          toast({
            title: "Produto trocado",
            description: [
              updated > 0 ? `${updated} item(ns) de contrato com descrição atualizada.` : "Nenhum item de contrato afetado.",
              remap > 0 ? `${remap} módulo(s) reapontado(s) para o novo produto.` : null,
            ].filter(Boolean).join(" "),
          });
          delete payload.fornecedor_id;
        }
        const { error } = await (supabase.from("cliente_produtos" as any) as any)
          .update(payload).eq("id", edit.id);
        if (error) throw error;

        // Sync para contrato (não bloquear em erro)
        try {
          const { error: syncErr } = await (supabase.rpc as any)("sync_cliente_produto_to_contract", {
            p_cliente_produto_id: edit.id,
          });
          if (syncErr) {
            toast({ title: "Atenção", description: `Sync de contrato falhou: ${syncErr.message}`, variant: "destructive" });
          }
        } catch (syncCatch: any) {
          toast({ title: "Atenção", description: `Sync de contrato falhou: ${syncCatch?.message ?? ""}`, variant: "destructive" });
        }
      } else {
        const dados: any = {
          fornecedor_id: fornecedorId ? Number(fornecedorId) : null,
          codigo_fornecedor: codigo || null,
          link_portal_fornecedor: link || null,
          vlr_ativacao: vlrAt ?? 0,
          vlr_mensal: vlrMensal ?? 0,
          vlr_custo: vlrCusto ?? 0,
          data_venda: dataVenda || null,
          data_ativacao: dataAt || null,
          data_fim: dataFim || null,
          data_proximo_reajuste: dataProximoReajuste || null,
          prazo_meses: prazoMeses,
          dia_vencimento: diaVencimento,
          modelo_contrato_id: modeloContratoId ? Number(modeloContratoId) : null,
          recorrencia: recorrencia || null,
          funcionario_id: funcionarioId ? Number(funcionarioId) : null,
          origem_venda_id: origemVendaId ? Number(origemVendaId) : null,
          forma_pagamento_ativacao_id: formaPagAtivacaoId ? Number(formaPagAtivacaoId) : null,
          forma_pagamento_mensalidade_id: formaPagMensalidadeId ? Number(formaPagMensalidadeId) : null,
          observacoes_contratuais: observacoesContratuais || null,
        };
        const { data: novoCliProdId, error } = await (supabase.rpc as any)("create_cliente_produto_with_contract", {
          p_cliente_id: clienteId,
          p_produto_id: Number(produtoId),
          p_dados: dados,
        });
        if (error) throw error;

        // Upload do anexo staged (arquivo escolhido antes de existir o contrato).
        // Ordem obrigatória: RPC cria produto+contrato → busca contrato_id → sobe → RPC substituir.
        // Se falhar, o produto já existe: avisa e expande o card para retry pelo painel.
        if (stagedFile && canAttach && novoCliProdId && resolvedTenantId) {
          try {
            const { data: ci, error: ciErr } = await (supabase.from("contrato_itens" as any) as any)
              .select("contrato_id")
              .eq("cliente_produto_id", novoCliProdId as string)
              .limit(1)
              .maybeSingle();
            if (ciErr) throw ciErr;
            const novoContratoId = (ci as any)?.contrato_id as string | undefined;
            if (!novoContratoId) throw new Error("Contrato não encontrado para o produto recém-criado.");
            await uploadContratoAnexo({
              contratoId: novoContratoId,
              tenantId: resolvedTenantId,
              file: stagedFile,
            });
          } catch (upErr: any) {
            toast({
              title: "Produto criado. Falha ao anexar o contrato — anexe pelo painel do produto.",
              description: upErr?.message ?? String(upErr),
              variant: "destructive",
            });
            onProductCreated?.(novoCliProdId as string);
            onSaved();
            onClose();
            return;
          }
        }

        if (novoCliProdId && onProductCreated) {
          onProductCreated(novoCliProdId as string);
        }
      }


      // Salva campos omie_* na tabela produtos (escopado por tenant) se Omie ativo
      if (omieAtivo && produtoId && resolvedTenantId) {
        const parseIntOrNull = (s: string) => {
          const t = s.trim(); if (!t) return null;
          const n = Number(t); return Number.isFinite(n) ? Math.trunc(n) : null;
        };
        const dia = parseIntOrNull(omieDiaFat);
        if (dia !== null && (dia < 1 || dia > 31)) {
          toast({ title: "Dia de faturamento inválido", description: "Use um valor entre 1 e 31.", variant: "destructive" });
        } else {
          const omiePayload = {
            omie_servico_codigo: omieServico ? Number(omieServico) : null,
            omie_conta_corrente_codigo: omieConta ? Number(omieConta) : null,
            omie_tipo_faturamento_codigo: omieTipoFat || null,
            omie_dia_faturamento: dia,
            omie_numero_parcelas: parseIntOrNull(omieNumParcelas),
            omie_permite_servidor_nuvem: !!omiePermiteNuvem,
          };
          const { error: omieErr } = await (supabase.from("produtos" as any) as any)
            .update(omiePayload)
            .eq("id", Number(produtoId))
            .eq("tenant_id", resolvedTenantId);
          if (omieErr) {
            toast({ title: "Atenção", description: `Falha ao salvar campos Omie: ${omieErr.message}`, variant: "destructive" });
          }
        }
      }

      if (!produtoTrocou) {
        toast({ title: isEdit ? "Produto atualizado" : "Produto adicionado" });
      }

      // Fluxo de lançamento novo com Omie ativo: oferece o envio ao Omie no fim do fluxo,
      // no momento em que a pessoa sabe que terminou o lançamento. Reaproveita o
      // EnviarOmieComPreviaButton (dry_run → confirmação → criar), o MESMO botão do card do
      // cliente. Antes usava o EnviarContratoOmieButton, que empurra para a fila sem resumo
      // nenhum e só mostra o motivo da recusa no tooltip — o texto ao lado prometia
      // pré-visualização e não havia nenhuma.
      if (!isEdit && !produtoTrocou && omieAtivo && resolvedTenantId) {
        const { data: ctr } = await (supabase.from("contratos" as any) as any)
          .select("id, numero, created_at")
          .eq("cliente_id", clienteId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ctr?.id) {
          setPostSaveContrato({ id: ctr.id as string, numero: (ctr as any).numero ?? null, created_at: (ctr as any).created_at ?? null });
          onSaved();
          return; // não fecha o diálogo — mostra o passo "Enviar ao Omie"
        }
      }

      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!produtoId) {
      toast({ title: "Selecione um produto", variant: "destructive" });
      return;
    }
    if (produtoTrocou) {
      setConfirmSwapOpen(true);
      return;
    }
    await executeSave();
  };

  const modelosContrato = modelosContratoLookup.data ?? [];
  const funcionariosList = funcionariosLookup.data ?? [];
  const origensVenda = origensVendaLookup.data ?? [];
  const formasPagamento = formasPagamentoLookup.data ?? [];

  const handleClosePostSave = () => {
    setPostSaveContrato(null);
    onClose();
  };

  // Mesmo portão que o EnviarContratoOmieButton aplica na lista de contratos: só existe envio
  // manual para contrato criado a partir da data de corte DA CONTA que atende este cliente.
  const dataCorteOmie = contaOmieQ.data?.integrar_a_partir_de ?? null;
  const podeEnviarAoOmie =
    !!dataCorteOmie &&
    !!postSaveContrato?.created_at &&
    postSaveContrato.created_at.slice(0, 10) >= dataCorteOmie.slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={(o) => {
      if (o) return;
      if (postSaveContrato) { handleClosePostSave(); return; }
      onClose();
    }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {/* dialog-height-ok: cadastro de produto tem 23 campos e nao cabe em
            tela nenhuma. Rola por desenho, com cabecalho e rodape fixos. */}
        <DialogHeader>
          <DialogTitle>
            {postSaveContrato
              ? "Produto adicionado — enviar ao Omie?"
              : isEdit ? "Editar Produto" : "Adicionar Produto"}
          </DialogTitle>
        </DialogHeader>

        {postSaveContrato ? (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-4 space-y-2 text-sm">
              <div className="font-medium">Contrato criado com sucesso.</div>
              <div className="text-muted-foreground">
                Contrato Nº <span className="font-medium text-foreground">{postSaveContrato.numero ?? "—"}</span>. A criação no Omie é manual: envie agora se o lançamento estiver completo, ou depois pelo painel de conferência.
              </div>
            </div>
            {podeEnviarAoOmie && resolvedTenantId ? (
              <div className="rounded-md border p-4 space-y-3">
                <div className="text-sm">
                  Ao clicar em <span className="font-medium">Enviar ao Omie</span>, mostramos primeiro um resumo do que será criado (pré-visualização). Nada é enviado sem sua confirmação.
                </div>
                <div className="flex flex-wrap gap-2">
                  <EnviarOmieComPreviaButton
                    tenantId={resolvedTenantId}
                    clienteId={clienteId}
                    contrato={{
                      id: postSaveContrato.id,
                      numero: postSaveContrato.numero,
                      // Contrato recém-criado: o de/para ainda não existe. Se existir mesmo assim
                      // (reenvio), quem detecta é o dry_run, que avisa "JÁ existe e será ATUALIZADO".
                      sincronizado: false,
                      codigo_contrato_omie: null,
                    }}
                  />
                  <Button type="button" variant="ghost" onClick={handleClosePostSave}>
                    Enviar depois
                  </Button>
                </div>
              </div>
            ) : (
              <div className="rounded-md border p-4 text-sm text-muted-foreground">
                Este contrato está fora da data de corte da integração Omie desta unidade, então não
                há envio manual por aqui. Ele aparece no painel de conferência.
              </div>
            )}
            <DialogFooter>
              <Button type="button" onClick={handleClosePostSave}>Concluir</Button>
            </DialogFooter>
          </div>
        ) : (
          <>


        {/* Identificação */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Identificação</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Fornecedor</Label>
              <Select value={fornecedorId || "__none__"} onValueChange={(v) => setFornecedorId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhum —</SelectItem>
                  {fornecedores.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Produto *</Label>
              <Select value={produtoId} onValueChange={setProdutoId} disabled={isEdit && !canSwapProduto}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {produtos.map(p => {
                    // Enquanto o catálogo não chega, nada fica bloqueado — piscar
                    // tudo desabilitado é pior que esperar meio segundo.
                    const faltam = String(p.id) === produtoIdOriginal || !catalogoModulosQ.isSuccess
                      ? []
                      : (faltantesPorProduto[p.id] ?? []);
                    return (
                      <SelectItem key={p.id} value={String(p.id)} disabled={faltam.length > 0}>
                        {p.nome}
                        {faltam.length > 0 && (
                          <span className="text-muted-foreground">
                            {" — sem "}{faltam.slice(0, 2).join(", ")}
                            {faltam.length > 2 ? ` +${faltam.length - 2}` : ""}
                          </span>
                        )}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {isEdit && !canSwapProduto ? (
                <p className="text-xs text-muted-foreground">Apenas admin pode trocar o produto.</p>
              ) : isEdit && modulosNomesForEdit.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Ficam disponíveis os produtos que têm os mesmos {modulosNomesForEdit.length} módulo{modulosNomesForEdit.length > 1 ? "s" : ""} deste.
                  A troca reaponta cada módulo do cliente para o de mesmo nome no produto escolhido.
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <Label>Código Fornecedor</Label>
              <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Link Portal Fornecedor</Label>
              <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
            </div>
          </div>
        </div>

        <Separator />

        {/* Valores */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Valores</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Valor Ativação</Label>
              <NumericInput value={vlrAt} onChange={setVlrAt} decimals={2} placeholder="0,00" suffix="R$" />
            </div>
            <div className="space-y-1">
              <Label>Valor Mensal</Label>
              <NumericInput value={vlrMensal} onChange={setVlrMensal} decimals={2} placeholder="0,00" suffix="R$" />
            </div>
            <div className="space-y-1">
              <Label>Custo Operação</Label>
              <NumericInput value={vlrCusto} onChange={setVlrCusto} decimals={2} placeholder="0,00" suffix="R$" />
            </div>
          </div>
        </div>

        <Separator />

        {/* Pagamento */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Pagamento</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Forma Pag. Ativação</Label>
              <Select value={formaPagAtivacaoId || "__none__"} onValueChange={(v) => setFormaPagAtivacaoId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  {formasPagamento.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Forma Pag. Mensalidade</Label>
              <Select value={formaPagMensalidadeId || "__none__"} onValueChange={(v) => setFormaPagMensalidadeId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  {formasPagamento.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* Vigência & Reajuste */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Vigência & Reajuste</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Data Venda</Label>
              <Input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data Ativação</Label>
              <Input type="date" value={dataAt} onChange={(e) => setDataAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Data Fim</Label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Prazo (meses)</Label>
              <Input
                type="number"
                min={1}
                value={prazoMeses ?? ""}
                onChange={(e) => setPrazoMeses(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
            <div className="space-y-1">
              <Label>Próximo Reajuste</Label>
              <Input
                type="date"
                value={dataProximoReajuste}
                onChange={(ev) => setDataProximoReajuste(ev.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Calculado automaticamente (reajuste anual). Editável caso o cliente tenha data específica.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Dia Vencimento</Label>
              <Input
                type="number"
                min={1}
                max={31}
                value={diaVencimento ?? ""}
                onChange={(e) => setDiaVencimento(e.target.value ? Number(e.target.value) : null)}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Comercial */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Comercial</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Modelo de Contrato</Label>
              <Select value={modeloContratoId || "__none__"} onValueChange={(v) => setModeloContratoId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhum —</SelectItem>
                  {modelosContrato.map(m => <SelectItem key={m.id} value={String(m.id)}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Recorrência</Label>
              <Select value={recorrencia || "__none__"} onValueChange={(v) => setRecorrencia(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="semestral">Semestral</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Vendedor</Label>
              <Select value={funcionarioId || "__none__"} onValueChange={(v) => setFuncionarioId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhum —</SelectItem>
                  {funcionariosList.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Origem da Venda</Label>
              <Select value={origemVendaId || "__none__"} onValueChange={(v) => setOrigemVendaId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Nenhuma —</SelectItem>
                  {origensVenda.map(o => <SelectItem key={o.id} value={String(o.id)}>{o.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <Separator />

        {/* Observações Contratuais */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-muted-foreground">Observações Contratuais</h4>
          <Textarea
            rows={3}
            value={observacoesContratuais}
            onChange={(e) => setObservacoesContratuais(e.target.value)}
          />
        </div>

        <Separator />

        {/* Anexo do contrato */}
        {isEdit && editContratoId ? (
          <ContratoAnexoSection
            contratoId={editContratoId}
            tenantId={resolvedTenantId}
          />
        ) : !isEdit ? (
          <div className="rounded border bg-background/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Paperclip className="h-4 w-4" />
                Anexo do contrato
              </div>
              {canAttach && (
                <>
                  <input
                    ref={stagedFileInputRef}
                    type="file"
                    accept={ANEXO_ACCEPT}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      if (!f) { setStagedFile(null); return; }
                      const err = validateAnexoFile(f);
                      if (err) {
                        toast({ title: "Arquivo inválido", description: err, variant: "destructive" });
                        return;
                      }
                      setStagedFile(f);
                    }}
                  />
                  <div className="flex items-center gap-2">
                    {stagedFile && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => setStagedFile(null)}>
                        Remover
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => stagedFileInputRef.current?.click()}
                    >
                      <Paperclip className="h-4 w-4 mr-1" />
                      {stagedFile ? "Trocar arquivo" : "Selecionar arquivo"}
                    </Button>
                  </div>
                </>
              )}
            </div>
            {!canAttach ? (
              <p className="text-xs text-muted-foreground">
                Somente admin ou head podem anexar o contrato. Peça a um responsável para anexar depois pelo painel do produto.
              </p>
            ) : stagedFile ? (
              <p className="text-xs text-muted-foreground truncate" title={stagedFile.name}>
                Selecionado: <span className="font-medium">{stagedFile.name}</span> — será enviado após criar o produto.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Opcional. Aceito: PDF, JPG, PNG (até 10 MB). O arquivo é enviado logo após o produto ser criado.
              </p>
            )}
          </div>
        ) : null}


        {omieAtivo && (
          <>

            <Separator />
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-muted-foreground">Integração Omie</h4>
              <p className="text-xs text-muted-foreground">
                Valores específicos deste produto. Se vazios, os padrões da integração serão usados.
              </p>
              {omiePadroesQ.isError && (
                <p className="text-xs text-destructive">Não foi possível carregar as opções do Omie.</p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                <div className="space-y-1">
                  <Label>Serviço Omie</Label>
                  <Select
                    value={omieServico || "__default__"}
                    onValueChange={(v) => setOmieServico(v === "__default__" ? "" : v)}
                    disabled={omiePadroesQ.isLoading}
                  >
                    <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">— Usar padrão —</SelectItem>
                      {(omiePadroesQ.data?.servicos ?? []).map((s) => (
                        <SelectItem key={String(s.codigo)} value={String(s.codigo)}>{s.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Conta Corrente</Label>
                  <Select
                    value={omieConta || "__default__"}
                    onValueChange={(v) => setOmieConta(v === "__default__" ? "" : v)}
                    disabled={omiePadroesQ.isLoading}
                  >
                    <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">— Usar padrão —</SelectItem>
                      {(omiePadroesQ.data?.contas ?? []).map((c) => (
                        <SelectItem key={String(c.codigo)} value={String(c.codigo)}>{c.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Tipo de Faturamento</Label>
                  <Select
                    value={omieTipoFat || "__default__"}
                    onValueChange={(v) => setOmieTipoFat(v === "__default__" ? "" : v)}
                    disabled={omiePadroesQ.isLoading}
                  >
                    <SelectTrigger><SelectValue placeholder="Usar padrão" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">— Usar padrão —</SelectItem>
                      {(omiePadroesQ.data?.tipos_faturamento ?? []).map((t) => (
                        <SelectItem key={String(t.codigo)} value={String(t.codigo)}>{t.descricao}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Dia de Faturamento</Label>
                  <Input
                    type="number" min={1} max={31}
                    value={omieDiaFat}
                    onChange={(e) => setOmieDiaFat(e.target.value)}
                    placeholder="1-31"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Número de Parcelas</Label>
                  <Input
                    type="number" min={1}
                    value={omieNumParcelas}
                    onChange={(e) => setOmieNumParcelas(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-2 md:col-span-1">
                  <Label className="text-sm">Permite servidor em nuvem</Label>
                  <Switch checked={omiePermiteNuvem} onCheckedChange={setOmiePermiteNuvem} />
                </div>
              </div>
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground mt-2">

          Se este produto terá módulos detalhados, os valores serão recalculados automaticamente.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
          </Button>
        </DialogFooter>

        <AlertDialog open={confirmSwapOpen} onOpenChange={setConfirmSwapOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                Confirmar troca de produto
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2">
                  <p>Você está prestes a trocar o produto deste registro. Esta ação:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>Atualizará o produto vinculado ao cliente</li>
                    <li>Sobrescreverá a descrição dos itens de contrato apontados</li>
                    {modulosNomesForEdit.length > 0 && (
                      <li>
                        Reapontará {modulosNomesForEdit.length} módulo{modulosNomesForEdit.length > 1 ? "s" : ""} do cliente
                        para o{modulosNomesForEdit.length > 1 ? "s" : ""} de mesmo nome no produto escolhido
                      </li>
                    )}
                    <li><strong>NÃO altera valores</strong> (mensal/ativação) do contrato — revise manualmente se necessário</li>
                  </ul>
                  <p className="text-amber-500 font-medium">
                    Use apenas para correção de erro de cadastro.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel type="button">Cancelar</AlertDialogCancel>
              <AlertDialogAction
                type="button"
                onClick={async () => {
                  setConfirmSwapOpen(false);
                  await executeSave();
                }}
              >
                Trocar produto
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ============ Modulo Dialog ============
function ModuloDialog({
  open, edit, clienteProdutoId, produtoId, tid, lookupTid, clienteId, onClose, onSaved,
  produtoDataAtivacao, produtoFuncionarioId, produtoOrigemVendaId, oemCodigoFilial,
}: {
  open: boolean;
  edit: ClienteProdutoModulo | null;
  clienteProdutoId?: string;
  produtoId?: number;
  tid: string | null;
  // O tenant do cliente — o `tid` global fica null quando o super admin está em
  // "Todos", e aí os catálogos de vendedor e origem viriam vazios.
  lookupTid?: string | null;
  clienteId: string;
  onClose: () => void;
  onSaved: () => void;
  produtoDataAtivacao?: string | null;
  produtoFuncionarioId?: number | null;
  produtoOrigemVendaId?: number | null;
  oemCodigoFilial?: string | null;
}) {
  const isEdit = !!edit;
  const [moduloId, setModuloId] = useState<string>("");
  const [quantidade, setQuantidade] = useState<number>(1);
  const [vlrMensal, setVlrMensal] = useState<number | null>(0);
  const [vlrCusto, setVlrCusto] = useState<number | null>(0);
  const [vlrAtivacao, setVlrAtivacao] = useState<number | null>(0);
  const [dataAt, setDataAt] = useState("");
  const [dataVenda, setDataVenda] = useState("");
  const [funcionarioId, setFuncionarioId] = useState<string>("");
  const [origemVendaId, setOrigemVendaId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useMemo(() => {
    if (open) {
      setModuloId(edit?.modulo_id ?? "");
      setQuantidade(edit?.quantidade ?? 1);
      setVlrMensal(edit?.vlr_mensal ?? 0);
      setVlrCusto(edit?.vlr_custo ?? 0);
      setVlrAtivacao(edit?.vlr_ativacao ?? 0);
      setDataAt(edit?.data_ativacao ?? produtoDataAtivacao ?? "");
      // Módulo novo é venda de hoje, e vendedor/origem herdam do produto — quem
      // vendeu o produto é quem costuma somar o módulo depois. Na edição, nada
      // é inventado: mostra o que está gravado.
      setDataVenda(edit ? (edit.data_venda ?? "") : hojeISO());
      setFuncionarioId(
        edit
          ? (edit.funcionario_id ? String(edit.funcionario_id) : "")
          : (produtoFuncionarioId ? String(produtoFuncionarioId) : "")
      );
      setOrigemVendaId(
        edit
          ? (edit.origem_venda_id ? String(edit.origem_venda_id) : "")
          : (produtoOrigemVendaId ? String(produtoOrigemVendaId) : "")
      );
    }
  }, [open, edit, produtoDataAtivacao, produtoFuncionarioId, produtoOrigemVendaId]);

  const catalogoQuery = useQuery<{ id: string; nome: string; descricao: string | null }[]>({
    queryKey: ["catalogo_modulos_produto", tid, produtoId],
    enabled: !!produtoId && open,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produto_modulos" as any) as any)
        .select("id, nome, descricao")
        .eq("produto_id", produtoId)
        .eq("ativo", true)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  // ------------------------------------------------------------------- OEM
  // Produto vinculado ao OEM tem o custo do módulo DITADO pela grade do
  // parceiro (Integrações › OEM › Módulos). Aqui ele é lido, não digitado:
  // digitar por cima só criaria uma margem que não existe — o próximo upgrade
  // do vínculo devolveria o valor do OEM e o markup mostrado viraria mentira.
  const vinculosOemQuery = useQuery<{
    conta_integration_id: string; produto_codigo: string; produto_nome: string | null;
  }[]>({
    queryKey: ["oem-vinculo-do-produto", produtoId],
    enabled: open && !!produtoId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("oem_produto_vinculo" as any) as any)
        .select("conta_integration_id, produto_codigo, produto_nome, criado_em")
        .eq("produto_id", produtoId)
        .order("criado_em");
      if (error) throw error;
      return (data ?? []) as any;
    },
  });
  const vinculosOem = vinculosOemQuery.data ?? [];

  // O mesmo produto pode estar em mais de uma coluna do OEM (GESTAO LEGAL e
  // FULL), e o módulo custa diferente em cada uma. Quem desempata é a licença
  // do cliente: a filial diz em qual produto do parceiro ela está. Só vale a
  // pena perguntar quando há mais de uma coluna.
  const filialOemQuery = useQuery<string | null>({
    queryKey: ["oem-filial-produto-principal", lookupTid ?? tid, oemCodigoFilial],
    enabled: open && vinculosOem.length > 1 && !!oemCodigoFilial,
    queryFn: async () => {
      // `limit(1)`, não `maybeSingle()`: a filial é única por TENANT, e o super
      // admin em "Todos" enxerga as duas — o maybeSingle erraria com
      // "multiple rows" e a tela perderia a coluna.
      let q = (supabase.from("oem_espelho_filial" as any) as any)
        .select("produto_principal")
        .eq("filial_codigo", oemCodigoFilial as string)
        .limit(1);
      const t = lookupTid ?? tid;
      if (t) q = q.eq("tenant_id", t);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? [])[0]?.produto_principal ?? null) as string | null;
    },
  });

  const colunaOem = useMemo(() => {
    if (vinculosOem.length === 0) return null;
    if (vinculosOem.length === 1) return vinculosOem[0];
    const alvo = normNomeModulo(filialOemQuery.data ?? "");
    // Sem resposta da filial fica a primeira coluna vinculada — a mesma que a
    // tela de Produtos & Módulos abre por padrão.
    if (!alvo) return vinculosOem[0];
    return (
      vinculosOem.find(v =>
        normNomeModulo(v.produto_codigo) === alvo || normNomeModulo(v.produto_nome ?? "") === alvo
      ) ?? vinculosOem[0]
    );
  }, [vinculosOem, filialOemQuery.data]);

  const precosOemQuery = useQuery<{ modulo_nome: string; valor_unitario: number | null }[]>({
    queryKey: ["oem-precos-da-coluna", colunaOem?.conta_integration_id, colunaOem?.produto_codigo],
    enabled: open && !!colunaOem,
    queryFn: async () => {
      const { data, error } = await (supabase.from("oem_espelho_modulo_preco" as any) as any)
        .select("modulo_nome, valor_unitario")
        .eq("conta_integration_id", colunaOem!.conta_integration_id)
        .eq("produto_codigo", colunaOem!.produto_codigo);
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  // Casa pelo nome normalizado, como fn_norm_nome_modulo faz do lado do banco.
  const custoOemPorModulo = useMemo(() => {
    const m = new Map<string, number>();
    for (const linha of precosOemQuery.data ?? []) {
      m.set(normNomeModulo(linha.modulo_nome), Number(linha.valor_unitario) || 0);
    }
    return m;
  }, [precosOemQuery.data]);

  const nomeModuloSelecionado = catalogoQuery.data?.find(m => m.id === moduloId)?.nome ?? "";
  const custoOem = moduloId && nomeModuloSelecionado
    ? custoOemPorModulo.get(normNomeModulo(nomeModuloSelecionado))
    : undefined;
  // Módulo que não está na grade do parceiro continua digitável: pode ser um
  // serviço que só o DoctorSaaS cobra.
  const custoTravadoPeloOem = custoOem !== undefined;

  useEffect(() => {
    // Só na inclusão. Na edição o que vale é o que está gravado — puxar a
    // grade aqui mudaria em silêncio o custo de um módulo já vendido.
    if (!open || isEdit || custoOem === undefined) return;
    setVlrCusto(custoOem);
  }, [open, isEdit, custoOem]);

  const funcionariosQuery = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["funcionarios_lookup", lookupTid],
    enabled: open && !!lookupTid,
    queryFn: async () => {
      let q = (supabase.from("funcionarios" as any) as any).select("id, nome").order("nome");
      if (lookupTid) q = q.eq("tenant_id", lookupTid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const origensVendaQuery = useQuery<{ id: number; nome: string }[]>({
    queryKey: ["origens_venda_lookup", lookupTid],
    enabled: open && !!lookupTid,
    queryFn: async () => {
      let q = (supabase.from("origens_venda" as any) as any).select("id, nome").order("nome");
      if (lookupTid) q = q.eq("tenant_id", lookupTid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any;
    },
  });

  const handleSave = async () => {
    if (!moduloId) {
      toast({ title: "Selecione um módulo", variant: "destructive" });
      return;
    }
    setSaving(true);
    let novoModuloId: string | null = null;
    let upsellFalhou = false;
    try {
      const payload: any = {
        quantidade: quantidade || 1,
        vlr_mensal: vlrMensal || 0,
        vlr_custo: vlrCusto || 0,
        vlr_ativacao: vlrAtivacao || 0,
        data_ativacao: dataAt || null,
        data_venda: dataVenda || null,
        funcionario_id: funcionarioId ? Number(funcionarioId) : null,
        origem_venda_id: origemVendaId ? Number(origemVendaId) : null,
      };
      if (isEdit && edit) {
        const { error } = await (supabase.from("cliente_produto_modulos" as any) as any)
          .update(payload).eq("id", edit.id);
        if (error) throw error;
      } else {
        const { data: novo, error } = await (supabase.from("cliente_produto_modulos" as any) as any).insert({
          ...payload,
          tenant_id: tid,
          cliente_produto_id: clienteProdutoId,
          modulo_id: moduloId,
          ativo: true,
        }).select("id").single();
        if (error) throw error;
        novoModuloId = (novo as any)?.id ?? null;
      }

      // O upsell é gravado direto, sem perguntar: somar módulo pago É a venda, e
      // deixar isso numa confirmação opcional era o caminho para o MRR ficar
      // atrás da ficha do cliente. Falha aqui não desfaz o módulo — o módulo já
      // está certo; quem falta é o movimento, e o aviso diz isso.
      if (!isEdit && (vlrMensal || 0) > 0) {
        const qtd = quantidade || 1;
        const nomeModulo = catalogoQuery.data?.find(m => m.id === moduloId)?.nome ?? "módulo";
        const { error: mrrError } = await supabase.from("movimentos_mrr").insert({
          tenant_id: tid,
          cliente_id: clienteId,
          tipo: "upsell",
          data_movimento: dataVenda || hojeISO(),
          valor_delta: (vlrMensal || 0) * qtd,
          custo_delta: (vlrCusto || 0) * qtd,
          descricao: qtd > 1 ? `Adição de ${qtd} ${nomeModulo}` : `Adição de ${nomeModulo}`,
          cliente_produto_modulo_id: novoModuloId,
          funcionario_id: funcionarioId ? Number(funcionarioId) : null,
          // movimentos_mrr.origem_venda é texto (o nome), não o id — é assim que
          // o MovimentosMrrModal grava e o relatório de vendas lê.
          origem_venda: origensVendaQuery.data?.find(o => String(o.id) === origemVendaId)?.nome ?? null,
          status: "ativo",
        } as any);
        if (mrrError) {
          toast({
            variant: "destructive",
            title: "Módulo salvo, mas o upsell não entrou",
            description: `${mrrError.message} — registre o movimento à mão em Movimentos MRR.`,
          });
          upsellFalhou = true;
        }
      }

      if (!upsellFalhou) toast({ title: isEdit ? "Módulo atualizado" : "Módulo adicionado" });
      onSaved();
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao salvar", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Módulo" : "Adicionar Módulo"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1 md:col-span-2">
            <Label>Módulo *</Label>
            <Select value={moduloId} onValueChange={setModuloId} disabled={isEdit}>
              <SelectTrigger>
                <SelectValue placeholder={catalogoQuery.isLoading ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                {(catalogoQuery.data ?? []).map(m => (
                  <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={1}
              step={1}
              value={quantidade}
              onChange={(e) => setQuantidade(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            />
          </div>
          <div className="space-y-1">
            <Label>Valor Mensal (unit.)</Label>
            <NumericInput value={vlrMensal} onChange={setVlrMensal} suffix="R$" />
          </div>
          <div className="space-y-1">
            <Label>Valor Custo (unit.)</Label>
            <NumericInput value={vlrCusto} onChange={setVlrCusto} suffix="R$" disabled={custoTravadoPeloOem} />
            {custoTravadoPeloOem && (
              <p className="text-xs text-muted-foreground">
                Custo de tabela do OEM{colunaOem?.produto_nome ? ` · ${colunaOem.produto_nome}` : ""} — não editável aqui.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Valor Ativação</Label>
            <NumericInput value={vlrAtivacao} onChange={setVlrAtivacao} suffix="R$" />
          </div>
          <div className="space-y-1">
            <Label>Data Ativação</Label>
            <Input type="date" value={dataAt} onChange={(e) => setDataAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Data da Venda</Label>
            <Input type="date" value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Vendedor</Label>
            <Select value={funcionarioId || "__none__"} onValueChange={(v) => setFuncionarioId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder={funcionariosQuery.isLoading ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nenhum —</SelectItem>
                {(funcionariosQuery.data ?? []).map(f => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Origem da Venda</Label>
            <Select value={origemVendaId || "__none__"} onValueChange={(v) => setOrigemVendaId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder={origensVendaQuery.isLoading ? "Carregando..." : "Selecione"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nenhuma —</SelectItem>
                {(origensVendaQuery.data ?? []).map(o => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2 rounded-md border bg-muted/30 p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Total do módulo ({quantidade}×)</span>
            <span className="font-semibold">
              Mensal: <span className="text-primary">R$ {fmtBRL((Number(vlrMensal) || 0) * (quantidade || 1))}</span>
              {"  ·  "}
              Custo: <span className="text-muted-foreground">R$ {fmtBRL((Number(vlrCusto) || 0) * (quantidade || 1))}</span>
              {"  ·  "}
              Markup: <span className="text-muted-foreground">{fmtMarkup(Number(vlrMensal) || 0, Number(vlrCusto) || 0)}</span>
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
