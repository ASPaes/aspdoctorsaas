

## Plano: Exclusão de duplicata, proteção contra double-submit e badge "Possível duplicidade"

### 1. Excluir o registro duplicado

Apenas uma duplicata encontrada: cliente 449 (COSTELACO), registro `e0b2257b` (o segundo, criado 38s depois). Será excluído via DELETE.

### 2. Proteção contra double-submit no modal de venda

**`src/components/clientes/CertA1VendaModal.tsx`**
- O botão "Registrar" já tem `disabled={mutation.isPending}`, mas o `mutate()` pode ser chamado novamente antes do state atualizar. Trocar para usar um ref `isSubmitting` que é setado imediatamente no `onClick`, antes do `mutate()`.

### 3. Badge "Possível duplicidade" na tabela detalhada do Dashboard

**`src/components/certificados/CertA1Dashboard.tsx`**
- No `queryFn`, buscar também o campo `created_at` de cada venda.
- No mapeamento de `vendasDetalhe`, incluir `clienteId` e `createdAt`.
- Após montar a lista, marcar registros como `possivelDuplicidade = true` quando existir outro registro do **mesmo cliente**, **mesma data_venda**, **mesmo status** e diferença de `created_at` menor que 5 minutos.
- Na tabela, exibir um badge amarelo "Possível duplicidade" ao lado do status quando flagrado.

### 4. Botão de excluir venda (admin only)

**`src/components/certificados/CertA1Dashboard.tsx`**
- Adicionar coluna "Ações" na tabela detalhada.
- Botão de lixeira (Trash2 icon) visível apenas para usuários com `role === 'admin'` (obtido via `useAuth()`).
- Ao clicar, abrir um `AlertDialog` de confirmação.
- Ao confirmar, executar `supabase.from('certificado_a1_vendas').delete().eq('id', vendaId)` e invalidar queries.

**`src/components/clientes/CertificadoA1Section.tsx`**
- Mesma lógica: adicionar coluna de ações com botão de excluir no histórico de vendas do cliente, também restrito a admin.

### 5. Badge de duplicidade também no histórico do cliente

**`src/components/clientes/CertificadoA1Section.tsx`**
- Aplicar a mesma lógica de detecção de duplicidade (mesmo cliente, mesma data, created_at < 5 min de diferença) e exibir badge amarelo.

---

### Resumo de arquivos alterados
- **DELETE** no banco: registro `e0b2257b`
- `src/components/clientes/CertA1VendaModal.tsx` — proteção double-submit
- `src/components/certificados/CertA1Dashboard.tsx` — badge duplicidade + botão excluir (admin)
- `src/components/clientes/CertificadoA1Section.tsx` — badge duplicidade + botão excluir (admin)

