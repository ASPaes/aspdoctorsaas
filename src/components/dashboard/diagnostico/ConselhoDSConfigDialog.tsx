import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles, Info, FileText, ChevronDown, ChevronUp } from 'lucide-react';
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
import { toast } from 'sonner';
import { suggestFocoMes, type FocoSuggestInput } from '@/lib/foco-suggestion';

interface ConselhoDSConfigDialogProps {
  tenantId: string;
  tabKey: string;
  isAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  diagInput?: FocoSuggestInput | null;
}

const TOM_OPTIONS: Array<{ value: 'executivo' | 'tecnico' | 'direto'; label: string }> = [
  { value: 'executivo', label: 'Executivo' },
  { value: 'tecnico', label: 'Técnico' },
  { value: 'direto', label: 'Direto' },
];

const MAX_PERSONAS = 3;

export function ConselhoDSConfigDialog({
  tenantId,
  tabKey,
  isAdmin,
  open,
  onOpenChange,
  diagInput,
}: ConselhoDSConfigDialogProps) {
  const { data: personas, isLoading: personasLoading } = useConselhoPersonasAtivas();
  const { data: config, isLoading: configLoading } = useTenantConselhoConfig(tenantId, tabKey);
  const upsert = useUpsertTenantConselhoConfig();

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
    // ordena dentro do grupo
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

  const sugestao = useMemo(() => suggestFocoMes(diagInput ?? null, tabKey), [diagInput, tabKey]);

  function handleSugerirFoco() {
    if (!isAdmin) return;
    if (!sugestao) {
      toast.info('Sem dados suficientes para sugerir um foco automático.');
      return;
    }
    setFocoMes(sugestao);
    toast.success('Foco sugerido aplicado', { description: 'Você pode editar antes de salvar.' });
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
            {/* Personas */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Conselheiros</Label>
                <span className="text-xs text-muted-foreground">
                  {selectedIds.length}/{MAX_PERSONAS} selecionados
                </span>
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
                {isAdmin && sugestao && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSugerirFoco}
                    className="h-7 px-2 text-xs text-primary hover:text-primary"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Sugerir foco
                  </Button>
                )}
              </div>
              <Textarea
                id="foco-mes"
                value={focoMes}
                onChange={(e) => setFocoMes(e.target.value)}
                placeholder="Ex: reduzir churn, melhorar quick ratio... ou clique em 'Sugerir foco' pra usar os indicadores atuais"
                rows={4}
                disabled={!isAdmin}
              />
              {isAdmin && sugestao && !focoMes && (
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  💡 O Conselho DS analisou seus números e tem uma sugestão pronta — clique em "Sugerir foco" acima.
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
    </Dialog>
  );
}
