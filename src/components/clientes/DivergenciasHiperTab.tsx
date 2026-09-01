import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Skeleton } from "@/components/ui/skeleton";
import HiperDivergenciasTab from "@/components/configuracoes/hiper/HiperDivergenciasTab";
import { useHiperRecon, useMotivosCancelamento } from "@/components/configuracoes/hiper/useHiperDados";

/**
 * A aba Divergências do Hiper, dentro de Clientes.
 *
 * É casca: a tela é a MESMA de Integrações › Hiper, importada sem cópia. Duas
 * telas para a mesma decisão divergiriam na primeira correção de bug — e esta
 * aqui grava mensalidade e custo, onde divergir sai caro.
 *
 * Ela existe por um motivo só: buscar os dados. Como o Radix desmonta o
 * conteúdo da aba inativa, as ~1.000 linhas de `reconciliacao_hiper` (cada uma
 * com um `detalhe` jsonb dentro) só saem do banco quando alguém abre a aba.
 * Chamar os hooks lá em cima, na página, faria a lista de clientes pagar essa
 * consulta em toda abertura.
 */
export default function DivergenciasHiperTab() {
  const { profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: recon = [], isPending } = useHiperRecon(tid, true);
  const { data: motivos = [] } = useMotivosCancelamento(tid, true);

  // Head lê tudo, mas o RLS só deixa admin gravar marcação, decisão de filial e
  // rebusca. Ver HiperDivergenciasTab.podeAcoesAdmin.
  const podeAcoesAdmin = profile?.is_super_admin === true || profile?.role === "admin";

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <HiperDivergenciasTab tid={tid} recon={recon} motivos={motivos} podeAcoesAdmin={podeAcoesAdmin} />;
}
