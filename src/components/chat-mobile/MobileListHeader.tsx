import { CheckCheck, FileSearch, Plus, Search, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MobileFiltersSheet } from "./MobileFiltersSheet";
import { MobileSetorSheet } from "./MobileSetorSheet";
import { QuickPills } from "@/components/whatsapp/conversations/QuickPills";
import type { FiltersState } from "@/components/whatsapp/conversations/ConversationFiltersPopover";

interface Props {
  /** Recolhe busca e setor quando a lista rolou — ganha 3 conversas de tela. */
  compacto: boolean;
  capacidade?: { current: number; limit: number; status: string } | null;

  search: string;
  onSearchChange: (v: string) => void;
  onAbrirBuscaMensagens: () => void;
  onNovaConversa: () => void;

  filters: FiltersState;
  onFiltersChange: (f: FiltersState) => void;
  showGroupByAgent?: boolean;
  operatorFilterInactive?: boolean;

  unreadOnly: boolean;
  onUnreadOnlyChange: (v: boolean) => void;
  naoLidasNaAba: number;
  onMarcarTodasLidas: () => void;

  isSearching: boolean;
  activePill: string;
  onPillChange: (p: string) => void;
  pillCounts: any;
  pillBadges: any;
  groupsHasUnread: boolean;
  queueJustArrived: boolean;
  setorResumo?: string | null;
}

export function MobileListHeader({
  compacto,
  capacidade,
  search,
  onSearchChange,
  onAbrirBuscaMensagens,
  onNovaConversa,
  filters,
  onFiltersChange,
  showGroupByAgent,
  operatorFilterInactive,
  unreadOnly,
  onUnreadOnlyChange,
  naoLidasNaAba,
  onMarcarTodasLidas,
  isSearching,
  activePill,
  onPillChange,
  pillCounts,
  pillBadges,
  groupsHasUnread,
  queueJustArrived,
  setorResumo,
}: Props) {
  const navigate = useNavigate();

  return (
    <div className="shrink-0 border-b border-border bg-card">
      <div className="flex h-13 items-center gap-1 py-2 pl-4 pr-1">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-lg font-semibold">Conversas</span>
          {capacidade && capacidade.status !== "unlimited" && (
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium",
                capacidade.status === "full"
                  ? "border-red-500/50 text-red-600 dark:text-red-400"
                  : capacidade.status === "warn"
                    ? "border-amber-500/50 text-amber-600 dark:text-amber-400"
                    : "border-emerald-500/50 text-emerald-600 dark:text-emerald-400"
              )}
            >
              {capacidade.current}/{capacidade.limit}
            </span>
          )}
          {/* Com o cabeçalho recolhido o chip de setor some: o nome vem para cá
              para ninguém atender achando que está vendo outro setor. */}
          <span
            className={cn(
              "min-w-0 overflow-hidden whitespace-nowrap text-xs text-muted-foreground transition-all duration-200",
              compacto && setorResumo ? "max-w-[40%] opacity-100" : "max-w-0 opacity-0"
            )}
          >
            {setorResumo}
          </span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label="Contatos"
          onClick={() => navigate("/whatsapp/contatos")}
        >
          <Users className="h-[18px] w-[18px]" />
        </Button>

        <MobileFiltersSheet
          filters={filters}
          onChange={onFiltersChange}
          showGroupByAgent={showGroupByAgent}
          operatorFilterInactive={operatorFilterInactive}
        />

        <Button size="icon" className="ml-1 h-9 w-9 shrink-0" aria-label="Nova conversa" onClick={onNovaConversa}>
          <Plus className="h-[18px] w-[18px]" />
        </Button>
      </div>

      <div
        className={cn(
          "overflow-hidden transition-all duration-200 ease-out",
          compacto ? "max-h-0 opacity-0" : "max-h-32 opacity-100"
        )}
      >
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contato e número..."
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-10 pl-8"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 shrink-0"
            aria-label="Buscar nas mensagens"
            onClick={onAbrirBuscaMensagens}
          >
            <FileSearch className="h-[18px] w-[18px]" />
          </Button>
        </div>

        {!isSearching && (
          <div className="flex items-center gap-2 px-3 pb-2">
            <MobileSetorSheet />
            <div className="flex-1" />
            <div className="inline-flex rounded-full bg-muted p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => onUnreadOnlyChange(false)}
                className={cn(
                  "rounded-full px-3 py-1 font-medium transition-colors",
                  !unreadOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => onUnreadOnlyChange(true)}
                className={cn(
                  "rounded-full px-3 py-1 font-medium transition-colors",
                  unreadOnly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                Não lidos
              </button>
            </div>
            {naoLidasNaAba > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label={`Marcar as ${naoLidasNaAba} conversas não lidas desta aba como lidas`}
                onClick={onMarcarTodasLidas}
              >
                <CheckCheck className="h-[18px] w-[18px]" />
              </Button>
            )}
          </div>
        )}
      </div>

      {!isSearching && (
        <QuickPills
          active={activePill}
          onChange={onPillChange}
          unreadOnly={unreadOnly}
          counts={pillCounts}
          groupsHasUnread={groupsHasUnread}
          badges={pillBadges}
          queueJustArrived={queueJustArrived}
        />
      )}
    </div>
  );
}
