

## Objetivo
Refatorar o sistema de presenca do agente: substituir a barra horizontal (`AgentPresenceBar`) por um **botao/chip compacto** no header global (`AppLayout`), adicionar modal de pausa com selecao de motivo, manter overlay quando pausado/off, e bloquear acoes do chat.

## Arquivos Modificados

### 1. `src/components/AppLayout.tsx`
- Importar e renderizar o novo `AgentPresenceButton` no header, ao lado do `SidebarTrigger`
- O botao so aparece quando a rota atual e `/whatsapp` (usar `useLocation`)

### 2. `src/components/whatsapp/presence/AgentPresenceButton.tsx` (NOVO)
- Chip compacto que exibe status:
  - **active**: Badge verde "Ativo" com icone Zap
  - **paused**: Badge amarela "Pausado mm:ss" com countdown ao vivo
  - **off**: Badge cinza "Offline"
- Ao clicar, abre `DropdownMenu` com acoes contextuais:
  - Se `off`: "Iniciar expediente" -> RPC `agent_presence_set_active`
  - Se `active`: "Pausar" (submenu com motivos) + "Encerrar expediente"
  - Se `paused`: "Voltar ao ativo" + "Estender pausa"
- "Encerrar expediente" verifica atendimentos ativos (mesmo fluxo do `AgentPresenceBar` atual com AlertDialog)
- Usa `useAgentPresence` hook existente

### 3. `src/components/whatsapp/presence/AgentPauseModal.tsx` (NOVO)
- Dialog modal acionado ao selecionar "Pausar" no dropdown
- Select para escolher motivo (lista de `pauseReasons`)
- Exibe "Sugestao: X min" baseado no `average_minutes` do motivo selecionado
- Input numerico para minutos (default = sugestao)
- Botao "Iniciar Pausa" -> chama `setPaused(reasonId)` com minutos customizados

### 4. `src/hooks/useAgentPresence.ts`
- Ajustar `setPaused` para aceitar minutos customizados: `setPaused(reasonId: string, minutes?: number)`
- O parametro `minutes` sobrescreve o `average_minutes` do motivo quando fornecido

### 5. `src/components/whatsapp/presence/AgentPresenceOverlay.tsx`
- Expandir para mostrar:
  - Motivo da pausa (buscar nome do `pauseReasons` pelo `pause_reason_id`)
  - Countdown regressivo (baseado em `pause_expected_end_at`)
  - Botao "Voltar ao ativo"
  - Botao "Estender pausa" -> mini-dialog inline para +X min

### 6. `src/components/whatsapp/chat/ChatInput.tsx`
- Importar `useAgentPresence`
- Quando `isBlocked` = true, desabilitar textarea + botao enviar
- Tooltip: "Voce precisa estar ATIVO para atender."

### 7. `src/components/whatsapp/chat/ChatHeader.tsx`
- Importar `useAgentPresence`
- Desabilitar botoes "Assumir" e "Transferir" quando `isBlocked`
- Tooltip nos botoes desabilitados

### 8. `src/pages/WhatsApp.tsx`
- Remover `AgentPresenceBar` (substituido pelo botao no header global)
- Manter `AgentPresenceOverlay`
- Ajustar alturas (remover compensacao do bar)

## Nao Alterar
- Logica de atendimentos/URA/CSAT
- Sidebar e filtros
- RPCs do Supabase (ja existem)
- Hook `useAgentPresence` (ajuste minimo no `setPaused`)

## Impacto
- **UI**: Barra horizontal removida, chip compacto no header global
- **Estado**: Mesmo hook, mesmas RPCs
- **DB**: Nenhuma alteracao

## Testes Manuais
1. Clicar no chip "Offline" -> "Iniciar expediente" -> chip muda para verde "Ativo"
2. Clicar "Pausar" -> modal com motivos -> selecionar -> overlay aparece com countdown
3. No overlay, clicar "Voltar ao ativo" -> overlay some, chip verde
4. No overlay, clicar "Estender" -> countdown aumenta
5. Tentar enviar mensagem enquanto pausado -> input desabilitado com tooltip
6. Encerrar expediente com atendimentos ativos -> modal de confirmacao

