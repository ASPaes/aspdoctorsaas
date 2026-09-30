// DEM-0425 — cancelamento agendado de produto / contrato.
//
// O agendamento mora em `cancelamentos_agendados`; contrato e produto seguem
// `ativo` até a data (o MRR e o "cliente cancelado" leem esse status). O selo
// "Em cancelamento" é derivado daqui, só na tela. Quem executa na data é o cron
// diário `fn_processar_cancelamentos_agendados`, pelas mesmas RPCs do "Cancelar agora".
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarClock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CancelamentoAgendado {
  id: string;
  alvo: "produto" | "contrato";
  cliente_produto_id: string | null;
  contrato_id: string | null;
  data_efetiva: string;
  observacao: string | null;
}

export const cancelAgendKey = (tid: string | null | undefined, clienteId: string) =>
  ["cancelamentos_agendados", tid, clienteId] as const;

export function useCancelamentosAgendados(tid: string | null | undefined, clienteId: string) {
  return useQuery<CancelamentoAgendado[]>({
    queryKey: cancelAgendKey(tid, clienteId),
    enabled: !!clienteId,
    queryFn: async () => {
      let q = (supabase.from("cancelamentos_agendados" as any) as any)
        .select("id, alvo, cliente_produto_id, contrato_id, data_efetiva, observacao")
        .eq("cliente_id", clienteId)
        .eq("status", "agendado");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CancelamentoAgendado[];
    },
  });
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const amanhaISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return iso(d);
};

export const fmtDataBR = (s: string | null | undefined) => {
  if (!s) return "";
  const [y, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

function atalhosDeData(): { label: string; valor: string }[] {
  const hoje = new Date();
  const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
  const mais30 = new Date(hoje);
  mais30.setDate(mais30.getDate() + 30);
  const fimProx = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0);
  const out: { label: string; valor: string }[] = [];
  // No último dia do mês, "fim deste mês" seria hoje — e hoje é "Cancelar agora".
  if (iso(fimMes) >= amanhaISO()) out.push({ label: "Fim deste mês", valor: iso(fimMes) });
  out.push({ label: "+30 dias", valor: iso(mais30) });
  out.push({ label: "Fim do próximo mês", valor: iso(fimProx) });
  return out;
}

/** Escolha "Cancelar agora" × "Agendar" + data. `dataAgendada` = já existe agendamento para o alvo. */
export function QuandoCancelar({
  modo, onModo, data, onData, dataAgendada, idPrefix,
}: {
  modo: "agora" | "agendar";
  onModo: (m: "agora" | "agendar") => void;
  data: string;
  onData: (d: string) => void;
  dataAgendada?: string | null;
  idPrefix: string;
}) {
  const opcao = (m: "agora" | "agendar", titulo: string, sub: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={modo === m}
      onClick={() => onModo(m)}
      className={cn(
        "rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        modo === m ? "border-sky-500 bg-sky-500/10" : "border-input hover:bg-muted/50",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <span className={cn(
          "h-3.5 w-3.5 shrink-0 rounded-full border-2",
          modo === m ? "border-sky-500 bg-sky-500 shadow-[inset_0_0_0_2px_hsl(var(--background))]" : "border-muted-foreground",
        )} />
        {titulo}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Quando?</Label>
        <div className="grid grid-cols-2 gap-2">
          {opcao("agora", "Cancelar agora", "Sai hoje, como sempre foi.")}
          {opcao(
            "agendar", "Agendar",
            dataAgendada ? `Já agendado para ${fmtDataBR(dataAgendada)}.` : "Segue ativo até a data escolhida.",
            !!dataAgendada,
          )}
        </div>
      </div>

      {modo === "agendar" && (
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-data-cancel`}>Data do cancelamento *</Label>
          <Input
            id={`${idPrefix}-data-cancel`}
            type="date"
            min={amanhaISO()}
            value={data}
            onChange={(e) => onData(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {atalhosDeData().map((a) => (
              <button
                key={a.label}
                type="button"
                onClick={() => onData(a.valor)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  data === a.valor ? "border-sky-500 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Até essa data continua ativo e contando no MRR. No dia, o sistema cancela sozinho às 00:05.
          </p>
        </div>
      )}
    </div>
  );
}

export async function agendarCancelamento(args: {
  alvo: "produto" | "contrato"; id: string; data: string; motivoId: number; observacao: string | null;
}) {
  const { error } = await (supabase.rpc as any)("agendar_cancelamento", {
    p_alvo: args.alvo,
    p_id: args.id,
    p_data: args.data,
    p_motivo_id: args.motivoId,
    p_observacao: args.observacao,
  });
  if (error) throw error;
}

/** Selo "Cancela em dd/mm" / "Em cancelamento" com o pulso âmbar. */
export function SeloCancelamento({ texto, title }: { texto: string; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
      </span>
      {texto}
    </span>
  );
}

export function DesfazerAgendamento({ ag, onDone }: { ag: CancelamentoAgendado; onDone: () => void }) {
  const [loading, setLoading] = useState(false);
  const qc = useQueryClient();
  return (
    <button
      type="button"
      disabled={loading}
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-sky-600 underline underline-offset-2 hover:text-sky-500 disabled:opacity-50 dark:text-sky-400"
      onClick={async (e) => {
        e.stopPropagation();
        setLoading(true);
        const { error } = await (supabase.rpc as any)("desfazer_cancelamento_agendado", { p_id: ag.id });
        setLoading(false);
        if (error) {
          toast({ variant: "destructive", title: "Não deu para desfazer", description: error.message });
          return;
        }
        toast({ title: "Agendamento desfeito", description: "Nada vai ser cancelado nessa data." });
        qc.invalidateQueries({ queryKey: ["cancelamentos_agendados"] });
        onDone();
      }}
    >
      {loading ? <XCircle className="h-3 w-3 animate-pulse" /> : <CalendarClock className="h-3 w-3" />}
      Desfazer agendamento
    </button>
  );
}
