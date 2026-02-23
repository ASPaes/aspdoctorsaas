
# Reestruturar Formulario de Cliente: Layout em Secoes (sem abas)

## Objetivo
Substituir o layout atual em **abas (Tabs)** por um layout em **secoes verticais com cards**, conforme a imagem de referencia. Todas as secoes ficarao visiveis na mesma pagina com scroll.

## Estrutura Visual (baseada na imagem)

### 1. Header do formulario
- Botao voltar (seta) + titulo "Novo Cliente" / "Editar Cliente"
- Subtitulo "Preencha os dados do cliente e contrato"

### 2. Card: Dados Cadastrais
- Icone de predio + titulo "Dados Cadastrais"
- Grid responsivo com os campos: Data Cadastro, Razao Social, Nome Fantasia, CNPJ, Email, Telefone Contato, Telefone WhatsApp, Estado, Cidade, Area de Atuacao, Segmento, Vertical
- Observacoes do Cliente (textarea, largura total)

### 3. Card: Produto / Contrato
- Icone + titulo "Produto / Contrato"
- Grid com: Data da Venda, Origem da Venda, Recorrencia, Produto, Funcionario (Consultor)
- Campos financeiros inline: Valor Ativacao (R$), Mensalidade (R$), Custo (R$)
- Secao "Campos Financeiros (calculados automaticamente)" com os campos do espelho financeiro (Repasse, Margem, Lucro Bruto, Markup, Imposto %, Imposto R$, Lucro Real) - campos somente leitura com descricoes abaixo
- Observacoes da Negociacao (textarea, largura total)

### 4. Card: Cancelamento
- Icone X + titulo "Cancelamento" + subtitulo "Ative para registrar o cancelamento do cliente"
- Switch "Registrar cancelamento" alinhado a direita no header do card
- Quando ativado, exibe campos: Data Cancelamento, Motivo, Observacao

### 5. Botoes de acao
- "Cancelar" (outline) e "Salvar Cliente" (primario) alinhados a direita

---

## Detalhes Tecnicos

### Arquivo `src/pages/ClienteForm.tsx`
- Remover import de `Tabs, TabsList, TabsTrigger, TabsContent`
- Remover o wrapper `<Tabs>` e substituir por secoes verticais com `<Card>` separados
- Renderizar todos os componentes (DadosClienteTab, VendaProdutoTab/FinanceiroTab combinados, CancelamentoTab) em sequencia vertical
- Os componentes de secao permanecem como estao, apenas o container muda

### Componentes de secao
- `DadosClienteTab` - mantido como esta, envolvido em Card com header "Dados Cadastrais" com icone `Building2`
- `VendaProdutoTab` + `FinanceiroTab` - combinados em um unico Card "Produto / Contrato" com icone `FileText`, mostrando campos de venda seguidos dos campos financeiros e espelho
- `CancelamentoTab` - envolvido em Card com header "Cancelamento" com icone `XCircle`, Switch no header

### Mudancas no layout do Card Cancelamento
- O Switch "Registrar cancelamento" sera movido para o header do card (ao lado do titulo), em vez de dentro do conteudo
- Layout mais compacto conforme a referencia

### Botoes
- Texto "Voltar" muda para "Cancelar"
- Texto "Salvar" muda para "Salvar Cliente"
- Remover icone Save do botao
