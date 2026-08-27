# Intake de proposta comercial → cliente, contrato e jornada de onboarding

Data: 2026-08-27 · Owner: Alexandre (ASP) · Status: aguardando revisão do owner

## Problema

O comercial da Digi Office levanta os dados da venda num sistema externo de propostas. Ao
"Finalizar Ticket" lá, hoje o resultado é um **PDF anexado à mão** na jornada de onboarding
(`resumo-implantacao-*.pdf`). Todo o resto é redigitação: alguém cadastra o cliente no Doctor,
amarra os itens vendidos e abre a jornada.

Três passos manuais, todos com o dado já digitado uma vez do outro lado.

### O que já existe

`supabase/functions/onboarding-intake-webhook/index.ts` (127 linhas, no repo desde 11/07/2026)
já resolve o **passo 3**: recebe JSON com `x-webhook-secret`, valida tenant, resolve cliente por
`cliente_doc` e chama `create_onboarding_journey`. Ele **recusa de propósito** quando o cliente
não existe:

```
cliente_nao_encontrado — "Cadastre o cliente antes de abrir a jornada."
```

Ressalvas medidas:
- **Não está declarado em `supabase/config.toml`** — o CI deploya com `verify_jwt=false`.
  Para um webhook isso é o valor certo, mas precisa ser declarado explícito (regra do CLAUDE.md §1).
- **Nenhum arquivo do repo o chama.** Só é citado numa spec anterior. Precisa confirmar contra
  produção se está deployado e se alguém já usa antes de alterar a assinatura.
- Chama a RPC com 8 parâmetros; a RPC em prod tem **12** (`p_demand_type_id`, `p_unidade_base_id`,
  `p_department_id`, `p_pipeline_id` foram acrescentados depois, todos com `DEFAULT NULL`).
  A chamada antiga continua válida, mas a jornada nasce sem tipo de demanda e sem pipeline.

## Decisões do owner (27/08/2026)

| Questão | Decisão |
|---|---|
| Gatilho | "Finalizar Ticket" no sistema de propostas |
| MRR | Entra **na chegada do webhook** (contrato e itens nascem ativos) |
| Tradução de itens | O JSON manda os **IDs do Doctor**, não texto |
| Catálogos | Doctor expõe um **GET de catálogo**; o sistema externo consome |
| Campos sem coluna (~25) | **Aba "Proposta"** renderizando o JSON cru; nada de campo customizado |
| CNPJ já cadastrado | **Reusa o cliente**, não sobrescreve o cadastro, só adiciona o contrato novo |
| Anexos | JSON manda URLs; o Doctor **baixa e anexa** ao ticket |
| Arquitetura | EF valida + **RPC única transacional** |
| Omie | **Não sincroniza sozinho** — segura até conferência humana |

### Riscos que o owner aceitou explicitamente

**MRR na chegada.** Proposta que não fecha depois vira churn falso e infla o MRR do mês em que
entrou. Aceito porque o gatilho é o fim do ticket comercial, não o envio da proposta.

**IDs do Doctor no sistema externo.** Módulo desativado ou produto novo faz o JSON mandar um ID
que não vale mais. Mitigação obrigatória: validar **todo** ID contra o tenant e recusar o lote
inteiro, listando todos os inválidos numa resposta só.

## Fatos medidos em produção (27/08/2026, tenant Digi Office Sistemas)

### O texto da proposta não casa com o cadastro

Itens do PDF de exemplo (BOTECO CHURRASCARIA DO PAULO) contra `produto_modulos`:

| Item na proposta | Casa por nome? |
|---|---|
| Essencial (Cloud + 1 PDV) | ❌ existe "Licença PDV" e "Usuário Cloud", separados |
| Ponto adicional (x9) | ❌ nada equivalente |
| Servidor Nuvem | ❌ existe "Servidor Legal" |

**0 de 3.** Match por texto está descartado — é o que sustenta a decisão de mandar IDs.

A proposta também **não diz qual produto é**. A Digi Office tem 6: `Gula` (14), `PDV Legal` (13),
`PDV Legal - Raspberry` (20), `PDV Legal - Servidor` (18), `PDV Legal - Suspenso` (19),
`PDV Legal Anual` (17). O `cliente_produtos.produto_id` não tem como ser inferido do PDF.

### Os 8 catálogos compartilhados

