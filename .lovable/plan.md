

# Modulo de Certificados Digitais A1

## Visao Geral

Replicar o modulo de certificados digitais do projeto [Sistema ASP Softwares](/projects/58135b32-0c2e-43bd-baad-b9aab6717679), adaptado para a arquitetura do DoctorSaaS. O modulo consiste em:

1. **Campos de certificado no cadastro do cliente** (seção no formulario de edição)
2. **Tabela de historico de vendas de certificados** (por cliente)
3. **Pagina dedicada de gestao de certificados** (lista geral com filtros e KPIs)
4. **Importacao em massa via CSV** (opcional, fase 2)

## Adaptacoes em relacao ao projeto original

O projeto original usa `profiles` (auth users) como vendedores. O DoctorSaaS usa a tabela `funcionarios` para isso. Todas as referencias a `profiles/user_id` serao adaptadas para `funcionarios/id`.

O projeto original tem `id_cliente` (inteiro sequencial) e `cliente_codigo`. O DoctorSaaS usa `id` (UUID) e `codigo_fornecedor` na tabela clientes.

## Fase 1 - Estrutura de Dados

### Migration 1: Adicionar campos na tabela `clientes`

```sql
ALTER TABLE clientes
  ADD COLUMN cert_a1_vencimento date,
  ADD COLUMN cert_a1_ultima_venda_em date,
  ADD COLUMN cert_a1_ultimo_vendedor_id bigint;
```

### Migration 2: Criar tabela `certificado_a1_vendas`

```sql
CREATE TABLE certificado_a1_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  data_venda date NOT NULL,
  valor_venda numeric,
  vendedor_id bigint REFERENCES funcionarios(id),
  observacao text,
  status text NOT NULL DEFAULT 'ganho' CHECK (status IN ('ganho', 'perdido_terceiro')),
  data_base_renovacao date,
  motivo_perda text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

RLS: mesma politica das demais tabelas (autenticados leem/escrevem tudo).

### Migration 3: Trigger para atualizar campos do cliente automaticamente

Ao inserir uma venda, um trigger atualiza automaticamente:
- `cert_a1_vencimento` = data_venda + 12 meses (ou data_base_renovacao + 12 meses se perdido_terceiro)
- `cert_a1_ultima_venda_em` = data_venda
- `cert_a1_ultimo_vendedor_id` = vendedor_id

### Migration 4: Atualizar a view `vw_clientes_financeiro`

Adicionar os 3 novos campos (`cert_a1_vencimento`, `cert_a1_ultima_venda_em`, `cert_a1_ultimo_vendedor_id`) na view para que fiquem disponiveis na listagem geral.

## Fase 2 - Secao no Formulario do Cliente

### Arquivo: `src/components/clientes/CertificadoA1Section.tsx` (novo)

Componente Card integrado ao formulario de edição do cliente (`ClienteForm.tsx`), contendo:

- **Vencimento**: campo date editavel manualmente
- **Status**: badge colorido (Vencido / Vence em breve / Valido / Sem certificado)
  - Vencido (vermelho): data passada
  - Vence em breve (ambar): ate 30 dias
  - Valido (verde): mais de 30 dias
  - Sem certificado (cinza): sem data
- **Ultima Venda**: data + nome do vendedor (funcionario)
- **Botao "Registrar Venda"**: abre modal
- **Historico de Vendas**: tabela com as ultimas 5 vendas (data, valor, vendedor, observacao)

### Modal de Registro de Venda

Dois modos via checkbox "Ja renovado com terceiro":

**Modo Venda Normal:**
- Data da Venda (date)
- Valor R$ (input)
- Vendedor (select de funcionarios ativos)
- Observacao (textarea)

**Modo Perdido para Terceiro:**
- Data base da renovacao (date)
- Registrado por (select de funcionarios)
- Motivo / Observacao (textarea)
- Nao conta como venda, apenas atualiza o vencimento

Ambos exibem preview do novo vencimento (data + 12 meses).

### Arquivo: `src/pages/ClienteForm.tsx` (modificar)

- Adicionar campos `cert_a1_vencimento`, `cert_a1_ultima_venda_em`, `cert_a1_ultimo_vendedor_id` ao schema e form
- Inserir o componente `CertificadoA1Section` como novo Card apos "Produto / Contrato" e antes de "Cancelamento"

## Fase 3 - Pagina de Gestao de Certificados

### Arquivo: `src/pages/CertificadosA1.tsx` (novo)

Pagina dedicada acessivel via sidebar, contendo:

**KPIs (5 cards):**
- Total de clientes (filtrados)
- Vencidos (vermelho)
- Vencendo em ate 30 dias (ambar)
- Ativos / validos (verde)
- Sem data de vencimento

**Filtros Rapidos (botoes):**
- Todos
- Janela de Renovacao (-20 a +30 dias)
- Vence em 30 dias
- Vencido ate 20 dias
- Personalizado

**Filtros Detalhados:**
- Busca textual (razao social, fantasia, CNPJ, codigo fornecedor)
- Status (todos / vencido / vencendo / ativo / sem data)
- Periodo de vencimento (de/ate)

**Tabela com colunas ordenáveis:**
- Razao Social / Fantasia
- Codigo Fornecedor
- Telefone
- Vencimento (formatado dd/MM/yyyy)
- Status (badge colorido)
- Ultima Venda (data)
- Acoes: Editar Vencimento + Registrar Venda

**Modais:**
- Editar Vencimento (input date simples)
- Registrar Venda (mesmo modal da secao do cliente)

### Arquivo: `src/App.tsx` (modificar)

- Adicionar rota `/certificados-a1` apontando para `CertificadosA1`

### Arquivo: `src/components/AppSidebar.tsx` (modificar)

- Adicionar item "Certificados A1" no menu com icone `ShieldCheck`

## Fase 4 (Futura) - Importacao em Massa

### Tabela staging + funcoes RPC

- Tabela `staging_certificados_a1_import` para upload temporario de CSV
- Funcao `validate_cert_a1_import` para validacao (match por codigo_fornecedor)
- Funcao `apply_cert_a1_import` para aplicar atualizacoes em massa
- Componente `CertA1ImportModal` com fluxo: Upload CSV -> Validacao -> Preview -> Aplicar

Esta fase pode ser implementada separadamente apos as fases 1-3 estarem funcionando.

## Resumo de Arquivos

| Arquivo | Acao |
|---------|------|
| Migration SQL (4 scripts) | Criar campos, tabela, trigger, atualizar view |
| `src/components/clientes/CertificadoA1Section.tsx` | Criar (novo) |
| `src/pages/CertificadosA1.tsx` | Criar (novo) |
| `src/pages/ClienteForm.tsx` | Modificar (adicionar campos + secao) |
| `src/App.tsx` | Modificar (nova rota) |
| `src/components/AppSidebar.tsx` | Modificar (novo item menu) |

## Dependencias

Todas ja instaladas: `date-fns`, `lucide-react`, `@tanstack/react-query`, componentes shadcn/ui (Card, Dialog, Table, Badge, Select, Input, Checkbox, Textarea, Separator, Skeleton).

