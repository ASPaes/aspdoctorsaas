

## Problema

Ao clicar em "Conversar" no card de contato, o sistema cria a conversa (toast "Conversa criada com sucesso") mas **não navega para ela**. O `NewConversationModal` dentro de `ChatAreaFull` não tem callback `onCreated`, e `ChatAreaFull` não tem como selecionar uma conversa diferente porque o estado `selected` é gerenciado pelo pai (`WhatsApp.tsx`).

## Solução

Adicionar um fluxo completo: modal cria a conversa -> busca os dados completos -> seleciona a conversa no painel.

### Alterações

1. **`ChatAreaFull.tsx`** — Adicionar prop `onNavigateToConversation` e passar como `onCreated` no `NewConversationModal`. No callback, buscar a conversa completa (com contact join) e chamar o handler do pai. Também auto-preencher a instância da conversa atual no modal.

2. **`WhatsApp.tsx`** — Passar callback `onNavigateToConversation` para `ChatAreaFull` que faz o fetch da conversa e chama `setSelected`.

3. **`NewConversationModal`** — Auto-selecionar a instância quando `initialPhone` é fornecido e há apenas uma instância (ou receber `initialInstanceId` como prop para pré-selecionar).

### Fluxo resultante

```text
Clique "Conversar" no ContactCard
  → Abre NewConversationModal (telefone + nome + instância pré-preenchidos)
  → Usuário confirma "Iniciar Conversa"
  → Conversa criada no banco
  → onCreated dispara → busca conversa completa → setSelected(conv)
  → Chat navega automaticamente para a nova conversa
```

