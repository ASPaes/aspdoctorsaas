import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Check, Search, UserX, Loader2, Phone } from 'lucide-react';
import { useRelevantAttendance } from '../hooks/useRelevantAttendance';
import { useClienteLinkSuggestion, type ClienteCandidato } from '../hooks/useClienteLinkSuggestion';
import { useClienteSearch } from '../hooks/useClienteSearch';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  tenantId: string;
  phoneNumber: string;
  onConfirmed: () => void;
  onCancel: () => void;
}

interface ClienteOption {
  id: string;
  codigo_sequencial: number | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  fornecedor_nome?: string | null;
  telefone_whatsapp?: string | null;
}

function clienteLabelInternal(c: { razao_social: string | null; nome_fantasia: string | null; codigo_sequencial: number | null }) {
  const name = c.razao_social || c.nome_fantasia || 'Sem nome';
  const code = c.codigo_sequencial != null ? `#${c.codigo_sequencial} ` : '';
  return `${code}${name}`;
}

function clienteLabel(c: { razao_social: string | null; nome_fantasia: string | null; codigo_sequencial: number | null }) {
  const name = c.nome_fantasia || c.razao_social || 'Sem nome';
  const code = c.codigo_sequencial != null ? `#${c.codigo_sequencial} ` : '';
  return `${code}${name}`;
}

