import { ReactNode, useEffect, useState } from "react";
import { Loader2, MessageSquareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { APP_HOST_URL } from "@/lib/chatHost";

const SEGUNDOS = 5;

/**
 * O endereço do chat é só para quem atende. Quem não tem `nav.chat` vê o aviso
 * e é levado para o sistema completo — decisão do Alexandre: mandar direto,
 * sem explicar, faz a pessoa achar que o link dela está quebrado.
 */
export default function ChatHostGuard({ children }: { children: ReactNode }) {
  const { can, isLoading } = usePermissions();
  const liberado = can("nav.chat", "view");
  const [restante, setRestante] = useState(SEGUNDOS);

  useEffect(() => {
    if (isLoading || liberado) return;

    const tick = window.setInterval(() => {
      setRestante((s) => Math.max(0, s - 1));
    }, 1000);
    const ida = window.setTimeout(() => {
      window.location.replace(APP_HOST_URL);
    }, SEGUNDOS * 1000);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(ida);
    };
  }, [isLoading, liberado]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (liberado) return <>{children}</>;

  return (
    <div className="flex h-full items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquareOff className="h-8 w-8 text-muted-foreground" />
        </div>
        <h1 className="mb-2 text-xl font-semibold text-foreground">
          Este endereço é só do Chat
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Seu usuário não tem acesso ao Chat, mas continua com o resto do
          DoctorSaaS. Estamos te levando para o sistema completo
          {restante > 0 ? ` em ${restante}s` : ""}.
        </p>
        <Button
          className="w-full"
          onClick={() => window.location.replace(APP_HOST_URL)}
        >
          Ir agora para o DoctorSaaS
        </Button>
      </div>
    </div>
  );
}
