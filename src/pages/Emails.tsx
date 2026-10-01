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
  // Quem filtra é o RLS, pela conta (01/10/2026): conta ligada a usuário ou
  // setor só aparece para eles; sem vínculo, decidem as permissões. Admin e
  // super admin veem tudo. O texto só explica por que a lista muda de pessoa
  // para pessoa.
  const veTudo = profile?.is_super_admin === true || profile?.role === "admin";
  const noCelular = useIsMobile() || isChatHost();
  const queryClient = useQueryClient();
  // e-mail avulso (29/09/2026): fora de chat, ticket ou jornada
  const [escrita, setEscrita] = useState<PedidoEscrita | null>(null);
  // DEM-0503: volta na última aba que a pessoa usou (por usuário, neste navegador)
  const chaveAba = `emails:aba:${profile?.user_id ?? "anon"}`;
  const [aba, setAba] = useState<string>(() => {
    try {
      return localStorage.getItem(chaveAba) === "enviados" ? "enviados" : "recebidos";
    } catch {
      return "recebidos";
    }
  });
  const mudarAba = (valor: string) => {
    setAba(valor);
    try {
      localStorage.setItem(chaveAba, valor);
    } catch {
      /* navegador sem storage: só não lembra */
    }
  };

  return (
    <div className="space-y-4">
      {/* No telefone o nome do modulo ja esta na barra do app, e estas cinco linhas
          empurravam a primeira mensagem para fora da tela. */}
      {!noCelular && (
        <div>
          <h1 className="text-2xl font-bold">E-mails</h1>
          <p className="mt-1 text-muted-foreground">
            {veTudo
              ? "Tudo que a operação enviou e recebeu dos clientes, de qualquer área."
              : "O que foi enviado aos clientes e o que chegou deles, nas caixas que você acompanha."}
          </p>
        </div>
      )}

      <Tabs value={aba} onValueChange={mudarAba}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="recebidos">Caixa de entrada</TabsTrigger>
            <TabsTrigger value="enviados">Enviados</TabsTrigger>
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
