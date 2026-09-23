import { ArrowUpDown, CheckCheck, FileSearch, Plus, Search, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MobileFiltersSheet } from "./MobileFiltersSheet";
import { MobileSetorSheet } from "./MobileSetorSheet";
import { QuickPills } from "@/components/whatsapp/conversations/QuickPills";
import type { FiltersState } from "@/components/whatsapp/conversations/ConversationFiltersPopover";

interface Props {
  /** Recolhe a linha de busca quando a lista rolou. O setor fica: ele mora na linha do título. */
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
          {/* O setor manda na lista que vem logo abaixo, então mora na mesma
              linha do título. Fica visível também com o cabeçalho recolhido —
              antes ele sumia junto com a busca, e o nome tinha de ser repetido
              aqui do lado para ninguém atender achando que via outro setor. */}
          <MobileSetorSheet compacto />
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
        <div className="flex items-center gap-1.5 px-3 pb-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar contato"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-10 pl-8"
            />
          </div>

          {/* Um botão só, que DIZ O ESTADO: "Todos" = a lista mostra todas, e
              tocar troca para não lidas. Dois botões lado a lado custavam uma
              faixa inteira do cabeçalho. O ⇅ e o verde forte são o que avisam
que ele alterna — sem isso viraria um rótulo que ninguém toca.

              "Todas"/"Não lidas" no feminino de propósito: são CONVERSAS, e o
              chip do setor ao lado já diz "Todos". Dois "Todos" na mesma tela,
              um de setor e outro de leitura, era confusão desnecessária. */}
          {!isSearching && (
            <button
              type="button"
              onClick={() => onUnreadOnlyChange(!unreadOnly)}
              aria-pressed={unreadOnly}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors",
                unreadOnly
                  ? "border-primary/50 bg-primary/15 text-primary"
                  : "border-border bg-muted text-muted-foreground"
              )}
            >
              {/* O ⇅ aparece só no estado neutro, que é onde a pessoa precisa
                  descobrir que o botão alterna. Ligado, o verde já diz o que é —
                  e sem o ícone o rótulo maior ("Não lidas") ocupa a mesma largura
                  do menor ("Todas"), então o campo de busca não muda de tamanho
                  a cada toque. */}
              {!unreadOnly && <ArrowUpDown className="h-3 w-3 shrink-0" />}
              {unreadOnly ? "Não lidas" : "Todas"}
            </button>
          )}

          {/* Só existe quando há o que marcar, e some junto com a linha ao rolar. */}
          {naoLidasNaAba > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-10 w-8 shrink-0"
              aria-label={`Marcar as ${naoLidasNaAba} conversas não lidas desta aba como lidas`}
              onClick={onMarcarTodasLidas}
            >
              <CheckCheck className="h-[18px] w-[18px]" />
            </Button>
          )}

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
