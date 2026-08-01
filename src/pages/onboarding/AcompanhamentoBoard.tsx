import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Building2, CalendarDays } from "lucide-react";

export interface AcompanhamentoStage {
  id: string;
  nome: string;
  cor: string | null;
}

interface TicketRow {
  id: string;
  ticket_code: string | null;
  assunto: string | null;
  descricao: string | null;
  aberto_em: string;
  acompanhamento_stage_id: string | null;
  cliente_id: string | null;
  clientes?: { nome_fantasia: string | null; razao_social: string | null } | null;
}

const ACOMP_BOARD_KEY = "onb-acompanhamento-board";

function diasDesde(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * Quadro da jornada de Acompanhamento.
 *
 * Diferente das outras abas: aqui o cartão é um TICKET (`support_tickets.is_acompanhamento`),
 * não uma jornada. Por isso a etapa vem de `acompanhamento_stage_id` e o arrasto chama
 * `move_acompanhamento_stage`, não `move_onboarding_stage`.
 */
export default function AcompanhamentoBoard({
  stages,
  tenantId,
  busca,
  onOpenTicket,
}: {
  stages: AcompanhamentoStage[];
  tenantId: string | null;
  busca: string;
  onOpenTicket: (ticketId: string) => void;
}) {
  const qc = useQueryClient();
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const { data: tickets = [] } = useQuery({
    queryKey: [ACOMP_BOARD_KEY, tenantId],
    enabled: !!tenantId,
    queryFn: async () =>
      fetchAllRows<TicketRow>(() =>
        (supabase.from("support_tickets" as any) as any)
          .select("id, ticket_code, assunto, descricao, aberto_em, acompanhamento_stage_id, cliente_id, clientes:cliente_id(nome_fantasia, razao_social)")
          .eq("tenant_id", tenantId)
          .eq("is_acompanhamento", true)
          .is("concluido_em", null)
          .is("deleted_at", null)
          .order("aberto_em", { ascending: false }),
      ),
  });

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return tickets;
    return tickets.filter((t) => {
      const cliente = t.clientes?.nome_fantasia || t.clientes?.razao_social || "";
      return (
        (t.ticket_code ?? "").toLowerCase().includes(termo) ||
        (t.assunto ?? "").toLowerCase().includes(termo) ||
        cliente.toLowerCase().includes(termo)
      );
    });
  }, [tickets, busca]);

  const porEtapa = useMemo(() => {
    const m: Record<string, TicketRow[]> = {};
    filtrados.forEach((t) => {
      const k = t.acompanhamento_stage_id ?? "__sem_etapa__";
      (m[k] ||= []).push(t);
    });
    return m;
  }, [filtrados]);

  async function handleDrop(ticketId: string, stageId: string) {
    const atual = tickets.find((t) => t.id === ticketId);
    if (!atual || atual.acompanhamento_stage_id === stageId) return;

    // otimista: o cartão muda de coluna antes do round-trip
    qc.setQueryData([ACOMP_BOARD_KEY, tenantId], (old: TicketRow[] | undefined) =>
      (old ?? []).map((t) => (t.id === ticketId ? { ...t, acompanhamento_stage_id: stageId } : t)),
    );

    const { data, error } = await (supabase.rpc as any)("move_acompanhamento_stage", {
      p_ticket_id: ticketId,
      p_stage_id: stageId,
    });
    if (error || !data?.ok) {
      toast.error(error?.message ?? "Não foi possível mover o acompanhamento");
      qc.invalidateQueries({ queryKey: [ACOMP_BOARD_KEY] });
    }
  }

  return (
    <div className="flex-1 overflow-x-auto p-4">
      <div className="flex flex-row gap-3 min-h-full pb-2">
        {stages.map((col) => {
          const items = porEtapa[col.id] ?? [];
          const cor = col.cor ?? "#6B7280";
          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverCol(col.id);
              }}
              onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("ticketId");
                if (id) handleDrop(id, col.id);
                setDragOverCol(null);
              }}
              className={`flex flex-col min-w-[280px] w-[280px] rounded-lg border border-border bg-muted/20 transition-all ${
                dragOverCol === col.id ? "ring-2 ring-primary/60" : ""
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border rounded-t-lg">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: cor }} />
                <span className="text-xs font-medium truncate">{col.nome}</span>
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {items.length}
                </Badge>
              </div>

              <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[75vh]">
                {items.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground/50 py-6">
                    Nenhum acompanhamento aqui
                  </div>
                ) : (
                  items.map((t) => {
                    const cliente = t.clientes?.nome_fantasia || t.clientes?.razao_social || "—";
                    const dias = diasDesde(t.aberto_em);
                    return (
                      <div
                        key={t.id}
                        draggable
                        onDragStart={(e) => e.dataTransfer.setData("ticketId", t.id)}
                        onClick={() => onOpenTicket(t.id)}
                        className="bg-card border border-border rounded-md p-2.5 cursor-pointer hover:border-primary/60 transition-all"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <TrendingUp className="h-3 w-3 shrink-0 text-[hsl(199_89%_48%)]" />
                          <span className="font-mono text-[11px] text-primary font-semibold">
                            {t.ticket_code ?? "—"}
                          </span>
                          <span className="ml-auto inline-flex items-center gap-1 text-[9px] text-muted-foreground">
                            <CalendarDays className="h-2.5 w-2.5" />
                            {dias === 0 ? "hoje" : `${dias}d`}
                          </span>
                        </div>

                        <p className="text-xs text-foreground truncate flex items-center gap-1">
                          <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
                          {cliente}
                        </p>

                        {t.descricao && (
                          <p className="text-[10px] text-muted-foreground truncate mt-1">{t.descricao}</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
