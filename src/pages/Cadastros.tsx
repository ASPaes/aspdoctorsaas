import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function Cadastros() {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("populate-cidades", {
        method: "POST",
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Erro desconhecido");

      toast({
        title: "Sincronização concluída",
        description: `${data.estados} estados e ${data.cidades} cidades sincronizados.`,
      });
    } catch (err: any) {
      toast({
        title: "Erro na sincronização",
        description: err.message || "Não foi possível sincronizar.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cadastros</h1>
          <p className="mt-2 text-muted-foreground">Gerencie seus cadastros aqui.</p>
        </div>
        <Button onClick={handleSync} disabled={syncing} variant="outline">
          <RefreshCw className={syncing ? "animate-spin" : ""} />
          {syncing ? "Sincronizando..." : "Sincronizar Estados/Cidades"}
        </Button>
      </div>
    </div>
  );
}
