import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import RoteamentoInstanciasTab from "./RoteamentoInstanciasTab";
import SetoresInstanciasTab from "./SetoresInstanciasTab";
import { AssignmentRulesManager } from "./AssignmentRulesManager";

export default function DistribuicaoTab() {
  return (
    <Tabs defaultValue="roteamento">
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="roteamento">Roteamento</TabsTrigger>
        <TabsTrigger value="setores">Setores</TabsTrigger>
        <TabsTrigger value="atribuicao">Atribuição</TabsTrigger>
      </TabsList>
      <TabsContent value="roteamento" className="mt-4">
        <RoteamentoInstanciasTab />
      </TabsContent>
      <TabsContent value="setores" className="mt-4">
        <SetoresInstanciasTab />
      </TabsContent>
      <TabsContent value="atribuicao" className="mt-4">
        <AssignmentRulesManager />
      </TabsContent>
    </Tabs>
  );
}
