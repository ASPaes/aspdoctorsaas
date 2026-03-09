import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NumericInput } from '@/components/ui/numeric-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useCSTicket, useUpdateCSTicket, useFuncionariosAtivos, useDeleteCSTicket } from './hooks/useCSTickets';
import {
  CS_TICKET_TIPO_LABELS, CS_TICKET_STATUS_LABELS, CS_TICKET_PRIORIDADE_LABELS, CS_TICKET_IMPACTO_LABELS, CS_INDICACAO_STATUS_LABELS,
  type CSTicket, type CSTicketStatus, type CSTicketPrioridade, type CSTicketTipo, type CSTicketImpacto, type CSIndicacaoStatus,
} from './types';
import { Loader2, Calendar, User, Building2, DollarSign, Clock, Save, AlertTriangle, CheckCircle, ArrowUpDown, Play, Trash2, ExternalLink, MessageCircle } from 'lucide-react';
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: ticketData, isLoading } = useCSTicket(ticket?.id || null);
  const { data: funcionarios } = useFuncionariosAtivos();
  const updateTicket = useUpdateCSTicket();
  const deleteTicket = useDeleteCSTicket();

  const [showConcluirDialog, setShowConcluirDialog] = useState(false);
  const [showReassignDialog, setShowReassignDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const [editData, setEditData] = useState({
    tipo: ticket?.tipo || 'relacionamento_90d' as CSTicketTipo,
    assunto: ticket?.assunto || '',
    descricao_curta: ticket?.descricao_curta || '',
    status: ticket?.status || 'aberto' as CSTicketStatus,
    prioridade: ticket?.prioridade || 'media' as CSTicketPrioridade,
    impacto_categoria: ticket?.impacto_categoria || 'relacionamento' as CSTicketImpacto,
    escalado: ticket?.escalado || false,
    owner_id: ticket?.owner_id || 0,
    proxima_acao: ticket?.proxima_acao || '',
    proximo_followup_em: ticket?.proximo_followup_em || '',
    mrr_em_risco: ticket?.mrr_em_risco ?? null as number | null,
    mrr_recuperado: ticket?.mrr_recuperado ?? null as number | null,
    contato_externo_nome: ticket?.contato_externo_nome || '',
    oport_valor_previsto_ativacao: ticket?.oport_valor_previsto_ativacao ?? null as number | null,
    oport_valor_previsto_mrr: ticket?.oport_valor_previsto_mrr ?? null as number | null,
    oport_data_prevista: ticket?.oport_data_prevista || '',
    indicacao_nome: ticket?.indicacao_nome || '',
    indicacao_contato: ticket?.indicacao_contato || '',
    indicacao_cidade: ticket?.indicacao_cidade || '',
    indicacao_status: ticket?.indicacao_status || null as CSIndicacaoStatus | null,
  });

  const [fechamentoData, setFechamentoData] = useState({
    acao_tomada: '', resultado: '', satisfacao: '', continuar_monitorando: false,
    proxima_acao_monitoramento: '', data_monitoramento: '',
    mrr_recuperado: null as number | null,
    oport_resultado: '' as string,
  });

  const [reassignData, setReassignData] = useState({ para_id: 0, motivo: '' });

  const currentTicket = ticketData || ticket;

  useEffect(() => {
    if (currentTicket) {
      setEditData({
        tipo: currentTicket.tipo,
        assunto: currentTicket.assunto,
        descricao_curta: currentTicket.descricao_curta,
        status: currentTicket.status,
        prioridade: currentTicket.prioridade,
        impacto_categoria: currentTicket.impacto_categoria,
        escalado: currentTicket.escalado,
        owner_id: currentTicket.owner_id || 0,
        proxima_acao: currentTicket.proxima_acao,
        proximo_followup_em: currentTicket.proximo_followup_em,
        mrr_em_risco: currentTicket.mrr_em_risco ?? null,
        mrr_recuperado: currentTicket.mrr_recuperado ?? null,
        contato_externo_nome: currentTicket.contato_externo_nome || '',
        oport_valor_previsto_ativacao: currentTicket.oport_valor_previsto_ativacao ?? null,
        oport_valor_previsto_mrr: currentTicket.oport_valor_previsto_mrr ?? null,
        oport_data_prevista: currentTicket.oport_data_prevista || '',
        indicacao_nome: currentTicket.indicacao_nome || '',
        indicacao_contato: currentTicket.indicacao_contato || '',
        indicacao_cidade: currentTicket.indicacao_cidade || '',
        indicacao_status: currentTicket.indicacao_status || null,
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
    if (!currentTicket) return;

    // Oportunidade flow
    if (currentTicket.tipo === 'oportunidade' || (currentTicket.tipo === 'interno_processo' && currentTicket.contato_externo_nome)) {
      if (!fechamentoData.oport_resultado) {
        toast.error('Selecione se foi Ganho ou Perdido');
        return;
      }
      await updateTicket.mutateAsync({
        id: currentTicket.id,
        status: 'concluido',
        concluido_em: new Date().toISOString(),
        oport_resultado: fechamentoData.oport_resultado,
      });
      await addUpdate.mutateAsync({
        conteudo: `Ticket concluído como ${fechamentoData.oport_resultado === 'ganho' ? 'GANHO' : 'PERDIDO'}.${fechamentoData.acao_tomada ? ` Ação: ${fechamentoData.acao_tomada}.` : ''}`,
        tipo: 'registro_acao',
      });
      setShowConcluirDialog(false);
      if (fechamentoData.oport_resultado === 'ganho' && currentTicket.cliente_id) {
        toast.success('Oportunidade ganha! Abra os Movimentos MRR para registrar.', { duration: 5000 });
      }
      return;
    }

    // Risco churn flow — update mrr_recuperado on conclusion
    if (currentTicket.tipo === 'risco_churn' && fechamentoData.mrr_recuperado !== null) {
      // Will be included in the update below
    }

    if (!fechamentoData.acao_tomada || !fechamentoData.resultado) {
      toast.error('Preencha a ação tomada e o resultado'); return;
    }
    if (fechamentoData.continuar_monitorando) {
      if (!fechamentoData.proxima_acao_monitoramento || !fechamentoData.data_monitoramento) { toast.error('Para monitoramento, preencha próxima ação e data'); return; }
      await updateTicket.mutateAsync({
        id: currentTicket.id, status: 'em_monitoramento', proxima_acao: fechamentoData.proxima_acao_monitoramento,
        proximo_followup_em: fechamentoData.data_monitoramento,
        ...(currentTicket.tipo === 'risco_churn' && fechamentoData.mrr_recuperado !== null ? { mrr_recuperado: fechamentoData.mrr_recuperado } : {}),
      });
      await addUpdate.mutateAsync({ conteudo: `Movido para monitoramento. Ação: ${fechamentoData.acao_tomada}. Resultado: ${fechamentoData.resultado}.`, tipo: 'mudanca_status' });
    } else {
      await updateTicket.mutateAsync({
        id: currentTicket.id, status: 'concluido', concluido_em: new Date().toISOString(),
        ...(currentTicket.tipo === 'risco_churn' && fechamentoData.mrr_recuperado !== null ? { mrr_recuperado: fechamentoData.mrr_recuperado } : {}),
      });
      await addUpdate.mutateAsync({ conteudo: `Ticket concluído. Ação: ${fechamentoData.acao_tomada}. Resultado: ${fechamentoData.resultado}.`, tipo: 'registro_acao' });
    }
    setShowConcluirDialog(false);
    setFechamentoData({ acao_tomada: '', resultado: '', satisfacao: '', continuar_monitorando: false, proxima_acao_monitoramento: '', data_monitoramento: '', mrr_recuperado: null, oport_resultado: '' });
  };

  const handleSave = async () => {
    if (!currentTicket) return;
    const changes: string[] = [];
    if (editData.tipo !== currentTicket.tipo) changes.push(`Tipo: ${CS_TICKET_TIPO_LABELS[currentTicket.tipo]} → ${CS_TICKET_TIPO_LABELS[editData.tipo]}`);
    if (editData.status !== currentTicket.status) changes.push(`Status: ${CS_TICKET_STATUS_LABELS[currentTicket.status]} → ${CS_TICKET_STATUS_LABELS[editData.status]}`);
    if (editData.prioridade !== currentTicket.prioridade) changes.push(`Prioridade: ${CS_TICKET_PRIORIDADE_LABELS[currentTicket.prioridade]} → ${CS_TICKET_PRIORIDADE_LABELS[editData.prioridade]}`);

    const editTipo = editData.tipo;
    const isEditOportunidade = editTipo === 'oportunidade' || (editTipo === 'interno_processo' && !!editData.contato_externo_nome);

    await updateTicket.mutateAsync({
      id: currentTicket.id,
      tipo: editData.tipo,
      assunto: editData.assunto,
      descricao_curta: editData.descricao_curta,
      status: editData.status,
      prioridade: editData.prioridade,
      impacto_categoria: editData.impacto_categoria,
      escalado: editData.escalado,
      proxima_acao: editData.proxima_acao,
      proximo_followup_em: editData.proximo_followup_em,
      ...(editData.status === 'concluido' && currentTicket.status !== 'concluido' ? { concluido_em: new Date().toISOString() } : {}),
      // Risco churn fields
      ...(editTipo === 'risco_churn' ? { mrr_em_risco: editData.mrr_em_risco, mrr_recuperado: editData.mrr_recuperado } : {}),
      // Interno/processo contato externo
      ...(editTipo === 'interno_processo' ? { contato_externo_nome: editData.contato_externo_nome || null } : { contato_externo_nome: null }),
      // Oportunidade fields
      ...(isEditOportunidade ? {
        oport_valor_previsto_ativacao: editData.oport_valor_previsto_ativacao,
        oport_valor_previsto_mrr: editData.oport_valor_previsto_mrr,
        oport_data_prevista: editData.oport_data_prevista || null,
      } : {}),
      // Indicação fields
      ...(editTipo === 'indicacao' ? {
        indicacao_nome: editData.indicacao_nome || null,
        indicacao_contato: editData.indicacao_contato || null,
        indicacao_cidade: editData.indicacao_cidade || null,
        indicacao_status: editData.indicacao_status,
      } : {}),
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

  const isOportunidade = currentTicket.tipo === 'oportunidade' || (currentTicket.tipo === 'interno_processo' && !!currentTicket.contato_externo_nome);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{CS_TICKET_TIPO_LABELS[currentTicket.tipo]}</Badge>
            {currentTicket.escalado && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Escalado</Badge>}
            {!currentTicket.primeira_acao_em && <Badge variant="secondary" className="gap-1"><Clock className="h-3 w-3" />Aguardando 1ª ação</Badge>}
            {currentTicket.oport_resultado && <Badge className={currentTicket.oport_resultado === 'ganho' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'}>{currentTicket.oport_resultado === 'ganho' ? 'Ganho' : 'Perdido'}</Badge>}
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
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span className="italic">Ticket Interno</span>
            {currentTicket.contato_externo_nome && <span className="text-foreground font-medium ml-2">— Contato: {currentTicket.contato_externo_nome}</span>}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      {currentTicket.status !== 'concluido' && currentTicket.status !== 'cancelado' && (
      <div className="flex flex-wrap gap-2">
          {!currentTicket.primeira_acao_em && <Button size="sm" onClick={handleRegistrarPrimeiraAcao}><Play className="h-4 w-4 mr-1" />Registrar 1ª Ação</Button>}
          {currentTicket.cliente?.telefone_whatsapp && (
            <Button size="sm" variant="outline" className="text-green-600 border-green-600/30 hover:bg-green-50 dark:hover:bg-green-950" asChild>
              <a
                href={`https://api.whatsapp.com/send?phone=55${currentTicket.cliente.telefone_whatsapp.replace(/\D/g, '')}`}
                target="_top"
                rel="noopener noreferrer"
              >
                <MessageCircle className="h-4 w-4 mr-1" />WhatsApp
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowReassignDialog(true)}><ArrowUpDown className="h-4 w-4 mr-1" />Reatribuir</Button>
          <Button size="sm" variant="default" onClick={() => setShowConcluirDialog(true)}><CheckCircle className="h-4 w-4 mr-1" />Concluir</Button>
          <Button size="sm" variant="destructive" onClick={() => setShowDeleteDialog(true)}><Trash2 className="h-4 w-4 mr-1" />Excluir</Button>
        </div>
      )}

      {/* Ganho — botão para Movimentos MRR */}
      {currentTicket.oport_resultado === 'ganho' && currentTicket.cliente_id && (
        <div className="p-3 border rounded-lg bg-green-500/5 border-green-500/20">
          <p className="text-sm font-medium text-green-700 dark:text-green-400 mb-2">Oportunidade ganha! Registre o movimento financeiro.</p>
          <Button size="sm" variant="outline" onClick={() => navigate(`/clientes/${currentTicket.cliente_id}`)}>
            <ExternalLink className="h-4 w-4 mr-1" />Abrir Movimentos MRR do Cliente
          </Button>
        </div>
      )}

      <Separator />

      {mode === 'edit' ? (
        <div className="space-y-4">
          {/* Tipo + Assunto + Descrição */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={editData.tipo} onValueChange={(v) => setEditData({ ...editData, tipo: v as CSTicketTipo })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_TIPO_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Impacto</Label>
              <Select value={editData.impacto_categoria} onValueChange={(v) => setEditData({ ...editData, impacto_categoria: v as CSTicketImpacto })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CS_TICKET_IMPACTO_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Assunto</Label>
            <Input value={editData.assunto} onChange={(e) => setEditData({ ...editData, assunto: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Descrição Curta</Label>
            <Textarea value={editData.descricao_curta} onChange={(e) => setEditData({ ...editData, descricao_curta: e.target.value })} rows={2} />
          </div>

          <Separator />

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
              <Label>Responsável</Label>
              <Select value={editData.owner_id ? String(editData.owner_id) : ''} onValueChange={(v) => setEditData({ ...editData, owner_id: Number(v) })}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{funcionarios?.map(f => <SelectItem key={f.id} value={String(f.id)}>{f.nome}{f.cargo ? ` (${f.cargo})` : ''}</SelectItem>)}</SelectContent>
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

          {/* MRR fields for risco_churn */}
          {editData.tipo === 'risco_churn' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3 border rounded-lg">
              <div className="space-y-2">
                <Label>MRR em Risco (R$)</Label>
                <NumericInput value={editData.mrr_em_risco} onChange={(v) => setEditData({ ...editData, mrr_em_risco: v })} />
              </div>
              <div className="space-y-2">
                <Label>MRR Recuperado (R$)</Label>
                <NumericInput value={editData.mrr_recuperado} onChange={(v) => setEditData({ ...editData, mrr_recuperado: v })} />
              </div>
            </div>
          )}

          {/* Contato externo para interno_processo */}
          {editData.tipo === 'interno_processo' && (
            <div className="space-y-2">
              <Label>Nome do Contato Externo</Label>
              <Input value={editData.contato_externo_nome} onChange={(e) => setEditData({ ...editData, contato_externo_nome: e.target.value })} placeholder="Nome do contato externo (oportunidade externa)" />
            </div>
          )}

          {/* Oportunidade fields */}
          {(editData.tipo === 'oportunidade' || (editData.tipo === 'interno_processo' && editData.contato_externo_nome)) && (
            <div className="space-y-4 p-3 border rounded-lg">
              <h4 className="font-medium text-sm">Oportunidade de Venda</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Vlr Previsto Ativação (R$)</Label>
                  <NumericInput value={editData.oport_valor_previsto_ativacao} onChange={(v) => setEditData({ ...editData, oport_valor_previsto_ativacao: v })} />
                </div>
                <div className="space-y-2">
                  <Label>Vlr Previsto MRR (R$)</Label>
                  <NumericInput value={editData.oport_valor_previsto_mrr} onChange={(v) => setEditData({ ...editData, oport_valor_previsto_mrr: v })} />
                </div>
                <div className="space-y-2">
                  <Label>Data Prevista</Label>
                  <Input type="date" value={editData.oport_data_prevista} onChange={(e) => setEditData({ ...editData, oport_data_prevista: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          {/* Indicação fields */}
          {editData.tipo === 'indicacao' && (
            <div className="space-y-4 p-3 border rounded-lg">
              <h4 className="font-medium text-sm">Dados da Indicação</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Nome do Indicado</Label>
                  <Input value={editData.indicacao_nome} onChange={(e) => setEditData({ ...editData, indicacao_nome: e.target.value })} placeholder="Nome da empresa/pessoa" />
                </div>
                <div className="space-y-2">
                  <Label>Contato</Label>
                  <Input value={editData.indicacao_contato} onChange={(e) => setEditData({ ...editData, indicacao_contato: e.target.value })} placeholder="Telefone ou email" />
                </div>
                <div className="space-y-2">
                  <Label>Cidade</Label>
                  <Input value={editData.indicacao_cidade} onChange={(e) => setEditData({ ...editData, indicacao_cidade: e.target.value })} placeholder="Cidade" />
                </div>
                <div className="space-y-2">
                  <Label>Status da Indicação</Label>
                  <Select value={editData.indicacao_status || ''} onValueChange={(v) => setEditData({ ...editData, indicacao_status: v as CSIndicacaoStatus })}>
                    <SelectTrigger><SelectValue placeholder="Selecionar status" /></SelectTrigger>
                    <SelectContent>{Object.entries(CS_INDICACAO_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label>{editData.tipo === 'clube_comunidade' ? 'Ação Agendada/Realizada' : 'Próxima Ação'}</Label>
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
          {/* MRR section for risco_churn */}
          {currentTicket.tipo === 'risco_churn' && (currentTicket.mrr_em_risco || currentTicket.mrr_recuperado) && (
            <div className="grid grid-cols-2 gap-4 p-3 border rounded-lg">
              {currentTicket.mrr_em_risco ? <div><Label className="text-muted-foreground text-xs">MRR em Risco</Label><p className="text-lg font-semibold text-destructive">{formatCurrency(currentTicket.mrr_em_risco)}</p></div> : null}
              <div><Label className="text-muted-foreground text-xs">MRR Recuperado</Label><p className="text-lg font-semibold text-primary">{formatCurrency(currentTicket.mrr_recuperado)}</p></div>
            </div>
          )}

          {/* Oportunidade view */}
          {isOportunidade && (
            <div className="p-3 border rounded-lg space-y-2">
              <h4 className="font-medium text-sm">Oportunidade de Venda</h4>
              {currentTicket.contato_externo_nome && <p className="text-sm"><span className="text-muted-foreground">Contato Externo:</span> {currentTicket.contato_externo_nome}</p>}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div><Label className="text-muted-foreground text-xs">Vlr Previsto Ativação</Label><p className="font-semibold">{formatCurrency(currentTicket.oport_valor_previsto_ativacao)}</p></div>
                <div><Label className="text-muted-foreground text-xs">Vlr Previsto MRR</Label><p className="font-semibold">{formatCurrency(currentTicket.oport_valor_previsto_mrr)}</p></div>
                <div><Label className="text-muted-foreground text-xs">Data Prevista</Label><p className="font-semibold">{currentTicket.oport_data_prevista ? format(new Date(currentTicket.oport_data_prevista), 'dd/MM/yyyy') : '-'}</p></div>
              </div>
              {currentTicket.oport_resultado && (
                <Badge className={currentTicket.oport_resultado === 'ganho' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}>
                  {currentTicket.oport_resultado === 'ganho' ? '✓ Ganho' : '✗ Perdido'}
                </Badge>
              )}
            </div>
          )}

          {/* Contato externo (sem oportunidade) */}
          {currentTicket.tipo === 'interno_processo' && currentTicket.contato_externo_nome && !isOportunidade && (
            <div className="p-3 border rounded-lg">
              <Label className="text-muted-foreground text-xs">Contato Externo</Label>
              <p className="font-medium">{currentTicket.contato_externo_nome}</p>
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
          <div className="space-y-1"><Label className="text-muted-foreground text-xs">{currentTicket.tipo === 'clube_comunidade' ? 'Ação Agendada/Realizada' : 'Próxima Ação'}</Label><p className="p-2 bg-muted/50 rounded-md text-sm">{currentTicket.proxima_acao}</p></div>
        </div>
      )}

      {/* Concluir Dialog */}
      <AlertDialog open={showConcluirDialog} onOpenChange={setShowConcluirDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader><AlertDialogTitle>Concluir Ticket</AlertDialogTitle><AlertDialogDescription>Preencha os campos de fechamento.</AlertDialogDescription></AlertDialogHeader>
          <div className="space-y-4 py-4">

            {/* Oportunidade conclusion */}
            {isOportunidade && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Resultado da Oportunidade *</Label>
                  <Select value={fechamentoData.oport_resultado} onValueChange={(v) => setFechamentoData({ ...fechamentoData, oport_resultado: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione o resultado" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ganho">✓ Ganho</SelectItem>
                      <SelectItem value="perdido">✗ Perdido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Observação</Label><Textarea value={fechamentoData.acao_tomada} onChange={(e) => setFechamentoData({ ...fechamentoData, acao_tomada: e.target.value })} placeholder="Detalhes sobre o resultado..." rows={2} /></div>
              </div>
            )}

            {/* Standard conclusion (non-oportunidade) */}
            {!isOportunidade && (
              <>
                {/* MRR Recuperado for risco_churn */}
                {currentTicket.tipo === 'risco_churn' && (
                  <div className="space-y-2">
                    <Label>MRR Recuperado (R$)</Label>
                    <NumericInput value={fechamentoData.mrr_recuperado} onChange={(v) => setFechamentoData({ ...fechamentoData, mrr_recuperado: v })} />
                    {currentTicket.mrr_em_risco && <p className="text-xs text-muted-foreground">MRR em risco: {formatCurrency(currentTicket.mrr_em_risco)}</p>}
                  </div>
                )}
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
              </>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConcluir}>
              {isOportunidade ? (fechamentoData.oport_resultado === 'ganho' ? 'Marcar como Ganho' : fechamentoData.oport_resultado === 'perdido' ? 'Marcar como Perdido' : 'Confirmar') : (fechamentoData.continuar_monitorando ? 'Monitorar' : 'Concluir')}
            </AlertDialogAction>
          </AlertDialogFooter>
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

      {/* Delete Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ticket</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja excluir este ticket? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => { deleteTicket.mutate(currentTicket.id, { onSuccess: () => onClose() }); }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}