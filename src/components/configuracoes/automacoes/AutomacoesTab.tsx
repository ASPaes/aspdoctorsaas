import { useMemo, useState } from "react";
import { ArrowRightLeft, CalendarDays, HelpCircle, Plus, Shield, Users, UserX, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
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

/**
 * DEM-0429: a explicação mora na tela, não no suporte. O "?" abre em clique
 * (e não só no hover) porque o texto tem seis parágrafos e precisa funcionar no
 * toque e no teclado.
 */
function AjudaTransferenciaChat() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Como funciona a transferência de chat"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[27rem] text-[13px] leading-relaxed space-y-2.5">
        <p className="font-semibold text-foreground">Como funciona</p>
        <p className="text-muted-foreground">
          A regra troca o destino do chat: manda para a fila de outro setor ou direto para uma pessoa. Ela age em duas
          situações, que você escolhe ao criar: <span className="text-foreground">quando o chat entra</span> no
          atendimento, ou <span className="text-foreground">quando o setor fica sem ninguém conectado</span>. Vale
          também para o chat que já está esperando na fila, não só para o que acabou de chegar.
        </p>
        <p className="text-muted-foreground">
          Quando a regra desvia o chat, ele chega com uma <span className="text-foreground">nota interna</span> dizendo
          de onde veio e qual automação mandou. A nota é só para a equipe: o cliente não vê.
        </p>
        <p className="text-muted-foreground">
          Se duas regras pegarem o mesmo chat, vence a de menor prioridade. Cada chat é desviado uma vez só, para uma
          regra não desfazer a transferência que outra (ou uma pessoa) acabou de fazer.
        </p>
        <p className="text-muted-foreground">
          Independe do Motor de Distribuição: a regra criada aqui vale mesmo com a distribuição automática pausada em
          Distribuição, aba Atribuição.
        </p>
        <p className="text-muted-foreground">
          Não alcança chat que ainda não tem setor (URA aberta na tela do cliente, ou canal sem setor), grupo de
          WhatsApp e número pessoal de atendente, que não passam pela fila.
        </p>
      </PopoverContent>
    </Popover>
  );
}

export default function AutomacoesTab() {
  const { rules, isLoading, createRule, updateRule, toggleActive, encerrarAgora, deleteRule } =
    useAutomationRules();

  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Partial<AutomationRule> | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  const [historicoDaRegra, setHistoricoDaRegra] = useState<AutomationRule | null>(null);
  const [paraExcluir, setParaExcluir] = useState<AutomationRule | null>(null);

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
      {/* DEM-0429: por enquanto a única seção é a de chat. Ticket entra ao lado
          desta, com o mesmo formato de cabeçalho. */}
      <div className="border-b pb-3 flex flex-col sm:flex-row sm:items-start gap-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent shrink-0">
          <ArrowRightLeft className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[15px] font-semibold">Transferência de Chat</h2>
            <AjudaTransferenciaChat />
          </div>
          <p className="text-[13px] text-muted-foreground">
            Troca o destino do chat na entrada, ou quando o setor fica sem ninguém conectado.
          </p>
        </div>
        <Button onClick={() => abrirNova()} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Nova automação
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-7 flex flex-col 2xl:flex-row items-start 2xl:items-center gap-8">
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
