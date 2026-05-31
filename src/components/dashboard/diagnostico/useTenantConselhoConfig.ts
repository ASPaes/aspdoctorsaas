import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface TenantConselhoConfig {
  tenant_id: string;
  tab_key: string;
  persona_ids: string[];
  foco_mes: string | null;
  tom: 'executivo' | 'tecnico' | 'direto';
  cache_horas: number;
  updated_at: string | null;
  template_existe: boolean;
  template_ativo: boolean;
  template_custo_brl: number;
}

export interface ConselhoPersonaPublica {
  id: string;
  slug: string;
  nome_funcional: string;
  avatar_url: string | null;
  especialidade_tags: string[];
  bio_curta: string;
  referencia_publica_br: string | null;
  referencia_publica_int: string | null;
  familia: string;
  ordem: number;
}

export function useTenantConselhoConfig(tenantId: string | null, tabKey: string) {
  return useQuery({
    queryKey: ['tenant-conselho-config', tenantId, tabKey],
    enabled: !!tenantId && !!tabKey,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_tenant_conselho_config', {
        p_tenant_id: tenantId!,
        p_tab_key: tabKey,
      });
      if (error) throw error;
      return (data?.[0] as TenantConselhoConfig) ?? null;
    },
  });
}

export function useConselhoPersonasAtivas() {
  return useQuery({
    queryKey: ['conselho-personas-ativas'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('get_conselho_personas_ativas');
      if (error) throw error;
      return (data ?? []) as ConselhoPersonaPublica[];
    },
  });
}

export function useUpsertTenantConselhoConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      tenantId: string;
      tabKey: string;
      personaIds: string[];
      focoMes: string | null;
      tom: 'executivo' | 'tecnico' | 'direto';
      cacheHoras?: number;
    }) => {
      const { error } = await (supabase.rpc as any)('upsert_tenant_conselho_config', {
        p_tenant_id: args.tenantId,
        p_tab_key: args.tabKey,
        p_persona_ids: args.personaIds,
        p_foco_mes: args.focoMes,
        p_tom: args.tom,
        p_cache_horas: args.cacheHoras ?? 24,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['tenant-conselho-config', vars.tenantId, vars.tabKey] });
    },
  });
}
