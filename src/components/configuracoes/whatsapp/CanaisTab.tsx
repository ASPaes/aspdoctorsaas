import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SetupGuideCollapsible } from "./SetupGuideCollapsible";
import { InstanceSetupCollapsible } from "./InstanceSetupCollapsible";
import { InstancesList } from "./InstancesList";
import { AddInstanceDialog } from "./AddInstanceDialog";

export default function CanaisTab() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      <SetupGuideCollapsible />
      <InstanceSetupCollapsible onOpenAddDialog={() => setAddDialogOpen(true)} />
      <div className="flex justify-end">
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />Nova Instância
        </Button>
      </div>
      <InstancesList />
      <AddInstanceDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
    </div>
  );
}
