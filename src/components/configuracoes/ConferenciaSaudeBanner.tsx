import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertTriangle, AlertOctagon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";

type SaudeEstado = "ok" | "atrasado" | "parado" | "sem_integracao";

interface ConferenciaSaude {
  estado: SaudeEstado;
  motivo: string | null;
  espelho_em?: string | null;
  espelho_idade_min?: number | null;
  deteccao_em?: string | null;
  cron_ativo?: boolean;
  cron_ultima_execucao?: string | null;
  falhas_seguidas?: number;
}

interface Props {
  tenantId: string | null | undefined;
}

export function ConferenciaSaudeBanner({ tenantId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["conferencia_saude", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("conferencia_saude", {
        p_tenant_id: tenantId as string,
      });
      if (error) {
        console.warn("[ConferenciaSaudeBanner] RPC falhou:", error.message);
        return null;
      }
      return data as unknown as ConferenciaSaude;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading || !data) return null;
  if (data.estado === "ok" || data.estado === "sem_integracao") return null;

  const motivo = data.motivo ?? "";

  if (data.estado === "atrasado") {
    const idade = data.espelho_idade_min ?? 0;
    return (
      <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          <span className="font-semibold">{motivo}</span> Atualizado há {idade} min. Mudanças recentes no Omie podem não aparecer abaixo.
        </AlertDescription>
      </Alert>
    );
  }

  // parado
  const distancia = data.espelho_em
    ? formatDistanceToNow(new Date(data.espelho_em), { locale: ptBR, addSuffix: false })
    : null;
  const trecho = distancia ? `há ${distancia}` : "nunca sincronizado";

  return (
    <Alert variant="destructive">
      <AlertOctagon className="h-4 w-4" />
      <AlertDescription>
        <span className="font-semibold">{motivo}</span> Os valores da coluna Omie podem estar errados. Não decida por esta tela até normalizar. Último espelho: {trecho}.
      </AlertDescription>
    </Alert>
  );
}

export default ConferenciaSaudeBanner;
