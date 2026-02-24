

# Correcoes e Melhorias no Cadastro de Cliente

## Resumo

Corrigir 3 bugs (mascaras de CNPJ/telefone e decimais nos valores), mostrar o card de Certificado A1 tambem na criacao de cliente, adicionar 4 novos campos de contato principal e criar tabela auxiliar de contatos adicionais com modal inline.

---

## 1. Mascaras de CNPJ e Telefone

### Novo arquivo: `src/lib/masks.ts`

Funcoes utilitarias reutilizaveis:

- **maskCNPJ(value)**: remove nao-digitos, aplica formato `XX.XXX.XXX/XXXX-XX`, limita a 14 digitos
- **maskPhone(value)**: remove nao-digitos, aplica `(XX) XXXXX-XXXX` (11 digitos) ou `(XX) XXXX-XXXX` (10 digitos)
- **maskCPF(value)**: remove nao-digitos, aplica formato `XXX.XXX.XXX-XX`, limita a 11 digitos

### Modificar: `src/components/clientes/DadosClienteTab.tsx`

- Campo **CNPJ**: aplicar `maskCNPJ` no `onChange` antes de chamar `field.onChange`
- Campo **Telefone Contato**: aplicar `maskPhone` no `onChange`
- Campo **Telefone WhatsApp**: aplicar `maskPhone` no `onChange`
- Novos campos de contato (CPF e Fone) tambem usarao as mascaras correspondentes

Os valores sao armazenados com mascara (texto) no banco.

---

## 2. Correcao do NumericInput (decimais)

### Modificar: `src/components/ui/numeric-input.tsx`

**Problema**: o `useEffect` que sincroniza o `displayValue` dispara sempre que `value` muda. Quando o usuario digita "735,", o `onChange` envia `735`, o effect reformata para "735,00" e o cursor pula.

**Solucao**: adicionar um ref `isFocused`. Quando `isFocused === true`, o `useEffect` nao reformata o displayValue. Apenas no `onBlur` (quando `isFocused` volta a `false`) o valor e reformatado com as casas decimais completas.

```text
Logica:
- onFocus: isFocused.current = true
- onChange: atualiza displayValue e chama onChange normalmente (sem reformatacao)
- onBlur: isFocused.current = false, reformata displayValue
- useEffect: so sincroniza se !isFocused.current (mudancas externas)
```

---

## 3. Certificado A1 visivel na criacao

### Modificar: `src/pages/ClienteForm.tsx`

- Remover a condicao `{isEditing && ...}` do CertificadoA1Section
- Passar `clienteId` como `id ?? undefined`

### Modificar: `src/components/clientes/CertificadoA1Section.tsx`

- Tornar `clienteId` opcional (`string | undefined`)
- Quando `clienteId` esta ausente:
  - Exibir campo de vencimento editavel e badge de status normalmente
  - Ocultar botao "Registrar Venda", historico de vendas e info de ultima venda
  - Exibir mensagem sutil: "Salve o cliente para registrar vendas de certificado"

---

## 4. Novos campos de contato principal

### Migration SQL

Adicionar 4 colunas na tabela `clientes`:

```sql
ALTER TABLE clientes
  ADD COLUMN contato_nome text,
  ADD COLUMN contato_cpf text,
  ADD COLUMN contato_fone text,
  ADD COLUMN contato_aniversario date;
```

### Modificar: `src/pages/ClienteForm.tsx`

- Adicionar os 4 campos ao schema Zod (todos `z.string().nullable()` exceto `contato_aniversario` que e `z.string().nullable()` tambem, armazenado como date string)
- Adicionar aos defaultValues e ao `form.reset` no carregamento do cliente

### Modificar: `src/components/clientes/DadosClienteTab.tsx`

Adicionar os 4 campos no grid, agrupados visualmente com um sub-titulo "Contato Principal":

- **Nome do Contato** (text input)
- **CPF do Contato** (text input com mascara `XXX.XXX.XXX-XX`)
- **Fone do Contato** (text input com mascara de telefone)
- **Data de Aniversario** (input date)

Ao lado do sub-titulo "Contato Principal", exibir um botao pequeno (icone `Users`) que abre o modal de contatos adicionais.

---

## 5. Tabela auxiliar de contatos adicionais

### Migration SQL

```sql
CREATE TABLE cliente_contatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cpf text,
  fone text,
  email text,
  cargo text,
  aniversario date,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cliente_contatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_cliente_contatos ON cliente_contatos
  FOR SELECT USING (true);

CREATE POLICY auth_write_cliente_contatos ON cliente_contatos
  FOR ALL USING (true) WITH CHECK (true);
```

### Novo arquivo: `src/components/clientes/ContatosAdicionaisModal.tsx`

Dialog/modal que recebe `clienteId` (obrigatorio - so aparece quando o cliente ja foi salvo):

- Lista de contatos do cliente em uma tabela compacta (nome, fone, email, cargo)
- Botao "+ Adicionar Contato" abre formulario inline (campos: nome, cpf com mascara, fone com mascara, email, cargo, aniversario, observacao)
- Botao de excluir em cada linha
- Usa TanStack Query para fetch e mutations com Supabase

### Integracao no DadosClienteTab

- Botao ao lado do sub-titulo "Contato Principal" com icone `Users` e texto "Contatos Adicionais"
- Quando `clienteId` esta ausente (novo cliente): botao desabilitado com tooltip "Salve o cliente primeiro"
- Quando `clienteId` existe: abre o modal `ContatosAdicionaisModal`

---

## Resumo de arquivos

| Arquivo | Acao |
|---------|------|
| Migration SQL | Adicionar 4 colunas em clientes + criar tabela `cliente_contatos` |
| `src/lib/masks.ts` | Criar (novo) |
| `src/components/ui/numeric-input.tsx` | Corrigir sincronizacao durante digitacao |
| `src/pages/ClienteForm.tsx` | Adicionar campos contato ao schema, mostrar CertA1 sempre |
| `src/components/clientes/DadosClienteTab.tsx` | Mascaras CNPJ/telefone, novos campos contato, botao contatos adicionais |
| `src/components/clientes/CertificadoA1Section.tsx` | clienteId opcional |
| `src/components/clientes/ContatosAdicionaisModal.tsx` | Criar (novo) |

