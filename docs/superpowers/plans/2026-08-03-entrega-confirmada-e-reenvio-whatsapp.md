# Entrega confirmada e reenvio automático de mensagem WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mensagem que o WhatsApp recusou deixa de aparecer como enviada: o sistema confirma a falha, tenta reenviar uma vez e só então avisa o operador.

**Architecture:** Uma escada de status que nunca anda para trás elimina o alarme falso vindo de ack por dispositivo e por participante de grupo. O `ERROR` do provedor vira sinal, não veredito: 20 s depois um verificador checa três condições e só então declara `failed`, o status que a tela e o botão Reenviar já entendem hoje.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions Deno + pg_cron + pg_net), TypeScript, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-03-entrega-confirmada-e-reenvio-whatsapp-design.md](../specs/2026-08-03-entrega-confirmada-e-reenvio-whatsapp-design.md)

## Global Constraints

- **Janela de confirmação: 20 segundos.** Vive em `whatsapp_delivery_config.confirm_window_seconds`, nunca em constante de código.
- **Teto de reenvio automático: 1.** `auto_retry_count >= 1` nunca dispara novo reenvio automático.
- **Notificação: in-app apenas.** Nenhuma mensagem WhatsApp neste fluxo — avisar por WhatsApp que o WhatsApp falhou é o desenho circular que já está em dívida técnica.
- **Nenhum backfill.** Nada de histórico é reclassificado. As ~1.400 mensagens `error` existentes ficam como estão.
- **`supabase db push` e `db reset` são proibidos** neste repositório. SQL vai para produção por `apply_migration` ou SQL Editor, com OK do Alexandre.
- **`CREATE INDEX CONCURRENTLY` só por `execute_sql`**, nunca por `apply_migration` (não roda em transação).
- **Escrita em produção exige OK explícito do Alexandre.** Diagnóstico e leitura são livres.
- **Antes de qualquer push que toque `supabase/functions/**`:** auditar repo × produção. O workflow `deploy-edge-functions.yml` redeploya as 63 edge functions, e qualquer uma atrasada em relação a produção reverte produção.
- **Vocabulário único:** os provedores mapeiam a falha deles (`ERROR` da Evolution, `failed` da Meta e da Z-API) para `error`. `failed` passa a ser escrito **exclusivamente** pelo verificador.
- Testes rodam com `bun run test` (vitest). `supabase/functions/_shared/**/*.test.ts` já está no `include` do `vitest.config.ts`.

---

### Task 1: A escada de status

Função pura, sem I/O, que decide o que gravar. É o coração da garantia e a única peça que dá para testar de forma barata e exaustiva.

**Files:**
- Create: `supabase/functions/_shared/delivery-status.ts`
- Test: `supabase/functions/_shared/delivery-status.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `statusRank(s: string | null | undefined): number`
  - `decideStatusUpdate(current: string | null | undefined, incoming: string): StatusDecision`
  - `interface StatusDecision { write: boolean; status: string | null; setLastErrorAt: boolean; setDeliveryConfirmedAt: boolean }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/functions/_shared/delivery-status.test.ts`:

```ts
// A escada existe para uma coisa só: impedir que um ack atrasado, ou o ack de UM
// dispositivo/participante, derrube o status de uma mensagem que já chegou.
// Errar aqui faz o operador reenviar mensagem que o cliente já leu.
import { describe, it, expect } from "vitest";
import { statusRank, decideStatusUpdate } from "./delivery-status.ts";

describe("statusRank", () => {
  it("ordena do menos para o mais confirmado", () => {
    expect(statusRank("pending")).toBeLessThan(statusRank("error"));
    expect(statusRank("error")).toBeLessThan(statusRank("sent"));
    expect(statusRank("sent")).toBeLessThan(statusRank("delivered"));
    expect(statusRank("delivered")).toBeLessThan(statusRank("read"));
  });

  it("põe failed no mesmo posto de error, para permitir auto-cura", () => {
    expect(statusRank("failed")).toBe(statusRank("error"));
  });

  it("devolve 0 para status desconhecido ou nulo", () => {
    expect(statusRank("banana")).toBe(0);
    expect(statusRank(null)).toBe(0);
    expect(statusRank(undefined)).toBe(0);
  });
});

