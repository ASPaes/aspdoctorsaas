import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Bot, Inbox, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ClassifyClosureModal } from "@/components/tickets/ClassifyClosureModal";

type PendingClosure = {
  attendance_id: string;
  attendance_code: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  assigned_to: string | null;
  agent_name: string | null;
  department_name: string | null;
  closure_type: string;
  closed_at: string;
  ai_summary: string | null;
  ai_category: string | null;
  msg_customer_count: number;
  msg_agent_count: number;
};



function formatDate(s: string) {
  try {
    return new Date(s).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function ClosureTypeBadge({ type }: { type: string }) {
  if (type === "inactivity_auto") {
    return (
      <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20">
        Inatividade
      </Badge>
    );
  }
  if (type === "silent") {
    return (
      <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30 hover:bg-orange-500/20">
        Silencioso
      </Badge>
    );
  }
  return <Badge variant="secondary">{type}</Badge>;
}

export function PendingClosuresTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const qc = useQueryClient();

  const [dateRange, setDateRange] = useState({ from: subDays(new Date(), 7), to: new Date() });
  const [agenteFilter, setAgenteFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [classifyTarget, setClassifyTarget] = useState<PendingClosure | null>(null);
  const [bulkMode, setBulkMode] = useState(false);

  const { data: agentes = [] } = useQuery({
    queryKey: ["pending_closures_agents", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("profiles" as any) as any)
        .select("user_id, funcionario:funcionarios!profiles_funcionario_id_fkey(id, nome, ativo)")
        .eq("tenant_id", tid)
        .not("funcionario_id", "is", null);
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((r) => r.funcionario?.ativo !== false && r.funcionario?.nome)
        .map((r) => ({ user_id: r.user_id as string, nome: r.funcionario.nome as string }))
        .sort((a, b) => a.nome.localeCompare(b.nome));
    },
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["pending_closures", tid, agenteFilter, dateRange.from.toISOString(), dateRange.to.toISOString()],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_pending_closures", {
        p_limit: 50,
        p_offset: 0,
        p_agent_id: agenteFilter || null,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: new Date(dateRange.to.getFullYear(), dateRange.to.getMonth(), dateRange.to.getDate(), 23, 59, 59).toISOString(),
      });
      if (error) throw error;
      return (data ?? []) as PendingClosure[];
    },
  });
      });
      if (error) throw error;
      return (data ?? []) as PendingClosure[];
    },
  });

  const toggleOne = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["pending_closures"] });
  };

  const fetchClienteProduto = async (clienteId: string | null): Promise<number | null> => {
    if (!clienteId) return null;
    try {
      const { data } = await (supabase.from("clientes" as any) as any)
        .select("produto_id")
        .eq("id", clienteId)
        .maybeSingle();
      return (data?.produto_id as number | null) ?? null;
    } catch {
      return null;
    }
  };

  const [clienteProdutoId, setClienteProdutoId] = useState<number | null>(null);

  const openClassifyOne = async (item: PendingClosure) => {
    const pid = await fetchClienteProduto(item.cliente_id);
    setClienteProdutoId(pid);
    setBulkMode(false);
    setClassifyTarget(item);
  };

  const openClassifyBulk = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const first = items.find((i) => i.attendance_id === ids[0]);
    if (!first) return;
    const pid = await fetchClienteProduto(first.cliente_id);
    setClienteProdutoId(pid);
    setBulkMode(true);
    setClassifyTarget(first);
  };

  const handleClassifiedFirst = async (firstParams?: {
    p_produto_id: number;
    p_category_id: string;
    p_subcategory_id: string;
    p_service_type_id: string;
    p_observacao_agente: string | null;
    p_tipo_horario: string;
  }) => {
    // Single mode: nothing extra, just invalidate
    if (!bulkMode || !firstParams) {
      invalidate();
      return;
    }
    // Bulk: replicate to remaining selected (skip first which was already created by modal)
    const ids = Array.from(selected);
    const rest = ids.slice(1);
    let ok = 1;
    let fail = 0;
    for (const aid of rest) {
      try {
        const { error } = await (supabase.rpc as any)("create_ticket_from_closure", {
          p_attendance_id: aid,
          ...firstParams,
        });
        if (error) throw error;
        ok++;
      } catch {
        fail++;
      }
    }
    toast.success(`${ok} atendimento(s) classificado(s)${fail ? `, ${fail} com erro` : ""}`);
    clearSelection();
    invalidate();
  };

  const dismissOne = async (item: PendingClosure) => {
    if (!confirm("Dispensar este atendimento?")) return;
    try {
      const { error } = await (supabase.rpc as any)("dismiss_pending_closure", {
        p_attendance_id: item.attendance_id,
        p_motivo: "Não relevante",
      });
      if (error) throw error;
      toast.success("Atendimento dispensado");
      invalidate();
    } catch (err: any) {
      toast.error("Erro ao dispensar: " + (err?.message || "desconhecido"));
    }
  };

  const dismissBulk = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Dispensar ${ids.length} atendimento(s)?`)) return;
    setBulkBusy(true);
    let ok = 0;
    let fail = 0;
    for (const aid of ids) {
      try {
        const { error } = await (supabase.rpc as any)("dismiss_pending_closure", {
          p_attendance_id: aid,
          p_motivo: "Não relevante",
        });
        if (error) throw error;
        ok++;
      } catch {
        fail++;
      }
    }
    setBulkBusy(false);
    toast.success(`${ok} dispensado(s)${fail ? `, ${fail} com erro` : ""}`);
    clearSelection();
    invalidate();
  };

  const selectedCount = selected.size;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Pendentes de Classificação</h2>
        <Badge variant="secondary">{items.length}</Badge>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
            <SelectItem value="all">Tudo</SelectItem>
          </SelectContent>
        </Select>

        <Select value={agenteFilter || "_all"} onValueChange={(v) => setAgenteFilter(v === "_all" ? "" : v)}>
          <SelectTrigger className="h-9 w-[220px]">
            <SelectValue placeholder="Todos os agentes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">Todos os agentes</SelectItem>
            {agentes.map((a) => (
              <SelectItem key={a.user_id} value={a.user_id}>
                {a.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk actions bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
          <Badge>{selectedCount} selecionado(s)</Badge>
          <Button size="sm" onClick={openClassifyBulk} disabled={bulkBusy}>
            Classificar selecionados
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={dismissBulk}
            disabled={bulkBusy}
          >
            {bulkBusy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Dispensar selecionados
          </Button>
          <Button size="sm" variant="ghost" onClick={clearSelection} disabled={bulkBusy}>
            Limpar seleção
          </Button>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-muted-foreground">
          <Inbox className="h-10 w-10" />
          <p className="text-sm">Nenhum atendimento pendente de classificação</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isSel = selected.has(item.attendance_id);
            return (
              <div
                key={item.attendance_id}
                className="flex gap-3 rounded-lg border bg-card p-4 transition hover:border-primary/40"
              >
                <div className="pt-1">
                  <Checkbox
                    checked={isSel}
                    onCheckedChange={() => toggleOne(item.attendance_id)}
                  />
                </div>

                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-primary">{item.attendance_code}</span>
                    <ClosureTypeBadge type={item.closure_type} />
                    <span className="text-xs text-muted-foreground">{formatDate(item.closed_at)}</span>
                  </div>

                  <div className="flex flex-wrap gap-x-2 text-sm min-w-0">
                    <span className="font-medium truncate">{item.contact_name || "Sem nome"}</span>
                    <span className="text-muted-foreground">{item.contact_phone}</span>
                    <span className="text-muted-foreground">·</span>
                    <span className="text-muted-foreground truncate">
                      {item.cliente_nome || "Sem cliente"}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {item.agent_name || "Sem agente"}
                    {item.department_name ? ` · ${item.department_name}` : ""}
                  </div>

                  {item.ai_summary && (
                    <div className="flex gap-1.5 pt-1">
                      <Bot className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground italic line-clamp-2">
                        {item.ai_summary}
                      </p>
                    </div>
                  )}

                  <div className="text-xs text-muted-foreground pt-0.5">
                    {item.msg_customer_count} msgs cliente · {item.msg_agent_count} msgs agente
                  </div>
                </div>

                <div className="flex flex-col gap-1 shrink-0">
                  <Button size="sm" onClick={() => openClassifyOne(item)}>
                    Classificar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => dismissOne(item)}
                  >
                    Dispensar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {classifyTarget && (
        <ClassifyClosureModal
          open={!!classifyTarget}
          onOpenChange={(o) => {
            if (!o) {
              setClassifyTarget(null);
              setBulkMode(false);
            }
          }}
          attendanceId={classifyTarget.attendance_id}
          contactName={classifyTarget.contact_name}
          clienteName={classifyTarget.cliente_nome || undefined}
          clienteProdutoId={clienteProdutoId}
          aiSummary={classifyTarget.ai_summary}
          onCreated={() => {
            // Single classify: just invalidate. Bulk: modal handles first; we can't capture
            // the params here, so for bulk mode we invalidate and clear (best-effort).
            if (bulkMode) {
              toast.success("Primeiro atendimento classificado. Replique manualmente os demais se necessário.");
              clearSelection();
            }
            handleClassifiedFirst();
          }}
        />
      )}
    </div>
  );
}
