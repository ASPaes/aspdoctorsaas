# Contatos do WhatsApp — Adicionar contato, vincular cliente e filtrar por cliente

**Data:** 2026-07-22
**Tela:** `/whatsapp/contatos` (`src/pages/WhatsAppContatos.tsx`)
**Owner:** Alexandre (ASP)

## Problema

A tela de contatos hoje só lista `whatsapp_contacts` (contatos que nasceram de mensagens). Não há
como:
1. Adicionar um contato novo pela tela (nome + telefone).
2. Vincular esse contato a um cliente no momento do cadastro.
3. Filtrar a lista pelos contatos de um cliente específico.

## Contexto técnico apurado (fonte de verdade: banco de produção)

- `whatsapp_contacts` **já tem** a coluna `cliente_id` (2269/6557 linhas preenchidas). Ela é
  **mantida automaticamente** pelo trigger `sync_contact_cliente()` quando um atendimento é
  vinculado via `set_attendance_cliente`. É a coluna canônica do vínculo contato↔cliente e serve
  tanto pro filtro quanto pra exibição.
- **Sem constraint de unicidade** em `whatsapp_contacts` — duplicatas por telefone já existem. O
  dedup precisa ser explícito (por últimos 10 dígitos).
- **Zero triggers** em `whatsapp_contacts` → INSERT é seguro, sem risco de egress (nenhum WhatsApp
  é disparado).
- RLS: policy `whatsapp_contacts_tenant_rw` é `ALL` para `authenticated`, com
  `tenant_id = current_tenant_id()`, e `is_super_admin()` faz bypass.
- **Bug conhecido a corrigir:** `useLinkedCliente` (painel de detalhes desta tela) **ignora**
  `whatsapp_contacts.cliente_id` — descobre o cliente por metadata da conversa + match de telefone.
  Logo, um contato recém-vinculado (sem conversa ainda) **não** mostraria "Cliente Vinculado".
- `EditContactModal` (contexto do chat) tem o modo `isNewContact`, mas: o telefone é travado
  (herda de conversa) e o `persistClienteLink` sai cedo sem `conversationId` — ou seja, **não grava
  `whatsapp_contacts.cliente_id`** no cadastro de diretório. Não serve pra este caso. Fica fora do
  escopo (não vou refatorá-lo).
- Reaproveitável: `useClienteSearch` (hook) + RPC `search_clientes_for_link(p_tenant_id, p_term,
  p_include_cancelados)`; utilitários `normalizeBRPhone` / `isValidBRPhone` / `maskBRPhoneLive`
  (`src/lib/phoneBR.ts`).

## Decisões (validadas com o owner)

1. **"Adicionar contato" = só cadastro de diretório.** Não abre conversa.
2. **Vincular grava nos dois:** `whatsapp_contacts.cliente_id` **e** `cliente_contatos` (aparece na
   ficha do cliente), com dedup.
3. **Filtro de vínculo:** Todos · Sem cliente · Cliente específico.
4. **Gravação via RPC dedicada** `SECURITY DEFINER` (atômica, dedup centralizado, validação
   cross-tenant).

## Arquitetura

Fluxo de gravação centralizado numa RPC; o frontend só coleta dados, normaliza o telefone e chama a
RPC. Filtro e correção de exibição são mudanças de leitura no frontend.

```
AddContactDialog ──(normalizeBRPhone + isValidBRPhone)──▶ useCreateDirectoryContact
                                                              │
                                                              ▼
                                       rpc('create_wa_directory_contact', {...})
                                          ├─ guard tenant / super_admin
                                          ├─ dedup por últimos 10 dígitos
                                          ├─ insert/patch whatsapp_contacts(+cliente_id)
                                          ├─ valida cliente do mesmo tenant
                                          └─ insert cliente_contatos (dedup)

WhatsAppContatos (filtro Vínculo) ─▶ useWhatsAppContacts(clienteFilter) ─▶ .eq/.is('cliente_id')
useLinkedCliente ─▶ passa a ler whatsapp_contacts.cliente_id PRIMEIRO
```

## Componentes

### 1. RPC `create_wa_directory_contact` (mudança no banco — requer OK explícito)

Assinatura:
```
create_wa_directory_contact(
  p_tenant_id   uuid,
  p_name        text,
  p_phone       text,          -- dígitos normalizados (55 + DDD + número), vindos do client
  p_cliente_id  uuid  DEFAULT NULL,
  p_instance_id uuid  DEFAULT NULL
) RETURNS TABLE(contact_id uuid, already_existed boolean)
```

Lógica (1 transação):
1. **Guard de tenant:** `is_super_admin() OR (is_tenant_active_member() AND p_tenant_id =
   current_tenant_id())` → senão `RAISE EXCEPTION`.
2. **Normaliza/valida telefone:** `v_digits = regexp_replace(p_phone,'\D','','g')`;
   `v_last10 = right(v_digits,10)`; exige `length(v_last10)=10` e `trim(p_name) <> ''`.
3. **Dedup** por `tenant_id` + últimos 10 dígitos. Se existir: reaproveita o registro
   (prefere o que já tem `cliente_id`), marca `already_existed=true`, e **só preenche `cliente_id`
   se estiver NULL** (não sobrescreve nome nem vínculo existente).
4. **Insert** em `whatsapp_contacts` (`tenant_id, phone_number=v_digits, name, cliente_id,
   instance_id, is_group=false`) quando não existir.
