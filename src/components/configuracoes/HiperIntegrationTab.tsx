import { useState } from "react";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import HiperConexaoTab from "./hiper/HiperConexaoTab";
import HiperModulosTab from "./hiper/HiperModulosTab";
import HiperVisaoGeralTab from "./hiper/HiperVisaoGeralTab";
import HiperCustosTab from "./hiper/HiperCustosTab";
import HiperSincronizacaoTab from "./hiper/HiperSincronizacaoTab";
import HiperDivergenciasTab from "./hiper/HiperDivergenciasTab";
import {
  useCatalogoDS, useHiperEspelho, useHiperFiliais, useHiperIntegracao,
  useHiperModulos, useHiperRecon, useHiperRuns, useHiperVinculos,
} from "./hiper/useHiperDados";

/**
 * Integração Hiper — a mesma anatomia do OEM com uma diferença que atravessa
 * tudo: o Hiper é SOMENTE LEITURA. Nada daqui é enviado ao portal, e por isso
 * onde o OEM tem fila de escrita, aqui há histórico de leitura.
 *
 * Spec: docs/superpowers/specs/2026-08-30-integracao-hiper-design.md
 */
export default function HiperIntegrationTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const [aba, setAba] = useState("conexao");

  const { data: integracao, isLoading, refetch } = useHiperIntegracao(tid);
  const conectado = !!integracao?.ativo;

  const { data: espelho = [] } = useHiperEspelho(tid, conectado);
  const { data: modulos = [] } = useHiperModulos(tid, conectado);
  const { data: filiais = [] } = useHiperFiliais(tid, conectado);
  const { data: recon = [] } = useHiperRecon(tid, conectado);
  const { data: vinculos = [] } = useHiperVinculos(tid, conectado);
  const { data: runs = [] } = useHiperRuns(tid, conectado);
  const { data: catalogo } = useCatalogoDS(tid, conectado);

  const pendentes = recon.filter((r) => r.status_usuario === "pendente" && r.divergencias.length > 0).length;
  const semFornecedor = !integracao?.fornecedor_id;
  const travada = conectado ? undefined : "Conecte a integração na aba Conexão primeiro";

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <Tabs value={aba} onValueChange={setAba} className="space-y-4">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="conexao">Conexão</TabsTrigger>
        <TabsTrigger value="modulos" disabled={!conectado} title={travada}>Módulos</TabsTrigger>
        <TabsTrigger value="visao" disabled={!conectado} title={travada}>Visão geral</TabsTrigger>
        <TabsTrigger value="custos" disabled={!conectado} title={travada}>Custos</TabsTrigger>
        <TabsTrigger value="sincronizacao" disabled={!conectado} title={travada}>Sincronização</TabsTrigger>
        <TabsTrigger value="divergencias" disabled={!conectado} title={travada} className="gap-1.5">
          Divergências
          {pendentes > 0 && (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">{pendentes}</Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="conexao">
        <HiperConexaoTab tid={tid} integracao={integracao ?? null} refetch={refetch} />
      </TabsContent>

      <TabsContent value="modulos">
        <HiperModulosTab tid={tid} espelho={espelho} modulos={modulos}
          vinculos={vinculos} catalogo={catalogo} temRecon={recon.length > 0} />
      </TabsContent>

      <TabsContent value="visao">
        <HiperVisaoGeralTab recon={recon} />
      </TabsContent>

      <TabsContent value="custos">
        <HiperCustosTab recon={recon} />
      </TabsContent>

      <TabsContent value="sincronizacao">
        <HiperSincronizacaoTab tid={tid} runs={runs} semFornecedor={semFornecedor} />
      </TabsContent>

      <TabsContent value="divergencias">
        <HiperDivergenciasTab tid={tid} recon={recon} />
      </TabsContent>
    </Tabs>
  );
}
