import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOmieContaDoCliente } from "@/hooks/useOmieContaDoCliente";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Send,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
} from "lucide-react";

interface Props {
  tenantId: string | null | undefined;
  contratoId: string;
  createdAt: string | null | undefined;
}

type FilaRow = {
  id: string;
  status: string;
  ultimo_erro: string | null;
  enfileirado_em: string;
  processado_em: string | null;
};

const IN_FLIGHT = new Set(["pendente", "processando"]);

export default function EnviarContratoOmieButton({ tenantId, contratoId, createdAt }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  // Gate: só mostra se há data de corte configurada e o contrato é posterior.
  // Data de corte DA CONTA que atende este contrato (contrato -> cliente -> unidade -> conta).
  // Era por tenant com .maybeSingle(): com duas contas erra, e o botão sumia nas duas unidades.
  const contaOmieQ = useOmieContaDoCliente(null, contratoId);
  const dataCorte = contaOmieQ.data?.integrar_a_partir_de ?? null;
  const cutoffLoading = contaOmieQ.isLoading;

  // Linha mais recente da fila para este contrato.
  const { data: fila } = useQuery<FilaRow | null>({
    queryKey: ["omie-sync-fila", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("omie_sync_fila" as any) as any)
        .select("id, status, ultimo_erro, enfileirado_em, processado_em")
        .eq("contrato_id", contratoId)
        .order("enfileirado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as FilaRow | null;
    },
    refetchInterval: (q) => {
      const row = q.state.data as FilaRow | null | undefined;
      return row && IN_FLIGHT.has(row.status) ? 3000 : false;
    },
  });

  // Se estiver em voo, garantir que o processador esteja rodando (best-effort).
  useEffect(() => {
    if (fila && IN_FLIGHT.has(fila.status)) {
      // fire-and-forget; nenhum toast.
      void supabase.functions.invoke("omie-sync-processar").catch(() => {});
    }
  }, [fila?.status]);

  if (cutoffLoading) return null;
  if (!dataCorte) return null;
  if (!createdAt) return null;
  const created = createdAt.slice(0, 10);
  const corte = dataCorte.slice(0, 10);
  if (created < corte) return null;

  const status = fila?.status ?? null;
  const inFlight = !!status && IN_FLIGHT.has(status);
  const disabled = submitting || inFlight;

  const handleClick = async () => {
    if (disabled) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("solicitar_sync_omie" as any, {
        p_contrato_id: contratoId,
      } as any);

      if (error) {
        toast.error("Falha ao solicitar envio: " + error.message);
        return;
      }

      const resp = data as { ok?: boolean; motivo?: string } | null;

      if (!resp?.ok) {
        const motivos: Record<string, string> = {
          sem_permissao: "Você não tem permissão para enviar contratos ao Omie.",
          barrado_por_regra:
            "Este contrato não entra na sincronização — modelo marcado para não sincronizar, unidade fora do escopo, ou integração pausada.",
          contrato_nao_encontrado: "Contrato não encontrado.",
        };
        toast.error(motivos[resp?.motivo ?? ""] ?? "Envio não realizado.");
        return;
      }

      // Nasceu na fila. Dispara o processador e revalida.
      void supabase.functions.invoke("omie-sync-processar").catch(() => {});
      qc.invalidateQueries({ queryKey: ["omie-sync-fila", contratoId] });
      qc.invalidateQueries({ queryKey: ["omie-sync-fila"] });
    } catch (e: any) {
      toast.error("Falha ao solicitar envio: " + (e?.message ?? "erro desconhecido"));
    } finally {
      setSubmitting(false);
    }
  };

  // Estado visual por status.
  let icon = <Send className="h-4 w-4 mr-2" />;
  let label = "Enviar para Omie";
  let variant: "outline" | "default" | "destructive" | "secondary" = "outline";
  let title: string | undefined;

  if (submitting) {
    icon = <Loader2 className="h-4 w-4 mr-2 animate-spin" />;
    label = "Solicitando…";
  } else if (status === "pendente") {
    icon = <Loader2 className="h-4 w-4 mr-2 animate-spin" />;
    label = "Na fila…";
    variant = "secondary";
  } else if (status === "processando") {
    icon = <Loader2 className="h-4 w-4 mr-2 animate-spin" />;
    label = "Processando…";
    variant = "secondary";
  } else if (status === "ok") {
    icon = <CheckCircle2 className="h-4 w-4 mr-2 text-green-600" />;
    label = "Enviado — reenviar";
  } else if (status === "ignorado") {
    icon = <MinusCircle className="h-4 w-4 mr-2 text-muted-foreground" />;
    label = "Ignorado — tentar novamente";
    title = fila?.ultimo_erro ?? "Não entrou na sincronização (regra ou de/para).";
  } else if (status === "invalido") {
    icon = <AlertTriangle className="h-4 w-4 mr-2 text-amber-600" />;
    label = "Inválido — tentar novamente";
    title = fila?.ultimo_erro ?? "Dados inválidos para envio.";
  } else if (status === "erro") {
    icon = <XCircle className="h-4 w-4 mr-2 text-destructive" />;
    label = "Erro — tentar novamente";
    variant = "destructive";
    title = fila?.ultimo_erro ?? "Falha ao enviar ao Omie.";
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={handleClick}
      disabled={disabled}
      title={title}
    >
      {icon}
      {label}
    </Button>
  );
}