export function ConfirmClienteModal({
  open,
  onOpenChange,
  conversationId,
  tenantId,
  phoneNumber,
  onConfirmed,
  onCancel,
}: Props) {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');

  const { attendanceId } = useRelevantAttendance(open ? conversationId : null);

  // Fetch conversation metadata to know currently linked cliente
  const { data: conversationMeta } = useQuery({
    queryKey: ['confirm-cliente-meta', conversationId, open],
    enabled: open && !!conversationId,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('metadata')
        .eq('id', conversationId)
        .maybeSingle();
      return (data?.metadata || null) as Record<string, unknown> | null;
    },
  });

  const { linkedCliente, isLinked, candidates } = useClienteLinkSuggestion(
    conversationId,
    phoneNumber,
    conversationMeta ?? null,
    attendanceId,
    tenantId,
  );

  const { results: searchResults, isLoading: isSearching } = useClienteSearch(searchTerm);

  const linkMutation = useMutation({
    mutationFn: async (clienteId: string) => {
      // Resolve attendance if missing
      let resolvedId = attendanceId;
      if (!resolvedId) {
        const { data: active } = await supabase
          .from('support_attendances')
          .select('id')
          .eq('conversation_id', conversationId)
          .neq('status', 'closed')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedId = active?.id ?? null;
      }

      if (resolvedId) {
        const { error } = await supabase.rpc('set_attendance_cliente', {
          p_attendance_id: resolvedId,
          p_cliente_id: clienteId,
        });
        if (error) throw error;
        return;
      }

      // Fallback: update conversation metadata directly
      const newMetadata = { ...(conversationMeta || {}), cliente_id: clienteId };
      const { error } = await supabase
        .from('whatsapp_conversations')
        .update({ metadata: newMetadata })
        .eq('id', conversationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Cliente confirmado');
      queryClient.invalidateQueries({ queryKey: ['whatsapp', 'conversations'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-linked'] });
      queryClient.invalidateQueries({ queryKey: ['cliente-candidatos-by-phone'] });
      queryClient.invalidateQueries({ queryKey: ['relevant-attendance'] });
      queryClient.invalidateQueries({ queryKey: ['confirm-cliente-meta', conversationId] });
      onConfirmed();
    },
    onError: (err: any) => {
      toast.error(`Erro ao vincular cliente: ${err?.message ?? 'desconhecido'}`);
    },
  });

  const isLinking = linkMutation.isPending;

  const linkedClienteId = linkedCliente?.id;
  const otherCandidates = useMemo<ClienteCandidato[]>(
    () => candidates.filter((c) => c.cliente_id !== linkedClienteId),
    [candidates, linkedClienteId],
  );

  const noCandidatesAndNotLinked = !isLinked && candidates.length === 0;

  const handleSelect = (clienteId: string) => {
    if (isLinking) return;
    linkMutation.mutate(clienteId);
  };

  const handleSkipNoCliente = () => {
    if (isLinking) return;
    onConfirmed();
  };

  const renderClienteCard = (
    c: ClienteOption,
    opts: { highlighted?: boolean; subtitle?: string | null } = {},
  ) => (
    <Card
      key={c.id}
      role="button"
      tabIndex={0}
      onClick={() => handleSelect(c.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleSelect(c.id);
        }
      }}
      className={`p-3 cursor-pointer transition-colors hover:bg-primary/10 ${
        opts.highlighted ? 'border-2 border-primary' : 'border-border'
      } ${isLinking ? 'pointer-events-none opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {opts.highlighted && <Check className="h-4 w-4 text-primary shrink-0" />}
            <p className="text-sm font-medium truncate">{clienteLabel(c)}</p>
            {opts.highlighted && (
              <Badge variant="default" className="text-[10px]">Vinculado atualmente</Badge>
            )}
          </div>
          {opts.subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{opts.subtitle}</p>
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !isLinking) onCancel(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirme o cliente desta conversa</DialogTitle>
          <DialogDescription>
            Antes de encerrar, confirme o cliente vinculado a este atendimento.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Linked cliente */}
          {isLinked && linkedCliente && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Cliente atual</p>
              {renderClienteCard(
                {
                  id: linkedCliente.id,
                  codigo_sequencial: linkedCliente.codigo_sequencial,
                  razao_social: linkedCliente.razao_social,
                  nome_fantasia: linkedCliente.nome_fantasia,
                },
                { highlighted: true, subtitle: 'Clique para confirmar e prosseguir' },
              )}
            </div>
          )}

          {/* Candidates */}
          {otherCandidates.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {isLinked ? 'Outros candidatos pelo telefone' : 'Candidatos pelo telefone'}
              </p>
              <div className="flex flex-col gap-2">
                {otherCandidates.map((c) =>
                  renderClienteCard(
                    {
                      id: c.cliente_id,
                      codigo_sequencial: c.codigo_sequencial,
                      razao_social: c.razao_social,
                      nome_fantasia: c.nome_fantasia,
                    },
                    { subtitle: c.fornecedor_nome ?? null },
                  ),
                )}
              </div>
            </div>
          )}

          {/* No candidates + not linked */}
          {noCandidatesAndNotLinked && (
            <div className="flex flex-col items-center text-center gap-2 py-4 border border-dashed border-border rounded-md">
              <UserX className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Nenhum cliente compatível com o telefone do contato.
              </p>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSkipNoCliente}
                disabled={isLinking}
              >
                Encerrar sem cliente
              </Button>
            </div>
          )}

          {/* Search */}
          <div className="flex flex-col gap-1.5 mt-2">
            <p className="text-xs font-medium text-muted-foreground">Buscar outro cliente</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Nome, código, CNPJ ou telefone (mín. 2 caracteres)"
                className="pl-8"
                disabled={isLinking}
              />
            </div>

            {searchTerm.length >= 2 && (
              <div className="flex flex-col gap-2 mt-1">
                {isSearching && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                    <Loader2 className="h-3 w-3 animate-spin" /> Buscando...
                  </div>
                )}
                {!isSearching && searchResults.length === 0 && (
                  <p className="text-xs text-muted-foreground py-1">Nenhum resultado.</p>
                )}
                {searchResults.map((r) =>
                  renderClienteCard(
                    {
                      id: r.id,
                      codigo_sequencial: r.codigo_sequencial,
                      razao_social: r.razao_social,
                      nome_fantasia: r.nome_fantasia,
                    },
                    { subtitle: r.cnpj || r.telefone_whatsapp || null },
                  ),
                )}
              </div>
            )}
          </div>

          {isLinking && (
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground py-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Vinculando...
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={isLinking}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
