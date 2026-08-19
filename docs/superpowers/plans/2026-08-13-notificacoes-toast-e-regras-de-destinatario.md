# Toast de notificação e regras de destinatário — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar o toast num sistema só, com agrupamento e clique que abre a conversa, e fazer o motor de notificação avisar a pessoa certa nas 6 situações da spec.

**Architecture:** O frontend passa a ter um único toaster (Sonner); o `use-toast` do shadcn vira um shim sobre ele para não quebrar os 48 arquivos que o importam. No banco, quatro mudanças independentes: o padrão de escopo de admin/head com guarda de último recurso, e três produtores novos de notificação (motor de distribuição, cron de espera, triggers de ticket e jornada). Toda notificação nova passa por um helper único `fn_notify_user`.

**Tech Stack:** React 18 + Vite + TypeScript + Tailwind · Sonner 1.7.4 · Vitest · Supabase Postgres (plpgsql, pg_cron)

## Global Constraints

- **Spec de referência:** `docs/superpowers/specs/2026-08-13-notificacoes-toast-e-regras-de-destinatario-design.md`. Em conflito, a spec vence.
- **Nada é aplicado em produção sem OK explícito do Alexandre.** Todo SQL é validado no Docker local primeiro (`docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres`). Aplicação em prod é via `apply_migration`, uma migration por vez, só depois do aval.
- **Antes de todo `CREATE OR REPLACE`, reler o corpo vivo de produção** (`SELECT md5(pg_get_functiondef(...))`) e mesclar sobre ele. Produção muda durante a sessão; sobrescrever com uma cópia velha já causou perda de trabalho neste projeto.
- **`supabase db push` e `db reset` são proibidos.** As migrations não são a fonte de verdade do schema.
- **React Testing Library não funciona neste repo** (falta o peer `@testing-library/dom`). Testes de componente usam `createRoot` + `act`, com `IS_REACT_ACT_ENVIRONMENT = true`. Ver `src/pages/onboarding/ImplantacaoBoard.test.tsx`.
- **Typecheck é `bunx tsc -p tsconfig.app.json`** — o `tsconfig.json` da raiz não checa nada.
- Testes JS: `bun run test`. Testes SQL: `scripts/sql-tests/NN_nome.sql`, com `BEGIN` … `ROLLBACK`, rodados via docker exec.
- Toda RPC nova: `SECURITY DEFINER` + `SET search_path = public` + `REVOKE ALL FROM PUBLIC` + `GRANT` só a quem precisa. Função nova nasce aberta para `authenticated` — revogar explicitamente.
- Timezone `America/Sao_Paulo`. Mensagens de UI em pt-BR.
- **Não usar `git add -A`** — há trabalho de outras sessões no stage. Sempre adicionar os arquivos por caminho.

---

### Task 1: `use-toast` vira shim do Sonner e o toaster do shadcn sai

Hoje `src/components/AppToasters.tsx` monta dois sistemas de toast no mesmo canto. Não dá para simplesmente remover o do shadcn: **48 arquivos importam `@/hooks/use-toast`** e os avisos deles sumiriam em silêncio. A superfície que esses arquivos usam é pequena — medida no repo: `title`, `description` e `variant: "destructive"`. Nenhum arquivo usa `action`, `dismiss()` ou o array `toasts` fora do próprio `toaster.tsx`.

**Files:**
- Modify: `src/hooks/use-toast.ts` (substituição completa)
- Modify: `src/components/AppToasters.tsx`
- Test: `src/hooks/use-toast.test.ts` (criar)

**Interfaces:**
- Consumes: nada.
- Produces: `toast({ title?, description?, variant? })` e `useToast(): { toast, dismiss }` — mesma assinatura de hoje, agora sobre o Sonner. `dismiss(id?: string | number): void`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/hooks/use-toast.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const sonnerToast = vi.fn() as unknown as ReturnType<typeof vi.fn> & {
  error: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
};
sonnerToast.error = vi.fn();
sonnerToast.dismiss = vi.fn();

vi.mock("sonner", () => ({ toast: sonnerToast }));

import { toast, useToast } from "./use-toast";