describe("decideStatusUpdate", () => {
  it("NÃO rebaixa: error depois de read é ignorado", () => {
    const d = decideStatusUpdate("read", "error");
    expect(d.write).toBe(false);
    expect(d.setLastErrorAt).toBe(true); // ainda registra para diagnóstico
    expect(d.setDeliveryConfirmedAt).toBe(false);
  });

  it("NÃO rebaixa: error depois de sent é ignorado", () => {
    expect(decideStatusUpdate("sent", "error").write).toBe(false);
  });

  it("sobe: delivered depois de error grava e confirma entrega", () => {
    const d = decideStatusUpdate("error", "delivered");
    expect(d.write).toBe(true);
    expect(d.status).toBe("delivered");
    expect(d.setDeliveryConfirmedAt).toBe(true);
  });

  it("auto-cura: delivered depois de failed grava", () => {
    const d = decideStatusUpdate("failed", "delivered");
    expect(d.write).toBe(true);
    expect(d.status).toBe("delivered");
  });

  it("não desfaz o veredito: error depois de failed é ignorado", () => {
    expect(decideStatusUpdate("failed", "error").write).toBe(false);
  });

  it("grava: error em cima de pending", () => {
    const d = decideStatusUpdate("pending", "error");
    expect(d.write).toBe(true);
    expect(d.status).toBe("error");
    expect(d.setLastErrorAt).toBe(true);
  });

  it("ack repetido é no-op", () => {
    expect(decideStatusUpdate("read", "read").write).toBe(false);
  });

  it("status desconhecido do provedor é ignorado, não gravado cru", () => {
    const d = decideStatusUpdate("sent", "PLAYED_BACKWARDS");
    expect(d.write).toBe(false);
    expect(d.setLastErrorAt).toBe(false);
  });

  it("mensagem sem status ainda aceita o primeiro ack", () => {
    expect(decideStatusUpdate(null, "sent").write).toBe(true);
  });

  it("read confirma entrega tanto quanto delivered", () => {
    expect(decideStatusUpdate("sent", "read").setDeliveryConfirmedAt).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bun run test -- delivery-status`
Expected: FAIL — `Failed to resolve import "./delivery-status.ts"`

- [ ] **Step 3: Implementar**

Criar `supabase/functions/_shared/delivery-status.ts`:

```ts
// Fonte única da ordem dos status de entrega. Ninguém reimplementa local — é a mesma
// regra do phone.ts e do supabasePaginate.ts.
//
// Por que existe: os acks do WhatsApp chegam POR DISPOSITIVO (`...:26@lid`) e, em grupo,
// POR PARTICIPANTE. Gravar o último que chegar faz um ERROR de um aparelho apagar o
// DELIVERY_ACK de outro. A escada resolve isso sem precisar guardar ack por dispositivo.
//
// `failed` compartilha o posto de `error` de propósito: assim um DELIVERY_ACK atrasado
// ainda consegue curar uma mensagem que o verificador já tinha condenado, e um ERROR
// repetido não reabre o caso.

const RANK: Record<string, number> = {
  pending: 1,
  error: 2,
  failed: 2,
  sent: 3,
  delivered: 4,
  read: 5,
};

const CONFIRMA_ENTREGA = new Set(["delivered", "read"]);

export interface StatusDecision {
  /** true = pode gravar `status` no banco */
  write: boolean;
  /** o status normalizado a gravar; null quando write=false */
  status: string | null;
  /** marca last_error_at, mesmo quando o status não é gravado */
  setLastErrorAt: boolean;
  /** marca delivery_confirmed_at — prova de que chegou a alguém */
  setDeliveryConfirmedAt: boolean;
}

export function statusRank(s: string | null | undefined): number {
  return RANK[String(s ?? "").toLowerCase()] ?? 0;
}

export function decideStatusUpdate(
  current: string | null | undefined,
  incoming: string,
): StatusDecision {
  const novo = String(incoming ?? "").toLowerCase();
  const rankNovo = RANK[novo];

  // Status que a escada não conhece não entra no banco. O código antigo gravava
  // `raw.toLowerCase()` cru, e era assim que lixo do provedor virava status.
  if (rankNovo === undefined) {
    return { write: false, status: null, setLastErrorAt: false, setDeliveryConfirmedAt: false };
  }

  const sobe = rankNovo > statusRank(current);

  return {
    write: sobe,
    status: sobe ? novo : null,
    setLastErrorAt: novo === "error",
    setDeliveryConfirmedAt: sobe && CONFIRMA_ENTREGA.has(novo),
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bun run test -- delivery-status`
Expected: PASS, 12 testes.

- [ ] **Step 5: Checar tipos**

Run: `npx tsc -p tsconfig.app.json --noEmit`
Expected: sem erro. (Nunca use `npx tsc --noEmit` na raiz — o `tsconfig.json` tem `files: []` e sai 0 sempre, sem checar nada.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/delivery-status.ts supabase/functions/_shared/delivery-status.test.ts
git commit -m "feat(whatsapp): escada de status de entrega que não anda para trás"
```

---

### Task 2: Banco — colunas, config, índice, evento e alvo da notificação

Tudo aditivo. Aplicar **primeiro no Docker local**, validar, e só então levar a produção com OK do Alexandre.

**Files:**
- Create: `supabase/migrations/20260803T1200_entrega_confirmada_whatsapp.sql`
- Test: `scripts/sql-tests/entrega-confirmada.sql`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `whatsapp_messages.last_error_at`, `.delivery_confirmed_at`, `.failure_confirmed_at`, `.auto_retry_count`
  - `whatsapp_delivery_config` (linha única, `id` fixo `1`)
  - `notification_event_types` com `key='whatsapp_message_failed'`, `cooldown_minutes=10`
  - `notify_event` passa a entregar in-app aos usuários de `p_metadata->'target_user_ids'` quando a chave existir

- [ ] **Step 1: Reler a definição atual de `notify_event` antes de tocar nela**

Produção muda por fora durante a sessão — já aconteceu com view e RPC deste projeto. Rodar:

```sql
select md5(pg_get_functiondef(p.oid)) as hash_atual, pg_get_functiondef(p.oid) as def
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'notify_event';
```

Guardar o `hash_atual`. Se ele mudar entre esta leitura e o `CREATE OR REPLACE`, **pare** e releia — outra sessão mexeu.

- [ ] **Step 2: Escrever a migration**

Criar `supabase/migrations/20260803T1200_entrega_confirmada_whatsapp.sql`:

```sql
-- Entrega confirmada de mensagem WhatsApp.
-- Aditivo: colunas nulas são operação de catálogo, não reescrevem as 510k linhas de
-- whatsapp_messages (que está na publication supabase_realtime — por isso nada aqui
-- escreve em caminho quente; só o ciclo de falha, ~100 linhas/dia).

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS last_error_at          timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS failure_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS auto_retry_count       smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.whatsapp_messages.last_error_at IS
  'Último ERROR recebido do provedor. Sinal, não veredito: pode existir em mensagem entregue.';
COMMENT ON COLUMN public.whatsapp_messages.delivery_confirmed_at IS
  'Primeira vez que QUALQUER dispositivo ou participante confirmou recebimento. Prova de que chegou.';
COMMENT ON COLUMN public.whatsapp_messages.failure_confirmed_at IS
  'Quando o verificador confirmou a falha. Só ele escreve.';

-- Janela de confirmação. Global, uma linha. Não cabe em configuracoes (é por tenant)
-- nem em cron_estado (guarda execução de cron, não configuração).
-- Fica em banco, e não em constante, porque nesta base subir edge function redeploya
-- todas as 63: ajustar a janela não pode exigir deploy.
CREATE TABLE IF NOT EXISTS public.whatsapp_delivery_config (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  confirm_window_seconds smallint NOT NULL DEFAULT 20 CHECK (confirm_window_seconds BETWEEN 5 AND 300),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.whatsapp_delivery_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_delivery_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_delivery_config_sel ON public.whatsapp_delivery_config;
CREATE POLICY wa_delivery_config_sel ON public.whatsapp_delivery_config
  FOR SELECT TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS wa_delivery_config_upd ON public.whatsapp_delivery_config;
CREATE POLICY wa_delivery_config_upd ON public.whatsapp_delivery_config
  FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Tipo de evento. cooldown_minutes=10 É o agrupamento pedido no desenho: notify_event
-- já segura repetição por (tenant, evento, dedupe_key) dentro do cooldown, e conta as
-- ocorrências em notification_incidents.occurrences. Nenhuma lógica nova de agrupamento.
INSERT INTO public.notification_event_types (key, label, descricao, categoria, default_severity, cooldown_minutes, ativo)
VALUES ('whatsapp_message_failed',
        'Mensagem não entregue',
        'Uma mensagem enviada pelo atendimento não chegou ao cliente, mesmo após reenvio automático.',
        'atendimento', 'warning', 10, true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      descricao = EXCLUDED.descricao,
      cooldown_minutes = EXCLUDED.cooldown_minutes,
      ativo = true;
```

- [ ] **Step 3: Alterar `notify_event` — mesma assinatura, comportamento novo**

Ainda na mesma migration, **colar a definição lida no Step 1** e aplicar exatamente duas mudanças. Não recriar de cabeça: copiar o corpo atual e editar.

Assinatura permanece **idêntica** — `(uuid, text, text, text, text, jsonb, text)`. Não adicionar parâmetro: um parâmetro novo com DEFAULT cria uma **segunda** função e as chamadas existentes passam a dar `function is not unique`. Este projeto já perdeu motor de produção por acidente de assinatura de RPC.

Mudança 1 — antes do `IF NOT EXISTS (SELECT 1 FROM notification_subscriptions ...)`, declarar e carregar os alvos:

```sql
  v_alvos uuid[] := CASE
    WHEN p_metadata ? 'target_user_ids'
      THEN ARRAY(SELECT jsonb_array_elements_text(p_metadata->'target_user_ids')::uuid)
    ELSE NULL
  END;
```

Mudança 2 — o guard de "sem inscritos" e o laço de entrega passam a respeitar os alvos:

```sql
  -- Alvo explícito não depende de inscrição: quem escreveu a mensagem precisa saber
  -- que ela não chegou, esteja inscrito no evento ou não.
  IF v_alvos IS NULL AND NOT EXISTS (
    SELECT 1 FROM notification_subscriptions s
     WHERE s.tenant_id = p_tenant_id AND s.event_type_key = p_event_type AND s.ativo
  ) THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_subscribers', 'incident_id', v_incident_id);
  END IF;
```

e, quando `v_alvos` não é nulo, o laço `FOR v_sub IN ...` é substituído por entrega in-app direta:

```sql
  IF v_alvos IS NOT NULL THEN
    INSERT INTO notification_recipients (tenant_id, notification_id, user_id, delivered_at)
    SELECT p_tenant_id, v_notification_id, u, now()
      FROM unnest(v_alvos) AS u
     WHERE u IS NOT NULL;
    GET DIAGNOSTICS v_in_app = ROW_COUNT;
    -- Sem canal WhatsApp de propósito: avisar por WhatsApp que o WhatsApp falhou é
    -- o mesmo desenho circular do watchdog de instância, já em dívida técnica.
  ELSE
    -- ... laço original, intacto ...
  END IF;
```

- [ ] **Step 4: Aplicar no Docker local e rodar o smoke test**

```bash
./scripts/setup-local-db.sh   # só se o local ainda não estiver de pé
docker exec -i supabase_db_DoctorSaaS psql -U postgres -d postgres \
  < supabase/migrations/20260803T1200_entrega_confirmada_whatsapp.sql
```

Criar `scripts/sql-tests/entrega-confirmada.sql`:

```sql
-- Smoke rollback-safe: o resultado volta pela exception e o rollback é automático.
DO $$
DECLARE
  v_cols int; v_cfg int; v_evt int; v_alvo int; v_tenant uuid; v_user uuid; v_res jsonb;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='whatsapp_messages'
     AND column_name IN ('last_error_at','delivery_confirmed_at','failure_confirmed_at','auto_retry_count');

  SELECT confirm_window_seconds INTO v_cfg FROM whatsapp_delivery_config WHERE id=1;

  SELECT cooldown_minutes INTO v_evt FROM notification_event_types WHERE key='whatsapp_message_failed' AND ativo;

  SELECT tenant_id, user_id INTO v_tenant, v_user FROM profiles WHERE tenant_id IS NOT NULL LIMIT 1;

  -- Alvo explícito precisa entregar mesmo sem ninguém inscrito no evento.
  v_res := notify_event(v_tenant, 'whatsapp_message_failed', 'smoke-conv-1',
                        'Mensagem não entregue', '1 mensagem não chegou',
                        jsonb_build_object('target_user_ids', jsonb_build_array(v_user)), null);

  SELECT count(*) INTO v_alvo FROM notification_recipients
   WHERE notification_id = (v_res->>'notification_id')::uuid AND user_id = v_user;

  RAISE EXCEPTION 'SMOKE_OK|colunas=%|janela=%|cooldown=%|entregue_ao_alvo=%|notify=%',
    v_cols, v_cfg, v_evt, v_alvo, v_res::text;
END $$;
```

Run: `docker exec -i supabase_db_DoctorSaaS psql -U postgres -d postgres < scripts/sql-tests/entrega-confirmada.sql`
Expected: `SMOKE_OK|colunas=4|janela=20|cooldown=10|entregue_ao_alvo=1|notify={"sent": true, ...}`

- [ ] **Step 5: Criar o índice no local (fora da migration)**

`CONCURRENTLY` não roda em transação, então nunca entra em migration.

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_msg_pendente_verificacao
  ON public.whatsapp_messages (last_error_at)
  WHERE status = 'error' AND failure_confirmed_at IS NULL AND delivery_confirmed_at IS NULL;
```

Confirmar que a varredura usa o índice:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id FROM whatsapp_messages
 WHERE status='error' AND failure_confirmed_at IS NULL AND delivery_confirmed_at IS NULL
   AND last_error_at < now() - interval '20 seconds'
 ORDER BY last_error_at LIMIT 50;
```

Expected: `Index Scan using idx_wa_msg_pendente_verificacao`, sem `Seq Scan`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260803T1200_entrega_confirmada_whatsapp.sql scripts/sql-tests/entrega-confirmada.sql
git commit -m "feat(whatsapp): schema da entrega confirmada (colunas, config, evento, alvo em notify_event)"
```

- [ ] **Step 7: Aplicar em produção — PEDIR OK ANTES**

Parar e pedir autorização explícita ao Alexandre. Com o OK: `apply_migration` para a migration, `execute_sql` para o índice, **fora do pico**. Reconferir o hash de `notify_event` (Step 1) imediatamente antes.

---

### Task 3: Os três webhooks passam a usar a escada

**Files:**
- Modify: `supabase/functions/evolution-webhook/index.ts:840-864` (`processMessageUpdate`)
- Modify: `supabase/functions/meta-webhook/index.ts:105-140` (`processStatus`)
- Modify: `supabase/functions/zapi-webhook/index.ts:159-167` (`MessageStatusCallback`)
- Create: `supabase/functions/_shared/apply-delivery-status.ts`

**Interfaces:**
- Consumes: `decideStatusUpdate` da Task 1; colunas da Task 2.
- Produces: `applyDeliveryStatus(supabase, args): Promise<{ changed: boolean; confirmedFailureCandidate: boolean }>` com
  `args: { tenantId: string; messageId: string; providerStatus: string }`.
  `confirmedFailureCandidate` é `true` quando o status virou `error` — é o gatilho do caminho rápido da Task 6.

- [ ] **Step 1: Escrever o teste que falha**

Criar `supabase/functions/_shared/apply-delivery-status.test.ts`, usando o mesmo estilo de mock encadeável de `business-hours.test.ts`:

```ts
// O que este teste protege: o webhook não pode mais gravar status cru. Se ele voltar a
// gravar direto, um ERROR de um aparelho apaga o DELIVERY_ACK de outro.
import { describe, it, expect } from "vitest";
import { applyDeliveryStatus } from "./apply-delivery-status.ts";

function mockSupabase(statusAtual: string | null) {
  const updates: any[] = [];
  const client = {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        maybeSingle: async () => ({ data: statusAtual === null ? null : { status: statusAtual }, error: null }),
        update(payload: any) { updates.push(payload); return { eq() { return this; }, then: (r: any) => r({ error: null }) }; },
      };
    },
  };
  return { client, updates };
}

describe("applyDeliveryStatus", () => {
  it("não grava quando o ack rebaixaria a mensagem", async () => {
    const { client, updates } = mockSupabase("read");
    const r = await applyDeliveryStatus(client as any, { tenantId: "t", messageId: "m", providerStatus: "ERROR" });
    expect(r.changed).toBe(false);
    expect(r.confirmedFailureCandidate).toBe(false);
    // ainda assim registra o sinal para diagnóstico, sem mexer no status
    expect(updates[0]).toHaveProperty("last_error_at");
    expect(updates[0]).not.toHaveProperty("status");
  });

  it("grava error em cima de pending e sinaliza candidato a falha", async () => {
    const { client, updates } = mockSupabase("pending");
    const r = await applyDeliveryStatus(client as any, { tenantId: "t", messageId: "m", providerStatus: "ERROR" });
    expect(r.changed).toBe(true);
    expect(r.confirmedFailureCandidate).toBe(true);
    expect(updates[0].status).toBe("error");
  });

  it("marca delivery_confirmed_at no primeiro ack positivo", async () => {
    const { client, updates } = mockSupabase("sent");
    await applyDeliveryStatus(client as any, { tenantId: "t", messageId: "m", providerStatus: "DELIVERY_ACK" });
    expect(updates[0].status).toBe("delivered");
    expect(updates[0]).toHaveProperty("delivery_confirmed_at");
  });

  it("traduz o vocabulário da Meta: failed vira error", async () => {
    const { client, updates } = mockSupabase("pending");
    const r = await applyDeliveryStatus(client as any, { tenantId: "t", messageId: "m", providerStatus: "failed" });
    expect(updates[0].status).toBe("error");
    expect(r.confirmedFailureCandidate).toBe(true);
  });

  it("mensagem inexistente não explode", async () => {
    const { client } = mockSupabase(null);
    const r = await applyDeliveryStatus(client as any, { tenantId: "t", messageId: "zzz", providerStatus: "READ" });
    expect(r.changed).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `bun run test -- apply-delivery-status`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar o helper**

Criar `supabase/functions/_shared/apply-delivery-status.ts`:

```ts
import { decideStatusUpdate } from "./delivery-status.ts";

// Tradução de cada provedor para o vocabulário único da escada.
// `failed` da Meta e da Z-API entra como `error`: quem promove a `failed` é só o
// verificador, depois de confirmar. Assim os três provedores passam pela mesma garantia.
const PROVIDER_MAP: Record<string, string> = {
  ERROR: "error", failed: "error", FAILED: "error",
  PENDING: "pending",
  SERVER_ACK: "sent", sent: "sent", SENT: "sent",
  DELIVERY_ACK: "delivered", delivered: "delivered", DELIVERED: "delivered",
  READ: "read", PLAYED: "read", read: "read",
};

export interface ApplyResult {
  changed: boolean;
  /** virou `error` agora — dispara o caminho rápido de verificação */
  confirmedFailureCandidate: boolean;
}

export async function applyDeliveryStatus(
  supabase: any,
  args: { tenantId: string; messageId: string; providerStatus: string },
): Promise<ApplyResult> {
  const normalizado = PROVIDER_MAP[args.providerStatus]
    ?? PROVIDER_MAP[String(args.providerStatus).toUpperCase()]
    ?? String(args.providerStatus).toLowerCase();

  const { data: atual } = await supabase
    .from("whatsapp_messages")
    .select("status")
    .eq("tenant_id", args.tenantId)
    .eq("message_id", args.messageId)
    .maybeSingle();

  if (!atual) return { changed: false, confirmedFailureCandidate: false };

  const d = decideStatusUpdate(atual.status, normalizado);
  if (!d.write && !d.setLastErrorAt) return { changed: false, confirmedFailureCandidate: false };

  const agora = new Date().toISOString();
  const payload: Record<string, unknown> = {};
  if (d.write) payload.status = d.status;
  if (d.setLastErrorAt) payload.last_error_at = agora;
  if (d.setDeliveryConfirmedAt) payload.delivery_confirmed_at = agora;

  await supabase.from("whatsapp_messages").update(payload)
    .eq("tenant_id", args.tenantId).eq("message_id", args.messageId);

  return {
    changed: d.write,
    confirmedFailureCandidate: d.write && d.status === "error",
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `bun run test -- apply-delivery-status`
Expected: PASS, 5 testes.

- [ ] **Step 5: Trocar o corpo de `processMessageUpdate` na Evolution**

Em `supabase/functions/evolution-webhook/index.ts`, substituir o `statusMap` e o `update` cru (linhas 846-861) por:

```ts
    for (const update of updates) {
      const messageId = update?.key?.id ?? update?.keyId ?? update?.messageId;
      const statusRaw = update?.update?.status ?? update?.status;
      console.log(`[processMessageUpdate] raw update: ${JSON.stringify(update).substring(0, 300)}`);
      if (!messageId || !statusRaw) {
        console.log(`[processMessageUpdate] SKIP — messageId=${messageId} statusRaw=${statusRaw}`);
        continue;
      }

      const r = await applyDeliveryStatus(supabase, {
        tenantId: resolved.tenantId,
        messageId,
        providerStatus: String(statusRaw),
      });

      if (r.confirmedFailureCandidate) {
        // Caminho rápido: a verificação de 20s começa agora. Fire-and-forget, no mesmo
        // padrão do ai-admin-commands na linha 1021 — o webhook não pode esperar.
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-failed-deliveries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ tenantId: resolved.tenantId, messageId }),
        }).catch((e) => console.error(`${LOG} verify dispatch falhou:`, e?.message));
      }
    }
```

Adicionar no topo do arquivo: `import { applyDeliveryStatus } from '../_shared/apply-delivery-status.ts';`

- [ ] **Step 6: Mesma troca na Meta**

Em `meta-webhook/index.ts`, `processStatus` mantém a gravação de `metadata.send_error` (linhas 115-131 — é a única fonte de motivo que temos) e passa a delegar o status:

```ts
  const r = await applyDeliveryStatus(supabase, {
    tenantId, messageId, providerStatus: statusValue,
  });

  // A Meta é a ÚNICA que diz o motivo da falha. Continua gravando em metadata.send_error,
  // mas não escreve mais `status` — quem decide o status é a escada.
  if (String(statusValue) === 'failed' && Array.isArray(status.errors) && status.errors.length > 0) {
    const e = status.errors[0];
    const sendError = {
      code: e?.code ?? null,
      title: e?.title ?? null,
      message: e?.message ?? null,
      details: e?.error_data?.details ?? null,
      href: e?.href ?? null,
      at: new Date().toISOString(),
    };
    const { data: existing } = await supabase
      .from('whatsapp_messages')
      .select('metadata')
      .eq('tenant_id', tenantId).eq('message_id', messageId)
      .maybeSingle();
    await supabase.from('whatsapp_messages')
      .update({ metadata: { ...(existing?.metadata || {}), send_error: sendError } })
      .eq('tenant_id', tenantId).eq('message_id', messageId);
    console.error(`${LOG} Send FAILED ${messageId}: code=${sendError.code} title=${sendError.title} details=${sendError.details}`);
  }

  if (r.confirmedFailureCandidate) {
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-failed-deliveries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ tenantId, messageId }),
    }).catch((e) => console.error(`${LOG} verify dispatch falhou:`, e?.message));
  }
