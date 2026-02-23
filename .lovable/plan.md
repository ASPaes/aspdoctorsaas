

# Reestruturar Card Produto/Contrato com Novos Campos e Espelho Financeiro Moderno

## 1. Migracoes de Banco de Dados

Adicionar 4 novas colunas na tabela `clientes`:

- `data_ativacao` (date, nullable) - Data de ativacao do produto
- `fornecedor_id` (bigint, nullable) - Referencia ao fornecedor
- `codigo_fornecedor` (text, nullable) - Codigo recebido do fornecedor
- `link_portal_fornecedor` (text, nullable) - Link do portal do fornecedor para este cliente

## 2. Alteracoes no Schema do Formulario

**Arquivo: `src/pages/ClienteForm.tsx`**

- Adicionar ao `clienteSchema` (zod): `data_ativacao`, `fornecedor_id`, `codigo_fornecedor`, `link_portal_fornecedor` (todos nullable)
- Adicionar defaultValues correspondentes (null)
- Atualizar o `form.reset()` no carregamento do cliente existente
- Atualizar o payload de submit
- Passar `fornecedores` do lookup para o componente VendaProdutoTab

## 3. Lookup de Fornecedores

**Arquivo: `src/hooks/useLookups.ts`**

- Adicionar query para buscar `fornecedores` (id, nome, site) da tabela existente
- Expor no retorno do hook

## 4. Reestruturar o Card Produto/Contrato em SubCards

**Arquivo: `src/components/clientes/VendaProdutoTab.tsx`**

Substituir o layout atual por 3 SubCards visuais (usando div com bordas/titulos):

### SubCard "Informacoes do Contrato"
- Data Venda
- Origem da Venda
- Recorrencia
- Funcionario (Consultor)

### SubCard "Informacoes do Produto"
- Data Ativacao (novo campo date)
- Fornecedor (select, da tabela fornecedores)
- Codigo Fornecedor (input texto)
- Link Fornecedor (input texto + icone clicavel ExternalLink ao lado)
- Produto (select)

### SubCard "Observacoes"
- Observacao da Negociacao (textarea, largura total)

Remover recorrencia duplicada (estava no pedido do usuario em "Informacoes do Produto" mas ja aparece em "Contrato").

**Arquivo: `src/components/clientes/FinanceiroTab.tsx`**

Reestruturar como SubCard "Valores":
- Valor Ativacao + Forma Pgto Ativacao (mesma linha)
- Mensalidade/MRR + Forma Pgto Mensalidade (mesma linha)
- Custo Operacao
- Imposto % - **com mascara percentual**: exibir como `8,00` (usuario digita percentual), salvar como `0.08` no banco. Usar NumericInput com conversao *100 para display e /100 para armazenamento
- Custo Fixo % - mesma logica: exibir `35,00`, salvar `0.35`

## 5. Mascara Percentual nos Campos Imposto e Custo Fixo

Atualmente os campos salvam decimais (0.08, 0.35) mas o NumericInput exibe como esta. Precisamos:

- No carregamento do form (reset e config defaults): multiplicar por 100 os valores vindos do banco
- No submit (mutationFn): dividir por 100 antes de enviar ao banco
- Atualizar schema zod: imposto_percentual e custo_fixo_percentual com max(100) em vez de max(1)
- Adicionar suffix "%" no NumericInput desses campos
- Atualizar o `useEspelhoFinanceiro` para receber os valores ja como percentuais (dividir por 100 internamente no calculo)

## 6. Espelho Financeiro Moderno

**Arquivo: `src/components/clientes/EspelhoFinanceiro.tsx`**

Redesenhar com layout moderno:
- Titulo "Espelho Financeiro" com icone
- Cards com cores condicionais: valores positivos em verde (bg-green-50/text-green-700 no claro, equivalente no escuro), negativos em vermelho (bg-red-50/text-red-700)
- Layout em grid responsivo 2x3 ou 3x3
- Cada metrica com icone pequeno, label descritivo, e valor grande
- Separacao visual entre metricas de custo e metricas de lucro
- Indicadores visuais: setas para cima (positivo) e para baixo (negativo)

Metricas exibidas:
- Valor Repasse (R$)
- Impostos (R$)
- Custos Fixos (R$)
- Lucro Bruto (R$)
- Margem Bruta (%)
- Markup COGS (%)
- Fator Preco (x)
- Margem Contribuicao (R$)
- Lucro Real (R$) - destaque maior

## Detalhes Tecnicos

### Migracao SQL

```text
ALTER TABLE clientes ADD COLUMN data_ativacao date;
ALTER TABLE clientes ADD COLUMN fornecedor_id bigint;
ALTER TABLE clientes ADD COLUMN codigo_fornecedor text;
ALTER TABLE clientes ADD COLUMN link_portal_fornecedor text;
```

### Arquivos modificados
- `src/pages/ClienteForm.tsx` - schema, defaults, reset, submit (conversao %), props
- `src/hooks/useLookups.ts` - adicionar query fornecedores
- `src/components/clientes/VendaProdutoTab.tsx` - reestruturar com 3 subcards, novos campos
- `src/components/clientes/FinanceiroTab.tsx` - reestruturar como SubCard "Valores", mascara %
- `src/components/clientes/EspelhoFinanceiro.tsx` - redesign visual moderno com cores
- `src/hooks/useEspelhoFinanceiro.ts` - ajustar para receber % como valor inteiro (ex: 8) e dividir internamente

### Fluxo da Conversao Percentual
1. Banco: `0.08` -> Form carrega: `8.00` (x100)
2. Usuario digita: `8,00` com suffix `%`
3. Submit: `8.00` -> Banco: `0.08` (/100)
4. Espelho: recebe `8.00`, divide por 100 internamente para calcular

