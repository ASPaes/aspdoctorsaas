import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import EmailAccountsTab from "./EmailAccountsTab";
import EmailParametrosTab from "./EmailParametrosTab";

/**
 * Aba E-mail dentro de Canais: Cadastros (as contas) e Parâmetros de Envio
 * (o que sai sozinho). Cadastros abre por padrão.
 */
export default function EmailCanalTab() {
  return (
    <Tabs defaultValue="cadastros">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="cadastros">Cadastros</TabsTrigger>
        <TabsTrigger value="parametros">Parâmetros de Envio</TabsTrigger>
      </TabsList>
      <TabsContent value="cadastros" className="mt-4">
        <EmailAccountsTab />
      </TabsContent>
      <TabsContent value="parametros" className="mt-4">
        <EmailParametrosTab />
      </TabsContent>
    </Tabs>
  );
}
