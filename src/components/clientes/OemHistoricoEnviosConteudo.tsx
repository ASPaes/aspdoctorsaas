import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { rotuloDaFonte } from "@/lib/fonteDoPedido";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  Ban,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Hourglass,
  Lock,
  LockOpen,
  Power,
  PowerOff,
  User,
} from "lucide-react";

// ============================================================================
// O histórico de envios ao OEM de um cliente.
//
// Aba irmã da do Omie dentro do modal "Histórico de envios". O que ela mostra
// estava registrado desde sempre, em três tabelas, e nenhuma tela do cliente
// lia nenhuma: módulo ativado / quantidade alterada / cancelado (a fila), ligar
// e desligar e bloquear e desbloquear a licença, e a correção de nome e CNPJ da
// filial. Quem fez, quando, e o que o parceiro respondeu.
//
// ---------------------------------------------------------------------------
// SIMULAÇÃO NÃO É ENVIO, E POR ISSO NÃO ENTRA POR PADRÃO
// ---------------------------------------------------------------------------
// Todo clique em Ativar/Bloquear lê a licença no parceiro antes de gravar (a
// rota dele salva a filial inteira). Cada abertura de confirmação — inclusive a
// que a pessoa desistiu — deixa uma linha `simulado`. Elas são metade do log e
// afogariam os envios de verdade. Ficam atrás do filtro, porque quando a
// pergunta é "por que não foi?", costuma ser a simulação que responde.
// ============================================================================

type OemEvento = {
  id: string;
  quando: string;
  grupo: "modulo" | "licenca" | "cadastro" | string;
  acao: string;
  status: string;
  simulado: boolean | null;
  confirmado: boolean | null;
  filial_codigo: string | null;
  produto: string | null;
  modulo: string | null;
  quantidade: number | null;
  motivo: string | null;
  fonte: string | null;
  erro: string | null;
  processado_em: string | null;
  usuario_id: string | null;
  quem: string | null;
  decidido_por: string | null;
  decidido_em: string | null;
  campo: string | null;
  valor_anterior: string | null;
  valor_novo: string | null;
  bloqueado_antes: boolean | null;
  bloqueado_depois: boolean | null;
  desativado_antes: boolean | null;
  desativado_depois: boolean | null;
  baixa_em: string | null;
};

type FiltroOem = "envios" | "falhas" | "simulacoes" | "tudo";

// O selo por status. `sem_confirmacao` existe porque a releitura do parceiro
// atrasa e não de forma constante: dizer "falhou" numa escrita que ele aceitou
// mandaria alguém refazer o que já está feito.
const STATUS: Record<string, { label: string; classe: string; icon: typeof CheckCircle }> = {
  ok: {
    label: "Enviado",
    classe:
      "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900",
    icon: CheckCircle,
  },
  sem_confirmacao: {
    label: "Sem confirmação",
    classe:
      "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
    icon: Clock,
  },
  erro: {
    label: "Falhou",
    classe:
      "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
    icon: AlertCircle,
  },
  invalido: {
    label: "Não enviado",
    classe:
      "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900",
    icon: Ban,
  },
  recusado: {
    label: "Recusado",
    classe:
      "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
    icon: Ban,
  },
  aguardando_aprovacao: {
    label: "Aguardando aprovação",
    classe:
      "bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-950/40 dark:text-violet-400 dark:border-violet-900",
    icon: Hourglass,
  },
  pendente: {
    label: "Na fila",
    classe:
      "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
    icon: Hourglass,
  },
  processando: {
    label: "Enviando",
    classe:
      "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
    icon: Hourglass,
  },
  simulado: {
    label: "Simulação",
    classe: "bg-muted text-muted-foreground border-border",
    icon: Eye,
  },
};

const statusConfig = (s: string) =>
  STATUS[s] ?? { label: s || "Info", classe: "bg-muted text-muted-foreground border-border", icon: FileText };

