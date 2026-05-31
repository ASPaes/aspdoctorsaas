import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ConselhoDSResult {
  success: boolean;
  cache_hit: boolean;
  output_markdown: string;
  tokens: { in: number; out: number };
  custo_estimado_usd: number;
  provider?: string;
  model?: string;
  analise_id?: string;
  solicitado_em?: string;
  expires_at?: string;
}

interface AnalyzeInput {
  tenantId: string;
  tabKey: string;
  dadosIndicadores: Record<string, any>;
  alertasFactuais?: any;
  filtrosAplicados?: any;
  benchmarksMercado?: any;
}

export interface ConselhoDSError {
  code: string;
  message?: string;
  retryAfterSeconds?: number;
}

export function useConselhoDS() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConselhoDSResult | null>(null);
  const [error, setError] = useState<ConselhoDSError | null>(null);

  async function analyze(input: AnalyzeInput) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: edgeError } = await supabase.functions.invoke('conselho-ds-analyze', {
        body: input,
      });

      if (edgeError) {
        const ctx: any = (edgeError as any).context;
        let parsedBody: any = null;
        try {
          if (ctx?.body) parsedBody = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
        } catch { /* ignore */ }
        const code = parsedBody?.error || 'unknown';
        const message = parsedBody?.message || edgeError.message;
        const retryAfterSeconds = parsedBody?.retryAfterSeconds;
        setError({ code, message, retryAfterSeconds });
        return null;
      }

      if (data?.error) {
        setError({ code: data.error, message: data.message, retryAfterSeconds: data.retryAfterSeconds });
        return null;
      }

      setResult(data);
      return data as ConselhoDSResult;
    } catch (err: any) {
      setError({ code: 'fetch_error', message: err?.message || 'Erro de conexão' });
      return null;
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null);
    setError(null);
  }

  return { analyze, loading, result, error, reset };
}
