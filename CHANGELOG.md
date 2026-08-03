# Atualizações do DoctorSaaS

Registro do que foi **publicado em produção**, escrito em linguagem de cliente.
Serve de base para montar o comunicado mensal de novidades.

**Tipos:** 🆕 Novidade · ⬆️ Melhoria · 🔧 Correção

**Como manter:** a cada publicação, acrescente a entrada no dia correspondente, no topo.
Só entra o que o usuário percebe — refatoração, teste, migration e ajuste interno ficam no histórico do Git.

---

## Agosto / 2026

### 02/08

- 🆕 **Onboarding / Dashboard** — Nova faixa **Situação agora** no topo, com **jornadas em aberto, concluídas e canceladas**. O card de em aberto abre a composição (*22 em andamento · 15 não iniciadas*) e o de canceladas mostra a fatia sobre o total. Esses três números são a foto de hoje e **não mudam** com o filtro de período — está escrito na tela.
- 🔧 **Onboarding / Dashboard** — **Jornada cancelada saiu de todos os indicadores.** Ela entrava em tudo — prazos, treinamentos, tempo parado e retornos ao vendedor — como se ainda estivesse rodando. Numa das empresas, o card de **Retornos ao vendedor** mostrava 1 retorno e **ele era de uma jornada cancelada**: o card inteiro media ruído. Duas das três paradas registradas e 11 dos 26 treinamentos também vinham de jornadas canceladas.
- 🔧 **Onboarding / Dashboard** — A **taxa de no-show** somava quatro coisas diferentes e marcava 33%: uma sessão que **foi realizada** na 3ª tentativa, uma que ainda vai acontecer, uma cancelada e uma que de fato terminou em falta. Uma vez marcada a falta, a marca nunca saía — mesmo depois de o treinamento acontecer. Agora a taxa conta só quem **terminou** em falta, e quem faltou e depois compareceu aparece à parte, em *N sessões faltaram ao menos 1x*.
- 🔧 **Onboarding / Dashboard** — **Proprietário presente** acusava 22% em vermelho contra a meta de 90%. O campo estava **em branco em 24 dos 26** treinamentos, e o que não foi preenchido era contado como ausência. Agora o percentual sai só dos treinamentos **informados** e o card mostra quantos foram preenchidos, para a leitura ficar honesta.
- 🔧 **Onboarding / Dashboard** — **Total PDV finalizados** mostrava zero. Não era resultado: nenhum tipo de treinamento estava marcado como PDV no cadastro, nem o próprio *Treinamento PDV*, com 19 sessões. O card passa a dizer isso, com link para a configuração.
- ⬆️ **Onboarding / Dashboard** — O **filtro de período** passa a valer para os prazos. Ele já filtrava treinamentos, paradas e retornos, mas as quatro visões de **SLA** ignoravam a data e mostravam sempre o histórico inteiro. O recorte é por **jornada viva no período**: a que foi aberta antes e ainda está rodando continua aparecendo, porque o prazo dela está correndo agora — só sai da conta quem já tinha sido concluído antes do período começar. **Treinamento cancelado** também deixa de contar nos percentuais e ganha coluna própria na tabela por tipo, para o número não sumir sem rastro.
- ⬆️ **Onboarding** — Os **anexos da jornada** ganharam título, busca e autoria. Ao anexar, cada arquivo já vem com um título sugerido — o nome do arquivo — que dá para trocar por algo que descreva o conteúdo (*Contrato assinado*, *Print do erro na NF-e*); o arquivo em si nunca é renomeado. Um campo de busca acha o anexo por título, nome do arquivo ou extensão: digitar `pdf` filtra os PDFs. Cada anexo passa a mostrar **quem anexou e quando**, e a Timeline registra a entrada e a exclusão de cada arquivo — antes um anexo excluído sumia sem deixar rastro. Anexos antigos aparecem marcados como *sem título* e podem ser nomeados pelo lápis.
- ⬆️ **Onboarding** — Os **atendimentos vinculados** à jornada agora abrem. Clicando na linha do atendimento aparece a conversa inteira do WhatsApp daquele período — com áudios, imagens e anexos —, do mesmo jeito que já funcionava nos tickets de suporte. Antes o cartão só mostrava o código e o status, e para ler o que foi conversado era preciso caçar o atendimento na tela do WhatsApp. O status também deixa de aparecer em inglês.
- 🔧 **Dashboard / Crescimento** — O **Churn** do Breakdown Net New MRR discordava do MRR perdido da aba Cancelamentos. Quem levava reajuste ou upsell no mês e cancelava nesse mesmo mês entrava na conta pelo valor de **antes do aumento** — e o aumento que chegou a ser cobrado desaparecia das entradas. Agora o cancelamento vale o que o cliente pagava **no dia em que saiu**, e o reajuste/upsell aparece onde deveria. As duas abas passam a mostrar o mesmo número. O Net New e o MRR do período não mudam — só a repartição entre as linhas.
- 🔧 **Dashboard / Cancelamentos** — Cliente que já tinha cancelado, voltou e cancelou de novo aparecia valendo **o dobro** na lista de cancelados do mês. A conta somava todos os cancelamentos da história do cliente e nunca abatia a reativação: um cliente de R$ 226,20 entrava em julho com R$ 452,40. Agora só entra o que saiu **dentro do período** — e quem cancela dois contratos no mesmo mês continua somando os dois, como sempre foi. Junto se acertam o card **MRR Perdido (bruto)**, o **Early Churn** e o gráfico de **churn dos 12 meses**.
- ⬆️ **Dashboard / Visão Geral** — O controle do gráfico de **Evolução do MRR** passa a ser **Nº de clientes**. O número escrito sobre cada ponto agora é a **base ativa daquele mês** — o mesmo conjunto de clientes que forma o MRR do ponto —, e não mais quantos clientes entraram no mês. Com isso dá para ler o ticket médio de qualquer linha dividindo o valor pela quantidade. Ao passar o mouse, a quantidade aparece ao lado do valor.

