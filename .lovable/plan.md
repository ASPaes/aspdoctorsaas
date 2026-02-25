

# Plano: Corrigir Drag-and-Drop no Kanban

## Problema

O drag handle esta restrito a um icone pequeno (`GripVertical`) que so aparece no hover e tem apenas 16x16px. Na pratica, o usuario precisa acertar exatamente esse icone para arrastar -- o que e quase impossivel.

O `provided.dragHandleProps` esta aplicado apenas nesse icone (linha 51), e nao no card inteiro.

## Solucao

Mover `{...provided.dragHandleProps}` do icone `GripVertical` para o `div` principal do card (linha 50). Isso permite arrastar o card clicando em qualquer lugar dele. O icone `GripVertical` permanece como indicador visual, mas sem funcao exclusiva de handle.

## Arquivo modificado

| Arquivo | Mudanca |
|---|---|
| `src/components/cs/CSKanban.tsx` | Mover `dragHandleProps` para o div raiz do card; remover do div do icone |

## Detalhe tecnico

Linha 50 -- adicionar `{...provided.dragHandleProps}`:
```tsx
<div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className={...}>
```

Linha 51 -- remover `{...provided.dragHandleProps}` do div do grip:
```tsx
<div className="absolute top-2 left-1 opacity-0 group-hover:opacity-100 transition-opacity">
```

