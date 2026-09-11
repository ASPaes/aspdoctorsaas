import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/hooks/usePermissions";
import { InstanceSetupCollapsible } from "./InstanceSetupCollapsible";
import { InstancesList } from "./InstancesList";
import { AddInstanceDialog } from "./AddInstanceDialog";
import EmailAccountsTab from "@/components/configuracoes/email/EmailAccountsTab";

/**
 * Canais: por onde a operação fala com o cliente.
 *
 * O e-mail era uma seção própria do menu e virou aba daqui (11/09/2026). As abas
 * seguem o mesmo componente de Distribuição e Operação.
 */
export default function CanaisTab({ abaInicial = "whatsapp" }: { abaInicial?: "whatsapp" | "email" }) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const { can, rbacEnabled } = usePermissions();
  // com RBAC ligado, quem não enxerga cfg.email não vê a aba; sem RBAC, quem
  // chegou até aqui já é admin
  const mostrarEmail = !rbacEnabled || can("cfg.email", "view");

  return (
    <Tabs defaultValue={mostrarEmail ? abaInicial : "whatsapp"}>
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>
        {mostrarEmail && <TabsTrigger value="email">E-mail</TabsTrigger>}
      </TabsList>

      <TabsContent value="whatsapp" className="mt-4">
        <div className="space-y-4">
          <InstanceSetupCollapsible onOpenAddDialog={() => setAddDialogOpen(true)} />
          <div className="flex justify-end">
            <Button onClick={() => setAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />Nova Instância
            </Button>
          </div>
          <InstancesList />
        </div>
      </TabsContent>

      {mostrarEmail && (
        <TabsContent value="email" className="mt-4">
          <EmailAccountsTab />
        </TabsContent>
      )}

      <AddInstanceDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </Tabs>
  );
}