### 01/08

- 🆕 **Onboarding** — Nova **Régua da jornada**, no botão do cartão. Ela desenha a implantação inteira numa linha só — do começo ao go-live, passando por todas as fases — com o **planejado em cima e o que aconteceu de verdade embaixo**, cada etapa com a largura do tempo que levou. A etapa que estourou o prazo aparece vermelha e larga: dá para ver **onde** a jornada travou, não só que o total ficou acima. Etapa por onde o cartão passou mais de uma vez aparece uma vez só, marcada com ×2.
- 🆕 **Onboarding / Configuração** — Agora dá para definir **em qual etapa o prazo termina de contar**, e não só onde começa. Serve para quando a última etapa do quadro é fechamento interno e não faz mais parte do compromisso com o cliente: as etapas seguintes continuam existindo e com alerta próprio, mas ficam marcadas como **fora da contagem** e param de somar no prazo. Se o cartão for movido para trás por engano, o relógio volta a correr sozinho.
- ⬆️ **Onboarding / Configuração** — O **prazo total do quadro** deixa de ser digitado à mão e passa a ser a **soma das etapas**, sempre. Antes o número exibido e a soma das próprias etapas discordavam em todos os quadros cadastrados. Uma faixa no topo mostra a conta aberta — *Onboarding 4d 6h + Implantação 3d* — e avisa quando o plano não cabe no prazo prometido no tipo de demanda.
- 🔧 **Onboarding** — O **go-live previsto** passa a ser calculado pelas etapas configuradas, e não mais por um prazo solto no tipo de demanda que estava vazio em 7 dos 8 tipos — jornadas desses tipos nasciam sem data nenhuma. Agora todas nascem com previsão.
- 🔧 **Onboarding** — O prazo podia começar a contar sozinho na virada de fase, mesmo sem o cartão ter passado pela etapa de partida. E o tempo da última etapa antes da virada não era registrado em horário útil, deixando buracos no histórico. Os dois corrigidos.
- 🔧 **Clientes / Cancelamento** — Cancelar o **último contrato** do cliente passa a cancelar tudo junto. Upsell, cross-sell e outros movimentos lançados soltos ficavam ativos depois da saída: o cancelamento só considerava o valor do contrato, e o cliente continuava carregando esses valores. Num caso real, o cliente valia R$ 279,65 e o cancelamento registrou R$ 219,65 — os R$ 60,00 de um ponto adicional sumiram do total. Agora o cancelamento leva os produtos, os módulos e os movimentos, e o valor registrado é o que o cliente valia inteiro na véspera. **Reativar o contrato devolve tudo**, pelo mesmo critério. Os cancelamentos antigos foram corrigidos.
- 🔧 **Clientes / Cancelamento** — O **Histórico de Eventos** da ficha mostrava o valor do contrato no lugar do total cancelado. Passa a exibir **Total cancelado**, com o valor do contrato ao lado quando forem diferentes.
- 🔧 **Dashboard** — Cliente cancelado deixa de valer **menos que zero**. A baixa era feita em dois lugares ao mesmo tempo e descontava duas vezes, o que jogava o cliente para negativo e contaminava o **ticket médio de vendas**: quem foi vendido no período e cancelou depois entrava na conta puxando o número para baixo. Também aparecia o contrário — clientes ativos com valor inflado por reativações antigas, ou zerados por engano.
- ⬆️ **Clientes** — A ficha do cliente cancelado ganha **tarja de Cancelado** e os cards de MRR e do Espelho Financeiro ficam em cinza. Os valores continuam todos visíveis para histórico e auditoria, mas sem o verde de lucro e a seta de alta, que davam a impressão de cliente ativo.
- 🆕 **Dashboard / Visão Geral** — O gráfico de **Evolução do MRR** ganha dois controles. **Nº de vendas** escreve, em cada mês, quantos clientes entraram — na linha do total e na de cada unidade, cada uma na sua cor; o número também aparece ao passar o mouse, ao lado do valor. **Sem reajuste** refaz a curva descontando os aumentos de preço aplicados sobre a base, e responde quanto a operação cresceu vendendo, não reajustando.
- ⬆️ **Dashboard / Visão Geral** — A **Evolução · 12 meses** sobe na página e passa a vir logo depois dos indicadores do topo, antes de *Eficiência & saúde*. Os gráficos de MRR e de Faturamento, que dividiam a linha, agora ocupam a largura inteira cada um.
- ⬆️ **Dashboard / Visão Geral** — O gráfico de faturamento passa a se chamar **Faturamento — recorrente + ativação** e o passar do mouse abre a conta: quanto é mensalidade e quanto é ativação, com o número de vendas do mês. O mês em curso parecia uma queda de dezenas de milhares logo no dia 1º — era só a ativação ainda zerada, e agora isso fica explícito.
- ⬆️ **Dashboard / Vendas** — A **Evolução de vendas · 12 meses** passa a vir antes do *Explorador*, e o passar do mouse sobre a barra mostra a **quantidade de vendas** do mês junto do New MRR e do ticket médio.
- 🆕 **Onboarding** — Informação errada no cadastro da jornada deixa de ser definitiva. O **administrador** ganha o botão **Editar** no cartão e corrige **cliente, assunto, tipo de demanda, início planejado e go-live previsto** mesmo com a implantação já em andamento — antes esses campos ficavam travados na criação e o erro do vendedor acompanhava o cliente até o fim. A alteração exige **motivo**, fica registrada na **linha do tempo** da jornada com o valor antigo e o novo, e mexer nas datas **não reinicia** o prazo que já está correndo. O **produto** continua fixo, porque é ele que define o quadro de etapas: para trocá-lo, cancele a jornada e abra outra. Jornada já concluída ou cancelada não é editável.
- ⬆️ **Onboarding / Implantação** — A coluna dos treinamentos finalizados deixa de repetir o mesmo cliente. Em vez de um cartão para cada treinamento encerrado, aparece **um cartão por ticket**, no mesmo formato da visão **Agrupar**: mostra quantos treinamentos já foram concluídos do total — *2 de 4* — e a lista dos que ainda faltam, com data e responsável. Encerrar mais um treinamento só atualiza o contador do cartão. Para devolver um treinamento à etapa anterior, arraste a linha dele de dentro do cartão.
- 🔧 **Dashboard / MRR** — O MRR passa a ser **o mesmo número em todas as abas**. A correção da semana passada tinha chegado só na aba Crescimento: para abril fechado, a Visão Geral mostrava R$ 340.467 e a Crescimento R$ 388.008, na mesma empresa e com o mesmo filtro. A diferença vinha de usar a receita de hoje em datas passadas — quando um cliente cancela um produto, ele encolhia o valor de todos os meses anteriores. Agora Visão Geral, Cancelamentos, Vendas, Distribuição e Cohort medem igual, e junto com o MRR se acertam ticket médio, ARR, concentração dos 10 maiores, MRR por unidade e por vendedor, o gráfico de 12 meses e as vendas de cada mês.
- 🔧 **Dashboard / Distribuição** — O **MRR perdido por cancelamento** aparecia zerado. Cliente que cancelava tudo passava a valer R$ 0, e era esse valor que o mapa e a lista de churn exibiam: dos 239 cancelamentos de 2026 de uma das empresas, 231 apareciam como R$ 0 — R$ 2,5 mil no lugar de R$ 98,7 mil. Agora cada cancelamento vale o que o cliente valia na véspera de sair.
- 🔧 **Dashboard / Cohort** — A **retenção de receita** dava sempre 100%. Como o cliente cancelado valia R$ 0, ele entrava zerado também na receita inicial do grupo e o indicador nunca se movia. Agora cada mês do cohort é medido com o valor daquele mês.
- ⬆️ **Dashboard** — Rule of 40, LTV/CAC, CAC Payback, ARPA e margem de contribuição passam a usar a mesma régua do MRR. A margem também considerava só o custo dos produtos ativos hoje, o que distorcia os meses anteriores.
- 🆕 **Onboarding / Acompanhamento** — Terminou a implantação, o cliente entra em **acompanhamento sozinho**. Em *Configuração → Tipos de treino*, cada tipo ganha a chave **Acompanhamento**: quando um treinamento desse tipo é concluído e a implantação encerra, abre automaticamente um **ticket de acompanhamento** do cliente, na primeira coluna da jornada de Acompanhamento. É um ticket novo e limpo — traz só o cliente e de qual implantação veio — feito para registrar os números de uso: faturamento, quantidade de vendas ou qualquer indicador que a empresa tenha cadastrado. Cada cliente tem **um** acompanhamento aberto por vez, e quem quiser acompanhar um cliente antigo abre na mão pelo botão **Novo acompanhamento**, no próprio quadro.
- 🆕 **Onboarding / Acompanhamento** — Os lançamentos de indicadores deixam de depender de uma implantação em andamento. Antes eles só existiam dentro da jornada, que encerra no go-live — ou seja, era impossível registrar o uso justamente depois que o cliente entrou no ar, que é quando isso importa. Arrastar o cartão até a última coluna **encerra** o acompanhamento; ele continua no quadro como histórico e volta a ficar aberto se for arrastado de volta.
- ⬆️ **Atendimento / Tickets** — A fila de tickets para de misturar **implantação com suporte**. Cartões de jornada, sub-tickets de treinamento e acompanhamentos apareciam no meio da lista de atendimento e entravam nos contadores da página. Eles continuam existindo, no módulo de Implantação, onde são trabalhados.

