import { useEffect, useMemo, useRef, useState } from 'react';
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
  inferParamSources,
  type TemplateParamSpec,
} from '@/lib/metaTemplateParams';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  to: string;
  /** Nome de quem está enviando, para preencher "Olá, sou {{1}}". */
  operatorName?: string | null;
  /** Nome do contato do outro lado, para preencher "Olá {{nome}},". */
  contactName?: string | null;
  onSent?: (result: { conversation_id: string; message_id: string }) => void;
}

export function MetaTemplatePicker({
  open,
  onOpenChange,
  instanceId,
  to,
  operatorName,
  contactName,
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

  const hoje = useMemo(
    () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    [],
  );

  /** Os valores que o sistema já conhece, na ordem em que aparecem nos atalhos. */
  const sugestoes = useMemo(
    () =>
      [
        { rotulo: 'Meu nome', valor: operatorName?.trim() || '' },
        { rotulo: 'Nome do contato', valor: contactName?.trim() || '' },
        { rotulo: 'Hoje', valor: hoje },
      ].filter((s) => s.valor.length > 0),
    [operatorName, contactName, hoje],
  );

  // O preenchimento roda ao ESCOLHER o template. Ler os nomes de um ref evita que
  // a chegada tardia de uma das queries do pai reescreva o que já foi digitado.
  const contextoRef = useRef({ operatorName, contactName });
  contextoRef.current = { operatorName, contactName };

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setParameters([]);
      setSending(false);
    }
  }, [open]);

  useEffect(() => {
    const s = selected ? specById.get(selected.id) : null;
    if (!s) {
      setParameters([]);
      return;
    }
    const { operatorName: op, contactName: ct } = contextoRef.current;
    const fontes = inferParamSources(selected?.body_text, s);
    setParameters(
      s.names.map((_, i) => {
        if (fontes[i] === 'operator') return op?.trim() || '';
        if (fontes[i] === 'contact') return ct?.trim() || '';
        return '';
      }),
    );
    // dep só em selected?.id de propósito: refetch não pode limpar o que o usuário digitou
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const setParam = (idx: number, valor: string) =>
    setParameters((atual) => {
      const next = [...atual];
      next[idx] = valor;
      return next;
    });

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
                            {varCount === 1 ? '1 variável' : `${varCount} variáveis`}:{' '}
                            {tplSpec!.names.map((n) => `{{${n}}}`).join(', ')}
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
              <div className="space-y-3">
                {spec.names.map((name, idx) => {
                  const vazio = (parameters[idx] ?? '').trim().length === 0;
                  return (
                    <div key={name} className="space-y-1">
                      <Label className="text-xs">{`{{${name}}}`}</Label>
                      <Input
                        value={parameters[idx] ?? ''}
                        onChange={(e) => setParam(idx, e.target.value)}
                        placeholder={`Valor para {{${name}}}`}
                      />
                      {sugestoes.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <span className="text-[11px] text-muted-foreground">Preencher com:</span>
                          {sugestoes.map((s) => (
                            <button
                              key={s.rotulo}
                              type="button"
                              onClick={() => setParam(idx, s.valor)}
                              title={s.valor}
                              className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                              {s.rotulo}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* A "amostra de variável" da Meta costuma ser um literal sem sentido
                          para quem envia (nos templates da Delvale é "1"). Ela fica como
                          dica, e só enquanto o campo está vazio — depois de preenchido
                          vira ruído embaixo da resposta certa. */}
                      {vazio && spec.examples[idx] && (
                        <p className="text-[11px] text-muted-foreground">
                          Exemplo cadastrado na Meta: {spec.examples[idx]}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
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
