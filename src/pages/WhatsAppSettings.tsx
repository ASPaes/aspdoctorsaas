import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WhatsAppInstancesTab from "@/components/configuracoes/WhatsAppInstancesTab";
import MacrosTab from "@/components/whatsapp/settings/MacrosTab";
import AssignmentTab from "@/components/whatsapp/settings/AssignmentTab";
import TeamTab from "@/components/configuracoes/whatsapp/TeamTab";
import SecuritySettingsTab from "@/components/configuracoes/whatsapp/SecuritySettingsTab";

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
          <TabsTrigger value="team">Equipe</TabsTrigger>
          <TabsTrigger value="security">Segurança</TabsTrigger>
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

        <TabsContent value="team" className="mt-4">
          <TeamTab />
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <SecuritySettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