// O ícone diz o assunto antes de a pessoa ler a linha: cadeado é acesso,
// interruptor é cobrança. São dimensões diferentes da licença.
const ICONE_ACAO: Record<string, typeof Power> = {
  ativar: Power,
  desativar: PowerOff,
  bloquear: Lock,
  desbloquear: LockOpen,
};

function titulo(e: OemEvento): string {
  if (e.grupo === "licenca") {
    switch (e.acao) {
      case "ativar":
        return "Licença ativada no OEM";
      case "desativar":
        return "Licença desativada no OEM";
      case "bloquear":
        return "Licença bloqueada no OEM";
      case "desbloquear":
        return "Licença desbloqueada no OEM";
      default:
        return "Licença alterada no OEM";
    }
  }
  if (e.grupo === "cadastro") {
    return e.campo === "cnpj" ? "CNPJ da filial corrigido no OEM" : "Nome da filial corrigido no OEM";
  }
  switch (e.acao) {
    case "ativar":
      return "Módulo ativado no OEM";
    case "quantidade":
      return "Quantidade do módulo alterada no OEM";
    case "cancelar":
      return "Módulo cancelado no OEM";
    default:
      return "Envio ao OEM";
  }
}

// A segunda linha: o que exatamente mudou. Só o que existe entra, para a linha
// não virar uma fileira de traços.
function subtitulo(e: OemEvento): string {
  const partes: string[] = [];
  if (e.grupo === "modulo") {
    if (e.modulo) partes.push(e.modulo);
    if (e.produto) partes.push(e.produto);
    if (e.quantidade != null) {
      partes.push(
        e.acao === "cancelar"
          ? `${e.quantidade} cancelada${Number(e.quantidade) > 1 ? "s" : ""}`
          : `quantidade ${e.quantidade}`,
      );
    }
  }
  if (e.grupo === "cadastro") {
    partes.push(`de ${e.valor_anterior || "vazio"} para ${e.valor_novo || "vazio"}`);
  }
  if (e.grupo === "licenca") {
    // Só a dimensão que o clique mexeu. Mostrar as duas faria parecer que
    // bloquear também desativou.
    if (e.acao === "bloquear" || e.acao === "desbloquear") {
      if (e.bloqueado_antes != null || e.bloqueado_depois != null) {
        partes.push(`bloqueada: ${simNao(e.bloqueado_antes)} para ${simNao(e.bloqueado_depois)}`);
      }
    } else if (e.desativado_antes != null || e.desativado_depois != null) {
      partes.push(`desativada: ${simNao(e.desativado_antes)} para ${simNao(e.desativado_depois)}`);
    }
  }
  if (e.filial_codigo) partes.push(`filial ${e.filial_codigo}`);
  return partes.join(" · ");
}

const simNao = (v: boolean | null) => (v === true ? "sim" : v === false ? "não" : "sem leitura");

const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

const quandoBR = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/**
 * Quem pediu.
 *
 * São três casos, não dois. Escrita que passa por edge function roda como
 * `service_role` e não tem `auth.uid()`; um usuário sem funcionário cadastrado
 * chega aqui com id e sem nome. Chamar os dois de "Sincronização OEM" diria que
 * a máquina mexeu na licença de um cliente por conta própria.
 */
function quemPediu(e: OemEvento): string {
  if (e.quem) return e.quem;
  if (e.usuario_id) return "Usuário sem nome cadastrado";
  return rotuloDaFonte(e.fonte) ?? "Sincronização OEM";
}

