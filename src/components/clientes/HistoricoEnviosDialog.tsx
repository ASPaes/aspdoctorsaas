import { useState } from "react";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOmieContaDoCliente } from "@/hooks/useOmieContaDoCliente";
import { useOemIntegracaoAtiva } from "@/hooks/useOemIntegracaoAtiva";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { History } from "lucide-react";
import { OmieHistoricoConteudo } from "./OmieHistoricoEnviosConteudo";
import { OemHistoricoConteudo } from "./OemHistoricoEnviosConteudo";

// ============================================================================
// O botão "Histórico de envios" do card Integração e o modal que ele abre.
//
// O modal era só do Omie, e a ficha tem dois sistemas: o cliente que teve um
// módulo cancelado ou a licença bloqueada no OEM não tinha onde ver isso, nem
// quem fez. Agora é uma aba por sistema, e cada aba busca por conta própria —
// abrir o modal não paga as duas consultas.
//
// A aba só aparece quando o sistema atende este cliente. Com um só ligado, não
// há troca a fazer e a barra de abas some: um seletor com uma opção é ruído.
// ============================================================================

export default function HistoricoEnviosButton({ clienteId }: { clienteId: string }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [aberto, setAberto] = useState(false);

  const contaOmieQuery = useOmieContaDoCliente(clienteId);
  const temOmie = contaOmieQuery.data?.ativo === true;
  const temOem = useOemIntegracaoAtiva() === true;

  // O Omie é a aba de entrada quando existe: é o histórico que a operação já
  // tinha o hábito de abrir.
  const [aba, setAba] = useState<"omie" | "oem">("omie");
  const abaAtual: "omie" | "oem" = temOmie ? aba : "oem";

  if (!tid || (!temOmie && !temOem)) return null;

  const doisSistemas = temOmie && temOem;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)}>
        <History className="h-4 w-4 sm:mr-2" />
        <span className="hidden sm:inline">Histórico de envios</span>
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        {/*
          O DialogContent do projeto é `overflow-y-auto` com teto de altura. Com a lista dentro
          dele, o modal inteiro virava um segundo rolável — e, como o Radix leva o foco para o
          primeiro campo ao abrir (o filtro), o navegador rolava até lá e o título sumia para fora
          da tela. Aqui o modal não rola: ele é uma coluna com teto de altura e só a lista rola.
          O foco fica no próprio diálogo (Esc e Tab seguem funcionando) em vez de no filtro.
        */}
        <DialogContent
          className="max-w-2xl max-h-[85dvh] flex flex-col overflow-hidden"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Histórico de envios
            </DialogTitle>
          </DialogHeader>

          {/* Montado só com o modal aberto: assim as consultas nascem junto com ele e o estado do
              filtro volta ao padrão a cada abertura. */}
          {aberto && (
            <Tabs
              value={abaAtual}
              onValueChange={(v) => setAba(v as "omie" | "oem")}
              className="min-h-0 flex-1 flex flex-col gap-3"
            >
              {doisSistemas && (
                <TabsList className="shrink-0 self-start">
                  <TabsTrigger value="omie">Omie</TabsTrigger>
                  <TabsTrigger value="oem">OEM</TabsTrigger>
                </TabsList>
              )}

              {/* `forceMount` ficaria de fora de propósito: sem ele, trocar de aba desmonta a
                  outra e a consulta dela não roda até alguém pedir. */}
              {temOmie && (
                <TabsContent value="omie" className="min-h-0 flex-1 flex flex-col gap-3 mt-0">
                  <OmieHistoricoConteudo clienteId={clienteId} aberto={abaAtual === "omie"} />
                </TabsContent>
              )}
              {temOem && (
                <TabsContent value="oem" className="min-h-0 flex-1 flex flex-col gap-3 mt-0">
                  <OemHistoricoConteudo clienteId={clienteId} aberto={abaAtual === "oem"} />
                </TabsContent>
              )}
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
