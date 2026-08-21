import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { usePermissions } from "@/hooks/usePermissions";
import { buildIntegracoesGroups, type IntegracaoId, type IntegracaoStatus } from "@/lib/integracoes";
import { IntegracoesHubView } from "./IntegracoesHubView";

type Mapa = Partial<Record<IntegracaoId, IntegracaoStatus>>;

/**
 * Tabela que talvez ainda não exista no banco não pode derrubar a página
 * inteira — a tela do Hiper já trata assim (`PGRST205`/`42P01`).
 */
function tabelaAusente(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "PGRST205" || code === "42P01";
}

async function carregarStatus(tid: string): Promise<Mapa> {
  const [omie, hiper, oem, tenant] = await Promise.all([
    supabase.from("omie_integration").select("ativo").eq("tenant_id", tid),
    (supabase.from("hiper_integration" as any) as any).select("ativo").eq("tenant_id", tid),
    (supabase.from("oem_integration_status" as any) as any).select("ativo").eq("tenant_id", tid),
    (supabase.from("tenants" as any) as any)
      .select("acessofast_enabled")
      .eq("id", tid)
      .maybeSingle(),
  ]);

  const contarAtivas = (res: { data: unknown; error: unknown }): number => {
    if (res.error) {
      if (tabelaAusente(res.error)) return 0;
      throw res.error;
    }
    return ((res.data ?? []) as { ativo?: boolean }[]).filter((r) => r.ativo).length;
  };

  const nOmie = contarAtivas(omie as any);
  const nHiper = contarAtivas(hiper);
  const nOem = contarAtivas(oem);

  const mapa: Mapa = {
    // Só o Omie é multi-conta; nos outros o número não diria nada ao usuário.
    omie: nOmie
      ? { kind: "conectado", detalhe: nOmie > 1 ? `${nOmie} contas` : undefined }
      : { kind: "desconectado" },
    hiper: nHiper ? { kind: "conectado" } : { kind: "desconectado" },
    oem: nOem ? { kind: "conectado", detalhe: nOem > 1 ? `${nOem} contas` : undefined } : { kind: "desconectado" },
  };

  if (tenant.error && !tabelaAusente(tenant.error)) throw tenant.error;
  mapa.acessofast = (tenant.data as { acessofast_enabled?: boolean } | null)?.acessofast_enabled
    ? { kind: "ativo" }
    : { kind: "desconectado" };

  return mapa;
}

/**
 * Página "Integrações": o índice do que o DoctorSaaS conversa com fora, agrupado
 * por área de negócio e com o status medido antes de o usuário entrar na tela.
 */
export default function IntegracoesHubTab({
  onSelectSection,
}: {
  onSelectSection: (section: string) => void;
}) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { can, rbacEnabled } = usePermissions();

  const { data, isLoading, error } = useQuery<Mapa>({
    queryKey: ["integracoes-status", tid],
    enabled: !!tid,
    staleTime: 60 * 1000,
    queryFn: () => carregarStatus(tid as string),
  });

  // Sem RBAC ligado, quem chegou até as Configurações já é admin.
  const canView = (resource: string) => (rbacEnabled ? can(resource, "view") : true);

  // Enquanto não sabemos, o selo diz "Verificando…" — dizer "não conectado"
  // durante o carregamento faria a tela mentir por um instante.
  const carregando: Mapa = { omie: { kind: "carregando" }, hiper: { kind: "carregando" }, oem: { kind: "carregando" }, acessofast: { kind: "carregando" } };
  const grupos = buildIntegracoesGroups(isLoading || !tid ? carregando : (data ?? {}), canView);

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-sm text-destructive">
          Não foi possível ler o status das integrações: {(error as Error).message}
        </p>
      )}
      <IntegracoesHubView grupos={grupos} onSelect={onSelectSection} />
    </div>
  );
}
