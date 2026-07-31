# Atualizações do DoctorSaaS

Registro do que foi **publicado em produção**, escrito em linguagem de cliente.
Serve de base para montar o comunicado mensal de novidades.

**Tipos:** 🆕 Novidade · ⬆️ Melhoria · 🔧 Correção

**Como manter:** a cada publicação, acrescente a entrada no dia correspondente, no topo.
Só entra o que o usuário percebe — refatoração, teste, migration e ajuste interno ficam no histórico do Git.

---

## Julho / 2026

### 31/07

- 🆕 **Onboarding / Acompanhamento** — Ativar a jornada de **Acompanhamento** passa a montar o quadro sozinho, com quatro colunas prontas: **Primeiras semanas → Uso em ritmo → Sinal de risco → Cliente destravado**. Antes a jornada era ativada e o quadro nascia vazio — sem nenhuma etapa configurada à mão, nenhum cliente conseguia sequer chegar nela. As colunas são cadastro normal: renomeie, reordene ou apague à vontade, que o sistema não desfaz o que você mudou.
- 🆕 **Onboarding / Implantação** — Cada treinamento vira um sub-ticket com número derivado do ticket original: o **TK-2026-2360** passa a ter **TK-2026-2360-1**, **-2**, **-3**. Antes o filho recebia um número solto da fila e a equipe digitava o código do pai dentro do assunto para não perder o vínculo. Os sub-tickets que já existiam foram renomeados para o formato novo.
- 🆕 **Onboarding / Implantação** — O quadro deixa de ter um cartão por cliente e passa a ter **um cartão por treinamento, com o responsável que conduz**. Cada um anda pelas colunas no seu ritmo e mostra de qual ticket veio. O botão **Agrupar por ticket** devolve a visão consolidada por cliente, com o andamento de cada treinamento.
- ⬆️ **Onboarding / Implantação** — O filtro por responsável passa a encontrar **quem conduz o treinamento**, não só o dono da jornada. Um especialista com vários treinamentos marcados agora monta a própria agenda pelo quadro.
- 🆕 **Onboarding / Implantação** — Título, tipo de treino, responsável, data e link do treinamento passam a ser **editáveis** depois de criados, e um treinamento criado por engano pode ser **excluído** enquanto não tiver andado pelas etapas. Corrigir a data pela edição não conta tentativa; "Remarcar" continua contando.
- ⬆️ **Onboarding / Implantação** — O ticket original mostra o **andamento dos treinamentos** e recebe na linha do tempo tudo o que acontece em cada um. Ele **só pode ser encerrado quando todos os treinamentos estiverem concluídos ou cancelados**, e a tela diz quais ainda estão em aberto. Abrindo pelo cartão de um treinamento, a tela é a do ticket original, mas o que for feito ali fica registrado como partindo daquele sub-ticket.
- 🔧 **Atendimento** — O sistema ficou lento e chegou a sair do ar duas vezes. A tela de conversas refazia a mesma consulta ao banco várias vezes por segundo, para cada pessoa com o painel aberto, mesmo quando nada tinha mudado — quanto mais gente atendendo ao mesmo tempo, mais pesado ficava. Agora a tela só consulta quando o estado realmente muda. O comportamento é o mesmo, o que muda é o peso.
- 🔧 **Dashboard / MRR** — O gráfico de evolução do MRR reescrevia o passado. Sempre que um cliente cancelava, ele passava a valer R$ 0 **em todos os meses anteriores também** — o número do mês atual estava certo, mas quanto mais para trás se olhava, mais o valor aparecia menor do que realmente foi. Na Digi Office, março aparecia como R$ 336 mil quando o correto era R$ 390 mil, e o painel indicava crescimento de 14% em quatro meses quando na verdade houve queda. Isso contaminava tudo que sai da série: crescimento mês a mês, trimestral e anual, ARR, Rule of 40 e a projeção. Agora cada mês considera quem estava ativo naquela data, e o histórico para de mudar.
- 🔧 **Dashboard / MRR** — As contas do saldo e do movimento não fechavam entre si: MRR do mês anterior + Net New não dava o MRR do mês, sobrando de R$ 8 mil a R$ 21 mil por mês. Faltava contabilizar o **cancelamento parcial** — cliente que continua na base e cancela só um produto, cujo valor sumia do MRR sem aparecer no churn. Agora a conta fecha exatamente.
- 🔧 **Onboarding** — Excluir uma etapa na configuração do pipeline dava erro de banco sempre que a etapa já tinha sido usada alguma vez, e não havia jeito de removê-la. Agora o sistema pergunta o que fazer: **Arquivar** tira a etapa do quadro mas mantém todo o histórico de movimentações nos relatórios (dá para reativar depois), e **Excluir tudo** apaga a etapa e o histórico dela de vez. Antes de qualquer uma das duas, se houver cartão parado na etapa, o sistema mostra quantos são e pede para qual etapa mover.

