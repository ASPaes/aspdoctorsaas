import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Info, FileText, ChevronDown, ChevronUp, Target, Wand2 } from 'lucide-react';
import { ConselhoDSPromptViewer } from './ConselhoDSPromptViewer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useConselhoPersonasAtivas,
  useTenantConselhoConfig,
  useUpsertTenantConselhoConfig,
  type ConselhoPersonaPublica,
} from './useTenantConselhoConfig';
import { useConselhoAbaTemplate } from './useConselhoAbaTemplate';
import { useConselhoSuggestFoco } from './useConselhoSuggestFoco';
import { suggestPersonasForTab } from '@/lib/conselho-persona-suggestion';
import { toast } from 'sonner';

interface ConselhoDSConfigDialogProps {
  tenantId: string;
  tabKey: string;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diagInput?: Record<string, any> | null;
  alertasFactuais?: any;
  filtrosAplicados?: any;
}

const TOM_OPTIONS: Array<{ value: 'executivo' | 'tecnico' | 'direto'; label: string }> = [
  { value: 'executivo', label: 'Executivo' },
  { value: 'tecnico', label: 'Técnico' },
  { value: 'direto', label: 'Direto' },
];

const MAX_PERSONAS = 4;

export function ConselhoDSConfigDialog({
  tenantId,
  tabKey,
  isAdmin,
  open,
  onOpenChange,
  diagInput,
  alertasFactuais,
  filtrosAplicados,
}: ConselhoDSConfigDialogProps) {
  const { data: personas, isLoading: personasLoading } = useConselhoPersonasAtivas();
  const { data: config, isLoading: configLoading } = useTenantConselhoConfig(tenantId, tabKey);
  const upsert = useUpsertTenantConselhoConfig();
  const { data: template } = useConselhoAbaTemplate(tenantId, tabKey, open);
  const { suggest: suggestFoco, loading: focoLoading, error: focoError } = useConselhoSuggestFoco();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focoMes, setFocoMes] = useState('');
  const [tom, setTom] = useState<'executivo' | 'tecnico' | 'direto'>('executivo');
  const [promptViewerOpen, setPromptViewerOpen] = useState(false);
  const [disclaimerCollapsed, setDisclaimerCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('conselho-ds-disclaimer-collapsed') === 'true';
  });

  function toggleDisclaimer() {
    const next = !disclaimerCollapsed;
    setDisclaimerCollapsed(next);
    try { localStorage.setItem('conselho-ds-disclaimer-collapsed', String(next)); } catch {}
  }

  useEffect(() => {
    if (open) {
      setSelectedIds(config?.persona_ids ?? []);
      setFocoMes(config?.foco_mes ?? '');
      setTom(config?.tom ?? 'executivo');
    }
  }, [open, config]);

  const grupos = useMemo(() => {
    const map = new Map<string, ConselhoPersonaPublica[]>();
    (personas ?? []).forEach((p) => {
      const arr = map.get(p.familia) ?? [];
      arr.push(p);
      map.set(p.familia, arr);
    });
    map.forEach((arr) => arr.sort((a, b) => a.ordem - b.ordem));
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [personas]);

  function togglePersona(id: string) {
    if (!isAdmin) return;
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_PERSONAS) return prev;
      return [...prev, id];
    });
  }

  function handleSugerirPersonas() {
    if (!isAdmin) return;
    const defaults = template?.personas_sugeridas_default ?? [];
    const slugs = suggestPersonasForTab(diagInput ?? null, tabKey, defaults);
    if (!personas || slugs.length === 0) {
      toast.error('Não foi possível sugerir conselheiros agora.');
      return;
    }
    const ids = slugs.map(s => personas.find(p => p.slug === s)?.id).filter((x): x is string => !!x);
    setSelectedIds(ids.slice(0, MAX_PERSONAS));
    toast.success(`${ids.length} conselheiros sugeridos pelo Conselho DS`, {
      description: 'Você pode trocar antes de continuar.',
    });
  }

  async function handleSugerirFoco() {
    if (!isAdmin) return;
    if (selectedIds.length === 0) {
      toast.error('Selecione ao menos 1 conselheiro antes de pedir sugestão de foco.');
      return;
    }
    if (!diagInput) {
      toast.error('Sem dados suficientes para gerar sugestão.');
      return;
    }
    const r = await suggestFoco({
      tenantId, tabKey,
      dadosIndicadores: diagInput,
      personaIds: selectedIds,
      tom, alertasFactuais, filtrosAplicados,
    });
    if (r?.foco_sugerido) {
      setFocoMes(r.foco_sugerido);
      toast.success('Foco sugerido pelo Conselho DS', {
        description: r.cache_hit ? 'Resultado de cache (sem custo).' : 'Você pode editar antes de salvar.',
      });
    }
  }

  async function handleSave() {
    if (!isAdmin) return;
    if (selectedIds.length === 0) {
      toast.error('Selecione pelo menos 1 conselheiro');
      return;
    }
    try {
      await upsert.mutateAsync({
        tenantId,
        tabKey,
        personaIds: selectedIds,
        focoMes: focoMes.trim() || null,
        tom,
      });
      toast.success('Configuração salva');
      onOpenChange(false);
    } catch (err: any) {
      toast.error('Erro ao salvar', { description: err?.message });
    }
  }

  const loading = personasLoading || configLoading;
  const atMax = selectedIds.length >= MAX_PERSONAS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Configurar Conselheiros</DialogTitle>
          <DialogDescription>
            {isAdmin
              ? `Selecione até ${MAX_PERSONAS} personas, defina o foco do mês e o tom da análise.`
              : 'Apenas administradores podem editar — visualização somente leitura.'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Disclaimer */}
            <div className="rounded-md border border-border bg-muted/30 overflow-hidden">
              <button
                type="button"
                onClick={toggleDisclaimer}
                className="w-full flex items-center gap-2 p-3 text-left hover:bg-muted/60 transition-colors"
              >
                <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium text-foreground flex-1">
                  Sobre o Conselho DS
                </span>
                {disclaimerCollapsed ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {!disclaimerCollapsed && (
                <div className="px-3 pb-3 space-y-2 border-t border-border">
                  <p className="text-xs text-muted-foreground leading-relaxed pt-2">
                    As análises são geradas por inteligência artificial, com base em um prompt curado para empresas SaaS B2B. As personas são caracterizações construídas a partir de referências reconhecidas no mercado — os nomes citados representam apenas a linha de pensamento que inspira cada cadeira e não constituem endosso, parceria ou consultoria direta dessas pessoas.
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    O DoctorSaaS não se responsabiliza pelas recomendações geradas — use como apoio à decisão, não como única fonte. Toda análise consome créditos da IA configurada no seu tenant.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPromptViewerOpen(true)}
                    className="h-7 text-xs"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    Ver prompt completo
                  </Button>
                </div>
              )}
            </div>

            {/* Objetivo da análise */}
            {template?.contexto_objetivo && (
              <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-sm font-medium text-foreground">Objetivo da análise</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {template.contexto_objetivo}
                </p>
              </div>
            )}

            {/* Personas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm">Conselheiros</Label>
                <div className="flex items-center gap-2">
                  {isAdmin && diagInput && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleSugerirPersonas}
                      className="h-7 px-2 text-xs text-primary hover:text-primary"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Sugestão do Conselho DS
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {selectedIds.length}/{MAX_PERSONAS} selecionados
                  </span>
                </div>
              </div>
              <div className="space-y-4 border border-border rounded-md p-3 max-h-72 overflow-y-auto">
                {grupos.map(([familia, lista]) => (
                  <div key={familia} className="space-y-2">
                    <h4 className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                      {familia}
                    </h4>
                    <div className="space-y-1.5">
                      {lista.map((p) => {
                        const checked = selectedIds.includes(p.id);
                        const disabled = !isAdmin || (!checked && atMax);
                        return (
                          <label
                            key={p.id}
                            className={`flex items-start gap-2 p-2 rounded border border-transparent hover:border-border cursor-pointer ${
                              disabled && !checked ? 'opacity-50 cursor-not-allowed' : ''
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={disabled}
                              onCheckedChange={() => togglePersona(p.id)}
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium text-foreground">
                                {p.nome_funcional}
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2">
                                {p.bio_curta}
                              </p>
                              {(p.referencia_publica_br || p.referencia_publica_int) && (
                                <p className="text-[11px] italic text-muted-foreground mt-1 leading-relaxed">
                                  Linha de pensamento baseada em referências como{' '}
                                  <span className="text-foreground/90 font-medium not-italic">
                                    {[p.referencia_publica_br, p.referencia_publica_int].filter(Boolean).join(' e ')}
                                  </span>.
                                </p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Foco do mês */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="foco-mes" className="text-sm">Foco do mês</Label>
                {isAdmin && diagInput && selectedIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSugerirFoco}
                    disabled={focoLoading}
                    className="h-7 px-2 text-xs text-primary hover:text-primary"
                  >
                    {focoLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    {focoLoading ? 'Conselho analisando...' : 'Sugerir foco'}
                  </Button>
                )}
              </div>
              <Textarea
                id="foco-mes"
                value={focoMes}
                onChange={(e) => setFocoMes(e.target.value)}
                placeholder="Descreva o foco do mês ou clique em 'Sugerir foco' pra que o Conselho DS gere uma sugestão baseada nos seus indicadores"
                rows={6}
                disabled={!isAdmin || focoLoading}
              />
              {isAdmin && diagInput && !focoMes && selectedIds.length > 0 && !focoLoading && (
                <p className="text-[11px] text-muted-foreground leading-relaxed flex items-start gap-1.5">
                  <Sparkles className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  Clique em "Sugerir foco" — o Conselho DS vai analisar seus indicadores e gerar um texto contextualizado (~R$ 0,15 de custo da IA, cache 24h).
                </p>
              )}
              {isAdmin && selectedIds.length === 0 && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Selecione ao menos 1 conselheiro acima para liberar a sugestão automática.
                </p>
              )}
              {focoError && (
                <p className="text-[11px] text-destructive leading-relaxed">
                  {focoError.code === 'ai_not_configured' && 'IA não configurada — vá em Configurações > IA.'}
                  {focoError.code === 'rate_limit_exceeded' && 'Muitas tentativas. Aguarde alguns minutos.'}
                  {focoError.code === 'forbidden' && 'Sem permissão pra sugerir foco.'}
                  {!['ai_not_configured', 'rate_limit_exceeded', 'forbidden'].includes(focoError.code) && (focoError.message || 'Erro ao gerar sugestão.')}
                </p>
              )}
            </div>

            {/* Tom */}
            <div className="space-y-2">
              <Label className="text-sm">Tom</Label>
              <Select value={tom} onValueChange={(v) => setTom(v as any)} disabled={!isAdmin}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOM_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {isAdmin && (
            <Button onClick={handleSave} disabled={upsert.isPending || loading}>
              {upsert.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      <ConselhoDSPromptViewer
        tenantId={tenantId}
        tabKey={tabKey}
        open={promptViewerOpen}
        onOpenChange={setPromptViewerOpen}
      />
    </Dialog>
  );
}
