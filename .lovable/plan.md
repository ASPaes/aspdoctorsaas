

# Reestruturacao do Espelho Financeiro com Composicao MRR

## Conceito

A secao financeira sera reorganizada em 2 blocos visuais sequenciais:

1. **Composicao MRR** (primeiro) -- mostra como se chega ao MRR Atual e Custo Atual
2. **Espelho Financeiro** (depois) -- resultado dos calculos usando MRR Atual e Custo Atual como base

Vendas Avulsas serao somadas ao valor de ativacao (exibido na composicao MRR, nao afetam MRR recorrente).

Cada card de indicador tera um icone "?" com tooltip explicando a formula e o objetivo do indicador.

---

## Mudancas Tecnicas

### 1. `useEspelhoFinanceiro.ts`

Adicionar parametros opcionais para receber os deltas MRR/Custo dos movimentos:

- Novo input: `deltaMrr` e `deltaCusto` (ambos default 0)
- A mensalidade efetiva passa a ser: `mensalidade + deltaMrr`
- O custo efetivo passa a ser: `custo_operacao + deltaCusto`
- Todos os calculos (valor_repasse, impostos, lucro_bruto, margem, markup, fator_preco, margem_contribuicao, lucro_real) usam esses valores ajustados

### 2. `FinanceiroTab.tsx`

- Buscar movimentos MRR do cliente (via hook `useMrrTotals` -- movido para ca ou reutilizado)
- Calcular `somaDeltaMrr` e `somaDeltaCusto` dos movimentos ativos
- Passar esses deltas para `useEspelhoFinanceiro`
- Passar dados de composicao MRR para o componente visual

### 3. `EspelhoFinanceiro.tsx` -- Reestruturacao completa

**Ordem visual:**

```text
+--------------------------------------------------+
| COMPOSICAO MRR (titulo + badge qtd movimentos)   |
| [MRR Base] [Movimentos] [MRR Atual]              |
| (vendas avulsas somadas no valor ativacao)        |
+--------------------------------------------------+
|                                                   |
| ESPELHO FINANCEIRO (titulo)                       |
| [Valor Repasse ?] [Impostos ?] [Custos Fixos ?]   |
| [Lucro Bruto ?] [Margem Bruta ?] [Markup COGS ?]  |
| [Fator Preco ?] [Margem Contrib ?]                |
| === LUCRO REAL (destaque) ===                     |
+--------------------------------------------------+
```

**Tooltips de cada indicador (icone "?" no canto superior direito de cada card):**

| Indicador | Formula | Objetivo |
|---|---|---|
| Valor Repasse | MRR Atual - Custo Atual | Quanto sobra apos pagar o custo de operacao |
| Impostos | MRR Atual x Imposto% | Valor estimado de impostos sobre a receita |
| Custos Fixos | MRR Atual x Custo Fixo% | Despesas fixas proporcionais a receita |
| Lucro Bruto | MRR Atual - Custo Atual - Impostos | Lucro antes dos custos fixos |
| Margem Bruta | (Lucro Bruto / MRR Atual) x 100 | Percentual de lucro sobre a receita |
| Markup COGS | ((MRR / Custo) - 1) x 100 | Percentual de acrescimo sobre o custo |
| Fator Preco | MRR Atual / Custo Atual | Quantas vezes o preco cobre o custo |
| Margem Contribuicao | Lucro Bruto - Custos Fixos | Quanto cada cliente contribui para cobrir despesas |
| Lucro Real | Margem de Contribuicao | Resultado liquido final da operacao |

Implementacao dos tooltips usando `Tooltip` + `TooltipTrigger` + `TooltipContent` do shadcn/ui (ja disponivel no projeto), com icone `HelpCircle` do lucide-react.

---

## Arquivos modificados

| Arquivo | Tipo |
|---|---|
| `src/hooks/useEspelhoFinanceiro.ts` | Modificado -- aceita deltaMrr/deltaCusto |
| `src/components/clientes/FinanceiroTab.tsx` | Modificado -- calcula deltas e passa ao hook |
| `src/components/clientes/EspelhoFinanceiro.tsx` | Modificado -- reordena layout, adiciona tooltips |

Nenhuma migration SQL necessaria.

