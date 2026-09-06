import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Plug } from "lucide-react";
import { useOmieContaDoCliente } from "@/hooks/useOmieContaDoCliente";
import IntegracaoOmieSection from "./IntegracaoOmieSection";
import IntegracaoOemSection, { useOemDoCliente } from "./IntegracaoOemSection";
import HistoricoEnviosButton from "./HistoricoEnviosDialog";

/**
 * Card único "Integração" da ficha do cliente.
 *
 * Eram três cards empilhados — "Integração Omie", "Licenças no OEM" e "Histórico de envios" —,
 * três títulos e três molduras para o mesmo assunto. Agora é um card com uma seção por sistema e
 * o histórico atrás de um botão, que é onde ele pertence: é consulta, não é estado do cliente.
 *
 * O card só existe quando alguma das seções tem o que mostrar. Por isso a visibilidade é decidida
 * aqui, com os mesmos hooks que as seções usam (react-query: as consultas não dobram) — desenhar a
 * moldura e descobrir depois que as duas seções são nulas deixaria um card só com título na tela.
 */
export default function IntegracaoCard({ clienteId }: { clienteId: string }) {
  const contaOmieQuery = useOmieContaDoCliente(clienteId);
  const omieAtivo = contaOmieQuery.data?.ativo === true;
  const oem = useOemDoCliente(clienteId);

  if (!omieAtivo && !oem.visivel) return null;

  const duasColunas = omieAtivo && oem.visivel;

  return (
    <Card>
      {/* O p-6 do CardHeader é padrão de card com título e descrição; aqui só há uma faixa com o
          título e o botão, e sobrava um vão morto acima do "Integração". */}
      <CardHeader className="pt-3 pb-3">
        {/* Três colunas para o título ficar no centro DO CARD, e não no centro do que sobra do
            botão. A coluna da esquerda existe vazia só para isso. */}
        <div className="w-full grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <span />
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Integração
          </CardTitle>
          <div className="justify-self-end">
            <HistoricoEnviosButton clienteId={clienteId} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Uma faixa só, Omie à esquerda e OEM à direita: empilhados, o espaço à direita do
            contrato ficava vazio e o card virava uma coluna alta de nada. Duas colunas só quando
            as duas seções existem — com uma só, ela ocupa a largura inteira em vez de deixar
            metade do card em branco. No celular volta a empilhar. */}
        <div
          className={
            "border-t " +
            (duasColunas
              ? "grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x"
              : "")
          }
        >
          <IntegracaoOmieSection clienteId={clienteId} />
          <IntegracaoOemSection clienteId={clienteId} />
        </div>
      </CardContent>
    </Card>
  );
}