5. **Se `p_cliente_id` não nulo:** valida que o cliente pertence ao `p_tenant_id` (cross-tenant
   guard, igual `set_attendance_cliente`); insere em `cliente_contatos` (`cliente_id, tenant_id,
   nome, fone=v_digits`) **se ainda não existir** contato com os mesmos últimos 10 dígitos.
6. Retorna `(contact_id, already_existed)`.

Grants (padrão do projeto): `REVOKE ALL ... FROM PUBLIC; GRANT EXECUTE ... TO authenticated,
service_role`.

> A validar na implementação: colunas obrigatórias de `cliente_contatos` (o `EditContactModal`
> insere só `{cliente_id, tenant_id, nome, fone}` com sucesso — assume-se que bastam).

### 2. Hook `useCreateDirectoryContact` (`src/components/whatsapp/hooks/`)

Mutation que lê `effectiveTenantId` de `useTenantFilter`, chama a RPC, e no sucesso invalida
`['whatsapp-contacts']` e `['linked-cliente']`. Retorna `{ contact_id, already_existed }` pro caller
decidir o toast e selecionar o contato.

### 3. Componente `AddContactDialog` (`src/components/whatsapp/contatos/` ou próximo à página)

Dialog (shadcn) com:
- **Nome** (obrigatório, mín. 2).
- **Telefone** com `maskBRPhoneLive`; valida com `isValidBRPhone(normalizeBRPhone(v))`.
- **Instância** (opcional) — `useWhatsAppInstances`.
- **Cliente** (opcional) — busca reaproveitando o padrão do `EditContactModal` (`useClienteSearch`
  + lista de resultados clicável + chip removível).
- Submit → `normalizeBRPhone` → RPC. Toast: `already_existed` ⇒ "Esse número já estava na lista —
  vínculo atualizado"; senão "Contato criado". Fecha, seleciona o novo contato na lista.

### 4. `useWhatsAppContacts` — parâmetro de filtro por cliente

- Adicionar `cliente_id` ao `.select(...)`.
- Novo parâmetro `clienteFilter?: { mode: 'all' | 'none' | 'cliente'; clienteId?: string }`.
- Aplicar em **query e count**: `mode='none'` → `.is('cliente_id', null)`; `mode='cliente'` (com id)
  → `.eq('cliente_id', clienteId)`.
- Incluir no `queryKey`.
- (Nice-to-have) badge de "vinculado" no item da lista quando `cliente_id` presente.

### 5. `WhatsAppContatos.tsx` — UI de filtro + botão

- Botão **"+ Adicionar contato"** no header da lista (abre `AddContactDialog`).
- **Filtro "Vínculo"**: `Select` com Todos / Sem cliente / Cliente específico. Ao escolher
  "Cliente específico", exibe busca inline de cliente (mesmo padrão); cliente escolhido vira chip
  removível. Passa `clienteFilter` pro hook e reseta `page` ao mudar.

### 6. `useLinkedCliente` — correção de exibição

Novo **passo 0** antes do metadata: buscar `whatsapp_contacts.cliente_id` do `contactId`; se
presente, usar como `clienteId` com `origem='vinculo'`. Mantém os fallbacks atuais (metadata +
telefone) pra contatos antigos. Alinha filtro, gravação e exibição na mesma coluna canônica.

## Casos de borda

- **Telefone duplicado** → RPC retorna o existente (`already_existed=true`); UI seleciona e avisa.
- **Contato sem cliente** → `cliente_id` NULL; aparece em "Sem cliente".
- **Super admin simulando tenant** → guard passa por `is_super_admin()`; `p_tenant_id =
  effectiveTenantId` selecionado.
- **Cliente de outro tenant** → `RAISE EXCEPTION` (cross-tenant guard).
- **Telefone inválido / não-BR (LID, grupo)** → barrado por `isValidBRPhone` no client e pelo guard
  de 10 dígitos na RPC.

## Testes

**RPC (banco local Docker primeiro, depois prod com OK):**
- Smoke rollback-safe (`DO $$ ... RAISE EXCEPTION 'SMOKE_OK|%' ... END $$`):
  - cria contato + cliente → verifica linha em `whatsapp_contacts` (com `cliente_id`) e em
    `cliente_contatos`;
  - re-chamar com mesmo telefone → `already_existed=true`, sem duplicar;
  - cliente de outro tenant → exceção;
  - telefone inválido / nome vazio → exceção.
- Grants via `information_schema.routine_privileges` (tem `authenticated`).

**Frontend (localhost contra Docker local):**
- Adicionar contato com e sem cliente; conferir que aparece na lista.
- Filtrar por cliente específico e por "Sem cliente".
- Abrir o contato recém-vinculado → "Cliente Vinculado" aparece (valida a correção do
  `useLinkedCliente`).

## Fora de escopo

- Iniciar conversa a partir do cadastro (decisão: só diretório).
- Refatorar `EditContactModal` / o N+1 de métricas por contato em `useWhatsAppContacts`.
- Deduplicação retroativa das duplicatas já existentes.

## Performance

`whatsapp_contacts` tem ~6,5k linhas — filtro por `cliente_id` é trivial (sem índice novo).
Gravação é manual/baixo volume. Sem impacto de egress (INSERT não gera WhatsApp).

## Ordem de deploy

Mudanças de banco (RPC) via SQL Editor / `apply_migration` **com OK do Alexandre**, validadas no
local antes. Frontend publica por push (auto-deploy Hostinger). RPC deve ir **antes** do frontend.
