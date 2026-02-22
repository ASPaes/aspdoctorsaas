

# Doctor SaaS — MVP Setup Plan

## 🎨 Identidade Visual
- **Logo** DoctorSaaS exibida na sidebar (topo) e nas telas de autenticação
- **Dark mode** como padrão: fundo escuro (#1a1a1a / tons escuros) em todo o app
- **Cor primária** (botões, seleções, links ativos): verde da marca (~#2D6A4F / #40916C extraído da logo)
- **Sidebar** com fundo verde escuro (#1B4332), ícones e texto claros
- **Cards e superfícies** em tons de cinza escuro, bordas sutis

## 1. Autenticação
- Página de **Login** com email/senha + botão "Entrar com Google"
- Página de **Cadastro** com email/senha
- Página de **Esqueci minha senha** + página `/reset-password`
- Logo DoctorSaaS centralizada nas telas de auth
- Botões em verde da marca
- Instruções fornecidas para configurar Google OAuth no painel Supabase

## 2. Proteção de Rotas (AuthGuard)
- Componente `AuthGuard` com listener `onAuthStateChange`
- Redireciona para `/login` se não autenticado
- Loading spinner enquanto verifica sessão

## 3. Layout com Sidebar (Verde Escuro)
- Sidebar com fundo verde escuro, logo no topo
- Itens de navegação:
  - 👥 **Clientes** (`/clientes`)
  - 📋 **Cadastros** (`/cadastros`)
  - ⚙️ **Configurações** (`/configuracoes`)
- Destaque visual na rota ativa (fundo verde mais claro)
- Sidebar colapsável com ícones visíveis no modo mini
- Botão de **Logout** na parte inferior
- Header com trigger para abrir/fechar sidebar

## 4. Estrutura de Rotas
| Rota | Tipo | Descrição |
|------|------|-----------|
| `/login` | Pública | Login email/senha + Google |
| `/signup` | Pública | Cadastro |
| `/reset-password` | Pública | Redefinição de senha |
| `/clientes` | Protegida | Página placeholder |
| `/cadastros` | Protegida | Página placeholder |
| `/configuracoes` | Protegida | Página placeholder |
| `/` | — | Redireciona para `/clientes` |

## 5. Configuração Técnica
- Supabase client já existente no projeto (externo)
- Tema dark aplicado via CSS variables no `index.css`
- Sem criação de tabelas no banco nesta etapa
- Páginas internas serão placeholders prontos para funcionalidades futuras

