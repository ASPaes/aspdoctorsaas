
# Aplicar Tema Supabase do tweakcn.com

## Contexto

O tema fornecido pelo tweakcn usa **Tailwind CSS v4** com cores em formato `oklch()`. O projeto atual usa **Tailwind CSS v3** com cores em formato `hsl()`. Nao e possivel simplesmente colar o CSS - e necessario adaptar para compatibilidade com v3.

## Estrategia de Adaptacao

Em vez de converter oklch para hsl (perda de qualidade de cor), vamos mudar a abordagem: armazenar as cores como valores completos (incluindo `oklch(...)`) nas CSS variables e referenciar diretamente no `tailwind.config.ts` sem o wrapper `hsl()`.

## Arquivos a Modificar

### 1. `index.html`
- Adicionar import da fonte **Outfit** do Google Fonts (usada pelo tema)

### 2. `src/index.css`
- Substituir todas as variaveis CSS por valores `oklch()` completos do tema fornecido
- Adicionar novas variaveis: `--chart-1` a `--chart-5`, shadows customizados, font families, tracking
- Manter estrutura `:root` / `.dark` existente
- Atualizar o `@layer base` para incluir `outline-ring/50` e `letter-spacing`

### 3. `tailwind.config.ts`
- Trocar todas as referencias de `hsl(var(--xxx))` para `var(--xxx)` (pois os valores ja incluem `oklch(...)`)
- Adicionar cores `chart-1` a `chart-5` ao theme
- Adicionar configuracao de `fontFamily` com Outfit como sans-serif principal
- Atualizar sidebar para usar `var(--sidebar)` em vez de `var(--sidebar-background)`

### 4. `src/components/AppSidebar.tsx` (se necessario)
- Verificar se ha cores hardcoded que precisam ser atualizadas

## Detalhes Tecnicos

### Mudanca no formato de cores

```text
ANTES (v3 com hsl):
  CSS:    --primary: 153 40% 36%;
  Config: "hsl(var(--primary))"

DEPOIS (v3 com oklch):
  CSS:    --primary: oklch(0.8348 0.1302 160.9080);
  Config: "var(--primary)"
```

### Variaveis CSS - Light (:root)
Todas as variaveis do tema fornecido serao convertidas mantendo `oklch()` como valor completo. O dark mode recebe seus proprios valores conforme especificado.

### Fonte Outfit
- Importar via Google Fonts no `index.html`
- Configurar como `fontFamily.sans` no tailwind.config.ts
- Variavel CSS `--font-sans: Outfit, sans-serif`

### Shadows customizados
- Adicionar as variaveis de shadow do tema (`--shadow-2xs` ate `--shadow-2xl`)
- Podem ser usadas via classes utilitarias customizadas se necessario

### Chart Colors
- Adicionar 5 cores de graficos ao tema para uso com Recharts/componentes de chart

### Novas variaveis de sidebar
- O tema usa `--sidebar` em vez de `--sidebar-background` - atualizar tanto CSS quanto config para manter consistencia
