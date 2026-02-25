

# Plano: ID Sequencial + Controle Matriz/Filial

## Resumo

Adicionar um ID sequencial visivel na tela e um campo de vinculo matriz/filial que busca clientes pelo `codigo_fornecedor` e armazena o `id` (UUID) da matriz.

## 1. Migration SQL -- Duas novas colunas na tabela `clientes`

```sql
-- ID sequencial auto-incremento, visivel na tela
ALTER TABLE clientes ADD COLUMN codigo_sequencial serial;

-- Referencia a matriz (self-referencing FK)
ALTER TABLE clientes ADD COLUMN matriz_id uuid REFERENCES clientes(id);
```

O `codigo_sequencial` sera gerado automaticamente para novos registros. Para registros existentes, sera preenchido com valores sequenciais automaticamente pelo tipo `serial`.

## 2. Alteracoes no schema do formulario (`ClienteForm.tsx`)

- Adicionar `matriz_id: z.string().nullable()` ao `clienteSchema`
- Adicionar `matriz_id: null` nos `defaultValues`
- Mapear no `form.reset()`: `matriz_id: c.matriz_id ?? null`
- Carregar `codigo_sequencial` do cliente (query existente ja traz `select("*")`)
- Exibir `codigo_sequencial` como campo read-only no header ou no card

## 3. Alteracoes no layout (`DadosClienteTab.tsx`)

### Campo "Codigo Sequencial" (read-only)
- Exibido na **Linha 1**, que passara a ter 4 colunas: `Cod. Seq. | Data Cadastro | Unidade Base | CNPJ`
- Campo somente leitura, com fundo cinza, mostrando o numero sequencial
- Em clientes novos (antes de salvar), mostra "Auto" ou fica vazio

### Campo "Matriz" (busca por codigo_fornecedor)
- Posicionado na **Linha 2**, antes da Razao Social: `Matriz | Razao Social (col-span-2)`
- Grid de 3 colunas mantido
- Funcionamento:
  - Input de texto onde o usuario digita o `codigo_fornecedor` da matriz
  - Ao digitar (com debounce), busca na tabela `clientes` por `codigo_fornecedor` igual ao valor digitado
  - Ao encontrar, exibe o nome da matriz abaixo do campo (ou como tooltip/badge) e armazena o `id` no campo `matriz_id`
  - Se nao encontrar, exibe mensagem "Nenhum cliente com este codigo"
  - Botao "X" para limpar o vinculo

### Layout final

```text
Linha 1 (4 cols): Cod.Seq (read-only) | Data Cadastro | Unidade Base | CNPJ
Linha 2 (3 cols): Matriz (busca por cod.fornecedor) | Razao Social (col-span-2)
Linha 3 (3 cols): Nome Fantasia | Email (col-span-2) -- ajuste para manter 3 cols
Linha 4 (3 cols): Telefone Contato | Telefone WhatsApp [+btn] | Area Atuacao
Linha 5 (3 cols): Segmento | Observacao (col-span-2)
```

**Nota**: A ordem dos campos existentes sera mantida, apenas o grid sera reorganizado para acomodar os 2 novos campos. Se preferir manter o layout exatamente como esta e apenas adicionar os campos em linhas novas, posso ajustar.

## 4. Props adicionais no DadosClienteTab

- `codigoSequencial?: number | null` -- recebido do `ClienteForm` para exibicao
- O campo `matriz_id` ja esta no form, entao a busca e feita diretamente no componente

## 5. Logica de busca da matriz

```typescript
// Dentro de DadosClienteTab
const handleMatrizSearch = async (codigoFornecedor: string) => {
  if (!codigoFornecedor.trim()) {
    form.setValue("matriz_id", null);
    setMatrizNome(null);
    return;
  }
  const { data } = await supabase
    .from("clientes")
    .select("id, razao_social, nome_fantasia")
    .eq("codigo_fornecedor", codigoFornecedor.trim())
    .limit(1)
    .single();
  if (data) {
    form.setValue("matriz_id", data.id);
    setMatrizNome(data.razao_social || data.nome_fantasia || "");
  } else {
    form.setValue("matriz_id", null);
    setMatrizNome(null);
  }
};
```

Ao carregar um cliente existente com `matriz_id` preenchido, faz-se uma query reversa para buscar o `codigo_fornecedor` da matriz e exibir no campo.

## Arquivos modificados

| Arquivo | Mudanca |
|---|---|
| Migration SQL | `ADD COLUMN codigo_sequencial serial` + `ADD COLUMN matriz_id uuid REFERENCES clientes(id)` |
| `src/pages/ClienteForm.tsx` | Adicionar `matriz_id` no schema/defaults/reset; passar `codigoSequencial` ao DadosClienteTab |
| `src/components/clientes/DadosClienteTab.tsx` | Adicionar campos Cod.Seq (read-only) e Matriz (busca); reorganizar grid |