### 30/07

- 🔧 **WhatsApp** — Áudios, imagens e anexos enviados pelos números da Meta às vezes falhavam com "Falha no upload da mídia — tente reenviar", mesmo com o arquivo perfeito: quem entregava a mensagem era a Meta, e para isso ela precisava buscar o arquivo no nosso servidor — quando essa busca falhava, a mensagem se perdia. Agora o arquivo é entregue direto para a Meta antes do envio, então não há mais essa busca para falhar.
- 🆕 **Onboarding** — As jornadas deixam de ser fixas e passam a ser cadastradas por empresa, em uma aba própria na configuração: dá para renomear, trocar a cor, reordenar e desativar as que não usa. Quem trabalha com uma jornada só deixa apenas ela ativa, e as abas do quadro somem.
- 🆕 **Onboarding** — Nova jornada de **Acompanhamento**, para acompanhar o uso do cliente depois que o sistema entra no ar. Os indicadores (nº de vendas, faturamento, usuários ativos, o que a empresa quiser) são cadastrados em Configuração > Indicadores e lançados na jornada em qualquer data, com cartões mostrando o último valor e a variação, e a planilha com todo o histórico. Vem desativada — para usar, ative a jornada e marque a seção "Acompanhamento" nas etapas dela.
- ⬆️ **Onboarding** — Com o Acompanhamento ligado, o go-live registra a entrada no ar sem encerrar a jornada: ela segue viva até o acompanhamento terminar. Sem ele, nada muda — o go-live continua concluindo.
- 🔧 **Onboarding** — Uma jornada que teve o cartão arrastado direto para uma coluna de implantação ficava com o tempo daquela fase zerado para sempre. O tempo passa a ser reconstruído pelo histórico de etapas.

### 28/07

- 🔧 **Atendimento** — Quando uma cobrança automática era enviada no meio de uma conversa que já estava em atendimento, o chat sumia da tela do atendente: aparecia como encerrado, caía no filtro "Encerrados" e o botão Reabrir não resolvia — dava a mensagem de que tinha assumido, mas nada mudava. O cliente também não recebia a mensagem de encerramento nem a pesquisa de satisfação. Corrigido: a cobrança automática não muda mais o setor de um atendimento que já está em andamento.
- 🔧 **Telas em notebook** — As janelas de cadastro (nova jornada, ticket, contrato, produto, certificado, instância de WhatsApp e outras) não cabiam em tela de notebook 13" ou 14": ficavam cortadas em cima e embaixo, sem barra de rolagem, e só dava para usar reduzindo o zoom do navegador para 60%. Agora os campos ficam lado a lado em duas colunas e a janela cabe inteira. Nas telas realmente longas, o título e os botões de salvar ficam parados enquanto só o meio rola — o botão de confirmar não some mais.
- ⬆️ **Onboarding** — "Agendar treino" abria num balão preso ao botão, que empurrava os campos Título e Data/hora para fora da tela. Passou a abrir como janela, com todos os campos visíveis de uma vez.
- 🔧 **Cadastro de clientes** — Unidade base desativada continuava aparecendo na lista do cadastro de cliente e podia ser escolhida. Agora só as ativas são oferecidas. Se um cliente antigo já estiver em uma unidade desativada, ela continua aparecendo no cadastro dele, marcada como "(inativa)", para não perder a informação.
- ⬆️ **Filtro de unidades** — O filtro do topo passa a listar também as unidades desativadas, para consultar o histórico delas. Com uma delas selecionada, o filtro fica destacado em laranja avisando que os números na tela incluem unidade desativada.
- 🔧 **WhatsApp** — Ao responder uma mensagem do cliente, a citação aparecia no Doctor mas chegava sem referência no WhatsApp do cliente — a resposta parecia solta, sem indicar a que se referia. Acontecia só em parte das conversas. Corrigido: a citação agora chega marcada corretamente, inclusive quando a mensagem respondida é imagem, áudio ou documento.