describe("use-toast como shim do Sonner", () => {
  beforeEach(() => {
    sonnerToast.mockClear();
    sonnerToast.error.mockClear();
    sonnerToast.dismiss.mockClear();
  });

  it("aviso comum vai para o toast padrão, com a descrição", () => {
    toast({ title: "Salvo", description: "Contrato atualizado" });
    expect(sonnerToast).toHaveBeenCalledWith("Salvo", {
      description: "Contrato atualizado",
    });
    expect(sonnerToast.error).not.toHaveBeenCalled();
  });

  it('variant "destructive" vira toast de erro', () => {
    toast({ title: "Falhou", description: "Tente de novo", variant: "destructive" });
    expect(sonnerToast.error).toHaveBeenCalledWith("Falhou", {
      description: "Tente de novo",
    });
  });

  it("aceita só description, sem title", () => {
    toast({ description: "Sem título" });
    expect(sonnerToast).toHaveBeenCalledWith("Sem título", { description: undefined });
  });

  it("useToast devolve o mesmo toast e um dismiss", () => {
    const api = useToast();
    api.toast({ title: "Oi" });
    expect(sonnerToast).toHaveBeenCalledWith("Oi", { description: undefined });
    api.dismiss("abc");
    expect(sonnerToast.dismiss).toHaveBeenCalledWith("abc");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bun run test src/hooks/use-toast.test.ts`
Expected: FAIL — o `use-toast.ts` atual usa reducer próprio e não chama o Sonner.

- [ ] **Step 3: Substituir `src/hooks/use-toast.ts` pelo shim**

Conteúdo completo do arquivo:

```ts
import { toast as sonnerToast } from "sonner";

/**
 * Shim: `use-toast` do shadcn reescrito sobre o Sonner (13/08/2026).
 *
 * O projeto tinha DOIS toasters montados no mesmo canto — o do Radix e o do
 * Sonner. Em vez de migrar os 48 arquivos que importam este hook, o hook passa a
 * delegar: quem chama continua escrevendo `toast({ title, description, variant })`
 * e o aviso sai pelo Sonner, com empilhamento e limite únicos.
 *
 * Superfície medida no repo antes da troca: title, description e
 * variant="destructive". Ninguém usa `action`, `dismiss()` ou o array `toasts`.
 */
export type ToastVariant = "default" | "destructive";

export type ToastInput = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: ToastVariant;
  duration?: number;
};

function textOf(node: React.ReactNode): string {
  return typeof node === "string" || typeof node === "number" ? String(node) : "";
}

export function toast({ title, description, variant, duration }: ToastInput) {
  // Sem título, a descrição vira o texto principal — o Sonner não renderiza
  // um toast só com `description`.
  const message = title !== undefined ? title : description;
  const opts: { description?: React.ReactNode; duration?: number } = {
    description: title !== undefined ? description : undefined,
  };
  if (duration !== undefined) opts.duration = duration;

  return variant === "destructive"
    ? sonnerToast.error(textOf(message) || message, opts)
    : sonnerToast(textOf(message) || message, opts);
}

export function useToast() {
  return {
    toast,
    dismiss: (id?: string | number) => sonnerToast.dismiss(id),
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bun run test src/hooks/use-toast.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Tirar o toaster do shadcn de `AppToasters.tsx`**

Conteúdo completo do arquivo:

```tsx
import { useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";

/**
 * Toasts no canto inferior direito em todas as telas.
 *
 * Desde 13/08/2026 existe UM toaster só: o `use-toast` do shadcn virou shim do
 * Sonner (ver src/hooks/use-toast.ts), então o viewport do Radix saiu daqui.
 *
 * Exceção: a tela do chat tem o composer fixo no rodapé — lá o toast sobe
 * ~9rem para não cair em cima do campo de digitar a mensagem.
 */
const CHAT_PATH = "/whatsapp";

export default function AppToasters() {
  const { pathname } = useLocation();
  const isChat = pathname === CHAT_PATH;

  return <Sonner offset={isChat ? { bottom: "9rem" } : undefined} />;
}
```

- [ ] **Step 6: Typecheck, build e suíte inteira**

Run: `bunx tsc -p tsconfig.app.json && bun run test && bun run build`
Expected: os três passam. O typecheck é o que pega qualquer arquivo dos 48 usando uma propriedade que o shim não tem.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-toast.ts src/hooks/use-toast.test.ts src/components/AppToasters.tsx
git commit -m "refactor(ui): um toaster so — use-toast passa a delegar ao Sonner"
```

---

### Task 2: Toast do chat — agrupado, com limite e clique que abre a conversa

O Sonner 1.7.4 **não tem `onClick` no corpo do toast** — conferido no `.d.ts` instalado: só `action.onClick`, que é um botão. Para o clique no corpo abrir a conversa, o toast de chat é renderizado com `toast.custom()`, que recebe JSX próprio.

O agrupamento vem de graça do banco: `process_notification_dispatch_queue` já atualiza a mesma notificação e incrementa `metadata.unread_count` quando chegam mensagens seguidas da mesma conversa. Basta o toast usar um `id` estável por conversa — o Sonner substitui o conteúdo em vez de empilhar.

**Files:**
- Create: `src/components/notifications/ChatToast.tsx`
- Create: `src/components/notifications/ChatToast.test.tsx`
- Modify: `src/components/ui/sonner.tsx` (adicionar `visibleToasts`)
- Modify: `src/contexts/NotificationContext.tsx:282-308` (bloco `if (wantsToast)`)

**Interfaces:**
- Consumes: `toast` do Sonner (Task 1 não mexe nele).
- Produces: `ChatToast({ title, body, unreadCount, onOpen, onDismiss })` — componente puro, sem acesso a rede.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/notifications/ChatToast.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatToast } from "./ChatToast";

/** Sem @testing-library/react: o peer @testing-library/dom não está instalado. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ChatToast", () => {
  it("mostra o contato e a prévia da mensagem", () => {
    act(() => {
      root.render(
        <ChatToast title="João Silva · Financeiro" body="Bom dia, preciso de ajuda" onOpen={() => {}} onDismiss={() => {}} />,
      );
    });
    expect(container.textContent).toContain("João Silva · Financeiro");
    expect(container.textContent).toContain("Bom dia, preciso de ajuda");
  });

  it("com mais de uma mensagem, troca a prévia pelo contador", () => {
    act(() => {
      root.render(
        <ChatToast title="João Silva" body="terceira" unreadCount={3} onOpen={() => {}} onDismiss={() => {}} />,
      );
    });
    expect(container.textContent).toContain("3 mensagens");
  });

  it("com uma mensagem só, não mostra contador", () => {
    act(() => {
      root.render(<ChatToast title="João" body="oi" unreadCount={1} onOpen={() => {}} onDismiss={() => {}} />);
    });
    expect(container.textContent).not.toContain("mensagens");
  });

  it("clique no corpo chama onOpen", () => {
    const onOpen = vi.fn();
    act(() => {
      root.render(<ChatToast title="João" body="oi" onOpen={onOpen} onDismiss={() => {}} />);
    });
    const corpo = container.querySelector<HTMLElement>('[data-testid="chat-toast-body"]')!;
    act(() => corpo.click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("clique no X fecha sem abrir a conversa", () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    act(() => {
      root.render(<ChatToast title="João" body="oi" onOpen={onOpen} onDismiss={onDismiss} />);
    });
    const fechar = container.querySelector<HTMLElement>('[data-testid="chat-toast-close"]')!;
    act(() => fechar.click());
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bun run test src/components/notifications/ChatToast.test.tsx`
Expected: FAIL — "Failed to resolve import ./ChatToast".

- [ ] **Step 3: Criar `src/components/notifications/ChatToast.tsx`**

```tsx
import { X } from "lucide-react";

/**
 * Toast de mensagem de chat, no estilo do WhatsApp: contato em cima, prévia
 * embaixo, clique em qualquer lugar abre a conversa.
 *
 * Existe como componente próprio porque o Sonner 1.7.4 não expõe onClick no
 * corpo do toast — só no botão de ação. Renderizado via `toast.custom()`.
 */
export type ChatToastProps = {
  title: string;
  body: string;
  unreadCount?: number;
  onOpen: () => void;
  onDismiss: () => void;
};

export function ChatToast({ title, body, unreadCount, onOpen, onDismiss }: ChatToastProps) {
  const agrupado = (unreadCount ?? 1) > 1;

  return (
    <div className="relative flex w-full items-start gap-3 rounded-md border border-border bg-background p-4 pr-10 shadow-lg">
      <button
        type="button"
        data-testid="chat-toast-body"
        onClick={onOpen}
        className="flex-1 text-left transition-opacity hover:opacity-80"
      >
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
          {agrupado ? `${unreadCount} mensagens` : body}
        </p>
      </button>
      <button
        type="button"
        data-testid="chat-toast-close"
        aria-label="Dispensar"
        onClick={onDismiss}
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export default ChatToast;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bun run test src/components/notifications/ChatToast.test.tsx`
Expected: PASS, 5 testes.

- [ ] **Step 5: Limitar a 3 toasts na tela**

Em `src/components/ui/sonner.tsx`, no elemento `<Sonner ...>`, adicionar a prop logo depois de `duration={5000}`:

```tsx
      duration={5000}
      visibleToasts={3}
```

- [ ] **Step 6: Ligar o `ChatToast` no `NotificationContext`**

Em `src/contexts/NotificationContext.tsx`, adicionar o import junto dos demais no topo:

```ts
import { ChatToast } from "@/components/notifications/ChatToast";
```

E substituir o bloco `if (wantsToast) { ... }` inteiro (hoje nas linhas 282-308) por:

```tsx
      if (wantsToast) {
        const abrir = () => {
          if (notif.action_url) navigate(notif.action_url);
          supabase
            .rpc("mark_notification_read" as any, { p_recipient_id: recipient.id })
            .then(() => {
              setUnreadCount((c) => Math.max(0, c - 1));
              queryClient.invalidateQueries({ queryKey: ["notifications-list"] });
              queryClient.invalidateQueries({ queryKey: ["notifications-unread-count"] });
            });
        };

        // id estável por conversa: a 2ª mensagem da mesma conversa ATUALIZA o
        // toast em vez de empilhar. O banco já coalesce e manda unread_count.
        const toastId = notifConvId ? `conv-${notifConvId}` : `notif-${notif.id}`;

        sonnerToast.custom(
          (id) => (
            <ChatToast
              title={notif.title}
              body={notif.body || ""}
              unreadCount={Number((notif.metadata as any)?.unread_count ?? 1)}
              onOpen={() => {
                sonnerToast.dismiss(id);
                abrir();
              }}
              onDismiss={() => sonnerToast.dismiss(id)}
            />
          ),
          { id: toastId, duration: 5000 },
        );
      }
```

- [ ] **Step 7: Rodar suíte, typecheck e build**

Run: `bun run test && bunx tsc -p tsconfig.app.json && bun run build`
Expected: os três passam. `NotificationContext.tsx` precisa continuar como `.tsx` — já é.

- [ ] **Step 8: Commit**

```bash
git add src/components/notifications/ChatToast.tsx src/components/notifications/ChatToast.test.tsx src/components/ui/sonner.tsx src/contexts/NotificationContext.tsx
git commit -m "feat(notificacoes): toast do chat agrupa por conversa, limita a 3 e abre no clique"
```

---

### Task 3: Escopo padrão de admin/head + guarda de último recurso

Uma migration só, porque as duas partes **não podem subir separadas**: o padrão sem a guarda deixa 16 setores mudos.

A função a alterar é `public.get_message_notification_recipients_v2(uuid)`. Ela tem duas etapas: a operacional (`silent_mode = false`) e a de monitores (`silent_mode = true`). A mudança é só na primeira.

**Files:**
- Create: `supabase/migrations/20260813120000_escopo_padrao_admin_head_com_guarda.sql`
- Create: `scripts/sql-tests/35_escopo_admin_head_e_guarda.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `get_message_notification_recipients_v2(p_conversation_id uuid) RETURNS TABLE(user_id uuid, silent_mode boolean)` — assinatura **inalterada**.

**Risco latente registrado, fora do escopo desta entrega:** `user_preferences` não tem
constraint unique em `user_id` — só PK em `id`. Hoje são 47 linhas para 47 usuários, sem
duplicata, então o `LEFT JOIN user_preferences` da função não multiplica linhas. Se um dia
entrar linha duplicada, **todo destinatário é contado duas vezes**. Não corrigir aqui; anotar
para o Alexandre decidir se vira entrega própria.

- [ ] **Step 1: Reler o corpo vivo em produção antes de escrever**

```sql
SELECT md5(pg_get_functiondef('public.get_message_notification_recipients_v2(uuid)'::regprocedure)) AS hash_antes,
       pg_get_functiondef('public.get_message_notification_recipients_v2(uuid)'::regprocedure) AS corpo;
```

Guardar o hash. Se o corpo divergir do que está descrito aqui, **parar e reportar** em vez de sobrescrever.

- [ ] **Step 2: Escrever o teste que falha**

Criar `scripts/sql-tests/35_escopo_admin_head_e_guarda.sql`:

```sql
-- Escopo padrão de admin/head + guarda de último recurso (13/08/2026).
--
-- Padrão novo: quem nunca configurou notification_scope cai em 'mine_only' se for
-- admin/head, e em 'all' se for operador. Sozinho isso deixaria 16 setores mudos
-- (medido: 225 atendimentos passaram pela fila neles em 30 dias), porque são
-- compostos só de admin/head. A guarda impede: degrau que ficaria vazio ignora a
-- preferência.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/35_escopo_admin_head_e_guarda.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_dept uuid; v_conv uuid; v_contact uuid; v_inst uuid;
  v_admin uuid; v_head uuid; v_oper uuid;
  v_n int;
BEGIN
  -- ── fixture: tenant, setor e três pessoas, nenhuma com preferência gravada
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;

  INSERT INTO public.support_departments (tenant_id, name, is_active)
  VALUES (v_tenant, 'ZZ Teste Guarda', true) RETURNING id INTO v_dept;

  SELECT user_id INTO v_admin FROM public.profiles
   WHERE tenant_id = v_tenant AND role = 'admin' AND access_status = 'active' LIMIT 1;
  SELECT user_id INTO v_head FROM public.profiles
   WHERE tenant_id = v_tenant AND role = 'head' AND access_status = 'active'
     AND user_id <> v_admin LIMIT 1;
  SELECT user_id INTO v_oper FROM public.profiles
   WHERE tenant_id = v_tenant AND role = 'user' AND access_status = 'active' LIMIT 1;
  IF v_admin IS NULL OR v_head IS NULL OR v_oper IS NULL THEN
    RAISE EXCEPTION 'PRE: tenant % nao tem admin+head+user ativos', v_tenant;
  END IF;

  -- nenhum dos três pode ter preferência gravada, senão o teste mede outra coisa
  DELETE FROM public.user_preferences WHERE user_id IN (v_admin, v_head, v_oper);

  SELECT id INTO v_inst FROM public.whatsapp_instances WHERE tenant_id = v_tenant LIMIT 1;
  INSERT INTO public.whatsapp_contacts (tenant_id, phone_number, name)
  VALUES (v_tenant, '5511900000001', 'Contato Teste Guarda') RETURNING id INTO v_contact;
  INSERT INTO public.whatsapp_conversations (tenant_id, contact_id, instance_id, department_id, status, assigned_to)
  VALUES (v_tenant, v_contact, v_inst, v_dept, 'active', NULL) RETURNING id INTO v_conv;

  -- ── caso 1: setor SÓ com admin+head  →  guarda dispara, os dois recebem
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept, v_admin, true), (v_tenant, v_dept, v_head, true);

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'GUARDA: setor so de admin/head devolveu % operacionais, esperado 2', v_n;
  END IF;

  -- ── caso 2: entra um operador  →  guarda NÃO dispara, só ele recebe
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept, v_oper, true);

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PADRAO: setor com operador devolveu % operacionais, esperado 1', v_n;
  END IF;

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false AND user_id = v_oper;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'PADRAO: o unico operacional deveria ser o operador';
  END IF;

  -- ── caso 3: chat COM dono admin  →  ele recebe, escopo não o exclui
  UPDATE public.whatsapp_conversations SET assigned_to = v_admin WHERE id = v_conv;

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false AND user_id = v_admin;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DONO: admin dono do chat nao recebeu (mine_only nao pode cortar o proprio chat)';
  END IF;

  -- ── caso 4: preferência explícita 'all' continua valendo sobre o padrão
  UPDATE public.whatsapp_conversations SET assigned_to = NULL WHERE id = v_conv;
  -- Sem ON CONFLICT: user_preferences tem PK só em `id`, não há unique em
  -- `user_id` (conferido em 13/08). Apagar e inserir é o único caminho correto.
  DELETE FROM public.user_preferences WHERE user_id = v_head;
  INSERT INTO public.user_preferences (user_id, notification_scope) VALUES (v_head, 'all');

  SELECT count(*) INTO v_n
    FROM public.get_message_notification_recipients_v2(v_conv)
   WHERE silent_mode = false AND user_id = v_head;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'EXPLICITO: head com all gravado deveria receber a fila';
  END IF;

  RAISE NOTICE 'SMOKE_OK: os 4 casos passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run:
```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/35_escopo_admin_head_e_guarda.sql
```
Expected: FAIL no caso 2 — com a função atual (`COALESCE(up.notification_scope,'all')`), o setor com operador devolve 3 operacionais, não 1.

- [ ] **Step 4: Escrever a migration**

Criar `supabase/migrations/20260813120000_escopo_padrao_admin_head_com_guarda.sql`. O corpo é o de produção (lido no Step 1), com **duas** alterações na etapa operacional:

1. Trocar toda ocorrência de `COALESCE(up.notification_scope, 'all')` na ETAPA 1 pela expressão que depende do papel.
2. Envolver cada degrau numa checagem "sobrou alguém?", refazendo sem o filtro quando a lista der vazia.

```sql
-- Escopo padrão por papel + guarda de último recurso (13/08/2026).
--
-- Medido em 7 dias: 70% do que admin/head recebem é trabalho deles (chat próprio
-- e fila do setor em que estão inscritos). O que sobra de ruído é a fila dos
-- outros. Quem nunca configurou notification_scope caía em 'all'; passa a cair em
-- 'mine_only' se for admin/head.
--
-- A GUARDA existe porque a mudança sozinha abre um buraco: 16 setores ativos são
-- compostos SÓ de admin/head e ficariam com zero destinatário de fila — entre eles
-- CTM "Suporte SG/RJK/RHID" (403 atendimentos/30d), Digi Office "Onboarding" (565),
-- ASP "Financeiro" (308). Medido por support_attendances.queued_at (o status não
-- serve, quem foi atendido não está mais 'waiting'): 225 atendimentos em 30 dias
-- passaram pela fila nesses setores.
--
-- Regra: a preferência nunca pode zerar a fila. Se o filtro deixar o degrau vazio,
-- o filtro é ignorado NAQUELE degrau. Por degrau, não global — setor com operador
-- não desce para o fallback só porque os admins dele estão em mine_only.
--
-- ETAPA 2 (monitores) fica intacta: lá o mine_only já significa "só me mostre o
-- que é meu" e não há fila para zerar.
CREATE OR REPLACE FUNCTION public.get_message_notification_recipients_v2(p_conversation_id uuid)
 RETURNS TABLE(user_id uuid, silent_mode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_assigned_to uuid;
  v_department_id uuid;
  v_fallback_dept_id uuid;
  v_count int;
  v_scoped int;
BEGIN
  SELECT conv.tenant_id, conv.assigned_to, conv.department_id
    INTO v_tenant_id, v_assigned_to, v_department_id
  FROM public.whatsapp_conversations conv
  WHERE conv.id = p_conversation_id;

  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- ETAPA 1: recipients OPERACIONAIS (silent_mode = false)
  IF v_assigned_to IS NOT NULL THEN
    -- Chat com dono: só ele. Escopo não entra aqui — o próprio chat nunca é
    -- silenciado por preferência de fila.
    RETURN QUERY SELECT v_assigned_to, false;

  ELSIF v_department_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM public.support_department_members
    WHERE department_id = v_department_id AND is_active = true;

    IF v_count > 0 THEN
      SELECT COUNT(*) INTO v_scoped
      FROM public.support_department_members sdm
      JOIN public.profiles p ON p.user_id = sdm.user_id
      LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
      WHERE sdm.department_id = v_department_id AND sdm.is_active = true
        AND COALESCE(up.notification_scope,
              CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

      RETURN QUERY
      SELECT sdm.user_id, false
      FROM public.support_department_members sdm
      JOIN public.profiles p ON p.user_id = sdm.user_id
      LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
      WHERE sdm.department_id = v_department_id AND sdm.is_active = true
        AND (v_scoped = 0  -- guarda: ninguém sobrou, o filtro é ignorado
             OR COALESCE(up.notification_scope,
                  CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');
      RETURN;
    END IF;

    SELECT id INTO v_fallback_dept_id
    FROM public.support_departments
    WHERE tenant_id = v_tenant_id AND is_default_fallback = true AND is_active = true
    LIMIT 1;

    IF v_fallback_dept_id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_count
      FROM public.support_department_members
      WHERE department_id = v_fallback_dept_id AND is_active = true;

      IF v_count > 0 THEN
        SELECT COUNT(*) INTO v_scoped
        FROM public.support_department_members sdm
        JOIN public.profiles p ON p.user_id = sdm.user_id
        LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
        WHERE sdm.department_id = v_fallback_dept_id AND sdm.is_active = true
          AND COALESCE(up.notification_scope,
                CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

        RETURN QUERY
        SELECT sdm.user_id, false
        FROM public.support_department_members sdm
        JOIN public.profiles p ON p.user_id = sdm.user_id
        LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
        WHERE sdm.department_id = v_fallback_dept_id AND sdm.is_active = true
          AND (v_scoped = 0
               OR COALESCE(up.notification_scope,
                    CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');
        RETURN;
      END IF;
    END IF;
  END IF;

  -- Último degrau: tenant inteiro. É ele que produz o estouro medido (34
  -- notificações para 17 pessoas em 7 dias). Mantido como rede de segurança por
  -- decisão de 13/08; encolher esse degrau é entrega futura.
  SELECT COUNT(*) INTO v_scoped
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('user','head','admin') AND p.access_status = 'active'
    AND COALESCE(up.notification_scope,
          CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

  RETURN QUERY
  SELECT p.user_id, false
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('user','head','admin') AND p.access_status = 'active'
    AND (v_scoped = 0
         OR COALESCE(up.notification_scope,
              CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');

  -- ETAPA 2: MONITORES (silent_mode = true) — inalterada
  RETURN QUERY
  SELECT p.user_id, true
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('admin','head') AND p.access_status = 'active'
    AND p.user_id NOT IN (
      SELECT u FROM (
        SELECT v_assigned_to AS u WHERE v_assigned_to IS NOT NULL
        UNION
        SELECT sdm.user_id FROM public.support_department_members sdm
         WHERE sdm.department_id = v_department_id AND sdm.is_active = true
        UNION
        SELECT sdm.user_id FROM public.support_department_members sdm
         WHERE sdm.department_id = v_fallback_dept_id AND sdm.is_active = true
           AND v_fallback_dept_id IS NOT NULL
      ) sub
    )
    AND (
      COALESCE(up.notification_scope, 'all') = 'all'
      OR (COALESCE(up.notification_scope, 'all') = 'my_departments'
          AND v_department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.support_department_members sdm2
            WHERE sdm2.user_id = p.user_id AND sdm2.department_id = v_department_id
              AND sdm2.is_active = true))
      OR (COALESCE(up.notification_scope, 'all') = 'mine_only' AND v_assigned_to = p.user_id)
    );
END;
$function$;
```

**Atenção — mudança estrutural em relação ao corpo de hoje:** os degraus 1 e 2 passam a terminar com `RETURN;` explícito. Sem isso o fluxo cairia no degrau do tenant inteiro, que antes ficava dentro de um `ELSE`. Conferir isso no diff.

- [ ] **Step 5: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260813120000_escopo_padrao_admin_head_com_guarda.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/35_escopo_admin_head_e_guarda.sql
```
Expected: `SMOKE_OK: os 4 casos passaram`.

- [ ] **Step 6: Conferir que nenhum setor real ficou mudo**

```sql
SELECT t.nome AS tenant, d.name AS setor
FROM public.support_departments d
JOIN public.tenants t ON t.id = d.tenant_id
WHERE d.is_active
  AND EXISTS (SELECT 1 FROM public.support_department_members sm
               WHERE sm.department_id = d.id AND sm.is_active)
  AND NOT EXISTS (
    SELECT 1 FROM public.whatsapp_conversations c
    JOIN LATERAL public.get_message_notification_recipients_v2(c.id) r ON r.silent_mode = false
    WHERE c.department_id = d.id AND c.assigned_to IS NULL
    LIMIT 1)
ORDER BY 1, 2;
```
Expected: **zero linhas** para setores que têm conversa sem dono. Setor sem nenhuma conversa na fila aparece e é falso positivo — conferir um a um se aparecer algo.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260813120000_escopo_padrao_admin_head_com_guarda.sql scripts/sql-tests/35_escopo_admin_head_e_guarda.sql
git commit -m "fix(notificacoes): admin/head nascem em 'so os meus', com guarda que nunca zera a fila"
```

- [ ] **Step 8: Pedir o OK do Alexandre antes de aplicar em produção**

Não aplicar por conta própria. Mostrar o resultado do Step 6 e esperar autorização.

---

### Task 4: Regra 4 — o motor avisa quem recebeu o chat, e o helper `fn_notify_user`

`fn_assign_conversation_if_ready` atribui a conversa e não avisa ninguém. Só o caminho manual do frontend (`useConversationAssignment.ts`) cria `chat_assignment`.

Esta task também entrega o helper que as tasks 5 e 6 vão usar, e corrige o parâmetro de URL: o frontend escreve `?conversationId=`, mas `src/pages/WhatsApp.tsx:104` lê `?conversation=` — hoje clicar em "Abrir" num aviso de atribuição manual leva ao chat sem abrir a conversa.

**Files:**
- Create: `supabase/migrations/20260813130000_motor_avisa_atribuicao.sql`
- Create: `scripts/sql-tests/36_motor_avisa_atribuicao.sql`
- Modify: `src/components/whatsapp/hooks/useConversationAssignment.ts` (2 ocorrências de `conversationId=`)

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces: `public.fn_notify_user(p_tenant_id uuid, p_user_id uuid, p_type text, p_severity text, p_title text, p_body text, p_action_url text, p_metadata jsonb, p_conversation_id uuid DEFAULT NULL) RETURNS uuid` — cria a notificação e o destinatário, devolve o `notifications.id`. Devolve `NULL` sem fazer nada se `p_user_id` for nulo. **Tasks 5 e 6 dependem desta assinatura.**

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/sql-tests/36_motor_avisa_atribuicao.sql`:

```sql
-- O motor de distribuição avisa quem recebeu o chat (13/08/2026).
--
-- fn_assign_conversation_if_ready atribuía a conversa em silêncio: só o caminho
-- manual do frontend criava 'chat_assignment'. Quem recebia chat pela distribuição
-- automática só descobria olhando a tela.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/36_motor_avisa_atribuicao.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_user uuid; v_notif uuid; v_n int; v_url text;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  SELECT user_id INTO v_user FROM public.profiles
   WHERE tenant_id = v_tenant AND access_status = 'active' LIMIT 1;
  IF v_user IS NULL THEN RAISE EXCEPTION 'PRE: tenant % sem perfil ativo', v_tenant; END IF;

  -- ── helper cria notificação + destinatário e devolve o id
  v_notif := public.fn_notify_user(
    v_tenant, v_user, 'chat_assignment', 'info',
    'Novo atendimento atribuído', 'Contato Teste • Suporte',
    '/whatsapp?conversation=11111111-1111-1111-1111-111111111111',
    jsonb_build_object('conversation_id', '11111111-1111-1111-1111-111111111111'),
    NULL);

  IF v_notif IS NULL THEN RAISE EXCEPTION 'HELPER: fn_notify_user devolveu NULL'; END IF;

  SELECT count(*) INTO v_n FROM public.notification_recipients
   WHERE notification_id = v_notif AND user_id = v_user AND silent_mode = false;
  IF v_n <> 1 THEN RAISE EXCEPTION 'HELPER: esperado 1 destinatario, veio %', v_n; END IF;

  -- ── a URL tem que usar o parâmetro que a tela lê (?conversation=)
  SELECT action_url INTO v_url FROM public.notifications WHERE id = v_notif;
  IF v_url NOT LIKE '/whatsapp?conversation=%' THEN
    RAISE EXCEPTION 'URL: action_url gravou %, esperado /whatsapp?conversation=...', v_url;
  END IF;

  -- ── destinatário nulo não cria lixo
  IF public.fn_notify_user(v_tenant, NULL, 'chat_assignment', 'info', 't', 'b', NULL, '{}'::jsonb, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'HELPER: user nulo deveria devolver NULL';
  END IF;

  RAISE NOTICE 'SMOKE_OK: helper e URL corretos';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/36_motor_avisa_atribuicao.sql
```
Expected: FAIL — `function public.fn_notify_user(...) does not exist`.

- [ ] **Step 3: Reler o corpo vivo de `fn_assign_conversation_if_ready` em produção**

```sql
SELECT md5(pg_get_functiondef('public.fn_assign_conversation_if_ready(uuid)'::regprocedure));
```
Se divergir do corpo em que este plano se baseia, parar e reportar.

- [ ] **Step 4: Escrever a migration**

Criar `supabase/migrations/20260813130000_motor_avisa_atribuicao.sql`:

```sql
-- Helper único de notificação por usuário + o motor passa a avisar (13/08/2026).
--
-- Regra 4 da spec de notificações. fn_assign_conversation_if_ready atribuía a
-- conversa sem avisar ninguém — só o caminho manual do frontend criava o aviso.
--
-- fn_notify_user existe para as regras 3, 4, 5 e 6 não repetirem os dois INSERTs.
-- Ele NÃO decide destinatário: quem chama já sabe para quem é.
CREATE OR REPLACE FUNCTION public.fn_notify_user(
  p_tenant_id uuid,
  p_user_id uuid,
  p_type text,
  p_severity text,
  p_title text,
  p_body text,
  p_action_url text,
  p_metadata jsonb,
  p_conversation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_notif uuid;
BEGIN
  IF p_user_id IS NULL OR p_tenant_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.notifications (
    tenant_id, type, severity, title, body, action_url, conversation_id, metadata
  ) VALUES (
    p_tenant_id, p_type, COALESCE(p_severity,'info'), p_title, p_body,
    p_action_url, p_conversation_id, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_notif;

  INSERT INTO public.notification_recipients (tenant_id, notification_id, user_id, silent_mode)
  VALUES (p_tenant_id, v_notif, p_user_id, false);

  RETURN v_notif;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_notify_user(uuid,uuid,text,text,text,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_notify_user(uuid,uuid,text,text,text,text,text,jsonb,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_user(uuid,uuid,text,text,text,text,text,jsonb,uuid) TO service_role;
```

Em seguida, no **mesmo arquivo**, o `CREATE OR REPLACE` de `fn_assign_conversation_if_ready` — corpo idêntico ao de produção (lido no Step 3), com este bloco inserido **depois** do `INSERT INTO public.conversation_assignments` e **antes** do `RETURN jsonb_build_object('assigned', true, ...)`:

```sql
  -- Regra 4: avisa quem recebeu o chat. Nunca avisa quem causou a ação — aqui
  -- assigned_by é NULL (o motor), então não há autor para excluir.
  BEGIN
    PERFORM public.fn_notify_user(
      v_conv.tenant_id,
      v_chosen_agent,
      'chat_assignment',
      'info',
      'Novo atendimento atribuído',
      COALESCE((SELECT COALESCE(ct.name, ct.phone_number)
                  FROM public.whatsapp_contacts ct
                  JOIN public.whatsapp_conversations cv ON cv.contact_id = ct.id
                 WHERE cv.id = v_conv.id), 'Contato')
        || COALESCE(' • ' || (SELECT d.name FROM public.support_departments d
                               WHERE d.id = v_conv.department_id), ''),
      '/whatsapp?conversation=' || v_conv.id::text,
      jsonb_build_object(
        'conversation_id', v_conv.id,
        'department_id', v_conv.department_id,
        'assigned_by', NULL,
        'reason', 'auto'),
      v_conv.id);
  EXCEPTION WHEN OTHERS THEN
    -- Aviso é efeito colateral: falhar aqui não pode desfazer a atribuição.
    RAISE LOG '[fn_assign_conversation_if_ready] notify falhou em conv %: %', v_conv.id, SQLERRM;
  END;
```

- [ ] **Step 5: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260813130000_motor_avisa_atribuicao.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/36_motor_avisa_atribuicao.sql
```
Expected: `SMOKE_OK: helper e URL corretos`.

- [ ] **Step 6: Corrigir o parâmetro de URL no frontend**

Em `src/components/whatsapp/hooks/useConversationAssignment.ts`, nas linhas 71 e 138, trocar:

```ts
actionUrl: `/whatsapp?conversationId=${conversationId}`,
```

por:

```ts
actionUrl: `/whatsapp?conversation=${conversationId}`,
```

Motivo: `src/pages/WhatsApp.tsx:104` lê `searchParams.get("conversation")`. Com `conversationId` o clique abre o chat sem selecionar a conversa.

- [ ] **Step 7: Typecheck e build**

Run: `bunx tsc -p tsconfig.app.json && bun run build`
Expected: passam.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260813130000_motor_avisa_atribuicao.sql scripts/sql-tests/36_motor_avisa_atribuicao.sql src/components/whatsapp/hooks/useConversationAssignment.ts
git commit -m "feat(notificacoes): motor avisa quem recebeu o chat; corrige URL do aviso de atribuicao"
```

---

### Task 5: Regra 3 — cliente esperando resposta

O prazo já existe e é calculado: `agent_alert_due_at` sai de `fn_business_due_at(sa.awaiting_agent_since, COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes), tenant, dept)`, com liga/desliga por setor. Hoje só pinta badge na lista.

Falta a marca de "já avisei", que nasce e morre junto com `awaiting_agent_since`, e o cron que varre os vencidos.

**Files:**
- Create: `supabase/migrations/20260813140000_aviso_cliente_esperando.sql`
- Create: `scripts/sql-tests/37_aviso_cliente_esperando.sql`

**Interfaces:**
- Consumes: `public.fn_notify_user(...)` (Task 4).
- Produces: coluna `support_attendances.agent_alert_notified_at timestamptz` e `public.fn_notify_awaiting_agent() RETURNS jsonb` (`{"avisados": N}`).

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/sql-tests/37_aviso_cliente_esperando.sql`:

```sql
-- Cliente esperando resposta avisa o dono do chat, uma vez só (13/08/2026).
--
-- agent_alert_due_at já era calculado (por setor, em horário útil) mas só pintava
-- badge na lista. A marca agent_alert_notified_at nasce e morre com
-- awaiting_agent_since, então a mesma espera nunca avisa duas vezes.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/37_aviso_cliente_esperando.sql
BEGIN;

DO $$
DECLARE
  v_att uuid; v_conv uuid; v_tenant uuid; v_user uuid; v_n int; v_res jsonb;
BEGIN
  -- ── fixture: atendimento em andamento, com dono, esperando o agente há muito
  SELECT sa.id, sa.conversation_id, sa.tenant_id, sa.assigned_to
    INTO v_att, v_conv, v_tenant, v_user
  FROM public.support_attendances sa
  JOIN public.whatsapp_conversations c ON c.id = sa.conversation_id
  WHERE sa.status = 'in_progress' AND sa.assigned_to IS NOT NULL
    AND c.department_id IS NOT NULL
  ORDER BY sa.created_at DESC LIMIT 1;
  IF v_att IS NULL THEN RAISE EXCEPTION 'PRE: nenhum atendimento em andamento com dono e setor'; END IF;

  -- espera antiga o bastante para vencer qualquer prazo configurado (max 1440 min)
  UPDATE public.support_attendances
     SET awaiting_agent_since = now() - interval '5 days',
         agent_alert_notified_at = NULL
   WHERE id = v_att;

  -- o setor precisa estar com o alerta ligado, senão o due_at é NULL de propósito
  UPDATE public.support_departments SET agent_alert_enabled = true
   WHERE id = (SELECT department_id FROM public.whatsapp_conversations WHERE id = v_conv);

  -- ── 1ª passada: avisa
  v_res := public.fn_notify_awaiting_agent();
  IF COALESCE((v_res->>'avisados')::int, 0) < 1 THEN
    RAISE EXCEPTION 'VENCIDO: nao avisou ninguem, retorno %', v_res;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.notifications n
  JOIN public.notification_recipients nr ON nr.notification_id = n.id
  WHERE n.type = 'chat_awaiting_reply' AND n.conversation_id = v_conv AND nr.user_id = v_user;
  IF v_n <> 1 THEN RAISE EXCEPTION 'VENCIDO: esperado 1 aviso ao dono, veio %', v_n; END IF;

  IF (SELECT agent_alert_notified_at FROM public.support_attendances WHERE id = v_att) IS NULL THEN
    RAISE EXCEPTION 'MARCA: agent_alert_notified_at continuou nulo';
  END IF;

  -- ── 2ª passada: NÃO repete
  PERFORM public.fn_notify_awaiting_agent();
  SELECT count(*) INTO v_n
  FROM public.notifications n
  JOIN public.notification_recipients nr ON nr.notification_id = n.id
  WHERE n.type = 'chat_awaiting_reply' AND n.conversation_id = v_conv AND nr.user_id = v_user;
  IF v_n <> 1 THEN RAISE EXCEPTION 'REPETICAO: avisou % vezes pela mesma espera', v_n; END IF;

  -- ── o operador responde: a marca tem que zerar junto com a espera
  UPDATE public.support_attendances
     SET last_customer_message_at = now() - interval '10 minutes',
         last_operator_message_at = now()
   WHERE id = v_att;

  IF (SELECT agent_alert_notified_at FROM public.support_attendances WHERE id = v_att) IS NOT NULL THEN
    RAISE EXCEPTION 'RESET: resposta do operador deveria ter zerado agent_alert_notified_at';
  END IF;

  RAISE NOTICE 'SMOKE_OK: avisa uma vez, nao repete, e reseta na resposta';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/37_aviso_cliente_esperando.sql
```
Expected: FAIL — `column "agent_alert_notified_at" does not exist`.

- [ ] **Step 3: Reler o corpo vivo de `fn_track_awaiting_agent` em produção**

```sql
SELECT md5(pg_get_functiondef('public.fn_track_awaiting_agent()'::regprocedure));
```

- [ ] **Step 4: Escrever a migration**

Criar `supabase/migrations/20260813140000_aviso_cliente_esperando.sql`:

```sql
-- Regra 3: cliente esperando resposta avisa o dono do chat (13/08/2026).
--
-- O prazo já existia — agent_alert_due_at, por setor e em horário útil — mas só
-- pintava badge na lista de conversas. Ninguém era notificado.
--
-- A marca de "já avisei" é uma coluna nova que nasce e morre junto com
-- awaiting_agent_since: assim a mesma espera nunca gera dois avisos, e uma nova
-- espera (cliente volta a escrever depois da resposta) gera um aviso novo.
ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS agent_alert_notified_at timestamptz;

-- Índice parcial: o cron só olha quem está esperando e ainda não foi avisado.
CREATE INDEX IF NOT EXISTS idx_sa_awaiting_nao_avisado
  ON public.support_attendances (awaiting_agent_since)
  WHERE awaiting_agent_since IS NOT NULL AND agent_alert_notified_at IS NULL;
```

Depois, no mesmo arquivo, o `CREATE OR REPLACE` de `fn_track_awaiting_agent` — corpo de produção (Step 3) com `NEW.agent_alert_notified_at := NULL;` acrescentado **ao lado de cada** `NEW.awaiting_agent_since := NULL;` (são dois pontos: fechamento e resposta do operador). O ramo que **seta** `awaiting_agent_since` não precisa zerar a marca: ela já está nula, porque só é preenchida enquanto a espera existe.

E a função do cron:

```sql
CREATE OR REPLACE FUNCTION public.fn_notify_awaiting_agent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_avisados int := 0;
BEGIN
  FOR v_row IN
    SELECT sa.id AS attendance_id, sa.assigned_to, wc.id AS conversation_id, wc.tenant_id,
           COALESCE(ct.name, ct.phone_number, 'Cliente') AS contato
    FROM public.support_attendances sa
    JOIN public.whatsapp_conversations wc ON wc.id = sa.conversation_id
    LEFT JOIN public.whatsapp_contacts ct ON ct.id = wc.contact_id
    LEFT JOIN public.support_departments dept ON dept.id = wc.department_id
    LEFT JOIN public.configuracoes cfg ON cfg.tenant_id = wc.tenant_id
    WHERE sa.awaiting_agent_since IS NOT NULL
      AND sa.agent_alert_notified_at IS NULL
      AND sa.assigned_to IS NOT NULL          -- chat sem dono é assunto da regra 2
      AND sa.status IN ('waiting','in_progress')
      AND COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) = true
      AND public.fn_business_due_at(
            sa.awaiting_agent_since,
            COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes),
            wc.tenant_id, wc.department_id) <= now()
    FOR UPDATE OF sa SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.fn_notify_user(
        v_row.tenant_id, v_row.assigned_to, 'chat_awaiting_reply', 'warning',
        'Cliente esperando resposta',
        v_row.contato,
        '/whatsapp?conversation=' || v_row.conversation_id::text,
        jsonb_build_object('conversation_id', v_row.conversation_id,
                           'attendance_id', v_row.attendance_id),
        v_row.conversation_id);

      UPDATE public.support_attendances
         SET agent_alert_notified_at = now()
       WHERE id = v_row.attendance_id;

      v_avisados := v_avisados + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[fn_notify_awaiting_agent] falhou no atendimento %: %', v_row.attendance_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('avisados', v_avisados);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_notify_awaiting_agent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_notify_awaiting_agent() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_awaiting_agent() TO service_role;
```

- [ ] **Step 5: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260813140000_aviso_cliente_esperando.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/37_aviso_cliente_esperando.sql
```
Expected: `SMOKE_OK: avisa uma vez, nao repete, e reseta na resposta`.

- [ ] **Step 6: Medir o volume antes de agendar o cron**

```sql
SELECT count(*) AS avisaria_agora
FROM public.support_attendances sa
JOIN public.whatsapp_conversations wc ON wc.id = sa.conversation_id
LEFT JOIN public.support_departments dept ON dept.id = wc.department_id
LEFT JOIN public.configuracoes cfg ON cfg.tenant_id = wc.tenant_id
WHERE sa.awaiting_agent_since IS NOT NULL AND sa.agent_alert_notified_at IS NULL
  AND sa.assigned_to IS NOT NULL AND sa.status IN ('waiting','in_progress')
  AND COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) = true
  AND public.fn_business_due_at(sa.awaiting_agent_since,
        COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes),
        wc.tenant_id, wc.department_id) <= now();
```

**Não agendar o cron sem mostrar esse número ao Alexandre.** Há atraso acumulado: esperas antigas vencidas dispararão todas na primeira execução. Se o número for grande, a primeira passada deve ser feita a mão com a marca preenchida sem notificar (`UPDATE ... SET agent_alert_notified_at = now()` nos antigos), e o cron entra depois — decisão dele.

- [ ] **Step 7: Commit (sem agendar o cron)**

```bash
git add supabase/migrations/20260813140000_aviso_cliente_esperando.sql scripts/sql-tests/37_aviso_cliente_esperando.sql
git commit -m "feat(notificacoes): aviso de cliente esperando resposta, uma vez por espera"
```

O agendamento em produção (`cron.schedule('notify-awaiting-agent', '*/2 * * * *', 'SELECT public.fn_notify_awaiting_agent()')`) é passo separado, depois do OK.

---

### Task 6: Regras 5 e 6 — ticket de suporte e jornada de onboarding

Nenhuma das duas existe hoje: zero notificação de ticket no banco.

Regra 5 usa `support_tickets.responsavel_user_id` (preenchido em 1.361 de 1.362 tickets de suporte em 30 dias). Regra 6 usa `onboarding_journeys.responsavel_user_id` (109 de 109) — **nunca o do ticket**, que é nulo em todos os 177 tickets de onboarding do período.

**Files:**
- Create: `supabase/migrations/20260813150000_avisos_de_ticket_e_jornada.sql`
- Create: `scripts/sql-tests/38_avisos_de_ticket_e_jornada.sql`

**Interfaces:**
- Consumes: `public.fn_notify_user(...)` (Task 4).
- Produces: triggers `trg_notify_ticket_responsavel` em `support_tickets` e `trg_notify_journey_responsavel` em `onboarding_journeys`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `scripts/sql-tests/38_avisos_de_ticket_e_jornada.sql`:

```sql
-- Regras 5 e 6: ticket em meu nome e jornada sob minha responsabilidade (13/08/2026).
--
-- Nenhuma das duas existia. O ticket de onboarding NUNCA tem responsavel_user_id
-- (0 de 177 em 30 dias) — quem tem é a jornada (109 de 109).
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/38_avisos_de_ticket_e_jornada.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_autor uuid; v_resp uuid; v_outro uuid;
  v_ticket uuid; v_cliente uuid; v_journey uuid; v_n int;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  SELECT user_id INTO v_autor FROM public.profiles
   WHERE tenant_id = v_tenant AND access_status='active' LIMIT 1;
  SELECT user_id INTO v_resp FROM public.profiles
   WHERE tenant_id = v_tenant AND access_status='active' AND user_id <> v_autor LIMIT 1;
  SELECT user_id INTO v_outro FROM public.profiles
   WHERE tenant_id = v_tenant AND access_status='active'
     AND user_id NOT IN (v_autor, v_resp) LIMIT 1;
  IF v_outro IS NULL THEN RAISE EXCEPTION 'PRE: tenant % precisa de 3 perfis ativos', v_tenant; END IF;

  SELECT id INTO v_cliente FROM public.clientes WHERE tenant_id = v_tenant LIMIT 1;

  -- ── regra 5: ticket criado com responsável DIFERENTE do autor → avisa
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, criado_por, responsavel_user_id, contexto)
  VALUES (v_tenant, v_cliente, 'Teste aviso ticket', v_autor, v_resp, 'suporte')
  RETURNING id INTO v_ticket;

  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='ticket_assigned' AND nr.user_id=v_resp
    AND n.metadata->>'ticket_id' = v_ticket::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TICKET: esperado 1 aviso ao responsavel, veio %', v_n; END IF;

  -- ── autor = responsável → NÃO avisa
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, criado_por, responsavel_user_id, contexto)
  VALUES (v_tenant, v_cliente, 'Teste auto-atribuicao', v_autor, v_autor, 'suporte')
  RETURNING id INTO v_ticket;

  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='ticket_assigned' AND nr.user_id=v_autor
    AND n.metadata->>'ticket_id' = v_ticket::text;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TICKET: quem abriu para si mesmo nao pode ser avisado'; END IF;

  -- ── reatribuição avisa o novo
  UPDATE public.support_tickets SET responsavel_user_id = v_outro WHERE id = v_ticket;
  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='ticket_assigned' AND nr.user_id=v_outro
    AND n.metadata->>'ticket_id' = v_ticket::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TICKET: reatribuicao nao avisou o novo responsavel'; END IF;

  -- ── regra 6: jornada nasce com responsável → avisa
  INSERT INTO public.onboarding_journeys (tenant_id, ticket_id, cliente_id, situacao, responsavel_user_id)
  VALUES (v_tenant, v_ticket, v_cliente, 'em_andamento', v_resp)
  RETURNING id INTO v_journey;

  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='onboarding_journey_assigned' AND nr.user_id=v_resp
    AND n.metadata->>'journey_id' = v_journey::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'JORNADA: abertura nao avisou o responsavel, veio %', v_n; END IF;

  -- ── transferência avisa o novo
  UPDATE public.onboarding_journeys SET responsavel_user_id = v_outro WHERE id = v_journey;
  SELECT count(*) INTO v_n
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.type='onboarding_journey_assigned' AND nr.user_id=v_outro
    AND n.metadata->>'journey_id' = v_journey::text;
  IF v_n <> 1 THEN RAISE EXCEPTION 'JORNADA: transferencia nao avisou o novo responsavel'; END IF;

  RAISE NOTICE 'SMOKE_OK: regras 5 e 6';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/38_avisos_de_ticket_e_jornada.sql
```
Expected: FAIL no primeiro bloco — nenhum aviso é criado.

- [ ] **Step 3: Escrever a migration**

Criar `supabase/migrations/20260813150000_avisos_de_ticket_e_jornada.sql`:

```sql
-- Regras 5 e 6: ticket em meu nome e jornada sob minha responsabilidade (13/08/2026).
--
-- Ticket de onboarding NUNCA tem responsavel_user_id (0 de 177 em 30 dias); quem
-- tem responsável é a jornada (109 de 109). Por isso são dois gatilhos, em tabelas
-- diferentes, e não um só.
--
-- Nenhum dos dois pode derrubar a operação: aviso é efeito colateral, então a
-- exceção é capturada e registrada.
CREATE OR REPLACE FUNCTION public.fn_notify_ticket_responsavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.responsavel_user_id IS NULL THEN RETURN NEW; END IF;

  -- INSERT avisa; UPDATE só quando o responsável de fato mudou.
  IF TG_OP = 'UPDATE' AND NEW.responsavel_user_id IS NOT DISTINCT FROM OLD.responsavel_user_id THEN
    RETURN NEW;
  END IF;

  -- Nunca avisar quem causou a ação.
  IF NEW.responsavel_user_id = COALESCE(NEW.criado_por, '00000000-0000-0000-0000-000000000000'::uuid)
     AND TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.responsavel_user_id = auth.uid() THEN RETURN NEW; END IF;

  BEGIN
    PERFORM public.fn_notify_user(
      NEW.tenant_id, NEW.responsavel_user_id, 'ticket_assigned', 'info',
      CASE WHEN TG_OP = 'INSERT' THEN 'Novo chamado em seu nome'
           ELSE 'Chamado transferido para você' END,
      COALESCE(NEW.ticket_code || ' · ', '') || COALESCE(NEW.assunto, 'Sem assunto'),
      '/tickets?ticket=' || NEW.id::text,
      jsonb_build_object('ticket_id', NEW.id, 'ticket_code', NEW.ticket_code),
      NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[fn_notify_ticket_responsavel] falhou no ticket %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_ticket_responsavel ON public.support_tickets;
CREATE TRIGGER trg_notify_ticket_responsavel
AFTER INSERT OR UPDATE OF responsavel_user_id ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.fn_notify_ticket_responsavel();


CREATE OR REPLACE FUNCTION public.fn_notify_journey_responsavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cliente text;
BEGIN
  IF NEW.responsavel_user_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' AND NEW.responsavel_user_id IS NOT DISTINCT FROM OLD.responsavel_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.responsavel_user_id = auth.uid() THEN RETURN NEW; END IF;

  SELECT COALESCE(c.nome_fantasia, c.razao_social, 'Cliente') INTO v_cliente
    FROM public.clientes c WHERE c.id = NEW.cliente_id;

  BEGIN
    PERFORM public.fn_notify_user(
      NEW.tenant_id, NEW.responsavel_user_id, 'onboarding_journey_assigned', 'info',
      CASE WHEN TG_OP = 'INSERT' THEN 'Nova implantação sob sua responsabilidade'
           ELSE 'Implantação transferida para você' END,
      COALESCE(v_cliente, 'Cliente'),
      '/onboarding?journey=' || NEW.id::text,
      jsonb_build_object('journey_id', NEW.id, 'cliente_id', NEW.cliente_id),
      NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG '[fn_notify_journey_responsavel] falhou na jornada %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_journey_responsavel ON public.onboarding_journeys;
CREATE TRIGGER trg_notify_journey_responsavel
AFTER INSERT OR UPDATE OF responsavel_user_id ON public.onboarding_journeys
FOR EACH ROW EXECUTE FUNCTION public.fn_notify_journey_responsavel();
```

`clientes.nome_fantasia` e `clientes.razao_social` foram conferidos em produção em 13/08 e
existem — não há coluna `nome` nessa tabela.

- [ ] **Step 4: Aplicar no local e rodar o teste**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/migrations/20260813150000_avisos_de_ticket_e_jornada.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/38_avisos_de_ticket_e_jornada.sql
```
Expected: `SMOKE_OK: regras 5 e 6`.

- [ ] **Step 5: Conferir que as rotas de destino existem**

As `action_url` apontam para `/tickets?ticket=` e `/onboarding?journey=`. Conferir no repo qual parâmetro cada tela lê de fato — o mesmo erro do `?conversationId=` da Task 4:

```bash
grep -rn "searchParams.get" src/pages/SupportTickets.tsx src/pages/onboarding/OnboardingPage.tsx | head
```
Ajustar a migration se o nome do parâmetro divergir, e rodar o teste de novo.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260813150000_avisos_de_ticket_e_jornada.sql scripts/sql-tests/38_avisos_de_ticket_e_jornada.sql
git commit -m "feat(notificacoes): aviso de chamado em seu nome e de jornada sob sua responsabilidade"
```

---

## Verificação final, depois de tudo aplicado em produção

Repetir a medição de linha de base da spec e comparar:

```sql
WITH n7 AS (
  SELECT n.id, count(*) FILTER (WHERE nr.silent_mode = false) AS destinatarios
  FROM public.notifications n
  JOIN public.notification_recipients nr ON nr.notification_id = n.id
  WHERE n.created_at > now() - interval '7 days' AND n.type = 'whatsapp_new_message'
  GROUP BY n.id
)
SELECT CASE WHEN destinatarios <= 1 THEN '1 (chat proprio)'
            WHEN destinatarios <= 4 THEN '2-4 (fila de setor)'
            ELSE '5+ (estouro)' END AS faixa,
       count(*) AS notificacoes, sum(destinatarios) AS pops
FROM n7 GROUP BY 1 ORDER BY 1;
```

Linha de base de 13/08/2026: 1 destinatário = 7.071 pops · 2-4 = 2.767 · 5+ = 1.263.

E o `CHANGELOG.md` ganha uma linha por publicação, em linguagem de cliente, no dia em que for ao ar.
