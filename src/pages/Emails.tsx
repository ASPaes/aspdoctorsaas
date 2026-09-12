import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Inbox, KeyRound, MailCheck, ShieldOff } from "lucide-react";
import EmailsEnviadosTab from "@/components/emails/EmailsEnviadosTab";

/**
 * E-mails: tudo que a operação enviou e recebeu dos clientes.
 *
 * Enviados já funciona, lendo o registro que a send-email grava. Recebidos
 * depende do leitor de caixa, que é a etapa seguinte; o texto abaixo explica o
 * que vai aparecer ali para ninguém achar que a aba está quebrada.
 */
export default function Emails() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">E-mails</h1>
        <p className="mt-1 text-muted-foreground">
          Tudo que a operação enviou e recebeu dos clientes, de qualquer área.
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
          <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-dashed px-6 py-10">
            <div className="flex flex-col items-center gap-2 text-center">
              <Inbox className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">As respostas dos clientes ainda não estão sendo lidas</p>
              <p className="text-sm text-muted-foreground">
                Esta aba passa a mostrar a resposta que o cliente manda ao e-mail enviado daqui, ligada ao atendimento
                ou ao ticket que deu origem.
              </p>
            </div>

            <div className="space-y-2.5 rounded-md bg-muted/50 p-4 text-sm">
              <p className="flex gap-2.5">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>
                  Cada e-mail que sai leva um endereço de resposta com uma identificação própria. É ela que faz a
                  resposta encontrar o atendimento certo, sem depender do assunto.
                </span>
              </p>
              <p className="flex gap-2.5">
                <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>
                  Propaganda e boletim não entram: eles nunca respondem a um e-mail seu, então nunca carregam essa
                  identificação.
                </span>
              </p>
              <p className="flex gap-2.5">
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>
                  A leitura é ligada conta por conta, em Configurações › Atendimento › Canais › E-mail, e nunca marca
                  nada como lido na caixa.
                </span>
              </p>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
