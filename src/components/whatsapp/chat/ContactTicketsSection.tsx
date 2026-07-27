import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight, Ticket, Loader2, Rocket } from "lucide-react";
import { SupportTicketDetailDialog } from "@/components/tickets/SupportTicketDetailDialog";
import { useOnboardingAccess } from "@/hooks/useOnboardingAccess";

// Pesado (~3k linhas) e só usado quando o ticket é de onboarding — fora do chunk do chat.
const JourneyDetailSheet = lazy(() => import("@/pages/onboarding/JourneyDetailSheet"));

interface Props {
  clienteId: string | null | undefined;
}

/** Jornada de onboarding vinculada a um ticket. `tenantId` vem da própria jornada
 *  (e não do filtro global) para funcionar com super admin em "Todos os tenants". */
interface JourneyRef {
  journeyId: string;
  tenantId: string | null;
}

interface TicketRow {
  id: string;
  ticket_code: string | null;
  assunto: string | null;
  descricao: string | null;
  prioridade: string | null;
  canal_origem: string | null;
  aberto_em: string | null;
  concluido_em: string | null;
  status_id: string | null;
  responsavel_user_id: string | null;
  status?: { name: string | null; color: string | null; is_terminal: boolean | null } | null;
}

const PRIORITY_CLASSES: Record<string, string> = {
  baixa: "bg-muted text-muted-foreground",
  media: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  alta: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  urgente: "bg-red-500/10 text-red-600 dark:text-red-400",
};

