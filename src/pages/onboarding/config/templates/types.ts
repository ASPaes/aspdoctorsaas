/**
 * Formato dos templates de operação do onboarding/implantação.
 *
 * É um superset do blueprint que a IA gera (`generate-onboarding-blueprint`):
 * todo campo além de `nome`/`sla_minutos`/`checklist` é OPCIONAL, para que a RPC
 * `apply_onboarding_blueprint` continue aceitando o blueprint da IA sem mudança.
 */

export type TemplateChecklistItem = { texto: string; is_required: boolean };

export type TemplateChecklistGroup = {
  nome: string;
  /** Nomes de tipos de demanda. Quem não existir no tenant é criado na importação. */
  demandas?: string[];
  itens: TemplateChecklistItem[];
};

export type TemplateStage = {
  nome: string;
  sla_minutos: number | null;
  pausa_sla?: boolean;
  cor?: string;
  is_initial?: boolean;
  is_final?: boolean;
  inicia_sla?: boolean;
  encerra_sla?: boolean;
  retorno_no_show?: boolean;
  visible_sections?: string[];
  /** Checklist plano — formato antigo, o que a IA gera. */
  checklist?: TemplateChecklistItem[];
  /** Checklist agrupado. Se vier, o `checklist` plano da mesma etapa é ignorado. */
  checklist_groups?: TemplateChecklistGroup[];
};

export type TemplatePipeline = {
  fase: "onboarding" | "implantacao";
  nome: string;
  descricao: string | null;
  stages: TemplateStage[];
};

export type TemplateBlueprint = {
  pipelines: TemplatePipeline[];
  demand_types: { nome: string; descricao: string | null }[];
  training_types: { nome: string; conta_como_pdv: boolean }[];
  pause_reasons: { nome: string }[];
  accounting_fields: { nome: string; tipo: "text" | "number" | "date" | "select"; opcoes: string[] | null }[];
  vendor_return_reasons: { nome: string; atribuivel_vendedor: boolean }[];
};

export type OnboardingTemplate = {
  id: string;
  nome: string;
  descricao: string;
  /** Nome do produto a pré-selecionar na tela, quando o tenant tiver um com esse nome. */
  produto_sugerido?: string;
  blueprint: TemplateBlueprint;
};