export function OemHistoricoConteudo({ clienteId, aberto }: { clienteId: string; aberto: boolean }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [filtro, setFiltro] = useState<FiltroOem>("envios");

  const eventosQuery = useQuery<OemEvento[]>({
    queryKey: ["oem-historico-cliente", tid, clienteId],
    enabled: aberto && !!tid && !!clienteId,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_historico_do_cliente", {
        p_cliente_id: clienteId,
        p_tenant_id: tid,
        p_limite: 200,
      });
      if (error) throw error;
      return (data ?? []) as OemEvento[];
    },
  });

  const eventos = eventosQuery.data ?? [];

  const filtrados = useMemo(() => {
    return eventos.filter((e) => {
      const simulado = e.simulado === true || e.status === "simulado";
      switch (filtro) {
        case "envios":
          return !simulado;
        case "falhas":
          return e.status === "erro" || e.status === "invalido" || e.status === "recusado";
        case "simulacoes":
          return simulado;
        default:
          return true;
      }
    });
  }, [eventos, filtro]);

  const temSimulacao = eventos.some((e) => e.simulado === true || e.status === "simulado");

  return (
    <>
      <div className="flex shrink-0 items-center justify-end">
        {eventos.length > 0 && (
          <Select value={filtro} onValueChange={(v) => setFiltro(v as FiltroOem)}>
            <SelectTrigger className="w-[200px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="envios">Envios</SelectItem>
              <SelectItem value="falhas">Falhas</SelectItem>
              {temSimulacao && <SelectItem value="simulacoes">Simulações</SelectItem>}
              <SelectItem value="tudo">Tudo, com simulações</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {eventosQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : eventosQuery.isError ? (
          <div className="text-sm text-muted-foreground">
            Não foi possível carregar o histórico do OEM.
          </div>
        ) : eventos.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Nenhum envio ao OEM registrado para este cliente.
          </div>
        ) : filtrados.length === 0 ? (
          <div className="text-sm text-muted-foreground">Nenhum registro neste filtro.</div>
        ) : (
          <ScrollArea className="h-full pr-3">
            <div className="space-y-3">
              {filtrados.map((e) => {
                const cfg = statusConfig(e.status);
                const StatusIcon = cfg.icon;
                const AcaoIcon = e.grupo === "licenca" ? ICONE_ACAO[e.acao] : null;
                const sub = subtitulo(e);
                return (
                  <div key={e.id} className="rounded-md border p-3 text-sm space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-muted-foreground text-xs">
                        <Clock className="h-3 w-3" />
                        {quandoBR(e.quando)}
                      </div>
                      <Badge variant="outline" className={cfg.classe}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {cfg.label}
                      </Badge>
                    </div>

                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-1.5">
                        {AcaoIcon && <AcaoIcon className="h-3.5 w-3.5 shrink-0" />}
                        {titulo(e)}
                      </div>
                      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {quemPediu(e)}
                        {e.decidido_por && (
                          <span>
                            {" "}
                            · aprovado por {e.decidido_por}
                            {e.decidido_em ? ` em ${quandoBR(e.decidido_em)}` : ""}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Desativar no OEM é agendamento: a licença fica de pé e
                        continua sendo cobrada até esta data. Sem dizer isso, a
                        tela contradiz o portal do parceiro. */}
                    {e.baixa_em && (
                      <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
                        Baixa marcada para {dataBR(e.baixa_em)}. Até lá a licença continua de pé e
                        sendo cobrada pelo parceiro.
                      </div>
                    )}

                    {e.motivo && (
                      <div className="rounded bg-muted/60 border px-2 py-1.5 text-xs text-muted-foreground whitespace-pre-wrap break-words">
                        {e.motivo}
                      </div>
                    )}

                    {e.erro && (
                      <div className="rounded bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 px-2 py-1.5 text-xs text-red-700 dark:text-red-400 whitespace-pre-wrap break-words">
                        {e.erro}
                      </div>
                    )}

                    {/* A releitura do parceiro não confirmou. Isso não é falha:
                        a API dele atrasa. Quem lê precisa saber que o pedido foi
                        aceito e a conferência é que ficou para depois. */}
                    {e.status === "sem_confirmacao" && (
                      <div className="rounded bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 px-2 py-1.5 text-xs text-amber-800 dark:text-amber-300">
                        O parceiro aceitou, mas a releitura ainda mostrava o estado anterior. Costuma
                        ser atraso da API dele.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </div>
    </>
  );
}
