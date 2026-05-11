import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DollarSign, Database, Users, Headset, Upload, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

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
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("populate-cidades", { method: "POST" });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Erro desconhecido");
      toast({ title: "Sincronização concluída", description: `${data.estados} estados e ${data.cidades} cidades sincronizados.` });
    } catch (err: any) {
      toast({ title: "Erro na sincronização", description: err.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

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
    <aside className="w-56 flex-shrink-0 bg-muted/30 border-r py-4 flex flex-col">
      <div className="flex-1 space-y-4">
        {groups.map((group) => {
          const Icon = group.icon;
          const isCadastros = group.label === "Cadastros";
          return (
            <div key={group.label}>
              <div className="flex items-center gap-1.5 px-5 mb-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                <Icon className="h-[14px] w-[14px]" />
                <span>{group.label}</span>
              </div>
              {group.subgroups.map((sg, i) => (
                <div key={i}>
                  {sg.label && (
                    <div className="text-xs text-muted-foreground/70 pl-7 mt-3 mb-1">{sg.label}</div>
                  )}
                  {sg.items.map((item) => renderItem(item, isCadastros))}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="px-3 pt-4 mt-4 border-t">
        <Button onClick={handleSync} disabled={syncing} variant="outline" size="sm" className="w-full">
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          {syncing ? "Sincronizando..." : "Sincronizar Estados/Cidades"}
        </Button>
      </div>
    </aside>
  );
}
