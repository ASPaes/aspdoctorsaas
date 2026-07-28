# Diálogos e modais responsivos — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer todo diálogo, modal e popover do DoctorSaaS ser utilizável em notebook 13"/14" sem reduzir o zoom do navegador.

**Architecture:** Três camadas. A base (`dialog.tsx`) resolve corte e prende cabeçalho/rodapé para os 113 diálogos de uma vez. Depois, 15 diálogos medidos acima do orçamento de altura viram 2 colunas. Por fim, 4 popovers que são formulários viram diálogos. Uma guarda em vitest mede o repo inteiro e falha se algum diálogo passar do orçamento — ela é escrita primeiro e falha hoje.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui sobre Radix, vitest (jsdom), Chrome headless para medição de layout.

**Spec:** [docs/superpowers/specs/2026-07-28-dialogos-responsivos-design.md](../specs/2026-07-28-dialogos-responsivos-design.md)

## Global Constraints

- **Orçamento de altura: 690px.** Notebook 13" com barra de favoritos.
- **Fator de calibração: 1.21.** A estimativa por contagem de campos deu 600px onde a medição real no Chrome deu 728px (NewJourneyModal). Todo cálculo de altura multiplica por 1.21.
- **Largura é piso, nunca teto.** Nunca reduzir a largura atual de um diálogo.
- **Sempre `grid-cols-1 sm:grid-cols-2`**, nunca `grid-cols-2` puro — em tela estreita tem que voltar a 1 coluna.
- **Campo longo ocupa a linha inteira** com `sm:col-span-2`: `Textarea`, Assunto, Observação, qualquer campo de texto livre.
- **Nunca quebrar par lógico entre colunas.** Início planejado / Go-live previsto ficam lado a lado.
- **Nenhuma mudança de comportamento, dado, RPC ou edge function.** Só layout. Nenhum handler, nenhum `useState`, nenhuma query muda.
- **Typecheck é `npx tsc -p tsconfig.app.json --noEmit`.** O `tsc` da raiz tem `files: []` e sempre sai 0 — não serve.
- **Não fazer `git push`.** Alexandre libera o push. Commits locais, sim.
- `git pull --rebase` antes de começar: o Lovable escreve na mesma `main`.

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/components/ui/__tests__/dialogHeight.test.ts` | **Criar.** Guarda: mede todo `DialogContent` do repo e falha acima de 690px |
| `src/components/ui/dialog.tsx` | **Modificar.** `DialogHeader`/`DialogFooter` viram sticky com gutter |
| `src/components/ui/popover.tsx` | Já feito (cap de altura). Sem mudança neste plano |
| 8 arquivos com header/footer padronizado | **Modificar.** Reset de margem (`m-0`) para não colidir com o gutter |
| 15 diálogos acima do orçamento | **Modificar.** 2 colunas + largura |
| 4 popovers-formulário | **Modificar.** Viram `Dialog` |

### 6 arquivos que a spec lista mas que NÃO precisam mudar

A spec classificou 21 diálogos por contagem de campos. A guarda, que também considera se o diálogo já tem 2 colunas ou miolo rolável, acusa só **15**. Estes 6 já estão dentro do orçamento e ficam intocados — mexer neles seria trabalho sem ganho:

| Arquivo | Por quê |
|---|---|
| `configuracoes/ProdutosModulosTab.tsx` | já tem `sm:grid-cols-2` |
| `clientes/ContatosAdicionaisModal.tsx` | já tem `sm:grid-cols-2` |
| `configuracoes/CacDespesasTab.tsx` | já tem `sm:grid-cols-2` |
| `tickets/CsatReportModal.tsx` | já tem `sm:grid-cols-2` |
| `onboarding/JourneyDetailSheet.tsx` (diálogo principal) | miolo rolável pronto (`overflow-hidden flex-col`) |
| `tickets/CreateSupportTicketModal.tsx` | miolo rolável pronto (`overflow-hidden flex-col`) |

Os dois últimos ainda são tocados na Task 2 (reset `m-0`) e na Task 7 (popover), mas não mudam de layout.

---

### Task 1: Guarda de altura (o teste que falha)

Esta é a tarefa de teste do plano inteiro. Ela falha hoje listando 15 diálogos; cada tarefa seguinte reduz esse número. Task 7 termina com ela em zero.

**Files:**
- Create: `src/components/ui/__tests__/dialogHeight.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `bun run test` passa a cobrir altura de diálogo. As tarefas 3–6 usam a saída desse teste como critério de pronto.

