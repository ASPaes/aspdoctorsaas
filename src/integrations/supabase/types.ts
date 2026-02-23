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
      clientes: {
        Row: {
          area_atuacao_id: number | null
          cancelado: boolean
          cidade_id: number | null
          cnpj: string | null
          codigo_fornecedor: string | null
          created_at: string
          custo_fixo_percentual: number | null
          custo_operacao: number | null
          data_ativacao: string | null
          data_cadastro: string | null
          data_cancelamento: string | null
          data_venda: string | null
          email: string | null
          estado_id: number | null
          forma_pagamento_ativacao_id: number | null
          forma_pagamento_mensalidade_id: number | null
          fornecedor_id: number | null
          funcionario_id: number | null
          id: string
          imposto_percentual: number | null
          link_portal_fornecedor: string | null
          mensalidade: number | null
          motivo_cancelamento_id: number | null
          nome_fantasia: string | null
          observacao_cancelamento: string | null
          observacao_cliente: string | null
          observacao_negociacao: string | null
          origem_venda: string | null
          produto_id: number | null
          razao_social: string | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id: number | null
          telefone_contato: string | null
          telefone_whatsapp: string | null
          updated_at: string
          valor_ativacao: number | null
          vertical_id: number | null
        }
        Insert: {
          area_atuacao_id?: number | null
          cancelado?: boolean
          cidade_id?: number | null
          cnpj?: string | null
          codigo_fornecedor?: string | null
          created_at?: string
          custo_fixo_percentual?: number | null
          custo_operacao?: number | null
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          estado_id?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
          funcionario_id?: number | null
          id?: string
          imposto_percentual?: number | null
          link_portal_fornecedor?: string | null
          mensalidade?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda?: string | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          updated_at?: string
          valor_ativacao?: number | null
          vertical_id?: number | null
        }
        Update: {
          area_atuacao_id?: number | null
          cancelado?: boolean
          cidade_id?: number | null
          cnpj?: string | null
          codigo_fornecedor?: string | null
          created_at?: string
          custo_fixo_percentual?: number | null
          custo_operacao?: number | null
          data_ativacao?: string | null
          data_cadastro?: string | null
          data_cancelamento?: string | null
          data_venda?: string | null
          email?: string | null
          estado_id?: number | null
          forma_pagamento_ativacao_id?: number | null
          forma_pagamento_mensalidade_id?: number | null
          fornecedor_id?: number | null
          funcionario_id?: number | null
          id?: string
          imposto_percentual?: number | null
          link_portal_fornecedor?: string | null
          mensalidade?: number | null
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda?: string | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          updated_at?: string
          valor_ativacao?: number | null
          vertical_id?: number | null
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
            foreignKeyName: "clientes_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticais"
            referencedColumns: ["id"]
          },
        ]
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
      produtos: {
        Row: {
          codigo_fornecedor: string | null
          fornecedor_id: number | null
          id: number
          link_portal: string | null
          nome: string
        }
        Insert: {
          codigo_fornecedor?: string | null
          fornecedor_id?: number | null
          id?: number
          link_portal?: string | null
          nome: string
        }
        Update: {
          codigo_fornecedor?: string | null
          fornecedor_id?: number | null
          id?: number
          link_portal?: string | null
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
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
      verticais: {
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
          cidade_id: number | null
          cnpj: string | null
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
          motivo_cancelamento_id: number | null
          nome_fantasia: string | null
          observacao_cancelamento: string | null
          observacao_cliente: string | null
          observacao_negociacao: string | null
          origem_venda: string | null
          produto_id: number | null
          razao_social: string | null
          recorrencia: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id: number | null
          telefone_contato: string | null
          telefone_whatsapp: string | null
          updated_at: string | null
          valor_ativacao: number | null
          valor_repasse: number | null
          vertical_id: number | null
        }
        Insert: {
          area_atuacao_id?: number | null
          cancelado?: boolean | null
          cidade_id?: number | null
          cnpj?: string | null
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
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda?: string | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          updated_at?: string | null
          valor_ativacao?: number | null
          valor_repasse?: never
          vertical_id?: number | null
        }
        Update: {
          area_atuacao_id?: number | null
          cancelado?: boolean | null
          cidade_id?: number | null
          cnpj?: string | null
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
          motivo_cancelamento_id?: number | null
          nome_fantasia?: string | null
          observacao_cancelamento?: string | null
          observacao_cliente?: string | null
          observacao_negociacao?: string | null
          origem_venda?: string | null
          produto_id?: number | null
          razao_social?: string | null
          recorrencia?: Database["public"]["Enums"]["recorrencia_tipo"] | null
          segmento_id?: number | null
          telefone_contato?: string | null
          telefone_whatsapp?: string | null
          updated_at?: string | null
          valor_ativacao?: number | null
          valor_repasse?: never
          vertical_id?: number | null
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
            foreignKeyName: "clientes_vertical_id_fkey"
            columns: ["vertical_id"]
            isOneToOne: false
            referencedRelation: "verticais"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
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
      recorrencia_tipo: ["mensal", "anual", "semestral", "semanal"],
    },
  },
} as const