```

Remover o `updatePayload` e o `update({ status })` que existiam ali — o status agora é do helper.

- [ ] **Step 7: Mesma troca na Z-API**

Em `zapi-webhook/index.ts:159-167`, substituir o bloco inteiro do `MessageStatusCallback` por:

```ts
  if (type === 'MessageStatusCallback') {
    const messageId = payload?.messageId || payload?.id;
    const status = payload?.status;
    if (messageId && status) {
      const r = await applyDeliveryStatus(supabase, {
        tenantId: instance.tenant_id,
        messageId,
        providerStatus: String(status),
      });
      if (r.confirmedFailureCandidate) {
        fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/verify-failed-deliveries`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          },
          body: JSON.stringify({ tenantId: instance.tenant_id, messageId }),
        }).catch((e) => console.error(`${LOG} verify dispatch falhou:`, e?.message));
      }
    }
    return;
  }
```

Adicionar `import { applyDeliveryStatus } from '../_shared/apply-delivery-status.ts';` no topo de `meta-webhook/index.ts` e de `zapi-webhook/index.ts`.

- [ ] **Step 8: Tipos e testes**

Run: `bun run test && npx tsc -p tsconfig.app.json --noEmit`
Expected: tudo passa.

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/_shared/apply-delivery-status.ts supabase/functions/_shared/apply-delivery-status.test.ts supabase/functions/evolution-webhook/index.ts supabase/functions/meta-webhook/index.ts supabase/functions/zapi-webhook/index.ts
git commit -m "feat(whatsapp): webhooks param de gravar status cru e passam pela escada"
```

---

### Task 4: `send-whatsapp-message` grava `pending`

Sem isto, a Task 3 não serve para nada: a mensagem já nasceria `sent` (rank 3) e nenhum `ERROR` (rank 2) conseguiria entrar.

**Files:**
- Modify: `supabase/functions/send-whatsapp-message/index.ts:552`, `:613`, `:754`

**Interfaces:**
- Consumes: colunas da Task 2.
- Produces: mensagens nascem com `status='pending'`; o `SERVER_ACK` do provedor promove a `sent`.

- [ ] **Step 1: Trocar os três pontos**

Nos três, trocar `status: 'sent',` por:

```ts
          // 'pending' = entreguei ao provedor. Quem promove a 'sent' é o SERVER_ACK do
          // WhatsApp. Antes isto nascia 'sent' e a escada impediria qualquer ERROR de
          // entrar — a mensagem falhada ficaria eternamente "enviada".
          status: 'pending',
```

Conferir que são exatamente 3: `grep -n "status: 'sent'" supabase/functions/send-whatsapp-message/index.ts` deve voltar vazio depois da troca.

- [ ] **Step 2: Conferir que nada mais no repo depende de `status='sent'` no insert**

Run: `grep -rn "status.*===.*'sent'\|eq('status', 'sent')\|status='sent'" src/ supabase/functions/`
Expected: nenhuma leitura que trate `sent` como "acabou de sair". Se aparecer alguma, tratar antes de seguir e registrar aqui o que foi encontrado.

- [ ] **Step 3: Conferir o visual**

`pending` não aparece em nenhum ramo do `statusIcon` (`MessageBubble.tsx:147-157`), então cai no `else` da linha 154 e desenha o mesmo ✓ cinza de hoje. Confirmar lendo o arquivo — não presumir.

- [ ] **Step 4: Testar no local**

Com `.env.local` apontando para o Docker, `bun run dev`, enviar uma mensagem e confirmar no banco:

```sql
select status, last_error_at, delivery_confirmed_at from whatsapp_messages order by created_at desc limit 1;
```

Expected: `pending` no instante do envio, virando `sent` quando o ack chegar.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/send-whatsapp-message/index.ts
git commit -m "feat(whatsapp): mensagem nasce pending; SERVER_ACK é que promove a sent"
```

---

### Task 5: Extrair o envio de `resend-failed-message`

O verificador precisa reenviar. A lógica de reenvio já existe, mas está trancada dentro de um handler HTTP que exige JWT de usuário.

**Files:**
- Create: `supabase/functions/_shared/resend-message.ts`
- Modify: `supabase/functions/resend-failed-message/index.ts:86-175`

**Interfaces:**
- Consumes: `getAdapter`, `getInstanceSecrets` de `_shared/providers/index.ts`.
- Produces:
  - `resendMessage(supabase, msg, opts): Promise<ResendOutcome>`
  - `interface ResendOutcome { ok: boolean; newMessageId?: string; error?: string }`
  - `opts: { actorUserId: string | null; automatic: boolean }`

- [ ] **Step 1: Extrair, sem mudar comportamento**

Criar `supabase/functions/_shared/resend-message.ts` com o miolo das linhas 86-175 do handler: resolver conversa e destino, resolver instância e segredos, assinar URL de mídia quando não for texto, chamar `adapter.send`, e atualizar a linha da mensagem.

Duas diferenças em relação ao original, e só duas:

```ts
  // 1. Reenvio automático volta para 'pending', não 'sent' — quem promove é o ack.
  //    Reenvio manual mantém o comportamento antigo.
  const novoStatus = opts.automatic ? 'pending' : 'sent';

  // 2. O ciclo recomeça limpo: o veredito anterior não pode contaminar a tentativa nova.
  const patch: Record<string, unknown> = {
    status: novoStatus,
    message_id: newMessageId,
    timestamp: nowIso,
    last_error_at: null,
    failure_confirmed_at: null,
    metadata: { ...newMeta, last_retry_error: null },
  };
  if (opts.automatic) patch.auto_retry_count = 1;
```

- [ ] **Step 2: `resend-failed-message` passa a chamar o compartilhado**

O handler mantém autenticação, permissão, `MAX_RETRIES = 3` e `COOLDOWN_SECONDS = 60`, e delega o envio:

```ts
    const outcome = await resendMessage(supabase, msg, { actorUserId: authUser.id, automatic: false });
    if (!outcome.ok) return jsonError(outcome.error ?? 'Falha ao reenviar', 502);
```

- [ ] **Step 3: Aceitar `failed` e `error`**

Trocar a linha 53:

```ts
    // 'failed' é o veredito do verificador. 'error' é o sinal cru, que ainda pode
    // aparecer aqui em mensagem antiga, anterior a este fluxo — o operador continua
    // podendo reenviar à mão.
    if (msg.status !== 'failed' && msg.status !== 'error') {
      return jsonError('Apenas mensagens com falha podem ser reenviadas', 400);
    }
```

- [ ] **Step 4: Testar no local**

Forçar uma mensagem para `failed` no Docker e clicar em Reenviar na tela:

```sql
update whatsapp_messages set status='failed' where id='<uuid de teste>';
```

Expected: botão aparece, reenvio funciona, status volta para `sent`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/resend-message.ts supabase/functions/resend-failed-message/index.ts
git commit -m "refactor(whatsapp): envio do reenvio sai para _shared e aceita status error"
```

---

### Task 6: `verify-failed-deliveries`

A peça que fabrica a garantia.

**Files:**
- Create: `supabase/functions/verify-failed-deliveries/index.ts`
- Modify: `cron.job` (via SQL, não versionado)

**Interfaces:**
- Consumes: `resendMessage` (Task 5), colunas e `notify_event` (Task 2).
- Produces: endpoint `POST /verify-failed-deliveries`, dois modos:
  - `{ tenantId, messageId }` — alvo, vindo do webhook
  - `{}` — varredura, vinda do cron

- [ ] **Step 1: Implementar**

Criar `supabase/functions/verify-failed-deliveries/index.ts`:

```ts
// Fabrica a garantia de que a mensagem NÃO chegou.
//
// O ERROR sozinho não serve de prova: os acks do WhatsApp vêm por dispositivo e, em
// grupo, por participante. Um ERROR pode ser 1 de 40 destinatários. Por isso a falha só
// é declarada quando as TRÊS condições valem ao mesmo tempo, e nunca antes da janela.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';
import { resendMessage } from '../_shared/resend-message.ts';

const LOG = '[verify-failed-deliveries]';
const LOTE_VARREDURA = 50;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function janelaSegundos(supabase: any): Promise<number> {
  const { data } = await supabase.from('whatsapp_delivery_config')
    .select('confirm_window_seconds').eq('id', 1).maybeSingle();
  return data?.confirm_window_seconds ?? 20;
}

/**
 * Segunda fonte: a própria Evolution guarda o status da mensagem no store dela.
 * Só serve para RESGATAR — se ela disser que entregou, abortamos o alarme.
 * Se estiver fora do ar, seguimos: o ERROR do provedor continua sendo uma afirmação
 * explícita de falha, e a indisponibilidade da segunda fonte não a torna menos verdadeira.
 */
async function provedorRegistraEntrega(supabase: any, msg: any): Promise<boolean> {
  const { data: inst } = await supabase.from('whatsapp_instances')
    .select('id, instance_name, provider_type').eq('id', msg.instance_id).maybeSingle();
  if (!inst || inst.provider_type !== 'self_hosted') return false;

  try {
    const secrets = await getInstanceSecrets(supabase, inst.id);
    if (!secrets?.api_url || !secrets?.api_key) return false;
    const base = String(secrets.api_url).replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/findMessages/${inst.instance_name}`, {
      method: 'POST',
      headers: { apikey: secrets.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ where: { key: { id: msg.message_id } } }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const st = String((await res.json())?.messages?.records?.[0]?.status ?? '').toUpperCase();
    return st === 'DELIVERY_ACK' || st === 'READ' || st === 'PLAYED';
  } catch (e) {
    console.warn(`${LOG} segunda fonte indisponível para ${msg.message_id}: ${(e as Error)?.message}`);
    return false;
  }
}

async function avisar(supabase: any, msg: any) {
  const { data: conv } = await supabase.from('whatsapp_conversations')
    .select('id, assigned_to, department_id').eq('id', msg.conversation_id).maybeSingle();

  let alvos: string[] = [];
  if (msg.sent_by_user_id) alvos = [msg.sent_by_user_id];
  else if (conv?.assigned_to) alvos = [conv.assigned_to];
  else if (conv?.department_id) {
    const { data: membros } = await supabase.from('support_department_members')
      .select('user_id').eq('tenant_id', msg.tenant_id)
      .eq('department_id', conv.department_id).eq('is_active', true);
    alvos = (membros ?? []).map((m: any) => m.user_id).filter(Boolean);
  }
  if (alvos.length === 0) {
    console.warn(`${LOG} sem destinatário para msg=${msg.id}; alarme fica só na bolha`);
    return;
  }

  // dedupe_key = conversa. Com cooldown_minutes=10 no tipo do evento, isso É o
  // agrupamento: 1 notificação por conversa a cada 10 min, e o contador sai de
  // notification_incidents.occurrences. Sem isso, a queda de uma instância vira 17
  // pings seguidos e o agente desliga a notificação na terceira.
  await supabase.rpc('notify_event', {
    p_tenant_id: msg.tenant_id,
    p_event_type: 'whatsapp_message_failed',
    p_dedupe_key: `conv:${msg.conversation_id}`,
    p_title: 'Mensagem não entregue',
    p_body: 'Uma mensagem não chegou ao cliente, mesmo após o reenvio automático. Abra a conversa para reenviar.',
    p_metadata: {
      target_user_ids: alvos,
      conversation_id: msg.conversation_id,
      message_id: msg.id,
    },
    p_action_url: `/whatsapp?conversation=${msg.conversation_id}`,
  });
}

async function verificar(supabase: any, msg: any): Promise<string> {
  // Condições 1 e 3: nada de ack positivo, e nunca chegou a `sent`.
  if (msg.status !== 'error') return 'subiu-na-escada';
  if (msg.delivery_confirmed_at) return 'entregue';

  // Condição 2: a segunda fonte não contradiz.
  if (await provedorRegistraEntrega(supabase, msg)) {
    await supabase.from('whatsapp_messages')
      .update({ status: 'delivered', delivery_confirmed_at: new Date().toISOString() })
      .eq('id', msg.id);
    return 'resgatada-pela-segunda-fonte';
  }

  await supabase.from('whatsapp_messages')
    .update({ failure_confirmed_at: new Date().toISOString() }).eq('id', msg.id);

  if ((msg.auto_retry_count ?? 0) === 0) {
    const out = await resendMessage(supabase, msg, { actorUserId: null, automatic: true });
    if (out.ok) return 'reenviada-automaticamente';
    console.error(`${LOG} reenvio automático falhou msg=${msg.id}: ${out.error}`);
  }

  await supabase.from('whatsapp_messages').update({
    status: 'failed',
    metadata: {
      ...(msg.metadata ?? {}),
      send_error: {
        origem: 'verify-failed-deliveries',
        motivo: 'sem confirmação de entrega após a janela e após reenvio automático',
        at: new Date().toISOString(),
      },
    },
  }).eq('id', msg.id);

  await avisar(supabase, msg);
  return 'falha-confirmada';
}

const CAMPOS = 'id, tenant_id, conversation_id, instance_id, message_id, content, message_type, media_path, media_mimetype, media_filename, media_kind, status, is_from_me, metadata, remote_jid, sent_by_user_id, last_error_at, delivery_confirmed_at, failure_confirmed_at, auto_retry_count';

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* varredura do cron manda corpo vazio */ }

  const janela = await janelaSegundos(supabase);

  if (body?.messageId) {
    // Modo alvo: espera o que falta da janela e verifica uma mensagem só.
    const { data: msg } = await supabase.from('whatsapp_messages').select(CAMPOS)
      .eq('tenant_id', body.tenantId).eq('message_id', body.messageId).maybeSingle();
    if (!msg) return new Response(JSON.stringify({ ok: true, reason: 'not_found' }), { status: 200 });

    const desde = msg.last_error_at ? Date.now() - Date.parse(msg.last_error_at) : 0;
    const faltam = Math.max(0, janela * 1000 - desde);
    if (faltam > 0) await sleep(faltam);

    // Reler DEPOIS da espera: nesses 20s pode ter chegado o ack de outro dispositivo,
    // e é exatamente essa releitura que impede o alarme falso.
    const { data: fresca } = await supabase.from('whatsapp_messages').select(CAMPOS).eq('id', msg.id).maybeSingle();
    if (!fresca) return new Response(JSON.stringify({ ok: true, reason: 'apagada' }), { status: 200 });
    const r = await verificar(supabase, fresca);
    console.log(`${LOG} alvo ${msg.message_id} -> ${r}`);
    return new Response(JSON.stringify({ ok: true, result: r }), { status: 200 });
  }

  // Modo varredura: rede de segurança para o que o caminho rápido perdeu — isolate
  // morto, webhook perdido, deploy no meio. É justamente o caso que este fluxo existe
  // para pegar; não pode depender de um único caminho.
  const { data: pendentes } = await supabase.from('whatsapp_messages').select(CAMPOS)
    .eq('status', 'error')
    .is('failure_confirmed_at', null)
    .is('delivery_confirmed_at', null)
    .lt('last_error_at', new Date(Date.now() - janela * 1000).toISOString())
    .order('last_error_at', { ascending: true })
    .limit(LOTE_VARREDURA);

  const resultados: Record<string, number> = {};
  for (const msg of pendentes ?? []) {
    const r = await verificar(supabase, msg);
    resultados[r] = (resultados[r] ?? 0) + 1;
  }
  console.log(`${LOG} varredura: ${JSON.stringify(resultados)} de ${(pendentes ?? []).length}`);
  return new Response(JSON.stringify({ ok: true, resultados }), { status: 200 });
});
```

- [ ] **Step 2: Testar no Docker local**

O stack local não tem edge runtime; subir com `supabase functions serve verify-failed-deliveries`.

Preparar o caso e chamar em modo varredura:

```sql
update whatsapp_messages
   set status='error', last_error_at = now() - interval '60 seconds',
       failure_confirmed_at = null, delivery_confirmed_at = null, auto_retry_count = 1
 where id = '<uuid de teste>';
```

`auto_retry_count = 1` pula o reenvio e vai direto ao veredito — é o caminho que a gente quer ver primeiro.

```bash
curl -s -X POST http://localhost:54321/functions/v1/verify-failed-deliveries \
  -H "Authorization: Bearer $SERVICE_ROLE_LOCAL" -H 'Content-Type: application/json' -d '{}'
```

Expected: `{"ok":true,"resultados":{"falha-confirmada":1}}`, a mensagem em `failed`, e uma linha em `notification_recipients` para o autor.

- [ ] **Step 3: Testar a auto-cura**

```sql
update whatsapp_messages set status='error', delivery_confirmed_at = now() where id = '<uuid de teste>';
```

Chamar de novo. Expected: `{"entregue":1}`, e a mensagem **não** vira `failed`.

- [ ] **Step 4: Testar o agrupamento**

Marcar 5 mensagens da mesma conversa como acima e rodar a varredura.
Expected: 5 mensagens em `failed`, **1** linha em `notifications`, e `notification_incidents.occurrences = 5`.

- [ ] **Step 5: Confirmar que a notificação aparece no sino — e só então declarar que o front não muda**

A spec assumiu que nenhuma mudança de frontend seria necessária, mas deixou isso explicitamente
por confirmar. Confirmar agora, no Docker local, com o app aberto no usuário que escreveu a
mensagem: o sino tem que mostrar "Mensagem não entregue" e o clique tem que abrir a conversa
pela `action_url`.

Se o sino tiver mapa de ícone ou label por `type` no front, achar com:

```bash
grep -rn "whatsapp_instance_disconnected\|notification.type\|severity" src/components/NotificationBell.tsx src/contexts/NotificationContext.tsx | head -20
```

Se houver mapa, acrescentar `whatsapp_message_failed` a ele — é uma linha. Se for orientado a
dados, não mexer em nada. **Não presumir: abrir o arquivo e olhar.**

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/verify-failed-deliveries/index.ts
git commit -m "feat(whatsapp): verificador que confirma a falha antes de avisar"
```

- [ ] **Step 7: Agendar o cron em produção — PEDIR OK ANTES**

Copiar o cabeçalho de autorização do job existente, **sem digitar a service_role key em lugar nenhum**:

```sql
select command from cron.job where jobid = 57;  -- watchdog-instance-silence
```

Usar o mesmo `headers` daquele comando, trocando só a URL para `.../functions/v1/verify-failed-deliveries` e o corpo para `{}`:

```sql
select cron.schedule('verify-failed-deliveries', '* * * * *', $$ ... $$);
```

A chave nunca entra em arquivo do repositório.

---

### Task 7: Validação ponta a ponta e publicação

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Rodar a suíte inteira**

Run: `bun run test && npx tsc -p tsconfig.app.json --noEmit && bun run build`
Expected: tudo verde.

- [ ] **Step 2: Auditar repo × produção antes de qualquer push**

Isto toca 6 edge functions e o workflow redeploya **todas as 63**. Qualquer função atrasada em relação a produção reverte produção no push. A última auditoria foi 27/07 — refazer, baixando as funções de produção para um diretório isolado e comparando com o HEAD. Não pular.

- [ ] **Step 3: Push, com liberação do Alexandre**

Ele libera o push. Acompanhar o Actions até o fim.

- [ ] **Step 4: Validar em produção com caso real**

Enquanto a instância `DoctorSaaS_1733` estiver com a conta restrita, ela é um gerador de falha reproduzível, com número do próprio owner e sem tocar em cliente. Enviar uma mensagem por ela e conferir a sequência no banco:

```sql
select status, last_error_at, failure_confirmed_at, auto_retry_count,
       metadata->'send_error' as motivo
  from whatsapp_messages
 where instance_id = (select id from whatsapp_instances where instance_name='DoctorSaaS_1733')
 order by created_at desc limit 3;
```

Expected: `pending` → `error` → (reenvio automático, `auto_retry_count=1`) → `failed` com motivo, em menos de 1 minuto, e notificação in-app para o autor.

Se a 1733 já tiver sido substituída, reproduzir no Docker local pelo caminho da Task 6.

- [ ] **Step 5: Registrar no CHANGELOG**

Uma linha, em linguagem de cliente, no dia da publicação:

```markdown
- 🔧 Mensagem que não chega ao cliente agora é reenviada automaticamente e, se falhar de novo, aparece marcada em vermelho com aviso para quem escreveu — antes ela era exibida como enviada.
```

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): aviso de mensagem não entregue"
```
