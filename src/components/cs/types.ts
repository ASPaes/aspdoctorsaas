// Types para o módulo CS - Adaptado para usar funcionarios

export type CSTicketTipo =
  | 'relacionamento_90d'
  | 'risco_churn'
  | 'adocao_engajamento'
  | 'indicacao'
  | 'oportunidade'
  | 'clube_comunidade'
  | 'interno_processo';

export type CSTicketStatus =
  | 'aberto'
  | 'em_andamento'
  | 'aguardando_cliente'
  | 'aguardando_interno'
  | 'em_monitoramento'
  | 'concluido'
  | 'cancelado';

export type CSTicketPrioridade = 'baixa' | 'media' | 'alta' | 'urgente';

export type CSTicketImpacto = 'risco' | 'expansao' | 'relacionamento' | 'processo';

export type CSIndicacaoStatus =
  | 'recebida'
  | 'contatada'
  | 'qualificada'
  | 'enviada_ao_comercial'
  | 'fechou'
  | 'nao_fechou';

export type CSUpdateTipo =
  | 'comentario'
  | 'mudanca_status'
  | 'mudanca_prioridade'
  | 'mudanca_owner'
  | 'nota_ia'
  | 'registro_acao';

// Funcionario (substitui CSMember)
export interface Funcionario {
  id: number;
  nome: string;
  cargo: string | null;
  ativo: boolean;
  email: string | null;
}

export interface CSTicket {
  id: string;
  cliente_id: string | null;
  tipo: CSTicketTipo;
  assunto: string;
  descricao_curta: string;
  prioridade: CSTicketPrioridade;
  status: CSTicketStatus;
  escalado: boolean;
  owner_id: number | null;
  criado_por_id: number | null;
  proxima_acao: string;
  proximo_followup_em: string;
  impacto_categoria: CSTicketImpacto;
  mrr_em_risco: number | null;
  mrr_recuperado: number | null;
  prob_churn_percent: number | null;
  prob_sucesso_percent: number | null;
  sla_primeira_acao_ate: string | null;
  sla_conclusao_ate: string | null;
  primeira_acao_em: string | null;
  concluido_em: string | null;
  indicacao_nome: string | null;
  indicacao_contato: string | null;
  indicacao_cidade: string | null;
  indicacao_status: CSIndicacaoStatus | null;
  contato_externo_nome: string | null;
  oport_valor_previsto_ativacao: number | null;
  oport_valor_previsto_mrr: number | null;
  oport_data_prevista: string | null;
  oport_resultado: string | null;
  criado_em: string;
  atualizado_em: string;
  // Joined fields
  cliente?: {
    id: string;
    razao_social: string;
    nome_fantasia: string | null;
    mensalidade: number | null;
    cancelado: boolean;
  } | null;
  owner?: Funcionario | null;
  criado_por?: Funcionario | null;
}

export interface CSTicketUpdate {
  id: string;
  ticket_id: string;
  tipo: CSUpdateTipo;
  conteudo: string;
  privado: boolean;
  criado_por_id: number | null;
  criado_em: string;
  criado_por?: Funcionario | null;
}

export interface CSTicketReassignment {
  id: string;
  ticket_id: string;
  de_id: number | null;
  para_id: number;
  motivo: string | null;
  reatribuido_por_id: number | null;
  criado_em: string;
  de?: Funcionario | null;
  para?: Funcionario | null;
  reatribuido_por?: Funcionario | null;
}

// Labels
export const CS_TICKET_TIPO_LABELS: Record<CSTicketTipo, string> = {
  relacionamento_90d: 'Relacionamento 90D',
  risco_churn: 'Risco de Churn',
  adocao_engajamento: 'Adoção / Engajamento',
  indicacao: 'Indicação',
  oportunidade: 'Oportunidade',
  clube_comunidade: 'Clube / Comunidade',
  interno_processo: 'Interno / Processo',
};

export const CS_TICKET_STATUS_LABELS: Record<CSTicketStatus, string> = {
  aberto: 'Aberto',
  em_andamento: 'Em Andamento',
  aguardando_cliente: 'Aguardando Cliente',
  aguardando_interno: 'Aguardando Interno',
  em_monitoramento: 'Em Monitoramento',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
};

export const CS_TICKET_PRIORIDADE_LABELS: Record<CSTicketPrioridade, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  urgente: 'Urgente',
};

export const CS_TICKET_IMPACTO_LABELS: Record<CSTicketImpacto, string> = {
  risco: 'Risco',
  expansao: 'Expansão',
  relacionamento: 'Relacionamento',
  processo: 'Processo',
};

export const CS_INDICACAO_STATUS_LABELS: Record<CSIndicacaoStatus, string> = {
  recebida: 'Recebida',
  contatada: 'Contatada',
  qualificada: 'Qualificada',
  enviada_ao_comercial: 'Enviada ao Comercial',
  fechou: 'Fechou',
  nao_fechou: 'Não Fechou',
};

export const CS_UPDATE_TIPO_LABELS: Record<CSUpdateTipo, string> = {
  comentario: 'Comentário',
  mudanca_status: 'Mudança de Status',
  mudanca_prioridade: 'Mudança de Prioridade',
  mudanca_owner: 'Mudança de Owner',
  nota_ia: 'Nota IA',
  registro_acao: 'Registro de Ação',
};