function useClienteTickets(clienteId: string | null | undefined, limit?: number) {
  return useQuery({
    queryKey: ["contact-tickets", clienteId, limit ?? "all"],
    enabled: !!clienteId,
    queryFn: async () => {
      let q = (supabase.from("support_tickets" as any) as any)
        .select(
          "id, ticket_code, assunto, descricao, prioridade, canal_origem, aberto_em, concluido_em, status_id, responsavel_user_id, status:status_id(name, color, is_terminal)"
        )
        .eq("cliente_id", clienteId)
        .is("deleted_at", null)
        .order("aberto_em", { ascending: false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as TicketRow[];
    },
    staleTime: 30_000,
  });
}

/** Mapa ticket_id → jornada, para saber qual modal abrir.
 *  Não existe flag no ticket (`canal_origem` é 'whatsapp' também nos de onboarding):
 *  o único discriminador é existir linha em `onboarding_journeys.ticket_id`. */
function useClienteJourneys(clienteId: string | null | undefined) {
  return useQuery({
    queryKey: ["contact-ticket-journeys", clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journeys" as any) as any)
        .select("id, ticket_id, tenant_id")
        .eq("cliente_id", clienteId)
        .not("ticket_id", "is", null);
      if (error) throw error;
      const map: Record<string, JourneyRef> = {};
      for (const r of (data || []) as any[]) {
        map[r.ticket_id as string] = { journeyId: r.id as string, tenantId: (r.tenant_id as string) ?? null };
      }
      return map;
    },
    staleTime: 60_000,
  });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  } catch {
    return "—";
  }
}

function TicketItem({
  t,
  expanded,
  isOnboarding,
  onToggle,
  onOpen,
}: {
  t: TicketRow;
  expanded: boolean;
  isOnboarding: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-1.5 p-2 text-left hover:bg-muted/60 transition-colors min-w-0"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 mt-0.5 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-mono text-[10px] font-semibold text-primary shrink-0">
              {t.ticket_code || "—"}
            </span>
            {isOnboarding && (
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1 shrink-0 gap-0.5 border-sky-500/40 text-sky-600 dark:text-sky-400"
              >
                <Rocket className="h-2.5 w-2.5" />
                Onboarding
              </Badge>
            )}
            {t.status?.name && (
              <Badge
                variant="outline"
                className="text-[9px] h-4 px-1 shrink-0"
                style={t.status.color ? { borderColor: t.status.color, color: t.status.color } : undefined}
              >
                {t.status.name}
              </Badge>
            )}
          </div>
          <p className="text-xs truncate mt-0.5" title={t.assunto || ""}>
            {t.assunto || "(sem assunto)"}
          </p>
        </div>
      </button>
      {expanded && (
        <div className="px-2 pb-2 pt-1 border-t border-border/60 space-y-1.5 text-[11px] min-w-0">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1">
            <div className="min-w-0">
              <span className="text-muted-foreground">Aberto:</span>{" "}
              <span className="font-medium">{formatDate(t.aberto_em)}</span>
            </div>
            <div className="min-w-0">
              <span className="text-muted-foreground">Concluído:</span>{" "}
              <span className="font-medium">{formatDate(t.concluido_em)}</span>
            </div>
            <div className="min-w-0">
              <span className="text-muted-foreground">Prioridade:</span>{" "}
              {t.prioridade ? (
                <Badge
                  variant="outline"
                  className={`text-[9px] h-4 px-1 capitalize ${PRIORITY_CLASSES[t.prioridade] || ""}`}
                >
                  {t.prioridade}
                </Badge>
              ) : (
                <span>—</span>
              )}
            </div>
            <div className="min-w-0">
              <span className="text-muted-foreground">Canal:</span>{" "}
              <span className="font-medium capitalize">{t.canal_origem || "—"}</span>
            </div>
          </div>
          {t.descricao && (
            <p
              className="text-[11px] text-muted-foreground line-clamp-3 whitespace-pre-wrap break-words"
              style={{ overflowWrap: "anywhere" }}
            >
              {t.descricao}
            </p>
          )}
          <div className="flex justify-end pt-1">
            <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={onOpen}>
              {isOnboarding ? "Abrir onboarding" : "Abrir ticket"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ContactTicketsSection({ clienteId }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [allExpandedId, setAllExpandedId] = useState<string | null>(null);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [openJourney, setOpenJourney] = useState<JourneyRef | null>(null);

  const { data: recent = [], isLoading } = useClienteTickets(clienteId, 3);
  const { data: all = [], isLoading: loadingAll } = useClienteTickets(allOpen ? clienteId : null);
  const { data: journeyByTicket = {} } = useClienteJourneys(clienteId);
  const { canAccess: canOnboarding } = useOnboardingAccess();

  // Ticket de onboarding abre a jornada; sem acesso ao módulo, cai no modal de atendimento
  // (e aí o badge também some, para o rótulo bater com o que realmente abre).
  const isOnboardingTicket = (ticketId: string) => canOnboarding && !!journeyByTicket[ticketId];

  const openTicket = (ticketId: string) => {
    const j = journeyByTicket[ticketId];
    if (j && canOnboarding) setOpenJourney(j);
    else setOpenTicketId(ticketId);
  };

  if (!clienteId) {
    return (
      <p className="text-xs text-muted-foreground">
        Vincule um cliente para ver o histórico de tickets.
      </p>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Carregando tickets...
      </div>
    );
  }

  if (recent.length === 0) {
    return <p className="text-xs text-muted-foreground">Nenhum ticket registrado para este cliente.</p>;
  }

  return (
    <div className="space-y-1.5 min-w-0">
      {recent.map((t) => (
        <TicketItem
          key={t.id}
          t={t}
          expanded={expandedId === t.id}
          isOnboarding={isOnboardingTicket(t.id)}
          onToggle={() => setExpandedId((cur) => (cur === t.id ? null : t.id))}
          onOpen={() => openTicket(t.id)}
        />
      ))}

      <Button
        variant="outline"
        size="sm"
        className="w-full h-7 text-xs gap-1.5"
        onClick={() => setAllOpen(true)}
      >
        <Ticket className="h-3.5 w-3.5" />
        Ver todos os tickets
      </Button>

      {/* Modal com todos os tickets */}
      <Dialog open={allOpen} onOpenChange={setAllOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Histórico completo de tickets</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-2">
            {loadingAll ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
                <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
              </div>
            ) : all.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">Nenhum ticket encontrado.</p>
            ) : (
              <div className="space-y-2">
                {all.map((t) => (
                  <TicketItem
                    key={t.id}
                    t={t}
                    expanded={allExpandedId === t.id}
                    isOnboarding={isOnboardingTicket(t.id)}
                    onToggle={() => setAllExpandedId((cur) => (cur === t.id ? null : t.id))}
                    onOpen={() => {
                      openTicket(t.id);
                      setAllOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Ticket detail dialog */}
      <SupportTicketDetailDialog
        ticketId={openTicketId}
        open={!!openTicketId}
        onOpenChange={(o) => !o && setOpenTicketId(null)}
      />

      {/* Jornada de onboarding — mesmo modal usado na tela de Onboarding */}
      {openJourney && (
        <Suspense fallback={null}>
          <JourneyDetailSheet
            open
            onOpenChange={(o) => { if (!o) setOpenJourney(null); }}
            journeyId={openJourney.journeyId}
            tenantId={openJourney.tenantId}
          />
        </Suspense>
      )}
    </div>
  );
}
