import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { addDays, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { useCreateCSTicket, useFuncionariosAtivos } from './hooks/useCSTickets';
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_PRIORIDADE_LABELS, CS_TICKET_IMPACTO_LABELS, CS_INDICACAO_STATUS_LABELS,
  type CSTicketTipo, type CSTicketPrioridade, type CSTicketImpacto, type CSIndicacaoStatus,
} from './types';
import { Loader2 } from 'lucide-react';

const ticketSchema = z.object({
  cliente_id: z.string().optional(),
  tipo: z.enum(['relacionamento_90d', 'risco_churn', 'adocao_engajamento', 'indicacao', 'oportunidade', 'clube_comunidade', 'interno_processo']),
  assunto: z.string().min(1, 'Assunto é obrigatório'),
  descricao_curta: z.string().min(1, 'Descrição é obrigatória'),
  prioridade: z.enum(['baixa', 'media', 'alta', 'urgente']),
  owner_id: z.number({ required_error: 'Responsável é obrigatório' }),
  proxima_acao: z.string().min(1, 'Próxima ação é obrigatória'),
  proximo_followup_em: z.string().min(1, 'Data do próximo follow-up é obrigatória'),
  impacto_categoria: z.enum(['risco', 'expansao', 'relacionamento', 'processo']),
  mrr_em_risco: z.number().nullable().optional(),
  prob_churn_percent: z.number().min(0).max(100).nullable().optional(),
  prob_sucesso_percent: z.number().min(0).max(100).nullable().optional(),
  indicacao_nome: z.string().nullable().optional(),
  indicacao_contato: z.string().nullable().optional(),
  indicacao_cidade: z.string().nullable().optional(),
  indicacao_status: z.enum(['recebida', 'contatada', 'qualificada', 'enviada_ao_comercial', 'fechou', 'nao_fechou']).nullable().optional(),
});

type TicketFormData = z.infer<typeof ticketSchema>;

interface CSTicketFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId?: string;
  clienteNome?: string;
  defaultOwnerId?: number;
}

interface ClienteOption {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
}