---

## Julho / 2026

### 31/07

- 🔧 **Onboarding / Implantação** — Dar **go-live** fazia o cartão sumir do quadro: o treinamento estava concluído, o cliente entregue, e a tela simplesmente esquecia o ticket. O quadro ganha a coluna **Implantação concluída** no fim, igual à **Onboarding concluído**: assim que o go-live sai, o ticket inteiro vai para lá, com a data e quantos treinamentos teve. A coluna **Concluído** volta a significar só o que sempre significou — treinamento encerrado enquanto os outros do mesmo cliente ainda andam. A coluna mostra os **últimos 30 dias**; para ver mais atrás, basta **pesquisar pelo cliente ou pelo código do ticket**.
- 🔧 **Onboarding / Implantação** — O **go-live só sai com todos os treinamentos encerrados**. A regra já existia, mas deixava de valer justamente nas empresas que ativaram a jornada de **Acompanhamento** — ali dava para registrar go-live com treinamento ainda em aberto. Agora bloqueia em qualquer situação, inclusive para administrador, e a mensagem diz **quais** sub-tickets faltam encerrar.
- 🆕 **Onboarding / Acompanhamento** — Ativar a jornada de **Acompanhamento** passa a montar o quadro sozinho, com quatro colunas prontas: **Primeiras semanas → Uso em ritmo → Sinal de risco → Cliente destravado**. Antes a jornada era ativada e o quadro nascia vazio — sem nenhuma etapa configurada à mão, nenhum cliente conseguia sequer chegar nela. As colunas são cadastro normal: renomeie, reordene ou apague à vontade, que o sistema não desfaz o que você mudou.
- 🔧 **WhatsApp** — A mensagem de fora do horário escrita na configuração não estava sendo usada: quem tem IA ativa recebia sempre um texto gerado na hora, e o que a empresa escreveu à mão — plantão, horário de sábado, telefone alternativo — nunca chegava ao cliente. Editar e salvar não mudava nada, porque o campo estava sendo ignorado. Agora o texto configurado é o que sai. Se a pessoa insistir fora do horário, os dois primeiros avisos saem no texto da empresa e, a partir do terceiro, a IA reescreve para não repetir a mesma mensagem.
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