| Catálogo | Tabela | Linhas (Digi Office) | Valor do PDF bate? |
|---|---|---|---|
| Produtos | `produtos` | 6 | ❌ não informado |
| Módulos | `produto_modulos` | 19–43 por produto | ❌ 0 de 3 |
| Segmento | `segmentos` | 14 | ✅ "Bar" exato |
| Origem da venda | `origens_venda` | 19 | ⚠️ PDF "Já Cliente" / base "Já cliente" |
| Vendedor | `funcionarios` | 38 | ⚠️ PDF "Gabriela" / base "Gabriela P" |
| Forma de pagamento | `formas_pagamento` | 4 (Boleto, Cartão, Fornecedor cobra, PIX) | ⚠️ "Cartão 12x" — **o parcelamento não tem coluna** |
| Unidade base | `unidades_base` | 4 (Digi Up, Nutrebem, Digi Office, Teste) | ❌ não informado |
| Tipo de demanda | `onboarding_demand_types` | 9 | ✅ "Novo Cliente" exato |

O "Adquirente: Stone" e "Homologadas: L4 - Positivo" **não têm tabela nenhuma** no Doctor — vão
para a aba Proposta como texto.

### A integração Omie está ATIVA neste tenant

`omie_integration.ativo = true` para a Digi Office, com **453 linhas** em `omie_sync_fila`.

O trigger `valor_modulo_enfileirar_omie` dispara em `AFTER INSERT` de `cliente_produto_modulos`
(sem condição `WHEN`). Ou seja: **inserir um módulo enfileira sincronização real para o Omie**.
Uma proposta errada deixa de ser linha para apagar e vira cadastro/faturamento lá fora.

Existe freio pronto: `trg_valor_enfileirar_omie` retorna cedo quando
`current_setting('doctorsaas.skip_valor_sync', true) = 'true'`.

Os demais gatilhos de integração **não** disparam neste fluxo:
- `cliente_cadastro_enfileirar_omie` e `cliente_observacao_enfileirar_omie` são `AFTER UPDATE` — INSERT não dispara.
- `trg_oem_espelhar_ao_vincular_ins` exige `oem_codigo_filial IS NOT NULL`; o intake não preenche.
- `contrato_status_enfileirar_omie` é `AFTER UPDATE`.

### Contrato: 5.045 dos 5.186 são implícitos

`contratos.is_implicit = true` em 5.045 linhas contra 141 explícitas. O caminho canônico é a RPC
`create_cliente_produto_with_contract(p_cliente_id uuid, p_produto_id bigint, p_dados jsonb,
p_link_to_contrato_id uuid DEFAULT NULL)`, que insere `cliente_produtos` e cria/liga o contrato.

**Ela não pode ser chamada como está por `service_role`:**

```sql
SELECT tenant_id INTO v_user_tenant FROM profiles WHERE user_id = auth.uid();
IF NOT public.is_super_admin() AND (v_user_tenant IS NULL OR v_user_tenant <> v_cliente_tenant) THEN
  RAISE EXCEPTION 'Sem permissao no tenant do cliente';
END IF;
```

Com `service_role`, `auth.uid()` é `NULL` → `v_user_tenant` é `NULL` → **exceção**.
Isso precisa ser resolvido antes de tudo (ver Componente 4).

## Arquitetura

```
Sistema de propostas
   │
   │ 1. GET  /onboarding-catalogo?tenant_id=…      (uma vez, ao montar os selects)
   │    → { produtos, modulos, segmentos, origens_venda, formas_pagamento,
   │        vendedores, unidades_base, demand_types }
   │
   │ 2. POST /onboarding-intake-webhook            (ao "Finalizar Ticket")
   ▼
┌──────────────────────────────────────────────────────────────┐
│ onboarding-intake-webhook  (Edge Function, verify_jwt=false) │
│  a. grava payload cru em onboarding_intake_log   ← SEMPRE    │
│  b. idempotência: external_ticket_id já visto? devolve o que  │
│     foi criado antes e para                                   │
│  c. valida os 8 catálogos → devolve TODOS os IDs inválidos    │
│  d. chama fn_intake_proposta(payload)                         │
└───────────────────────────┬──────────────────────────────────┘
                            ▼
              ┌─────────────────────────────────┐
              │ fn_intake_proposta   (1 transação) │
              │   cliente  (reusa por CNPJ)        │
              │   cliente_produtos + contrato      │
              │   cliente_produto_modulos          │
              │   create_onboarding_journey        │
              │   grava payload em onboarding_journeys.proposta_payload │
              └─────────────────────────────────┘
                            │  sucesso
                            ▼
              ┌─────────────────────────────────┐
              │ onboarding-intake-anexos (assíncrono) │
              │   baixa URLs → support_ticket_attachments │
              └─────────────────────────────────┘
```

Falha em qualquer ponto de `fn_intake_proposta` = rollback total. O `onboarding_intake_log`
sobrevive porque é gravado numa chamada separada, antes da RPC.

## Componentes

