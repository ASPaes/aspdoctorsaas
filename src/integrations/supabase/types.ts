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
      access_invites: {
        Row: {
          accepted_at: string | null
          auth_user_id: string | null
          created_at: string
          email: string
          funcionario_id: number | null
          id: string
          invited_at: string
          invited_by: string | null
          metadata: Json
          resent_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email: string
          funcionario_id?: number | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          metadata?: Json
          resent_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          auth_user_id?: string | null
          created_at?: string
          email?: string
          funcionario_id?: number | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          metadata?: Json
          resent_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_alert_config: {
        Row: {
          admin_instance_name: string
          admin_phone: string
          check_interval_minutes: number
          created_at: string | null
          critical_threshold: number
          id: string
          updated_at: string | null
          warning_threshold: number
        }
        Insert: {
          admin_instance_name?: string
          admin_phone?: string
          check_interval_minutes?: number
          created_at?: string | null
          critical_threshold?: number
          id?: string
          updated_at?: string | null
          warning_threshold?: number
        }
        Update: {
          admin_instance_name?: string
          admin_phone?: string
          check_interval_minutes?: number
          created_at?: string | null
          critical_threshold?: number
          id?: string
          updated_at?: string | null
          warning_threshold?: number
        }
        Relationships: []
      }
      ai_alert_log: {
        Row: {
          function_name: string
          id: string
          level: string
          resolved_at: string | null
          sent_at: string
          tenant_id: string | null
        }
        Insert: {
          function_name: string
          id?: string
          level: string
          resolved_at?: string | null
          sent_at?: string
          tenant_id?: string | null
        }
        Update: {
          function_name?: string
          id?: string
          level?: string
          resolved_at?: string | null
          sent_at?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      ai_rate_limit_config: {
        Row: {
          created_at: string | null
          function_name: string
          id: string
          max_calls: number
          tenant_id: string | null
          updated_at: string | null
          window_seconds: number
        }
        Insert: {
          created_at?: string | null
          function_name: string
          id?: string
          max_calls?: number
          tenant_id?: string | null
          updated_at?: string | null
          window_seconds?: number
        }
        Update: {
          created_at?: string | null
          function_name?: string
          id?: string
          max_calls?: number
          tenant_id?: string | null
          updated_at?: string | null
          window_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_rate_limit_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_settings: {
        Row: {
          api_key_encrypted: string | null
          api_key_hint: string | null
          base_url: string | null
          created_at: string
          id: string
          is_active: boolean
          last_test_error: string | null
          last_test_ok: boolean | null
          last_tested_at: string | null
          model: string | null
          provider: string
          system_prompt: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          api_key_encrypted?: string | null
          api_key_hint?: string | null
          base_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          model?: string | null
          provider?: string
          system_prompt?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          api_key_encrypted?: string | null
          api_key_hint?: string | null
          base_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_test_error?: string | null
          last_test_ok?: boolean | null
          last_tested_at?: string | null
          model?: string | null
          provider?: string
          system_prompt?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          called_at: string
          estimated_cost_usd: number | null
          function_name: string
          id: string
          input_tokens: number | null
          model: string | null
          output_tokens: number | null
          provider: string | null
          tenant_id: string
        }
        Insert: {
          called_at?: string
          estimated_cost_usd?: number | null
          function_name: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          provider?: string | null
          tenant_id: string
        }
        Update: {
          called_at?: string
          estimated_cost_usd?: number | null
          function_name?: string
          id?: string
          input_tokens?: number | null
          model?: string | null
          output_tokens?: number | null
          provider?: string | null
          tenant_id?: string
        }
        Relationships: []
      }
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
      business_hours_exceptions: {
        Row: {
          created_at: string
          date: string
          id: string
          is_closed: boolean
          name: string | null
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          is_closed?: boolean
          name?: string | null
          tenant_id: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          is_closed?: boolean
          name?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
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
      cliente_avaliacoes_atendimento: {
        Row: {
          avaliado_por: string | null
          cliente_id: string
          contact_id: string | null
          created_at: string
          id: string
          itens_acao: string[] | null
          nota: number | null
          periodo_fim: string | null
          periodo_inicio: string | null
          pontos_chave: string[] | null
          resumo: string
          sentimento: string | null
          tenant_id: string
          total_conversas: number | null
          total_mensagens: number | null
        }
        Insert: {
          avaliado_por?: string | null
          cliente_id: string
          contact_id?: string | null
          created_at?: string
          id?: string
          itens_acao?: string[] | null
          nota?: number | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          pontos_chave?: string[] | null
          resumo: string
          sentimento?: string | null
          tenant_id: string
          total_conversas?: number | null
          total_mensagens?: number | null
        }
        Update: {
          avaliado_por?: string | null
          cliente_id?: string
          contact_id?: string | null
          created_at?: string
          id?: string
          itens_acao?: string[] | null
          nota?: number | null
          periodo_fim?: string | null
          periodo_inicio?: string | null
          pontos_chave?: string[] | null
          resumo?: string
          sentimento?: string | null
          tenant_id?: string
          total_conversas?: number | null
          total_mensagens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_avaliacoes_atendimento_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_avaliacoes_atendimento_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
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
          complemento: string | null
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
          dia_vencimento_mrr: number | null
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
          telefone_whatsapp_contato: string | null
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
          complemento?: string | null
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
          dia_vencimento_mrr?: number | null
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
          telefone_whatsapp_contato?: string | null
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
          complemento?: string | null
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
          dia_vencimento_mrr?: number | null
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
          telefone_whatsapp_contato?: string | null
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
          billing_skip_ura_enabled: boolean
          billing_skip_ura_minutes: number
          business_hours: Json
          business_hours_ai_enabled: boolean
          business_hours_ai_prompt: string | null
          business_hours_enabled: boolean
          business_hours_message: string | null
          business_hours_outside_prompt: string | null
          business_hours_timezone: string
          chat_timezone: string
          created_at: string
          custo_fixo_percentual: number
          id: number
          imposto_percentual: number
          oncall_escalation_window_minutes: number
          oncall_message_template: string | null
          oncall_min_customer_messages: number
          oncall_min_elapsed_seconds: number
          oncall_phone_number: string | null
          oncall_repeat_cooldown_minutes: number
          oncall_urgency_keywords: Json
          support_auto_close_inactivity_minutes: number
          support_config: Json
          support_csat_confirm_before_close: boolean | null
          support_csat_enabled: boolean
          support_csat_prompt_template: string
          support_csat_reason_prompt_template: string
          support_csat_reason_threshold: number
          support_csat_score_max: number
          support_csat_score_min: number
          support_csat_thanks_template: string
          support_csat_timeout_minutes: number
          support_inactivity_warning_before_minutes: number
          support_inactivity_warning_template: string
          support_reopen_window_minutes: number
          support_send_inactivity_warning: boolean
          support_ura_default_department_id: string | null
          support_ura_enabled: boolean
          support_ura_invalid_option_template: string
          support_ura_timeout_minutes: number
          support_ura_welcome_template: string
          tenant_id: string | null
          updated_at: string
          ura_default_department_id: string | null
          ura_enabled: boolean
          ura_invalid_option_template: string
          ura_timeout_minutes: number
          ura_welcome_template: string
        }
        Insert: {
          billing_skip_ura_enabled?: boolean
          billing_skip_ura_minutes?: number
          business_hours?: Json
          business_hours_ai_enabled?: boolean
          business_hours_ai_prompt?: string | null
          business_hours_enabled?: boolean
          business_hours_message?: string | null
          business_hours_outside_prompt?: string | null
          business_hours_timezone?: string
          chat_timezone?: string
          created_at?: string
          custo_fixo_percentual?: number
          id?: number
          imposto_percentual?: number
          oncall_escalation_window_minutes?: number
          oncall_message_template?: string | null
          oncall_min_customer_messages?: number
          oncall_min_elapsed_seconds?: number
          oncall_phone_number?: string | null
          oncall_repeat_cooldown_minutes?: number
          oncall_urgency_keywords?: Json
          support_auto_close_inactivity_minutes?: number
          support_config?: Json
          support_csat_confirm_before_close?: boolean | null
          support_csat_enabled?: boolean
          support_csat_prompt_template?: string
          support_csat_reason_prompt_template?: string
          support_csat_reason_threshold?: number
          support_csat_score_max?: number
          support_csat_score_min?: number
          support_csat_thanks_template?: string
          support_csat_timeout_minutes?: number
          support_inactivity_warning_before_minutes?: number
          support_inactivity_warning_template?: string
          support_reopen_window_minutes?: number
          support_send_inactivity_warning?: boolean
          support_ura_default_department_id?: string | null
          support_ura_enabled?: boolean
          support_ura_invalid_option_template?: string
          support_ura_timeout_minutes?: number
          support_ura_welcome_template?: string
          tenant_id?: string | null
          updated_at?: string
          ura_default_department_id?: string | null
          ura_enabled?: boolean
          ura_invalid_option_template?: string
          ura_timeout_minutes?: number
          ura_welcome_template?: string
        }
        Update: {
          billing_skip_ura_enabled?: boolean
          billing_skip_ura_minutes?: number
          business_hours?: Json
          business_hours_ai_enabled?: boolean
          business_hours_ai_prompt?: string | null
          business_hours_enabled?: boolean
          business_hours_message?: string | null
          business_hours_outside_prompt?: string | null
          business_hours_timezone?: string
          chat_timezone?: string
          created_at?: string
          custo_fixo_percentual?: number
          id?: number
          imposto_percentual?: number
          oncall_escalation_window_minutes?: number
          oncall_message_template?: string | null
          oncall_min_customer_messages?: number
          oncall_min_elapsed_seconds?: number
          oncall_phone_number?: string | null
          oncall_repeat_cooldown_minutes?: number
          oncall_urgency_keywords?: Json
          support_auto_close_inactivity_minutes?: number
          support_config?: Json
          support_csat_confirm_before_close?: boolean | null
          support_csat_enabled?: boolean
          support_csat_prompt_template?: string
          support_csat_reason_prompt_template?: string
          support_csat_reason_threshold?: number
          support_csat_score_max?: number
          support_csat_score_min?: number
          support_csat_thanks_template?: string
          support_csat_timeout_minutes?: number
          support_inactivity_warning_before_minutes?: number
          support_inactivity_warning_template?: string
          support_reopen_window_minutes?: number
          support_send_inactivity_warning?: boolean
          support_ura_default_department_id?: string | null
          support_ura_enabled?: boolean
          support_ura_invalid_option_template?: string
          support_ura_timeout_minutes?: number
          support_ura_welcome_template?: string
          tenant_id?: string | null
          updated_at?: string
          ura_default_department_id?: string | null
          ura_enabled?: boolean
          ura_invalid_option_template?: string
          ura_timeout_minutes?: number
          ura_welcome_template?: string
        }
        Relationships: [
          {
            foreignKeyName: "configuracoes_support_ura_default_department_id_fkey"
            columns: ["support_ura_default_department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuracoes_ura_default_department_id_fkey"
            columns: ["ura_default_department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
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
      db_health_action_log: {
        Row: {
          check_name: string
          diagnosis: string
          id: string
          level: string
          recommended_action: string
          resolved_at: string | null
          responded_at: string | null
          response: string | null
          sent_at: string
          status: string
          tenant_id: string
        }
        Insert: {
          check_name: string
          diagnosis: string
          id?: string
          level: string
          recommended_action: string
          resolved_at?: string | null
          responded_at?: string | null
          response?: string | null
          sent_at?: string
          status?: string
          tenant_id?: string
        }
        Update: {
          check_name?: string
          diagnosis?: string
          id?: string
          level?: string
          recommended_action?: string
          resolved_at?: string | null
          responded_at?: string | null
          response?: string | null
          sent_at?: string
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      db_maintenance_queue: {
        Row: {
          action: string
          executed_at: string | null
          id: string
          requested_at: string
          status: string
        }
        Insert: {
          action: string
          executed_at?: string | null
          id?: string
          requested_at?: string
          status?: string
        }
        Update: {
          action?: string
          executed_at?: string | null
          id?: string
          requested_at?: string
          status?: string
        }
        Relationships: []
      }
      db_metrics_snapshots: {
        Row: {
          active_connections: number | null
          captured_at: string
          cron_job_details_count: number | null
          database_size_bytes: number | null
          dead_tuples_support_attendances: number | null
          dead_tuples_whatsapp_conversations: number | null
          dead_tuples_whatsapp_messages: number | null
          id: string
          idle_connections: number | null
          top_slow_query_ms: number | null
          total_connections: number | null
        }
        Insert: {
          active_connections?: number | null
          captured_at?: string
          cron_job_details_count?: number | null
          database_size_bytes?: number | null
          dead_tuples_support_attendances?: number | null
          dead_tuples_whatsapp_conversations?: number | null
          dead_tuples_whatsapp_messages?: number | null
          id?: string
          idle_connections?: number | null
          top_slow_query_ms?: number | null
          total_connections?: number | null
        }
        Update: {
          active_connections?: number | null
          captured_at?: string
          cron_job_details_count?: number | null
          database_size_bytes?: number | null
          dead_tuples_support_attendances?: number | null
          dead_tuples_whatsapp_conversations?: number | null
          dead_tuples_whatsapp_messages?: number | null
          id?: string
          idle_connections?: number | null
          top_slow_query_ms?: number | null
          total_connections?: number | null
        }
        Relationships: []
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
          department_id: string | null
          email: string | null
          id: number
          nome: string
          tenant_id: string | null
        }
        Insert: {
          ativo?: boolean
          cargo?: string | null
          department_id?: string | null
          email?: string | null
          id?: number
          nome: string
          tenant_id?: string | null
        }
        Update: {
          ativo?: boolean
          cargo?: string | null
          department_id?: string | null
          email?: string | null
          id?: number
          nome?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "funcionarios_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
        ]
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
      monitor_authorized_users: {
        Row: {
          active: boolean
          email: string
          granted_at: string
          granted_by: string | null
          id: string
          name: string | null
          user_id: string | null
        }
        Insert: {
          active?: boolean
          email: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          name?: string | null
          user_id?: string | null
        }
        Update: {
          active?: boolean
          email?: string
          granted_at?: string
          granted_by?: string | null
          id?: string
          name?: string | null
          user_id?: string | null
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
      notification_recipients: {
        Row: {
          delivered_at: string
          dismissed_at: string | null
          id: string
          notification_id: string
          read_at: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          delivered_at?: string
          dismissed_at?: string | null
          id?: string
          notification_id: string
          read_at?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          delivered_at?: string
          dismissed_at?: string | null
          id?: string
          notification_id?: string
          read_at?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notif_recipients_notification_fk"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notif_recipients_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notif_recipients_user_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string
          created_at: string
          created_by: string | null
          id: string
          metadata: Json
          severity: string
          tenant_id: string
          title: string
          type: string
        }
        Insert: {
          action_url?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          severity?: string
          tenant_id: string
          title: string
          type?: string
        }
        Update: {
          action_url?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json
          severity?: string
          tenant_id?: string
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_created_by_fk"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      support_agent_presence: {
        Row: {
          last_heartbeat_at: string | null
          pause_expected_end_at: string | null
          pause_reason_id: string | null
          pause_started_at: string | null
          shift_ended_at: string | null
          shift_started_at: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          last_heartbeat_at?: string | null
          pause_expected_end_at?: string | null
          pause_reason_id?: string | null
          pause_started_at?: string | null
          shift_ended_at?: string | null
          shift_started_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          last_heartbeat_at?: string | null
          pause_expected_end_at?: string | null
          pause_reason_id?: string | null
          pause_started_at?: string | null
          shift_ended_at?: string | null
          shift_started_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_agent_presence_pause_reason_id_fkey"
            columns: ["pause_reason_id"]
            isOneToOne: false
            referencedRelation: "support_pause_reasons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_agent_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      support_agent_presence_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          pause_reason_id: string | null
          payload: Json | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          pause_reason_id?: string | null
          payload?: Json | null
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          pause_reason_id?: string | null
          payload?: Json | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_agent_presence_events_pause_reason_id_fkey"
            columns: ["pause_reason_id"]
            isOneToOne: false
            referencedRelation: "support_pause_reasons"
            referencedColumns: ["id"]
          },
        ]
      }
      support_area_members: {
        Row: {
          area_id: string
          ativo: boolean
          created_at: string
          id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          area_id: string
          ativo?: boolean
          created_at?: string
          id?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          area_id?: string
          ativo?: boolean
          created_at?: string
          id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_area_members_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "support_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_area_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      support_areas: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          tenant_id: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          tenant_id: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          tenant_id?: string
        }
        Relationships: []
      }
      support_attendance_sequences: {
        Row: {
          ano: number
          last_seq: number
          tenant_id: string
        }
        Insert: {
          ano: number
          last_seq?: number
          tenant_id: string
        }
        Update: {
          ano?: number
          last_seq?: number
          tenant_id?: string
        }
        Relationships: []
      }
      support_attendances: {
        Row: {
          ai_category: string | null
          ai_problem: string | null
          ai_solution: string | null
          ai_summary: string | null
          ai_tags: string[] | null
          ano: number
          area_id: string | null
          assigned_to: string | null
          assumed_at: string | null
          attendance_code: string
          cliente_id: string | null
          closed_at: string | null
          closed_by: string | null
          closed_reason: string | null
          closure_type: string | null
          contact_id: string
          conversation_id: string
          created_at: string
          created_from: string | null
          department_id: string | null
          first_human_response_at: string | null
          first_response_at: string | null
          first_response_time_seconds: number | null
          handle_seconds: number
          handoffs_count: number
          id: string
          last_customer_message_at: string | null
          last_operator_message_at: string | null
          msg_agent_count: number
          msg_customer_count: number
          opened_at: string
          opened_by: string | null
          reopen_count: number | null
          reopened_at: string | null
          reopened_from: string | null
          seq_number: number
          status: string
          tenant_id: string
          updated_at: string
          ura_asked_at: string | null
          ura_completed_at: string | null
          ura_human_fallback: boolean
          ura_invalid_count: number
          ura_option_selected: number | null
          ura_selected_option: number | null
          ura_sent_at: string | null
          ura_state: string
          wait_seconds: number
        }
        Insert: {
          ai_category?: string | null
          ai_problem?: string | null
          ai_solution?: string | null
          ai_summary?: string | null
          ai_tags?: string[] | null
          ano?: number
          area_id?: string | null
          assigned_to?: string | null
          assumed_at?: string | null
          attendance_code?: string
          cliente_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          closure_type?: string | null
          contact_id: string
          conversation_id: string
          created_at?: string
          created_from?: string | null
          department_id?: string | null
          first_human_response_at?: string | null
          first_response_at?: string | null
          first_response_time_seconds?: number | null
          handle_seconds?: number
          handoffs_count?: number
          id?: string
          last_customer_message_at?: string | null
          last_operator_message_at?: string | null
          msg_agent_count?: number
          msg_customer_count?: number
          opened_at?: string
          opened_by?: string | null
          reopen_count?: number | null
          reopened_at?: string | null
          reopened_from?: string | null
          seq_number?: number
          status?: string
          tenant_id: string
          updated_at?: string
          ura_asked_at?: string | null
          ura_completed_at?: string | null
          ura_human_fallback?: boolean
          ura_invalid_count?: number
          ura_option_selected?: number | null
          ura_selected_option?: number | null
          ura_sent_at?: string | null
          ura_state?: string
          wait_seconds?: number
        }
        Update: {
          ai_category?: string | null
          ai_problem?: string | null
          ai_solution?: string | null
          ai_summary?: string | null
          ai_tags?: string[] | null
          ano?: number
          area_id?: string | null
          assigned_to?: string | null
          assumed_at?: string | null
          attendance_code?: string
          cliente_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          closure_type?: string | null
          contact_id?: string
          conversation_id?: string
          created_at?: string
          created_from?: string | null
          department_id?: string | null
          first_human_response_at?: string | null
          first_response_at?: string | null
          first_response_time_seconds?: number | null
          handle_seconds?: number
          handoffs_count?: number
          id?: string
          last_customer_message_at?: string | null
          last_operator_message_at?: string | null
          msg_agent_count?: number
          msg_customer_count?: number
          opened_at?: string
          opened_by?: string | null
          reopen_count?: number | null
          reopened_at?: string | null
          reopened_from?: string | null
          seq_number?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          ura_asked_at?: string | null
          ura_completed_at?: string | null
          ura_human_fallback?: boolean
          ura_invalid_count?: number
          ura_option_selected?: number | null
          ura_selected_option?: number | null
          ura_sent_at?: string | null
          ura_state?: string
          wait_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "support_attendances_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "support_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attendances_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "support_attendances_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attendances_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attendances_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "support_attendances_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attendances_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "support_attendances_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attendances_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attendances_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      support_csat: {
        Row: {
          asked_at: string
          attendance_id: string
          created_at: string
          id: string
          reason: string | null
          responded_at: string | null
          score: number | null
          status: string
          tenant_id: string
        }
        Insert: {
          asked_at?: string
          attendance_id: string
          created_at?: string
          id?: string
          reason?: string | null
          responded_at?: string | null
          score?: number | null
          status?: string
          tenant_id: string
        }
        Update: {
          asked_at?: string
          attendance_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          responded_at?: string | null
          score?: number | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_csat_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "support_attendances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_csat_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["attendance_id"]
          },
        ]
      }
      support_department_instances: {
        Row: {
          created_at: string
          department_id: string
          id: string
          instance_id: string
          is_active: boolean
          tenant_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          instance_id: string
          is_active?: boolean
          tenant_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          instance_id?: string
          is_active?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_department_instances_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_department_instances_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_department_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_department_members: {
        Row: {
          created_at: string
          department_id: string
          id: string
          is_active: boolean
          is_head: boolean
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          is_active?: boolean
          is_head?: boolean
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          is_active?: boolean
          is_head?: boolean
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_department_members_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_department_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_department_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      support_departments: {
        Row: {
          created_at: string
          default_instance_id: string | null
          description: string | null
          id: string
          is_active: boolean
          is_default_fallback: boolean
          name: string
          show_in_ura: boolean
          slug: string
          tenant_id: string
          updated_at: string
          ura_label: string | null
          ura_option_number: number | null
        }
        Insert: {
          created_at?: string
          default_instance_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default_fallback?: boolean
          name: string
          show_in_ura?: boolean
          slug: string
          tenant_id: string
          updated_at?: string
          ura_label?: string | null
          ura_option_number?: number | null
        }
        Update: {
          created_at?: string
          default_instance_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_default_fallback?: boolean
          name?: string
          show_in_ura?: boolean
          slug?: string
          tenant_id?: string
          updated_at?: string
          ura_label?: string | null
          ura_option_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "support_departments_default_instance_id_fkey"
            columns: ["default_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_departments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_kb_articles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          area_id: string | null
          created_at: string
          id: string
          problem: string
          solution: string
          source_attendance_id: string | null
          status: string
          summary: string | null
          tags: string[] | null
          tenant_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          area_id?: string | null
          created_at?: string
          id?: string
          problem: string
          solution: string
          source_attendance_id?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          tenant_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          area_id?: string | null
          created_at?: string
          id?: string
          problem?: string
          solution?: string
          source_attendance_id?: string | null
          status?: string
          summary?: string | null
          tags?: string[] | null
          tenant_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_kb_articles_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "support_kb_articles_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "support_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_kb_articles_source_attendance_id_fkey"
            columns: ["source_attendance_id"]
            isOneToOne: false
            referencedRelation: "support_attendances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_kb_articles_source_attendance_id_fkey"
            columns: ["source_attendance_id"]
            isOneToOne: false
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["attendance_id"]
          },
        ]
      }
      support_pause_reasons: {
        Row: {
          average_minutes: number
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          average_minutes?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          average_minutes?: number
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          aberto_em: string
          agendado_para: string
          assunto: string
          attendance_id: string
          atualizado_em: string
          cliente_id: string
          concluido_em: string | null
          criado_por: string | null
          descricao: string | null
          fornecedor_id: number | null
          id: string
          motivo_cancelamento: string | null
          prioridade: Database["public"]["Enums"]["support_ticket_prioridade"]
          responsavel_user_id: string | null
          status: Database["public"]["Enums"]["support_ticket_status"]
          tenant_id: string
          tipo: Database["public"]["Enums"]["support_ticket_tipo"]
        }
        Insert: {
          aberto_em?: string
          agendado_para: string
          assunto: string
          attendance_id: string
          atualizado_em?: string
          cliente_id: string
          concluido_em?: string | null
          criado_por?: string | null
          descricao?: string | null
          fornecedor_id?: number | null
          id?: string
          motivo_cancelamento?: string | null
          prioridade?: Database["public"]["Enums"]["support_ticket_prioridade"]
          responsavel_user_id?: string | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          tenant_id: string
          tipo?: Database["public"]["Enums"]["support_ticket_tipo"]
        }
        Update: {
          aberto_em?: string
          agendado_para?: string
          assunto?: string
          attendance_id?: string
          atualizado_em?: string
          cliente_id?: string
          concluido_em?: string | null
          criado_por?: string | null
          descricao?: string | null
          fornecedor_id?: number | null
          id?: string
          motivo_cancelamento?: string | null
          prioridade?: Database["public"]["Enums"]["support_ticket_prioridade"]
          responsavel_user_id?: string | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["support_ticket_tipo"]
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_attendance_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "support_attendances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_attendance_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["attendance_id"]
          },
          {
            foreignKeyName: "support_tickets_cliente_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_cliente_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_fornecedor_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_tenant_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      system_error_log: {
        Row: {
          context: Json | null
          error_message: string
          error_message_pt: string | null
          error_type: string
          function_name: string
          id: string
          notified_at: string | null
          occurred_at: string
          resolved_at: string | null
          severity: string
          tenant_id: string | null
        }
        Insert: {
          context?: Json | null
          error_message: string
          error_message_pt?: string | null
          error_type: string
          function_name: string
          id?: string
          notified_at?: string | null
          occurred_at?: string
          resolved_at?: string | null
          severity?: string
          tenant_id?: string | null
        }
        Update: {
          context?: Json | null
          error_message?: string
          error_message_pt?: string | null
          error_type?: string
          function_name?: string
          id?: string
          notified_at?: string | null
          occurred_at?: string
          resolved_at?: string | null
          severity?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      tenant_daily_metrics: {
        Row: {
          active_operators: number
          ai_calls_audio: number
          ai_calls_compose: number
          ai_calls_sentiment: number
          ai_calls_suggest: number
          ai_calls_summary: number
          avg_first_response_seconds: number | null
          conversations_closed: number
          conversations_opened: number
          created_at: string
          errors_count: number
          id: string
          messages_received: number
          messages_sent: number
          metric_date: string
          tenant_id: string
          updated_at: string
          whatsapp_instances_connected: number
          whatsapp_instances_total: number
        }
        Insert: {
          active_operators?: number
          ai_calls_audio?: number
          ai_calls_compose?: number
          ai_calls_sentiment?: number
          ai_calls_suggest?: number
          ai_calls_summary?: number
          avg_first_response_seconds?: number | null
          conversations_closed?: number
          conversations_opened?: number
          created_at?: string
          errors_count?: number
          id?: string
          messages_received?: number
          messages_sent?: number
          metric_date?: string
          tenant_id: string
          updated_at?: string
          whatsapp_instances_connected?: number
          whatsapp_instances_total?: number
        }
        Update: {
          active_operators?: number
          ai_calls_audio?: number
          ai_calls_compose?: number
          ai_calls_sentiment?: number
          ai_calls_suggest?: number
          ai_calls_summary?: number
          avg_first_response_seconds?: number | null
          conversations_closed?: number
          conversations_opened?: number
          created_at?: string
          errors_count?: number
          id?: string
          messages_received?: number
          messages_sent?: number
          metric_date?: string
          tenant_id?: string
          updated_at?: string
          whatsapp_instances_connected?: number
          whatsapp_instances_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_daily_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      user_preferences: {
        Row: {
          created_at: string
          department_id: string | null
          id: string
          prefer_department_overrides: boolean
          signature_name: string | null
          sound_enabled: boolean
          tenant_id: string
          updated_at: string
          user_id: string
          visual_notifications_enabled: boolean
        }
        Insert: {
          created_at?: string
          department_id?: string | null
          id?: string
          prefer_department_overrides?: boolean
          signature_name?: string | null
          sound_enabled?: boolean
          tenant_id: string
          updated_at?: string
          user_id: string
          visual_notifications_enabled?: boolean
        }
        Update: {
          created_at?: string
          department_id?: string | null
          id?: string
          prefer_department_overrides?: boolean
          signature_name?: string | null
          sound_enabled?: boolean
          tenant_id?: string
          updated_at?: string
          user_id?: string
          visual_notifications_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "user_preferences_department_fk"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_tenant_fk"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_preferences_user_fk"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
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
          current_instance_id: string | null
          department_id: string | null
          first_agent_message_at: string | null
          id: string
          instance_id: string | null
          is_last_message_from_me: boolean
          last_message_at: string | null
          last_message_preview: string | null
          metadata: Json | null
          opened_out_of_hours: boolean
          opened_out_of_hours_at: string | null
          out_of_hours_cleared_at: string | null
          priority: string | null
          sender_signature_mode: string
          sender_ticket_code: string | null
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
          current_instance_id?: string | null
          department_id?: string | null
          first_agent_message_at?: string | null
          id?: string
          instance_id?: string | null
          is_last_message_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json | null
          opened_out_of_hours?: boolean
          opened_out_of_hours_at?: string | null
          out_of_hours_cleared_at?: string | null
          priority?: string | null
          sender_signature_mode?: string
          sender_ticket_code?: string | null
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
          current_instance_id?: string | null
          department_id?: string | null
          first_agent_message_at?: string | null
          id?: string
          instance_id?: string | null
          is_last_message_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json | null
          opened_out_of_hours?: boolean
          opened_out_of_hours_at?: string | null
          out_of_hours_cleared_at?: string | null
          priority?: string | null
          sender_signature_mode?: string
          sender_ticket_code?: string | null
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
            foreignKeyName: "whatsapp_conversations_current_instance_id_fkey"
            columns: ["current_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
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
          api_url: string | null
          created_at: string
          id: string
          instance_id: string
          tenant_id: string
          updated_at: string
          zapi_client_token: string | null
          zapi_instance_id: string | null
          zapi_token: string | null
        }
        Insert: {
          api_url?: string | null
          created_at?: string
          id?: string
          instance_id: string
          tenant_id: string
          updated_at?: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
        }
        Update: {
          api_url?: string | null
          created_at?: string
          id?: string
          instance_id?: string
          tenant_id?: string
          updated_at?: string
          zapi_client_token?: string | null
          zapi_instance_id?: string | null
          zapi_token?: string | null
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
      whatsapp_instance_status_log: {
        Row: {
          alert_sent: boolean
          captured_at: string
          id: string
          instance_id: string
          instance_name: string
          status: string
          tenant_id: string
          was_connected: boolean
        }
        Insert: {
          alert_sent?: boolean
          captured_at?: string
          id?: string
          instance_id: string
          instance_name: string
          status: string
          tenant_id: string
          was_connected?: boolean
        }
        Update: {
          alert_sent?: boolean
          captured_at?: string
          id?: string
          instance_id?: string
          instance_name?: string
          status?: string
          tenant_id?: string
          was_connected?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_status_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instance_vault_refs: {
        Row: {
          created_at: string | null
          id: string
          instance_id: string
          secret_name: string
          updated_at: string | null
          vault_secret_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          instance_id: string
          secret_name: string
          updated_at?: string | null
          vault_secret_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          instance_id?: string
          secret_name?: string
          updated_at?: string | null
          vault_secret_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_vault_refs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          ignore_group_messages: boolean
          instance_id_external: string | null
          instance_name: string
          meta_business_id: string | null
          meta_phone_number_id: string | null
          meta_waba_id: string | null
          phone_number: string | null
          provider_type: string
          skip_ura: boolean
          status: string
          tenant_id: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          ignore_group_messages?: boolean
          instance_id_external?: string | null
          instance_name: string
          meta_business_id?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          phone_number?: string | null
          provider_type?: string
          skip_ura?: boolean
          status?: string
          tenant_id: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          ignore_group_messages?: boolean
          instance_id_external?: string | null
          instance_name?: string
          meta_business_id?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          phone_number?: string | null
          provider_type?: string
          skip_ura?: boolean
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
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
          delete_error: string | null
          delete_scope: string | null
          delete_status: string
          deleted_at: string | null
          deleted_by: string | null
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
          delete_error?: string | null
          delete_scope?: string | null
          delete_status?: string
          deleted_at?: string | null
          deleted_by?: string | null
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
          delete_error?: string | null
          delete_scope?: string | null
          delete_status?: string
          deleted_at?: string | null
          deleted_by?: string | null
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
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
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
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
      v_whatsapp_conversations_state: {
        Row: {
          attendance_assigned_to: string | null
          attendance_id: string | null
          attendance_opened_at: string | null
          attendance_status: string | null
          conversation_assigned_to: string | null
          conversation_id: string | null
          conversation_status: string | null
          department_id: string | null
          first_agent_message_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          opened_out_of_hours: boolean | null
          opened_out_of_hours_at: string | null
          tenant_id: string | null
          unread_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "support_attendances_assigned_to_fkey"
            columns: ["attendance_assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
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
      accept_access_invite: {
        Args: { p_invite_id: string }
        Returns: undefined
      }
      accept_invite: { Args: { p_token: string }; Returns: undefined }
      agent_presence_extend_pause: {
        Args: { p_minutes: number; p_tenant_id: string }
        Returns: undefined
      }
      agent_presence_heartbeat: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      agent_presence_set_active: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      agent_presence_set_off: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      agent_presence_set_off_release_queue: {
        Args: { p_tenant_id: string }
        Returns: Json
      }
      agent_presence_set_pause: {
        Args: { p_minutes: number; p_reason_id: string; p_tenant_id: string }
        Returns: undefined
      }
      audit_log: {
        Args: {
          p_event_type: string
          p_metadata?: Json
          p_target_user_id: string
        }
        Returns: undefined
      }
      can_access_monitor: { Args: never; Returns: boolean }
      can_access_tenant_row: { Args: { row_tenant: string }; Returns: boolean }
      can_invite_more_users: { Args: { p_tenant: string }; Returns: boolean }
      cleanup_ai_usage_log: { Args: never; Returns: undefined }
      collect_db_metrics_snapshot: { Args: never; Returns: undefined }
      collect_tenant_daily_metrics: { Args: never; Returns: undefined }
      create_access_invite: {
        Args: {
          p_access_status?: string
          p_email: string
          p_funcionario_id: number
          p_role?: string
        }
        Returns: string
      }
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
      current_department_id: { Args: never; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      current_user_department_id: { Args: never; Returns: string }
      decrypt_api_key: {
        Args: { p_encrypted: string; p_encryption_key: string }
        Returns: string
      }
      dismiss_notification: {
        Args: { p_recipient_id: string }
        Returns: undefined
      }
      email_domain: { Args: { email: string }; Returns: string }
      encrypt_api_key: {
        Args: { p_encryption_key: string; p_key: string }
        Returns: string
      }
      exec_db_health_query: { Args: { query_text: string }; Returns: Json }
      exec_db_maintenance: { Args: { action: string }; Returns: string }
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
      get_ai_cost_metrics: {
        Args: { p_date_from?: string; p_date_to?: string; p_tenant_id?: string }
        Returns: Json
      }
      get_ai_projection: { Args: never; Returns: Json }
      get_attendance_metrics: {
        Args: {
          p_agent_id?: string
          p_department_id?: string
          p_from: string
          p_tenant_id: string
          p_to: string
        }
        Returns: Json
      }
      get_database_projection: { Args: never; Returns: Json }
      get_duplicate_contacts: {
        Args: { p_tenant_id: string }
        Returns: {
          conversations_a: number
          conversations_b: number
          id_a: string
          id_b: string
          last_message_a: string
          last_message_b: string
          name_a: string
          name_b: string
          phone_a: string
          phone_b: string
        }[]
      }
      get_instance_secrets: { Args: { p_instance_id: string }; Returns: Json }
      get_messages_projection: { Args: never; Returns: Json }
      get_my_access_context: {
        Args: never
        Returns: {
          department_id: string
          department_is_active: boolean
          department_name: string
          funcionario_email: string
          funcionario_id: number
          funcionario_nome: string
          is_super_admin: boolean
          role: string
          tenant_id: string
          user_id: string
        }[]
      }
      get_my_preferences: {
        Args: { p_department_id?: string }
        Returns: {
          prefer_department_overrides: boolean
          signature_name: string
          sound_enabled: boolean
          visual_notifications_enabled: boolean
        }[]
      }
      get_storage_metrics: { Args: never; Returns: Json }
      get_storage_projection: { Args: never; Returns: Json }
      get_tenant_access_users: {
        Args: never
        Returns: {
          access_status: string
          department_id: string
          department_is_active: boolean
          department_name: string
          email: string
          funcionario_ativo: boolean
          funcionario_email: string
          funcionario_id: number
          funcionario_nome: string
          is_super_admin: boolean
          role: string
          status: string
          tenant_id: string
          user_id: string
        }[]
      }
      get_tenant_departments: {
        Args: never
        Returns: {
          default_instance_id: string
          id: string
          is_active: boolean
          name: string
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
      get_today_metrics:
        | { Args: never; Returns: Json }
        | { Args: { p_tenant_id?: string }; Returns: Json }
      get_transfer_agents: {
        Args: never
        Returns: {
          department_id: string
          department_name: string
          is_super_admin: boolean
          nome: string
          role: string
          status: string
          user_id: string
        }[]
      }
      get_ura_departments: {
        Args: never
        Returns: {
          default_instance_id: string
          id: string
          name: string
        }[]
      }
      is_admin_or_head: { Args: never; Returns: boolean }
      is_current_user_active: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_active_member: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: never; Returns: boolean }
      mark_notification_read: {
        Args: { p_recipient_id: string }
        Returns: undefined
      }
      merge_whatsapp_contacts: {
        Args: { p_keep_id: string; p_merge_id: string; p_tenant_id: string }
        Returns: undefined
      }
      next_support_attendance_seq: {
        Args: { p_tenant: string }
        Returns: number
      }
      norm_txt: { Args: { t: string }; Returns: string }
      process_maintenance_queue: { Args: never; Returns: undefined }
      require_active_profile: { Args: never; Returns: boolean }
      search_conversations_by_contact: {
        Args: {
          p_instance_ids?: string[]
          p_limit?: number
          p_search: string
          p_tenant_id: string
        }
        Returns: {
          assigned_to: string
          category: string
          contact_id: string
          contact_instance_id: string
          contact_is_group: boolean
          contact_name: string
          contact_phone: string
          contact_profile_picture_url: string
          contact_tags: string[]
          created_at: string
          department_id: string
          id: string
          instance_id: string
          is_last_message_from_me: boolean
          last_message_at: string
          last_message_preview: string
          opened_out_of_hours: boolean
          priority: string
          status: string
          tenant_id: string
          unread_count: number
          updated_at: string
        }[]
      }
      search_messages_by_content:
        | {
            Args: {
              p_days_back?: number
              p_department_id?: string
              p_limit?: number
              p_search: string
              p_tenant_id: string
            }
            Returns: {
              contact_name: string
              contact_phone: string
              contact_profile_picture_url: string
              content: string
              conversation_id: string
              instance_id: string
              is_from_me: boolean
              message_ext_id: string
              message_id: string
              message_timestamp: string
            }[]
          }
        | {
            Args: {
              p_days_back?: number
              p_instance_ids?: string[]
              p_limit?: number
              p_search: string
              p_tenant_id: string
            }
            Returns: {
              contact_name: string
              contact_phone: string
              contact_profile_picture_url: string
              content: string
              conversation_id: string
              instance_id: string
              is_from_me: boolean
              message_ext_id: string
              message_id: string
              message_timestamp: string
            }[]
          }
        | {
            Args: {
              p_days_back?: number
              p_limit?: number
              p_search: string
              p_tenant_id: string
            }
            Returns: {
              contact_name: string
              contact_phone: string
              contact_profile_picture_url: string
              content: string
              conversation_id: string
              instance_id: string
              is_from_me: boolean
              message_ext_id: string
              message_id: string
              message_timestamp: string
            }[]
          }
      tenant_user_count: { Args: { p_tenant: string }; Returns: number }
      transfer_conversation_to_agent: {
        Args: {
          p_conversation_id: string
          p_new_assignee: string
          p_reason?: string
        }
        Returns: undefined
      }
      validate_access_invite: {
        Args: { p_invite_id: string }
        Returns: {
          email: string
          funcionario_id: number
          role: string
          tenant_id: string
        }[]
      }
      validate_invite_token: {
        Args: { p_token: string }
        Returns: {
          email: string
          role: string
          tenant_id: string
        }[]
      }
      vault_create_secret: {
        Args: { p_name: string; p_secret: string }
        Returns: string
      }
      vault_update_secret: {
        Args: { p_id: string; p_secret: string }
        Returns: undefined
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
      support_ticket_prioridade: "baixa" | "media" | "alta" | "urgente"
      support_ticket_status:
        | "aberto"
        | "agendado"
        | "em_andamento"
        | "aguardando_terceiro"
        | "concluido"
        | "cancelado"
      support_ticket_tipo: "cliente" | "fornecedor"
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
      support_ticket_prioridade: ["baixa", "media", "alta", "urgente"],
      support_ticket_status: [
        "aberto",
        "agendado",
        "em_andamento",
        "aguardando_terceiro",
        "concluido",
        "cancelado",
      ],
      support_ticket_tipo: ["cliente", "fornecedor"],
    },
  },
} as const
