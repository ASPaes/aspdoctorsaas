# Atualizações do DoctorSaaS

Registro do que foi **publicado em produção**, escrito em linguagem de cliente.
Serve de base para montar o comunicado mensal de novidades.

**Tipos:** 🆕 Novidade · ⬆️ Melhoria · 🔧 Correção

**Como manter:** a cada publicação, acrescente a entrada no dia correspondente, no topo.
Só entra o que o usuário percebe — refatoração, teste, migration e ajuste interno ficam no histórico do Git.

---

## Julho / 2026

### 26/07

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
