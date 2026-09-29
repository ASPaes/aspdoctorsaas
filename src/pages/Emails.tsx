import { useState } from "react";
import { PenSquare } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import EmailsEnviadosTab from "@/components/emails/EmailsEnviadosTab";
import EmailsRecebidosTab from "@/components/emails/EmailsRecebidosTab";
import { useIsMobile } from "@/hooks/use-mobile";
import { isChatHost } from "@/lib/chatHost";
import { EscreverEmailDialog, type PedidoEscrita } from "@/components/emails/EscreverEmailDialog";

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
  const noCelular = useIsMobile() || isChatHost();
  const queryClient = useQueryClient();
  // e-mail avulso (29/09/2026): fora de chat, ticket ou jornada
  const [escrita, setEscrita] = useState<PedidoEscrita | null>(null);

  return (
    <div className="space-y-4">
      {/* No telefone o nome do modulo ja esta na barra do app, e estas cinco linhas
          empurravam a primeira mensagem para fora da tela. */}
      {!noCelular && (
        <div>
          <h1 className="text-2xl font-bold">E-mails</h1>
          <p className="mt-1 text-muted-foreground">
            {soOsProprios
              ? "Os e-mails que você enviou aos clientes e as respostas deles."
              : "Tudo que a operação enviou e recebeu dos clientes, de qualquer área."}
          </p>
        </div>
      )}

      <Tabs defaultValue="enviados">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="enviados">Enviados</TabsTrigger>
            <TabsTrigger value="recebidos">Recebidos</TabsTrigger>
          </TabsList>
          <Button className="gap-2" onClick={() => setEscrita({ modo: "novo", id: crypto.randomUUID() })}>
            <PenSquare className="h-4 w-4" />
            Escrever e-mail
          </Button>
        </div>

        <TabsContent value="enviados" className="mt-4">
          <EmailsEnviadosTab />
        </TabsContent>

        <TabsContent value="recebidos" className="mt-4">
          <EmailsRecebidosTab />
        </TabsContent>
      </Tabs>

      <EscreverEmailDialog
        pedido={escrita}
        onOpenChange={(aberto) => !aberto && setEscrita(null)}
        onEnviou={() => queryClient.invalidateQueries({ queryKey: ["emails_enviados"] })}
      />
    </div>
  );
}
