import {
  ArrowRight,
  Building2,
  Clock,
  Copy,
  MessageSquare,
  Pencil,
  Smartphone,
  StopCircle,
  Trash2,
  User,
  UserX,
  Zap,
} from "lucide-react";
import { isSameDay } from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  automationStatus,
  STATUS_LABEL,
  type AutomationRule,
  type AutomationStatus,
} from "@/components/whatsapp/hooks/useAutomationRules";
import { useAutomationLookups } from "@/components/whatsapp/hooks/useAutomationLookups";

interface Props {
  rule: AutomationRule;
  onEdit: (rule: AutomationRule) => void;
  onDuplicar: (rule: AutomationRule) => void;
  onEncerrar: (rule: AutomationRule) => void;
  onExcluir: (rule: AutomationRule) => void;
  onToggle: (rule: AutomationRule, ativa: boolean) => void;
  onVerHistorico: (rule: AutomationRule) => void;
}

const BADGE_CLASS: Record<AutomationStatus, string> = {
  valendo: "bg-success text-success-foreground hover:bg-success",
  agendada: "bg-accent text-accent-foreground hover:bg-accent",
  encerrada: "bg-muted text-muted-foreground hover:bg-muted",
  desligada: "bg-muted text-muted-foreground hover:bg-muted",
};

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "4 h 12 min", "3 dias", "12 min". */
function duracaoAte(iso: string, agora: Date): string {
  const minutos = Math.max(0, Math.round((new Date(iso).getTime() - agora.getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  if (minutos < 60 * 24) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const dias = Math.round(minutos / (60 * 24));
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

function textoDaJanela(rule: AutomationRule, status: AutomationStatus, agora: Date): string {
  if (!rule.starts_at && !rule.ends_at) return "Sem prazo";

  const inicio = rule.starts_at ? new Date(rule.starts_at) : null;
  const fim = rule.ends_at ? new Date(rule.ends_at) : null;

  let base: string;
  if (inicio && fim && isSameDay(inicio, fim)) {
    const dia = isSameDay(inicio, agora)
      ? "Hoje"
      : inicio.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    base = `${dia}, ${hora(rule.starts_at!)} às ${hora(rule.ends_at!)}`;
  } else if (inicio && fim) {
    base = `De ${dataHora(rule.starts_at!)} a ${dataHora(rule.ends_at!)}`;
  } else if (fim) {
    base = `Até ${dataHora(rule.ends_at!)}`;
  } else {
    base = `A partir de ${dataHora(rule.starts_at!)}`;
  }

  if (status === "agendada" && rule.starts_at) return `${base} (começa em ${duracaoAte(rule.starts_at, agora)})`;
  if (status === "valendo" && rule.ends_at) return `${base} (termina em ${duracaoAte(rule.ends_at, agora)})`;
  return base;
}

export function AutomationRuleCard({
  rule,
  onEdit,
  onDuplicar,
  onEncerrar,
  onExcluir,
  onToggle,
  onVerHistorico,
}: Props) {
  const { nomeDoSetor, nomeDaPessoa, nomeDoCanal } = useAutomationLookups();

  const agora = new Date();
  const status = automationStatus(rule, agora);
  const encerrada = status === "encerrada";
  const temporaria = Boolean(rule.starts_at || rule.ends_at);

  const semAgente = rule.trigger_event === "no_agent_available";

  // Condição: setor, pessoa e canal se acumulam (todos têm de bater).
  const condicoes: Array<{ icone: typeof Building2; texto: string; alvo: string; depois?: string }> = [];
  if (rule.match_department_id) {
    condicoes.push(
      semAgente
        ? {
            icone: UserX,
            texto: "Setor",
            alvo: nomeDoSetor(rule.match_department_id)!,
            depois: "fica sem ninguém conectado",
          }
        : { icone: Building2, texto: "Chat entra no setor", alvo: nomeDoSetor(rule.match_department_id)! },
    );
  }
  if (rule.match_agent_id) {
    condicoes.push({ icone: User, texto: "Chat entra para", alvo: nomeDaPessoa(rule.match_agent_id)! });
  }
  if (rule.match_instance_id) {
    condicoes.push({ icone: Smartphone, texto: "Chat entra pelo canal", alvo: nomeDoCanal(rule.match_instance_id)! });
  }

  const paraSetor = rule.action === "route_to_department";
  const destino = paraSetor
    ? nomeDoSetor(rule.target_department_id)
    : nomeDaPessoa(rule.target_agent_id);

  return (
    <Card className={cn("p-4 space-y-3", encerrada && "opacity-75")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className={cn(
              "inline-flex items-center justify-center h-7 w-7 rounded-lg shrink-0",
              status === "valendo" && "bg-success/15 text-success",
              status === "agendada" && "bg-accent/15 text-accent",
              (encerrada || status === "desligada") && "bg-muted text-muted-foreground",
            )}
          >
            <Zap className="h-[15px] w-[15px]" />
          </span>
          <h3 className="font-semibold truncate">{rule.name}</h3>
          <Badge className={BADGE_CLASS[status]}>{STATUS_LABEL[status]}</Badge>
          <Badge variant={temporaria ? "outline" : "secondary"}>{temporaria ? "Temporária" : "Fixa"}</Badge>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground">Prioridade {rule.priority}</span>
          {/* Regra fora da janela não volta a valer por switch, então ele só
              apareceria para enganar. */}
          {!encerrada && (
            <Switch
              checked={rule.is_active}
              onCheckedChange={(v) => onToggle(rule, v)}
              aria-label={`${rule.is_active ? "Desligar" : "Ligar"} a automação ${rule.name}`}
            />
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5 flex-wrap">
        {condicoes.map((c, i) => {
          const Icone = c.icone;
          return (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5 text-sm"
            >
              <Icone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              {c.texto} <strong className="font-semibold">{c.alvo}</strong>
              {c.depois && <> {c.depois}</>}
            </span>
          );
        })}

        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />

        <span className="inline-flex items-center gap-1.5 rounded-lg border border-success/35 bg-success/10 px-2.5 py-1.5 text-sm">
          {paraSetor ? (
            <Building2 className="h-3.5 w-3.5 text-success shrink-0" />
          ) : (
            <User className="h-3.5 w-3.5 text-success shrink-0" />
          )}
          {paraSetor ? "Vai para a fila do setor" : "Vai direto para"}{" "}
          <strong className="font-semibold">{destino}</strong>
        </span>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {textoDaJanela(rule, status, agora)}
        </span>
        <button
          type="button"
          onClick={() => onVerHistorico(rule)}
          className="inline-flex items-center gap-1.5 hover:text-foreground transition"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {rule.applied_count === 0
            ? "Ainda não aplicada"
            : `${rule.applied_count} ${rule.applied_count === 1 ? "chat encaminhado" : "chats encaminhados"}`}
        </button>
        {semAgente && (
          <span>
            {rule.grace_minutes > 0
              ? `Espera ${rule.grace_minutes} min depois da abertura`
              : "Vale desde a abertura"}
          </span>
        )}
        {rule.last_applied_at && <span>Última aplicação em {dataHora(rule.last_applied_at)}</span>}
      </div>

      <div className="flex gap-2 pt-3 border-t border-border">
        {encerrada ? (
          <Button variant="outline" size="sm" onClick={() => onDuplicar(rule)}>
            <Copy className="h-3 w-3 mr-1.5" />
            Duplicar
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => onEdit(rule)}>
              <Pencil className="h-3 w-3 mr-1.5" />
              Editar
            </Button>
            {temporaria && status === "valendo" && (
              <Button variant="outline" size="sm" onClick={() => onEncerrar(rule)}>
                <StopCircle className="h-3 w-3 mr-1.5" />
                Encerrar agora
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onDuplicar(rule)}>
              <Copy className="h-3 w-3 mr-1.5" />
              Duplicar
            </Button>
          </>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onExcluir(rule)}
          className="ml-auto text-destructive hover:text-destructive"
        >
          <Trash2 className="h-3 w-3 mr-1.5" />
          Excluir
        </Button>
      </div>
    </Card>
  );
}
