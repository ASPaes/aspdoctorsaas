import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import TicketStatusesConfig from "./TicketStatusesConfig";
import TicketTagsConfig from "./TicketTagsConfig";

export default function TicketSettingsTab() {
  return (
    <Tabs defaultValue="status" className="space-y-4">
      <TabsList>
        <TabsTrigger value="status">Status por setor</TabsTrigger>
        <TabsTrigger value="tags">Tags</TabsTrigger>
      </TabsList>
      <TabsContent value="status">
        <TicketStatusesConfig />
      </TabsContent>
      <TabsContent value="tags">
        <TicketTagsConfig />
      </TabsContent>
    </Tabs>
  );
}
