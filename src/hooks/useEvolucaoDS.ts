import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * Evolução DS: as releases do DoctorSaaS publicadas no DoctorDev, lidas pela
 * function `releases-feed` de lá (pública, sem login, como a `latest-release`).
 *
 * "Visto" é por pessoa, em `profiles.releases_visto_em`: entrar na aba conta
 * como visto, não é preciso abrir cada item.
 */
const FEED_URL =
  (import.meta.env.VITE_EVOLUCAO_FEED_URL as string | undefined) ||
  "https://luucsmybijcaejhfiwwr.supabase.co/functions/v1/releases-feed";

/** Depois disso sem entrar na aba, o item para de piscar e fica só aceso. */
const PISCA_POR_MS = 3 * 24 * 60 * 60 * 1000;

export type TipoEvolucao = "nova_funcionalidade" | "melhoria" | "correcao";

export interface ItemEvolucao {
  id: string;
  titulo: string;
  resumo: string;
  tipo: TipoEvolucao;
  modulo: string | null;
  publicado_em: string;
  pedido_pela_sua_empresa: boolean;
}

/** pisca = novidade/melhoria não vista há menos de 3 dias; numero = só correção
 *  não vista, ou novidade mais velha que isso; em_dia = nada não visto. */
export type EstadoEvolucao = "pisca" | "numero" | "em_dia";

export function useEvolucaoFeed() {
  const { effectiveTenantId } = useTenantFilter();
  return useQuery({
    queryKey: ["evolucao-ds-feed", effectiveTenantId],
    staleTime: 4 * 60 * 1000,
    // Publicou no DoctorDev, começa a piscar sem F5.
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<ItemEvolucao[]> => {
      const url = effectiveTenantId
        ? `${FEED_URL}?tenant=${encodeURIComponent(effectiveTenantId)}`
        : FEED_URL;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`releases-feed ${res.status}`);
      const data = await res.json();
      return (data?.itens as ItemEvolucao[] | undefined) ?? [];
    },
  });
}

export function useEvolucaoVistoEm() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["releases-visto-em", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("profiles")
        .select("releases_visto_em")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data?.releases_visto_em ?? null;
    },
  });
}

/** Quem nunca entrou na aba começa com as duas últimas semanas como novas, e não
 *  com as centenas de releases desde maio/2026. */
const JANELA_PRIMEIRA_VEZ_MS = 14 * 24 * 60 * 60 * 1000;

export function naoVisto(item: ItemEvolucao, vistoEm: string | null, agora = Date.now()) {
  const base = vistoEm ? new Date(vistoEm).getTime() : agora - JANELA_PRIMEIRA_VEZ_MS;
  return new Date(item.publicado_em).getTime() > base;
}

export function calcularEstado(
  itens: ItemEvolucao[],
  vistoEm: string | null,
  agora = Date.now(),
): { estado: EstadoEvolucao; naoVistos: number } {
  const pendentes = itens.filter((i) => naoVisto(i, vistoEm, agora));
  if (pendentes.length === 0) return { estado: "em_dia", naoVistos: 0 };
  const pisca = pendentes.some(
    (i) => i.tipo !== "correcao" && agora - new Date(i.publicado_em).getTime() < PISCA_POR_MS,
  );
  return { estado: pisca ? "pisca" : "numero", naoVistos: pendentes.length };
}

/** Estado do item do menu. */
export function useEvolucaoDS() {
  const feed = useEvolucaoFeed();
  const visto = useEvolucaoVistoEm();
  const pronto = feed.isSuccess && visto.isSuccess;
  const { estado, naoVistos } = pronto
    ? calcularEstado(feed.data ?? [], visto.data ?? null)
    : { estado: "em_dia" as const, naoVistos: 0 };
  return { estado, naoVistos, pronto };
}

export function useMarcarEvolucaoVista() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return async () => {
    if (!user?.id) return;
    const agora = new Date().toISOString();
    await supabase.from("profiles").update({ releases_visto_em: agora }).eq("user_id", user.id);
    qc.setQueryData(["releases-visto-em", user.id], agora);
  };
}
