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
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      assignment_rules: {
        Row: {
          created_at: string
          fixed_agent_id: string | null
          id: string
          instance_id: string
          is_active: boolean
          name: string
          round_robin_agents: string[] | null
          round_robin_last_index: number
          rule_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fixed_agent_id?: string | null
          id?: string
          instance_id: string
          is_active?: boolean
          name: string
          round_robin_agents?: string[] | null
          round_robin_last_index?: number
          rule_type?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fixed_agent_id?: string | null
          id?: string
          instance_id?: string
          is_active?: boolean
          name?: string
          round_robin_agents?: string[] | null
          round_robin_last_index?: number
          rule_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_rules_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignment_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          target_user_id: string | null
          tenant_id: string | null
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json | null
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      cac_despesas: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          descricao: string
          id: string
          mes_final: string | null
          mes_inicial: string
          percentual_alocado_vendas: number | null
          tenant_id: string | null
          unidade_base_id: number | null
          valor_alocado: number
          valor_total: number
        }
        Insert: {
          ativo?: boolean
          categoria: string
          created_at?: string
          descricao: string
          id?: string
          mes_final?: string | null
          mes_inicial: string
          percentual_alocado_vendas?: number | null
          tenant_id?: string | null
          unidade_base_id?: number | null
          valor_alocado: number
          valor_total: number
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          descricao?: string
          id?: string
          mes_final?: string | null
          mes_inicial?: string
          percentual_alocado_vendas?: number | null
          tenant_id?: string | null
          unidade_base_id?: number | null
          valor_alocado?: number
          valor_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "cac_despesas_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
      configuracoes: {
        Row: {
          chat_timezone: string
          created_at: string
          custo_fixo_percentual: number
          id: number
          imposto_percentual: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          chat_timezone?: string
          created_at?: string
          custo_fixo_percentual?: number
          id?: number
          imposto_percentual?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          chat_timezone?: string
          created_at?: string
          custo_fixo_percentual?: number
          id?: number
          imposto_percentual?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      conversation_assignments: {
        Row: {
          assigned_by: string | null
          assigned_from: string | null
          assigned_to: string | null
          conversation_id: string
          created_at: string
          id: string
          reason: string | null
          tenant_id: string
        }
        Insert: {
          assigned_by?: string | null
          assigned_from?: string | null
          assigned_to?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          reason?: string | null
          tenant_id: string
        }
        Update: {
          assigned_by?: string | null
          assigned_from?: string | null
          assigned_to?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cs_ticket_reassignments: {
        Row: {
          criado_em: string
          de_id: number | null
          id: string
          motivo: string | null
          para_id: number
          reatribuido_por_id: number | null
          tenant_id: string | null
          ticket_id: string
        }
        Insert: {
          criado_em?: string
          de_id?: number | null
          id?: string
          motivo?: string | null
          para_id: number
          reatribuido_por_id?: number | null
          tenant_id?: string | null
          ticket_id: string
        }
        Update: {
          criado_em?: string
          de_id?: number | null
          id?: string
          motivo?: string | null
          para_id?: number
          reatribuido_por_id?: number | null
          tenant_id?: string | null
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
          tenant_id: string | null
          ticket_id: string
          tipo: Database["public"]["Enums"]["cs_update_tipo"]
        }
        Insert: {
          conteudo?: string
          criado_em?: string
          criado_por_id?: number | null
          id?: string
          privado?: boolean
          tenant_id?: string | null
          ticket_id: string
          tipo?: Database["public"]["Enums"]["cs_update_tipo"]
        }
        Update: {
          conteudo?: string
          criado_em?: string
          criado_por_id?: number | null
          id?: string
          privado?: boolean
          tenant_id?: string | null
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
          avulsa_data_prevista: string | null
          avulsa_data_realizada: string | null
          avulsa_descricao: string | null
          avulsa_movimento_id: string | null
          avulsa_status: Database["public"]["Enums"]["cs_avulsa_status"] | null
          avulsa_tipo: Database["public"]["Enums"]["cs_avulsa_tipo"] | null
          avulsa_valor_previsto: number | null
          avulsa_valor_realizado: number | null
          cliente_id: string | null
          concluido_em: string | null
          contato_externo_nome: string | null
          criado_em: string
          criado_por_id: number | null
          criado_por_uid: string | null
          descricao_curta: string
          escalado: boolean
          has_avulsa: boolean
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
          oport_data_prevista: string | null
          oport_resultado: string | null
          oport_valor_previsto_ativacao: number | null
          oport_valor_previsto_mrr: number | null
          owner_id: number | null
          owner_uid: string | null
          primeira_acao_em: string | null
          prioridade: Database["public"]["Enums"]["cs_ticket_prioridade"]
          prob_churn_percent: number | null
          prob_sucesso_percent: number | null
          proxima_acao: string | null
          proximo_followup_em: string | null
          sla_conclusao_ate: string | null
          sla_primeira_acao_ate: string | null
          status: Database["public"]["Enums"]["cs_ticket_status"]
          tenant_id: string | null
          tipo: Database["public"]["Enums"]["cs_ticket_tipo"]
        }
        Insert: {
          assunto: string
          atualizado_em?: string
          avulsa_data_prevista?: string | null
          avulsa_data_realizada?: string | null
          avulsa_descricao?: string | null
          avulsa_movimento_id?: string | null
          avulsa_status?: Database["public"]["Enums"]["cs_avulsa_status"] | null
          avulsa_tipo?: Database["public"]["Enums"]["cs_avulsa_tipo"] | null
          avulsa_valor_previsto?: number | null
          avulsa_valor_realizado?: number | null
          cliente_id?: string | null
          concluido_em?: string | null
          contato_externo_nome?: string | null
          criado_em?: string
          criado_por_id?: number | null
          criado_por_uid?: string | null
          descricao_curta?: string
          escalado?: boolean
          has_avulsa?: boolean
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
          oport_data_prevista?: string | null
          oport_resultado?: string | null
          oport_valor_previsto_ativacao?: number | null
          oport_valor_previsto_mrr?: number | null
          owner_id?: number | null
          owner_uid?: string | null
          primeira_acao_em?: string | null
          prioridade?: Database["public"]["Enums"]["cs_ticket_prioridade"]
          prob_churn_percent?: number | null
          prob_sucesso_percent?: number | null
          proxima_acao?: string | null
          proximo_followup_em?: string | null
          sla_conclusao_ate?: string | null
          sla_primeira_acao_ate?: string | null
          status?: Database["public"]["Enums"]["cs_ticket_status"]
          tenant_id?: string | null
          tipo: Database["public"]["Enums"]["cs_ticket_tipo"]
        }
        Update: {
          assunto?: string
          atualizado_em?: string
          avulsa_data_prevista?: string | null
          avulsa_data_realizada?: string | null
          avulsa_descricao?: string | null
          avulsa_movimento_id?: string | null
          avulsa_status?: Database["public"]["Enums"]["cs_avulsa_status"] | null
          avulsa_tipo?: Database["public"]["Enums"]["cs_avulsa_tipo"] | null
          avulsa_valor_previsto?: number | null
          avulsa_valor_realizado?: number | null
          cliente_id?: string | null
          concluido_em?: string | null
          contato_externo_nome?: string | null
          criado_em?: string
          criado_por_id?: number | null
          criado_por_uid?: string | null
          descricao_curta?: string
          escalado?: boolean
          has_avulsa?: boolean
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
          oport_data_prevista?: string | null
          oport_resultado?: string | null
          oport_valor_previsto_ativacao?: number | null
          oport_valor_previsto_mrr?: number | null
          owner_id?: number | null
          owner_uid?: string | null
          primeira_acao_em?: string | null
          prioridade?: Database["public"]["Enums"]["cs_ticket_prioridade"]
          prob_churn_percent?: number | null
          prob_sucesso_percent?: number | null
          proxima_acao?: string | null
          proximo_followup_em?: string | null
          sla_conclusao_ate?: string | null
          sla_primeira_acao_ate?: string | null
          status?: Database["public"]["Enums"]["cs_ticket_status"]
          tenant_id?: string | null
          tipo?: Database["public"]["Enums"]["cs_ticket_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "cs_tickets_avulsa_movimento_id_fkey"
            columns: ["avulsa_movimento_id"]
            isOneToOne: false
            referencedRelation: "movimentos_mrr"
            referencedColumns: ["id"]
          },
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
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      fornecedores: {
        Row: {
          id: number
          nome: string
          site: string | null
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          site?: string | null
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          site?: string | null
          tenant_id?: string | null
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
          tenant_id: string | null
        }
        Insert: {
          ativo?: boolean
          cargo?: string | null
          email?: string | null
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          ativo?: boolean
          cargo?: string | null
          email?: string | null
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          role: string
          tenant_id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          role?: string
          tenant_id: string
          token?: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          role?: string
          tenant_id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      modelos_contrato: {
        Row: {
          id: number
          nome: string
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      motivos_cancelamento: {
        Row: {
          descricao: string
          id: number
          tenant_id: string | null
        }
        Insert: {
          descricao: string
          id?: number
          tenant_id?: string | null
        }
        Update: {
          descricao?: string
          id?: number
          tenant_id?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      produtos: {
        Row: {
          id: number
          nome: string
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          access_status: string
          allowed_domain: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          funcionario_id: number | null
          invited_at: string | null
          invited_by: string | null
          is_super_admin: boolean
          role: string
          status: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          access_status?: string
          allowed_domain?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          funcionario_id?: number | null
          invited_at?: string | null
          invited_by?: string | null
          is_super_admin?: boolean
          role?: string
          status?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          access_status?: string
          allowed_domain?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          funcionario_id?: number | null
          invited_at?: string | null
          invited_by?: string | null
          is_super_admin?: boolean
          role?: string
          status?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      segmentos: {
        Row: {
          id: number
          nome: string
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      super_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          cnpj: string | null
          created_at: string
          id: string
          max_users: number
          nome: string
          plano: string | null
          status: string
          trial_ends_at: string | null
        }
        Insert: {
          cnpj?: string | null
          created_at?: string
          id?: string
          max_users?: number
          nome: string
          plano?: string | null
          status?: string
          trial_ends_at?: string | null
        }
        Update: {
          cnpj?: string | null
          created_at?: string
          id?: string
          max_users?: number
          nome?: string
          plano?: string | null
          status?: string
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      unidades_base: {
        Row: {
          id: number
          nome: string
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      whatsapp_contacts: {
        Row: {
          created_at: string
          id: string
          instance_id: string | null
          is_group: boolean
          name: string | null
          notes: string | null
          phone_number: string
          profile_picture_url: string | null
          tags: string[] | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          instance_id?: string | null
          is_group?: boolean
          name?: string | null
          notes?: string | null
          phone_number: string
          profile_picture_url?: string | null
          tags?: string[] | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          instance_id?: string | null
          is_group?: boolean
          name?: string | null
          notes?: string | null
          phone_number?: string
          profile_picture_url?: string | null
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_notes: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          created_by: string | null
          id: string
          is_pinned: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_pinned?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_notes_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_summaries: {
        Row: {
          action_items: string[] | null
          conversation_id: string
          created_at: string
          id: string
          key_points: string[] | null
          message_count: number
          period_end: string | null
          period_start: string | null
          sentiment_at_time: string | null
          summary: string
          tenant_id: string
        }
        Insert: {
          action_items?: string[] | null
          conversation_id: string
          created_at?: string
          id?: string
          key_points?: string[] | null
          message_count?: number
          period_end?: string | null
          period_start?: string | null
          sentiment_at_time?: string | null
          summary: string
          tenant_id: string
        }
        Update: {
          action_items?: string[] | null
          conversation_id?: string
          created_at?: string
          id?: string
          key_points?: string[] | null
          message_count?: number
          period_end?: string | null
          period_start?: string | null
          sentiment_at_time?: string | null
          summary?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_summaries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          assigned_to: string | null
          category: string | null
          contact_id: string
          created_at: string
          id: string
          instance_id: string | null
          is_last_message_from_me: boolean
          last_message_at: string | null
          last_message_preview: string | null
          metadata: Json | null
          priority: string | null
          status: string
          tenant_id: string
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          contact_id: string
          created_at?: string
          id?: string
          instance_id?: string | null
          is_last_message_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json | null
          priority?: string | null
          status?: string
          tenant_id: string
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          instance_id?: string | null
          is_last_message_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json | null
          priority?: string | null
          status?: string
          tenant_id?: string
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instance_secrets: {
        Row: {
          api_key: string
          api_url: string
          created_at: string
          id: string
          instance_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          api_key: string
          api_url: string
          created_at?: string
          id?: string
          instance_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          api_key?: string
          api_url?: string
          created_at?: string
          id?: string
          instance_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_secrets_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_secrets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          instance_id_external: string | null
          instance_name: string
          phone_number: string | null
          provider_type: string
          status: string
          tenant_id: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          instance_id_external?: string | null
          instance_name: string
          phone_number?: string | null
          provider_type?: string
          status?: string
          tenant_id: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          instance_id_external?: string | null
          instance_name?: string
          phone_number?: string | null
          provider_type?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_macros: {
        Row: {
          category: string | null
          content: string
          created_at: string
          created_by: string | null
          id: string
          instance_id: string | null
          is_active: boolean
          is_global: boolean
          shortcut: string | null
          tenant_id: string
          title: string
          updated_at: string
          usage_count: number
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean
          is_global?: boolean
          shortcut?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          usage_count?: number
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean
          is_global?: boolean
          shortcut?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          usage_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_macros_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_macros_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_message_edit_history: {
        Row: {
          conversation_id: string
          edited_at: string
          id: string
          message_id: string
          previous_content: string
          tenant_id: string
        }
        Insert: {
          conversation_id: string
          edited_at?: string
          id?: string
          message_id: string
          previous_content: string
          tenant_id: string
        }
        Update: {
          conversation_id?: string
          edited_at?: string
          id?: string
          message_id?: string
          previous_content?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_message_edit_history_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_message_edit_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          audio_transcription: string | null
          content: string
          conversation_id: string
          created_at: string
          edited_at: string | null
          id: string
          instance_id: string | null
          is_from_me: boolean
          media_ext: string | null
          media_filename: string | null
          media_kind: string | null
          media_mimetype: string | null
          media_path: string | null
          media_size_bytes: number | null
          media_url: string | null
          message_id: string
          message_type: string
          metadata: Json | null
          original_content: string | null
          quoted_message_id: string | null
          remote_jid: string | null
          sender_name: string | null
          sender_role: string | null
          sent_by_user_id: string | null
          status: string
          tenant_id: string
          timestamp: string
          transcription_status: string | null
        }
        Insert: {
          audio_transcription?: string | null
          content?: string
          conversation_id: string
          created_at?: string
          edited_at?: string | null
          id?: string
          instance_id?: string | null
          is_from_me?: boolean
          media_ext?: string | null
          media_filename?: string | null
          media_kind?: string | null
          media_mimetype?: string | null
          media_path?: string | null
          media_size_bytes?: number | null
          media_url?: string | null
          message_id: string
          message_type?: string
          metadata?: Json | null
          original_content?: string | null
          quoted_message_id?: string | null
          remote_jid?: string | null
          sender_name?: string | null
          sender_role?: string | null
          sent_by_user_id?: string | null
          status?: string
          tenant_id: string
          timestamp?: string
          transcription_status?: string | null
        }
        Update: {
          audio_transcription?: string | null
          content?: string
          conversation_id?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          instance_id?: string | null
          is_from_me?: boolean
          media_ext?: string | null
          media_filename?: string | null
          media_kind?: string | null
          media_mimetype?: string | null
          media_path?: string | null
          media_size_bytes?: number | null
          media_url?: string | null
          message_id?: string
          message_type?: string
          metadata?: Json | null
          original_content?: string | null
          quoted_message_id?: string | null
          remote_jid?: string | null
          sender_name?: string | null
          sender_role?: string | null
          sent_by_user_id?: string | null
          status?: string
          tenant_id?: string
          timestamp?: string
          transcription_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_reactions: {
        Row: {
          conversation_id: string
          created_at: string
          emoji: string
          id: string
          is_from_me: boolean
          message_id: string
          reactor_jid: string
          tenant_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          emoji: string
          id?: string
          is_from_me?: boolean
          message_id: string
          reactor_jid: string
          tenant_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          emoji?: string
          id?: string
          is_from_me?: boolean
          message_id?: string
          reactor_jid?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_reactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sentiment_analysis: {
        Row: {
          confidence: number | null
          contact_id: string | null
          conversation_id: string
          created_at: string
          cs_ticket_created_id: string | null
          cs_ticket_reason: string | null
          id: string
          keywords: string[] | null
          needs_cs_ticket: boolean
          sentiment: Database["public"]["Enums"]["sentiment_type"]
          summary: string | null
          tenant_id: string
          topics: string[] | null
        }
        Insert: {
          confidence?: number | null
          contact_id?: string | null
          conversation_id: string
          created_at?: string
          cs_ticket_created_id?: string | null
          cs_ticket_reason?: string | null
          id?: string
          keywords?: string[] | null
          needs_cs_ticket?: boolean
          sentiment?: Database["public"]["Enums"]["sentiment_type"]
          summary?: string | null
          tenant_id: string
          topics?: string[] | null
        }
        Update: {
          confidence?: number | null
          contact_id?: string | null
          conversation_id?: string
          created_at?: string
          cs_ticket_created_id?: string | null
          cs_ticket_reason?: string | null
          id?: string
          keywords?: string[] | null
          needs_cs_ticket?: boolean
          sentiment?: Database["public"]["Enums"]["sentiment_type"]
          summary?: string | null
          tenant_id?: string
          topics?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sentiment_analysis_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sentiment_analysis_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sentiment_analysis_cs_ticket_created_id_fkey"
            columns: ["cs_ticket_created_id"]
            isOneToOne: false
            referencedRelation: "cs_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sentiment_analysis_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sentiment_history: {
        Row: {
          archived_at: string
          confidence: number | null
          contact_id: string | null
          conversation_id: string
          id: string
          keywords: string[] | null
          sentiment: Database["public"]["Enums"]["sentiment_type"]
          summary: string | null
          tenant_id: string
        }
        Insert: {
          archived_at?: string
          confidence?: number | null
          contact_id?: string | null
          conversation_id: string
          id?: string
          keywords?: string[] | null
          sentiment: Database["public"]["Enums"]["sentiment_type"]
          summary?: string | null
          tenant_id: string
        }
        Update: {
          archived_at?: string
          confidence?: number | null
          contact_id?: string | null
          conversation_id?: string
          id?: string
          keywords?: string[] | null
          sentiment?: Database["public"]["Enums"]["sentiment_type"]
          summary?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sentiment_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sentiment_history_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sentiment_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_topics_history: {
        Row: {
          archived_at: string
          conversation_id: string
          id: string
          tenant_id: string
          topics: string[] | null
        }
        Insert: {
          archived_at?: string
          conversation_id: string
          id?: string
          tenant_id: string
          topics?: string[] | null
        }
        Update: {
          archived_at?: string
          conversation_id?: string
          id?: string
          tenant_id?: string
          topics?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_topics_history_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_topics_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          data_ativacao: string | null
          data_cadastro: string | null
          data_cancelamento: string | null
          data_venda: string | null
          email: string | null
          estado_id: number | null
          fator_preco_cogs_x: number | null
          fixos_rs: number | null
          forma_pagamento_ativacao_id: number | null
          forma_pagamento_mensalidade_id: number | null
          fornecedor_id: number | null
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
          tenant_id: string | null
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
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          estado_id?: number | null
          fator_preco_cogs_x?: never
          fixos_rs?: never
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
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
          tenant_id?: string | null
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
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          estado_id?: number | null
          fator_preco_cogs_x?: never
          fixos_rs?: never
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
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
          tenant_id?: string | null
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
      vw_cohort_logos: {
        Row: {
          age_months: number | null
          cohort_month: string | null
          cohort_size: number | null
          retained: number | null
          retention_percent: number | null
          tenant_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_invite: { Args: { p_token: string }; Returns: undefined }
      can_access_tenant_row: { Args: { row_tenant: string }; Returns: boolean }
      can_invite_more_users: { Args: { p_tenant: string }; Returns: boolean }
      create_tenant_for_new_user:
        | { Args: { p_nome: string }; Returns: string }
        | {
            Args: {
              p_allowed_domain?: string
              p_cnpj?: string
              p_nome: string
              p_plano?: string
            }
            Returns: string
          }
      current_tenant_id: { Args: never; Returns: string }
      email_domain: { Args: { email: string }; Returns: string }
      fn_cohort_logos:
        | {
            Args: {
              p_fornecedor_id?: number
              p_from_month?: string
              p_max_age?: number
              p_to_month?: string
              p_unidade_base_id?: number
            }
            Returns: {
              age_months: number
              cohort_month: string
              cohort_size: number
              retained: number
              retention_percent: number
              tenant_id: string
            }[]
          }
        | {
            Args: {
              p_fornecedor_id?: number
              p_from_month?: string
              p_max_age?: number
              p_tenant_id?: string
              p_to_month?: string
              p_unidade_base_id?: number
            }
            Returns: {
              age_months: number
              cohort_month: string
              cohort_size: number
              retained: number
              retention_percent: number
              tenant_id: string
            }[]
          }
      get_tenant_users_with_email: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          email: string
          funcionario_id: number
          is_super_admin: boolean
          role: string
          status: string
          user_id: string
        }[]
      }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_active_member: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: never; Returns: boolean }
      norm_txt: { Args: { t: string }; Returns: string }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      tenant_user_count: { Args: { p_tenant: string }; Returns: number }
      unaccent: { Args: { "": string }; Returns: string }
      validate_invite_token: {
        Args: { p_token: string }
        Returns: {
          email: string
          role: string
          tenant_id: string
        }[]
      }
    }
    Enums: {
      cs_avulsa_status: "previsto" | "confirmado" | "realizado" | "perdido"
      cs_avulsa_tipo:
        | "instalacao"
        | "treinamento"
        | "visita_tecnica"
        | "migracao"
        | "consultoria"
        | "outro"
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
      sentiment_type: "positive" | "neutral" | "negative"
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
      cs_avulsa_status: ["previsto", "confirmado", "realizado", "perdido"],
      cs_avulsa_tipo: [
        "instalacao",
        "treinamento",
        "visita_tecnica",
        "migracao",
        "consultoria",
        "outro",
      ],
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
      sentiment_type: ["positive", "neutral", "negative"],
    },
  },
} as const
