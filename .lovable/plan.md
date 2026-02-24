

# Ajustes de Layout e UX no Formulario de Cliente

## 1. Mover "Modelo de Contrato" para o card Produto / Contrato

- Remover o campo `modelo_contrato_id` do `DadosClienteTab.tsx`
- Adicionar no `VendaProdutoTab.tsx`, dentro do subcard "Informacoes do Contrato"
- Remover prop `modelosContrato` de `DadosClienteTab` e passar para `VendaProdutoTab`
- Na linha 1 do DadosClienteTab, ficam apenas: Data Cadastro | Unidade Base (2 cols no grid de 3, ou ajustar)

## 2. Botao WhatsApp ao lado do campo Telefone WhatsApp

- No `DadosClienteTab.tsx`, envolver o input de `telefone_whatsapp` em um `div flex` com um botao de icone WhatsApp (usar icone de `MessageCircle` do lucide ou SVG do WhatsApp)
- Ao clicar, abrir `https://wa.me/{numero_limpo}` em nova aba (removendo formatacao do numero)

## 3. Reorganizar layout para ergonomia (adaptar col-spans por tamanho do dado)

### DadosClienteTab.tsx (grid de 3 colunas)

```text
Linha 1: Data Cadastro (1 col) | Unidade Base (1 col) | [vazio ou ajustar para 2 cols]
Linha 2: Razao Social (col-span-2) | Nome Fantasia (1 col)
Linha 3: CNPJ (1 col) | Email (col-span-2, emails tendem a ser longos)
Linha 4: Telefone Contato (1 col) | Telefone WhatsApp + botao (1 col) | Area Atuacao (1 col)
Linha 5: Segmento (1 col) | [pode ficar sozinho ou agrupar]
Linha 6: Observacao (col-span-3)
```

Ajuste: Com Modelo de Contrato removido, linha 1 fica Data Cadastro + Unidade Base. Para aproveitar, usar grid de 2 cols nessa linha ou deixar espaço.

Melhor proposta com grid-cols-4 para mais flexibilidade:

```text
Linha 1 (4 cols): Data Cadastro | Unidade Base | [vazio] | [vazio]
  -> Melhor manter grid-cols-3: Data Cadastro | Unidade Base | Segmento
Linha 2: Razao Social (col-span-2) | Nome Fantasia
Linha 3: CNPJ | Email (col-span-2)
Linha 4: Telefone Contato | Telefone WhatsApp [+btn] | Area Atuacao
Linha 5: Observacao (col-span-3)
```

### VendaProdutoTab.tsx - Informacoes do Contrato (grid de 3 cols)

```text
Linha 1: Data Venda | Origem Venda | Modelo de Contrato (NOVO aqui)
Linha 2: Recorrencia | Funcionario (Consultor) | [vazio]
```

### VendaProdutoTab.tsx - Informacoes do Produto (grid de 3 cols)

```text
Linha 1: Data Ativacao | Fornecedor | Codigo Fornecedor
Linha 2: Link Portal Fornecedor (col-span-2) | Produto
```

### FinanceiroTab.tsx - Valores (grid de 4 cols para 4 campos por linha)

```text
Linha 1: Valor Ativacao | Forma Pgto Ativacao | Mensalidade/MRR | Forma Pgto Mensalidade
Linha 2: Custo Operacao | Imposto % | Custo Fixo % | [vazio]
```

Usar `grid-cols-1 md:grid-cols-4` para encaixar os 4 campos de pagamento na mesma linha.

### Endereco (manter grid-cols-3, ja esta bom)

### Contato Principal (manter grid-cols-2, ja esta bom)

---

## Arquivos modificados

| Arquivo | Mudanca |
|---|---|
| `src/components/clientes/DadosClienteTab.tsx` | Remover modelo_contrato; adicionar botao WhatsApp; reordenar campos (Email col-span-2, Segmento sobe) |
| `src/components/clientes/VendaProdutoTab.tsx` | Adicionar prop + campo modelo_contrato_id; grids de 3 cols |
| `src/components/clientes/FinanceiroTab.tsx` | Grid de 4 cols para valores (4 campos por linha) |
| `src/pages/ClienteForm.tsx` | Mover prop modelosContrato de DadosClienteTab para VendaProdutoTab |

## Detalhes tecnicos

- Botao WhatsApp: `onClick={() => window.open(\`https://wa.me/55\${digits}\`, "_blank")}` onde digits = telefone sem formatacao
- Icone: usar `MessageCircle` do lucide-react (nao existe icone WhatsApp nativo no lucide, mas MessageCircle comunica bem, alternativa e um SVG inline)
- Nenhuma alteracao de schema ou banco de dados necessaria
- Ordem dos campos mantida conforme solicitado

