import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, MessageSquare, RefreshCw } from 'lucide-react';
import { useMetaTemplates, type MetaTemplate } from '@/hooks/useMetaTemplates';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';
import {
  parseTemplateParams,
  hasInvalidParamChars,
  renderTemplateText,
  type TemplateParamSpec,
} from '@/lib/metaTemplateParams';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  to: string;
  onSent?: (result: { conversation_id: string; message_id: string }) => void;
}

export function MetaTemplatePicker({
  open,
  onOpenChange,
  instanceId,
  to,
  onSent,
}: Props) {
  const [selected, setSelected] = useState<MetaTemplate | null>(null);
  const [parameters, setParameters] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { data: templates, isLoading, error } = useMetaTemplates(instanceId);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const specById = useMemo(() => {
    const m = new Map<string, TemplateParamSpec>();
    for (const t of templates ?? []) m.set(t.id, parseTemplateParams(t.components));
    return m;
  }, [templates]);

  const spec = selected ? specById.get(selected.id) ?? null : null;

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setParameters([]);
      setSending(false);
    }
  }, [open]);

  useEffect(() => {
    const s = selected ? specById.get(selected.id) : null;
    setParameters(s ? new Array(s.names.length).fill('') : []);
    // dep só em selected?.id de propósito: refetch não pode limpar o que o usuário digitou
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const readErrorBody = async (err: any): Promise<string | null> => {
    try {
      const body = await err?.context?.json();
      if (body?.error) return String(body.error);
    } catch {
      /* corpo não-JSON */
    }
    return null;
  };

  const handleSend = async () => {
    if (!selected || !spec) return;

    if (spec.unsupported.length > 0) {
      toast({
        title: 'Template não suportado',
        description: spec.unsupported.join('; '),
        variant: 'destructive',
      });
      return;
    }

    if (spec.names.length > 0) {
      if (!parameters.every((p) => p.trim().length > 0)) {
        toast({
          title: 'Preencha todas as variáveis',
          description: 'O template tem variáveis obrigatórias.',
          variant: 'destructive',
        });
        return;
      }
      const bad = spec.names.filter((_, i) => hasInvalidParamChars(parameters[i]));
      if (bad.length > 0) {
        toast({
          title: 'Valor inválido',
          description: `A Meta não aceita quebra de linha, tab ou 5+ espaços seguidos em: ${bad.join(', ')}`,
          variant: 'destructive',
        });
        return;
      }
    }

    const paramsPayload =
      spec.names.length === 0
        ? {}
        : spec.format === 'NAMED'
          ? { parameters: Object.fromEntries(spec.names.map((n, i) => [n, parameters[i]])) }
          : { parameters };

    setSending(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'send-whatsapp-template',
        {
          body: {
            instance_id: instanceId,
            to,
            template_id: selected.id,
            ...paramsPayload,
          },
        },
      );

      if (invokeErr) throw invokeErr;
      if (!data?.success) throw new Error(data?.error || 'Falha no envio do template');

      toast({ title: 'Template enviado', description: `${selected.name} enviado com sucesso.` });
      onSent?.({ conversation_id: data.conversation_id, message_id: data.message_id });
      onOpenChange(false);
    } catch (err: any) {
      const bodyMsg = await readErrorBody(err);
      toast({
        title: 'Erro ao enviar template',
        description: bodyMsg || err?.message || 'Tente novamente em alguns segundos.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('sync-meta-templates', {
        body: { instance_id: instanceId },
      });
      if (invokeErr) throw invokeErr;
      if (!data?.success) throw new Error(data?.error || 'Falha na sincronização');
      toast({
        title: 'Templates sincronizados',
        description: `${data.upserts} template(s) atualizado(s), ${data.deleted} removido(s).`,
      });
      queryClient.invalidateQueries({ queryKey: ['meta-templates', instanceId] });
    } catch (err: any) {
      const bodyMsg = await readErrorBody(err);
      toast({
        title: 'Erro ao sincronizar',
        description: bodyMsg || err?.message || 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Enviar template Meta</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSync}
              disabled={syncing || !instanceId}
            >
              {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Sincronizar
            </Button>
          </div>
          <DialogDescription>
            Selecione um template aprovado para enviar a {to}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5" />
              <span>Erro ao carregar templates: {(error as any).message}</span>
            </div>
          )}

          {!isLoading && templates && templates.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
              <MessageSquare />
              <p className="text-sm font-medium">
                Nenhum template aprovado para esta instância.
              </p>
              <p className="text-xs">
                Crie um template na Meta Business Suite, aguarde aprovação e sincronize.
              </p>
            </div>
          )}

          {!isLoading && templates && templates.length > 0 && (
            <ScrollArea className="h-[300px] pr-3">
              <div className="space-y-2">
                {templates.map((tpl) => {
                  const tplSpec = specById.get(tpl.id);
                  const varCount = tplSpec?.names.length ?? 0;
                  return (
                    <Card
                      key={tpl.id}
                      onClick={() => setSelected(tpl)}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-accent',
                        selected?.id === tpl.id && 'border-primary bg-accent',
                      )}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-medium truncate">{tpl.name}</span>
                            <Badge variant="outline" className="shrink-0">
                              {tpl.language}
                            </Badge>
                          </div>
                          <Badge variant="secondary" className="shrink-0">
                            {tpl.category}
                          </Badge>
                        </div>
                        {tpl.body_text && (
                          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                            {tpl.body_text}
                          </p>
                        )}
                        {varCount > 0 && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {varCount} variável(is): {tplSpec!.names.join(', ')}
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {spec && spec.unsupported.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5" />
              <span>Este template ainda não pode ser enviado por aqui: {spec.unsupported.join('; ')}</span>
            </div>
          )}

          {spec && spec.names.length > 0 && spec.unsupported.length === 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Variáveis do template</p>
              {spec.names.map((name, idx) => (
                <div key={name} className="space-y-1">
                  <Label className="text-xs">{`{{${name}}}`}</Label>
                  <Input
                    value={parameters[idx] ?? ''}
                    onChange={(e) => {
                      const next = [...parameters];
                      next[idx] = e.target.value;
                      setParameters(next);
                    }}
                    placeholder={spec.examples[idx] || `Valor para ${name}`}
                  />
                </div>
              ))}
              <div className="mt-3 rounded-md border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Prévia</p>
                <p className="text-sm whitespace-pre-wrap">
                  {renderTemplateText(selected?.body_text ?? '', spec, parameters)}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSend}
            disabled={!selected || !spec || sending || spec.unsupported.length > 0}
          >
            {sending && <Loader2 className="animate-spin" />}
            Enviar template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
