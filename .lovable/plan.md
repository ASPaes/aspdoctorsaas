

## Diagnóstico: Clientes vazios para usuário regular (cs@aspsoftwares.com.br)

### Análise realizada

Verifiquei em profundidade:
- **RLS**: Política `clientes_tenant_rw` está correta — usa `current_tenant_id()` (SECURITY DEFINER) + `is_super_admin()`
- **Dados**: Há **655 clientes ativos** e 158 cancelados para o tenant `a0000000-...0001` (ASP)
- **View**: `vw_clientes_financeiro` tem `security_invoker=on` correto
- **Profile do usuário**: `is_super_admin: false`, `status: ativo`, `tenant_id` correto
- **Código**: Para não-super-admins, `effectiveTenantId` é `null` e o `tf` helper é um no-op — RLS deveria retornar os dados normalmente

### Causa provável

O problema mais provável é **contaminação de sessão**: quando o super admin loga, seleciona um tenant no filtro global, e depois o usuário `cs@` loga no mesmo navegador/aba, o `sessionStorage` mantém o valor `super-admin-tenant-filter`. Embora o código atual não use esse valor para não-super-admins no `effectiveTenantId`, o **cache do React Query pode estar servindo dados obsoletos** da sessão anterior (staleTime de 5 min, e o `queryClient` não é limpo no logout).

### Plano de correção

**1. Limpar sessionStorage do filtro de tenant no logout**
Em `AuthContext.tsx`, no `signOut`, remover a chave `super-admin-tenant-filter` do sessionStorage e limpar o cache do queryClient.

**2. Limpar o cache do React Query no logout**
Importar e chamar `queryClient.clear()` ao fazer signOut para garantir que nenhum dado da sessão anterior persista.

**3. Guard defensivo no TenantFilterContext**
Para não-super-admins, forçar a remoção da chave do sessionStorage na inicialização, evitando qualquer possível interferência.

**4. Verificar se o código mais recente está no preview**
As alterações feitas nas mensagens anteriores (adição do `tf` em `Clientes.tsx`) precisam estar deployadas no preview para funcionar.

### Arquivos a modificar

- `src/contexts/AuthContext.tsx` — limpar sessionStorage e queryClient no signOut
- `src/contexts/TenantFilterContext.tsx` — guard defensivo para não-super-admins

