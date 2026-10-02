import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePortao } from "@/hooks/usePortao";
import AtendimentoCsatTab from "./AtendimentoCsatTab";
import AttendancePauseReasonsTab from "@/components/configuracoes/AttendancePauseReasonsTab";
import { MacrosManager } from "./MacrosManager";
import WhatsAppGroupsTab from "./WhatsAppGroupsTab";
import RiscoChurnSettings from "./RiscoChurnSettings";
import { WhatsappOficialCustoCard } from "./WhatsappOficialCustoCard";

export default function OperacaoTab() {
  // Hoje qualquer pessoa que abre Configuracoes > Operacao ve Macros.
  const podeVerMacros = usePortao("atend.macros");
  // ?sub=grupos abre direto na subaba (atalho do modal de grupos do chat).
  const [searchParams] = useSearchParams();
  const sub = searchParams.get("sub");

  return (
    <Tabs defaultValue={sub === "grupos" ? "grupos" : "atendimento"}>
      <TabsList className="flex-wrap h-auto gap-1">
        <TabsTrigger value="atendimento">Atendimento / CSAT</TabsTrigger>
        <TabsTrigger value="pausas">Pausas</TabsTrigger>
        {podeVerMacros && <TabsTrigger value="macros">Macros</TabsTrigger>}
        <TabsTrigger value="grupos">Grupos</TabsTrigger>
        <TabsTrigger value="risco">Risco de churn</TabsTrigger>
      </TabsList>
      <TabsContent value="atendimento" className="mt-4 space-y-6">
        {/* Só aparece para admin de empresa com número da API Oficial. */}
        <WhatsappOficialCustoCard />
        <AtendimentoCsatTab />
      </TabsContent>
      <TabsContent value="pausas" className="mt-4">
        <AttendancePauseReasonsTab />
      </TabsContent>
      {podeVerMacros && (
        <TabsContent value="macros" className="mt-4">
          <MacrosManager />
        </TabsContent>
      )}
      <TabsContent value="grupos" className="mt-4">
        <WhatsAppGroupsTab />
      </TabsContent>
      <TabsContent value="risco" className="mt-4">
        <RiscoChurnSettings />
      </TabsContent>
    </Tabs>
  );
}
