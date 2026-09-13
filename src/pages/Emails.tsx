import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import EmailsEnviadosTab from "@/components/emails/EmailsEnviadosTab";
import EmailsRecebidosTab from "@/components/emails/EmailsRecebidosTab";

/**
 * E-mails: tudo que a operação enviou e recebeu dos clientes.
 *
 * Enviados lê o registro que a send-email grava. Recebidos lê o que o robô de
 * leitura das caixas registrou, e explica o que fazer quando nenhuma caixa
 * está ligada.
 */
export default function Emails() {
  const { profile } = useAuth();
  // Quem filtra é o RLS (operador só recebe do banco o que é dele). O texto só
  // explica por que a lista do operador é menor que a do gestor.
  const soOsProprios = profile?.role === "user" && profile?.is_super_admin !== true;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">E-mails</h1>
        <p className="mt-1 text-muted-foreground">
          {soOsProprios
            ? "Os e-mails que você enviou aos clientes e as respostas deles."
            : "Tudo que a operação enviou e recebeu dos clientes, de qualquer área."}
        </p>
      </div>

      <Tabs defaultValue="enviados">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="enviados">Enviados</TabsTrigger>
          <TabsTrigger value="recebidos">Recebidos</TabsTrigger>
        </TabsList>

        <TabsContent value="enviados" className="mt-4">
          <EmailsEnviadosTab />
        </TabsContent>

        <TabsContent value="recebidos" className="mt-4">
          <EmailsRecebidosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
