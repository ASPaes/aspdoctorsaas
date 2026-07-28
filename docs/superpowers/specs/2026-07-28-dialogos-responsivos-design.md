# Diálogos e modais responsivos em notebook 13"/14"

**Data:** 28/07/2026
**Origem:** Pedro (Digi Office) precisava reduzir o zoom do Chrome para 60% para usar a tela de Onboarding/Implantação.

---

## 1. Problema

O sintoma reportado foi "a tela não é responsiva". Não é a página — são os **primitivos de overlay**.

`DialogContent` ([src/components/ui/dialog.tsx](../../../src/components/ui/dialog.tsx)) posiciona o modal com `top-50% + translate-y--50%` e **não tinha `max-height` nem `overflow`**. Conteúdo mais alto que a viewport é cortado **nas duas pontas**, sem barra de rolagem. Reduzir o zoom era a única saída.

Medição real do modal "Nova jornada" (Chrome headless, viewport de 603px, equivalente a um 13" com barra de favoritos):

| | altura | topo | base | rola? |
|---|---|---|---|---|
| antes | 728px | **−62** | **666** | **não** |
| depois do cap | 571px | 16 | 587 | sim |

`PopoverContent` tinha o mesmo defeito: no popover "Agendar treino" (`w-96`, 6 campos), os campos **Título** e **Data/hora** ficavam acima da borda da tela.

### Causa de fundo

Notebook é **largo e baixo** (~1440×770 úteis). Os formulários são **estreitos e altos** (448px × 730px). O layout briga com o formato da tela. Cap de altura resolve o corte, mas troca por rolagem — e **rolar formulário é UX ruim**. A correção real é trocar altura por largura.

---

## 2. Inventário medido

113 `DialogContent` no repo, 87 com campos de formulário.

| Grupo | Qtd | Tratamento |
|---|---|---|
| ≤ 5 campos | 66 | Só a base. Já cabem. |
| 6–14 campos | 15 | 2 colunas + alarga |
| > 14 campos | 6 | 2 colunas + rola só o miolo |
| `PopoverContent` ≥ 4 campos | 4 | Vira `Dialog` |

Fatos que definem a arquitetura:

- **107/113 usam `DialogHeader`** → dá para prender o cabeçalho na base.
- **66/113 usam `DialogFooter`** → 47 montam os botões à mão; esses não ganham rodapé fixo de graça.
- **11 usam `p-0`** com layout próprio (`overflow-hidden flex flex-col`) → já resolvidos, ficam intocados.

---

## 3. Desenho

### Camada 1 — Base: 1 arquivo cobre os 113

Em `src/components/ui/dialog.tsx`:

| Peça | Muda para | Efeito |
|---|---|---|
| `DialogContent` | `max-h-[calc(100dvh-2rem)] overflow-y-auto` | nunca mais corta *(já aplicado)* |
| `DialogHeader` | `sticky top-0 z-10` + fundo opaco + gutter | título e **X nunca somem** |
| `DialogFooter` | `sticky bottom-0 z-10` + fundo opaco + gutter | **Salvar/Criar sempre visível** |

`position: sticky` dentro de um container com `overflow-y-auto` gruda no scrollport. Isso dá cabeçalho e rodapé fixos com **zero mudança estrutural** nos consumidores — nenhum dos 113 precisa ser reescrito.

Detalhes obrigatórios:

- O gutter (`-mx-6 px-6`) é necessário porque `DialogContent` tem `p-6`: sem ele, o conteúdo rolando aparece pelas laterais do cabeçalho fixo.
- `DialogContent` é `grid gap-4`. O gap de 16px abaixo do cabeçalho fixo é transparente e deixaria o conteúdo passar por trás. Absorver com `pb-4 -mb-4` no header (e `pt-4 -mt-4` no footer), que cobre o gap com o fundo sem alterar o layout.
- Fundo precisa ser opaco (`bg-background`), não translúcido.

**Por que não quebra os 11 com `p-0`:** eles setam `overflow-hidden`, e o `tailwind-merge` faz a classe do consumidor vencer a da base (verificado). Sem scroll no container, `sticky` fica inerte.

### Camada 2 — Colunas (15 + 6 arquivos)

| Campos | Layout | Largura |
|---|---|---|
| ≤ 5 | 1 coluna | mantém |
| 6–9 | `grid-cols-1 sm:grid-cols-2` | mínimo `max-w-2xl` |
| 10–14 | `grid-cols-1 sm:grid-cols-2` | mínimo `max-w-3xl` |
| > 14 | `grid-cols-1 sm:grid-cols-2` + miolo rolável | mantém a largura atual |

**Largura é piso, nunca teto: nunca reduzir a largura atual de um diálogo.** `MovimentosMrrModal` (`max-w-6xl`) e `NovoReajusteDialog` (`max-w-5xl`) já são mais largos que o alvo — nesses, só o layout em colunas muda.

`sm:` garante volta a 1 coluna em tela estreita.

**Regra de agrupamento:** campos relacionados ficam lado a lado (Início planejado / Go-live previsto). Campo longo (Assunto, Observação, Textarea) ocupa a linha inteira com `sm:col-span-2`. Nunca quebrar um par lógico entre colunas.

Alvo do "Nova jornada": **730px → ~420px**.

#### Lote 6–14 campos (2 colunas + alarga)

| Campos | Arquivo |
|---|---|
| 13 | `components/configuracoes/whatsapp/AddInstanceDialog.tsx:162` |
| 12 | `components/configuracoes/WhatsAppInstancesTab.tsx:554` |
| 8 | `components/clientes/CertA1VendaModal.tsx:186` |
| 8 | `pages/CertificadosA1.tsx:455` |
| 7 | `components/clientes/MovimentosMrrModal.tsx:494` |
| 7 | `components/clientes/NovoReajusteDialog.tsx:568` |
| 7 | `components/configuracoes/ProdutosModulosTab.tsx:438` |
| 7 | `components/configuracoes/whatsapp/AssignmentRuleDialog.tsx:264` |
| 7 | `pages/onboarding/NewJourneyModal.tsx:217` |
| 7 | `pages/onboarding/config/GenerateOperationAIDialog.tsx:202` |
| 6 | `components/clientes/ContatosAdicionaisModal.tsx:93` |
| 6 | `components/configuracoes/CacDespesasTab.tsx:305` |
| 6 | `components/configuracoes/kb/KBEditDialog.tsx:178` |
| 6 | `components/tickets/ClassifyClosureModal.tsx:176` |
| 6 | `components/tickets/CsatReportModal.tsx:260` |

#### Lote > 14 campos (2 colunas + miolo rolável)

| Campos | Arquivo | Observação |
|---|---|---|
| 27 | `pages/onboarding/JourneyDetailSheet.tsx:1572` | já tem miolo rolável e `lg:grid-cols-2`; só ajustar breakpoint |
| 23 | `components/clientes/ClienteProdutosSection.tsx:1209` | |
| 20 | `components/clientes/ClienteContratosSection.tsx:639` | |
| 20 | `components/tickets/CreateSupportTicketModal.tsx:878` | `p-0`, layout próprio |
| 18 | `components/cs/CSTicketForm.tsx:231` | |
| 16 | `components/configuracoes/whatsapp/EditInstanceDialog.tsx:196` | |

### Camada 3 — Popover-formulário vira diálogo

Popover fica ancorado ao botão e não tem para onde crescer.

**A regra não é contagem de campos, é propósito.** Contar campos foi a primeira
ideia e estava errada: quebrava painéis de filtro que funcionam bem como popover.

| Propósito | Tratamento |
|---|---|
| **Cria ou edita** um registro | vira `Dialog` |
| **Filtra** uma lista | continua `Popover` (rápido, ancorado, não bloqueia a tela) |

| Campos | Arquivo | O que é | Decisão |
|---|---|---|---|
| 6 | `pages/onboarding/JourneyDetailSheet.tsx:1670` | agendar treino (cabeçalho) | → `Dialog` |
| 6 | `pages/onboarding/JourneyDetailSheet.tsx:2048` | **"Agendar treino"** — o do print do Pedro | → `Dialog` |
| 10 | `components/tickets/AttendancesTab.tsx:410` | painel de **Filtros** | fica popover |
| 7 | `pages/SupportTickets.tsx:1213` | painel de **Filtros** | fica popover |

Os dois painéis de filtro já cabem: largura fixa (420/460px), grid de 2 colunas,
~5 linhas. Com o cap de altura da base, não são mais cortados.

O formulário de agendar treino estava **duplicado** nos dois popovers do
`JourneyDetailSheet`. Virou uma variável `scheduleFields`, no mesmo padrão que o
arquivo já usava para `scheduleAlert` e `scheduleButtons`.

Popovers com < 4 campos continuam popover, com o cap de altura já aplicado.

### Guarda anti-regressão

`scripts/check-dialog-height.mjs`: varre o repo, estima a altura de cada `DialogContent` por contagem de campos e **falha se passar de 690px** (13" com barra de favoritos).

Honestidade sobre o que ele é: **heurística calibrada**, não layout real. A estimativa deu 600px onde a medição real deu 728px — fator de correção **1.21**, aplicado no script. Pega regressão grosseira (alguém empilhar 10 campos num `max-w-md`), não erro de pixel. Vale porque é a única forma de cobrir 87 diálogos sem abrir 87 telas, e porque trava o problema de voltar via Lovable.

---

## 4. O que NÃO muda

- **Os 66 diálogos de ≤5 campos não viram 2 colunas.** Formulário curto lê melhor em 1 coluna; 2 colunas ali pioraria. Eles só herdam a base.
- Os 11 com `p-0` e layout próprio ficam intocados.
- Nenhuma mudança de comportamento, dado, RPC ou edge function. É só layout.

---

## 5. Verificação

1. `npx tsc -p tsconfig.app.json --noEmit` — o `tsc` da raiz não checa nada (`files: []`).
2. `bun run build`.
3. `node scripts/check-dialog-height.mjs` — 0 diálogos acima do orçamento.
4. Render headless (Chrome `--headless --screenshot`) do "Nova jornada" e do "Agendar treino" a 1280×690, confirmando que cabem sem rolagem.
5. Conferir que as classes novas entraram no CSS gerado (`dist/assets/index-*.css`).

## 6. Entrega

Um commit por camada, para permitir reverter uma sem perder as outras:

1. `fix(ui): diálogos e popovers não são mais cortados em tela baixa` — base
2. `feat(ui): cabeçalho e rodapé fixos nos diálogos` — sticky
3. `refactor(ui): formulários de 6+ campos em 2 colunas` — camada 2
4. `refactor(ui): popover-formulário vira diálogo` — camada 3
5. `chore: guarda de altura de diálogo` — script

Validação em produção com os usuários, por decisão do Alexandre. Publicação e `CHANGELOG.md` só quando ele pedir.
