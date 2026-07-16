import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Send, Loader2, CheckCircle2, AlertTriangle, Ban, RefreshCw } from "lucide-react";

interface Props {
  tenantId: string | null | undefined;
  contratoId: string;
  createdAt: string | null | undefined;
}

type FilaRow = {
  contrato_id: string;
  status: "pendente" | "processando" | "ok" | "ignorado" | "erro" | "invalido" | string;
  ultimo_erro: string | null;
  enfileirado_em: string | null;
  processado_em: string | null;
};

const fmtDateTime = (v: string | null | undefined) => {
  if (!v) return "";
  try {
    return new Date(v).toLocaleString("pt-BR");
  } catch {
    return String(v);
  }
};

export default function EnviarContratoOmieButton({ tenantId, contratoId, createdAt }: Props) {
  const [sending, setSending] = useState(false);
  const qc = useQueryClient();

  // Gate: só mostra se há data de corte configurada e o contrato é posterior.
  const { data: dataCorte, isLoading: cutoffLoading } = useQuery({
    queryKey: ["omie-data-corte", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("omie_integration" as any) as any)
        .select("integrar_a_partir_de")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data?.integrar_a_partir_de ?? null) as string | null;
    },
  });

  // Estado real do envio vem da fila. Polling condicional: só quando há algo em voo.
  const { data: filaRow } = useQuery({
    queryKey: ["omie-sync-fila", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("omie_sync_fila" as any) as any)
        .select("contrato_id, status, ultimo_erro, enfileirado_em, processado_em")
        .eq("contrato_id", contratoId)
        .order("enfileirado_em", { ascending: false })
        .limit(1);
      if (error) throw error;
      return ((data?.[0] as FilaRow) ?? null);
    },
    refetchInterval: (query) => {
      const row = query.state.data as FilaRow | null | undefined;
      if (!row) return false;
      return row.status === "pendente" || row.status === "processando" ? 3000 : false;
    },
  });

  if (cutoffLoading) return null;
  if (!dataCorte) return null;
  if (!createdAt) return null;
  const created = createdAt.slice(0, 10);
  const corte = dataCorte.slice(0, 10);
  if (created < corte) return null;

  const handleEnviar = async () => {
    if (!contratoId) return;
    setSending(true);
    try {
      const { error } = await (supabase.rpc as any)("enfileirar_sync_omie", {
        p_contrato_id: contratoId,
        p_origem: "manual",
      });
      if (error) throw error;

      // fire-and-forget: cron */2 é a rede de retry
      void supabase.functions.invoke("omie-sync-processar");

      qc.invalidateQueries({ queryKey: ["omie-sync-fila"] });
      toast.success("Envio enfileirado. Acompanhe o status aqui.");
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao enfileirar o envio.");
    } finally {
      setSending(false);
    }
  };

  const status = filaRow?.status;
  const inFlight = status === "pendente" || status === "processando";

  if (inFlight) {
    return (
      <Button type="button" variant="outline" size="sm" disabled>
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Enviando…
      </Button>
    );
  }

  if (status === "ok") {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-4 w-4" />
        <span>Contrato sincronizado</span>
        {filaRow?.processado_em && (
          <span className="text-xs text-muted-foreground">em {fmtDateTime(filaRow.processado_em)}</span>
        )}
      </div>
    );
  }

  if (status === "ignorado") {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Ban className="h-4 w-4" />
        <span>Sem vínculo com o Omie — resolver na Conferência</span>
      </div>
    );
  }

  if (status === "erro") {
    return (
      <div className="flex flex-col gap-1">
        <div className="inline-flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
          <RefreshCw className="h-4 w-4" />
          <span>Tentando novamente automaticamente</span>
        </div>
        {filaRow?.ultimo_erro && (
          <div className="text-xs text-muted-foreground max-w-md break-words">{filaRow.ultimo_erro}</div>
        )}
        <div>
          <Button type="button" variant="outline" size="sm" onClick={handleEnviar} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Tentar agora
          </Button>
        </div>
      </div>
    );
  }

  if (status === "invalido") {
    return (
      <div className="flex flex-col gap-1">
        <div className="inline-flex items-center gap-2 text-sm text-destructive font-medium">
          <AlertTriangle className="h-4 w-4" />
          <span>{filaRow?.ultimo_erro ?? "Cadastro inválido para envio ao Omie"}</span>
        </div>
        <div>
          <Button type="button" variant="outline" size="sm" onClick={handleEnviar} disabled={sending}>
            {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar para Omie
          </Button>
        </div>
      </div>
    );
  }

  // Sem linha na fila
  return (
    <Button type="button" variant="outline" size="sm" onClick={handleEnviar} disabled={sending}>
      {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
      Enviar para Omie
    </Button>
  );
}
