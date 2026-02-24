import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useCSTicket, useUpdateCSTicket, useFuncionariosAtivos } from './hooks/useCSTickets';
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS, CS_TICKET_IMPACTO_LABELS,
  type CSTicket, type CSTicketStatus, type CSTicketPrioridade,
} from './types';
import { Loader2, Calendar, User, Building2, DollarSign, Clock, Save, AlertTriangle, CheckCircle, ArrowUpDown, Play } from 'lucide-react';
import { toast } from 'sonner';

interface CSTicketDetailContentProps {
  ticket: CSTicket | null;
  mode: 'view' | 'edit';
  onClose: () => void;
}

const STATUS_COLORS: Record<CSTicketStatus, string> = {
  aberto: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  em_andamento: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  aguardando_cliente: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  aguardando_interno: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  em_monitoramento: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-300',
  concluido: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  cancelado: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300',
};

const PRIORIDADE_COLORS: Record<CSTicketPrioridade, string> = {
  baixa: 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-300',
  media: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  alta: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  urgente: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

const RESULTADO_OPTIONS = [
  { value: 'sucesso', label: 'Sucesso' },
  { value: 'parcial', label: 'Sucesso Parcial' },
  { value: 'sem_sucesso', label: 'Sem Sucesso' },
  { value: 'cancelado_cliente', label: 'Cancelado pelo Cliente' },
];

export function CSTicketDetailContent({ ticket, mode, onClose }: CSTicketDetailContentProps) {
  const queryClient = useQueryClient();
  const { data: ticketData, isLoading } = useCSTicket(ticket?.id || null);
  const { data: funcionarios } = useFuncionariosAtivos();
  const updateTicket = useUpdateCSTicket();

  const [showConcluirDialog, setShowConcluirDialog] = useState(false);
  const [showReassignDialog, setShowReassignDialog] = useState(false);

  const [editData, setEditData] = useState({
    status: ticket?.status || 'aberto' as CSTicketStatus,
    prioridade: ticket?.prioridade || 'media' as CSTicketPrioridade,
    escalado: ticket?.escalado || false,
    owner_id: ticket?.owner_id || 0,
    proxima_acao: ticket?.proxima_acao || '',
    proximo_followup_em: ticket?.proximo_followup_em || '',
  });

  const [fechamentoData, setFechamentoData] = useState({
    acao_tomada: '', resultado: '', satisfacao: '', continuar_monitorando: false,
    proxima_acao_monitoramento: '', data_monitoramento: '',
  });

  const [reassignData, setReassignData] = useState({ para_id: 0, motivo: '' });

  const currentTicket = ticketData || ticket;

  useEffect(() => {
    if (currentTicket) {
      setEditData({
        status: currentTicket.status,
        prioridade: currentTicket.prioridade,
        escalado: currentTicket.escalado,
        owner_id: currentTicket.owner_id || 0,
        proxima_acao: currentTicket.proxima_acao,
        proximo_followup_em: currentTicket.proximo_followup_em,
      });
    }
  }, [currentTicket]);

  const addUpdate = useMutation({
    mutationFn: async (data: { conteudo: string; tipo: string }) => {
      const { error } = await supabase.from('cs_ticket_updates').insert([{
        ticket_id: currentTicket!.id, tipo: data.tipo, conteudo: data.conteudo, privado: true,
      }] as any);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['cs-ticket-updates-paginated', currentTicket?.id] }); },
  });

  const reassignTicket = useMutation({
    mutationFn: async () => {
      const { error: reassignError } = await supabase.from('cs_ticket_reassignments').insert({
        ticket_id: currentTicket!.id, de_id: currentTicket!.owner_id, para_id: reassignData.para_id, motivo: reassignData.motivo,
      } as any);
      if (reassignError) throw reassignError;
      const { error: updateError } = await supabase.from('cs_tickets').update({ owner_id: reassignData.para_id } as any).eq('id', currentTicket!.id);
      if (updateError) throw updateError;
      const newOwner = funcionarios?.find(f => f.id === reassignData.para_id);
      await addUpdate.mutateAsync({ conteudo: `Ticket reatribuído para ${newOwner?.nome || 'novo responsável'}. Motivo: ${reassignData.motivo}`, tipo: 'mudanca_owner' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cs-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['cs-ticket', currentTicket?.id] });
      setShowReassignDialog(false);
      setReassignData({ para_id: 0, motivo: '' });
      toast.success('Ticket reatribuído com sucesso');
    },
    onError: () => { toast.error('Erro ao reatribuir ticket'); },
  });

  const handleRegistrarPrimeiraAcao = async () => {
    if (!currentTicket) return;
    await updateTicket.mutateAsync({ id: currentTicket.id, primeira_acao_em: new Date().toISOString(), status: 'em_andamento' });
    await addUpdate.mutateAsync({ conteudo: 'Primeira ação registrada. Ticket em andamento.', tipo: 'registro_acao' });
  };

  const handleConcluir = async () => {
    if (!currentTicket || !fechamentoData.acao_tomada || !fechamentoData.resultado) {
      toast.error('Preencha a ação tomada e o resultado'); return;
    }
    if (fechamentoData.continuar_monitorando) {
      if (!fechamentoData.proxima_acao_monitoramento || !fechamentoData.data_monitoramento) { toast.error('Para monitoramento, preencha próxima ação e data'); return; }
      await updateTicket.mutateAsync({ id: currentTicket.id, status: 'em_monitoramento', proxima_acao: fechamentoData.proxima_acao_monitoramento, proximo_followup_em: fechamentoData.data_monitoramento });
      await addUpdate.mutateAsync({ conteudo: `Movido para monitoramento. Ação: ${fechamentoData.acao_tomada}. Resultado: ${fechamentoData.resultado}.`, tipo: 'mudanca_status' });
    } else {
      await updateTicket.mutateAsync({ id: currentTicket.id, status: 'concluido', concluido_em: new Date().toISOString() });
      await addUpdate.mutateAsync({ conteudo: `Ticket concluído. Ação: ${fechamentoData.acao_tomada}. Resultado: ${fechamentoData.resultado}.`, tipo: 'registro_acao' });
    }
    setShowConcluirDialog(false);
    setFechamentoData({ acao_tomada: '', resultado: '', satisfacao: '', continuar_monitorando: false, proxima_acao_monitoramento: '', data_monitoramento: '' });
  };

  const handleSave = async () => {
    if (!currentTicket) return;
    const changes: string[] = [];
    if (editData.status !== currentTicket.status) changes.push(`Status: ${CS_TICKET_STATUS_LABELS[currentTicket.status]} → ${CS_TICKET_STATUS_LABELS[editData.status]}`);
    if (editData.prioridade !== currentTicket.prioridade) changes.push(`Prioridade: ${CS_TICKET_PRIORIDADE_LABELS[currentTicket.prioridade]} → ${CS_TICKET_PRIORIDADE_LABELS[editData.prioridade]}`);

    await updateTicket.mutateAsync({
      id: currentTicket.id, status: editData.status, prioridade: editData.prioridade, escalado: editData.escalado,
      proxima_acao: editData.proxima_acao, proximo_followup_em: editData.proximo_followup_em,
      ...(editData.status === 'concluido' && currentTicket.status !== 'concluido' ? { concluido_em: new Date().toISOString() } : {}),
    });
    if (changes.length > 0) await addUpdate.mutateAsync({ conteudo: changes.join('. '), tipo: changes.some(c => c.includes('Status')) ? 'mudanca_status' : 'mudanca_prioridade' });
    onClose();
  };

  const formatCurrency = (value: number | null) => {
    if (value === null) return '-';
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  };

  if (isLoading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (!currentTicket) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{CS_TICKET_TIPO_LABELS[currentTicket.tipo]}</Badge>
            {currentTicket.escalado && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Escalado</Badge>}
            {!currentTicket.primeira_acao_em && <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Aguardando 1ª ação</Badge>}
          </div>
          <h3 className="text-lg font-semibold truncate">{currentTicket.assunto}</h3>
          <p className="text-sm text-muted-foreground">{currentTicket.descricao_curta}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Badge className={PRIORIDADE_COLORS[currentTicket.prioridade]}>{CS_TICKET_PRIORIDADE_LABELS[currentTicket.prioridade]}</Badge>
          <Badge className={STATUS_COLORS[currentTicket.status]}>{CS_TICKET_STATUS_LABELS[currentTicket.status]}</Badge>
        </div>
      </div>

      {/* Cliente Info */}
      {currentTicket.cliente_id ? (
        <div className="bg-muted/50 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm"><Building2 className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{currentTicket.cliente?.nome_fantasia || currentTicket.cliente?.razao_social}</span></div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1"><DollarSign className="h-3 w-3" /><span>MRR: {formatCurrency(currentTicket.cliente?.mensalidade || 0)}</span></div>
            <div className="flex items-center gap-1"><User className="h-3 w-3" /><span>{currentTicket.cliente?.cancelado ? 'Cancelado' : 'Ativo'}</span></div>
          </div>
        </div>
      ) : (
        <div className="bg-muted/50 rounded-lg p-3"><div className="flex items-center gap-2 text-sm text-muted-foreground"><User className="h-4 w-4" /><span className="italic">Ticket Interno</span></div></div>
      )}

      {/* Quick Actions */}
      {currentTicket.status !== 'concluido' && currentTicket.status !== 'cancelado' && (
        <div className="flex flex-wrap gap-2">
          {!currentTicket.primeira_acao_em && <Button size="sm" onClick={handleRegistrarPrimeiraAcao}><Play className="h-4 w-4 mr-1" />Registrar 1ª Ação</Button>}
          <Button size="sm" variant="outline" onClick={() => setShowReassignDialog(true)}><ArrowUpDown className="h-4 w-4 mr-1" />Reatribuir</Button>
          <Button size="sm" variant="default" onClick={() => setShowConcluirDialog(true)}><CheckCircle className="h-4 w-4 mr-1" />Concluir</Button>
        </div>
      )}

      <Separator />

      {mode === 'edit' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editData.status} onValueChange={(v) => setEditData({ ...editData, status: v as CSTicketStatus })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prioridade</Label>
              <Select value={editData.prioridade} onValueChange={(v) => setEditData({ ...editData, prioridade: v as CSTicketPrioridade })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_PRIORIDADE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Próximo Follow-up</Label>
              <Input type="date" value={editData.proximo_followup_em} onChange={(e) => setEditData({ ...editData, proximo_followup_em: e.target.value })} />
            </div>
            <div className="space-y-2 flex items-end">
              <div className="flex items-center gap-2"><Switch checked={editData.escalado} onCheckedChange={(c) => setEditData({ ...editData, escalado: c })} /><Label>Escalado</Label></div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Próxima Ação</Label>
            <Textarea value={editData.proxima_acao} onChange={(e) => setEditData({ ...editData, proxima_acao: e.target.value })} rows={2} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button onClick={handleSave} disabled={updateTicket.isPending}>
              {updateTicket.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}<Save className="mr-2 h-4 w-4" />Salvar
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {(currentTicket.mrr_em_risco || currentTicket.mrr_recuperado) && (
            <div className="grid grid-cols-2 gap-4 p-3 border rounded-lg">
              {currentTicket.mrr_em_risco ? <div><Label className="text-muted-foreground text-xs">MRR em Risco</Label><p className="text-lg font-semibold text-destructive">{formatCurrency(currentTicket.mrr_em_risco)}</p></div> : null}
              {currentTicket.mrr_recuperado ? <div><Label className="text-muted-foreground text-xs">MRR Recuperado</Label><p className="text-lg font-semibold text-primary">{formatCurrency(currentTicket.mrr_recuperado)}</p></div> : null}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1"><Label className="text-muted-foreground text-xs">Owner</Label><p>{currentTicket.owner?.nome || '-'}</p></div>
            <div className="space-y-1"><Label className="text-muted-foreground text-xs">Criado por</Label><p>{currentTicket.criado_por?.nome || '-'}</p></div>
            <div className="space-y-1"><Label className="text-muted-foreground text-xs flex items-center gap-1"><Calendar className="h-3 w-3" /> Criado em</Label><p>{format(new Date(currentTicket.criado_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p></div>
            <div className="space-y-1"><Label className="text-muted-foreground text-xs flex items-center gap-1"><Clock className="h-3 w-3" /> Próximo Follow-up</Label><p>{currentTicket.proximo_followup_em ? format(new Date(currentTicket.proximo_followup_em), 'dd/MM/yyyy', { locale: ptBR }) : '-'}</p></div>
            <div className="space-y-1"><Label className="text-muted-foreground text-xs">Impacto</Label><p>{CS_TICKET_IMPACTO_LABELS[currentTicket.impacto_categoria]}</p></div>
            {currentTicket.primeira_acao_em && <div className="space-y-1"><Label className="text-muted-foreground text-xs">1ª Ação em</Label><p>{format(new Date(currentTicket.primeira_acao_em), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</p></div>}
          </div>
          <div className="space-y-1"><Label className="text-muted-foreground text-xs">Próxima Ação</Label><p className="p-2 bg-muted/50 rounded-md text-sm">{currentTicket.proxima_acao}</p></div>
        </div>
      )}

      {/* Concluir Dialog */}
      <AlertDialog open={showConcluirDialog} onOpenChange={setShowConcluirDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader><AlertDialogTitle>Concluir Ticket</AlertDialogTitle><AlertDialogDescription>Preencha os campos de fechamento.</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Ação Tomada *</Label><Textarea value={fechamentoData.acao_tomada} onChange={(e) => setFechamentoData({ ...fechamentoData, acao_tomada: e.target.value })} placeholder="Descreva a ação realizada..." rows={2} /></div>
            <div className="space-y-2"><Label>Resultado *</Label>
              <Select value={fechamentoData.resultado} onValueChange={(v) => setFechamentoData({ ...fechamentoData, resultado: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione o resultado" /></SelectTrigger>
                <SelectContent>{RESULTADO_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Satisfação Percebida</Label>
              <Select value={fechamentoData.satisfacao} onValueChange={(v) => setFechamentoData({ ...fechamentoData, satisfacao: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent><SelectItem value="satisfeito">Satisfeito</SelectItem><SelectItem value="neutro">Neutro</SelectItem><SelectItem value="insatisfeito">Insatisfeito</SelectItem></SelectContent>
              </Select>
            </div>
            <Separator />
            <div className="flex items-center gap-2"><Switch checked={fechamentoData.continuar_monitorando} onCheckedChange={(c) => setFechamentoData({ ...fechamentoData, continuar_monitorando: c })} /><Label>Manter em Monitoramento</Label></div>
            {fechamentoData.continuar_monitorando && (
              <>
                <div className="space-y-2"><Label>Próximo Passo *</Label><Input value={fechamentoData.proxima_acao_monitoramento} onChange={(e) => setFechamentoData({ ...fechamentoData, proxima_acao_monitoramento: e.target.value })} placeholder="O que fazer no monitoramento..." /></div>
                <div className="space-y-2"><Label>Data do Monitoramento *</Label><Input type="date" value={fechamentoData.data_monitoramento} onChange={(e) => setFechamentoData({ ...fechamentoData, data_monitoramento: e.target.value })} /></div>
              </>
            )}
          </div>
          <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={handleConcluir}>{fechamentoData.continuar_monitorando ? 'Monitorar' : 'Concluir'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reassign Dialog */}
      <AlertDialog open={showReassignDialog} onOpenChange={setShowReassignDialog}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Reatribuir Ticket</AlertDialogTitle><AlertDialogDescription>Selecione o novo responsável e informe o motivo.</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>Novo Responsável *</Label>
              <Select value={reassignData.para_id ? String(reassignData.para_id) : ''} onValueChange={(v) => setReassignData({ ...reassignData, para_id: Number(v) })}>
                <SelectTrigger><SelectValue placeholder="Selecionar funcionário" /></SelectTrigger>
                <SelectContent>{funcionarios?.filter(f => f.id !== currentTicket?.owner_id).map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}{f.cargo ? ` (${f.cargo})` : ''}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Motivo *</Label><Textarea value={reassignData.motivo} onChange={(e) => setReassignData({ ...reassignData, motivo: e.target.value })} placeholder="Por que está reatribuindo..." rows={2} /></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => reassignTicket.mutate()} disabled={!reassignData.para_id || !reassignData.motivo || reassignTicket.isPending}>
              {reassignTicket.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Reatribuir'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
