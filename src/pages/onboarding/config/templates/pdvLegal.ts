import type { OnboardingTemplate } from "./types";

/**
 * Espelho da operação de PDV Legal da Digi Office, sem nada do cliente Nutrebem
 * (grupos "Recolhimento de Dados", "Cadastro Fiscal - Nutrebem" e "Finalizar Ticket",
 * e o tipo de demanda "Novo Cliente - Nutrebem" ficaram de fora de propósito).
 *
 * Os textos vão LITERAIS, inclusive os erros de digitação. Corrigir aqui criaria
 * divergência silenciosa entre o template e a operação real deles.
 */

const SECOES = [
  "participantes", "timeline", "pausas", "modulos", "contabilidade",
  "treinos", "checklist", "atendimentos", "eventos", "anexos",
];
const SECOES_COM_ACOMP = [...SECOES, "acompanhamento"];

export const PDV_LEGAL_TEMPLATE: OnboardingTemplate = {
  id: "pdv-legal",
  nome: "PDV Legal",
  descricao:
    "Operação completa de PDV: onboarding com cadastro fiscal e implantação com checklist de treinamento por frente (balcão, mesa, retaguarda).",
  produto_sugerido: "PDV Legal",
  blueprint: {
    pipelines: [
      {
        fase: "onboarding",
        nome: "Onboarding PDV",
        descricao: "Da venda até o treinamento agendado.",
        stages: [
          {
            nome: "Novo Cliente",
            sla_minutos: 120,
            cor: "#0EA5E9",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
          },
          {
            nome: "Conferência",
            sla_minutos: 120,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Checklist",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Conferencia", is_required: true },
                  { texto: "Mensagem de boas vindas", is_required: true },
                ],
              },
            ],
          },
          {
            nome: "Recolhimento Dados",
            sla_minutos: 480,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Validações",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Validar modelo das maquininha", is_required: true },
                  { texto: "Validar produtos com o cliente.", is_required: true },
                  { texto: "Liberação do app PDV Legal", is_required: true },
                  { texto: "Anexar print - Valid Produtos", is_required: false },
                ],
              },
            ],
          },
          {
            nome: "Cadastro Produtos",
            sla_minutos: 960,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Cadastro Fiscal",
                demandas: ["Novo Cliente", "Mudança Regime Fiscal"],
                itens: [
                  { texto: "Lançar licença no OEM", is_required: false },
                  { texto: "Fazer a planilha de produtos", is_required: false },
                  { texto: "Importar cadastro", is_required: true },
                  { texto: "Configurar grupos", is_required: true },
                  { texto: "Configurar usuários", is_required: true },
                  { texto: "Configurar formas de pagamento", is_required: true },
                  { texto: "Configurar filiais", is_required: true },
                  { texto: "Configurar perfil PDV", is_required: true },
                  { texto: "Configurar Fiscal", is_required: false },
                  { texto: "Envio e-mail XML contabilidade", is_required: false },
                  { texto: "Colocar dados do invoicy no Doctor Saas", is_required: false },
                ],
              },
            ],
          },
          {
            nome: "Marcar treinamento PDV",
            sla_minutos: 480,
            cor: "#0EA5E9",
            is_final: true,
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Marcação de Treinamento",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Validar PDV nas maquininhas", is_required: true },
                  { texto: "Enviar orientações sobre o agendamento", is_required: true },
                  { texto: "Enviar link para agendamento", is_required: false },
                ],
              },
            ],
          },
        ],
      },
      {
        fase: "implantacao",
        nome: "Implantação PDV",
        descricao: "Do treinamento agendado ao encerramento dos sub-tickets.",
        stages: [
          {
            nome: "Pendências",
            sla_minutos: 0,
            cor: "#EF4444",
            visible_sections: SECOES,
          },
          {
            nome: "Pendente Agendar",
            sla_minutos: 0,
            cor: "#F59E0B",
            retorno_no_show: true,
            visible_sections: SECOES_COM_ACOMP,
          },
          {
            nome: "Treinamento Marcado",
            sla_minutos: 120,
            cor: "#22C55E",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Checklist PDV",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Fundo de caixa | Sangria", is_required: true },
                  { texto: "Encerramento de caixa", is_required: true },
                ],
              },
              {
                nome: "Check List Balcão",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Cancelamento de item", is_required: true },
                  { texto: "Cancelamento total venda", is_required: true },
                  { texto: "Desconto", is_required: true },
                  { texto: "Recebimento", is_required: true },
                  { texto: "Multiplicas formas de pagamento", is_required: true },
                ],
              },
              {
                nome: "Check List Mesa",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Emissão de conta", is_required: false },
                  { texto: "Função fecha | paga", is_required: false },
                  { texto: "Nomear mesa", is_required: false },
                  { texto: "Mapa de mesa", is_required: false },
                  { texto: "Cores das mesas", is_required: false },
                  { texto: "Transferência", is_required: false },
                  { texto: "Reabertura", is_required: false },
                  { texto: "Pagamento Parcial", is_required: false },
                  { texto: "Processo 10%", is_required: false },
                ],
              },
              {
                nome: "Checklist Gestão | Retaguarda",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Enviar login do gestão", is_required: true },
                  { texto: "Valorizar 100% online", is_required: true },
                  { texto: "Cadastro grupo produtos", is_required: true },
                  { texto: "Cadastro produtos (duplicar)", is_required: true },
                  { texto: "Tabela de preços", is_required: true },
                  { texto: "Cadastro usuário PDV", is_required: true },
                ],
              },
              {
                nome: "Checklist Geral",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Alinhamento agenda no início", is_required: true },
                  { texto: "Ressaltar benefícios pg integrado", is_required: true },
                  { texto: "Valorizar já cadastramos produtos", is_required: true },
                  { texto: "Marcar produtos como favorito", is_required: true },
                  { texto: "Importância Modificadores", is_required: true },
                  { texto: "Verificar PIX integrado", is_required: true },
                  { texto: "Teste de estresse no final", is_required: true },
                  { texto: "Apresentação final PDF", is_required: true },
                  { texto: "Enviar vídeos no wpp", is_required: true },
                  { texto: "Enviar contato do suporte", is_required: true },
                  { texto: "Enviar pesquisa satisfação", is_required: true },
                  { texto: "Enviar gravação treinamento", is_required: true },
                ],
              },
            ],
          },
          {
            nome: "No-Show",
            sla_minutos: 0,
            cor: "#F59E0B",
            visible_sections: SECOES,
          },
          {
            nome: "Sub-tickets Finalizados",
            sla_minutos: 0,
            cor: "#22C55E",
            is_final: true,
            encerra_sla: true,
            visible_sections: SECOES,
          },
        ],
      },
    ],
    demand_types: [
      { nome: "Novo Cliente", descricao: null },
      { nome: "Mudança Regime Fiscal", descricao: null },
      { nome: "Up-Sell", descricao: null },
      { nome: "Down-Sell", descricao: null },
      { nome: "Treinamento Extra", descricao: null },
      { nome: "Mudança de CNPJ", descricao: null },
      { nome: "Mudança Servidor", descricao: null },
      { nome: "Troca de adquirente", descricao: null },
    ],
    training_types: [
      { nome: "Treinamento PDV", conta_como_pdv: true },
      { nome: "Segundo Treinamento", conta_como_pdv: false },
      { nome: "Estoque", conta_como_pdv: false },
      { nome: "Financeiro", conta_como_pdv: false },
      { nome: "NF-e", conta_como_pdv: false },
      { nome: "Delivery Legal", conta_como_pdv: false },
      { nome: "Fidelidade Legal", conta_como_pdv: false },
      { nome: "Conta Assinada", conta_como_pdv: false },
      { nome: "Auto Atendimento Food", conta_como_pdv: false },
      { nome: "iFood/99", conta_como_pdv: false },
      { nome: "Mudança para Servidor Legal", conta_como_pdv: false },
      { nome: "Mudança de CNPJ", conta_como_pdv: false },
    ],
    pause_reasons: [
      { nome: "Aguardando contabilidade" },
      { nome: "Aguardando inauguração" },
      { nome: "Aguardando maquininha" },
      { nome: "Configuração Impressora" },
    ],
    accounting_fields: [
      { nome: "Nome Contabilidade", tipo: "text", opcoes: null },
      { nome: "E-mail Contabilidade", tipo: "text", opcoes: null },
      { nome: "Telefone Contabilidade", tipo: "number", opcoes: null },
      { nome: "Anexo Certificado Digital", tipo: "text", opcoes: null },
      { nome: "Senha Certificado", tipo: "text", opcoes: null },
      { nome: "ID CSC", tipo: "number", opcoes: null },
      { nome: "CSC NFC-e", tipo: "text", opcoes: null },
      { nome: "Token IBPT", tipo: "text", opcoes: null },
    ],
    vendor_return_reasons: [
      { nome: "Dados errados", atribuivel_vendedor: true },
      { nome: "Faltou dados", atribuivel_vendedor: true },
      { nome: "Falta de retorno do cliente", atribuivel_vendedor: true },
    ],
  },
};