### 1. `onboarding_intake_log` (tabela nova)

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid NOT NULL | |
| `external_ticket_id` | text NOT NULL | **UNIQUE (tenant_id, external_ticket_id)** → idempotência |
| `payload` | jsonb NOT NULL | JSON cru, sempre |
| `status` | text NOT NULL | `recebido` → `validado` → `processado` \| `erro` |
| `erro` | jsonb | lista de IDs inválidos ou mensagem da RPC |
| `cliente_id` / `contrato_id` / `journey_id` | uuid | preenchidos no sucesso |
| `omie_liberado_em` / `omie_liberado_por` | timestamptz / uuid | conferência humana |
| `created_at` / `updated_at` | timestamptz | |

RLS: leitura para `authenticated` do próprio tenant `OR public.is_super_admin()`; escrita só
`service_role`.

### 2. `onboarding-catalogo` (Edge Function nova, GET)

Autentica pelo mesmo `x-webhook-secret`. Recebe `tenant_id`, devolve os 8 catálogos com
`{ id, nome }` (módulos com `produto_id` junto), filtrando `ativo = true` onde a coluna existe.

Declarar `verify_jwt = false` em `supabase/config.toml`.

### 3. `onboarding-intake-webhook` (EF existente, ampliada)

Mantém o contrato atual funcionando (`cliente_id`/`cliente_doc` + `assunto`) e acrescenta o
payload novo. Ordem: grava log → checa idempotência → valida catálogos → RPC.

**A validação devolve todos os erros de uma vez**, no formato:

```json
{ "ok": false, "error": "ids_invalidos",
  "invalidos": [ {"campo": "modulos[1].modulo_id", "valor": "…", "motivo": "nao_existe_no_tenant"} ] }
```

Um erro por resposta forçaria o vendedor a descobrir os problemas um a um.

### 4. `create_cliente_produto_with_contract` — liberar `service_role`

Alterar a guarda para aceitar `service_role` sem `auth.uid()`, no padrão já usado no projeto:

```sql
IF NOT public.is_super_admin()
   AND current_setting('role', true) IS DISTINCT FROM 'service_role'
   AND (v_user_tenant IS NULL OR v_user_tenant <> v_cliente_tenant) THEN
```

⚠️ `current_setting('role')` sobrevive ao `SECURITY DEFINER` — foi o que sustentou o fechamento
das 35 RPCs em 31/07. Validar com JWT forjado que usuário de outro tenant continua barrado.

Alternativa considerada e descartada: replicar o INSERT dentro de `fn_intake_proposta`. Duplicaria
a lógica de contrato implícito, que já divergiu antes.

### 5. `fn_intake_proposta(p_payload jsonb)` (RPC nova)

`SECURITY DEFINER` + `SET search_path = public` + `REVOKE FROM PUBLIC` +
`GRANT TO service_role` (**não** para `authenticated` — é chamada só pela EF).

Passos, na ordem, numa transação:

1. `SET LOCAL doctorsaas.skip_valor_sync = 'true'` — segura o Omie (decisão do owner).
2. **Cliente**: busca por `cnpj` normalizado (só dígitos) no tenant. Achou → reusa, **não atualiza
   nada**. Não achou → INSERT com os campos que têm coluna.
3. **Contrato + itens**: para cada produto do payload, `create_cliente_produto_with_contract`.
   O 1º cria o contrato; os demais passam `p_link_to_contrato_id` para cair no mesmo contrato.
4. **Módulos**: INSERT em `cliente_produto_modulos` com `quantidade` e `vlr_mensal`.
   ⚠️ Módulo com `vlr_mensal = 0` dispara trigger que **zera todos os totais** (CLAUDE.md).
   A RPC recusa `vlr_mensal <= 0` em vez de gravar.
5. **Jornada**: `create_onboarding_journey` com os **12** parâmetros, incluindo `p_demand_type_id`
   e `p_pipeline_id`.
   ⚠️ **`p_unidade_base_id` fica NULL de propósito.** No onboarding a unidade vem do CLIENTE
   (`clientes.unidade_base_id`); o ticket nasce com o campo vazio e a view expõe `cliente_unidade_id`
   (CLAUDE.md). O `unidade_base_id` do payload é gravado **no cliente**, no passo 2 — e só quando o
   cliente é novo, já que cliente reusado não tem cadastro sobrescrito.
6. Grava o payload cru em `onboarding_journeys.proposta_payload` (coluna jsonb nova).

Retorna `{ cliente_id, contrato_id, journey_id, ticket_id, cliente_reusado: bool }`.

### 6. Aba "Proposta" na jornada (frontend)

Componente somente-leitura que renderiza `proposta_payload` no layout do PDF atual (seções
Dados Cliente / Dados Comerciais / Implantação / Módulos / Outras Informações). Campos sem
tradução aparecem como vieram. Padrão visual Spatial UI do projeto.

