import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenantFilter } from '@/contexts/TenantFilterContext';
import { useCallback } from 'react';

interface SenderInfo {
  nome: string;
  cargo: string | null;
}

/**
 * Shared cache for resolving user_id → { nome, cargo } via profiles + funcionarios.
 * staleTime 5min, gcTime 30min — avoids N+1 queries across messages & assignment history.
 */
export const useSenderMap = () => {
  const { effectiveTenantId: tid } = useTenantFilter();

  const { data: senderMap = {} } = useQuery({
    queryKey: ['whatsapp', 'sender-map', tid],
    queryFn: async (): Promise<Record<string, SenderInfo>> => {
      // 1) Fetch all profiles with a funcionario link for this tenant
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, funcionario_id')
        .not('funcionario_id', 'is', null);

      if (!profiles || profiles.length === 0) return {};

      const funcIds = profiles
        .filter((p: any) => p.funcionario_id)
        .map((p: any) => p.funcionario_id);

      if (funcIds.length === 0) return {};

      // 2) Fetch funcionarios in one query
      const { data: funcs } = await supabase
        .from('funcionarios')
        .select('id, nome, cargo')
        .in('id', funcIds);

      if (!funcs) return {};

      // 3) Build the map
      const funcMap: Record<number, SenderInfo> = {};
      funcs.forEach((f: any) => {
        funcMap[f.id] = { nome: f.nome, cargo: f.cargo };
      });

      const result: Record<string, SenderInfo> = {};
      (profiles as any[]).forEach((p) => {
        if (p.funcionario_id && funcMap[p.funcionario_id]) {
          result[p.user_id] = funcMap[p.funcionario_id];
        }
      });

      return result;
    },
    staleTime: 5 * 60 * 1000,   // 5 min
    gcTime: 30 * 60 * 1000,     // 30 min
  });

  const getSenderLabel = useCallback(
    (userId?: string | null): { name: string | null; role: string | null } => {
      if (!userId || !senderMap[userId]) {
        return { name: null, role: null };
      }
      return { name: senderMap[userId].nome, role: senderMap[userId].cargo };
    },
    [senderMap]
  );

  return { senderMap, getSenderLabel };
};
