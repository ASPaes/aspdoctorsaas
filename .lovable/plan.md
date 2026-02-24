

# Substituir Vermelho por Verde em Todo o Sistema

## Resumo

Trocar todas as ocorrencias de vermelho (incluindo as variaveis CSS `--destructive`, `--secondary` dark, `--accent` dark e `--sidebar-accent` dark) pelo verde primario do sistema, e substituir classes hardcoded `red-*` por equivalentes verdes nos componentes.

---

## 1. Variaveis CSS - `src/index.css`

### Modo claro (`:root`)
- `--destructive`: trocar de `oklch(0.5783 0.2301 28.5639)` (vermelho) para `oklch(0.4500 0.1280 150.4756)` (verde escuro, variacao do primary para manter contraste)

### Modo escuro (`.dark`)
- `--secondary`: trocar de `oklch(0.3403 0.1182 25.1469)` (vermelho escuro) para `oklch(0.3403 0.1000 150.4756)` (verde escuro)
- `--accent`: trocar de `oklch(0.3403 0.1182 25.1469)` para `oklch(0.3403 0.1000 150.4756)`
- `--destructive`: trocar de `oklch(0.3403 0.1182 25.1469)` para `oklch(0.3403 0.1000 150.4756)`
- `--sidebar-accent`: trocar de `oklch(0.3403 0.1182 25.1469)` para `oklch(0.3403 0.1000 150.4756)`

Isso corrige o fundo vermelho do item ativo na sidebar (visivel no screenshot).

---

## 2. Classes hardcoded `red-*` nos componentes

### `src/components/clientes/CertificadoA1Section.tsx`
- Badge "Vencido": trocar `bg-red-500/15 text-red-600 border-red-500/30` por classes usando o verde primario (ex: `bg-primary/15 text-primary border-primary/30`) ou manter um tom diferenciado para status negativo usando `amber` em vez de vermelho.

### `src/pages/CertificadosA1.tsx`
- Badge "vencido": trocar `bg-red-500/15 text-red-600 border-red-500/30` por `bg-primary/15 text-primary border-primary/30`
- KPI "Vencidos": trocar `text-red-600` por `text-primary`

### `src/components/clientes/EspelhoFinanceiro.tsx`
- Valores negativos/custos: trocar classes `red-*` por equivalentes usando `primary` ou um tom de verde mais escuro para diferenciar

### `src/components/ui/toast.tsx`
- Classes `group-[.destructive]:text-red-300`, `group-[.destructive]:hover:text-red-50`, etc.: trocar para equivalentes verdes (`green-300`, `green-50`, `green-400`, `green-600`)

---

## 3. Memoria de estilo

Atualizar a diretriz de identidade visual para registrar que o sistema nao usa vermelho - o padrao e verde primario para todas as acoes, incluindo destructive/alertas.

---

## Arquivos modificados

| Arquivo | Mudanca |
|---------|---------|
| `src/index.css` | Atualizar variaveis destructive, secondary dark, accent dark, sidebar-accent dark |
| `src/components/clientes/CertificadoA1Section.tsx` | Trocar classes red por green/primary |
| `src/pages/CertificadosA1.tsx` | Trocar classes red por green/primary |
| `src/components/clientes/EspelhoFinanceiro.tsx` | Trocar classes red por green/primary |
| `src/components/ui/toast.tsx` | Trocar classes red por green |

