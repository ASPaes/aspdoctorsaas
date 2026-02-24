

# Plano: Reorganizar Campos + Consulta CNPJ + Correcoes

## Resumo das mudancas

1. **Mover Segmento para ao lado de Area de Atuacao** -- Segmento sai da linha 1 e vai para a linha 4 (junto com Area de Atuacao)
2. **Colocar CNPJ na posicao do Segmento (linha 1)** -- Linha 1 fica: Data Cadastro | Unidade Base | CNPJ (com consulta automatica)
3. **Consulta CNPJ via BrasilAPI** -- Ao digitar 14 digitos de CNPJ, consultar `https://brasilapi.com.br/api/cnpj/v1/{cnpj}` e preencher automaticamente: razao_social, nome_fantasia, email, telefone_contato, cep (que dispara auto-fill de endereco), endereco, numero, bairro, estado, cidade
4. **Corrigir dado errado no campo codigo_fornecedor** -- O cliente `3f4abc08` tem o valor `88502-160` (um CEP) gravado no campo `codigo_fornecedor`. Sera corrigido via migration SQL
5. **Nao alterar ordem dos campos** -- Apenas tamanhos podem ser ajustados

## Layout final do DadosClienteTab

```text
Linha 1 (3 cols): Data Cadastro | Unidade Base | CNPJ (com loader de consulta)
Linha 2 (3 cols): Razao Social (col-span-2) | Nome Fantasia
Linha 3 (3 cols): Email (col-span-2) | Telefone Contato
Linha 4 (3 cols): Telefone WhatsApp [+btn] | Area de Atuacao | Segmento
Linha 5 (full):   Observacao do Cliente

--- Separator ---
Endereco (sem mudancas)
--- Separator ---
Contato Principal (sem mudancas)
```

## Detalhes tecnicos

### 1. Migration SQL -- Corrigir dado errado

```sql
UPDATE clientes 
SET codigo_fornecedor = NULL 
WHERE id = '3f4abc08-2dc1-4481-a3b0-a011a9816162' 
  AND codigo_fornecedor = '88502-160';
```

### 2. `src/components/clientes/DadosClienteTab.tsx`

- Adicionar estado `cnpjLoading` para indicar consulta em andamento
- Criar funcao `handleCnpjChange(maskedValue)`:
  - Aplica mascara CNPJ
  - Quando tiver 14 digitos, chama `https://brasilapi.com.br/api/cnpj/v1/{digits}`
  - Preenche campos: `razao_social`, `nome_fantasia`, `email`, `telefone_contato`, `cep` (e dispara `handleCepChange` para auto-fill do endereco), `endereco`, `numero`, `bairro`
  - Busca estado pela UF retornada e cidade pelo nome retornado
- Reorganizar grid:
  - Linha 1: Data Cadastro | Unidade Base | CNPJ (movido da linha 3 para ca)
  - Linha 2: Razao Social (col-span-2) | Nome Fantasia (sem mudanca)
  - Linha 3: Email (col-span-2) | Telefone Contato (CNPJ saiu daqui)
  - Linha 4: Telefone WhatsApp [+btn] | Area de Atuacao | Segmento (movido da linha 1 para ca)
  - Linha 5: Observacao (full width, sem mudanca)

### 3. API BrasilAPI -- Campos retornados

A BrasilAPI (`https://brasilapi.com.br/api/cnpj/v1/{cnpj}`) retorna:
- `razao_social` -> campo razao_social
- `nome_fantasia` -> campo nome_fantasia  
- `email` -> campo email
- `ddd_telefone_1` -> campo telefone_contato (formatar com mascara)
- `cep` -> campo cep (dispara handleCepChange para auto-fill completo)
- `logradouro` -> campo endereco
- `numero` -> campo numero
- `bairro` -> campo bairro
- `uf` -> buscar estado_id
- `municipio` -> buscar cidade_id

E uma API publica, gratuita, com CORS habilitado -- pode ser chamada diretamente do frontend.

### 4. Verificacao de outros campos

Alem do `codigo_fornecedor`, verifiquei:
- Todos os mapeamentos de campos no `form.reset()` estao corretos
- Os campos de endereco (cep, endereco, numero, bairro) estao mapeados corretamente
- Nenhum outro campo apresenta cruzamento de dados

## Arquivos modificados

| Arquivo | Mudanca |
|---|---|
| Migration SQL | Corrigir codigo_fornecedor com valor de CEP |
| `src/components/clientes/DadosClienteTab.tsx` | Mover CNPJ para linha 1, Segmento para linha 4 (ao lado de Area Atuacao); adicionar consulta CNPJ via BrasilAPI; adicionar loader no CNPJ |

