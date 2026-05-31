import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SuggestFocoResult {
  success: boolean;
  cache_hit: boolean;
  foco_sugerido: string;
  tokens: { in: number; out: number };
  custo_estimado_usd: number;
}

interface SuggestInput {
  tenantId: string;
  tabKey: string;
  dadosIndicadores: Record<string, any>;
  personaIds: string[];
  tom?: 'executivo' | 'tecnico' | 'direto';
  alertasFactuais?: any;
  filtrosAplicados?: any;
}

export interface SuggestFocoError {
  code: string;
  message?: string;
  retryAfterSeconds?: number;
}

export function useConselhoSuggestFoco() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SuggestFocoResult | null>(null);
  const [error, setError] = useState<SuggestFocoError | null>(null);

  async function suggest(input: SuggestInput) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: edgeError } = await supabase.functions.invoke('conselho-ds-suggest-foco', { body: input });
      if (edgeError) {
        const ctx: any = (edgeError as any).context;
        let parsedBody: any = null;
        try { if (ctx?.body) parsedBody = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body; } catch {}
        setError({ code: parsedBody?.error || 'unknown', message: parsedBody?.message || edgeError.message, retryAfterSeconds: parsedBody?.retryAfterSeconds });
        return null;
      }
      if (data?.error) {
        setError({ code: data.error, message: data.message, retryAfterSeconds: data.retryAfterSeconds });
        return null;
      }
      setResult(data);
      return data as SuggestFocoResult;
    } catch (err: any) {
      setError({ code: 'fetch_error', message: err?.message || 'Erro de conexão' });
      return null;
    } finally { setLoading(false); }
  }

  function reset() { setResult(null); setError(null); }

  return { suggest, loading, result, error, reset };
}
