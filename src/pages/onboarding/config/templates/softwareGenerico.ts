import type { OnboardingTemplate } from "./types";

/**
 * Desenho enxuto para quem não vende PDV: 4 etapas por jornada e checklist curto,
 * sem grupo por tipo de demanda. Serve de ponto de partida, não de operação pronta.
 */

const SECOES = [
  "participantes", "timeline", "pausas", "modulos", "contabilidade",
  "treinos", "checklist", "atendimentos", "eventos", "anexos",
];

export const SOFTWARE_GENERICO_TEMPLATE: OnboardingTemplate = {
  id: "software-generico",
  nome: "Software genérico",
  descricao:
    "Ponto de partida simples para qualquer software: 4 etapas por jornada, checklist curto e catálogos mínimos.",
  blueprint: {
    pipelines: [
      {
        fase: "onboarding",
        nome: "Onboarding",
        descricao: "Da venda até o treinamento agendado.",
        stages: [
          {
            nome: "Novo cliente",
            sla_minutos: 240,
            cor: "#0EA5E9",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Enviar mensagem de boas-vindas", is_required: true },
              { texto: "Confirmar contato do responsável", is_required: true },
            ],
          },
          {
            nome: "Conferência do pedido",
            sla_minutos: 480,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist: [
              { texto: "Conferir o que foi vendido", is_required: true },
              { texto: "Confirmar módulos contratados", is_required: true },
              { texto: "Registrar particularidades do cliente", is_required: false },
            ],
          },
          {
            nome: "Coleta de dados",
            sla_minutos: 960,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist: [
              { texto: "Coletar dados cadastrais", is_required: true },
              { texto: "Coletar acessos e credenciais", is_required: true },
              { texto: "Receber base para migração", is_required: false },
              { texto: "Validar infraestrutura do cliente", is_required: true },
            ],
          },
          {
            nome: "Agendar treinamento",
            sla_minutos: 480,
            cor: "#0EA5E9",
            is_final: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Alinhar agenda com o cliente", is_required: true },
              { texto: "Confirmar participantes", is_required: true },
              { texto: "Enviar link do treinamento", is_required: true },
            ],
          },
        ],
      },
      {
        fase: "implantacao",
        nome: "Implantação",
        descricao: "Do treinamento agendado à conclusão.",
        stages: [
          {
            nome: "Treinamento agendado",
            sla_minutos: 480,
            cor: "#22C55E",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Confirmar presença na véspera", is_required: true },
              { texto: "Preparar ambiente do cliente", is_required: true },
            ],
          },
          {
            nome: "Treinamento realizado",
            sla_minutos: 480,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist: [
              { texto: "Registrar o que foi treinado", is_required: true },
              { texto: "Enviar material de apoio", is_required: true },
              { texto: "Enviar contato do suporte", is_required: true },
            ],
          },
          {
            nome: "Acompanhamento",
            sla_minutos: 1440,
            cor: "#F59E0B",
            visible_sections: SECOES,
            checklist: [
              { texto: "Confirmar primeiro uso real", is_required: true },
              { texto: "Tratar dúvidas do primeiro dia", is_required: false },
            ],
          },
          {
            nome: "Concluído",
            sla_minutos: 0,
            cor: "#22C55E",
            is_final: true,
            encerra_sla: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Enviar pesquisa de satisfação", is_required: true },
              { texto: "Registrar conclusão", is_required: true },
            ],
          },
        ],
      },
    ],
    demand_types: [{ nome: "Novo Cliente", descricao: null }],
    training_types: [{ nome: "Treinamento", conta_como_pdv: true }],
    pause_reasons: [{ nome: "Aguardando o cliente" }, { nome: "Pendência financeira" }],
    accounting_fields: [],
    vendor_return_reasons: [
      { nome: "Dados incompletos", atribuivel_vendedor: true },
      { nome: "Venda não corresponde à necessidade", atribuivel_vendedor: true },
    ],
  },
};