- [ ] **Step 1: Escrever o teste**

Criar `src/components/ui/__tests__/dialogHeight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guarda de altura de diálogo.
 *
 * Notebook 13" com barra de favoritos tem ~690px de viewport útil. Um diálogo
 * mais alto que isso é cortado ou obriga o usuário a rolar um formulário.
 *
 * Isto é HEURÍSTICA CALIBRADA, não layout real: estima a altura contando campos.
 * A estimativa deu 600px onde a medição real no Chrome deu 728px (NewJourneyModal),
 * daí o fator 1.21. Pega regressão grosseira — alguém empilhar 10 campos num
 * `max-w-md` — não erro de pixel.
 */
const ORCAMENTO_PX = 690;
const CALIBRACAO = 1.21;

const ALTURA_CAMPO = 66; // label(14) + gap(6) + controle(40) + respiro(6)
const ALTURA_CABECALHO = 34;
const ALTURA_RODAPE = 56;
const PADDING_VERTICAL = 48; // p-6 em cima e embaixo

function arquivosTsx(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosTsx(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

type Diagnostico = { arquivo: string; campos: number; duasColunas: boolean; altura: number };

function medirDialogos(): Diagnostico[] {
  const fora: Diagnostico[] = [];
  for (const arquivo of arquivosTsx("src")) {
    const src = fs.readFileSync(arquivo, "utf8");
    let i = 0;
    while ((i = src.indexOf("<DialogContent", i)) >= 0) {
      const fim = src.indexOf("</DialogContent>", i);
      if (fim < 0) break;
      const abertura = src.slice(i, src.indexOf(">", i) + 1);
      const corpo = src.slice(i, fim);
      i = fim + "</DialogContent>".length;

      // Isento: layout próprio com miolo rolável (overflow-hidden + flex-col).
      // Esses já têm cabeçalho e rodapé fixos por conta própria.
      if (/overflow-hidden/.test(abertura) && /flex-col/.test(abertura)) continue;

      const conta = (re: RegExp) => (corpo.match(re) || []).length;
      const textareas = conta(/<Textarea[\s>]/g);
      const campos =
        conta(/<Input[\s>]/g) +
        conta(/<SelectTrigger[\s>]/g) +
        textareas +
        conta(/<Switch[\s>]/g) +
        conta(/<Checkbox[\s>]/g);
      if (campos === 0) continue;

      const duasColunas = /sm:grid-cols-2|md:grid-cols-2/.test(corpo);
      const linhas = duasColunas ? Math.ceil(campos / 2) : campos;
      const altura = Math.round(
        (ALTURA_CABECALHO + linhas * ALTURA_CAMPO + textareas * 40 + ALTURA_RODAPE + PADDING_VERTICAL) *
          CALIBRACAO,
      );

      if (altura > ORCAMENTO_PX) {
        fora.push({ arquivo: arquivo.replace(/^src\//, ""), campos, duasColunas, altura });
      }
    }
  }
  return fora.sort((a, b) => b.altura - a.altura);
}

describe("altura de diálogo", () => {
  it(`nenhum diálogo passa de ${ORCAMENTO_PX}px (notebook 13")`, () => {
    const fora = medirDialogos();
    const relatorio = fora
      .map((d) => `  ${d.altura}px  ${d.campos} campos  ${d.duasColunas ? "2col" : "1col"}  ${d.arquivo}`)
      .join("\n");
    expect(fora, `Diálogos acima do orçamento:\n${relatorio}\n`).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que FALHA**

Run: `bun run test -- dialogHeight`
Expected: **FAIL**, listando exatamente 15 diálogos, o mais alto sendo `configuracoes/whatsapp/EditInstanceDialog.tsx` com 1445px e o mais baixo `tickets/ClassifyClosureModal.tsx` com 695px. `pages/onboarding/NewJourneyModal.tsx` aparece com 726px.

Se o número não for 15, **pare**: a contagem de campos divergiu do medido em 28/07 e o resto do plano está calibrado em cima dela.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/__tests__/dialogHeight.test.ts
git commit -m "test(ui): guarda de altura de diálogo em notebook 13\""
```

---

### Task 2: Base — cabeçalho e rodapé fixos

**Files:**
- Modify: `src/components/ui/dialog.tsx:54-62` (`DialogHeader`, `DialogFooter`)
- Modify (reset de margem, 8 arquivos):
  - `src/components/configuracoes/BusinessHoursExceptionsSection.tsx` (header e footer)
  - `src/components/cs/CSTicketDetail.tsx`
  - `src/components/tickets/AttendanceDetailModal.tsx`
  - `src/components/whatsapp/chat/ContactHistoryUnifiedModal.tsx`
  - `src/components/whatsapp/chat/InChatMessageSearchModal.tsx`
  - `src/components/whatsapp/conversations/MessageSearchModal.tsx`
  - `src/pages/onboarding/JourneyDetailSheet.tsx:1580`

**Interfaces:**
- Consumes: guarda da Task 1.
- Produces: `DialogHeader` e `DialogFooter` grudam no topo/base quando o diálogo rola. Nenhuma mudança de assinatura — as props continuam `React.HTMLAttributes<HTMLDivElement>`.

**O detalhe que faz isso funcionar (já verificado no Chrome, não deduzir de novo):**

O gutter precisa de margem negativa (`-mx-6 -mt-6`) para o fundo cobrir o `p-6` do `DialogContent`. Mas margem negativa desloca a referência do `sticky`: com `top-0` o cabeçalho para **25px abaixo** do topo, e o conteúdo rolando aparece por essa fresta. Medido: `hdr_topo=25`, vazamento visível.

A correção é compensar no inset: **`-top-6` no cabeçalho e `-bottom-6` no rodapé**. Medido depois: `hdr_topo=1`, `ftr_base=1`, zero vazamento.

- [ ] **Step 1: Rodar a guarda e anotar o número de partida**

Run: `bun run test -- dialogHeight`
Expected: FAIL com 15 diálogos. Anotar.

- [ ] **Step 2: Tornar cabeçalho e rodapé fixos**

Em `src/components/ui/dialog.tsx`, substituir `DialogHeader` e `DialogFooter`:

```tsx
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Gruda no topo quando o DialogContent rola (ele é overflow-y-auto).
      // -mx-6/-mt-6 + px-6/pt-6: o fundo cobre o p-6 do DialogContent, senão o
      //   conteúdo rolando aparece pelas laterais e por cima.
      // -mb-4/pb-4: absorve o gap-4 do grid, senão sobra uma fresta transparente
      //   de 16px logo abaixo do cabeçalho.
      // -top-6: compensa o -mt-6. Sem isso o sticky para 25px abaixo do topo e
      //   o conteúdo vaza por cima do título (verificado no Chrome).
      "sticky -top-6 z-20 -mx-6 -mt-6 -mb-4 bg-background px-6 pb-4 pt-6",
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Espelho do DialogHeader: gruda na base para o botão de ação nunca sumir.
      "sticky -bottom-6 z-20 -mx-6 -mb-6 -mt-4 bg-background px-6 pb-6 pt-4",
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";
```

- [ ] **Step 3: Resetar a margem nos 8 que têm padding próprio**

Esses 8 estão dentro de diálogos com layout próprio (`p-0`, miolo rolável). O gutter negativo os deixaria 48px mais largos que o container. `tailwind-merge` faz a classe do consumidor vencer, então basta acrescentar `m-0` ao `className` **já existente** — não substituir o resto.

Exemplo, em `src/pages/onboarding/JourneyDetailSheet.tsx:1580`:

```tsx
// antes
<DialogHeader className="px-6 py-4 border-b border-border shrink-0">
// depois
<DialogHeader className="m-0 px-6 py-4 border-b border-border shrink-0">
```

Aplicar o mesmo (`m-0` como primeira classe) em:

| Arquivo | Tag | className atual |
|---|---|---|
| `configuracoes/BusinessHoursExceptionsSection.tsx` | `DialogHeader` | `px-6 pt-6 pb-2 shrink-0` |
| `configuracoes/BusinessHoursExceptionsSection.tsx` | `DialogFooter` | `px-6 py-4 border-t shrink-0` |
| `cs/CSTicketDetail.tsx` | `DialogHeader` | `px-6 py-4 border-b shrink-0` |
| `tickets/AttendanceDetailModal.tsx` | `DialogHeader` | `px-6 py-4 border-b shrink-0` |
| `whatsapp/chat/ContactHistoryUnifiedModal.tsx` | `DialogHeader` | `px-5 pt-5 pb-3 shrink-0` |
| `whatsapp/chat/InChatMessageSearchModal.tsx` | `DialogHeader` | `px-4 pt-4 pb-2` |
| `whatsapp/conversations/MessageSearchModal.tsx` | `DialogHeader` | `px-4 pt-4 pb-2` |
| `onboarding/JourneyDetailSheet.tsx` | `DialogHeader` | `px-6 py-4 border-b border-border shrink-0` |

- [ ] **Step 4: Confirmar que nenhum outro header/footer tem margem/padding próprio**

Run:
```bash
grep -rhoE "<Dialog(Header|Footer)[^>]*className=\"[^\"]*\"" src | grep -E '\b-?[pm][xytblr]?-' | wc -l
```
Expected: `8` — os mesmos 8 do Step 3, todos já com `m-0`. Se vier mais que 8, o Lovable adicionou um novo: aplicar `m-0` nele também.

- [ ] **Step 5: Typecheck e build**

Run: `npx tsc -p tsconfig.app.json --noEmit && bun run build`
Expected: ambos passam.

- [ ] **Step 6: Guarda continua em 15**

Run: `bun run test -- dialogHeight`
Expected: FAIL com os **mesmos 15**. Esta tarefa não reduz altura — ela torna o scroll usável. Se o número mudar, algo mais foi tocado sem querer.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/dialog.tsx src/components/configuracoes/BusinessHoursExceptionsSection.tsx \
  src/components/cs/CSTicketDetail.tsx src/components/tickets/AttendanceDetailModal.tsx \
  src/components/whatsapp/chat/ContactHistoryUnifiedModal.tsx \
  src/components/whatsapp/chat/InChatMessageSearchModal.tsx \
  src/components/whatsapp/conversations/MessageSearchModal.tsx \
  src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "feat(ui): cabeçalho e rodapé fixos nos diálogos que rolam"
```

---

### Task 3: NewJourneyModal em 2 colunas (exemplo trabalhado)

É o caso que o Pedro reportou. Serve de referência para as tarefas 4–6: fazer exatamente assim nos outros.

**Files:**
- Modify: `src/pages/onboarding/NewJourneyModal.tsx:217` (largura) e `:221-396` (corpo)

**Interfaces:**
- Consumes: base da Task 2.
- Produces: o padrão de 2 colunas que as tarefas 4–6 replicam.

- [ ] **Step 1: Confirmar que a guarda acusa este arquivo**

Run: `bun run test -- dialogHeight`
Expected: FAIL, e `pages/onboarding/NewJourneyModal.tsx` aparece com **726px**, 7 campos, `1col`.

- [ ] **Step 2: Alargar o diálogo**

`src/pages/onboarding/NewJourneyModal.tsx:217` — 7 campos cai na faixa 6–9, piso `max-w-2xl`:

```tsx
// antes
<DialogContent className="max-w-md">
// depois
<DialogContent className="max-w-2xl">
```

- [ ] **Step 3: Passar o corpo para 2 colunas**

Trocar o wrapper do corpo (linha 221) de `<div className="space-y-3 py-2">` para grid, e marcar os campos que ocupam a linha inteira.

O agrupamento decidido (não improvisar outro):

| Linha | Coluna esquerda | Coluna direita |
|---|---|---|
| 1 | Cliente * | Responsável |
| 2 | Produto * | Tipo de demanda |
| 3 | Assunto * | Data de abertura |
| 4 | Início planejado | Go-live previsto |
| 5 | — hint "Calculado: …" (`sm:col-span-2`) — | |

```tsx
// linha 221: antes
<div className="space-y-3 py-2">
// depois
<div className="grid grid-cols-1 gap-x-4 gap-y-3 py-2 sm:grid-cols-2">
```

Os 6 primeiros blocos `<div className="space-y-1.5">` ficam como estão (cada um vira uma célula do grid, na ordem acima).

O bloco "Início planejado / Go-live previsto" (linhas 367–376) **já é** um `grid grid-cols-2 gap-3`. Ele agora está dentro de um grid de 2 colunas, o que espremeria dois campos de data em meia largura. Desfazer o grid interno e deixar os dois campos serem células irmãs do grid externo:

```tsx
// antes (367-376)
<div className="grid grid-cols-2 gap-3">
  <div className="space-y-1.5">
    <Label>Início planejado</Label>
    <Input type="date" value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setGoLiveEdited(false); }} />
  </div>
  <div className="space-y-1.5">
    <Label>Go-live previsto</Label>
    <Input type="date" value={goLive} onChange={(e) => { setGoLive(e.target.value); setGoLiveEdited(true); }} />
  </div>
</div>

// depois — sem o wrapper, os dois viram células do grid externo e continuam lado a lado
<div className="space-y-1.5">
  <Label>Início planejado</Label>
  <Input type="date" value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setGoLiveEdited(false); }} />
</div>
<div className="space-y-1.5">
  <Label>Go-live previsto</Label>
  <Input type="date" value={goLive} onChange={(e) => { setGoLive(e.target.value); setGoLiveEdited(true); }} />
</div>
```

O hint do go-live (linhas 377–395) ocupa a linha inteira:

```tsx
// antes
<div className="text-[11px] -mt-1">
// depois
<div className="text-[11px] -mt-1 sm:col-span-2">
```

**Não mexer** em nenhum `useState`, handler, query ou `handleSubmit`. Só classes e a remoção do wrapper de grid interno.

- [ ] **Step 4: Guarda cai para 14**

Run: `bun run test -- dialogHeight`
Expected: FAIL com **14** diálogos, e `NewJourneyModal.tsx` **não aparece mais** na lista.

- [ ] **Step 5: Typecheck e build**

Run: `npx tsc -p tsconfig.app.json --noEmit && bun run build`
Expected: ambos passam.

- [ ] **Step 6: Conferir no navegador**

O dev server já roda em `localhost:8080` com HMR contra o banco local. Abrir Implantação → Kanban → "Nova jornada", com a janela do Chrome em altura de notebook. Confirmar: cabe inteiro sem rolar, os pares de data lado a lado, botão "Criar" visível sem rolar.

- [ ] **Step 7: Commit**

```bash
git add src/pages/onboarding/NewJourneyModal.tsx
git commit -m "refactor(onboarding): formulário de nova jornada em 2 colunas"
```

---

### Task 4: Lote configurações / WhatsApp (4 diálogos)

**Files:**
- Modify: `src/components/configuracoes/whatsapp/EditInstanceDialog.tsx:196` — 16 campos, 1445px, `max-w-[560px]` → `max-w-3xl`
- Modify: `src/components/configuracoes/whatsapp/AddInstanceDialog.tsx:162` — 13 campos, 1205px, `max-w-[500px]` → `max-w-3xl`
- Modify: `src/components/configuracoes/WhatsAppInstancesTab.tsx:554` — 12 campos, 1125px, `max-w-md` → `max-w-3xl`
- Modify: `src/components/configuracoes/whatsapp/AssignmentRuleDialog.tsx:264` — 7 campos, 726px, `max-w-[560px]` → `max-w-2xl`

**Interfaces:**
- Consumes: padrão da Task 3.
- Produces: nada que outras tarefas consumam.

**Receita (idêntica à Task 3):**

1. Subir a largura conforme a tabela acima (10–14 campos → `max-w-3xl`; 6–9 → `max-w-2xl`).
2. Trocar o wrapper do corpo (`space-y-*`) por grid:

```tsx
// antes
<div className="space-y-4 py-2">
  <div className="space-y-1.5"><Label>Campo A</Label><Input … /></div>
  <div className="space-y-1.5"><Label>Campo B</Label><Input … /></div>
  <div className="space-y-1.5"><Label>Webhook</Label><Input … /></div>
</div>

// depois
<div className="grid grid-cols-1 gap-x-4 gap-y-3 py-2 sm:grid-cols-2">
  <div className="space-y-1.5"><Label>Campo A</Label><Input … /></div>
  <div className="space-y-1.5"><Label>Campo B</Label><Input … /></div>
  {/* campo longo ocupa a linha inteira */}
  <div className="space-y-1.5 sm:col-span-2"><Label>Webhook</Label><Input … /></div>
</div>
```

3. Cada bloco label+controle vira uma célula. Campo longo (`Textarea`, URL, token, webhook) ganha `sm:col-span-2`.
4. Desfazer `grid grid-cols-2` internos — os campos viram células irmãs do grid externo.
5. Texto de ajuda de um campo fica **dentro** da célula daquele campo, não solto.
6. Não tocar em estado, handler ou query.

- [ ] **Step 1: Ler os 4 arquivos e mapear o agrupamento**

Para cada um, listar os campos na ordem em que aparecem e decidir os pares, seguindo a regra: campos relacionados juntos (host/porta, token/secret), campo longo em `sm:col-span-2`.

- [ ] **Step 2: Aplicar a receita nos 4**

- [ ] **Step 3: Guarda cai para 10**

Run: `bun run test -- dialogHeight`
Expected: FAIL com **10** diálogos; nenhum dos 4 deste lote aparece.

- [ ] **Step 4: Typecheck e build**

Run: `npx tsc -p tsconfig.app.json --noEmit && bun run build`
Expected: ambos passam.

- [ ] **Step 5: Commit**

```bash
git add src/components/configuracoes
git commit -m "refactor(configuracoes): diálogos de instância WhatsApp em 2 colunas"
```

---

### Task 5: Lote clientes / certificados (6 diálogos)

**Files:**
- Modify: `src/components/clientes/ClienteProdutosSection.tsx:1209` — 23 campos, 1174px, já `2col`, `max-w-4xl` (mantém)
- Modify: `src/components/clientes/ClienteContratosSection.tsx:639` — 20 campos, 1014px, já `2col`, `max-w-3xl` (mantém)
- Modify: `src/components/clientes/CertA1VendaModal.tsx:186` — 8 campos, 903px, `max-w-lg` → `max-w-2xl`
- Modify: `src/pages/CertificadosA1.tsx:455` — 8 campos, 903px, `max-w-lg` → `max-w-2xl`
- Modify: `src/components/clientes/MovimentosMrrModal.tsx:494` — 7 campos, 774px, `max-w-6xl` (**mantém — já é maior que o piso**)
- Modify: `src/components/clientes/NovoReajusteDialog.tsx:568` — 7 campos, 726px, `max-w-5xl` (**mantém — já é maior que o piso**)

**Interfaces:**
- Consumes: padrão da Task 3.
- Produces: nada.

**Atenção nos dois primeiros:** `ClienteProdutosSection` e `ClienteContratosSection` **já têm** `sm:grid-cols-2` e mesmo assim estouram (23 e 20 campos). Duas colunas não bastam. Nesses dois, aplicar o tratamento de diálogo grande: converter para miolo rolável com cabeçalho e rodapé fixos, no mesmo padrão que `JourneyDetailSheet.tsx:1572` já usa:

```tsx
<DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0 overflow-hidden flex flex-col">
  <DialogHeader className="m-0 px-6 py-4 border-b border-border shrink-0"> … </DialogHeader>
  <div className="flex-1 min-h-0 overflow-y-auto p-6"> … campos em 2 colunas … </div>
  <DialogFooter className="m-0 px-6 py-4 border-t border-border shrink-0"> … </DialogFooter>
</DialogContent>
```

O `m-0` no header/footer é obrigatório aqui — mesmo motivo da Task 2 Step 3. O `overflow-hidden flex-col` também é o que isenta esses dois da guarda.

**Nos outros 4:** receita normal de 2 colunas da Task 4. Em `MovimentosMrrModal` e `NovoReajusteDialog` **só o layout muda** — a largura fica como está, porque já é maior que o piso.

- [ ] **Step 1: Ler os 6 arquivos e mapear o agrupamento**

- [ ] **Step 2: Aplicar miolo rolável nos 2 grandes**

- [ ] **Step 3: Aplicar 2 colunas nos outros 4**

- [ ] **Step 4: Guarda cai para 4**

Run: `bun run test -- dialogHeight`
Expected: FAIL com **4** diálogos; nenhum deste lote aparece.

- [ ] **Step 5: Typecheck e build**

Run: `npx tsc -p tsconfig.app.json --noEmit && bun run build`
Expected: ambos passam.

- [ ] **Step 6: Conferir no navegador**

Clientes → abrir um cliente → Produtos e Contratos. Confirmar que o cabeçalho e o rodapé ficam parados enquanto o miolo rola.

- [ ] **Step 7: Commit**

```bash
git add src/components/clientes src/pages/CertificadosA1.tsx
git commit -m "refactor(clientes): diálogos de produto, contrato e certificado em 2 colunas"
```

---

### Task 6: Lote tickets / CS / KB / onboarding (4 diálogos)

**Files:**
- Modify: `src/components/cs/CSTicketForm.tsx:231` — 18 campos, 934px, já `2col`, `max-w-2xl` → **miolo rolável**, largura → `max-w-3xl`
- Modify: `src/components/configuracoes/kb/KBEditDialog.tsx:178` — 6 campos, 791px, `max-w-2xl` (mantém) → 2 colunas
- Modify: `src/components/tickets/ClassifyClosureModal.tsx:176` — 6 campos, 695px, `max-w-lg` → `max-w-2xl`
- Modify: `src/pages/onboarding/config/GenerateOperationAIDialog.tsx:202` — 7 campos, 774px, `max-w-3xl` (mantém) → 2 colunas

**Interfaces:**
- Consumes: padrão da Task 3 e o padrão de miolo rolável da Task 5.
- Produces: nada.

**`CSTicketForm` já tem 2 colunas e mesmo assim estoura com 18 campos** — mesmo caso dos dois da Task 5: vai para miolo rolável com cabeçalho e rodapé fixos.

**`KBEditDialog` tem `Textarea` de artigo** — esse campo é o corpo do artigo e ocupa `sm:col-span-2`, sempre.

- [ ] **Step 1: Ler os 4 arquivos e mapear o agrupamento**

- [ ] **Step 2: Aplicar miolo rolável no CSTicketForm**

- [ ] **Step 3: Aplicar 2 colunas nos outros 3**

- [ ] **Step 4: Guarda PASSA**

Run: `bun run test -- dialogHeight`
Expected: **PASS**. Zero diálogos acima de 690px.

- [ ] **Step 5: Typecheck e build**

Run: `npx tsc -p tsconfig.app.json --noEmit && bun run build`
Expected: ambos passam.

- [ ] **Step 6: Commit**

```bash
git add src/components/cs src/components/configuracoes/kb src/components/tickets/ClassifyClosureModal.tsx \
  src/pages/onboarding/config/GenerateOperationAIDialog.tsx
git commit -m "refactor(tickets,cs,kb): formulários em 2 colunas e miolo rolável"
```

---

### Task 7: Popover-formulário vira diálogo (4 casos)

Popover fica ancorado ao botão e não tem para onde crescer. Com 6–10 campos ele estoura a tela e passa a rolar — foi o caso do "Agendar treino" do print.

**Files:**
- Modify: `src/components/tickets/AttendancesTab.tsx:410` — 10 campos, `w-[420px]`
- Modify: `src/pages/SupportTickets.tsx:1213` — 7 campos, `w-[460px]`
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx:1670` — 6 campos, `w-96` (agendar treino, cabeçalho)
- Modify: `src/pages/onboarding/JourneyDetailSheet.tsx:2048` — 6 campos, `w-96` (**"Agendar treino"** — o do print do Pedro)

**Interfaces:**
- Consumes: base da Task 2, padrão de 2 colunas da Task 3.
- Produces: nada.

**Conversão, caso a caso:**

O `open`/`onOpenChange` do popover já existe (ex.: `addTrainingOpen` / `setAddTrainingOpen` em `JourneyDetailSheet.tsx:2042`). Reaproveitar o mesmo estado — **não criar estado novo**.

```tsx
// antes
<Popover open={addTrainingOpen} onOpenChange={setAddTrainingOpen}>
  <PopoverTrigger asChild>
    <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
      <UserPlus className="h-3 w-3" /> Agendar treino
    </Button>
  </PopoverTrigger>
  <PopoverContent className="w-96 space-y-3" align="end">
    {/* campos */}
  </PopoverContent>
</Popover>

// depois
<>
  <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
          onClick={() => setAddTrainingOpen(true)}>
    <UserPlus className="h-3 w-3" /> Agendar treino
  </Button>
  <Dialog open={addTrainingOpen} onOpenChange={setAddTrainingOpen}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Agendar treino</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {/* mesmos campos, cada um numa célula; alerta e link ocupam sm:col-span-2 */}
      </div>
      <DialogFooter>
        {/* mesmos botões, sem alterar o onClick */}
      </DialogFooter>
    </DialogContent>
  </Dialog>
</>
```

Regras desta conversão:

- **Todo handler `onClick`/`onValueChange` é copiado sem alteração.** Nenhuma lógica muda.
- O `Button` que fechava o popover continua chamando o mesmo `setXOpen(false)`.
- O alerta de contexto (`scheduleAlert` em `JourneyDetailSheet.tsx:2049`) e o campo "Link do agendamento" ocupam `sm:col-span-2`.
- Os botões de ação (`Concluir onboarding e iniciar Implantação` / `Só agendar, manter em Onboarding`) vão para o `DialogFooter`.
- `JourneyDetailSheet` já importa `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`. Conferir se falta `DialogFooter` no import — nos outros 3 arquivos, conferir todos os imports.

- [ ] **Step 1: Converter os 4**

- [ ] **Step 2: Confirmar que não sobrou popover-formulário**

Run:
```bash
node -e '
const fs=require("fs"),path=require("path");const files=[];
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
if(e.isDirectory())w(p);else if(e.name.endsWith(".tsx"))files.push(p);}})("src");
let n=0;
for(const f of files){const s=fs.readFileSync(f,"utf8");let i=0;
 while((i=s.indexOf("<PopoverContent",i))>=0){const end=s.indexOf("</PopoverContent>",i);if(end<0)break;
  const b=s.slice(i,end),c=re=>(b.match(re)||[]).length;i=end+17;
  const campos=c(/<Input[\s>]/g)+c(/<SelectTrigger[\s>]/g)+c(/<Textarea[\s>]/g)+c(/<Switch[\s>]/g)+c(/<Checkbox[\s>]/g);
  if(campos>=4){n++;console.log(campos+" campos  "+f.replace("src/",""));}}}
