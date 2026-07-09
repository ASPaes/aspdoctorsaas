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
          extra_alert_phones: string[]
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
          extra_alert_phones?: string[]
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
          extra_alert_phones?: string[]
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
          acceptance_timeout_seconds: number | null
          created_at: string
          department_id: string | null
          excluded_agents: string[]
          fallback_agent_id: string | null
          fixed_agent_id: string | null
          id: string
          instance_id: string | null
          is_active: boolean
          name: string
          overflow_policy: string
          required_skills: string[]
          respect_business_hours: boolean
          round_robin_agents: string[] | null
          round_robin_last_index: number
          rule_type: string
          strategy: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          acceptance_timeout_seconds?: number | null
          created_at?: string
          department_id?: string | null
          excluded_agents?: string[]
          fallback_agent_id?: string | null
          fixed_agent_id?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean
          name: string
          overflow_policy?: string
          required_skills?: string[]
          respect_business_hours?: boolean
          round_robin_agents?: string[] | null
          round_robin_last_index?: number
          rule_type?: string
          strategy?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          acceptance_timeout_seconds?: number | null
          created_at?: string
          department_id?: string | null
          excluded_agents?: string[]
          fallback_agent_id?: string | null
          fixed_agent_id?: string | null
          id?: string
          instance_id?: string | null
          is_active?: boolean
          name?: string
          overflow_policy?: string
          required_skills?: string[]
          respect_business_hours?: boolean
          round_robin_agents?: string[] | null
          round_robin_last_index?: number
          rule_type?: string
          strategy?: string | null
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
          {
            foreignKeyName: "fk_assignment_rules_department"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_analysis_queue: {
        Row: {
          attempts: number
          attendance_id: string
          enqueued_at: string
          last_error: string | null
          processed_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          attempts?: number
          attendance_id: string
          enqueued_at?: string
          last_error?: string | null
          processed_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          attempts?: number
          attendance_id?: string
          enqueued_at?: string
          last_error?: string | null
          processed_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_analysis_queue_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: true
            referencedRelation: "support_attendances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_analysis_queue_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: true
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["attendance_id"]
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
          department_id: string | null
          id: string
          is_closed: boolean
          name: string | null
          tenant_id: string
          type: string
          updated_at: string
          use_template: boolean
        }
        Insert: {
          created_at?: string
          date: string
          department_id?: string | null
          id?: string
          is_closed?: boolean
          name?: string | null
          tenant_id: string
          type: string
          updated_at?: string
          use_template?: boolean
        }
        Update: {
          created_at?: string
          date?: string
          department_id?: string | null
          id?: string
          is_closed?: boolean
          name?: string | null
          tenant_id?: string
          type?: string
          updated_at?: string
          use_template?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_exceptions_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
        ]
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
      catalog_template_items: {
        Row: {
          created_at: string
          id: string
          payload: Json
          sort_order: number
          template_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload: Json
          sort_order?: number
          template_id: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "catalog_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_templates: {
        Row: {
          created_at: string
          created_by: string | null
          descricao: string | null
          id: string
          is_published: boolean
          kind: string
          nome: string
          origem: string
          source_tenant_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          is_published?: boolean
          kind: string
          nome: string
          origem?: string
          source_tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          descricao?: string | null
          id?: string
          is_published?: boolean
          kind?: string
          nome?: string
          origem?: string
          source_tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_templates_source_tenant_id_fkey"
            columns: ["source_tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          latitude: number | null
          longitude: number | null
          nome: string
        }
        Insert: {
          codigo_ibge?: string | null
          estado_id: number
          id?: number
          latitude?: number | null
          longitude?: number | null
          nome: string
        }
        Update: {
          codigo_ibge?: string | null
          estado_id?: number
          id?: number
          latitude?: number | null
          longitude?: number | null
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
      client_alert_audit: {
        Row: {
          action: string
          alert_block_behavior: string | null
          alert_id: string | null
          alert_kind: string
          alert_titulo: string
          cliente_id: string | null
          contact_id: string | null
          conversation_id: string | null
          id: string
          performed_at: string
          performed_by: string
          tenant_id: string
        }
        Insert: {
          action?: string
          alert_block_behavior?: string | null
          alert_id?: string | null
          alert_kind: string
          alert_titulo: string
          cliente_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          id?: string
          performed_at?: string
          performed_by: string
          tenant_id: string
        }
        Update: {
          action?: string
          alert_block_behavior?: string | null
          alert_id?: string | null
          alert_kind?: string
          alert_titulo?: string
          cliente_id?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          id?: string
          performed_at?: string
          performed_by?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_alert_audit_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "client_alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_alert_audit_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      client_alerts: {
        Row: {
          ativo: boolean
          block_behavior: string | null
          cliente_id: string | null
          contact_id: string | null
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          kind: string
          mensagem: string
          resolved_at: string | null
          resolved_by: string | null
          tenant_id: string
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          block_behavior?: string | null
          cliente_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          kind: string
          mensagem: string
          resolved_at?: string | null
          resolved_by?: string | null
          tenant_id: string
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          block_behavior?: string | null
          cliente_id?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          kind?: string
          mensagem?: string
          resolved_at?: string | null
          resolved_by?: string | null
          tenant_id?: string
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_alerts_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_alerts_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_alerts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      cliente_produto_modulos: {
        Row: {
          ativo: boolean
          cliente_produto_id: string
          created_at: string
          data_ativacao: string | null
          data_inativacao: string | null
          id: string
          modulo_id: string
          quantidade: number
          tenant_id: string
          updated_at: string
          vlr_ativacao: number | null
          vlr_custo: number | null
          vlr_mensal: number | null
        }
        Insert: {
          ativo?: boolean
          cliente_produto_id: string
          created_at?: string
          data_ativacao?: string | null
          data_inativacao?: string | null
          id?: string
          modulo_id: string
          quantidade?: number
          tenant_id: string
          updated_at?: string
          vlr_ativacao?: number | null
          vlr_custo?: number | null
          vlr_mensal?: number | null
        }
        Update: {
          ativo?: boolean
          cliente_produto_id?: string
          created_at?: string
          data_ativacao?: string | null
          data_inativacao?: string | null
          id?: string
          modulo_id?: string
          quantidade?: number
          tenant_id?: string
          updated_at?: string
          vlr_ativacao?: number | null
          vlr_custo?: number | null
          vlr_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_produto_modulos_cliente_produto_id_fkey"
            columns: ["cliente_produto_id"]
            isOneToOne: false
            referencedRelation: "cliente_produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produto_modulos_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "produto_modulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produto_modulos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cliente_produtos: {
        Row: {
          ativo: boolean
          cliente_id: string
          codigo_fornecedor: string | null
          created_at: string
          data_ativacao: string | null
          data_cancelamento: string | null
          data_fim: string | null
          data_proximo_reajuste: string | null
          data_venda: string | null
          dia_vencimento: number | null
          forma_pagamento_ativacao_id: number | null
          forma_pagamento_mensalidade_id: number | null
          fornecedor_id: number | null
          funcionario_id: number | null
          id: string
          link_portal_fornecedor: string | null
          modelo_contrato_id: number | null
          observacoes_contratuais: string | null
          origem_venda_id: number | null
          prazo_meses: number | null
          produto_id: number
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          tenant_id: string
          updated_at: string
          vlr_ativacao: number | null
          vlr_custo: number | null
          vlr_mensal: number | null
        }
        Insert: {
          ativo?: boolean
          cliente_id: string
          codigo_fornecedor?: string | null
          created_at?: string
          data_ativacao?: string | null
          data_cancelamento?: string | null
          data_fim?: string | null
          data_proximo_reajuste?: string | null
          data_venda?: string | null
          dia_vencimento?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
          funcionario_id?: number | null
          id?: string
          link_portal_fornecedor?: string | null
          modelo_contrato_id?: number | null
          observacoes_contratuais?: string | null
          origem_venda_id?: number | null
          prazo_meses?: number | null
          produto_id: number
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          tenant_id: string
          updated_at?: string
          vlr_ativacao?: number | null
          vlr_custo?: number | null
          vlr_mensal?: number | null
        }
        Update: {
          ativo?: boolean
          cliente_id?: string
          codigo_fornecedor?: string | null
          created_at?: string
          data_ativacao?: string | null
          data_cancelamento?: string | null
          data_fim?: string | null
          data_proximo_reajuste?: string | null
          data_venda?: string | null
          dia_vencimento?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
          funcionario_id?: number | null
          id?: string
          link_portal_fornecedor?: string | null
          modelo_contrato_id?: number | null
          observacoes_contratuais?: string | null
          origem_venda_id?: number | null
          prazo_meses?: number | null
          produto_id?: number
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          tenant_id?: string
          updated_at?: string
          vlr_ativacao?: number | null
          vlr_custo?: number | null
          vlr_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cliente_produtos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_forma_pagamento_ativacao_id_fkey"
            columns: ["forma_pagamento_ativacao_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_forma_pagamento_mensalidade_id_fkey"
            columns: ["forma_pagamento_mensalidade_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_modelo_contrato_id_fkey"
            columns: ["modelo_contrato_id"]
            isOneToOne: false
            referencedRelation: "modelos_contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_origem_venda_id_fkey"
            columns: ["origem_venda_id"]
            isOneToOne: false
            referencedRelation: "origens_venda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cliente_produtos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          _deprecated_codigo_fornecedor: string | null
          _deprecated_link_portal_fornecedor: string | null
          area_atuacao_id: number | null
          bairro: string | null
          cancelado: boolean
          cep: string | null
          cert_a1_ultima_venda_em: string | null
          cert_a1_ultimo_vendedor_id: number | null
          cert_a1_vencimento: string | null
          cidade_id: number | null
          cnpj: string | null
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
          data_reajuste: string | null
          data_reativacao: string | null
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
          matriz_id: string | null
          mensalidade: number | null
          modelo_contrato_id: number | null
          motivo_cancelamento_id: number | null
          nome_fantasia: string | null
          numero: string | null
          observacao_cancelamento: string | null
          observacao_cliente: string | null
          observacao_negociacao: string | null
          observacao_reativacao: string | null
          origem_venda_id: number | null
          produto_id: number | null
          razao_social: string | null
          reativado_por_user_id: string | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id: number | null
          setup_completo: boolean
          telefone_contato: string | null
          telefone_whatsapp: string | null
          telefone_whatsapp_contato: string | null
          tenant_id: string | null
          unidade_base_id: number | null
          updated_at: string
          valor_ativacao: number | null
        }
        Insert: {
          _deprecated_codigo_fornecedor?: string | null
          _deprecated_link_portal_fornecedor?: string | null
          area_atuacao_id?: number | null
          bairro?: string | null
          cancelado?: boolean
          cep?: string | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: number | null
          cert_a1_vencimento?: string | null
          cidade_id?: number | null
          cnpj?: string | null
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
          data_reajuste?: string | null
          data_reativacao?: string | null
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
          matriz_id?: string | null
          mensalidade?: number | null
          modelo_contrato_id?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          numero?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          observacao_reativacao?: string | null
          origem_venda_id?: number | null
          produto_id?: number | null
          razao_social?: string | null
          reativado_por_user_id?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          setup_completo?: boolean
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          telefone_whatsapp_contato?: string | null
          tenant_id?: string | null
          unidade_base_id?: number | null
          updated_at?: string
          valor_ativacao?: number | null
        }
        Update: {
          _deprecated_codigo_fornecedor?: string | null
          _deprecated_link_portal_fornecedor?: string | null
          area_atuacao_id?: number | null
          bairro?: string | null
          cancelado?: boolean
          cep?: string | null
          cert_a1_ultima_venda_em?: string | null
          cert_a1_ultimo_vendedor_id?: number | null
          cert_a1_vencimento?: string | null
          cidade_id?: number | null
          cnpj?: string | null
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
          data_reajuste?: string | null
          data_reativacao?: string | null
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
          matriz_id?: string | null
          mensalidade?: number | null
          modelo_contrato_id?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          numero?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          observacao_reativacao?: string | null
          origem_venda_id?: number | null
          produto_id?: number | null
          razao_social?: string | null
          reativado_por_user_id?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          setup_completo?: boolean
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
      clientes_reativacoes_historico: {
        Row: {
          cliente_id: string
          criado_em: string
          data_cancelamento_anterior: string | null
          data_reativacao: string
          id: string
          mensalidade_reativada: number
          motivo: string | null
          motivo_cancelamento_anterior_id: number | null
          observacao: string | null
          reativado_por: string
          tenant_id: string
        }
        Insert: {
          cliente_id: string
          criado_em?: string
          data_cancelamento_anterior?: string | null
          data_reativacao: string
          id?: string
          mensalidade_reativada: number
          motivo?: string | null
          motivo_cancelamento_anterior_id?: number | null
          observacao?: string | null
          reativado_por: string
          tenant_id: string
        }
        Update: {
          cliente_id?: string
          criado_em?: string
          data_cancelamento_anterior?: string | null
          data_reativacao?: string
          id?: string
          mensalidade_reativada?: number
          motivo?: string | null
          motivo_cancelamento_anterior_id?: number | null
          observacao?: string | null
          reativado_por?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_reativacoes_historico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_reativacoes_historico_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
        ]
      }
      cnpj_cache: {
        Row: {
          cnpj: string
          expires_at: string
          fetched_at: string
          payload: Json
          source: string
        }
        Insert: {
          cnpj: string
          expires_at?: string
          fetched_at?: string
          payload: Json
          source: string
        }
        Update: {
          cnpj?: string
          expires_at?: string
          fetched_at?: string
          payload?: Json
          source?: string
        }
        Relationships: []
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
          churn_alert_enabled: boolean
          churn_alert_instance_id: string | null
          churn_alert_keywords: string[]
          churn_alert_phone_numbers: string[]
          churn_alert_recipients: Json
          created_at: string
          custo_fixo_percentual: number
          group_require_ticket_on_close: boolean
          id: number
          imposto_percentual: number
          notification_defaults: Json
          oncall_escalation_window_minutes: number
          oncall_message_template: string | null
          oncall_min_customer_messages: number
          oncall_min_elapsed_seconds: number
          oncall_phone_number: string | null
          oncall_repeat_cooldown_minutes: number
          oncall_urgency_keywords: Json
          support_agent_alert_enabled: boolean
          support_agent_alert_minutes: number
          support_agent_no_response_close_enabled: boolean
          support_agent_no_response_close_minutes: number
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
          support_ura_confirmation_template: string
          support_ura_default_department_id: string | null
          support_ura_enabled: boolean
          support_ura_invalid_option_template: string
          support_ura_timeout_minutes: number
          support_ura_welcome_template: string
          support_waiting_ack_limit: number
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
          churn_alert_enabled?: boolean
          churn_alert_instance_id?: string | null
          churn_alert_keywords?: string[]
          churn_alert_phone_numbers?: string[]
          churn_alert_recipients?: Json
          created_at?: string
          custo_fixo_percentual?: number
          group_require_ticket_on_close?: boolean
          id?: number
          imposto_percentual?: number
          notification_defaults?: Json
          oncall_escalation_window_minutes?: number
          oncall_message_template?: string | null
          oncall_min_customer_messages?: number
          oncall_min_elapsed_seconds?: number
          oncall_phone_number?: string | null
          oncall_repeat_cooldown_minutes?: number
          oncall_urgency_keywords?: Json
          support_agent_alert_enabled?: boolean
          support_agent_alert_minutes?: number
          support_agent_no_response_close_enabled?: boolean
          support_agent_no_response_close_minutes?: number
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
          support_ura_confirmation_template?: string
          support_ura_default_department_id?: string | null
          support_ura_enabled?: boolean
          support_ura_invalid_option_template?: string
          support_ura_timeout_minutes?: number
          support_ura_welcome_template?: string
          support_waiting_ack_limit?: number
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
          churn_alert_enabled?: boolean
          churn_alert_instance_id?: string | null
          churn_alert_keywords?: string[]
          churn_alert_phone_numbers?: string[]
          churn_alert_recipients?: Json
          created_at?: string
          custo_fixo_percentual?: number
          group_require_ticket_on_close?: boolean
          id?: number
          imposto_percentual?: number
          notification_defaults?: Json
          oncall_escalation_window_minutes?: number
          oncall_message_template?: string | null
          oncall_min_customer_messages?: number
          oncall_min_elapsed_seconds?: number
          oncall_phone_number?: string | null
          oncall_repeat_cooldown_minutes?: number
          oncall_urgency_keywords?: Json
          support_agent_alert_enabled?: boolean
          support_agent_alert_minutes?: number
          support_agent_no_response_close_enabled?: boolean
          support_agent_no_response_close_minutes?: number
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
          support_ura_confirmation_template?: string
          support_ura_default_department_id?: string | null
          support_ura_enabled?: boolean
          support_ura_invalid_option_template?: string
          support_ura_timeout_minutes?: number
          support_ura_welcome_template?: string
          support_waiting_ack_limit?: number
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
      conselho_aba_templates: {
        Row: {
          ativo: boolean
          contexto_objetivo: string | null
          created_at: string
          custo_estimado_brl: number
          data_schema_json: Json
          display_label: string
          max_tokens: number
          objetivo_aba: string | null
          output_format_prompt: string
          personas_sugeridas_default: string[] | null
          prompt_principal: string
          tab_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          contexto_objetivo?: string | null
          created_at?: string
          custo_estimado_brl?: number
          data_schema_json?: Json
          display_label: string
          max_tokens?: number
          objetivo_aba?: string | null
          output_format_prompt: string
          personas_sugeridas_default?: string[] | null
          prompt_principal: string
          tab_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          contexto_objetivo?: string | null
          created_at?: string
          custo_estimado_brl?: number
          data_schema_json?: Json
          display_label?: string
          max_tokens?: number
          objetivo_aba?: string | null
          output_format_prompt?: string
          personas_sugeridas_default?: string[] | null
          prompt_principal?: string
          tab_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      conselho_analises: {
        Row: {
          alertas_factuais: Json
          cache_hit_de: string | null
          custo_estimado_usd: number | null
          dados_snapshot: Json
          duracao_ms: number | null
          error_message: string | null
          expires_at: string
          filtros_aplicados: Json
          foco_mes: string | null
          id: string
          input_hash: string
          model_usado: string | null
          output_markdown: string | null
          personas_ids: string[]
          personas_snapshot: Json
          prompt_final: string
          provider_usado: string | null
          solicitado_em: string
          solicitado_por: string | null
          status: string
          tab_key: string
          tenant_id: string
          tipo: string
          tokens_in: number | null
          tokens_out: number | null
          tom: string | null
        }
        Insert: {
          alertas_factuais?: Json
          cache_hit_de?: string | null
          custo_estimado_usd?: number | null
          dados_snapshot: Json
          duracao_ms?: number | null
          error_message?: string | null
          expires_at: string
          filtros_aplicados?: Json
          foco_mes?: string | null
          id?: string
          input_hash: string
          model_usado?: string | null
          output_markdown?: string | null
          personas_ids?: string[]
          personas_snapshot?: Json
          prompt_final: string
          provider_usado?: string | null
          solicitado_em?: string
          solicitado_por?: string | null
          status?: string
          tab_key: string
          tenant_id: string
          tipo?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tom?: string | null
        }
        Update: {
          alertas_factuais?: Json
          cache_hit_de?: string | null
          custo_estimado_usd?: number | null
          dados_snapshot?: Json
          duracao_ms?: number | null
          error_message?: string | null
          expires_at?: string
          filtros_aplicados?: Json
          foco_mes?: string | null
          id?: string
          input_hash?: string
          model_usado?: string | null
          output_markdown?: string | null
          personas_ids?: string[]
          personas_snapshot?: Json
          prompt_final?: string
          provider_usado?: string | null
          solicitado_em?: string
          solicitado_por?: string | null
          status?: string
          tab_key?: string
          tenant_id?: string
          tipo?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tom?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conselho_analises_cache_hit_de_fkey"
            columns: ["cache_hit_de"]
            isOneToOne: false
            referencedRelation: "conselho_analises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conselho_analises_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      conselho_personas: {
        Row: {
          ativo: boolean
          avatar_url: string | null
          bio_curta: string
          created_at: string
          created_by: string | null
          especialidade_tags: string[]
          familia: string
          id: string
          nome_funcional: string
          nome_inspiracao: string | null
          ordem: number
          referencia_publica_br: string | null
          referencia_publica_int: string | null
          slug: string
          system_prompt_chunk: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ativo?: boolean
          avatar_url?: string | null
          bio_curta: string
          created_at?: string
          created_by?: string | null
          especialidade_tags?: string[]
          familia?: string
          id?: string
          nome_funcional: string
          nome_inspiracao?: string | null
          ordem?: number
          referencia_publica_br?: string | null
          referencia_publica_int?: string | null
          slug: string
          system_prompt_chunk: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ativo?: boolean
          avatar_url?: string | null
          bio_curta?: string
          created_at?: string
          created_by?: string | null
          especialidade_tags?: string[]
          familia?: string
          id?: string
          nome_funcional?: string
          nome_inspiracao?: string | null
          ordem?: number
          referencia_publica_br?: string | null
          referencia_publica_int?: string | null
          slug?: string
          system_prompt_chunk?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      contrato_eventos: {
        Row: {
          acao: string
          cliente_id: string
          contrato_id: string
          created_at: string
          data_acao: string
          id: string
          mensalidade_cliente_snapshot: number | null
          mensalidade_contrato_snapshot: number | null
          motivo_cancelamento_id: number | null
          movimento_mrr_id: string | null
          observacao: string | null
          produtos_afetados: Json | null
          tenant_id: string
          usuario_id: string | null
        }
        Insert: {
          acao: string
          cliente_id: string
          contrato_id: string
          created_at?: string
          data_acao?: string
          id?: string
          mensalidade_cliente_snapshot?: number | null
          mensalidade_contrato_snapshot?: number | null
          motivo_cancelamento_id?: number | null
          movimento_mrr_id?: string | null
          observacao?: string | null
          produtos_afetados?: Json | null
          tenant_id: string
          usuario_id?: string | null
        }
        Update: {
          acao?: string
          cliente_id?: string
          contrato_id?: string
          created_at?: string
          data_acao?: string
          id?: string
          mensalidade_cliente_snapshot?: number | null
          mensalidade_contrato_snapshot?: number | null
          motivo_cancelamento_id?: number | null
          movimento_mrr_id?: string | null
          observacao?: string | null
          produtos_afetados?: Json | null
          tenant_id?: string
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contrato_eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_eventos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_eventos_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_eventos_motivo_cancelamento_id_fkey"
            columns: ["motivo_cancelamento_id"]
            isOneToOne: false
            referencedRelation: "motivos_cancelamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_eventos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contrato_itens: {
        Row: {
          cliente_produto_id: string | null
          contrato_id: string
          descricao: string | null
          id: string
          modulo_id: string | null
          vlr_ativacao: number | null
          vlr_mensal: number | null
        }
        Insert: {
          cliente_produto_id?: string | null
          contrato_id: string
          descricao?: string | null
          id?: string
          modulo_id?: string | null
          vlr_ativacao?: number | null
          vlr_mensal?: number | null
        }
        Update: {
          cliente_produto_id?: string | null
          contrato_id?: string
          descricao?: string | null
          id?: string
          modulo_id?: string | null
          vlr_ativacao?: number | null
          vlr_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contrato_itens_cliente_produto_id_fkey"
            columns: ["cliente_produto_id"]
            isOneToOne: false
            referencedRelation: "cliente_produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_itens_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contrato_itens_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "produto_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      contratos: {
        Row: {
          arquivo_nome: string | null
          arquivo_url: string | null
          assinado_em: string | null
          cancelado_em: string | null
          cliente_id: string
          contrato_pai_id: string | null
          created_at: string
          data_fim: string | null
          data_inicio: string | null
          data_proximo_reajuste: string | null
          data_venda: string | null
          dia_vencimento: number | null
          fidelidade_meses: number | null
          forma_pagamento_ativacao_id: number | null
          forma_pagamento_mensalidade_id: number | null
          funcionario_id: number | null
          id: string
          indice_reajuste: string | null
          is_implicit: boolean
          link_assinatura: string | null
          modelo_contrato_id: number | null
          motivo_cancelamento: string | null
          multa_rescisoria_pct: number | null
          numero: string
          observacoes: string | null
          origem_venda_id: number | null
          prazo_meses: number | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          status: string
          tenant_id: string
          tipo: Database["public"]["Enums"]["contrato_tipo"]
          updated_at: string
          vlr_total_ativacao: number | null
          vlr_total_mensal: number | null
        }
        Insert: {
          arquivo_nome?: string | null
          arquivo_url?: string | null
          assinado_em?: string | null
          cancelado_em?: string | null
          cliente_id: string
          contrato_pai_id?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          data_proximo_reajuste?: string | null
          data_venda?: string | null
          dia_vencimento?: number | null
          fidelidade_meses?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          funcionario_id?: number | null
          id?: string
          indice_reajuste?: string | null
          is_implicit?: boolean
          link_assinatura?: string | null
          modelo_contrato_id?: number | null
          motivo_cancelamento?: string | null
          multa_rescisoria_pct?: number | null
          numero?: string
          observacoes?: string | null
          origem_venda_id?: number | null
          prazo_meses?: number | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          status?: string
          tenant_id: string
          tipo?: Database["public"]["Enums"]["contrato_tipo"]
          updated_at?: string
          vlr_total_ativacao?: number | null
          vlr_total_mensal?: number | null
        }
        Update: {
          arquivo_nome?: string | null
          arquivo_url?: string | null
          assinado_em?: string | null
          cancelado_em?: string | null
          cliente_id?: string
          contrato_pai_id?: string | null
          created_at?: string
          data_fim?: string | null
          data_inicio?: string | null
          data_proximo_reajuste?: string | null
          data_venda?: string | null
          dia_vencimento?: number | null
          fidelidade_meses?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          funcionario_id?: number | null
          id?: string
          indice_reajuste?: string | null
          is_implicit?: boolean
          link_assinatura?: string | null
          modelo_contrato_id?: number | null
          motivo_cancelamento?: string | null
          multa_rescisoria_pct?: number | null
          numero?: string
          observacoes?: string | null
          origem_venda_id?: number | null
          prazo_meses?: number | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          status?: string
          tenant_id?: string
          tipo?: Database["public"]["Enums"]["contrato_tipo"]
          updated_at?: string
          vlr_total_ativacao?: number | null
          vlr_total_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contratos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_contrato_pai_id_fkey"
            columns: ["contrato_pai_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_forma_pagamento_ativacao_id_fkey"
            columns: ["forma_pagamento_ativacao_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_forma_pagamento_mensalidade_id_fkey"
            columns: ["forma_pagamento_mensalidade_id"]
            isOneToOne: false
            referencedRelation: "formas_pagamento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_modelo_contrato_id_fkey"
            columns: ["modelo_contrato_id"]
            isOneToOne: false
            referencedRelation: "modelos_contrato"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_origem_venda_id_fkey"
            columns: ["origem_venda_id"]
            isOneToOne: false
            referencedRelation: "origens_venda"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contratos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
      csat_department_templates: {
        Row: {
          created_at: string
          department_id: string
          id: string
          prompt_template: string | null
          reason_prompt_template: string | null
          tenant_id: string
          thanks_template: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          department_id: string
          id?: string
          prompt_template?: string | null
          reason_prompt_template?: string | null
          tenant_id: string
          thanks_template?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          department_id?: string
          id?: string
          prompt_template?: string | null
          reason_prompt_template?: string | null
          tenant_id?: string
          thanks_template?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "csat_department_templates_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
        ]
      }
      data_integrity_issues: {
        Row: {
          attendance_id: string | null
          auto_fixed: boolean | null
          conversation_id: string | null
          details: Json | null
          detected_at: string
          fixed_at: string | null
          id: string
          issue_type: string
          tenant_id: string | null
        }
        Insert: {
          attendance_id?: string | null
          auto_fixed?: boolean | null
          conversation_id?: string | null
          details?: Json | null
          detected_at?: string
          fixed_at?: string | null
          id?: string
          issue_type: string
          tenant_id?: string | null
        }
        Update: {
          attendance_id?: string | null
          auto_fixed?: boolean | null
          conversation_id?: string | null
          details?: Json | null
          detected_at?: string
          fixed_at?: string | null
          id?: string
          issue_type?: string
          tenant_id?: string | null
        }
        Relationships: []
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
          categoria_churn: string | null
          descricao: string
          id: number
          tenant_id: string | null
        }
        Insert: {
          categoria_churn?: string | null
          descricao: string
          id?: number
          tenant_id?: string | null
        }
        Update: {
          categoria_churn?: string | null
          descricao?: string
          id?: number
          tenant_id?: string | null
        }
        Relationships: []
      }
      movimentos_mrr: {
        Row: {
          cliente_id: string
          cliente_produto_modulo_id: string | null
          contrato_id: string | null
          criado_em: string
          custo_delta: number
          data_movimento: string
          descricao: string | null
          estornado_por: string | null
          estorno_de: string | null
          fornecedor_id: number | null
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
          cliente_produto_modulo_id?: string | null
          contrato_id?: string | null
          criado_em?: string
          custo_delta?: number
          data_movimento: string
          descricao?: string | null
          estornado_por?: string | null
          estorno_de?: string | null
          fornecedor_id?: number | null
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
          cliente_produto_modulo_id?: string | null
          contrato_id?: string | null
          criado_em?: string
          custo_delta?: number
          data_movimento?: string
          descricao?: string | null
          estornado_por?: string | null
          estorno_de?: string | null
          fornecedor_id?: number | null
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
            foreignKeyName: "movimentos_mrr_cliente_produto_modulo_id_fkey"
            columns: ["cliente_produto_modulo_id"]
            isOneToOne: false
            referencedRelation: "cliente_produto_modulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movimentos_mrr_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
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
            foreignKeyName: "movimentos_mrr_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
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
      notification_conversation_mute: {
        Row: {
          conversation_id: string
          created_at: string
          muted_until: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          muted_until?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          muted_until?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_conversation_mute_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "v_whatsapp_conversations_state"
            referencedColumns: ["conversation_id"]
          },
          {
            foreignKeyName: "notification_conversation_mute_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_conversation_mute_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_conversation_mute_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notification_dispatch_queue: {
        Row: {
          attempts: number
          conversation_id: string
          created_at: string
          error: string | null
          id: string
          message_id: string
          processed_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          attempts?: number
          conversation_id: string
          created_at?: string
          error?: string | null
          id?: string
          message_id: string
          processed_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          attempts?: number
          conversation_id?: string
          created_at?: string
          error?: string | null
          id?: string
          message_id?: string
          processed_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: []
      }
      notification_event_types: {
        Row: {
          ativo: boolean
          categoria: string
          cooldown_minutes: number
          created_at: string
          default_severity: string
          descricao: string | null
          key: string
          label: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string
          cooldown_minutes?: number
          created_at?: string
          default_severity?: string
          descricao?: string | null
          key: string
          label: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          cooldown_minutes?: number
          created_at?: string
          default_severity?: string
          descricao?: string | null
          key?: string
          label?: string
        }
        Relationships: []
      }
      notification_incidents: {
        Row: {
          dedupe_key: string
          event_type_key: string
          first_seen_at: string
          id: string
          last_notified_at: string | null
          last_seen_at: string
          occurrences: number
          resolved_at: string | null
          tenant_id: string
        }
        Insert: {
          dedupe_key: string
          event_type_key: string
          first_seen_at?: string
          id?: string
          last_notified_at?: string | null
          last_seen_at?: string
          occurrences?: number
          resolved_at?: string | null
          tenant_id: string
        }
        Update: {
          dedupe_key?: string
          event_type_key?: string
          first_seen_at?: string
          id?: string
          last_notified_at?: string | null
          last_seen_at?: string
          occurrences?: number
          resolved_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_incidents_event_type_key_fkey"
            columns: ["event_type_key"]
            isOneToOne: false
            referencedRelation: "notification_event_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "notification_incidents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          silent_mode: boolean
          tenant_id: string
          user_id: string
        }
        Insert: {
          delivered_at?: string
          dismissed_at?: string | null
          id?: string
          notification_id: string
          read_at?: string | null
          silent_mode?: boolean
          tenant_id: string
          user_id: string
        }
        Update: {
          delivered_at?: string
          dismissed_at?: string | null
          id?: string
          notification_id?: string
          read_at?: string | null
          silent_mode?: boolean
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
      notification_subscriptions: {
        Row: {
          ativo: boolean
          channels: string[]
          created_at: string
          event_type_key: string
          id: string
          tenant_id: string
          updated_at: string
          user_id: string
          whatsapp_phone: string | null
        }
        Insert: {
          ativo?: boolean
          channels?: string[]
          created_at?: string
          event_type_key: string
          id?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          whatsapp_phone?: string | null
        }
        Update: {
          ativo?: boolean
          channels?: string[]
          created_at?: string
          event_type_key?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          whatsapp_phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_subscriptions_event_type_key_fkey"
            columns: ["event_type_key"]
            isOneToOne: false
            referencedRelation: "notification_event_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "notification_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notification_whatsapp_outbox: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          id: string
          message: string
          notification_id: string | null
          phone: string
          processed_at: string | null
          status: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          message: string
          notification_id?: string | null
          phone: string
          processed_at?: string | null
          status?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          id?: string
          message?: string
          notification_id?: string | null
          phone?: string
          processed_at?: string | null
          status?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_whatsapp_outbox_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_whatsapp_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string
          conversation_id: string | null
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
          conversation_id?: string | null
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
          conversation_id?: string | null
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
      omie_espelho_cadastro: {
        Row: {
          atualizado_em: string
          cnpj_norm: string | null
          codigo_cliente_integracao: string | null
          codigo_cliente_omie: number
          codigo_contrato_omie: number | null
          dia_venc_omie: number | null
          id: string
          omie_inativo: boolean | null
          origem_codigo: string | null
          qtd_contratos_ativos_omie: number | null
          razao_social_omie: string | null
          situacao_contrato: string | null
          tenant_id: string
          valor_omie: number | null
          vigencia_final_omie: string | null
          vigencia_inicial_omie: string | null
        }
        Insert: {
          atualizado_em?: string
          cnpj_norm?: string | null
          codigo_cliente_integracao?: string | null
          codigo_cliente_omie: number
          codigo_contrato_omie?: number | null
          dia_venc_omie?: number | null
          id?: string
          omie_inativo?: boolean | null
          origem_codigo?: string | null
          qtd_contratos_ativos_omie?: number | null
          razao_social_omie?: string | null
          situacao_contrato?: string | null
          tenant_id: string
          valor_omie?: number | null
          vigencia_final_omie?: string | null
          vigencia_inicial_omie?: string | null
        }
        Update: {
          atualizado_em?: string
          cnpj_norm?: string | null
          codigo_cliente_integracao?: string | null
          codigo_cliente_omie?: number
          codigo_contrato_omie?: number | null
          dia_venc_omie?: number | null
          id?: string
          omie_inativo?: boolean | null
          origem_codigo?: string | null
          qtd_contratos_ativos_omie?: number | null
          razao_social_omie?: string | null
          situacao_contrato?: string | null
          tenant_id?: string
          valor_omie?: number | null
          vigencia_final_omie?: string | null
          vigencia_inicial_omie?: string | null
        }
        Relationships: []
      }
      omie_integration: {
        Row: {
          ativo: boolean
          id: string
          integrar_a_partir_de: string | null
          omie_bloqueado_ate: string | null
          sync_automatica_ativa: boolean
          sync_contratos_teste: string[] | null
          sync_lote_tamanho: number
          sync_max_tentativas: number
          tenant_id: string
          ultimo_status: string
          ultimo_teste_at: string | null
          updated_at: string
          vault_secret_id: string | null
        }
        Insert: {
          ativo?: boolean
          id?: string
          integrar_a_partir_de?: string | null
          omie_bloqueado_ate?: string | null
          sync_automatica_ativa?: boolean
          sync_contratos_teste?: string[] | null
          sync_lote_tamanho?: number
          sync_max_tentativas?: number
          tenant_id: string
          ultimo_status?: string
          ultimo_teste_at?: string | null
          updated_at?: string
          vault_secret_id?: string | null
        }
        Update: {
          ativo?: boolean
          id?: string
          integrar_a_partir_de?: string | null
          omie_bloqueado_ate?: string | null
          sync_automatica_ativa?: boolean
          sync_contratos_teste?: string[] | null
          sync_lote_tamanho?: number
          sync_max_tentativas?: number
          tenant_id?: string
          ultimo_status?: string
          ultimo_teste_at?: string | null
          updated_at?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      omie_sync_fila: {
        Row: {
          contrato_id: string
          enfileirado_em: string
          id: string
          origem: string | null
          processado_em: string | null
          proxima_tentativa_em: string
          status: string
          tenant_id: string
          tentativas: number
          ultimo_erro: string | null
        }
        Insert: {
          contrato_id: string
          enfileirado_em?: string
          id?: string
          origem?: string | null
          processado_em?: string | null
          proxima_tentativa_em?: string
          status?: string
          tenant_id: string
          tentativas?: number
          ultimo_erro?: string | null
        }
        Update: {
          contrato_id?: string
          enfileirado_em?: string
          id?: string
          origem?: string | null
          processado_em?: string | null
          proxima_tentativa_em?: string
          status?: string
          tenant_id?: string
          tentativas?: number
          ultimo_erro?: string | null
        }
        Relationships: []
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
      permission_audit: {
        Row: {
          action: string
          changed_at: string
          changed_by: string | null
          id: number
          new_value: Json | null
          old_value: Json | null
          resource_key: string
          role: string
          tenant_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by?: string | null
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          resource_key: string
          role: string
          tenant_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string | null
          id?: number
          new_value?: Json | null
          old_value?: Json | null
          resource_key?: string
          role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_modulos: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          margem_percentual: number | null
          nome: string
          produto_id: number
          tenant_id: string
          updated_at: string
          vlr_custo: number | null
          vlr_venda: number | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          margem_percentual?: number | null
          nome: string
          produto_id: number
          tenant_id: string
          updated_at?: string
          vlr_custo?: number | null
          vlr_venda?: number | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          margem_percentual?: number | null
          nome?: string
          produto_id?: number
          tenant_id?: string
          updated_at?: string
          vlr_custo?: number | null
          vlr_venda?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "produto_modulos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produto_modulos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          id: number
          nome: string
          omie_conta_corrente_codigo: number | null
          omie_dia_faturamento: number | null
          omie_numero_parcelas: number | null
          omie_permite_servidor_nuvem: boolean | null
          omie_servico_codigo: number | null
          omie_tipo_faturamento_codigo: string | null
          tenant_id: string | null
        }
        Insert: {
          id?: number
          nome: string
          omie_conta_corrente_codigo?: number | null
          omie_dia_faturamento?: number | null
          omie_numero_parcelas?: number | null
          omie_permite_servidor_nuvem?: boolean | null
          omie_servico_codigo?: number | null
          omie_tipo_faturamento_codigo?: string | null
          tenant_id?: string | null
        }
        Update: {
          id?: number
          nome?: string
          omie_conta_corrente_codigo?: number | null
          omie_dia_faturamento?: number | null
          omie_numero_parcelas?: number | null
          omie_permite_servidor_nuvem?: boolean | null
          omie_servico_codigo?: number | null
          omie_tipo_faturamento_codigo?: string | null
          tenant_id?: string | null
        }
        Relationships: []
      }
      profile_unidades: {
        Row: {
          created_at: string
          tenant_id: string
          unidade_base_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          tenant_id: string
          unidade_base_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          tenant_id?: string
          unidade_base_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_unidades_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          access_status: string
          acesso_todas_unidades: boolean
          allowed_domain: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          funcionario_id: number | null
          invited_at: string | null
          invited_by: string | null
          is_super_admin: boolean
          max_concurrent_chats: number | null
          releases_visto_em: string | null
          role: string
          skills: string[]
          status: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          access_status?: string
          acesso_todas_unidades?: boolean
          allowed_domain?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          funcionario_id?: number | null
          invited_at?: string | null
          invited_by?: string | null
          is_super_admin?: boolean
          max_concurrent_chats?: number | null
          releases_visto_em?: string | null
          role?: string
          skills?: string[]
          status?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          access_status?: string
          acesso_todas_unidades?: boolean
          allowed_domain?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          funcionario_id?: number | null
          invited_at?: string | null
          invited_by?: string | null
          is_super_admin?: boolean
          max_concurrent_chats?: number | null
          releases_visto_em?: string | null
          role?: string
          skills?: string[]
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          tenant_id: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          tenant_id: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          tenant_id?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reajuste_contratos: {
        Row: {
          cliente_id: string
          contrato_evento_id: string | null
          contrato_id: string
          created_at: string
          data_proximo_reajuste_antes: string | null
          id: string
          movimento_mrr_id: string | null
          percentual_aplicado: number
          reajuste_id: string
          selecionado: boolean
          snapshot_antes: Json
          vlr_delta: number
          vlr_mensal_antes: number
          vlr_mensal_depois: number
        }
        Insert: {
          cliente_id: string
          contrato_evento_id?: string | null
          contrato_id: string
          created_at?: string
          data_proximo_reajuste_antes?: string | null
          id?: string
          movimento_mrr_id?: string | null
          percentual_aplicado: number
          reajuste_id: string
          selecionado?: boolean
          snapshot_antes?: Json
          vlr_delta?: number
          vlr_mensal_antes: number
          vlr_mensal_depois?: number
        }
        Update: {
          cliente_id?: string
          contrato_evento_id?: string | null
          contrato_id?: string
          created_at?: string
          data_proximo_reajuste_antes?: string | null
          id?: string
          movimento_mrr_id?: string | null
          percentual_aplicado?: number
          reajuste_id?: string
          selecionado?: boolean
          snapshot_antes?: Json
          vlr_delta?: number
          vlr_mensal_antes?: number
          vlr_mensal_depois?: number
        }
        Relationships: [
          {
            foreignKeyName: "reajuste_contratos_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "contratos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reajuste_contratos_reajuste_id_fkey"
            columns: ["reajuste_id"]
            isOneToOne: false
            referencedRelation: "reajustes"
            referencedColumns: ["id"]
          },
        ]
      }
      reajustes: {
        Row: {
          created_at: string
          data_lancamento: string
          id: string
          percentual_padrao: number
          periodo_fim: string
          periodo_inicio: string
          qtd_contratos: number
          status: string
          tenant_id: string
          updated_at: string
          usuario_id: string
          vlr_mensal_total_antes: number
          vlr_mensal_total_depois: number
          vlr_reajuste_total: number
        }
        Insert: {
          created_at?: string
          data_lancamento?: string
          id?: string
          percentual_padrao: number
          periodo_fim: string
          periodo_inicio: string
          qtd_contratos?: number
          status?: string
          tenant_id: string
          updated_at?: string
          usuario_id: string
          vlr_mensal_total_antes?: number
          vlr_mensal_total_depois?: number
          vlr_reajuste_total?: number
        }
        Update: {
          created_at?: string
          data_lancamento?: string
          id?: string
          percentual_padrao?: number
          periodo_fim?: string
          periodo_inicio?: string
          qtd_contratos?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          usuario_id?: string
          vlr_mensal_total_antes?: number
          vlr_mensal_total_depois?: number
          vlr_reajuste_total?: number
        }
        Relationships: []
      }
      reconciliacao_cadastro: {
        Row: {
          acao_sugerida: string | null
          candidato_escolhido: number | null
          cnpj_norm: string | null
          codigo_cliente_omie: number | null
          codigo_contrato_omie: number | null
          dia_venc_ds: number | null
          dia_venc_omie: number | null
          diffs: Json | null
          ds_contract_id: string
          ds_customer_id: string | null
          estado_match: string
          estado_valor: string | null
          fornecedor_ds: string | null
          fornecedor_id: number | null
          gerado_em: string
          id: string
          modelo_ds: string | null
          multi_contrato: boolean | null
          nome_diverge: boolean | null
          omie_inativo: boolean | null
          origem_codigo: string | null
          passa_validacao: boolean | null
          qtd_candidatos_omie: number | null
          razao_ds: string | null
          razao_omie: string | null
          resolvido_em: string | null
          resolvido_por: string | null
          status_usuario: string
          tenant_id: string
          valor_mrr_ds: number | null
          valor_omie: number | null
          vigencia_final_ds: string | null
          vigencia_final_omie: string | null
          vigencia_inicial_ds: string | null
          vigencia_inicial_omie: string | null
        }
        Insert: {
          acao_sugerida?: string | null
          candidato_escolhido?: number | null
          cnpj_norm?: string | null
          codigo_cliente_omie?: number | null
          codigo_contrato_omie?: number | null
          dia_venc_ds?: number | null
          dia_venc_omie?: number | null
          diffs?: Json | null
          ds_contract_id: string
          ds_customer_id?: string | null
          estado_match: string
          estado_valor?: string | null
          fornecedor_ds?: string | null
          fornecedor_id?: number | null
          gerado_em?: string
          id?: string
          modelo_ds?: string | null
          multi_contrato?: boolean | null
          nome_diverge?: boolean | null
          omie_inativo?: boolean | null
          origem_codigo?: string | null
          passa_validacao?: boolean | null
          qtd_candidatos_omie?: number | null
          razao_ds?: string | null
          razao_omie?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status_usuario?: string
          tenant_id: string
          valor_mrr_ds?: number | null
          valor_omie?: number | null
          vigencia_final_ds?: string | null
          vigencia_final_omie?: string | null
          vigencia_inicial_ds?: string | null
          vigencia_inicial_omie?: string | null
        }
        Update: {
          acao_sugerida?: string | null
          candidato_escolhido?: number | null
          cnpj_norm?: string | null
          codigo_cliente_omie?: number | null
          codigo_contrato_omie?: number | null
          dia_venc_ds?: number | null
          dia_venc_omie?: number | null
          diffs?: Json | null
          ds_contract_id?: string
          ds_customer_id?: string | null
          estado_match?: string
          estado_valor?: string | null
          fornecedor_ds?: string | null
          fornecedor_id?: number | null
          gerado_em?: string
          id?: string
          modelo_ds?: string | null
          multi_contrato?: boolean | null
          nome_diverge?: boolean | null
          omie_inativo?: boolean | null
          origem_codigo?: string | null
          passa_validacao?: boolean | null
          qtd_candidatos_omie?: number | null
          razao_ds?: string | null
          razao_omie?: string | null
          resolvido_em?: string | null
          resolvido_por?: string | null
          status_usuario?: string
          tenant_id?: string
          valor_mrr_ds?: number | null
          valor_omie?: number | null
          vigencia_final_ds?: string | null
          vigencia_final_omie?: string | null
          vigencia_inicial_ds?: string | null
          vigencia_inicial_omie?: string | null
        }
        Relationships: []
      }
      resources: {
        Row: {
          created_at: string
          description: string | null
          display_order: number
          hidden: boolean
          is_navigation: boolean
          key: string
          label: string
          module: string
          parent_key: string | null
          where_it_appears: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_order?: number
          hidden?: boolean
          is_navigation?: boolean
          key: string
          label: string
          module: string
          parent_key?: string | null
          where_it_appears?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          display_order?: number
          hidden?: boolean
          is_navigation?: boolean
          key?: string
          label?: string
          module?: string
          parent_key?: string | null
          where_it_appears?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_parent_key_fkey"
            columns: ["parent_key"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["key"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_delete: boolean
          can_insert: boolean
          can_update: boolean
          can_view: boolean
          created_at: string
          id: string
          resource_key: string
          role: string
          updated_at: string
        }
        Insert: {
          can_delete?: boolean
          can_insert?: boolean
          can_update?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          resource_key: string
          role: string
          updated_at?: string
        }
        Update: {
          can_delete?: boolean
          can_insert?: boolean
          can_update?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          resource_key?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_resource_key_fkey"
            columns: ["resource_key"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["key"]
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
      service_categories: {
        Row: {
          ativo: boolean
          created_at: string
          id: string
          nome: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: string
          nome?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_category_products: {
        Row: {
          category_id: string
          created_at: string
          id: string
          produto_id: number
          tenant_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          produto_id: number
          tenant_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          produto_id?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_category_products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_category_products_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_category_products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_subcategories: {
        Row: {
          ativo: boolean
          category_id: string
          created_at: string
          id: string
          nome: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          category_id: string
          created_at?: string
          id?: string
          nome: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          category_id?: string
          created_at?: string
          id?: string
          nome?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_subcategories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_types: {
        Row: {
          ativo: boolean
          codigo: string | null
          created_at: string
          descricao: string | null
          id: string
          nome: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_types_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          acceptance_deadline_at: string | null
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
          awaiting_agent_since: string | null
          cliente_id: string | null
          closed_at: string | null
          closed_by: string | null
          closed_reason: string | null
          closure_type: string | null
          contact_id: string
          contact_name: string | null
          contact_phone: string | null
          conversation_id: string
          created_at: string
          created_from: string | null
          csat_score: number | null
          csat_sent: boolean | null
          department_id: string | null
          first_human_response_at: string | null
          first_response_at: string | null
          first_response_business_seconds: number | null
          first_response_time_seconds: number | null
          handle_seconds: number
          handoffs_count: number
          id: string
          inactivity_warning_sent_at: string | null
          instance_id: string | null
          is_group: boolean
          last_customer_message_at: string | null
          last_operator_message_at: string | null
          last_queue_reason: string | null
          last_sentiment: string | null
          msg_agent_count: number
          msg_customer_count: number
          opened_at: string
          opened_by: string | null
          participant_label: string | null
          participant_type: string | null
          queue_priority: number
          queue_retries: number
          queued_at: string | null
          reopen_count: number | null
          reopened_at: string | null
          reopened_from: string | null
          resolucao: string | null
          schedule_notified_at: string | null
          scheduled_at: string | null
          scheduled_by: string | null
          scheduled_until: string | null
          sentiment_at: string | null
          sentiment_final: string | null
          sentiment_model: string | null
          sentiment_score: number | null
          seq_number: number
          status: string
          tenant_id: string
          ticket_id: string | null
          unidade_base_id: number | null
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
          waiting_ack_count: number
        }
        Insert: {
          acceptance_deadline_at?: string | null
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
          awaiting_agent_since?: string | null
          cliente_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          closure_type?: string | null
          contact_id: string
          contact_name?: string | null
          contact_phone?: string | null
          conversation_id: string
          created_at?: string
          created_from?: string | null
          csat_score?: number | null
          csat_sent?: boolean | null
          department_id?: string | null
          first_human_response_at?: string | null
          first_response_at?: string | null
          first_response_business_seconds?: number | null
          first_response_time_seconds?: number | null
          handle_seconds?: number
          handoffs_count?: number
          id?: string
          inactivity_warning_sent_at?: string | null
          instance_id?: string | null
          is_group?: boolean
          last_customer_message_at?: string | null
          last_operator_message_at?: string | null
          last_queue_reason?: string | null
          last_sentiment?: string | null
          msg_agent_count?: number
          msg_customer_count?: number
          opened_at?: string
          opened_by?: string | null
          participant_label?: string | null
          participant_type?: string | null
          queue_priority?: number
          queue_retries?: number
          queued_at?: string | null
          reopen_count?: number | null
          reopened_at?: string | null
          reopened_from?: string | null
          resolucao?: string | null
          schedule_notified_at?: string | null
          scheduled_at?: string | null
          scheduled_by?: string | null
          scheduled_until?: string | null
          sentiment_at?: string | null
          sentiment_final?: string | null
          sentiment_model?: string | null
          sentiment_score?: number | null
          seq_number?: number
          status?: string
          tenant_id: string
          ticket_id?: string | null
          unidade_base_id?: number | null
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
          waiting_ack_count?: number
        }
        Update: {
          acceptance_deadline_at?: string | null
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
          awaiting_agent_since?: string | null
          cliente_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closed_reason?: string | null
          closure_type?: string | null
          contact_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          conversation_id?: string
          created_at?: string
          created_from?: string | null
          csat_score?: number | null
          csat_sent?: boolean | null
          department_id?: string | null
          first_human_response_at?: string | null
          first_response_at?: string | null
          first_response_business_seconds?: number | null
          first_response_time_seconds?: number | null
          handle_seconds?: number
          handoffs_count?: number
          id?: string
          inactivity_warning_sent_at?: string | null
          instance_id?: string | null
          is_group?: boolean
          last_customer_message_at?: string | null
          last_operator_message_at?: string | null
          last_queue_reason?: string | null
          last_sentiment?: string | null
          msg_agent_count?: number
          msg_customer_count?: number
          opened_at?: string
          opened_by?: string | null
          participant_label?: string | null
          participant_type?: string | null
          queue_priority?: number
          queue_retries?: number
          queued_at?: string | null
          reopen_count?: number | null
          reopened_at?: string | null
          reopened_from?: string | null
          resolucao?: string | null
          schedule_notified_at?: string | null
          scheduled_at?: string | null
          scheduled_by?: string | null
          scheduled_until?: string | null
          sentiment_at?: string | null
          sentiment_final?: string | null
          sentiment_model?: string | null
          sentiment_score?: number | null
          seq_number?: number
          status?: string
          tenant_id?: string
          ticket_id?: string | null
          unidade_base_id?: number | null
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
          waiting_ack_count?: number
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
          {
            foreignKeyName: "support_attendances_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_attendances_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
            referencedColumns: ["id"]
          },
        ]
      }
      support_csat: {
        Row: {
          asked_at: string
          attendance_id: string
          created_at: string
          department_id: string | null
          id: string
          late_response: boolean
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
          department_id?: string | null
          id?: string
          late_response?: boolean
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
          department_id?: string | null
          id?: string
          late_response?: boolean
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
          {
            foreignKeyName: "support_csat_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
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
          agent_alert_enabled: boolean | null
          agent_alert_minutes: number | null
          agent_no_response_close_enabled: boolean | null
          agent_no_response_close_minutes: number | null
          auto_close_inactivity_minutes: number | null
          business_hours: Json
          business_hours_enabled: boolean
          business_hours_message: string | null
          created_at: string
          default_instance_id: string | null
          description: string | null
          id: string
          inactivity_warning_before_minutes: number | null
          is_active: boolean
          is_default_fallback: boolean
          name: string
          requires_ticket_on_close: boolean
          show_in_ura: boolean
          sla_frt_seconds: number | null
          slug: string
          sort_order: number
          tenant_id: string
          updated_at: string
          ura_label: string | null
          ura_option_number: number | null
          usa_tickets: boolean
          welcome_message: string | null
        }
        Insert: {
          agent_alert_enabled?: boolean | null
          agent_alert_minutes?: number | null
          agent_no_response_close_enabled?: boolean | null
          agent_no_response_close_minutes?: number | null
          auto_close_inactivity_minutes?: number | null
          business_hours?: Json
          business_hours_enabled?: boolean
          business_hours_message?: string | null
          created_at?: string
          default_instance_id?: string | null
          description?: string | null
          id?: string
          inactivity_warning_before_minutes?: number | null
          is_active?: boolean
          is_default_fallback?: boolean
          name: string
          requires_ticket_on_close?: boolean
          show_in_ura?: boolean
          sla_frt_seconds?: number | null
          slug: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
          ura_label?: string | null
          ura_option_number?: number | null
          usa_tickets?: boolean
          welcome_message?: string | null
        }
        Update: {
          agent_alert_enabled?: boolean | null
          agent_alert_minutes?: number | null
          agent_no_response_close_enabled?: boolean | null
          agent_no_response_close_minutes?: number | null
          auto_close_inactivity_minutes?: number | null
          business_hours?: Json
          business_hours_enabled?: boolean
          business_hours_message?: string | null
          created_at?: string
          default_instance_id?: string | null
          description?: string | null
          id?: string
          inactivity_warning_before_minutes?: number | null
          is_active?: boolean
          is_default_fallback?: boolean
          name?: string
          requires_ticket_on_close?: boolean
          show_in_ura?: boolean
          sla_frt_seconds?: number | null
          slug?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          ura_label?: string | null
          ura_option_number?: number | null
          usa_tickets?: boolean
          welcome_message?: string | null
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
      support_ticket_attachments: {
        Row: {
          created_at: string
          file_data: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          file_url: string | null
          id: string
          tenant_id: string
          ticket_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_data?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          tenant_id: string
          ticket_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_data?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          file_url?: string | null
          id?: string
          tenant_id?: string
          ticket_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_events: {
        Row: {
          content: string | null
          created_at: string
          event_type: string
          id: string
          new_value: string | null
          old_value: string | null
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          event_type: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          tenant_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          event_type?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          tenant_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_sequences: {
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
        Relationships: [
          {
            foreignKeyName: "support_ticket_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          aberto_em: string
          agendado_para: string | null
          assunto: string
          attendance_id: string | null
          atualizado_em: string
          canal_origem: string
          category_id: string | null
          checklist: Json
          cliente_contato_id: string | null
          cliente_id: string
          closed_by: string | null
          concluido_em: string | null
          contact_id: string | null
          criado_por: string | null
          data_fim_implantacao: string | null
          data_inicio_implantacao: string | null
          deleted_at: string | null
          department_id: string | null
          descricao: string | null
          duracao_minutos: number | null
          fornecedor_id: number | null
          horario_fim: string | null
          horario_inicio: string | null
          id: string
          motivo_cancelamento: string | null
          observacao_agente: string | null
          observacao_ia: string | null
          origem_criacao: string | null
          parent_ticket_id: string | null
          previsao_encerramento: string | null
          prioridade: Database["public"]["Enums"]["support_ticket_prioridade"]
          produto_id: number | null
          responsavel_user_id: string | null
          resumo_conclusivo: string | null
          resumo_parcial: string | null
          rotulo: string | null
          service_type_id: string | null
          status_id: string | null
          subcategory_id: string | null
          tempo_agente_minutos: number | null
          tempo_calculado_minutos: number | null
          tenant_id: string
          ticket_code: string | null
          tipo: Database["public"]["Enums"]["support_ticket_tipo"]
          tipo_horario: string | null
          unidade_base_id: number | null
        }
        Insert: {
          aberto_em?: string
          agendado_para?: string | null
          assunto: string
          attendance_id?: string | null
          atualizado_em?: string
          canal_origem?: string
          category_id?: string | null
          checklist?: Json
          cliente_contato_id?: string | null
          cliente_id: string
          closed_by?: string | null
          concluido_em?: string | null
          contact_id?: string | null
          criado_por?: string | null
          data_fim_implantacao?: string | null
          data_inicio_implantacao?: string | null
          deleted_at?: string | null
          department_id?: string | null
          descricao?: string | null
          duracao_minutos?: number | null
          fornecedor_id?: number | null
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          motivo_cancelamento?: string | null
          observacao_agente?: string | null
          observacao_ia?: string | null
          origem_criacao?: string | null
          parent_ticket_id?: string | null
          previsao_encerramento?: string | null
          prioridade?: Database["public"]["Enums"]["support_ticket_prioridade"]
          produto_id?: number | null
          responsavel_user_id?: string | null
          resumo_conclusivo?: string | null
          resumo_parcial?: string | null
          rotulo?: string | null
          service_type_id?: string | null
          status_id?: string | null
          subcategory_id?: string | null
          tempo_agente_minutos?: number | null
          tempo_calculado_minutos?: number | null
          tenant_id: string
          ticket_code?: string | null
          tipo?: Database["public"]["Enums"]["support_ticket_tipo"]
          tipo_horario?: string | null
          unidade_base_id?: number | null
        }
        Update: {
          aberto_em?: string
          agendado_para?: string | null
          assunto?: string
          attendance_id?: string | null
          atualizado_em?: string
          canal_origem?: string
          category_id?: string | null
          checklist?: Json
          cliente_contato_id?: string | null
          cliente_id?: string
          closed_by?: string | null
          concluido_em?: string | null
          contact_id?: string | null
          criado_por?: string | null
          data_fim_implantacao?: string | null
          data_inicio_implantacao?: string | null
          deleted_at?: string | null
          department_id?: string | null
          descricao?: string | null
          duracao_minutos?: number | null
          fornecedor_id?: number | null
          horario_fim?: string | null
          horario_inicio?: string | null
          id?: string
          motivo_cancelamento?: string | null
          observacao_agente?: string | null
          observacao_ia?: string | null
          origem_criacao?: string | null
          parent_ticket_id?: string | null
          previsao_encerramento?: string | null
          prioridade?: Database["public"]["Enums"]["support_ticket_prioridade"]
          produto_id?: number | null
          responsavel_user_id?: string | null
          resumo_conclusivo?: string | null
          resumo_parcial?: string | null
          rotulo?: string | null
          service_type_id?: string | null
          status_id?: string | null
          subcategory_id?: string | null
          tempo_agente_minutos?: number | null
          tempo_calculado_minutos?: number | null
          tenant_id?: string
          ticket_code?: string | null
          tipo?: Database["public"]["Enums"]["support_ticket_tipo"]
          tipo_horario?: string | null
          unidade_base_id?: number | null
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
            foreignKeyName: "support_tickets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_cliente_contato_id_fkey"
            columns: ["cliente_contato_id"]
            isOneToOne: false
            referencedRelation: "cliente_contatos"
            referencedColumns: ["id"]
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
            foreignKeyName: "support_tickets_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
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
            foreignKeyName: "support_tickets_parent_ticket_id_fkey"
            columns: ["parent_ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_service_type_id_fkey"
            columns: ["service_type_id"]
            isOneToOne: false
            referencedRelation: "service_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "ticket_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_subcategory_id_fkey"
            columns: ["subcategory_id"]
            isOneToOne: false
            referencedRelation: "service_subcategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_tenant_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
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
      tenant_conselho_config: {
        Row: {
          cache_horas: number
          foco_mes: string | null
          persona_ids: string[]
          tab_key: string
          tenant_id: string
          tom: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cache_horas?: number
          foco_mes?: string | null
          persona_ids?: string[]
          tab_key: string
          tenant_id: string
          tom?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cache_horas?: number
          foco_mes?: string | null
          persona_ids?: string[]
          tab_key?: string
          tenant_id?: string
          tom?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_conselho_config_tab_key_fkey"
            columns: ["tab_key"]
            isOneToOne: false
            referencedRelation: "conselho_aba_templates"
            referencedColumns: ["tab_key"]
          },
          {
            foreignKeyName: "tenant_conselho_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      tenant_holiday_template: {
        Row: {
          break_end: string | null
          break_start: string | null
          close_at: string | null
          has_break: boolean
          open_at: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          close_at?: string | null
          has_break?: boolean
          open_at?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          close_at?: string | null
          has_break?: boolean
          open_at?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      tenant_role_permissions: {
        Row: {
          can_delete: boolean
          can_insert: boolean
          can_update: boolean
          can_view: boolean
          created_at: string
          id: string
          resource_key: string
          role: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          can_delete: boolean
          can_insert: boolean
          can_update: boolean
          can_view: boolean
          created_at?: string
          id?: string
          resource_key: string
          role: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          can_delete?: boolean
          can_insert?: boolean
          can_update?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          resource_key?: string
          role?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_role_permissions_resource_key_fkey"
            columns: ["resource_key"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "tenant_role_permissions_tenant_id_fkey"
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
          rbac_enabled: boolean
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
          rbac_enabled?: boolean
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
          rbac_enabled?: boolean
          status?: string
          trial_ends_at?: string | null
        }
        Relationships: []
      }
      theo_config: {
        Row: {
          alertas_enabled: boolean
          apresentado_em: string | null
          destino_phones: string[]
          dia_semana: number
          enabled: boolean
          hora: string
          instance_id: string | null
          last_run_at: string | null
          tenant_id: string
          thresholds: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          alertas_enabled?: boolean
          apresentado_em?: string | null
          destino_phones?: string[]
          dia_semana?: number
          enabled?: boolean
          hora?: string
          instance_id?: string | null
          last_run_at?: string | null
          tenant_id: string
          thresholds?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          alertas_enabled?: boolean
          apresentado_em?: string | null
          destino_phones?: string[]
          dia_semana?: number
          enabled?: boolean
          hora?: string
          instance_id?: string | null
          last_run_at?: string | null
          tenant_id?: string
          thresholds?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "theo_config_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "theo_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_mentions: {
        Row: {
          created_at: string
          id: string
          mentioned_by: string
          mentioned_user_id: string
          seen_at: string | null
          tenant_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mentioned_by: string
          mentioned_user_id: string
          seen_at?: string | null
          tenant_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mentioned_by?: string
          mentioned_user_id?: string
          seen_at?: string | null
          tenant_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_mentions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_mentions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_statuses: {
        Row: {
          color: string
          created_at: string
          department_id: string
          id: string
          is_active: boolean
          is_initial: boolean
          is_terminal: boolean
          name: string
          position: number
          slug: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          department_id: string
          id?: string
          is_active?: boolean
          is_initial?: boolean
          is_terminal?: boolean
          name: string
          position?: number
          slug: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          department_id?: string
          id?: string
          is_active?: boolean
          is_initial?: boolean
          is_terminal?: boolean
          name?: string
          position?: number
          slug?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_statuses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_statuses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_tag_assignments: {
        Row: {
          created_at: string
          id: string
          tag_id: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tag_id: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tag_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "ticket_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_tag_assignments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_tags: {
        Row: {
          color: string
          created_at: string
          department_id: string | null
          id: string
          is_active: boolean
          name: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          department_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_tags_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_tags_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      unidades_base: {
        Row: {
          id: number
          is_active: boolean | null
          is_default_filter: boolean | null
          is_principal: boolean | null
          nome: string
          tenant_id: string | null
        }
        Insert: {
          id?: number
          is_active?: boolean | null
          is_default_filter?: boolean | null
          is_principal?: boolean | null
          nome: string
          tenant_id?: string | null
        }
        Update: {
          id?: number
          is_active?: boolean | null
          is_default_filter?: boolean | null
          is_principal?: boolean | null
          nome?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      user_preferences: {
        Row: {
          alert_background: string
          alert_closed: string
          alert_in_conversation: string
          alert_other_conversation: string
          alert_other_module: string
          created_at: string
          department_id: string | null
          dnd_days: number[]
          dnd_enabled: boolean
          dnd_end: string | null
          dnd_start: string | null
          id: string
          master_enabled: boolean
          notification_scope: string | null
          prefer_department_overrides: boolean
          push_enabled: boolean | null
          signature_name: string | null
          sound_enabled: boolean
          sound_id: string | null
          tenant_id: string
          updated_at: string
          user_id: string
          visual_notifications_enabled: boolean
          volume: number | null
        }
        Insert: {
          alert_background?: string
          alert_closed?: string
          alert_in_conversation?: string
          alert_other_conversation?: string
          alert_other_module?: string
          created_at?: string
          department_id?: string | null
          dnd_days?: number[]
          dnd_enabled?: boolean
          dnd_end?: string | null
          dnd_start?: string | null
          id?: string
          master_enabled?: boolean
          notification_scope?: string | null
          prefer_department_overrides?: boolean
          push_enabled?: boolean | null
          signature_name?: string | null
          sound_enabled?: boolean
          sound_id?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
          visual_notifications_enabled?: boolean
          volume?: number | null
        }
        Update: {
          alert_background?: string
          alert_closed?: string
          alert_in_conversation?: string
          alert_other_conversation?: string
          alert_other_module?: string
          created_at?: string
          department_id?: string | null
          dnd_days?: number[]
          dnd_enabled?: boolean
          dnd_end?: string | null
          dnd_start?: string | null
          id?: string
          master_enabled?: boolean
          notification_scope?: string | null
          prefer_department_overrides?: boolean
          push_enabled?: boolean | null
          signature_name?: string | null
          sound_enabled?: boolean
          sound_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
          visual_notifications_enabled?: boolean
          volume?: number | null
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
      user_view_state: {
        Row: {
          unidade_ids: number[]
          updated_at: string
          user_id: string
        }
        Insert: {
          unidade_ids?: number[]
          updated_at?: string
          user_id: string
        }
        Update: {
          unidade_ids?: number[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_contacts: {
        Row: {
          cliente_id: string | null
          created_at: string
          id: string
          instance_id: string | null
          is_group: boolean
          name: string | null
          notes: string | null
          phone_number: string
          picture_synced_at: string | null
          profile_picture_url: string | null
          rules_disabled: boolean
          rules_disabled_at: string | null
          rules_disabled_by: string | null
          rules_disabled_reason: string | null
          tags: string[] | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          is_group?: boolean
          name?: string | null
          notes?: string | null
          phone_number: string
          picture_synced_at?: string | null
          profile_picture_url?: string | null
          rules_disabled?: boolean
          rules_disabled_at?: string | null
          rules_disabled_by?: string | null
          rules_disabled_reason?: string | null
          tags?: string[] | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          id?: string
          instance_id?: string | null
          is_group?: boolean
          name?: string | null
          notes?: string | null
          phone_number?: string
          picture_synced_at?: string | null
          profile_picture_url?: string | null
          rules_disabled?: boolean
          rules_disabled_at?: string | null
          rules_disabled_by?: string | null
          rules_disabled_reason?: string | null
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_contacts_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_contacts_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "vw_clientes_financeiro"
            referencedColumns: ["id"]
          },
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
          auto_reply_disabled: boolean
          auto_reply_disabled_at: string | null
          auto_reply_disabled_by: string | null
          auto_reply_disabled_reason: string | null
          category: string | null
          contact_id: string
          created_at: string
          current_instance_id: string | null
          department_id: string | null
          first_agent_message_at: string | null
          group_enabled: boolean | null
          group_jid: string | null
          id: string
          instance_id: string | null
          is_group: boolean
          is_last_message_from_me: boolean
          last_message_at: string | null
          last_message_preview: string | null
          metadata: Json | null
          monitor_user_id: string | null
          opened_out_of_hours: boolean
          opened_out_of_hours_at: string | null
          out_of_hours_cleared_at: string | null
          priority: string | null
          sender_signature_mode: string
          sender_ticket_code: string | null
          status: string
          tenant_id: string
          unidade_base_id: number | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          auto_reply_disabled?: boolean
          auto_reply_disabled_at?: string | null
          auto_reply_disabled_by?: string | null
          auto_reply_disabled_reason?: string | null
          category?: string | null
          contact_id: string
          created_at?: string
          current_instance_id?: string | null
          department_id?: string | null
          first_agent_message_at?: string | null
          group_enabled?: boolean | null
          group_jid?: string | null
          id?: string
          instance_id?: string | null
          is_group?: boolean
          is_last_message_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json | null
          monitor_user_id?: string | null
          opened_out_of_hours?: boolean
          opened_out_of_hours_at?: string | null
          out_of_hours_cleared_at?: string | null
          priority?: string | null
          sender_signature_mode?: string
          sender_ticket_code?: string | null
          status?: string
          tenant_id: string
          unidade_base_id?: number | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          auto_reply_disabled?: boolean
          auto_reply_disabled_at?: string | null
          auto_reply_disabled_by?: string | null
          auto_reply_disabled_reason?: string | null
          category?: string | null
          contact_id?: string
          created_at?: string
          current_instance_id?: string | null
          department_id?: string | null
          first_agent_message_at?: string | null
          group_enabled?: boolean | null
          group_jid?: string | null
          id?: string
          instance_id?: string | null
          is_group?: boolean
          is_last_message_from_me?: boolean
          last_message_at?: string | null
          last_message_preview?: string | null
          metadata?: Json | null
          monitor_user_id?: string | null
          opened_out_of_hours?: boolean
          opened_out_of_hours_at?: string | null
          out_of_hours_cleared_at?: string | null
          priority?: string | null
          sender_signature_mode?: string
          sender_ticket_code?: string | null
          status?: string
          tenant_id?: string
          unidade_base_id?: number | null
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
          {
            foreignKeyName: "whatsapp_conversations_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_groups: {
        Row: {
          created_at: string
          enabled: boolean
          group_jid: string
          group_name: string | null
          group_picture_url: string | null
          id: string
          instance_id: string
          last_synced_at: string | null
          missing_since: string | null
          monitor_user_id: string | null
          participant_count: number | null
          participants: Json | null
          retention_days: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          group_jid: string
          group_name?: string | null
          group_picture_url?: string | null
          id?: string
          instance_id: string
          last_synced_at?: string | null
          missing_since?: string | null
          monitor_user_id?: string | null
          participant_count?: number | null
          participants?: Json | null
          retention_days?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          group_jid?: string
          group_name?: string | null
          group_picture_url?: string | null
          id?: string
          instance_id?: string
          last_synced_at?: string | null
          missing_since?: string | null
          monitor_user_id?: string | null
          participant_count?: number | null
          participants?: Json | null
          retention_days?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_groups_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
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
          auto_close_inactivity_minutes: number | null
          created_at: string
          disconnected_alert_at: string | null
          display_name: string | null
          id: string
          ignore_group_messages: boolean
          inactivity_warning_before_minutes: number | null
          inbound_department_id: string | null
          instance_id_external: string | null
          instance_name: string
          is_active: boolean
          last_event_at: string | null
          meta_business_id: string | null
          meta_phone_number_id: string | null
          meta_waba_id: string | null
          phone_number: string | null
          provider_type: string
          silence_alert_at: string | null
          skip_ura: boolean
          status: string
          tenant_id: string
          unidade_base_id: number | null
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          auto_close_inactivity_minutes?: number | null
          created_at?: string
          disconnected_alert_at?: string | null
          display_name?: string | null
          id?: string
          ignore_group_messages?: boolean
          inactivity_warning_before_minutes?: number | null
          inbound_department_id?: string | null
          instance_id_external?: string | null
          instance_name: string
          is_active?: boolean
          last_event_at?: string | null
          meta_business_id?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          phone_number?: string | null
          provider_type?: string
          silence_alert_at?: string | null
          skip_ura?: boolean
          status?: string
          tenant_id: string
          unidade_base_id?: number | null
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          auto_close_inactivity_minutes?: number | null
          created_at?: string
          disconnected_alert_at?: string | null
          display_name?: string | null
          id?: string
          ignore_group_messages?: boolean
          inactivity_warning_before_minutes?: number | null
          inbound_department_id?: string | null
          instance_id_external?: string | null
          instance_name?: string
          is_active?: boolean
          last_event_at?: string | null
          meta_business_id?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          phone_number?: string | null
          provider_type?: string
          silence_alert_at?: string | null
          skip_ura?: boolean
          status?: string
          tenant_id?: string
          unidade_base_id?: number | null
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_inbound_department_id_fkey"
            columns: ["inbound_department_id"]
            isOneToOne: false
            referencedRelation: "support_departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instances_unidade_base_id_fkey"
            columns: ["unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_macro_tags: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          id: string
          nome: string
          ordem: number
          tenant_id: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome: string
          ordem?: number
          tenant_id: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          nome?: string
          ordem?: number
          tenant_id?: string
        }
        Relationships: []
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
          media_path: string | null
          media_type: string | null
          permite_edicao_livre: boolean
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
          media_path?: string | null
          media_type?: string | null
          permite_edicao_livre?: boolean
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
          media_path?: string | null
          media_type?: string | null
          permite_edicao_livre?: boolean
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
          mentions: Json | null
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
          mentions?: Json | null
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
          mentions?: Json | null
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
      whatsapp_meta_templates: {
        Row: {
          body_text: string | null
          body_variables_count: number
          buttons: Json | null
          category: string
          components: Json | null
          created_at: string
          footer_text: string | null
          header_content: string | null
          header_type: string | null
          id: string
          instance_id: string
          language: string
          meta_template_id: string | null
          name: string
          status: string
          synced_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          body_text?: string | null
          body_variables_count?: number
          buttons?: Json | null
          category: string
          components?: Json | null
          created_at?: string
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          instance_id: string
          language: string
          meta_template_id?: string | null
          name: string
          status: string
          synced_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          body_text?: string | null
          body_variables_count?: number
          buttons?: Json | null
          category?: string
          components?: Json | null
          created_at?: string
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          instance_id?: string
          language?: string
          meta_template_id?: string | null
          name?: string
          status?: string
          synced_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_meta_templates_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_meta_templates_tenant_id_fkey"
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
      whatsapp_recovery_runs: {
        Row: {
          created_at: string
          finished_at: string | null
          id: string
          instance_id: string
          requested_by: string
          stats: Json
          status: string
          tenant_id: string
          window_end: string
          window_start: string
        }
        Insert: {
          created_at?: string
          finished_at?: string | null
          id?: string
          instance_id: string
          requested_by: string
          stats?: Json
          status?: string
          tenant_id: string
          window_end: string
          window_start: string
        }
        Update: {
          created_at?: string
          finished_at?: string | null
          id?: string
          instance_id?: string
          requested_by?: string
          stats?: Json
          status?: string
          tenant_id?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_recovery_runs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_recovery_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sentiment_analysis: {
        Row: {
          churn_alerted_at: string | null
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
          churn_alerted_at?: string | null
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
          churn_alerted_at?: string | null
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
      conselho_personas_publicas: {
        Row: {
          ativo: boolean | null
          avatar_url: string | null
          bio_curta: string | null
          especialidade_tags: string[] | null
          familia: string | null
          id: string | null
          nome_funcional: string | null
          ordem: number | null
          referencia_publica_br: string | null
          referencia_publica_int: string | null
          slug: string | null
        }
        Insert: {
          ativo?: boolean | null
          avatar_url?: string | null
          bio_curta?: string | null
          especialidade_tags?: string[] | null
          familia?: string | null
          id?: string | null
          nome_funcional?: string | null
          ordem?: number | null
          referencia_publica_br?: string | null
          referencia_publica_int?: string | null
          slug?: string | null
        }
        Update: {
          ativo?: boolean | null
          avatar_url?: string | null
          bio_curta?: string | null
          especialidade_tags?: string[] | null
          familia?: string | null
          id?: string | null
          nome_funcional?: string | null
          ordem?: number | null
          referencia_publica_br?: string | null
          referencia_publica_int?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      v_whatsapp_conversations_state: {
        Row: {
          agent_alert_due_at: string | null
          agent_alert_enabled: boolean | null
          agent_alert_minutes: number | null
          attendance_assigned_to: string | null
          attendance_has_customer_msg: boolean | null
          attendance_id: string | null
          attendance_opened_at: string | null
          attendance_status: string | null
          attendance_unidade_base_id: number | null
          awaiting_agent_since: string | null
          conversation_assigned_to: string | null
          conversation_id: string | null
          conversation_status: string | null
          department_id: string | null
          first_agent_message_at: string | null
          is_group: boolean | null
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
            foreignKeyName: "support_attendances_unidade_base_id_fkey"
            columns: ["attendance_unidade_base_id"]
            isOneToOne: false
            referencedRelation: "unidades_base"
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
          data_reajuste: string | null
          data_reativacao: string | null
          data_venda: string | null
          data_venda_efetiva: string | null
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
          observacao_reativacao: string | null
          origem_venda_id: number | null
          produto_id: number | null
          qtde_contratos_ativos: number | null
          qtde_produtos_ativos: number | null
          razao_social: string | null
          reativado_por_user_id: string | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id: number | null
          setup_completo: boolean | null
          telefone_contato: string | null
          telefone_whatsapp: string | null
          tenant_id: string | null
          unidade_base_id: number | null
          updated_at: string | null
          valor_ativacao: number | null
          valor_repasse: number | null
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
            foreignKeyName: "clientes_motivo_cancelamento_id_fkey"
            columns: ["motivo_cancelamento_id"]
            isOneToOne: false
            referencedRelation: "motivos_cancelamento"
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
      add_ticket_attachment:
        | {
            Args: {
              p_file_data?: string
              p_file_name: string
              p_file_path?: string
              p_file_size?: number
              p_file_type?: string
              p_file_url?: string
              p_ticket_id: string
            }
            Returns: string
          }
        | {
            Args: {
              p_file_name: string
              p_file_path: string
              p_file_size?: number
              p_file_type?: string
              p_file_url?: string
              p_ticket_id: string
            }
            Returns: string
          }
      add_ticket_event: {
        Args: {
          p_content?: string
          p_event_type?: string
          p_new_value?: string
          p_old_value?: string
          p_ticket_id: string
        }
        Returns: string
      }
      admin_delete_cliente: {
        Args: {
          p_cliente_id: string
          p_confirm?: boolean
          p_incluir_chat?: boolean
          p_mode: string
          p_target_id?: string
        }
        Returns: Json
      }
      admin_list_conselho_personas: {
        Args: never
        Returns: {
          ativo: boolean
          avatar_url: string
          bio_curta: string
          created_at: string
          especialidade_tags: string[]
          familia: string
          id: string
          nome_funcional: string
          nome_inspiracao: string
          ordem: number
          slug: string
          system_prompt_chunk: string
          updated_at: string
        }[]
      }
      admin_set_instance_unidade: {
        Args: { p_instance_id: string; p_unidade_id: number }
        Returns: undefined
      }
      admin_set_user_unidades: {
        Args: {
          p_target_user_id: string
          p_todas: boolean
          p_unidade_ids?: number[]
        }
        Returns: undefined
      }
      admin_swap_cliente_produto: {
        Args: {
          p_cliente_produto_id: string
          p_novo_fornecedor_id?: number
          p_novo_produto_id: number
        }
        Returns: Json
      }
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
      aplicar_reajuste: { Args: { p_reajuste_id: string }; Returns: Json }
      attach_attendance_to_ticket: {
        Args: { p_attendance_id: string; p_nota?: string }
        Returns: string
      }
      atualizar_reajuste_item: {
        Args: {
          p_item_id: string
          p_percentual?: number
          p_selecionado?: boolean
        }
        Returns: Json
      }
      audit_log: {
        Args: {
          p_event_type: string
          p_metadata?: Json
          p_target_user_id: string
        }
        Returns: undefined
      }
      build_management_digest_block: {
        Args: { p_end: string; p_start: string; p_tenant_id: string }
        Returns: string
      }
      calc_proximo_reajuste: {
        Args: { p_data_inicio: string; p_prazo_meses?: number }
        Returns: string
      }
      calcular_mrr_cliente: {
        Args: { p_cliente_id: string; p_tenant_id: string }
        Returns: number
      }
      can: { Args: { p_action: string; p_resource: string }; Returns: boolean }
      can_access_monitor: { Args: never; Returns: boolean }
      can_access_tenant_row: { Args: { row_tenant: string }; Returns: boolean }
      can_invite_more_users: { Args: { p_tenant: string }; Returns: boolean }
      can_request_conselho_analise: {
        Args: { p_tenant_id: string }
        Returns: boolean
      }
      cancel_cliente_produto: {
        Args: {
          p_cliente_produto_id: string
          p_motivo_id: number
          p_observacao?: string
        }
        Returns: Json
      }
      cancelar_contrato: {
        Args: {
          p_contrato_id: string
          p_motivo_id?: number
          p_observacao?: string
        }
        Returns: Json
      }
      claim_conversation: {
        Args: { p_conversation_id: string; p_reason?: string }
        Returns: undefined
      }
      cleanup_ai_usage_log: { Args: never; Returns: undefined }
      cleanup_group_messages: { Args: never; Returns: undefined }
      cleanup_notification_dispatch_queue: { Args: never; Returns: number }
      clear_unidade_default_filter: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      collect_db_metrics_snapshot: { Args: never; Returns: undefined }
      collect_tenant_daily_metrics:
        | { Args: never; Returns: undefined }
        | { Args: { p_date?: string }; Returns: undefined }
      create_access_invite: {
        Args: {
          p_access_status?: string
          p_email: string
          p_funcionario_id: number
          p_role?: string
          p_tenant_id?: string
        }
        Returns: string
      }
      create_additional_ticket_from_attendance: {
        Args: {
          p_attendance_id: string
          p_category_id: string
          p_department_id?: string
          p_observacao_agente: string
          p_observacao_ia: string
          p_produto_id: number
          p_responsavel_user_id?: string
          p_service_type_id: string
          p_subcategory_id: string
          p_tipo_horario: string
        }
        Returns: string
      }
      create_catalog_template_from_tenant: {
        Args: {
          p_descricao?: string
          p_nome: string
          p_source_tenant_id: string
        }
        Returns: string
      }
      create_child_ticket: {
        Args: {
          p_agendado_para?: string
          p_canal_origem?: string
          p_observacao_agente: string
          p_parent_ticket_id: string
          p_responsavel_uid?: string
          p_status_id?: string
        }
        Returns: string
      }
      create_cliente_produto_with_contract: {
        Args: {
          p_cliente_id: string
          p_dados: Json
          p_link_to_contrato_id?: string
          p_produto_id: number
        }
        Returns: string
      }
      create_demand_ticket_from_attendance: {
        Args: {
          p_attendance_id: string
          p_category_id: string
          p_department_id?: string
          p_observacao_agente: string
          p_observacao_ia: string
          p_produto_id: number
          p_responsavel_user_id?: string
          p_service_type_id: string
          p_subcategory_id: string
          p_tipo_horario: string
        }
        Returns: string
      }
      create_manual_ticket: {
        Args: {
          p_agendado_para?: string
          p_canal_origem: string
          p_category_id: string
          p_cliente_contato_id?: string
          p_cliente_id: string
          p_contact_id?: string
          p_department_id: string
          p_horario_fim?: string
          p_horario_inicio?: string
          p_observacao_agente?: string
          p_previsao_encerramento?: string
          p_produto_id: number
          p_responsavel_user_id?: string
          p_service_type_id: string
          p_status_id?: string
          p_subcategory_id: string
          p_tipo_horario?: string
        }
        Returns: string
      }
      create_simple_template_from_tenant: {
        Args: {
          p_descricao?: string
          p_kind: string
          p_nome: string
          p_source_tenant_id: string
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
      create_ticket_from_closure: {
        Args: {
          p_attendance_id: string
          p_category_id: string
          p_department_id?: string
          p_observacao_agente: string
          p_observacao_ia: string
          p_produto_id: number
          p_responsavel_user_id?: string
          p_service_type_id: string
          p_subcategory_id: string
          p_tipo_horario: string
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
      definir_datas_reajuste_em_massa: {
        Args: {
          p_campo_base?: string
          p_preview?: boolean
          p_tenant_id: string
        }
        Returns: {
          cliente_id: string
          contrato_id: string
          data_base: string
          data_proximo_reajuste_calculada: string
          numero: string
          razao_social: string
          total_afetados: number
        }[]
      }
      delete_conversation_admin: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      delete_messages_by_ids: {
        Args: { p_message_ids: string[] }
        Returns: Json
      }
      dismiss_conversation_notifications: {
        Args: { p_conversation_id: string }
        Returns: number
      }
      dismiss_notification: {
        Args: { p_recipient_id: string }
        Returns: undefined
      }
      dismiss_pending_closure: {
        Args: { p_attendance_id: string; p_motivo?: string }
        Returns: undefined
      }
      editar_cancelamento: {
        Args: {
          p_evento_id: string
          p_motivo_id?: number
          p_nova_data: string
          p_observacao?: string
        }
        Returns: Json
      }
      email_domain: { Args: { email: string }; Returns: string }
      enable_rbac_for_tenant: { Args: { p_tenant_id?: string }; Returns: Json }
      encrypt_api_key: {
        Args: { p_encryption_key: string; p_key: string }
        Returns: string
      }
      enfileirar_sync_omie: {
        Args: { p_contrato_id: string; p_origem?: string }
        Returns: undefined
      }
      estornar_reajuste: { Args: { p_reajuste_id: string }; Returns: Json }
      exec_db_health_query: { Args: { query_text: string }; Returns: Json }
      exec_db_maintenance: { Args: { action: string }; Returns: string }
      fmt_brl: { Args: { n: number }; Returns: string }
      fn_assign_conversation_if_ready: {
        Args: { p_conversation_id: string }
        Returns: Json
      }
      fn_auto_offline_stale_agents: { Args: never; Returns: Json }
      fn_business_due_at: {
        Args: {
          p_department_id?: string
          p_minutes_uteis: number
          p_start: string
          p_tenant_id: string
        }
        Returns: string
      }
      fn_check_acceptance_timeouts: { Args: never; Returns: Json }
      fn_close_attendance_atomic: {
        Args: {
          p_attendance_id: string
          p_closed_reason?: string
          p_closure_type?: string
        }
        Returns: Json
      }
      fn_close_attendances_no_agent_response: { Args: never; Returns: Json }
      fn_cohort_logos: {
        Args: {
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
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
      fn_cohort_revenue: {
        Args: {
          p_dimensao?: string
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
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
          grupo: string
          mrr_inicial: number
          mrr_retido: number
          retained: number
          retention_percent: number
          revenue_retention_percent: number
          tenant_id: string
        }[]
      }
      fn_cohort_saldo_forecast: {
        Args: {
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_horizontes?: number[]
          p_janela_meses?: number
          p_tenant_id?: string
          p_unidade_base_id?: number
        }
        Returns: {
          base_clientes: number
          base_mrr: number
          ganho_clientes: number
          ganho_mrr: number
          horizonte_meses: number
          perda_clientes: number
          perda_mrr: number
          saldo_clientes: number
          saldo_mrr: number
        }[]
      }
      fn_cohort_survival_forecast: {
        Args: {
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_from_month?: string
          p_horizontes?: number[]
          p_max_age?: number
          p_tenant_id?: string
          p_to_month?: string
          p_unidade_base_id?: number
        }
        Returns: {
          base_clientes: number
          base_mrr: number
          horizonte_meses: number
          perda_clientes_esp: number
          perda_mrr_esp: number
          retencao_clientes_esp_pct: number
          retencao_mrr_esp_pct: number
        }[]
      }
      fn_current_chat_count: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: number
      }
      fn_dispatch_next_in_queue: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: Json
      }
      fn_effective_chat_limit: {
        Args: { p_tenant_id: string; p_user_id: string }
        Returns: number
      }
      fn_fix_orphan_closed_attendances: {
        Args: never
        Returns: {
          detected: number
          fixed: number
        }[]
      }
      fn_instance_traffic: {
        Args: { p_minutes?: number }
        Returns: {
          inbound: number
          instance_id: string
          outbound: number
        }[]
      }
      fn_is_business_hours: { Args: { p_tenant_id: string }; Returns: boolean }
      fn_process_ura_timeouts: { Args: never; Returns: Json }
      fn_retry_waiting_conversations: { Args: never; Returns: Json }
      fn_schedule_group_syncs: { Args: never; Returns: undefined }
      fn_sync_member_for_funcionario: {
        Args: { p_funcionario_id: number; p_tenant_id: string }
        Returns: undefined
      }
      fn_user_owns_ticket_attachment_path: {
        Args: { object_name: string }
        Returns: boolean
      }
      fn_user_owns_whatsapp_media_path: {
        Args: { object_name: string }
        Returns: boolean
      }
      fn_watchdog_signals: {
        Args: never
        Returns: {
          in_30m: number
          instance_id: string
          out_30m: number
          out_recent: number
        }[]
      }
      get_ai_cost_metrics: {
        Args: { p_date_from?: string; p_date_to?: string; p_tenant_id?: string }
        Returns: Json
      }
      get_ai_projection: { Args: never; Returns: Json }
      get_atendimento_agentes: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_is_group?: boolean
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_backlog: {
        Args: {
          p_agent_id?: string
          p_area_ids?: number[]
          p_cidade_ids?: number[]
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_estado_ids?: number[]
          p_fornecedor_ids?: number[]
          p_produto_ids?: number[]
          p_segmento_ids?: number[]
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_chats: {
        Args: {
          p_agent_id?: string
          p_area_ids?: number[]
          p_cidade_ids?: number[]
          p_closed_reasons?: string[]
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_estado_ids?: number[]
          p_fornecedor_ids?: number[]
          p_has_ticket?: boolean
          p_is_group?: boolean
          p_produto_ids?: number[]
          p_resolucoes?: string[]
          p_segmento_ids?: number[]
          p_sentiments?: string[]
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_chats_timeline: {
        Args: {
          p_is_group?: boolean
          p_meses?: number
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_clientes: {
        Args: {
          p_area_ids?: number[]
          p_cidade_ids?: number[]
          p_date_from: string
          p_date_to: string
          p_estado_ids?: number[]
          p_fornecedor_ids?: number[]
          p_produto_ids?: number[]
          p_segmento_ids?: number[]
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_cobertura: {
        Args: { p_date_from: string; p_date_to: string }
        Returns: Json
      }
      get_atendimento_filtro_opcoes: {
        Args: { p_tenant_id?: string }
        Returns: Json
      }
      get_atendimento_latencia_histograma: {
        Args: {
          p_agent_id?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_is_group?: boolean
          p_tenant_id: string
        }
        Returns: Json
      }
      get_atendimento_realtime: {
        Args: {
          p_department_id?: string
          p_is_group?: boolean
          p_sla_threshold_min?: number
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_realtime_chats: {
        Args: {
          p_bucket: string
          p_department_id?: string
          p_is_group?: boolean
          p_sla_threshold_min?: number
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_satisfacao: {
        Args: {
          p_agent_id?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_is_group?: boolean
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_taxonomia: {
        Args: {
          p_agent_id?: string
          p_area_ids?: number[]
          p_cidade_ids?: number[]
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_estado_ids?: number[]
          p_fornecedor_ids?: number[]
          p_produto_ids?: number[]
          p_segmento_ids?: number[]
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_ura: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_velocidade: {
        Args: {
          p_agent_id?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_is_group?: boolean
          p_sla_frt_seconds?: number
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_velocidade_timeline: {
        Args: {
          p_agent_id?: string
          p_bucket?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_is_group?: boolean
          p_sla_frt_seconds?: number
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_atendimento_volume: {
        Args: {
          p_agent_id?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_is_group?: boolean
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_attendance_metrics: {
        Args: {
          p_agent_id?: string
          p_department_id?: string
          p_from: string
          p_instance_id?: string
          p_tenant_id: string
          p_to: string
        }
        Returns: Json
      }
      get_attendance_summary_metrics: {
        Args: {
          p_agent_id?: string
          p_cliente_id?: string
          p_closure_type?: string
          p_csat_filter?: string
          p_csat_score?: number
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_is_group?: boolean
          p_resolucao?: string
          p_sentiment_filter?: string
          p_status?: string
          p_tenant_id?: string
          p_ticket_filter?: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      get_avg_implantacao_days: {
        Args: {
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_tenant_id: string
        }
        Returns: Json
      }
      get_cancelamentos_breakdown: {
        Args: {
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_periodo_fim: string
          p_periodo_inicio: string
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: {
          bucket_181_365d_mrr: number
          bucket_181_365d_qtd: number
          bucket_91_180d_mrr: number
          bucket_91_180d_qtd: number
          bucket_ate_90d_mrr: number
          bucket_ate_90d_qtd: number
          bucket_mais_1y_mrr: number
          bucket_mais_1y_qtd: number
          cancelamentos_por_origem: Json
          cancelamentos_qtd: number
          cat_involuntary_mrr: number
          cat_involuntary_qtd: number
          cat_mortality_mrr: number
          cat_mortality_qtd: number
          cat_sem_classif_mrr: number
          cat_sem_classif_qtd: number
          cat_voluntary_mrr: number
          cat_voluntary_qtd: number
          churn_por_segmento: Json
          churn_rate_logo: number
          churn_rate_mrr: number
          clientes_inicio: number
          early_churn_mrr: number
          early_churn_qtd: number
          early_churn_rate: number
          evolucao_12m: Json
          heatmap_motivo_segmento: Json
          mrr_cancelado: number
          mrr_inicio: number
          mrr_liquido_perdido: number
          mrr_reativado: number
          net_logo_churn: number
          reativacoes_12m: Json
          reativacoes_qtd: number
          tendencia_motivos: Json
          tenure_medio_canc_dias: number
          top_motivos: Json
          top10_cancelados: Json
          winback_rate_12m: number
        }[]
      }
      get_carteira_breakdown: {
        Args: {
          p_dim: string
          p_fim: string
          p_fornecedor?: number
          p_fornecedor_ids?: number[]
          p_tenant: string
          p_uf?: string
          p_unidade?: number
        }
        Returns: {
          custo: number
          label: string
          margem_pct: number
          margem_rs: number
          mrr: number
          qtd: number
          ticket: number
        }[]
      }
      get_carteira_churn: {
        Args: {
          p_fim: string
          p_fornecedor?: number
          p_fornecedor_ids?: number[]
          p_ini: string
          p_nivel: string
          p_tenant: string
          p_uf?: string
          p_unidade?: number
        }
        Returns: {
          base: number
          cancelados: number
          churn_pct: number
          label: string
          mrr_perdido: number
        }[]
      }
      get_carteira_clientes_cidade: {
        Args: {
          p_cidade: string
          p_fim: string
          p_fornecedor?: number
          p_fornecedor_ids?: number[]
          p_tenant: string
          p_uf: string
          p_unidade?: number
        }
        Returns: {
          cliente: string
          mrr: number
          segmento: string
        }[]
      }
      get_carteira_serie_uf: {
        Args: {
          p_fornecedor?: number
          p_fornecedor_ids?: number[]
          p_meses?: number
          p_tenant: string
          p_unidade?: number
        }
        Returns: {
          mrr: number
          qtd: number
          uf: string
          ym: string
        }[]
      }
      get_carteira_variacao: {
        Args: {
          p_fim_anterior: string
          p_fim_atual: string
          p_fornecedor?: number
          p_fornecedor_ids?: number[]
          p_tenant: string
          p_unidade?: number
        }
        Returns: {
          delta_abs: number
          delta_pct: number
          mrr_anterior: number
          mrr_atual: number
          qtd_atual: number
          uf: string
        }[]
      }
      get_catalog_template_preview: {
        Args: { p_template_id: string }
        Returns: {
          categoria: string
          subcategorias: string[]
        }[]
      }
      get_catalog_template_products: {
        Args: { p_template_id: string }
        Returns: {
          ocorrencias: number
          produto: string
        }[]
      }
      get_churn_detalhe_uf: {
        Args: {
          p_fim: string
          p_fornecedor?: number
          p_fornecedor_ids?: number[]
          p_ini: string
          p_tenant: string
          p_uf: string
          p_unidade?: number
        }
        Returns: {
          cidade: string
          cliente: string
          data_cancelamento: string
          mrr_perdido: number
          observacao: string
          segmento: string
        }[]
      }
      get_client_alert_audit: {
        Args: { p_cliente_id?: string; p_contact_id?: string }
        Returns: {
          action: string
          alert_block_behavior: string
          alert_kind: string
          alert_titulo: string
          id: string
          performed_at: string
          performed_by_name: string
        }[]
      }
      get_clientes_candidatos_by_phone: {
        Args: { p_phone: string; p_tenant_id: string }
        Returns: {
          cancelado: boolean
          cliente_id: string
          codigo_sequencial: number
          fonte_match: string
          fornecedor_nome: string
          nome_fantasia: string
          razao_social: string
          telefone_whatsapp: string
        }[]
      }
      get_conselho_aba_template: {
        Args: { p_tab_key: string; p_tenant_id: string }
        Returns: {
          contexto_objetivo: string
          custo_estimado_brl: number
          display_label: string
          max_tokens: number
          output_format_prompt: string
          personas_sugeridas_default: string[]
          prompt_principal: string
          tab_key: string
        }[]
      }
      get_conselho_analise_detalhe: {
        Args: { p_id: string }
        Returns: {
          alertas_factuais: Json
          cache_hit_de: string
          custo_estimado_usd: number
          dados_snapshot: Json
          duracao_ms: number
          error_message: string
          filtros_aplicados: Json
          foco_mes: string
          id: string
          model_usado: string
          output_markdown: string
          personas_snapshot: Json
          prompt_final: string
          provider_usado: string
          solicitado_em: string
          solicitado_por: string
          status: string
          tab_key: string
          tenant_id: string
          tokens_in: number
          tokens_out: number
          tom: string
        }[]
      }
      get_conselho_cache: {
        Args: {
          p_input_hash: string
          p_tab_key: string
          p_tenant_id: string
          p_tipo?: string
        }
        Returns: {
          custo_estimado_usd: number
          dados_snapshot: Json
          expires_at: string
          id: string
          model_usado: string
          output_markdown: string
          personas_snapshot: Json
          solicitado_em: string
          tokens_in: number
          tokens_out: number
        }[]
      }
      get_conselho_personas_ativas: {
        Args: never
        Returns: {
          avatar_url: string
          bio_curta: string
          especialidade_tags: string[]
          familia: string
          id: string
          nome_funcional: string
          ordem: number
          referencia_publica_br: string
          referencia_publica_int: string
          slug: string
        }[]
      }
      get_conselho_personas_with_prompts: {
        Args: { p_persona_ids: string[] }
        Returns: {
          bio_curta: string
          id: string
          nome_funcional: string
          slug: string
          system_prompt_chunk: string
        }[]
      }
      get_csat_report_list: {
        Args: {
          p_agent_id?: string
          p_cliente_id?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_has_comment?: boolean
          p_is_group?: boolean
          p_limit?: number
          p_score?: number
          p_tenant_id: string
        }
        Returns: {
          attendance_code: string
          attendance_id: string
          cliente_nome: string
          department_id: string
          id: string
          reason: string
          responded_at: string
          score: number
          setor: string
        }[]
      }
      get_csat_report_summary: {
        Args: {
          p_agent_id?: string
          p_cliente_id?: string
          p_date_from: string
          p_date_to: string
          p_department_id?: string
          p_has_comment?: boolean
          p_is_group?: boolean
          p_score?: number
          p_tenant_id: string
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
      get_inactive_attendances_to_process: {
        Args: { p_limit?: number }
        Returns: {
          assigned_to: string
          attendance_code: string
          contact_id: string
          conversation_id: string
          department_id: string
          effective_close_min: number
          effective_warn_before: number
          id: string
          inactivity_warning_sent_at: string
          instance_id: string
          last_customer_message_at: string
          last_operator_message_at: string
          needs_close: boolean
          needs_warn: boolean
          opened_at: string
          scheduled_until: string
          tenant_id: string
          warn_enabled: boolean
        }[]
      }
      get_instance_secrets: { Args: { p_instance_id: string }; Returns: Json }
      get_message_notification_recipients: {
        Args: { p_conversation_id: string }
        Returns: {
          user_id: string
        }[]
      }
      get_message_notification_recipients_v2: {
        Args: { p_conversation_id: string }
        Returns: {
          silent_mode: boolean
          user_id: string
        }[]
      }
      get_messages_projection: { Args: never; Returns: Json }
      get_monitor_maintenance_metrics: { Args: never; Returns: Json }
      get_mrr_monthly_snapshots: {
        Args: {
          p_data_referencia?: string
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_months_back?: number
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: {
          data_corte: string
          mrr: number
        }[]
      }
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
      get_my_allowed_unidades: {
        Args: { p_tenant_id: string }
        Returns: {
          id: number
          is_default_filter: boolean
          is_principal: boolean
          nome: string
        }[]
      }
      get_my_permissions: {
        Args: never
        Returns: {
          can_delete: boolean
          can_insert: boolean
          can_update: boolean
          can_view: boolean
          description: string
          display_order: number
          hidden: boolean
          is_navigation: boolean
          label: string
          module: string
          parent_key: string
          resource_key: string
          where_it_appears: string
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
      get_pending_closures: {
        Args: {
          p_agent_id?: string
          p_date_from?: string
          p_date_to?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          agent_name: string
          ai_category: string
          ai_summary: string
          assigned_to: string
          attendance_code: string
          attendance_id: string
          cliente_id: string
          cliente_nome: string
          closed_at: string
          closure_type: string
          contact_id: string
          contact_name: string
          contact_phone: string
          department_name: string
          msg_agent_count: number
          msg_customer_count: number
        }[]
      }
      get_simple_template_preview: {
        Args: { p_template_id: string }
        Returns: {
          label: string
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
      get_tenant_conselho_config: {
        Args: { p_tab_key: string; p_tenant_id: string }
        Returns: {
          cache_horas: number
          foco_mes: string
          persona_ids: string[]
          tab_key: string
          template_ativo: boolean
          template_custo_brl: number
          template_existe: boolean
          template_objetivo_aba: string
          tenant_id: string
          tom: string
          updated_at: string
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
      get_tenant_messages_breakdown: {
        Args: { p_from: string; p_tenant_id: string; p_to: string }
        Returns: Json
      }
      get_tenant_users_with_email: {
        Args: { p_tenant_id: string }
        Returns: {
          created_at: string
          email: string
          funcionario_id: number
          is_super_admin: boolean
          max_concurrent_chats: number
          role: string
          skills: string[]
          status: string
          user_id: string
        }[]
      }
      get_tenants_projection: { Args: never; Returns: Json }
      get_tenure_medio_meses: {
        Args: {
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: number
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
          presence_status: string
          role: string
          status: string
          user_id: string
        }[]
      }
      get_unread_notification_count: { Args: never; Returns: number }
      get_ura_departments: {
        Args: never
        Returns: {
          default_instance_id: string
          id: string
          name: string
        }[]
      }
      get_user_department_id: { Args: never; Returns: string }
      get_vendas_breakdown: {
        Args: {
          p_dim: string
          p_fim: string
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_ini: string
          p_tenant: string
          p_unidade_base_id?: number
        }
        Returns: {
          custo: number
          label: string
          margem_pct: number
          margem_rs: number
          new_mrr: number
          qtd: number
          ticket: number
        }[]
      }
      get_vendas_produtos: {
        Args: {
          p_fim: string
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_ini: string
          p_tenant: string
          p_unidade_base_id?: number
        }
        Returns: {
          label: string
          margem_pct: number
          margem_rs: number
          new_mrr: number
          qtd: number
        }[]
      }
      get_vendas_serie_mensal: {
        Args: {
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_meses?: number
          p_tenant: string
          p_unidade_base_id?: number
        }
        Returns: {
          mes: string
          new_mrr: number
          qtd: number
          ticket: number
        }[]
      }
      get_vendas_ticket_stats: {
        Args: {
          p_fim: string
          p_fornecedor_id?: number
          p_fornecedor_ids?: number[]
          p_ini: string
          p_tenant: string
          p_unidade_base_id?: number
        }
        Returns: {
          maximo: number
          media: number
          mediana: number
          minimo: number
          n: number
          p25: number
          p75: number
        }[]
      }
      import_clientes_produtos_batch: { Args: { p_rows: Json }; Returns: Json }
      import_service_catalog_template: {
        Args: {
          p_produto_mapping?: Json
          p_target_tenant_id?: string
          p_template_id: string
        }
        Returns: Json
      }
      import_simple_template: {
        Args: { p_target_tenant_id?: string; p_template_id: string }
        Returns: Json
      }
      is_admin_or_head: { Args: never; Returns: boolean }
      is_current_user_active: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      is_tenant_active_member: { Args: never; Returns: boolean }
      is_tenant_admin: { Args: never; Returns: boolean }
      is_tenant_admin_or_head: { Args: never; Returns: boolean }
      kpi_cap_seconds: { Args: { p_metric: string }; Returns: number }
      link_cliente_to_attendance: {
        Args: { p_attendance_id: string; p_cliente_id: string }
        Returns: undefined
      }
      list_catalog_templates: {
        Args: never
        Returns: {
          created_at: string
          descricao: string
          id: string
          is_published: boolean
          item_count: number
          kind: string
          nome: string
          origem: string
          source_tenant_id: string
        }[]
      }
      list_conselho_analises: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_tab_key?: string
          p_tenant_id: string
        }
        Returns: {
          cache_hit: boolean
          custo_estimado_usd: number
          foco_mes: string
          id: string
          model_usado: string
          solicitado_em: string
          solicitado_por: string
          solicitado_por_email: string
          status: string
          tab_key: string
          tokens_in: number
          tokens_out: number
          tom: string
        }[]
      }
      list_published_catalog_templates: {
        Args: never
        Returns: {
          descricao: string
          id: string
          item_count: number
          nome: string
          origem: string
        }[]
      }
      list_published_templates: {
        Args: { p_kind: string }
        Returns: {
          descricao: string
          id: string
          item_count: number
          nome: string
          origem: string
        }[]
      }
      mark_all_mentions_seen: { Args: never; Returns: undefined }
      mark_all_notifications_read: { Args: never; Returns: undefined }
      mark_conversation_notifications_read: {
        Args: { p_conversation_id: string }
        Returns: number
      }
      mark_mention_seen: { Args: { p_mention_id: string }; Returns: undefined }
      mark_notification_read: {
        Args: { p_recipient_id: string }
        Returns: undefined
      }
      merge_whatsapp_contacts: {
        Args: { p_keep_id: string; p_merge_id: string; p_tenant_id: string }
        Returns: undefined
      }
      montar_payload_contrato_omie: {
        Args: { p_contrato_id: string; p_tenant_id: string }
        Returns: Json
      }
      mute_conversation: {
        Args: { p_conversation_id: string; p_duration: string }
        Returns: undefined
      }
      next_support_attendance_seq: {
        Args: { p_tenant: string }
        Returns: number
      }
      next_ticket_code: { Args: { p_tenant_id: string }; Returns: string }
      norm_txt: { Args: { t: string }; Returns: string }
      notify_event: {
        Args: {
          p_action_url?: string
          p_body: string
          p_dedupe_key: string
          p_event_type: string
          p_metadata?: Json
          p_tenant_id: string
          p_title: string
        }
        Returns: Json
      }
      obter_chave_omie: { Args: { p_tenant_id?: string }; Returns: string }
      obter_chave_omie_sistema: {
        Args: { p_tenant_id: string }
        Returns: string
      }
      preparar_reajuste: {
        Args: {
          p_percentual: number
          p_periodo_fim: string
          p_periodo_inicio: string
          p_tenant_id: string
          p_unidade_base_id?: number
        }
        Returns: Json
      }
      preview_delete_cliente: {
        Args: { p_cliente_id: string; p_target_id?: string }
        Returns: Json
      }
      process_maintenance_queue: { Args: never; Returns: undefined }
      process_notification_dispatch_queue: {
        Args: { p_batch_size?: number }
        Returns: Json
      }
      reativar_cliente: {
        Args: { p_cliente_id: string; p_motivo?: string; p_observacao?: string }
        Returns: Json
      }
      reativar_contrato: {
        Args: { p_contrato_id: string; p_observacao?: string }
        Returns: Json
      }
      reconciliacao_fornecedores_count: {
        Args: { p_tenant_id: string }
        Returns: {
          fornecedor_ds: string
          qtd: number
        }[]
      }
      reconciliacao_resumo: {
        Args: { p_fornecedor_id?: number; p_tenant_id: string }
        Returns: {
          acao_sugerida: string
          gerado_em: string
          qtd: number
        }[]
      }
      register_conselho_analise: {
        Args: {
          p_alertas_factuais: Json
          p_cache_hit_de?: string
          p_cache_horas: number
          p_custo_estimado_usd: number
          p_dados_snapshot: Json
          p_duracao_ms: number
          p_error_message: string
          p_filtros_aplicados: Json
          p_foco_mes: string
          p_input_hash: string
          p_model_usado: string
          p_output_markdown: string
          p_personas_ids: string[]
          p_personas_snapshot: Json
          p_prompt_final: string
          p_provider_usado: string
          p_status: string
          p_tab_key: string
          p_tenant_id: string
          p_tipo?: string
          p_tokens_in: number
          p_tokens_out: number
          p_tom: string
        }
        Returns: string
      }
      remind_ai_disabled: { Args: never; Returns: Json }
      require_active_profile: { Args: never; Returns: boolean }
      reset_tenant_permissions_to_default: {
        Args: { p_role?: string; p_tenant_id?: string }
        Returns: Json
      }
      resolve_group_contact_name: {
        Args: {
          p_group_jid: string
          p_instance_id: string
          p_tenant_id: string
        }
        Returns: string
      }
      resolve_notification_incident: {
        Args: {
          p_dedupe_key: string
          p_event_type: string
          p_tenant_id: string
        }
        Returns: boolean
      }
      resolve_user_notification_settings: {
        Args: { p_user_id: string }
        Returns: Json
      }
      rodar_deteccao_reconciliacao: {
        Args: { p_tenant_id: string }
        Returns: number
      }
      salvar_data_corte_omie: {
        Args: { p_data: string; p_tenant_id: string }
        Returns: string
      }
      salvar_integracao_omie: {
        Args: { p_chave: string; p_tenant_id?: string }
        Returns: Json
      }
      scan_ura_battle_conversations: {
        Args: {
          p_days?: number
          p_min_our_per_bucket?: number
          p_min_their_per_bucket?: number
        }
        Returns: {
          battle_buckets: number
          contact_name: string
          conversation_id: string
          conversation_status: string
          conversation_updated_at: string
          instance_id: string
          is_paused: boolean
          phone_number: string
          total_battle_msgs: number
          worst_at: string
          worst_our: number
          worst_their: number
        }[]
      }
      schedule_attendance: {
        Args: { p_attendance_id: string; p_scheduled_until: string }
        Returns: Json
      }
      search_clientes_for_link: {
        Args: { p_tenant_id: string; p_term: string }
        Returns: {
          cnpj: string
          codigo_sequencial: number
          id: string
          nome_fantasia: string
          razao_social: string
          telefone_whatsapp: string
        }[]
      }
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
      segundos_uteis: {
        Args: {
          p_department_id?: string
          p_end: string
          p_start: string
          p_tenant_id: string
        }
        Returns: number
      }
      send_theo_weekly_report: { Args: never; Returns: Json }
      send_weekly_management_digest: { Args: never; Returns: Json }
      set_attendance_cliente: {
        Args: { p_attendance_id: string; p_cliente_id: string }
        Returns: undefined
      }
      set_group_cliente: {
        Args: { p_cliente_id: string; p_conversation_id: string }
        Returns: Json
      }
      set_group_monitor: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: Json
      }
      set_unidade_default_filter: {
        Args: { p_unidade_id: number }
        Returns: undefined
      }
      set_unidade_principal: {
        Args: { p_unidade_id: number }
        Returns: undefined
      }
      set_view_unidades: { Args: { p_ids: number[] }; Returns: undefined }
      should_create_recipient: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: boolean
      }
      snapshot_reconciliacao_ds: {
        Args: { p_tenant_id: string }
        Returns: {
          cnpj_norm: string
          dia_vencimento: number
          ds_contract_id: string
          ds_customer_id: string
          modelo: string
          multi_contrato: boolean
          numero: string
          passa_validacao: boolean
          qtd_contratos_ativos_cliente: number
          qtd_itens: number
          razao_social: string
          tem_datas: boolean
          tem_modelo: boolean
          valor_mrr: number
          vigencia_final: string
          vigencia_inicial: string
        }[]
      }
      soft_delete_ticket: { Args: { p_ticket_id: string }; Returns: undefined }
      start_conversation_from_ticket: {
        Args: {
          p_contact_name?: string
          p_department_id?: string
          p_instance_id: string
          p_participant_label?: string
          p_participant_type?: string
          p_phone: string
          p_ticket_id: string
        }
        Returns: Json
      }
      start_group_attendance: {
        Args: {
          p_agent_id: string
          p_conversation_id: string
          p_created_from?: string
          p_include_previous?: number
        }
        Returns: Json
      }
      sync_cliente_produto_to_contract: {
        Args: { p_cliente_produto_id: string }
        Returns: undefined
      }
      tenant_user_count: { Args: { p_tenant: string }; Returns: number }
      theo_daily_payload: {
        Args: { p_date?: string; p_tenant: string }
        Returns: Json
      }
      theo_emoji: { Args: { p_sinal: string }; Returns: string }
      theo_kpis_janela: {
        Args: { p_fim: string; p_ini: string; p_tenant: string }
        Returns: Json
      }
      theo_sinais_semana: {
        Args: { p_ref_date?: string; p_tenant: string }
        Returns: Json
      }
      theo_weekly_payload: {
        Args: { p_ref_date?: string; p_tenant: string }
        Returns: Json
      }
      transfer_conversation_to_agent: {
        Args: {
          p_conversation_id: string
          p_new_assignee: string
          p_reason?: string
        }
        Returns: undefined
      }
      try_claim_off_hours_notice: {
        Args: { p_conversation_id: string; p_cooldown_minutes?: number }
        Returns: boolean
      }
      unidade_allowed: { Args: { p_unidade: number }; Returns: boolean }
      unidade_visible: { Args: { p_unidade: number }; Returns: boolean }
      unlink_cliente_from_conversation: {
        Args: {
          p_conversation_id: string
          p_remove_phone_from_contacts?: boolean
        }
        Returns: Json
      }
      unmute_conversation: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      unschedule_attendance: {
        Args: { p_attendance_id: string }
        Returns: Json
      }
      update_csat_score: {
        Args: { p_csat_id: string; p_new_score: number; p_reason?: string }
        Returns: undefined
      }
      update_tenant_permission: {
        Args: {
          p_action: string
          p_resource_key: string
          p_role: string
          p_tenant_id?: string
          p_value: boolean
        }
        Returns: Json
      }
      update_ticket_checklist: {
        Args: {
          p_action?: string
          p_checklist: Json
          p_item_text?: string
          p_ticket_id: string
        }
        Returns: undefined
      }
      update_ticket_fields: {
        Args: { p_fields: Json; p_ticket_id: string }
        Returns: undefined
      }
      update_ticket_status: {
        Args: {
          p_agendado_para?: string
          p_new_status_id: string
          p_previsao_encerramento?: string
          p_ticket_id: string
        }
        Returns: undefined
      }
      upload_ticket_attachment: {
        Args: {
          p_file_content: string
          p_file_name: string
          p_file_size?: number
          p_file_type?: string
          p_ticket_id: string
        }
        Returns: string
      }
      upsert_tenant_conselho_config: {
        Args: {
          p_cache_horas?: number
          p_foco_mes?: string
          p_persona_ids: string[]
          p_tab_key: string
          p_tenant_id: string
          p_tom?: string
        }
        Returns: undefined
      }
      user_allowed_unidades: { Args: never; Returns: number[] }
      user_effective_unidades: { Args: never; Returns: number[] }
      user_view_unidades: { Args: never; Returns: number[] }
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
      vault_get_secret_id_by_name: { Args: { p_name: string }; Returns: string }
      vault_update_secret: {
        Args: { p_id: string; p_secret: string }
        Returns: undefined
      }
      wa_check_conversation_availability: {
        Args: { p_instance_id: string; p_phone: string; p_tenant_id: string }
        Returns: Json
      }
      wa_open_or_reuse_conversation: {
        Args: {
          p_cliente_id?: string
          p_contact_name?: string
          p_department_id?: string
          p_instance_id: string
          p_phone: string
          p_tenant_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      contrato_tipo: "base" | "aditivo"
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
      movimento_mrr_tipo:
        | "upsell"
        | "cross_sell"
        | "downsell"
        | "venda_avulsa"
        | "churn"
        | "reactivation"
        | "reajuste"
      recorrencia_tipo: "mensal" | "anual" | "semestral" | "semanal"
      sentiment_type: "positive" | "neutral" | "negative"
      support_ticket_prioridade: "baixa" | "media" | "alta" | "urgente"
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
      contrato_tipo: ["base", "aditivo"],
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
      movimento_mrr_tipo: [
        "upsell",
        "cross_sell",
        "downsell",
        "venda_avulsa",
        "churn",
        "reactivation",
        "reajuste",
      ],
      recorrencia_tipo: ["mensal", "anual", "semestral", "semanal"],
      sentiment_type: ["positive", "neutral", "negative"],
      support_ticket_prioridade: ["baixa", "media", "alta", "urgente"],
      support_ticket_tipo: ["cliente", "fornecedor"],
    },
  },
} as const
