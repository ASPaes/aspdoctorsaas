import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EmailAccountsTab from "./EmailAccountsTab";
import EmailParametrosTab from "./EmailParametrosTab";
import EmailParametrosRecebidosTab from "./EmailParametrosRecebidosTab";

/**
 * Aba E-mail dentro de Canais: Cadastros (as contas), Parâmetros de Envio
 * (o que sai sozinho) e Parâmetros de Recebidos (e-mail do cliente vira
 * ticket). Cadastros abre por padrão.
 */
export default function EmailCanalTab() {
  return (
    <Tabs defaultValue="cadastros">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="cadastros">Cadastros</TabsTrigger>
        <TabsTrigger value="parametros">Parâmetros de Envio</TabsTrigger>
        <TabsTrigger value="recebidos">Parâmetros de Recebidos</TabsTrigger>
      </TabsList>
      <TabsContent value="cadastros" className="mt-4">
        <EmailAccountsTab />
      </TabsContent>
      <TabsContent value="parametros" className="mt-4">
        <EmailParametrosTab />
      </TabsContent>
      <TabsContent value="recebidos" className="mt-4">
        <EmailParametrosRecebidosTab />
      </TabsContent>
    </Tabs>
  );
}
