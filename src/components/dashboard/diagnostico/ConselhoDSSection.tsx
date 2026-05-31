import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Settings, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useConselhoDS } from './useConselhoDS';
import {
  useConselhoPersonasAtivas,
  useTenantConselhoConfig,
} from './useTenantConselhoConfig';
import { ConselhoDSConfigDialog } from './ConselhoDSConfigDialog';

interface ConselhoDSSectionProps {
  tenantId: string;
  tabKey: string;
  diagInput: Record<string, any>;
  alertasFactuais: any;
  filtrosAplicados?: any;
  isAdmin: boolean;
}

const TOM_LABEL: Record<string, string> = {
  executivo: 'Executivo',
  tecnico: 'Técnico',
  direto: 'Direto',
};

export function ConselhoDSSection({
  tenantId,
  tabKey,
  diagInput,
  alertasFactuais,
  filtrosAplicados,
  isAdmin,
}: ConselhoDSSectionProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { data: config, isLoading: configLoading } = useTenantConselhoConfig(tenantId, tabKey);
  const { data: personas } = useConselhoPersonasAtivas();
  const { analyze, loading, result, error, reset } = useConselhoDS();

  const personasNomes = useMemo(() => {
    if (!config?.persona_ids?.length || !personas) return [];
    return config.persona_ids
      .map((id) => personas.find((p) => p.id === id)?.nome_funcional)
      .filter((x): x is string => !!x);
  }, [config?.persona_ids, personas]);

  const hasConfig = !!config && (config.persona_ids?.length ?? 0) > 0;
  const custoBrl = config?.template_custo_brl ?? 0.4;

  async function handleAnalyze() {
    setConfirmOpen(false);
    await analyze({
      tenantId,
      tabKey,
      dadosIndicadores: diagInput,
      alertasFactuais,
      filtrosAplicados,
    });
  }

  function renderError() {
    if (!error) return null;
    let msg = error.message || 'Erro ao gerar análise';
    if (error.code === 'ai_not_configured') {
      msg = 'IA não configurada para este tenant. Configure em Configurações > IA.';
    } else if (error.code === 'no_personas_configured') {
      msg = 'Nenhum conselheiro configurado.';
    } else if (error.code === 'rate_limit_exceeded') {
      const mins = error.retryAfterSeconds ? Math.ceil(error.retryAfterSeconds / 60) : null;
      msg = `Limite de análises atingido. ${mins ? `Tente novamente em ~${mins} min.` : 'Tente novamente mais tarde.'}`;
    } else if (error.code === 'forbidden') {
      msg = 'Apenas admin ou head podem solicitar análise.';
    } else if (error.code === 'template_not_active') {
      msg = 'O template desta aba está inativo.';
    }
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">{msg}</div>
        {error.code === 'no_personas_configured' && isAdmin && (
          <Button size="sm" variant="outline" onClick={() => setConfigOpen(true)}>
            Configurar
          </Button>
        )}
      </div>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card/50 p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            Conselho DS · Análise estratégica
          </h3>
        </div>
        {hasConfig && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfigOpen(true)}
            className="h-7 px-2 text-xs"
          >
            <Settings className="h-3.5 w-3.5" />
            {isAdmin ? 'Configurar' : 'Ver config'}
          </Button>
        )}
      </div>

      {/* Estado: sem config */}
      {!configLoading && !hasConfig && !result && !loading && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Configure seus {3} conselheiros para receber análise estratégica via IA.
          </p>
          <Button onClick={() => setConfigOpen(true)} size="sm" disabled={!isAdmin}>
            <Settings className="h-4 w-4" />
            {isAdmin ? 'Configurar Conselheiros' : 'Somente admin pode configurar'}
          </Button>
        </div>
      )}

      {/* Estado: com config, sem resultado, não loading */}
      {hasConfig && !result && !loading && !error && (
        <div className="space-y-3">
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Conselheiros: </span>
              <span className="text-foreground font-medium">
                {personasNomes.join(' · ') || '—'}
              </span>
            </div>
            {config?.foco_mes && (
              <div>
                <span className="text-muted-foreground">Foco do mês: </span>
                <span className="text-foreground">"{config.foco_mes}"</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Tom: </span>
              <span className="text-foreground">{TOM_LABEL[config?.tom ?? 'executivo']}</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
            Análise consumirá ~R$ {custoBrl.toFixed(2)} da sua IA configurada (cache {config?.cache_horas ?? 24}h).
          </p>
          <Button size="sm" onClick={() => setConfirmOpen(true)}>
            <Sparkles className="h-4 w-4" />
            Pedir Análise
          </Button>
        </div>
      )}

      {/* Estado: loading */}
      {loading && (
        <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Conselho DS está analisando…
        </div>
      )}

      {/* Estado: result */}
      {result && (
        <div className="space-y-4">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{result.output_markdown}</ReactMarkdown>
          </div>
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-border text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                Tokens: {result.tokens.in} in · {result.tokens.out} out
              </span>
              <span>Custo: ${result.custo_estimado_usd.toFixed(4)}</span>
              {result.cache_hit && (
                <span className="inline-flex items-center rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                  cache hit
                </span>
              )}
              {result.solicitado_em && (
                <span>{new Date(result.solicitado_em).toLocaleString('pt-BR')}</span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={reset}>
              <RefreshCw className="h-3.5 w-3.5" />
              Nova análise
            </Button>
          </div>
        </div>
      )}

      {/* Erro */}
      {error && renderError()}

      {/* Dialogs */}
      <ConselhoDSConfigDialog
        tenantId={tenantId}
        tabKey={tabKey}
        isAdmin={isAdmin}
        open={configOpen}
        onOpenChange={setConfigOpen}
      />
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Solicitar análise do Conselho DS?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta análise usará sua IA configurada. Custo estimado: ~R$ {custoBrl.toFixed(2)}.
              Resultado fica em cache por {config?.cache_horas ?? 24}h.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleAnalyze}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