### 27/07

- 🔧 **Atendimento** — Quando o prazo de encerramento por inatividade caía depois do fim do expediente, o atendimento ficava parado: o cliente não recebia o aviso, o chat não era encerrado e o atendimento atravessava a noite (ou o fim de semana) aberto. Agora o aviso e o encerramento são antecipados para o fim do expediente, com mensagem explicando o horário. Dá para desligar o comportamento em Configurações > WhatsApp > Atendimento.

### 26/07

- 🆕 **Dashboard de atendimento** — O indicador "Não Atendido" agora abre a lista de quem ficou sem resposta no período, agrupada por contato e mostrando quantas vezes cada um passou por isso. Dá para ler a conversa ali mesmo ou ir direto para o WhatsApp. Atendimentos que viraram ticket não entram na lista.
- 🆕 **Onboarding** — Transferência do responsável pela jornada, com motivo obrigatório e histórico de quem cuidou de cada período.
- 🆕 **Onboarding** — Os papéis dos participantes passam a ser cadastrados por empresa, em uma aba própria na configuração, no lugar da lista fixa.
- 🆕 **Onboarding** — Distribuição automática do responsável inicial da jornada, com aba de Distribuição para acompanhar o rodízio.
- 🆕 **Tickets** — Anexos do ticket podem ser excluídos, e o limite por arquivo subiu para 50 MB.
- ⬆️ **Onboarding** — O SLA passa a contar apenas o horário de expediente do setor: 1 dia útil = 8 horas, não 24. Uma "etapa gatilho" define onde o cronômetro começa, e a Data de Abertura aparece na jornada.
- ⬆️ **Onboarding** — Ao concluir o onboarding, a responsabilidade passa automaticamente ao implantador.
- ⬆️ **Onboarding** — É possível editar o papel de um participante (restrito a responsável, admin e head).
- ⬆️ **Onboarding** — A Timeline separa notas de movimentações e ganhou filtros.
- ⬆️ **Onboarding** — O cadastro do cliente abre em nova aba direto do detalhe da jornada.
- 🔧 **Plataforma** — Voltar ao DoctorSaaS depois de usar outra aba do navegador não recarrega mais a página nem fecha o que estava aberto.
- 🔧 **Chat** — O histórico de tickets abre a tela correta conforme o tipo do ticket.
- 🔧 **Chat** — Com uma imagem aberta em tela cheia, o ESC fecha apenas a imagem. Antes ele fechava a imagem e a conversa de uma vez, deixando a tela em branco.
- 🔧 **Tickets** — "Iniciar conversa" não acusa mais telefone inválido quando nenhum contato foi escolhido.
- 🔧 **Onboarding** — Transferir o responsável não duplica mais quem já estava na equipe da jornada.
- 🔧 **Clientes** — A importação com a opção "Atualizar" travava na confirmação das duplicatas e nunca concluía. Agora conclui, e ao atualizar um cliente que já existe você escolhe entre **complementar** (grava só as colunas preenchidas na planilha, preservando o resto do cadastro e os contratos) ou **sobrescrever tudo**.

### 24/07

- ⬆️ **Chat** — Fila e Fora do horário avisam quando o filtro de operador inativo está escondendo conversas.
- ⬆️ **Chat** — Controle de presença do operador centralizado, deixando o status online mais confiável.
- 🔧 **Dashboard** — O MRR de churn passa a vir do histórico de movimentos, corrigindo o valor exibido.
- 🔧 **Tickets** — Correções no modal de abertura de ticket, incluindo o envio do chamado de plantão.
- 🔧 **Omie** — As mensagens de erro retornadas pelo Omie voltam a ser exibidas corretamente.

### 23/07

- 🆕 **Plataforma** — Nova identidade visual da marca e nova tela de login.
- ⬆️ **Plataforma** — Menu lateral reorganizado, com Customer Success e Implantação no topo.
- ⬆️ **Clientes** — A consulta de CNPJ passa a trazer também o CNAE.
- 🔧 **Chat** — Os contadores das abas de conversa voltam a atualizar na hora certa.

