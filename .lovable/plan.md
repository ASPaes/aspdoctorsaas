

# Formulario de Cliente com Abas

## Resumo
Criar o formulario completo de cadastro/edicao de cliente com 4 abas usando React Hook Form + Zod, selects dinamicos via Supabase, e espelho financeiro em tempo real.

## Estrutura de Arquivos

```text
src/
  pages/
    Clientes.tsx              -- listagem + botao "Novo Cliente"
    ClienteForm.tsx           -- pagina do formulario (nova rota /clientes/novo e /clientes/:id)
  components/
    clientes/
      DadosClienteTab.tsx     -- Aba 1: dados basicos
      VendaProdutoTab.tsx     -- Aba 2: venda e produto
      FinanceiroTab.tsx       -- Aba 3: financeiro + espelho
      CancelamentoTab.tsx     -- Aba 4: cancelamento
      EspelhoFinanceiro.tsx   -- cards com calculos em tempo real
  hooks/
    useEspelhoFinanceiro.ts   -- hook de calculos financeiros
    useLookups.ts             -- hook para carregar selects (segmentos, verticais, etc.)
```

## Rotas

Adicionar ao `App.tsx`:
- `/clientes/novo` -> `ClienteForm` (modo criacao)
- `/clientes/:id` -> `ClienteForm` (modo edicao, carrega dados existentes)

## Aba 1 - Dados do Cliente (`DadosClienteTab`)

Campos:
- Data Cadastro (date input)
- Razao Social (text)
- Nome Fantasia (text)
- CNPJ (text com mascara)
- Email (text)
- Telefone Contato (text)
- Telefone WhatsApp (text)
- Estado (select dinamico da tabela `estados`)
- Cidade (select dinamico da tabela `cidades`, filtrado pelo estado selecionado)
- Area de Atuacao (select da tabela `areas_atuacao`)
- Segmento (select da tabela `segmentos`)
- Vertical (select da tabela `verticais`)
- Observacao do Cliente (textarea)

## Aba 2 - Venda & Produto (`VendaProdutoTab`)

Campos:
- Data da Venda (date)
- Funcionario (select da tabela `funcionarios`, somente ativos)
- Origem da Venda (text)
- Recorrencia (select com opcoes: mensal, anual, semestral, semanal)
- Produto (select da tabela `produtos`)
- Observacao da Negociacao (textarea)

## Aba 3 - Financeiro (`FinanceiroTab`)

Campos de entrada:
- Valor Ativacao (numeric)
- Forma Pgto Ativacao (select da tabela `formas_pagamento`)
- Mensalidade / MRR (numeric)
- Forma Pgto Mensalidade (select da tabela `formas_pagamento`)
- Custo Operacao (numeric)
- Imposto % (numeric, pre-preenchido da tabela `configuracoes`)
- Custo Fixo % (numeric, pre-preenchido da tabela `configuracoes`)

Componente `EspelhoFinanceiro`:
- Exibe cards calculados em tempo real usando o hook `useEspelhoFinanceiro`
- Calculos (identicos a view `vw_clientes_financeiro`):
  - Valor Repasse = mensalidade - custo_operacao
  - Impostos R$ = mensalidade * imposto_percentual
  - Custos Fixos R$ = mensalidade * custo_fixo_percentual
  - Lucro Bruto = mensalidade - custo_operacao - impostos
  - Margem Bruta % = (lucro_bruto / mensalidade) * 100
  - Markup COGS % = ((mensalidade / custo_operacao) - 1) * 100
  - Fator Preco x = mensalidade / custo_operacao
  - Margem Contribuicao = lucro_bruto - custos_fixos
  - Lucro Real = margem_contribuicao

## Aba 4 - Cancelamento (`CancelamentoTab`)

- Aba visualmente desabilitada (cinza, nao clicavel) enquanto `cancelado = false`
- Quando ativada (toggle ou botao "Marcar como Cancelado"):
  - Data Cancelamento (date)
  - Motivo (select da tabela `motivos_cancelamento`)
  - Observacao Cancelamento (textarea)

## Hook `useLookups`

Carrega todos os selects de uma vez usando `useQuery` do TanStack:
- estados, cidades (filtradas por estado_id), areas_atuacao, segmentos, verticais, funcionarios (ativos), produtos, formas_pagamento, motivos_cancelamento, configuracoes

## Hook `useEspelhoFinanceiro`

Recebe `watch` values do form (mensalidade, custo_operacao, imposto_percentual, custo_fixo_percentual) e retorna os valores calculados em tempo real.

## Validacao Zod

Schema com campos opcionais (maioria nullable no banco), mas com validacoes basicas:
- CNPJ: formato valido se preenchido
- Email: formato valido se preenchido
- Valores numericos: >= 0 quando preenchidos
- Percentuais: entre 0 e 1

## Fluxo de Salvamento

- Ao salvar, faz `insert` (novo) ou `update` (edicao) na tabela `clientes`
- Ao criar, puxa `imposto_percentual` e `custo_fixo_percentual` da tabela `configuracoes` como defaults
- Apos salvar, redireciona para `/clientes` com toast de sucesso
- Botao "Voltar" retorna para listagem sem salvar

## Detalhes Tecnicos

- Nenhuma migracao de banco necessaria (schema ja existe)
- Usar `react-hook-form` com `zodResolver` para validacao
- Usar `useQuery` para carregar lookups e dados do cliente (edicao)
- Usar `useMutation` para insert/update
- Select de cidades filtra dinamicamente quando estado muda (via `watch('estado_id')`)
- Tema dark ja aplicado via CSS variables existentes

