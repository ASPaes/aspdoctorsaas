import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, Loader2, MessagesSquare, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter, SEM_CATEGORIA_ID } from "@/contexts/AtendimentoFilterContext";
import { AttendanceChatHistoryModal } from "@/components/tickets/AttendanceChatHistoryModal";
import { exportChatsDaCelulaXlsx } from "@/lib/exportLatenciaXlsx";
import { fmtDur } from "./fmtDuracao";
import { cn } from "@/lib/utils";

/** A célula clicada: agente + categoria (null = coluna "Sem categoria"). */
export interface CelulaSelecionada {
  agentId: string;
  agente: string;
  categoryId: string | null;
  categoria: string;
}

interface ChatDaCelula {
  attendance_id: string;
  attendance_code: string | null;
  conversation_id: string | null;
  contato: string;
  cliente_nome: string | null;
  opened_at: string;
  closed_at: string | null;
  handle_seconds: number | null;
  no_calculo: boolean;
  categoria: string | null;
  subcategoria: string | null;
  is_group: boolean;
}

interface ChatsDaCelula {
  total: number;
  tma_p50: number | null;
  truncado: boolean;
  por_subcategoria: { subcategoria: string; qtd: number }[];
  itens: ChatDaCelula[];
}

function fmtData(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Os chats que formaram uma célula do quadro Agente × Categoria (DEM-0315).
 * A RPC copia o recorte do scorecard, então total e TMA fecham com a célula.
 * Recebe os mesmos filtros globais da aba; a subcategoria global só vale para
 * célula de categoria (não existe subcategoria sem categoria).
 */
export function AgenteCategoriaChatsDialog({
  celula, onClose,
}: { celula: CelulaSelecionada | null; onClose: () => void }) {
  const navigate = useNavigate();
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { dateRange, departmentId, tipoAtendimento, plantao, subcategoryIds } = useAtendimentoFilter();
  const [subAtiva, setSubAtiva] = useState<string | null>(null);
  const [chatAberto, setChatAberto] = useState<ChatDaCelula | null>(null);

  const categoryIds = celula ? [celula.categoryId ?? SEM_CATEGORIA_ID] : [];
  const subs = celula?.categoryId ? subcategoryIds : [];

  const { data, isLoading, isError } = useQuery<ChatsDaCelula>({
    queryKey: ["atendimento-agente-categoria-chats", tid, celula?.agentId, celula?.categoryId,
      dateRange.from.toISOString(), dateRange.to.toISOString(), viewKey, departmentId, tipoAtendimento, plantao, subs],
    enabled: !!celula && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_agente_categoria_chats", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_agent_id: celula!.agentId,
        p_department_id: departmentId ?? null,
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_is_group: tipoAtendimento === "all" ? null : tipoAtendimento === "group",
        p_plantao: plantao === "all" ? null : plantao,
        p_category_ids: categoryIds,
        p_subcategory_ids: subs.length ? subs : null,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return {
        total: Number(d.total ?? 0),
        tma_p50: d.tma_p50 === null || d.tma_p50 === undefined ? null : Number(d.tma_p50),
        truncado: !!d.truncado,
        por_subcategoria: ((d.por_subcategoria ?? []) as any[]).map((s) => ({ subcategoria: String(s.subcategoria), qtd: Number(s.qtd ?? 0) })),
        itens: ((d.itens ?? []) as any[]).map((i) => ({
          attendance_id: String(i.attendance_id),
          attendance_code: i.attendance_code ?? null,
          conversation_id: i.conversation_id ?? null,
          contato: String(i.contato ?? "Sem nome"),
          cliente_nome: i.cliente_nome ?? null,
          opened_at: String(i.opened_at),
          closed_at: i.closed_at ?? null,
          handle_seconds: i.handle_seconds === null || i.handle_seconds === undefined ? null : Number(i.handle_seconds),
          no_calculo: i.no_calculo === true,
          categoria: i.categoria ?? null,
          subcategoria: i.subcategoria ?? null,
          is_group: i.is_group === true,
        })),
      };
    },
  });

  const itens = useMemo(
    () => (data?.itens ?? []).filter((i) => !subAtiva || i.subcategoria === subAtiva),
    [data, subAtiva],
  );

  const fechar = () => {
    setSubAtiva(null);
    onClose();
  };

  return (
    <>
      <Dialog open={!!celula} onOpenChange={(v) => !v && fechar()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessagesSquare className="h-4 w-4" />
              {celula ? `${celula.agente} · ${celula.categoria}` : ""}
            </DialogTitle>
            <DialogDescription>
              {data
                ? `${data.total.toLocaleString("pt-BR")} atendimento(s) · TMA ${fmtDur(data.tma_p50)}. Os mesmos filtros da aba. Mais longos primeiro.`
                : "Os atendimentos que formam a célula, com os mesmos filtros da aba."}
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="py-8 text-center text-sm text-destructive">Erro ao carregar a lista.</div>
          ) : !data || data.itens.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Nenhum atendimento nesta célula.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.por_subcategoria.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSubAtiva(null)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                        subAtiva === null ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
                      )}
                    >
                      Todas
                    </button>
                    {data.por_subcategoria.map((s) => (
                      <button
                        key={s.subcategoria}
                        type="button"
                        onClick={() => setSubAtiva(subAtiva === s.subcategoria ? null : s.subcategoria)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                          subAtiva === s.subcategoria ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:bg-muted/50",
                        )}
                      >
                        {s.subcategoria} <span className="tabular-nums">{s.qtd}</span>
                      </button>
                    ))}
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  onClick={() =>
                    celula && exportChatsDaCelulaXlsx({
                      agente: celula.agente, categoria: celula.categoria, itens, from: dateRange.from, to: dateRange.to,
                    })
                  }
                >
                  <Download className="h-4 w-4" />
                  Exportar XLSX
                </Button>
              </div>

              <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
                {itens.map((i) => (
                  <li key={i.attendance_id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setChatAberto(i)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-muted/50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {i.is_group && <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                          <span className="truncate text-sm font-medium">{i.cliente_nome ?? i.contato}</span>
                          {i.attendance_code && (
                            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{i.attendance_code}</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {i.categoria && (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5">
                              {i.subcategoria ? `${i.categoria} › ${i.subcategoria}` : i.categoria}
                            </span>
                          )}
                          <span className="truncate">{fmtData(i.opened_at)}{i.cliente_nome ? ` · ${i.contato}` : ""}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm tabular-nums">{fmtDur(i.handle_seconds)}</div>
                        {!i.no_calculo && (
                          <div className="text-[11px] text-muted-foreground" title="Fora do teto do TMA: não entra na mediana">
                            fora do cálculo
                          </div>
                        )}
                      </div>
                    </button>
                    {i.conversation_id && (
                      <button
                        type="button"
                        onClick={() => { fechar(); navigate(`/whatsapp?conversation=${i.conversation_id}`); }}
                        title="Abrir o chat ao vivo"
                        className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {data.truncado && (
                <p className="pt-1 text-xs text-muted-foreground">
                  Mostrando os {data.itens.length.toLocaleString("pt-BR")} mais longos de {data.total.toLocaleString("pt-BR")}.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AttendanceChatHistoryModal
        open={chatAberto !== null}
        onOpenChange={(v) => !v && setChatAberto(null)}
        conversationId={chatAberto?.conversation_id ?? null}
        attendanceCode={chatAberto?.attendance_code ?? ""}
        contactName={chatAberto?.contato}
        openedAt={chatAberto?.opened_at ?? null}
        closedAt={chatAberto?.closed_at ?? null}
      />
    </>
  );
}
