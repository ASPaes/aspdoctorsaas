

## Objetivo
Adicionar máscaras de formatação para CNPJ e Telefone no modal "Nova Conversa" do WhatsApp, e padronizar todos os telefones armazenados no banco de dados para incluir o código do Brasil (+55).

## Mudanças no Código

### 1. Adicionar máscara no NewConversationModal
**Arquivo**: `src/components/whatsapp/conversations/NewConversationModal.tsx`

- Importar funções de máscara `maskCNPJ` e `maskPhone` de `@/lib/masks`
- Aplicar `maskPhone` nos inputs de telefone (linhas 177, 189)
- Aplicar `maskCNPJ` na exibição do CNPJ na lista de clientes (linha 142)
- Ao salvar telefone, sempre adicionar prefixo "55" se não existir (antes de enviar ao backend)

### 2. Atualizar função maskPhone para incluir código do país
**Arquivo**: `src/lib/masks.ts`

- Criar nova função `maskPhoneBR(value: string)` que adiciona "+55" automaticamente
- Mantém formatação `+55 (XX) XXXXX-XXXX`
- Limite de 15 caracteres totais (+55 + 11 dígitos)

### 3. Normalização de telefones no backend (migração de dados)
**Escopo**: Atualizar registros existentes na tabela `clientes`

- SQL migration para adicionar "55" em todos os `telefone_whatsapp` e `telefone_contato` que não começam com "55"
- Aplicar apenas em números com 10-11 dígitos (formato BR)
- Preservar números que já têm código de país

### 4. Validação de telefone no useClienteLinkSuggestion
**Arquivo**: `src/components/whatsapp/hooks/useClienteLinkSuggestion.ts`

- Atualizar normalização para considerar "55" padrão (linhas 64-70)
- Comparar sempre removendo "55" antes de fazer match

### 5. Validação de telefone no useClienteSearch
**Arquivo**: `src/components/whatsapp/hooks/useClienteSearch.ts`

- Normalizar termo de busca para adicionar "55" se número BR (10-11 dígitos sem código)

## Impacto em Segurança
- Nenhuma mudança em RLS
- Apenas formatação visual e padronização de dados

## Documentação a Atualizar
- `specs/technical/CODEBASE_GUIDE.md` - padrão de telefone com +55

## Testes Manuais
1. Abrir modal "Nova Conversa", digitar número no campo telefone → verificar máscara aplicada
2. Buscar cliente por CNPJ → verificar CNPJ formatado na lista
3. Salvar nova conversa com número sem "55" → verificar que salva com "55"
4. Verificar registros antigos no DB → confirmar que todos têm "55"

