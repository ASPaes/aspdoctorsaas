/**
 * Leituras da integração Hiper. Um lugar só, porque quatro abas olham para o
 * mesmo espelho e para a mesma reconciliação — buscar em cada uma multiplicaria
 * a mesma consulta por quatro.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";

const t = (nome: string) => (supabase.from(nome as any) as any);

export interface Integracao {
  ativo: boolean | null;
  ultimo_status: string | null;
  ultimo_teste_at: string | null;
  fornecedor_id: number | null;
  portal_tenant_id: string | null;
  portal_tenant_nome: string | null;
  ultimo_pull_at: string | null;
  base_url: string | null;
}

export interface LinhaRecon {
  id: string;
  id_portal: string | null;
  cnpj_norm: string | null;
  razao_social_hiper: string | null;
  situacao_hiper: string | null;
  plano_hiper: string | null;
  responsavel_tipo: string | null;
  mrr_hiper: number | null;
  custo_hiper: number | null;
  cancelada_em: string | null;
  ds_cliente_id: string | null;
  ds_cliente_produto_id: string | null;
  razao_social_ds: string | null;
  cnpj_ds: string | null;
  modelo_contrato_id_ds: number | null;
  modelo_contrato_ds: string | null;
  mensalidade_ds: number | null;
  custo_ds: number | null;
  cancelado_ds: boolean | null;
  qtd_candidatos_ds: number;
  recorrencia_ds: string | null;
  codigo_sequencial_ds: number | null;
  estado_match: string;
  divergencias: string[];
  detalhe: Record<string, any>;
  margem: number | null;
  status_usuario: string;
}

export function useHiperIntegracao(tid: string | null) {
  return useQuery({
    queryKey: ["hiper_integration", tid],
    enabled: !!tid,
    retry: false,
    queryFn: async (): Promise<Integracao | null> => {
      const { data, error } = await t("hiper_integration")
        .select("ativo, ultimo_status, ultimo_teste_at, fornecedor_id, portal_tenant_id, portal_tenant_nome, ultimo_pull_at, base_url")
        .eq("tenant_id", tid as string)
        .maybeSingle();
      if (error) {
        // Backend ausente não é erro de tela: trata como "não conectado".
        const code = (error as any)?.code;
        if (code === "PGRST205" || code === "42P01") return null;
        throw error;
      }
      return data;
    },
  });
}

/** A carteira do portal, como ela está no espelho. */
export function useHiperEspelho(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_espelho", tid],
    enabled: !!tid && ligado,
    queryFn: async () =>
      // Passa de 1000 linhas (994 contas na ASP, e cresce): sem paginar o
      // PostgREST corta em silêncio e a Visão geral mentiria.
      fetchAllRows<any>(() =>
        t("hiper_espelho_cadastro")
          .select("id_portal, cnpj_norm, razao_social, situacao, responsavel_tipo, plano, mrr, a_pagar, bruto_mes, custo_mes, qt_modulos, usuarios_contratados, usuarios_ativos_30d, atraso_dias, total_aberto, saude, last_scraped_at")
          .eq("tenant_id", tid as string),
      ),
  });
}

export function useHiperModulos(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_modulos", tid],
    enabled: !!tid && ligado,
    queryFn: async () =>
      fetchAllRows<any>(() =>
        t("hiper_espelho_modulo")
          .select("id_portal, app_nome, custo, comprado_por, ativo")
          .eq("tenant_id", tid as string),
      ),
  });
}

export function useHiperFiliais(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_filiais", tid],
    enabled: !!tid && ligado,
    queryFn: async () =>
      fetchAllRows<any>(() =>
        t("hiper_espelho_filial")
          .select("id_portal, cnpj_norm, nome, cidade, uf, ativo")
          .eq("tenant_id", tid as string),
      ),
  });
}

export function useHiperRecon(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_recon", tid],
    enabled: !!tid && ligado,
    queryFn: async () =>
      fetchAllRows<LinhaRecon>(() =>
        t("reconciliacao_hiper")
          .select("*")
          .eq("tenant_id", tid as string),
      ),
  });
}

export function useHiperVinculos(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_vinculos", tid],
    enabled: !!tid && ligado,
    queryFn: async () => {
      const { data, error } = await t("hiper_catalogo_vinculo")
        .select("id, tipo, chave, produto_id, modulo_id, modelo_contrato_id")
        .eq("tenant_id", tid as string);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/** Módulos que o plano implica e o portal não lista (o Caixa vem do contador). */
export function useHiperPlanoModulos(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_plano_modulos", tid],
    enabled: !!tid && ligado,
    queryFn: async () => {
      const { data, error } = await t("hiper_plano_modulo")
        .select("id, plano, modulo_id, produto_id, quantidade_de, quantidade_fixa")
        .eq("tenant_id", tid as string);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

export function useHiperRuns(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_runs", tid],
    enabled: !!tid && ligado,
    queryFn: async () => {
      const { data, error } = await t("hiper_sync_run")
        .select("*")
        .eq("tenant_id", tid as string)
        .order("iniciado_em", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
}

/** Catálogo do DoctorSaaS para os seletores da aba Módulos. */
export function useCatalogoDS(tid: string | null, ligado: boolean) {
  return useQuery({
    queryKey: ["hiper_catalogo_ds", tid],
    enabled: !!tid && ligado,
    queryFn: async () => {
      const [prod, mod, mc] = await Promise.all([
        supabase.from("produtos").select("id, nome").eq("tenant_id", tid as string).order("nome"),
        t("produto_modulos").select("id, nome, produto_id, vlr_custo").eq("tenant_id", tid as string).eq("ativo", true).order("nome"),
        t("modelos_contrato").select("id, nome").eq("tenant_id", tid as string).order("nome"),
      ]);
      if (prod.error) throw prod.error;
      return {
        produtos: (prod.data ?? []) as { id: number; nome: string }[],
        modulos: ((mod as any).data ?? []) as { id: string; nome: string; produto_id: number; vlr_custo: number | null }[],
        modelos: ((mc as any).data ?? []) as { id: number; nome: string }[],
      };
    },
  });
}
