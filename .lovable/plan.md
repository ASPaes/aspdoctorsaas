

# Reorganizar Layout dos Campos - Dados Cadastrais

## Objetivo

Redistribuir os campos do formulario em grids de 3 e 4 colunas, similar a imagem de referencia, para melhor aproveitamento do espaco horizontal e leitura mais fluida.

## Layout proposto

```text
Linha 1 (3 cols):  Data Cadastro | Unidade Base | Modelo de Contrato
Linha 2 (2 cols):  Razão Social  | Nome Fantasia
Linha 3 (3 cols):  CNPJ | Email | Telefone Contato
Linha 4 (3 cols):  Telefone WhatsApp | Área de Atuação | Segmento
Linha 5 (full):    Observação do Cliente

--- Separator ---
Endereço
Linha 1 (3 cols):  CEP | Estado | Cidade
Linha 2 (3 cols):  Endereço | Número | Bairro

--- Separator ---
Contato Principal
Linha 1 (2 cols):  Nome do Contato | CPF do Contato
Linha 2 (2 cols):  Fone do Contato | Data de Aniversário
```

## Mudancas tecnicas

### `src/components/clientes/DadosClienteTab.tsx`

- Trocar o grid principal de `grid-cols-1 md:grid-cols-2` para `grid-cols-1 md:grid-cols-3`
- Linha 1: Data Cadastro, Unidade Base e Modelo de Contrato lado a lado (3 cols)
- Linha 2: Razao Social e Nome Fantasia ocupando `md:col-span-3` dividido em 2 (usar um sub-grid de 2 cols com `md:col-span-3` wrapper, ou fazer cada um `col-span-1` com Razao Social em `md:col-span-2` para dar mais espaco)
  - Melhor: Razao Social com `md:col-span-2` e Nome Fantasia com `md:col-span-1` (razao social tende a ser maior)
- Linha 3: CNPJ, Email, Telefone Contato (3 cols naturais)
- Linha 4: Telefone WhatsApp, Area Atuacao, Segmento (3 cols naturais)
- Observacao: `md:col-span-3` (full width)
- Secao Endereco: grid de 3 cols tambem
  - CEP, Estado, Cidade (linha 1)
  - Endereco (`md:col-span-1`), Numero, Bairro (linha 2) - ou Endereco com col-span-2 + Numero, depois Bairro na mesma linha... melhor: Endereco, Numero, Bairro em 3 cols
- Contato Principal: manter 2 cols (4 campos, 2 linhas)

### Arquivo unico modificado

| Arquivo | Mudanca |
|---|---|
| `src/components/clientes/DadosClienteTab.tsx` | Alterar grids para 3 colunas, reordenar campos, ajustar col-spans |

