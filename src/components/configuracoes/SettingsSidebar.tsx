import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DollarSign, Database, Users, Headset, Upload, ChevronRight, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const CADASTRO_SECTIONS = [
  "produtos",
  "fornecedores",
  "modelos-contrato",
  "origens-venda",
  "formas-pagamento",
  "setores",
  "funcionarios",
  "categorias-servico",
  "subcategorias-servico",
  "tipos-servico",
  "segmentos",
  "areas-atuacao",
  "unidades-base",
  "motivos-cancelamento",
  "motivos-pausa",
];

type Item = { value: string; label: string };
type SubGroup = { label?: string; items: Item[] };
type Group = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  subgroups: SubGroup[];
};

interface SettingsSidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  isAdmin: boolean;
}

export default function SettingsSidebar({ activeSection, onSectionChange, isAdmin }: SettingsSidebarProps) {
  const [openSubgroups, setOpenSubgroups] = useState<Record<string, boolean>>({});

  const groups: Group[] = [
    {
      label: "Financeiro",
      icon: DollarSign,
      subgroups: [
        {
          items: [
            { value: "percentuais", label: "Percentuais" },
            { value: "despesas-cac", label: "Despesas CAC" },
          ],
        },
      ],
    },
    {
      label: "Cadastros",
      icon: Database,
      subgroups: [
        {
          label: "Comercial",
          items: [
            { value: "produtos", label: "Produtos" },
            { value: "fornecedores", label: "Fornecedores" },
            { value: "modelos-contrato", label: "Modelos de contrato" },
            { value: "origens-venda", label: "Origens de venda" },
            { value: "formas-pagamento", label: "Formas de pagamento" },
          ],
        },
        {
          label: "Operacional",
          items: [
            { value: "setores", label: "Setores" },
            { value: "funcionarios", label: "Funcionários" },
          ],
        },
        {
          label: "Serviços",
          items: [
            { value: "categorias-servico", label: "Categorias" },
            { value: "subcategorias-servico", label: "Subcategorias" },
            { value: "tipos-servico", label: "Tipos de serviço" },
          ],
        },
        {
          label: "Classificação",
          items: [
            { value: "segmentos", label: "Segmentos" },
            { value: "areas-atuacao", label: "Áreas de atuação" },
            { value: "unidades-base", label: "Unidades base" },
          ],
        },
        {
          label: "Ciclo de vida",
          items: [
            { value: "motivos-cancelamento", label: "Motivos de cancelamento" },
            { value: "motivos-pausa", label: "Motivos de pausa" },
          ],
        },
      ],
    },
    ...(isAdmin
      ? [{
          label: "Equipe",
          icon: Users,
          adminOnly: true,
          subgroups: [{ items: [{ value: "acessos", label: "Acessos & permissões" }] }],
        } as Group]
      : []),
    {
      label: "Atendimento",
      icon: Headset,
      subgroups: [
        {
          items: [
            { value: "whatsapp", label: "WhatsApp" },
            ...(isAdmin ? [{ value: "ia", label: "Inteligência artificial" }] : []),
            ...(isAdmin ? [{ value: "horario-plantao", label: "Horário & plantão" }] : []),
            { value: "kb", label: "Base de conhecimento" },
          ],
        },
      ],
    },
    {
      label: "Dados",
      icon: Upload,
      subgroups: [
        {
          items: [{ value: "importacao", label: "Importação" }],
        },
      ],
    },
  ];

  // Auto-expand subgroup containing active section
  useEffect(() => {
    const cadastros = groups.find((g) => g.label === "Cadastros");
    if (!cadastros) return;
    for (const sg of cadastros.subgroups) {
      if (sg.label && sg.items.some((i) => i.value === activeSection)) {
        setOpenSubgroups((prev) => (prev[sg.label!] ? prev : { ...prev, [sg.label!]: true }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  const toggleSubgroup = (label: string) => {
    setOpenSubgroups((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const renderItem = (item: Item, indented: boolean) => {
    const isActive = activeSection === item.value;
    return (
      <div
        key={item.value}
        onClick={() => onSectionChange(item.value)}
        className={cn(
          "cursor-pointer rounded-md mx-2 text-sm",
          indented ? "pl-9 py-1" : "px-5 py-1.5",
          isActive
            ? "bg-background border border-border font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted/50",
        )}
      >
        {item.label}
      </div>
    );
  };

  return (
    <aside className="w-56 flex-shrink-0 sticky top-0 h-[calc(100vh-120px)] flex flex-col border-r bg-muted/30">
      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        {groups.map((group) => {
          const Icon = group.icon;
          const isCadastros = group.label === "Cadastros";
          return (
            <div key={group.label}>
              <div className="flex items-center gap-1.5 px-5 mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                <Icon className="h-[14px] w-[14px]" />
                <span>{group.label}</span>
              </div>
              {group.subgroups.map((sg, i) => {
                const isOpen = sg.label ? !!openSubgroups[sg.label] : true;
                return (
                  <div key={i}>
                    {sg.label && (
                      <button
                        type="button"
                        onClick={() => toggleSubgroup(sg.label!)}
                        className="w-full flex items-center gap-1 pl-7 pr-3 mt-3 mb-1 text-xs text-muted-foreground/70 hover:text-foreground transition cursor-pointer"
                      >
                        <ChevronRight
                          className={cn(
                            "h-3 w-3 transition-transform duration-200",
                            isOpen && "rotate-90",
                          )}
                        />
                        <span>{sg.label}</span>
                      </button>
                    )}
                    <div
                      className={cn(
                        "overflow-hidden transition-all duration-200",
                        isOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0",
                      )}
                    >
                      {sg.items.map((item) => renderItem(item, isCadastros))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="border-t border-border px-3 py-3">
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors w-full px-2 py-1.5 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", syncing && "animate-spin")} />
          {syncing ? "Sincronizando..." : "Sincronizar estados/cidades"}
        </button>
      </div>
    </aside>
  );
}
