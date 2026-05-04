import { useEffect, useState } from 'react';
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
import { Loader2, AlertTriangle, MessageSquare } from 'lucide-react';
import { useMetaTemplates, type MetaTemplate } from '@/hooks/useMetaTemplates';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

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
  const { data: templates, isLoading, error } = useMetaTemplates(instanceId);
  const { toast } = useToast();

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setParameters([]);
      setSending(false);
    }
  }, [open]);

  useEffect(() => {
    if (selected) {
      setParameters(new Array(selected.body_variables_count).fill(''));
    }
  }, [selected?.id]);

  const handleSend = async () => {
    if (!selected) return;

    if (selected.body_variables_count > 0) {
      const allFilled = parameters.every((p) => p.trim().length > 0);
      if (!allFilled) {
        toast({
          title: 'Preencha todas as variáveis',
          description: 'O template tem variáveis obrigatórias.',
          variant: 'destructive',
        });
        return;
      }
    }

    setSending(true);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke(
        'send-whatsapp-template',
        {
          body: {
            instance_id: instanceId,
            to,
            template_id: selected.id,
            ...(parameters.length > 0 ? { parameters } : {}),
          },
        },
      );

      if (invokeErr) throw invokeErr;
      if (!data?.success) {
        throw new Error(data?.error || 'Falha no envio do template');
      }

      toast({
        title: 'Template enviado',
        description: `${selected.name} enviado com sucesso.`,
      });
      onSent?.({
        conversation_id: data.conversation_id,
        message_id: data.message_id,
      });
      onOpenChange(false);
    } catch (err: any) {
      toast({
        title: 'Erro ao enviar template',
        description: err?.message || 'Tente novamente em alguns segundos.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enviar template Meta</DialogTitle>
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
                {templates.map((tpl) => (
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
                      {tpl.body_variables_count > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {tpl.body_variables_count} variável(is)
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}

          {selected && selected.body_variables_count > 0 && (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">Variáveis do template</p>
              {parameters.map((value, idx) => (
                <div key={idx} className="space-y-1">
                  <Label className="text-xs">
                    Variável {`{{${idx + 1}}}`}
                  </Label>
                  <Input
                    value={value}
                    onChange={(e) => {
                      const next = [...parameters];
                      next[idx] = e.target.value;
                      setParameters(next);
                    }}
                    placeholder={`Valor para a variável ${idx + 1}`}
                  />
                </div>
              ))}
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
          <Button onClick={handleSend} disabled={!selected || sending}>
            {sending && <Loader2 className="animate-spin" />}
            Enviar template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