Inclui o botão **"Liberar para o Omie"** (só `admin`/`head`), que chama a sincronização segurada
no passo 1 e carimba `omie_liberado_em` / `omie_liberado_por`.

### 7. `onboarding-intake-anexos` (EF nova, assíncrona)

Chamada pelo webhook **depois** do sucesso da RPC. Baixa cada URL e grava em
`support_ticket_attachments` via `service_role` (upload client-side nunca funciona neste projeto).

Falha de anexo **não** derruba a venda: registra em `onboarding_intake_log.erro` e o ticket segue.

Limites: **25 MB por arquivo**, timeout de **30 s** por download, no máximo **10 anexos** por proposta.
Arquivo acima do limite não é baixado — o log guarda a URL e o motivo, e a aba Proposta mostra o link.

## Contrato do JSON (rascunho)

```json
{
  "external_ticket_id": "TCK-2026-0819-001",
  "tenant_id": "…",
  "demand_type_id": "cc28a94c-…",
  "unidade_base_id": 3,
  "_nota_unidade": "vai para clientes.unidade_base_id, nao para o ticket",
  "cliente": {
    "cnpj": "17739131000198", "razao_social": "BOTECO CHURRASCARIA DO PAULO",
    "tipo": "PJ", "email": "…", "telefone": "…",
    "segmento_id": 7, "endereco": "…", "numero": "58", "bairro": "Flores",
    "cep": "69058105", "cidade_id": 1234
  },
  "comercial": {
    "funcionario_id": 42, "origem_venda_id": 11,
    "forma_pagamento_ativacao_id": 2, "forma_pagamento_mensalidade_id": 2,
    "vlr_mensal": 539.00, "vlr_ativacao": 1200.00,
    "data_inicio_prevista": "2026-08-25"
  },
  "produtos": [
    { "produto_id": 18, "vlr_mensal": 539.00, "vlr_ativacao": 1200.00,
      "modulos": [ { "modulo_id": "630f1a44-…", "quantidade": 1, "vlr_mensal": 149.00, "vlr_ativacao": 400.00 } ] }
  ],
  "anexos": [ { "nome": "resumo.pdf", "url": "https://…", "tipo": "application/pdf" } ],
  "proposta": { "…": "todos os ~25 campos sem coluna, como vieram" }
}
```

`proposta` é o objeto que alimenta a aba. Campo novo lá fora não quebra nada aqui.

## Erros e o que acontece com cada um

| Situação | Resposta | Estado no Doctor |
|---|---|---|
| Secret errado | 401 | nada gravado |
| JSON inválido | 400 | nada gravado |
| `external_ticket_id` repetido | 200 com os IDs já criados | nada novo |
| ID de catálogo inexistente | 422 com a lista completa | log `erro`, nada criado |
| Módulo com `vlr_mensal <= 0` | 422 | log `erro`, nada criado |
| Falha no meio da RPC | 500 | rollback total, log `erro` com a mensagem |
| Anexo não baixou | 200 (venda criada) | log com o anexo que falhou |

## Testes

- **SQL** (`scripts/sql-tests/`, via docker exec, banco local):
  cliente novo · cliente reusado por CNPJ · reenvio idempotente · ID de outro tenant recusado ·
  módulo com valor zero recusado · rollback deixa o banco limpo ·
  `skip_valor_sync` impede a linha na `omie_sync_fila`.
- **RLS com JWT forjado**: usuário de outro tenant não lê `onboarding_intake_log` nem chama a RPC.
- **`create_cliente_produto_with_contract`**: a alteração da guarda não abre acesso cross-tenant.
- **Frontend**: `bun run build` + `tsc -p tsconfig.app.json` (o `tsc` da raiz não checa nada).

## Fora de escopo

- Fila com worker e retentativa automática (opção C, descartada pelo volume).
- Campos customizados editáveis (`onboarding_accounting_fields`) — a aba resolve por ora.
- Tabela de adquirente/homologadas.
- Parcelamento do setup ("Cartão 12x") — não tem coluna; fica na aba como texto.
- Secret por tenant: continua o `ONBOARDING_INTAKE_SECRET` único, com o TODO que já está no código.

## Ordem de implementação sugerida

1. Confirmar em prod se `onboarding-intake-webhook` está deployado e em uso; declarar no `config.toml`.
2. Guarda de `create_cliente_produto_with_contract` + teste de RLS.
3. `onboarding_intake_log` + coluna `proposta_payload`.
4. `fn_intake_proposta` + testes SQL no banco local.
5. `onboarding-catalogo` (destrava o sistema externo a começar).
6. Ampliar `onboarding-intake-webhook`.
7. Aba "Proposta" + botão de liberar Omie.
8. `onboarding-intake-anexos`.

Cada passo é entregue e validado antes do seguinte. Nada vai para produção sem OK explícito.
