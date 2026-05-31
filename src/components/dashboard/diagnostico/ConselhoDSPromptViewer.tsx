import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Lock, FileText } from 'lucide-react';
import { useConselhoAbaTemplate } from './useConselhoAbaTemplate';

interface ConselhoDSPromptViewerProps {
  tenantId: string;
  tabKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ConselhoDSPromptViewer({
  tenantId,
  tabKey,
  open,
  onOpenChange,
}: ConselhoDSPromptViewerProps) {
  const { data: template, isLoading } = useConselhoAbaTemplate(tenantId, tabKey, open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Prompt do Conselho DS · {template?.display_label || tabKey}
          </DialogTitle>
          <DialogDescription>
            Este é o prompt que será enviado à IA, junto com seus indicadores reais e as perspectivas dos conselheiros que você escolher.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !template ? (
          <p className="text-sm text-muted-foreground">Template indisponível para esta aba.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border border-border text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Apenas super admins do DoctorSaaS podem editar este prompt. Se identificou algo a melhorar, entre em contato com nosso suporte.
              </span>
            </div>

            <div className="space-y-1.5">
              <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Prompt principal
              </h4>
              <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/40 border border-border rounded-md p-3 max-h-72 overflow-y-auto text-foreground/90">
                {template.prompt_principal}
              </pre>
            </div>

            <div className="space-y-1.5">
              <h4 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                Formato de saída esperado
              </h4>
              <pre className="text-xs font-mono whitespace-pre-wrap bg-muted/40 border border-border rounded-md p-3 max-h-56 overflow-y-auto text-foreground/90">
                {template.output_format_prompt}
              </pre>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
              <span>Custo estimado por análise: R$ {template.custo_estimado_brl.toFixed(2)}</span>
              <span>Tokens máximos: {template.max_tokens}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
