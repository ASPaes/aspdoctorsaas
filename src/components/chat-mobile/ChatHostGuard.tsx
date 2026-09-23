import { ReactNode, useEffect, useState } from "react";
import { Loader2, MessageSquareOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/usePermissions";
import { usePortao } from "@/hooks/usePortao";
import { APP_HOST_URL } from "@/lib/chatHost";

const SEGUNDOS = 5;

/**
 * O endereço do chat é só para quem atende. Quem não tem acesso ao Chat vê o
 * aviso e é levado para o sistema completo — decisão do Alexandre: mandar
 * direto, sem explicar, faz a pessoa achar que o link dela está quebrado.
 *
 * A chave é `atendimento_chat`, a MESMA que protege /whatsapp no App.tsx.
 * 22/09/2026: aqui estava `nav.chat`, aposentada pelo RBAC v2. Ela não existe
 * mais em tenant nenhum — com ou sem RBAC ligado —, então o guard barrava todo
 * usuário que não fosse super admin: um admin da Digi Office abriu o endereço
 * e foi mandado de volta para o app.
 *
 * `usePortao` em vez de `can()` direto porque ele já trata os três casos do
 * RBAC: super admin passa, empresa sem RBAC segue a regra de hoje, e ninguém é
 * barrado enquanto as permissões carregam.
 */
export default function ChatHostGuard({ children }: { children: ReactNode }) {
  const { isLoading } = usePermissions();
  const liberado = usePortao("atendimento_chat");
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
