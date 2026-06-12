import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SetupGuideCollapsible } from "./SetupGuideCollapsible";
import { InstanceSetupCollapsible } from "./InstanceSetupCollapsible";
import { InstancesList } from "./InstancesList";
import { AddInstanceDialog } from "./AddInstanceDialog";

export default function CanaisTab() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  return (
    <Tabs defaultValue="instancias" className="space-y-4">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="instancias">Instâncias</TabsTrigger>
        <TabsTrigger value="setup">Setup</TabsTrigger>
      </TabsList>

      <TabsContent value="instancias" className="space-y-4">
        <InstanceSetupCollapsible onOpenAddDialog={() => setAddDialogOpen(true)} />
        <div className="flex justify-end">
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />Nova Instância
          </Button>
        </div>
        <InstancesList />
        <AddInstanceDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
      </TabsContent>

      <TabsContent value="setup">
        <SetupGuideCollapsible />
      </TabsContent>
    </Tabs>
  );
}
