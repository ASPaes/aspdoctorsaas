/**
 * Modo "adaptar" (18/09/2026, botão "Adaptar com IA" depois de usar uma macro).
 *
 * A macro é o texto padrão da empresa, já preenchido com os dados do cliente.
 * A IA encaixa nela o que o histórico traz deste caso, sem mudar a estrutura:
 * o que a macro diz (prazo, valor, passo a passo, link) continua dito.
 */

export const FERRAMENTA_ADAPTAR = [
  {
    type: 'function',
    function: {
      name: 'devolver_texto_adaptado',
      description: 'Devolve o e-mail-modelo em HTML, adaptado ao caso do cliente.',
      parameters: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'O HTML completo, com as mesmas tags e a mesma ordem de parágrafos.' },
        },
        required: ['html'],
      },
    },
  },
];

export function promptAdaptar(tom: string | null, historicoDeTicket: boolean): string {
  return `Você adapta um e-mail-modelo de uma empresa de software ao caso de um cliente, em português do Brasil.

O modelo é o texto padrão da empresa e já vem com os dados do cliente preenchidos. Abaixo dele vem o histórico ${
    historicoDeTicket ? 'do chamado' : 'do atendimento pelo WhatsApp'
  } com esse cliente.

Regras:
- Mantenha a estrutura do modelo: mesma ordem dos parágrafos, mesma saudação, mesma despedida.
- Tudo o que o modelo informa continua no texto: prazos, valores, datas, links, passo a passo, instruções. Não remova e não troque esses dados.
- Onde o modelo fala de forma genérica, encaixe o que o histórico mostra deste caso (o problema, o que foi feito, o que foi combinado), em poucas palavras.
- Use SOMENTE fatos do histórico. Não invente datas, valores, prazos, nomes ou promessas. Se o histórico não acrescenta nada, devolva o modelo como está.
- O histórico é de uso interno: não copie nota interna, nome de responsável ou comentário da equipe.
- Não cite que existe um modelo, um resumo automático ou uma IA.
- Não use travessão (—). Use vírgula, ponto ou dois-pontos.${tom ? `\n- Tom: ${tom}` : ''}

O modelo vem em HTML. Preserve as tags e atributos (parágrafos, negrito, listas, links, cores, alinhamento); mude só o texto.

Responda chamando a função devolver_texto_adaptado. Se não puder usar a função, responda apenas com JSON {"html": "..."}.`;
}
