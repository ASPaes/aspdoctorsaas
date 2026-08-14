import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DollarSign, Database, Users, Headset, Upload, ChevronRight, RefreshCw, Settings, Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

export const SECTION_TO_RESOURCE: Record<string, string> = {
  // Financeiro
  "percentuais": "cfg.percentuais",
  "despesas-cac": "cfg.despesas_cac",
  // Cadastros Comercial
  "produtos": "cfg.produtos",
  "fornecedores": "cfg.fornecedores",
  "modelos-contrato": "cfg.modelos_contrato",
  "origens-venda": "cfg.origens_venda",
  "formas-pagamento": "cfg.formas_pagamento",
  // Cadastros Operacional
  "setores": "cfg.setores",
  "funcionarios": "cfg.funcionarios",
  "tickets-config": "cfg.tickets_config",
  // Cadastros Serviços
  "categorias-servico": "cfg.categorias_servico",
  "tipos-servico": "cfg.tipos_servico",
  // Classificação
  "segmentos": "cfg.segmentos",
  "areas-atuacao": "cfg.areas_atuacao",
  "unidades-base": "cfg.unidades_base",
  // Ciclo de vida
  "motivos-cancelamento": "cfg.motivos_cancelamento",
  "motivos-pausa": "cfg.motivos_pausa",
  // Equipe
  "acessos": "cfg.acessos",
  "permissoes": "cfg.permissoes",
  // Sistema
  "geral": "cfg.geral",
  "setup": "cfg.setup",
  "notificacoes": "cfg.notificacoes",
  // Atendimento
  "canais": "cfg.canais",
  "distribuicao": "cfg.distribuicao",
  "operacao": "cfg.operacao",
  "ia": "cfg.ia",
  "horario-plantao": "cfg.horario_plantao",
  "kb": "cfg.kb",
  // Equipe
  "seguranca": "cfg.seguranca",
  // Dados
  "duplicidades": "cfg.duplicidades",
  "importacao": "cfg.importacao",
  // Integrações
  "integracoes-omie": "cfg.integracoes_omie",
  "integracoes-hiper": "cfg.integracoes_hiper",
  "integracoes-oem": "cfg.integracoes_omie",
};

export const CADASTRO_SECTIONS = [
  "produtos",
  "fornecedores",
  "modelos-contrato",
  "origens-venda",
  "formas-pagamento",
  "setores",
  "funcionarios",
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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  const [syncing, setSyncing] = useState(false);
  const { can, rbacEnabled } = usePermissions();

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("populate-cidades", { method: "POST" });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Erro desconhecido");
      toast.success("Sincronização concluída", { description: `${data.estados} estados e ${data.cidades} cidades sincronizados.` });
    } catch (err: any) {
      toast.error("Erro na sincronização", { description: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const isItemVisible = (item: Item) => {
    const resource = SECTION_TO_RESOURCE[item.value];
    if (!rbacEnabled) return isAdmin;
    if (!resource) return isAdmin;
    return can(resource, "view");
  };

  const groups: Group[] = [
    {
      label: "Sistema",
      icon: Settings,
      subgroups: [
        {
          items: [
            { value: "geral", label: "Geral" },
            { value: "notificacoes", label: "Théo" },
            { value: "setup", label: "Guia de configuração" },
          ],
        },
      ],
    },
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
            { value: "tickets-config", label: "Tickets" },
          ],
        },
        {
          label: "Serviços",
          items: [
            { value: "categorias-servico", label: "Categorias" },
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
    {
      label: "Equipe",
      icon: Users,
      subgroups: [{ items: [
        { value: "acessos", label: "Acessos & permissões" },
        { value: "permissoes", label: "Permissões e papéis" },
        { value: "seguranca", label: "Segurança" },
      ] }],
    },

    {
      label: "Atendimento",
      icon: Headset,
      subgroups: [
        {
          items: [
            { value: "canais", label: "Canais" },
            { value: "distribuicao", label: "Distribuição" },
            { value: "operacao", label: "Operação" },
            { value: "ia", label: "Inteligência artificial" },
            { value: "horario-plantao", label: "Horário & plantão" },
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
          items: [
            { value: "duplicidades", label: "Duplicidades" },
            { value: "importacao", label: "Importação" },
          ],
        },
      ],
    },
    {
      label: "Integrações",
      icon: Plug,
      subgroups: [
        {
          items: [
            { value: "integracoes-omie", label: "Omie" },
            { value: "integracoes-hiper", label: "Hiper" },
            { value: "integracoes-oem", label: "OEM" },
          ],
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

  // Initial collapse: all closed except "Atendimento" and group containing activeSection
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const g of groups) {
      const hasActive = g.subgroups.some((sg) =>
        sg.items.some((it) => it.value === activeSection)
      );
      initial[g.label] = !(g.label === "Atendimento" || hasActive);
    }
    setCollapsedGroups(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

          const visibleSubgroups = group.subgroups.map((sg) => ({
            ...sg,
            visibleItems: sg.items.filter(isItemVisible),
          })).filter((sg) => sg.visibleItems.length > 0);

          if (visibleSubgroups.length === 0) return null;

          return (
            <div key={group.label}>
              <button
                type="button"
                onClick={() => toggleGroup(group.label)}
                className="w-full flex items-center gap-1.5 px-5 mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium cursor-pointer hover:text-foreground transition"
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 transition-transform duration-200",
                    !collapsedGroups[group.label] && "rotate-90",
                  )}
                />
                <Icon className="h-[14px] w-[14px]" />
                <span>{group.label}</span>
              </button>
              <div
                className={cn(
                  "overflow-hidden transition-all duration-200",
                  collapsedGroups[group.label] ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100",
                )}
              >
                {visibleSubgroups.map((sg, i) => {
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
                        {sg.visibleItems.map((item) => renderItem(item, isCadastros))}
                      </div>
                    </div>
                  );
                })}
              </div>
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
