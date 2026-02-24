

# Modulo Movimento MRR

## Objetivo
Replicar o modulo de Movimentos MRR do projeto "Sistema ASP Softwares", adaptado para este projeto. Permite registrar upsell, cross-sell, downsell e vendas avulsas por cliente, com rastreio do funcionario que registrou (para futuro controle de comissoes). O campo "Origem" sera um texto livre, igual ao campo `origem_venda` ja existente na tabela `clientes`.

---

## Etapa 1 - Migration SQL

### Enum
```text
CREATE TYPE movimento_mrr_tipo AS ENUM ('upsell', 'cross_sell', 'downsell', 'venda_avulsa');
```

### Tabela `movimentos_mrr`

| Coluna | Tipo | Default | Observacao |
|---|---|---|---|
| id | uuid PK | gen_random_uuid() | |
| cliente_id | uuid NOT NULL | | FK clientes(id) |
| tipo | movimento_mrr_tipo NOT NULL | | |
| data_movimento | date NOT NULL | | |
| valor_delta | numeric NOT NULL | 0 | Delta no MRR (positivo p/ up/cross, negativo p/ down, 0 p/ avulsa) |
| custo_delta | numeric NOT NULL | 0 | Delta no custo operacional |
| valor_venda_avulsa | numeric | null | Valor pontual (so para tipo venda_avulsa) |
| origem_venda | text | null | Texto livre (mesma logica do campo origem_venda em clientes) |
| descricao | text | null | |
| funcionario_id | bigint | null | **NOVO** - FK funcionarios(id) - quem registrou (comissoes) |
| status | text NOT NULL | 'ativo' | 'ativo' ou 'inativo' |
| estorno_de | uuid | null | FK movimentos_mrr(id) - se este e um estorno |
| estornado_por | uuid | null | FK movimentos_mrr(id) - se foi estornado |
| inativado_em | timestamptz | null | |
| inativado_por_id | bigint | null | FK funcionarios(id) - quem inativou |
| criado_em | timestamptz | now() | |

### RLS e Indices
- RLS habilitado com politica permissiva para usuarios autenticados (mesmo padrao do projeto)
- Indice em `cliente_id` para performance das queries por cliente

### Diferencas do projeto fonte
- `criado_por` (uuid auth) e `criado_por_email` (text) **removidos** - substituidos por `funcionario_id` (bigint FK funcionarios)
- `inativado_por` (uuid auth) **trocado** por `inativado_por_id` (bigint FK funcionarios)
- Sem trigger de validacao de MRR negativo (simplificacao - validacao no frontend)

---

## Etapa 2 - Componente `MovimentosMrrModal.tsx`

### Arquivo: `src/components/clientes/MovimentosMrrModal.tsx`

Replicar do projeto fonte com as seguintes adaptacoes:

**Adaptacoes de dados:**
- Remover `useAuth()` para identificar usuario - substituir por um Select de funcionario no formulario
- Trocar `criado_por: user?.id` e `criado_por_email: user?.email` por `funcionario_id: selectedFuncionarioId`
- Trocar `inativado_por: user?.id` por `inativado_por_id: selectedFuncionarioId`
- Receber `funcionarios` como prop (lista de funcionarios ativos)
- O campo "Funcionario" sera obrigatorio no formulario de novo movimento

**Campo Origem:**
- Manter como Input de texto livre (identico ao projeto fonte e ao campo `origem_venda` em clientes)

**UI (mantida do fonte):**
- Dialog modal com summary cards (MRR Base, Upsell, Cross-sell, Downsell, V. Avulsas, MRR Atual)
- Card de composicao MRR + Custo
- Formulario inline para novo movimento
- Tabela de movimentos com badges de tipo/status
- Botao de inativar com AlertDialog de confirmacao
- Coluna extra na tabela mostrando o nome do funcionario que registrou

**Props:**
```text
open: boolean
onOpenChange: (open: boolean) => void
clienteId: string
clienteNome: string
mensalidadeBase: number
custoBase: number
funcionarios: { id: number; nome: string }[]
```

---

## Etapa 3 - Integracao no ClienteForm

### Arquivo: `src/pages/ClienteForm.tsx`

- Adicionar botao "Movimentos MRR" no Card de Produto/Contrato (proximo ao campo Mensalidade), visivel apenas quando `isEditing`
- O botao abre o `MovimentosMrrModal` passando:
  - `clienteId` = `id` (do useParams)
  - `clienteNome` = `razao_social || nome_fantasia`
  - `mensalidadeBase` = valor do campo `mensalidade` do form
  - `custoBase` = valor do campo `custo_operacao` do form
  - `funcionarios` = `lookups.funcionarios.data`
- Adicionar state `mrrModalOpen` para controlar abertura/fechamento

---

## Resumo de Arquivos

| Tipo | Arquivo |
|---|---|
| Migration SQL | 1 migration: enum + tabela movimentos_mrr + RLS + indice |
| Novo componente | `src/components/clientes/MovimentosMrrModal.tsx` |
| Modificado | `src/pages/ClienteForm.tsx` (botao + modal) |

---

## Fluxo do usuario

```text
ClienteForm (editando)
  -> Card Produto/Contrato
    -> Botao "Movimentos MRR"
      -> Modal abre
        -> Ve resumo (MRR Base + movimentos = MRR Atual)
        -> Clica "Adicionar Movimento"
          -> Seleciona tipo (upsell/cross/down/avulsa)
          -> Seleciona funcionario (obrigatorio - para comissoes)
          -> Preenche valor, custo, origem, descricao
          -> Salva
        -> Pode inativar movimentos existentes
```

