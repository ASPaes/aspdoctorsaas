

## Fase 1 --- Fundação: Database Multi-Tenant + Edge Functions Core

### Objetivo
Criar todas as tabelas WhatsApp no Supabase do Doctor SaaS com isolamento multi-tenant completo e deployar as 5 Edge Functions essenciais para conectar instâncias e enviar/receber mensagens.

---

### 1. Migration Consolidada

Criar **13 tabelas** + enum + triggers + indexes + storage + realtime. Todas com `tenant_id UUID NOT NULL REFERENCES tenants(id)`, `FORCE ROW LEVEL SECURITY`, e policy `can_access_tenant_row(tenant_id)`.

**Tabelas:**

| Tabela | Adaptações Multi-Tenant |
|--------|------------------------|
| `whatsapp_instances` | `tenant_id` + UNIQUE(tenant_id, instance_name) + trigger `set_tenant_id_on_insert` |
| `whatsapp_instance_secrets` | `tenant_id` + RLS restritivo (`is_tenant_admin()`) |
| `whatsapp_contacts` | `tenant_id` + FK instance |
| `whatsapp_conversations` | `tenant_id` + `assigned_to UUID` (sem FK, referencia `profiles.user_id`) |
| `whatsapp_messages` | `tenant_id` + FK conversation |
| `whatsapp_macros` | `tenant_id` + FK instance |
| `whatsapp_conversation_notes` | `tenant_id` + FK conversation |
| `whatsapp_conversation_summaries` | `tenant_id` + FK conversation |
| `whatsapp_reactions` | `tenant_id` + FK conversation |
| `whatsapp_message_edit_history` | `tenant_id` + FK conversation |
| `whatsapp_sentiment_analysis` | `tenant_id` + FK conversation/contact |
| `whatsapp_sentiment_history` | `tenant_id` + FK conversation/contact |
| `whatsapp_topics_history` | `tenant_id` |
| `conversation_assignments` | `tenant_id` + FK conversation |
| `assignment_rules` | `tenant_id` + FK instance |

**Objetos auxiliares:**
- Enum `sentiment_type` (positive, neutral, negative)
- Trigger `archive_sentiment_to_history()` (reusa `SET search_path = public`)
- Trigger `archive_topics_to_history()` (reusa `SET search_path = public`)
- Triggers `set_updated_at()` nas tabelas com `updated_at` (reusa função existente do Doctor SaaS)
- Triggers `set_tenant_id_on_insert` em todas as tabelas
- Storage bucket `whatsapp-media` (público para leitura, upload autenticado)
- Realtime em `whatsapp_conversations`, `whatsapp_messages`, `whatsapp_instances`, `whatsapp_reactions`
- Indexes de performance (todos os do ASP Chat + `idx_*_tenant_id`)

**Diferenças críticas vs ASP Chat:**
- Sem tabelas `profiles`, `user_roles`, `project_config` (Doctor SaaS já tem)
- Sem trigger `on_auth_user_created` (Doctor SaaS tem seu próprio fluxo)
- Sem bucket `avatars` (não necessário)
- `assigned_to` na tabela `conversations` é UUID simples (referencia `profiles.user_id` do Doctor SaaS), sem FK direta
- Colunas extras: `provider_type`, `instance_id_external`, `audio_transcription`, `transcription_status`

---

### 2. Edge Functions Core (5 funções)

Todas adaptadas para multi-tenancy usando SERVICE_ROLE_KEY (já existente como secret).

#### 2.1 `evolution-webhook/index.ts` (~1043 linhas)
- `verify_jwt = false` (webhook externo)
- Adaptar: resolver `tenant_id` a partir da instância (`whatsapp_instances.tenant_id`) e incluir em todos os inserts
- Incluir `tenant_id` ao criar contacts, conversations, messages, reactions, edit history
- Storage path: manter `{instance_name}/{filename}` (instância já é tenant-scoped)
- Manter lógica completa: normalização telefone BR, auto-assignment, auto-sentiment/categorization triggers, media download, reactions, edits, connection updates

#### 2.2 `send-whatsapp-message/index.ts` (~338 linhas)
- Copiar com adaptação mínima: já usa SERVICE_ROLE_KEY
- Queries por ID de conversa (tenant-safe via RLS)

#### 2.3 `edit-whatsapp-message/index.ts` (~215 linhas)
- Copiar com adaptação mínima: mesmo padrão do send

#### 2.4 `test-instance-connection/index.ts` (~169 linhas)
- Adaptar auth: substituir `has_role(uid, 'admin')` por verificação do profile Doctor SaaS (`is_tenant_admin()` ou `is_super_admin()` via query na tabela profiles)

#### 2.5 `check-instances-status/index.ts` (~140 linhas)
- Copiar: já usa SERVICE_ROLE_KEY, itera todas instâncias
- Sem cron job (configurar depois se necessário)

#### Config TOML
- Adicionar `[functions.evolution-webhook] verify_jwt = false`
- Demais funções: `verify_jwt = false` (validar JWT manualmente no código, padrão Doctor SaaS)

---

### 3. Arquivos a criar/modificar

```text
Novos:
  supabase/functions/evolution-webhook/index.ts
  supabase/functions/send-whatsapp-message/index.ts
  supabase/functions/edit-whatsapp-message/index.ts
  supabase/functions/test-instance-connection/index.ts
  supabase/functions/check-instances-status/index.ts

Modificados:
  supabase/config.toml (adicionar verify_jwt = false para 5 funções)
  .lovable/plan.md (atualizar status da fase)
```

Migration SQL via migration tool (1 migration consolidada).

---

### 4. O que NÃO está nesta fase

- Componentes React / UI (Fase 2)
- Hooks WhatsApp (Fase 2)
- Rota na sidebar (Fase 2)
- Edge Functions de IA (Fase 4)
- Edge Functions de gestão: fix-contact-names, sync-contact-profiles (Fase 3)
- Cron jobs

---

### 5. Segurança

- **RLS**: `FORCE ROW LEVEL SECURITY` + `can_access_tenant_row(tenant_id)` em todas as tabelas
- **Secrets**: `whatsapp_instance_secrets` com RLS restritivo (`is_tenant_admin()`)
- **Webhook**: `verify_jwt = false` mas valida instância existente antes de processar
- **Edge Functions autenticadas**: Validam JWT via `getClaims()` e verificam permissões
- **SECURITY_DEBT**: Webhook não valida origem (Evolution API não envia token)

---

### 6. Testes Manuais pós-implementação

1. Verificar tabelas criadas: `SELECT count(*) FROM whatsapp_instances` (deve retornar 0, sem erro RLS)
2. Verificar bucket `whatsapp-media` no Storage
3. Configurar instância Evolution API via SQL INSERT direto (UI vem na Fase 2)
4. Apontar webhook da Evolution para `{SUPABASE_URL}/functions/v1/evolution-webhook`
5. Enviar mensagem de teste e verificar em `whatsapp_messages`

