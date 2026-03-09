import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppInstancesTab } from "@/components/configuracoes/WhatsAppInstancesTab";

export default function WhatsAppSettings() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate("/whatsapp")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-semibold">Configurações WhatsApp</h1>
      </div>

      <Tabs defaultValue="instances">
        <TabsList>
          <TabsTrigger value="instances">Instâncias</TabsTrigger>
          <TabsTrigger value="macros">Macros</TabsTrigger>
          <TabsTrigger value="assignment">Atribuição</TabsTrigger>
        </TabsList>

        <TabsContent value="instances" className="mt-4">
          <WhatsAppInstancesTab />
        </TabsContent>

        <TabsContent value="macros" className="mt-4">
          <MacrosTab />
        </TabsContent>

        <TabsContent value="assignment" className="mt-4">
          <AssignmentTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MacrosTab() {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <p className="text-sm">Gestão de macros será implementada na Sub-fase 2B.5</p>
    </div>
  );
}

function AssignmentTab() {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <p className="text-sm">Regras de atribuição serão implementadas na Sub-fase 2B.5</p>
    </div>
  );
}