export function CSTicketForm({ open, onOpenChange, clienteId, clienteNome, defaultOwnerId }: CSTicketFormProps) {
  const [clientes, setClientes] = useState<ClienteOption[]>([]);
  const [searchCliente, setSearchCliente] = useState('');
  const [loadingClientes, setLoadingClientes] = useState(false);
  const [isInterno, setIsInterno] = useState(!clienteId);

  const { data: funcionarios } = useFuncionariosAtivos();
  const createTicket = useCreateCSTicket();

  const { register, handleSubmit, setValue, watch, reset, formState, formState: { errors, isSubmitting } } = useForm<TicketFormData>({
    resolver: zodResolver(ticketSchema),
    defaultValues: {
      tipo: 'relacionamento_90d', prioridade: 'media', impacto_categoria: 'relacionamento',
      cliente_id: clienteId || undefined, owner_id: defaultOwnerId || undefined,
      proximo_followup_em: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
    },
  });

  const selectedClienteId = watch('cliente_id');
  const selectedTipo = watch('tipo');
  const formIsDirty = formState.isDirty;

  // Protect against accidental refresh while form has data
  useEffect(() => {
    if (!formIsDirty || !open) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [formIsDirty, open]);

  useEffect(() => {
    if (isInterno || clienteId) return;
    if (searchCliente.length < 2) { setClientes([]); return; }
    setLoadingClientes(true);
    const debounce = setTimeout(async () => {
      const { data } = await supabase.from('clientes').select('id, razao_social, nome_fantasia')
        .eq('cancelado', false)
        .or(`razao_social.ilike.%${searchCliente}%,nome_fantasia.ilike.%${searchCliente}%`)
        .limit(10);
      if (data) setClientes(data);
      setLoadingClientes(false);
    }, 300);
    return () => clearTimeout(debounce);
  }, [searchCliente, isInterno, clienteId]);

  useEffect(() => {
    if (open) {
      reset({
        tipo: 'relacionamento_90d', prioridade: 'media', impacto_categoria: 'relacionamento',
        cliente_id: clienteId || undefined, owner_id: defaultOwnerId || undefined,
        proximo_followup_em: format(addDays(new Date(), 7), 'yyyy-MM-dd'),
      });
      setIsInterno(!clienteId);
      if (clienteId && clienteNome) setClientes([{ id: clienteId, razao_social: clienteNome, nome_fantasia: null }]);
    }
  }, [open, clienteId, clienteNome, defaultOwnerId, reset]);

  const handleSelectCliente = (cliente: ClienteOption) => {
    setValue('cliente_id', cliente.id);
    setSearchCliente(cliente.nome_fantasia || cliente.razao_social);
  };

  const onSubmit = async (data: TicketFormData) => {
    await createTicket.mutateAsync({
      cliente_id: isInterno ? null : data.cliente_id,
      tipo: data.tipo as CSTicketTipo,
      assunto: data.assunto,
      descricao_curta: data.descricao_curta,
      prioridade: data.prioridade as CSTicketPrioridade,
      owner_id: data.owner_id,
      proxima_acao: data.proxima_acao,
      proximo_followup_em: data.proximo_followup_em,
      impacto_categoria: data.impacto_categoria as CSTicketImpacto,
      mrr_em_risco: data.mrr_em_risco,
      prob_churn_percent: data.prob_churn_percent,
      prob_sucesso_percent: data.prob_sucesso_percent,
      indicacao_nome: data.indicacao_nome,
      indicacao_contato: data.indicacao_contato,
      indicacao_cidade: data.indicacao_cidade,
      indicacao_status: data.indicacao_status as CSIndicacaoStatus | null,
    });
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>Novo Ticket CS</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="flex items-center gap-4">
            <Button type="button" variant={!isInterno ? 'default' : 'outline'} onClick={() => setIsInterno(false)} className="flex-1">Ticket de Cliente</Button>
            <Button type="button" variant={isInterno ? 'default' : 'outline'} onClick={() => { setIsInterno(true); setValue('cliente_id', undefined); }} className="flex-1">Ticket Interno</Button>
          </div>

          {!isInterno && (
            <div className="space-y-2">
              <Label>Cliente</Label>
              {clienteId ? <Input value={clienteNome || ''} disabled className="bg-muted" /> : (
                <>
                  <Input placeholder="Buscar cliente..." value={searchCliente} onChange={(e) => setSearchCliente(e.target.value)} />
                  {loadingClientes && <p className="text-sm text-muted-foreground">Buscando...</p>}
                  {clientes.length > 0 && !selectedClienteId && (
                    <div className="border rounded-md max-h-40 overflow-auto">
                      {clientes.map((c) => (<button key={c.id} type="button" className="w-full px-3 py-2 text-left hover:bg-accent text-sm" onClick={() => handleSelectCliente(c)}>{c.nome_fantasia || c.razao_social}</button>))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={watch('tipo')} onValueChange={(v) => setValue('tipo', v as CSTicketTipo)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_TIPO_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade *</Label>
              <Select value={watch('prioridade')} onValueChange={(v) => setValue('prioridade', v as CSTicketPrioridade)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_PRIORIDADE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assunto">Assunto *</Label>
            <Input id="assunto" {...register('assunto')} placeholder="Ex: Check-in 90 dias, Risco de cancelamento..." />
            {errors.assunto && <p className="text-sm text-destructive">{errors.assunto.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="descricao_curta">Descrição Curta *</Label>
            <Textarea id="descricao_curta" {...register('descricao_curta')} placeholder="Contexto breve..." rows={2} />
            {errors.descricao_curta && <p className="text-sm text-destructive">{errors.descricao_curta.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Responsável (Owner) *</Label>
              <Select value={watch('owner_id') ? String(watch('owner_id')) : ''} onValueChange={(v) => setValue('owner_id', Number(v))}>
                <SelectTrigger><SelectValue placeholder="Selecionar responsável" /></SelectTrigger>
                <SelectContent>{funcionarios?.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.nome}{f.cargo ? ` (${f.cargo})` : ''}</SelectItem>)}</SelectContent>
              </Select>
              {errors.owner_id && <p className="text-sm text-destructive">{errors.owner_id.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Categoria de Impacto</Label>
              <Select value={watch('impacto_categoria')} onValueChange={(v) => setValue('impacto_categoria', v as CSTicketImpacto)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_IMPACTO_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <Separator />
          <div className="space-y-4">
            <h4 className="font-medium">Campos Operacionais</h4>
            <div className="space-y-2">
              <Label htmlFor="proxima_acao">Próxima Ação *</Label>
              <Input id="proxima_acao" {...register('proxima_acao')} placeholder="Ex: Ligar para cliente..." />
              {errors.proxima_acao && <p className="text-sm text-destructive">{errors.proxima_acao.message}</p>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="proximo_followup_em">Próximo Follow-up *</Label>
                <Input id="proximo_followup_em" type="date" {...register('proximo_followup_em')} />
                {errors.proximo_followup_em && <p className="text-sm text-destructive">{errors.proximo_followup_em.message}</p>}
              </div>
              {(selectedTipo === 'risco_churn' || selectedTipo === 'oportunidade') && (
                <div className="space-y-2">
                  <Label htmlFor="mrr_em_risco">MRR em Risco (R$)</Label>
                  <Input id="mrr_em_risco" type="number" step="0.01" {...register('mrr_em_risco', { valueAsNumber: true })} placeholder="0,00" />
                </div>
              )}
            </div>
          </div>

          {selectedTipo === 'indicacao' && (
            <>
              <Separator />
              <div className="space-y-4">
                <h4 className="font-medium">Dados da Indicação</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2"><Label>Nome do Indicado</Label><Input {...register('indicacao_nome')} placeholder="Nome da empresa/pessoa" /></div>
                  <div className="space-y-2"><Label>Contato</Label><Input {...register('indicacao_contato')} placeholder="Telefone ou email" /></div>
                  <div className="space-y-2"><Label>Cidade</Label><Input {...register('indicacao_cidade')} placeholder="Cidade" /></div>
                  <div className="space-y-2">
                    <Label>Status da Indicação</Label>
                    <Select value={watch('indicacao_status') || ''} onValueChange={(v) => setValue('indicacao_status', v as CSIndicacaoStatus)}>
                      <SelectTrigger><SelectValue placeholder="Selecionar status" /></SelectTrigger>
                      <SelectContent>{Object.entries(CS_INDICACAO_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting || createTicket.isPending}>
              {(isSubmitting || createTicket.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Ticket
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
