// Equipe DS: chat interno entre colaboradores.
// As tabelas ainda não estão no types.ts gerado; os formatos vêm das RPCs
// equipe_* (migration 20260929153000_equipe_chat_interno.sql).

export type TipoCanal = "geral" | "setor" | "canal" | "dm" | "grupo";

/** Linha de `equipe_minhas_conversas`: o que aparece na lista lateral. */
export interface Conversa {
  id: string;
  tipo: TipoCanal;
  nome: string | null;
  descricao: string | null;
  privado: boolean;
  department_id: string | null;
  arquivado: boolean;
  ultima_mensagem_em: string | null;
  previa: string | null;
  previa_autor: string | null;
  nao_lidas: number;
  mencoes: number;
  silenciado: boolean;
  /** dm/grupo: os outros participantes (sem mim). */
  outros: string[];
}

/** Linha de `equipe_pessoas`: colega com presença real. */
export interface Pessoa {
  user_id: string;
  nome: string;
  cargo: string | null;
  role: string;
  department_id: string | null;
  setor: string | null;
  /** `support_agent_presence.status` */
  presenca: "active" | "paused" | "offline";
  pausa: string | null;
  pausa_fim: string | null;
  atendimentos: number;
  ultimo_sinal: string | null;
}

export interface Mensagem {
  id: string;
  tenant_id: string;
  canal_id: string;
  autor_id: string | null;
  parent_id: string | null;
  tipo: "texto" | "sistema";
  corpo: string;
  anexos: Anexo[];
  refs: Ref[];
  mencoes: string[];
  menciona_todos: boolean;
  /** {"👍": ["<user_id>", ...]} */
  reacoes: Record<string, string[]>;
  respostas: number;
  ultima_resposta_em: string | null;
  respondentes: string[];
  editada_em: string | null;
  apagada_em: string | null;
  apagada_por: string | null;
  fixada_em: string | null;
  fixada_por: string | null;
  created_at: string;
  /** Só no cliente: mensagem otimista ainda sem confirmação do banco. */
  _pendente?: boolean;
  _falhou?: boolean;
}

/** Canal visível que eu ainda não participo (Procurar canais). */
export interface CanalAberto {
  id: string;
  tipo: TipoCanal;
  nome: string;
  descricao: string | null;
  privado: boolean;
  department_id: string | null;
}

/** Linha de `equipe_meus_fios`. */
export interface Fio {
  raiz_id: string;
  canal_id: string;
  canal_tipo: TipoCanal;
  canal_nome: string | null;
  canal_outros: string[];
  autor_id: string | null;
  corpo: string;
  apagada: boolean;
  created_at: string;
  respostas: number;
  ultima_resposta_em: string | null;
  respondentes: string[];
  nao_lidas: number;
  mencoes: number;
}

/** Mensagem achada na busca ou salva: sempre com o canal dela. */
export interface MensagemComCanal {
  id: string;
  canal_id: string;
  parent_id: string | null;
  autor_id: string | null;
  corpo: string;
  created_at: string;
  apagada?: boolean;
  salvo_em?: string;
  canal_tipo: TipoCanal;
  canal_nome: string | null;
  canal_outros: string[];
}

/** Anexo vivo de uma mensagem. O conteúdo é lido na hora, com a permissão de quem vê. */
export type TipoRef = "ticket" | "cliente" | "atendimento";
export interface Ref { tipo: TipoRef; id: string }

/** Linha de `equipe_cartoes`. `dados` muda de forma conforme o tipo. */
export interface Cartao { tipo: TipoRef; id: string; dados: Record<string, any> }

/** Arquivo anexado. Mora no bucket privado `equipe-anexos`; o link vem da edge function. */
export interface Anexo {
  path: string;
  nome: string;
  mime: string;
  tamanho: number;
  largura?: number;
  altura?: number;
}
