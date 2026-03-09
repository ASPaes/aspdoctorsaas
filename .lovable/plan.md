

## Objetivo

Portar na íntegra os componentes de configurações do WhatsApp do projeto ASP Chat para a aba "WhatsApp" da página de Configurações do DoctorSaaS, substituindo os componentes simplificados existentes por versões completas com todas as funcionalidades.

## Diferenças identificadas (ASP Chat vs DoctorSaaS atual)

| Feature | ASP Chat | DoctorSaaS |
|---------|----------|------------|
| Setup Guide (checklist) | Completo com categorias e progresso | Inexistente |
| Instâncias | Provider type (self-hosted/cloud), test via edge function, webhook URL display | Básico, sem provider type |
| Macros | Table view, Zod validation, macro dialog com description | Card view simplificado |
| Atribuição | RadioGroup, AgentMultiSelect, AssignmentRuleCard detalhado | Select simples, sem multi-select de agentes |
| Equipe | TeamMembersList com roles, invite, ativar/desativar | Inexistente (gerenciado em outra aba) |
| Segurança | Domain restriction, account approval | Inexistente |

## Decisão arquitetural

As abas **Equipe** e **Segurança** do ASP Chat dependem de tabelas (`user_roles`, `profiles.full_name`, `profiles.avatar_url`, `profiles.is_active`, `profiles.is_approved`, `project_config`) que **não existem** no schema do DoctorSaaS. O DoctorSaaS já tem gestão de usuários na aba "Usuários" e aprovação na aba "Aprovação de Acessos" em Configurações. Portanto, essas duas abas serão **excluídas** do port (já existem equivalentes).

## Mudanças no Código

### Arquivos a Criar

1. **`src/components/configuracoes/whatsapp/SetupGuideCollapsible.tsx`**
   - Port do checklist de setup com categorias (Configuração Inicial, Produtividade, Explorar Recursos)
   - Progresso por categoria e geral, persistido em localStorage
   - Adaptado: remover categorias "Equipe" (já existe aba Usuários), simplificar steps para o contexto DoctorSaaS

2. **`src/components/configuracoes/whatsapp/SetupStepCard.tsx`**
   - Card visual para cada step do checklist

3. **`src/hooks/useSetupProgress.ts`**
   - Hook com lógica de progresso, usando dados reais (instances, macros, assignment rules)
   - Adaptado: sem `useTeamManagement` (não existe no DoctorSaaS), sem `user_roles`

4. **`src/components/configuracoes/whatsapp/InstanceSetupCollapsible.tsx`**
   - Onboarding step-by-step da Evolution API (15 passos com Accordion)
   - Progresso persistido em localStorage, auto-open quando sem instâncias
   - Sem `canvas-confetti` (não está nas deps), usar toast simples

5. **`src/components/configuracoes/whatsapp/InstancesList.tsx`**
   - Lista de cards de instâncias usando `InstanceCard`

6. **`src/components/configuracoes/whatsapp/InstanceCard.tsx`**
   - Card com status, webhook URL copiável, botões de ação (test, edit, delete)

7. **`src/components/configuracoes/whatsapp/AddInstanceDialog.tsx`**
   - Dialog com suporte a provider_type (self-hosted vs cloud), test connection, Zod validation
   - Mostra instruções de webhook após criação

8. **`src/components/configuracoes/whatsapp/EditInstanceDialog.tsx`**
   - Dialog de edição com suporte a provider_type

9. **`src/components/configuracoes/whatsapp/MacrosManager.tsx`**
   - Table view com colunas: Nome, Atalho, Conteúdo, Categoria, Usos, Ações
   - Substituir MacrosTab simplificado

10. **`src/components/configuracoes/whatsapp/MacroDialog.tsx`**
    - Dialog com Zod validation, campo de description, select de categoria

11. **`src/components/configuracoes/whatsapp/AssignmentRulesManager.tsx`**
    - Manager completo com lista de cards

12. **`src/components/configuracoes/whatsapp/AssignmentRuleCard.tsx`**
    - Card detalhado mostrando tipo, agentes, instância

13. **`src/components/configuracoes/whatsapp/AssignmentRuleDialog.tsx`**
    - Dialog com RadioGroup (fixed vs round_robin), AgentMultiSelect

14. **`src/components/configuracoes/whatsapp/AgentMultiSelect.tsx`**
    - Multi-select com Command/Popover para selecionar agentes
    - Adaptado: usar `useTenantUsers` do DoctorSaaS em vez de `useAgents` do ASP Chat

### Arquivos a Modificar

15. **`src/pages/Configuracoes.tsx`**
    - Substituir conteúdo da aba WhatsApp: usar sub-tabs internas (Setup, Instâncias, Macros, Atribuição)

### Arquivos a remover/deprecar

- `src/components/whatsapp/settings/MacrosTab.tsx` — substituído por MacrosManager
- `src/components/whatsapp/settings/AssignmentTab.tsx` — substituído por AssignmentRulesManager
- `src/pages/WhatsAppSettings.tsx` — as configurações passam a viver em `/configuracoes?tab=whatsapp`

### Edge Function necessária

16. **`supabase/functions/test-evolution-connection/index.ts`**
    - Verificar se já existe — se não, criar para suportar teste de conexão no AddInstanceDialog

## Adaptações necessárias (ASP Chat → DoctorSaaS)

- **useAgents** → Adaptar para usar `useTenantUsers` existente ou `profiles` do DoctorSaaS (sem `user_roles` table)
- **useTeamManagement** → Não portar (DoctorSaaS já tem aba Usuários)
- **useSecuritySettings** → Não portar (requer tabela `project_config` inexistente)
- **canvas-confetti** → Não incluir (não está nas deps), usar toast
- **Tables<"whatsapp_macros">** → Usar interface local (supabase types pode não ter devido `as any` casts)
- **Routing**: Redirecionar `/whatsapp/settings` para `/configuracoes?tab=whatsapp`

## Impacto

- **UI**: Aba WhatsApp em Configurações ganha 4 sub-tabs completas com UX superior
- **Estado**: Hooks existentes (`useWhatsAppInstances`, `useWhatsAppMacros`, `useAssignmentRules`) continuam sendo usados
- **DB/Edge**: Possível criação da edge function `test-evolution-connection`

## Testes Manuais

1. Acessar `/configuracoes?tab=whatsapp`
2. Verificar sub-tabs: Setup, Instâncias, Macros, Atribuição
3. Testar CRUD de instâncias com provider_type
4. Testar CRUD de macros via table view
5. Testar CRUD de regras de atribuição com AgentMultiSelect
6. Verificar checklist de setup com progresso

