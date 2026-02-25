export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      areas_atuacao: {
        Row: {
          id: number
          nome: string
        }
        Insert: {
          id?: number
          nome: string
        }
        Update: {
          id?: number
          nome?: string
        }
        Relationships: []
      }
      certificado_a1_vendas: {
        Row: {
          cliente_id: string
          created_at: string
          data_base_renovacao: string | null
          data_venda: string
          id: string
          motivo_perda: string | null
          observacao: string | null
          status: string
          valor_venda: number | null
          vendedor_id: number | null
        }
        Insert: {
          cliente_id: string
          created_at?: string
          data_base_renovacao?: string | null
          data_venda: string
          id?: string
          motivo_perda?: string | null
          observacao?: string | null
          status?: string
          valor_venda?: number | null
          vendedor_id?: number | null
        }
        Update: {
          cliente_id?: string
          created_at?: string
          data_base_renovacao?: string | null
          data_venda?: string
          id?: string
          motivo_perda?: string | null
          observacao?: string | null
          status?: string
          valor_venda?: number | null
          vendedor_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "certificado_a1_vendas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificado_a1_vendas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "certificado_a1_vendas_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      cidades: {
        Row: {
          codigo_ibge: string | null
          estado_id: number
          id: number
          nome: string
        }
        Insert: {
          codigo_ibge?: string | null
          estado_id: number
          id?: number
          nome: string
        }
        Update: {
          codigo_ibge?: string | null
          estado_id?: number
          id?: number
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "cidades_estado_id_fkey"
            columns: ["estado_id"]
            isOneToOne: false
            referencedRelation: "estados"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_contatos: {
        Row: {
          aniversario: string | null
          cargo: string | null
          cliente_id: string
          cpf: string | null
          created_at: string
          email: string | null
          fone: string | null
          id: string
          nome: string
          observacao: string | null
        }
        Insert: {
          aniversario?: string | null
          cargo?: string | null
          cliente_id: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          fone?: string | null
          id?: string
          nome: string
          observacao?: string | null
        }
        Update: {
          aniversario?: string | null
          cargo?: string | null
          cliente_id?: string
          cpf?: string | null
          created_at?: string
          email?: string | null
          fone?: string | null
          id?: string
          nome?: string
          observacao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_contatos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          area_atuacao_id: number | null
          bairro: string | null
          cancelado: boolean
          cep: string | null
          cert_a1_ultima_venda_em: string | null
          cert_a1_ultimo_vendedor_id: number | null
          cert_a1_vencimento: string | null
          cidade_id: number | null
          cnpj: string | null
          codigo_fornecedor: string | null
          codigo_sequencial: number
          contato_aniversario: string | null
          contato_cpf: string | null
          contato_fone: string | null
          contato_nome: string | null
          created_at: string
          custo_fixo_percentual: number | null
          custo_operacao: number | null
          data_ativacao: string | null
          data_cadastro: string | null
          data_cancelamento: string | null
          data_venda: string | null
          email: string | null
          endereco: string | null
          estado_id: number | null
          forma_pagamento_ativacao_id: number | null
          forma_pagamento_mensalidade_id: number | null
          fornecedor_id: number | null
          funcionario_id: number | null
          id: string
          imposto_percentual: number | null
          link_portal_fornecedor: string | null
          matriz_id: string | null
          mensalidade: number | null
          modelo_contrato_id: number | null
          motivo_cancelamento_id: number | null
          nome_fantasia: string | null
          numero: string | null
          observacao_cancelamento: string | null
          observacao_cliente: string | null
          observacao_negociacao: string | null
          origem_venda_id: number | null
          produto_id: number | null
          razao_social: string | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id: number | null
          telefone_contato: string | null
          telefone_whatsapp: string | null
          unidade_base_id: number | null
          updated_at: string
          valor_ativacao: number | null
        }
        Insert: {
          area_atuacao_id?: number | null
          bairro?: string | null
          cancelado?: boolean
          cep?: string | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: number | null
          cert_a1_vencimento?: string | null
          cidade_id?: number | null
          cnpj?: string | null
          codigo_fornecedor?: string | null
          codigo_sequencial?: number
          contato_aniversario?: string | null
          contato_cpf?: string | null
          contato_fone?: string | null
          contato_nome?: string | null
          created_at?: string
          custo_fixo_percentual?: number | null
          custo_operacao?: number | null
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          endereco?: string | null
          estado_id?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
          funcionario_id?: number | null
          id?: string
          imposto_percentual?: number | null
          link_portal_fornecedor?: string | null
          matriz_id?: string | null
          mensalidade?: number | null
          modelo_contrato_id?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          numero?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda_id?: number | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          unidade_base_id?: number | null
          updated_at?: string
          valor_ativacao?: number | null
        }
        Update: {
          area_atuacao_id?: number | null
          bairro?: string | null
          cancelado?: boolean
          cep?: string | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: number | null
          cert_a1_vencimento?: string | null
          cidade_id?: number | null
          cnpj?: string | null
          codigo_fornecedor?: string | null
          codigo_sequencial?: number
          contato_aniversario?: string | null
          contato_cpf?: string | null
          contato_fone?: string | null
          contato_nome?: string | null
          created_at?: string
          custo_fixo_percentual?: number | null
          custo_operacao?: number | null
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          endereco?: string | null
          estado_id?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
          funcionario_id?: number | null
          id?: string
          imposto_percentual?: number | null
          link_portal_fornecedor?: string | null
          matriz_id?: string | null
          mensalidade?: number | null
          modelo_contrato_id?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          numero?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda_id?: number | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          unidade_base_id?: number | null
          updated_at?: string
          valor_ativacao?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_area_atuacao_id_fkey"
            columns: ["area_atuacao_id"]
            isOneToOne: false
            referencedRelation: "areas_atuacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_cert_a1_ultimo_vendedor_id_fkey"
            columns: ["cert_a1_ultimo_vendedor_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_cidade_id_fkey"
            columns: ["cidade_id"]
            isOneToOne: false
            referencedRelation: "cidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_estado_id_fkey"
            columns: ["estado_id"]
            isOneToOne: false
            referencedRelation: "estados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_forma_pagamento_ativacao_id_fkey"
            columns: ["forma_pagamento_ativacao_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_forma_pagamento_mensalidade_id_fkey"
            columns: ["forma_pagamento_mensalidade_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_matriz_id_fkey"
            columns: ["matriz_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_matriz_id_fkey"
            columns: ["matriz_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_motivo_cancelamento_id_fkey"
            columns: ["motivo_cancelamento_id"]
            isOneToOne: false
            referencedRelation: "motivos_cancelamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_origem_venda_id_fkey"
            columns: ["origem_venda_id"]
            isOneToOne: false
            referencedRelation: "origens_venda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "segmentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vertical_id_fkey"
            columns: ["modelo_contrato_id"]
            isOneToOne: false
            referencedRelation: "modelos_contrato"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes_old_import: {
        Row: {
          area_atuacao: string | null
          area_atuacao_id: string | null
          cert_a1_ultima_venda_em: string | null
          cert_a1_ultimo_vendedor_id: string | null
          cert_a1_vencimento: string | null
          cidade: string | null
          cidade_id: string | null
          cliente_codigo: string | null
          cnpj: string | null
          consultor: string | null
          consultor_id: string | null
          criado_em: string | null
          cs_owner_uid: string | null
          custo: number | null
          data_ativacao: string | null
          data_cadastro: string | null
          data_cancelamento: string | null
          data_fim: string | null
          data_venda: string | null
          email: string | null
          estado: string | null
          fone: string | null
          fornecedor: string | null
          fornecedor_id: string | null
          id: string | null
          id_cliente: number | null
          imposto_percentual: number | null
          imposto_valor: number | null
          link_fornecedor: string | null
          lucro_bruto: number | null
          lucro_real: number | null
          margem: number | null
          markup: number | null
          matriz_codigo: string | null
          matriz_id: string | null
          mensalidade: number | null
          motivo_cancelamento: string | null
          motivo_cancelamento_id: string | null
          nome_fantasia: string | null
          obs_cliente: string | null
          obs_motivo_cancelamento: string | null
          obs_negociacao: string | null
          origem_venda: string | null
          origem_venda_id: string | null
          produto: string | null
          produto_id: string | null
          razao_social: string | null
          recorrencia: string | null
          repasse: number | null
          segmento: string | null
          status: string | null
          status_contrato: string | null
          tempo_permanencia_meses: number | null
          unidade_base: string | null
          updated_at: string | null
          valor_ativacao: number | null
          vertical: string | null
        }
        Insert: {
          area_atuacao?: string | null
          area_atuacao_id?: string | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: string | null
          cert_a1_vencimento?: string | null
          cidade?: string | null
          cidade_id?: string | null
          cliente_codigo?: string | null
          cnpj?: string | null
          consultor?: string | null
          consultor_id?: string | null
          criado_em?: string | null
          cs_owner_uid?: string | null
          custo?: number | null
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_fim?: string | null
          data_venda?: string | null
          email?: string | null
          estado?: string | null
          fone?: string | null
          fornecedor?: string | null
          fornecedor_id?: string | null
          id?: string | null
          id_cliente?: number | null
          imposto_percentual?: number | null
          imposto_valor?: number | null
          link_fornecedor?: string | null
          lucro_bruto?: number | null
          lucro_real?: number | null
          margem?: number | null
          markup?: number | null
          matriz_codigo?: string | null
          matriz_id?: string | null
          mensalidade?: number | null
          motivo_cancelamento?: string | null
          motivo_cancelamento_id?: string | null
          nome_fantasia?: string | null
          obs_cliente?: string | null
          obs_motivo_cancelamento?: string | null
          obs_negociacao?: string | null
          origem_venda?: string | null
          origem_venda_id?: string | null
          produto?: string | null
          produto_id?: string | null
          razao_social?: string | null
          recorrencia?: string | null
          repasse?: number | null
          segmento?: string | null
          status?: string | null
          status_contrato?: string | null
          tempo_permanencia_meses?: number | null
          unidade_base?: string | null
          updated_at?: string | null
          valor_ativacao?: number | null
          vertical?: string | null
        }
        Update: {
          area_atuacao?: string | null
          area_atuacao_id?: string | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: string | null
          cert_a1_vencimento?: string | null
          cidade?: string | null
          cidade_id?: string | null
          cliente_codigo?: string | null
          cnpj?: string | null
          consultor?: string | null
          consultor_id?: string | null
          criado_em?: string | null
          cs_owner_uid?: string | null
          custo?: number | null
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_fim?: string | null
          data_venda?: string | null
          email?: string | null
          estado?: string | null
          fone?: string | null
          fornecedor?: string | null
          fornecedor_id?: string | null
          id?: string | null
          id_cliente?: number | null
          imposto_percentual?: number | null
          imposto_valor?: number | null
          link_fornecedor?: string | null
          lucro_bruto?: number | null
          lucro_real?: number | null
          margem?: number | null
          markup?: number | null
          matriz_codigo?: string | null
          matriz_id?: string | null
          mensalidade?: number | null
          motivo_cancelamento?: string | null
          motivo_cancelamento_id?: string | null
          nome_fantasia?: string | null
          obs_cliente?: string | null
          obs_motivo_cancelamento?: string | null
          obs_negociacao?: string | null
          origem_venda?: string | null
          origem_venda_id?: string | null
          produto?: string | null
          produto_id?: string | null
          razao_social?: string | null
          recorrencia?: string | null
          repasse?: number | null
          segmento?: string | null
          status?: string | null
          status_contrato?: string | null
          tempo_permanencia_meses?: number | null
          unidade_base?: string | null
          updated_at?: string | null
          valor_ativacao?: number | null
          vertical?: string | null
        }
        Relationships: []
      }
      configuracoes: {
        Row: {
          created_at: string
          custo_fixo_percentual: number
          id: number
          imposto_percentual: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          custo_fixo_percentual?: number
          id?: number
          imposto_percentual?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          custo_fixo_percentual?: number
          id?: number
          imposto_percentual?: number
          updated_at?: string
        }
        Relationships: []
      }
      cs_ticket_reassignments: {
        Row: {
          criado_em: string
          de_id: number | null
          id: string
          motivo: string | null
          para_id: number
          reatribuido_por_id: number | null
          ticket_id: string
        }
        Insert: {
          criado_em?: string
          de_id?: number | null
          id?: string
          motivo?: string | null
          para_id: number
          reatribuido_por_id?: number | null
          ticket_id: string
        }
        Update: {
          criado_em?: string
          de_id?: number | null
          id?: string
          motivo?: string | null
          para_id?: number
          reatribuido_por_id?: number | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cs_ticket_reassignments_de_id_fkey"
            columns: ["de_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_ticket_reassignments_para_id_fkey"
            columns: ["para_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_ticket_reassignments_reatribuido_por_id_fkey"
            columns: ["reatribuido_por_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_ticket_reassignments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "cs_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_ticket_updates: {
        Row: {
          conteudo: string
          criado_em: string
          criado_por_id: number | null
          id: string
          privado: boolean
          ticket_id: string
          tipo: Database["public"]["Enums"]["cs_update_tipo"]
        }
        Insert: {
          conteudo?: string
          criado_em?: string
          criado_por_id?: number | null
          id?: string
          privado?: boolean
          ticket_id: string
          tipo?: Database["public"]["Enums"]["cs_update_tipo"]
        }
        Update: {
          conteudo?: string
          criado_em?: string
          criado_por_id?: number | null
          id?: string
          privado?: boolean
          ticket_id?: string
          tipo?: Database["public"]["Enums"]["cs_update_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "cs_ticket_updates_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_ticket_updates_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "cs_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_tickets: {
        Row: {
          assunto: string
          atualizado_em: string
          cliente_id: string | null
          concluido_em: string | null
          criado_em: string
          criado_por_id: number | null
          descricao_curta: string
          escalado: boolean
          id: string
          impacto_categoria:
            | Database["public"]["Enums"]["cs_ticket_impacto"]
            | null
          indicacao_cidade: string | null
          indicacao_contato: string | null
          indicacao_nome: string | null
          indicacao_status:
            | Database["public"]["Enums"]["cs_indicacao_status"]
            | null
          mrr_em_risco: number | null
          mrr_recuperado: number | null
          owner_id: number | null
          primeira_acao_em: string | null
          prioridade: Database["public"]["Enums"]["cs_ticket_prioridade"]
          prob_churn_percent: number | null
          prob_sucesso_percent: number | null
          proxima_acao: string | null
          proximo_followup_em: string | null
          sla_conclusao_ate: string | null
          sla_primeira_acao_ate: string | null
          status: Database["public"]["Enums"]["cs_ticket_status"]
          tipo: Database["public"]["Enums"]["cs_ticket_tipo"]
        }
        Insert: {
          assunto: string
          atualizado_em?: string
          cliente_id?: string | null
          concluido_em?: string | null
          criado_em?: string
          criado_por_id?: number | null
          descricao_curta?: string
          escalado?: boolean
          id?: string
          impacto_categoria?:
            | Database["public"]["Enums"]["cs_ticket_impacto"]
            | null
          indicacao_cidade?: string | null
          indicacao_contato?: string | null
          indicacao_nome?: string | null
          indicacao_status?:
            | Database["public"]["Enums"]["cs_indicacao_status"]
            | null
          mrr_em_risco?: number | null
          mrr_recuperado?: number | null
          owner_id?: number | null
          primeira_acao_em?: string | null
          prioridade?: Database["public"]["Enums"]["cs_ticket_prioridade"]
          prob_churn_percent?: number | null
          prob_sucesso_percent?: number | null
          proxima_acao?: string | null
          proximo_followup_em?: string | null
          sla_conclusao_ate?: string | null
          sla_primeira_acao_ate?: string | null
          status?: Database["public"]["Enums"]["cs_ticket_status"]
          tipo: Database["public"]["Enums"]["cs_ticket_tipo"]
        }
        Update: {
          assunto?: string
          atualizado_em?: string
          cliente_id?: string | null
          concluido_em?: string | null
          criado_em?: string
          criado_por_id?: number | null
          descricao_curta?: string
          escalado?: boolean
          id?: string
          impacto_categoria?:
            | Database["public"]["Enums"]["cs_ticket_impacto"]
            | null
          indicacao_cidade?: string | null
          indicacao_contato?: string | null
          indicacao_nome?: string | null
          indicacao_status?:
            | Database["public"]["Enums"]["cs_indicacao_status"]
            | null
          mrr_em_risco?: number | null
          mrr_recuperado?: number | null
          owner_id?: number | null
          primeira_acao_em?: string | null
          prioridade?: Database["public"]["Enums"]["cs_ticket_prioridade"]
          prob_churn_percent?: number | null
          prob_sucesso_percent?: number | null
          proxima_acao?: string | null
          proximo_followup_em?: string | null
          sla_conclusao_ate?: string | null
          sla_primeira_acao_ate?: string | null
          status?: Database["public"]["Enums"]["cs_ticket_status"]
          tipo?: Database["public"]["Enums"]["cs_ticket_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "cs_tickets_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_tickets_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_tickets_criado_por_id_fkey"
            columns: ["criado_por_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cs_tickets_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      estados: {
        Row: {
          codigo_ibge: string | null
          id: number
          nome: string
          sigla: string
        }
        Insert: {
          codigo_ibge?: string | null
          id?: number
          nome: string
          sigla: string
        }
        Update: {
          codigo_ibge?: string | null
          id?: number
          nome?: string
          sigla?: string
        }
        Relationships: []
      }
      formas_pagamento: {
        Row: {
          id: number
          nome: string
        }
        Insert: {
          id?: number
          nome: string
        }
        Update: {
          id?: number
          nome?: string
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          id: number
          nome: string
          site: string | null
        }
        Insert: {
          id?: number
          nome: string
          site?: string | null
        }
        Update: {
          id?: number
          nome?: string
          site?: string | null
        }
        Relationships: []
      }
      funcionarios: {
        Row: {
          ativo: boolean
          cargo: string | null
          email: string | null
          id: number
          nome: string
        }
        Insert: {
          ativo?: boolean
          cargo?: string | null
          email?: string | null
          id?: number
          nome: string
        }
        Update: {
          ativo?: boolean
          cargo?: string | null
          email?: string | null
          id?: number
          nome?: string
        }
        Relationships: []
      }
      modelos_contrato: {
        Row: {
          id: number
          nome: string
        }
        Insert: {
          id?: number
          nome: string
        }
        Update: {
          id?: number
          nome?: string
        }
        Relationships: []
      }
      motivos_cancelamento: {
        Row: {
          descricao: string
          id: number
        }
        Insert: {
          descricao: string
          id?: number
        }
        Update: {
          descricao?: string
          id?: number
        }
        Relationships: []
      }
      movimentos_mrr: {
        Row: {
          cliente_id: string
          criado_em: string
          custo_delta: number
          data_movimento: string
          descricao: string | null
          estornado_por: string | null
          estorno_de: string | null
          funcionario_id: number | null
          id: string
          inativado_em: string | null
          inativado_por_id: number | null
          origem_venda: string | null
          status: string
          tipo: Database["public"]["Enums"]["movimento_mrr_tipo"]
          valor_delta: number
          valor_venda_avulsa: number | null
        }
        Insert: {
          cliente_id: string
          criado_em?: string
          custo_delta?: number
          data_movimento: string
          descricao?: string | null
          estornado_por?: string | null
          estorno_de?: string | null
          funcionario_id?: number | null
          id?: string
          inativado_em?: string | null
          inativado_por_id?: number | null
          origem_venda?: string | null
          status?: string
          tipo: Database["public"]["Enums"]["movimento_mrr_tipo"]
          valor_delta?: number
          valor_venda_avulsa?: number | null
        }
        Update: {
          cliente_id?: string
          criado_em?: string
          custo_delta?: number
          data_movimento?: string
          descricao?: string | null
          estornado_por?: string | null
          estorno_de?: string | null
          funcionario_id?: number | null
          id?: string
          inativado_em?: string | null
          inativado_por_id?: number | null
          origem_venda?: string | null
          status?: string
          tipo?: Database["public"]["Enums"]["movimento_mrr_tipo"]
          valor_delta?: number
          valor_venda_avulsa?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "movimentos_mrr_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentos_mrr_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentos_mrr_estornado_por_fkey"
            columns: ["estornado_por"]
            isOneToOne: false
            referencedRelation: "movimentos_mrr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentos_mrr_estorno_de_fkey"
            columns: ["estorno_de"]
            isOneToOne: false
            referencedRelation: "movimentos_mrr"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentos_mrr_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentos_mrr_inativado_por_id_fkey"
            columns: ["inativado_por_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      origens_venda: {
        Row: {
          id: number
          nome: string
        }
        Insert: {
          id?: number
          nome: string
        }
        Update: {
          id?: number
          nome?: string
        }
        Relationships: []
      }
      produtos: {
        Row: {
          id: number
          nome: string
        }
        Insert: {
          id?: number
          nome: string
        }
        Update: {
          id?: number
          nome?: string
        }
        Relationships: []
      }
      segmentos: {
        Row: {
          id: number
          nome: string
        }
        Insert: {
          id?: number
          nome: string
        }
        Update: {
          id?: number
          nome?: string
        }
        Relationships: []
      }
      unidades_base: {
        Row: {
          id: number
          nome: string
        }
        Insert: {
          id?: number
          nome: string
        }
        Update: {
          id?: number
          nome?: string
        }
        Relationships: []
      }
    }
    Views: {
      vw_clientes_financeiro: {
        Row: {
          area_atuacao_id: number | null
          cancelado: boolean | null
          cert_a1_ultima_venda_em: string | null
          cert_a1_ultimo_vendedor_id: number | null
          cert_a1_vencimento: string | null
          cidade_id: number | null
          cnpj: string | null
          codigo_sequencial: number | null
          created_at: string | null
          custo_fixo_percentual: number | null
          custo_operacao: number | null
          data_cadastro: string | null
          data_cancelamento: string | null
          data_venda: string | null
          email: string | null
          estado_id: number | null
          fator_preco_cogs_x: number | null
          fixos_rs: number | null
          forma_pagamento_ativacao_id: number | null
          forma_pagamento_mensalidade_id: number | null
          funcionario_id: number | null
          id: string | null
          imposto_percentual: number | null
          impostos_rs: number | null
          lucro_bruto: number | null
          lucro_real: number | null
          margem_bruta_percent: number | null
          margem_contribuicao: number | null
          markup_cogs_percent: number | null
          mensalidade: number | null
          modelo_contrato_id: number | null
          motivo_cancelamento_id: number | null
          nome_fantasia: string | null
          observacao_cancelamento: string | null
          observacao_cliente: string | null
          observacao_negociacao: string | null
          origem_venda_id: number | null
          produto_id: number | null
          razao_social: string | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id: number | null
          telefone_contato: string | null
          telefone_whatsapp: string | null
          unidade_base_id: number | null
          updated_at: string | null
          valor_ativacao: number | null
          valor_repasse: number | null
        }
        Insert: {
          area_atuacao_id?: number | null
          cancelado?: boolean | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: number | null
          cert_a1_vencimento?: string | null
          cidade_id?: number | null
          cnpj?: string | null
          codigo_sequencial?: number | null
          created_at?: string | null
          custo_fixo_percentual?: number | null
          custo_operacao?: number | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          estado_id?: number | null
          fator_preco_cogs_x?: never
          fixos_rs?: never
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          funcionario_id?: number | null
          id?: string | null
          imposto_percentual?: number | null
          impostos_rs?: never
          lucro_bruto?: never
          lucro_real?: never
          margem_bruta_percent?: never
          margem_contribuicao?: never
          markup_cogs_percent?: never
          mensalidade?: number | null
          modelo_contrato_id?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda_id?: number | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          unidade_base_id?: number | null
          updated_at?: string | null
          valor_ativacao?: number | null
          valor_repasse?: never
        }
        Update: {
          area_atuacao_id?: number | null
          cancelado?: boolean | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: number | null
          cert_a1_vencimento?: string | null
          cidade_id?: number | null
          cnpj?: string | null
          codigo_sequencial?: number | null
          created_at?: string | null
          custo_fixo_percentual?: number | null
          custo_operacao?: number | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          estado_id?: number | null
          fator_preco_cogs_x?: never
          fixos_rs?: never
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          funcionario_id?: number | null
          id?: string | null
          imposto_percentual?: number | null
          impostos_rs?: never
          lucro_bruto?: never
          lucro_real?: never
          margem_bruta_percent?: never
          margem_contribuicao?: never
          markup_cogs_percent?: never
          mensalidade?: number | null
          modelo_contrato_id?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda_id?: number | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          unidade_base_id?: number | null
          updated_at?: string | null
          valor_ativacao?: number | null
          valor_repasse?: never
        }
        Relationships: [
          {
            foreignKeyName: "clientes_area_atuacao_id_fkey"
            columns: ["area_atuacao_id"]
            isOneToOne: false
            referencedRelation: "areas_atuacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_cert_a1_ultimo_vendedor_id_fkey"
            columns: ["cert_a1_ultimo_vendedor_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_cidade_id_fkey"
            columns: ["cidade_id"]
            isOneToOne: false
            referencedRelation: "cidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_estado_id_fkey"
            columns: ["estado_id"]
            isOneToOne: false
            referencedRelation: "estados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_forma_pagamento_ativacao_id_fkey"
            columns: ["forma_pagamento_ativacao_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_forma_pagamento_mensalidade_id_fkey"
            columns: ["forma_pagamento_mensalidade_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_motivo_cancelamento_id_fkey"
            columns: ["motivo_cancelamento_id"]
            isOneToOne: false
            referencedRelation: "motivos_cancelamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_origem_venda_id_fkey"
            columns: ["origem_venda_id"]
            isOneToOne: false
            referencedRelation: "origens_venda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_segmento_id_fkey"
            columns: ["segmento_id"]
            isOneToOne: false
            referencedRelation: "segmentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_vertical_id_fkey"
            columns: ["modelo_contrato_id"]
            isOneToOne: false
            referencedRelation: "modelos_contrato"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      cs_indicacao_status:
        | "recebida"
        | "contatada"
        | "qualificada"
        | "enviada_ao_comercial"
        | "fechou"
        | "nao_fechou"
      cs_ticket_impacto: "risco" | "expansao" | "relacionamento" | "processo"
      cs_ticket_prioridade: "baixa" | "media" | "alta" | "urgente"
      cs_ticket_status:
        | "aberto"
        | "em_andamento"
        | "aguardando_cliente"
        | "aguardando_interno"
        | "em_monitoramento"
        | "concluido"
        | "cancelado"
      cs_ticket_tipo:
        | "relacionamento_90d"
        | "risco_churn"
        | "adocao_engajamento"
        | "indicacao"
        | "oportunidade"
        | "clube_comunidade"
        | "interno_processo"
      cs_update_tipo:
        | "comentario"
        | "mudanca_status"
        | "mudanca_prioridade"
        | "mudanca_owner"
        | "nota_ia"
        | "registro_acao"
      movimento_mrr_tipo: "upsell" | "cross_sell" | "downsell" | "venda_avulsa"
      recorrencia_tipo: "mensal" | "anual" | "semestral" | "semanal"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      cs_indicacao_status: [
        "recebida",
        "contatada",
        "qualificada",
        "enviada_ao_comercial",
        "fechou",
        "nao_fechou",
      ],
      cs_ticket_impacto: ["risco", "expansao", "relacionamento", "processo"],
      cs_ticket_prioridade: ["baixa", "media", "alta", "urgente"],
      cs_ticket_status: [
        "aberto",
        "em_andamento",
        "aguardando_cliente",
        "aguardando_interno",
        "em_monitoramento",
        "concluido",
        "cancelado",
      ],
      cs_ticket_tipo: [
        "relacionamento_90d",
        "risco_churn",
        "adocao_engajamento",
        "indicacao",
        "oportunidade",
        "clube_comunidade",
        "interno_processo",
      ],
      cs_update_tipo: [
        "comentario",
        "mudanca_status",
        "mudanca_prioridade",
        "mudanca_owner",
        "nota_ia",
        "registro_acao",
      ],
      movimento_mrr_tipo: ["upsell", "cross_sell", "downsell", "venda_avulsa"],
      recorrencia_tipo: ["mensal", "anual", "semestral", "semanal"],
    },
  },
} as const
