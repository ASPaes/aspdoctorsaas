import { useAgentPresence } from "@/hooks/useAgentPresence";
import { Button } from "@/components/ui/button";
import { Play, Coffee } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export default function AgentPresenceOverlay() {
  const { status, isBlocked, startShift, setActive } = useAgentPresence();
  const [loading, setLoading] = useState(false);

  if (!isBlocked) return null;

  const handleAction = async () => {
    setLoading(true);
    try {
      if (status === "off") {
        await startShift();
        toast.success("Expediente iniciado!");
      } else {
        await setActive();
        toast.success("Voltou ao ativo!");
      }
    } catch (err: any) {
      toast.error(err.message || "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/70 backdrop-blur-[2px]">
      <div className="text-center max-w-xs px-6 py-8 rounded-xl bg-card border border-border shadow-lg">
        <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
          <Coffee className="w-7 h-7 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-1">
          {status === "off" ? "Expediente não iniciado" : "Você está em pausa"}
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          {status === "off"
            ? "Inicie seu expediente para atender conversas."
            : "Retorne ao status ativo para continuar atendendo."}
        </p>
        <Button onClick={handleAction} disabled={loading} className="w-full">
          <Play className="h-4 w-4 mr-2" />
          {status === "off" ? "Iniciar expediente" : "Voltar ao ativo"}
        </Button>
      </div>
    </div>
  );
}
