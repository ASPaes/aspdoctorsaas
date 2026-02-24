

# AuthContext - Estado Global de Autenticacao

## Objetivo
Criar um contexto de autenticacao centralizado para eliminar chamadas diretas ao `supabase.auth` espalhadas pelo app, evitar "flash" de login no refresh e preparar o terreno para o modulo CS que precisa de `useAuth()`.

## Arquivos a Criar

### `src/contexts/AuthContext.tsx`
- `AuthProvider` com estado: `user`, `session`, `isLoading`
- No mount: `getSession()` primeiro, depois `onAuthStateChange()` (nessa ordem, conforme best practice Supabase)
- Expor via hook `useAuth()`: `user`, `session`, `isLoading`, `signInWithPassword(email, password)`, `signOut()`
- Cleanup da subscription no unmount

## Arquivos a Modificar

### `src/main.tsx`
- Envolver `<App />` com `<AuthProvider>` (acima do Router para estar disponivel em toda a arvore)

### `src/App.tsx`
- Mover `<AuthProvider>` para dentro do `<BrowserRouter>` (alternativa) ou manter em `main.tsx` fora do Router
- Como `signOut` no contexto nao precisa de `navigate`, o provider pode ficar em `main.tsx`

### `src/components/AuthGuard.tsx`
- Substituir toda a logica local de `useState` + `useEffect` + `supabase.auth` por `useAuth()`
- Se `isLoading` -> loader
- Se `!user` -> redirect `/login`
- Codigo resultante fica com ~15 linhas

### `src/pages/Login.tsx`
- Substituir `supabase.auth.signInWithPassword` por `useAuth().signInWithPassword`
- Remover import do `supabase`

### `src/components/AppSidebar.tsx`
- Substituir `supabase.auth.signOut()` por `useAuth().signOut()`
- Remover import do `supabase`

### Arquivos NAO alterados (por ora)
- `Signup.tsx`, `ForgotPassword.tsx`, `ResetPassword.tsx` - sao paginas publicas que usam chamadas one-shot ao Supabase Auth. Podem continuar usando `supabase` diretamente sem problema, pois nao dependem do estado de sessao.

## Fluxo Resultante

```text
main.tsx
  AuthProvider          <- getSession + onAuthStateChange
    App
      BrowserRouter
        Routes
          /login        <- useAuth().signInWithPassword
          AuthGuard     <- useAuth().user / isLoading
            AppLayout
              Sidebar   <- useAuth().signOut
              Outlet
```

## Criterios Atendidos
- Refresh mantem sessao sem piscar para login (session recuperada antes de renderizar)
- Rotas protegidas usam estado centralizado via `useAuth()`
- Nenhum componente referencia `AuthContext` inexistente
- Zero dependencia de Lovable Cloud auth