### 22/07

- 🆕 **WhatsApp** — Cadastro de contatos: adicionar, editar, vincular a um cliente e filtrar a lista por cliente.
- ⬆️ **Chat** — Não lidos passam a aparecer também em Encerrados, com filtro de não lidos e botão para marcar todas como lidas.
- ⬆️ **Chat** — O setor responsável aparece no card da conversa.
- ⬆️ **Chat** — O visualizador de imagens ganhou botões de ação.
- 🔧 **Importação de clientes** — Telefones com DDI 55 deixam de ser gravados errados e datas no formato DD/MM/AAAA passam a ser aceitas.
- 🔧 **WhatsApp** — Correção no processamento de alguns tipos de mensagem recebidos.

### 21/07

- 🆕 **Chat** — Visualizador de imagens com zoom.
- 🆕 **Tickets** — A abertura de ticket identifica se o atendimento cai em horário comercial, plantão ou fora do expediente.
- ⬆️ **Onboarding** — Os grupos do checklist da etapa viraram blocos recolhíveis.
- ⬆️ **Onboarding** — Ao concluir a etapa de treinamento o sistema pergunta pelo agendamento; cancelar a etapa desfaz o agendamento.
- ⬆️ **Chat** — Contagem das abas de conversa revista e indicador visual mais limpo.

### 20/07

- 🆕 **Configurações** — Encerramento automático por inatividade ganhou controle para ligar e desligar.
- 🔧 **Diagnóstico** — A razão de MRR deixa de estourar quando o valor de entrada arredonda para R$ 0.

### 19/07

- 🆕 **Integração Hiper** — Nova integração com o Hiper, com aba de configuração e conexão próprias.
- 🆕 **Onboarding** — Checklist da etapa agrupado no estilo Trello, salvo por jornada e com item manual.
- 🆕 **Onboarding** — Visão de SLA no dashboard, com totais e abertura por pipeline, etapa e área.
- 🆕 **Onboarding** — Aba Timeline e tags de controle, com filtro por tag no kanban.
- ⬆️ **Onboarding** — Previsão de go-live calculada em dias úteis.
- ⬆️ **Clientes** — Os movimentos de MRR passam a ler direto da visão consolidada do banco.
- ⬆️ **Plataforma** — Menu Onboarding & Implantação reposicionado antes do Painel de Uso.
- 🔧 **Omie** — O card de histórico do Omie deixa de disparar em empresa sem Omie configurado.
- 🔧 **Clientes** — Busca por CNPJ e indicadores da lista de clientes corrigidos.

### 17/07

- 🆕 **WhatsApp** — Gestão de participantes de grupo pelo próprio chat: adicionar, remover e controlar se o grupo está ativo.
- 🆕 **Clientes** — Anexo de contrato na ficha do cliente, com pré-visualização de PDF, indicador de anexo e remoção.
- 🆕 **Omie** — Tela de Conferência reformulada: alarmes, fila de sincronização, vigência vencida, vínculo manual e reprocessamento.
- 🔧 **WhatsApp** — Envio de template da Meta corrigido no preenchimento dos parâmetros.
- 🔧 **Omie** — O envio de contrato ao Omie passa a rodar pelo servidor, corrigindo falhas do fluxo anterior.

### 16/07

- 🆕 **Chat** — O painel de detalhes da conversa mostra o tempo de inatividade.
- ⬆️ **Plataforma** — Menu lateral com submenus e atalho para recolher e expandir pelo logo.
- ⬆️ **Chat** — Links enviados nas mensagens ficam clicáveis.
- ⬆️ **Chat** — A menção "@todos" passa a marcar de fato os participantes do grupo.
- ⬆️ **Clientes** — Unidade base virou campo obrigatório no cadastro.
- 🔧 **Chat** — Fila e Fora do horário deixam de sumir por causa dos filtros da lista.
- 🔧 **Chat** — Filtro por instância corrigido.
- 🔧 **Chat** — Pré-visualização da última mensagem e seleção de texto corrigidas.
- 🔧 **Chat** — Sair do sistema passa a marcar o operador como offline.
- 🔧 **Omie** — Banner de saúde da Conferência e enfileiramento de contratos corrigidos.