console.log("popover-formulario restante:",n);'
```
Expected: `popover-formulario restante: 0`

- [ ] **Step 3: Guarda continua passando**

Run: `bun run test -- dialogHeight`
Expected: **PASS**. Os 4 diálogos novos entram na contagem — se algum passar de 690px, aplicar 2 colunas nele.

- [ ] **Step 4: Suíte inteira, typecheck e build**

Run: `bun run test && npx tsc -p tsconfig.app.json --noEmit && bun run build`
Expected: os três passam.

- [ ] **Step 5: Conferir no navegador**

Onboarding → abrir uma jornada → "Agendar treino". Confirmar que abre como diálogo centralizado, com todos os campos visíveis (incluindo Título e Data/hora, que eram os cortados) e sem rolagem.

- [ ] **Step 6: Commit**

```bash
git add src/components/tickets/AttendancesTab.tsx src/pages/SupportTickets.tsx \
  src/pages/onboarding/JourneyDetailSheet.tsx
git commit -m "refactor(ui): popover com formulário vira diálogo"
```

---

## Verificação final

Depois da Task 7:

- [ ] `bun run test` — suíte inteira passa, guarda de altura em zero
- [ ] `npx tsc -p tsconfig.app.json --noEmit` — limpo
- [ ] `bun run build` — passa
- [ ] `git log --oneline -7` — 7 commits, um por tarefa, revertíveis isoladamente
- [ ] Render headless a 1280×690 de "Nova jornada" e "Agendar treino", confirmando que cabem sem rolagem

**Não publicar.** Deploy e linha no `CHANGELOG.md` só quando o Alexandre pedir. Quando pedir, a linha é 🔧 Correção, em linguagem de cliente — algo como "Telas de cadastro e agendamento agora cabem inteiras em notebook, sem precisar diminuir o zoom".
