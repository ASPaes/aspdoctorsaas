import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus, Shield, Users, UserX, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import {
  automationStatus,
  useAutomationRules,
  type AutomationRule,
  type AutomationStatus,
} from "@/components/whatsapp/hooks/useAutomationRules";
import { AutomationRuleCard } from "./AutomationRuleCard";
import { AutomationRuleDialog } from "./AutomationRuleDialog";
import { AutomationLogsDialog } from "./AutomationLogsDialog";

type Filtro = "todas" | AutomationStatus;

const FILTROS: Array<{ valor: Filtro; label: string }> = [
  { valor: "todas", label: "Todas" },
  { valor: "valendo", label: "Valendo agora" },
  { valor: "agendada", label: "Agendadas" },
  { valor: "encerrada", label: "Encerradas" },
  { valor: "desligada", label: "Desligadas" },
];

function isoAgora() {
  return new Date().toISOString();
}

function isoHoje(hora: number, minuto: number, somarDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + somarDias);
  d.setHours(hora, minuto, 0, 0);
  return d.toISOString();
}

export default function AutomacoesTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { rules, isLoading, createRule, updateRule, toggleActive, encerrarAgora, deleteRule } =
    useAutomationRules();

  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Partial<AutomationRule> | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [historicoDaRegra, setHistoricoDaRegra] = useState<AutomationRule | null>(null);
  const [paraExcluir, setParaExcluir] = useState<AutomationRule | null>(null);

  // A automação só tem efeito com o motor de distribuição ligado: sem ele o
  // roteamento nem chega a consultar as regras.
  const { data: motorLigado } = useQuery({
    queryKey: ["automacoes-motor-ligado", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data } = await supabase
        .from("configuracoes")
        .select("support_config")
        .eq("tenant_id", tid!)
        .maybeSingle();
      const cfg = (data?.support_config ?? {}) as Record<string, unknown>;
      return cfg.distribution_enabled_globally === true;
    },
  });

  const contagem = useMemo(() => {
    const agora = new Date();
    const c: Record<Filtro, number> = { todas: rules.length, valendo: 0, agendada: 0, encerrada: 0, desligada: 0 };
    for (const r of rules) c[automationStatus(r, agora)] += 1;
    return c;
  }, [rules]);

  const visiveis = useMemo(() => {
    if (filtro === "todas") return rules;
    const agora = new Date();
    return rules.filter((r) => automationStatus(r, agora) === filtro);
  }, [rules, filtro]);

  const abrirNova = (prefill?: Partial<AutomationRule>) => {
    setEmEdicao(prefill ?? null);
    setDialogAberto(true);
  };

  const duplicar = (rule: AutomationRule) => {
    const { id, applied_count, last_applied_at, created_at, updated_at, created_by, ...resto } = rule;
    abrirNova({
      ...resto,
      name: `${rule.name} (cópia)`,
      // A cópia nasce valendo hoje: duplicar existe para a falta de hoje, não
      // para repetir a data da falta passada.
      starts_at: rule.starts_at ? isoAgora() : null,
      ends_at: rule.ends_at ? isoHoje(19, 0) : null,
      is_active: true,
    });
  };

  const salvar = (payload: Partial<AutomationRule> & { id?: string }) => {
    const { id, ...dados } = payload;
    if (id) updateRule.mutate({ id, ...dados });
    else createRule.mutate(dados);
    setDialogAberto(false);
  };

  const abrirHistorico = (rule?: AutomationRule) => {
    setHistoricoDaRegra(rule ?? null);
    setHistoricoAberto(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-6">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Regras que interceptam o chat na entrada e mudam para onde ele vai. Podem valer por um período (falta, férias,
          plantão) ou ficar fixas.
        </p>
        <Button onClick={() => abrirNova()} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Nova automação
        </Button>
      </div>

      <div className="flex items-center gap-2.5 rounded-lg border bg-card px-3.5 py-2.5">
        <span
          className={cn(
            "h-2 w-2 rounded-full shrink-0",
            motorLigado ? "bg-success ring-[3px] ring-success/20" : "bg-destructive ring-[3px] ring-destructive/20",
          )}
        />
        {motorLigado ? (
          <>
            <span className="text-[13px]">Motor de distribuição ligado.</span>
            <span className="text-[13px] text-muted-foreground">
              Se ele for desligado, nenhuma automação tem efeito.
            </span>
          </>
        ) : (
          <>
            <span className="text-[13px] font-medium">Motor de distribuição desligado.</span>
            <span className="text-[13px] text-muted-foreground">
              Enquanto estiver assim, as automações não fazem nada. Ligue em Distribuição, aba Atribuição.
            </span>
          </>
        )}
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-7 flex flex-col lg:flex-row items-start lg:items-center gap-8">
          <div className="max-w-md">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-success/15 text-success mb-3.5">
              <Zap className="h-[22px] w-[22px]" />
            </span>
            <h2 className="text-[17px] font-semibold mb-1.5">Nenhuma automação criada</h2>
            <p className="text-[13px] text-muted-foreground leading-relaxed mb-4">
              Uma automação pega o chat no momento em que ele entra e troca o destino. Serve para falta, férias, plantão
              e mutirão, sem ninguém precisar remanejar chat na mão.
            </p>
            <Button onClick={() => abrirNova()}>
              <Plus className="h-4 w-4 mr-2" />
              Criar primeira automação
            </Button>
          </div>

          <div className="flex-1 min-w-0 w-full">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
              Começar de um modelo
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() =>
                  abrirNova({
                    name: "Setor sem ninguém",
                    trigger_event: "no_agent_available",
                    action: "route_to_department",
                    grace_minutes: 30,
                    priority: 10,
                  })
                }
                className="text-left rounded-lg border p-3.5 hover:bg-muted/50 transition"
              >
                <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-success/15 text-success mb-2">
                  <Users className="h-4 w-4" />
                </span>
                <span className="block text-[13px] font-semibold">Setor ficou sem ninguém</span>
                <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                  Regra fixa: se ninguém do setor estiver conectado, os chats vão para outra fila. Ninguém precisa lembrar
                  de ligar no dia da falta.
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  abrirNova({
                    name: "Falta no setor",
                    action: "route_to_department",
                    starts_at: isoAgora(),
                    ends_at: isoHoje(19, 0),
                    priority: 10,
                  })
                }
                className="text-left rounded-lg border p-3.5 hover:bg-muted/50 transition"
              >
                <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-muted text-muted-foreground mb-2">
                  <UserX className="h-4 w-4" />
                </span>
                <span className="block text-[13px] font-semibold">Faltou alguém no setor</span>
                <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                  Manda os chats do setor para a fila de outro até o fim do dia.
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  abrirNova({
                    name: "Férias",
                    action: "route_to_agent",
                    starts_at: isoAgora(),
                    ends_at: isoHoje(19, 0, 7),
                    priority: 20,
                  })
                }
                className="text-left rounded-lg border p-3.5 hover:bg-muted/50 transition"
              >
                <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-muted text-muted-foreground mb-2">
                  <CalendarDays className="h-4 w-4" />
                </span>
                <span className="block text-[13px] font-semibold">Férias de uma pessoa</span>
                <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                  Passa os chats dela para outra pessoa no período das férias.
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  abrirNova({ name: "Canal para outro setor", action: "route_to_department", priority: 50 })
                }
                className="text-left rounded-lg border p-3.5 hover:bg-muted/50 transition"
              >
                <span className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-muted text-muted-foreground mb-2">
                  <Shield className="h-4 w-4" />
                </span>
                <span className="block text-[13px] font-semibold">Número que vai para outro setor</span>
                <span className="block text-xs text-muted-foreground mt-1 leading-snug">
                  Regra fixa: tudo que entrar por um canal cai num setor escolhido.
                </span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex gap-0.5 rounded-lg bg-muted p-[3px]">
              {FILTROS.filter((f) => f.valor === "todas" || contagem[f.valor] > 0).map((f) => (
                <button
                  key={f.valor}
                  type="button"
                  onClick={() => setFiltro(f.valor)}
                  className={cn(
                    "h-8 rounded-md px-3 text-[13px] transition",
                    filtro === f.valor
                      ? "bg-background font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f.label} <span className="text-muted-foreground">{contagem[f.valor]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => abrirHistorico()}
              className="ml-auto text-[13px] text-accent hover:underline"
            >
              Aplicações recentes
            </button>
          </div>

          <div className="grid gap-3">
            {visiveis.map((rule) => (
              <AutomationRuleCard
                key={rule.id}
                rule={rule}
                onEdit={(r) => {
                  setEmEdicao(r);
                  setDialogAberto(true);
                }}
                onDuplicar={duplicar}
                onEncerrar={(r) => encerrarAgora.mutate(r.id)}
                onExcluir={setParaExcluir}
                onToggle={(r, ativa) => toggleActive.mutate({ id: r.id, is_active: ativa })}
                onVerHistorico={abrirHistorico}
              />
            ))}
            {visiveis.length === 0 && (
              <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
                Nenhuma automação neste filtro.
              </div>
            )}
          </div>
        </>
      )}

      <AutomationRuleDialog
        open={dialogAberto}
        onOpenChange={setDialogAberto}
        rule={emEdicao}
        onSave={salvar}
        salvando={createRule.isPending || updateRule.isPending}
      />

      <AutomationLogsDialog
        open={historicoAberto}
        onOpenChange={setHistoricoAberto}
        rule={historicoDaRegra}
        rules={rules}
      />

      <AlertDialog open={!!paraExcluir} onOpenChange={(v) => !v && setParaExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a automação "{paraExcluir?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              O histórico de aplicações dela vai junto. Para parar a regra sem perder o histórico, use Encerrar agora ou
              desligue no botão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (paraExcluir) deleteRule.mutate(paraExcluir.id);
                setParaExcluir(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
