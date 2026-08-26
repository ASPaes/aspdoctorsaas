# Templates de Implantação por produto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dois templates prontos ("PDV Legal" e "Software genérico") que um tenant importa na tela `Configuração · Implantação` para nascer com pipelines, etapas, checklist e catálogos configurados.

**Architecture:** os templates são constantes TypeScript versionadas no repositório. A importação reaproveita a RPC `apply_onboarding_blueprint` que já existe (usada pelo "Gerar com IA"), estendida com campos **opcionais** para grupos de checklist, vínculo grupo→tipo de demanda, flags de etapa e `produto_id`. A tela é um diálogo novo com o mesmo padrão de revisão por checkbox do diálogo de IA.

**Tech Stack:** React 18 + TypeScript + Vite · shadcn/ui · TanStack Query · Supabase (Postgres, RPC `SECURITY DEFINER`) · Vitest · Postgres local em Docker para os testes SQL.

**Spec:** `docs/superpowers/specs/2026-08-26-templates-implantacao-por-produto-design.md`

## Global Constraints

- **pt-BR em tudo que aparece na tela.** Nada de string em inglês na UI.
- **Nunca rodar `supabase db push`, `db reset` ou tratar `db diff` como verdade.** Migration é aplicada em produção pelo Alexandre, via SQL Editor / `apply_migration`, e só com OK explícito dele.
- **Testes SQL rodam no Docker local**, nunca em produção: `scripts/sql-tests/run-com-migration.sh <migration> <teste>` — ele roda migration + teste na mesma transação e dá `ROLLBACK` no fim. O banco local tem uma cópia real de produção que **não pode ser alterada**.
- **Sem `@testing-library/react`** — o peer `@testing-library/dom` não está instalado. Testes de componente usam `createRoot` + `act`, como em `src/pages/onboarding/config/TrilhoSummary.test.tsx`.
- **Typecheck é `bunx tsc -p tsconfig.app.json`.** O `tsc` da raiz não checa nada.
- **Não usar `git add -A`.** Há sessões paralelas no mesmo repositório; adicionar só os arquivos da task.
- **Nada de `supabase/functions/**` neste trabalho.** Se algum arquivo dessa pasta aparecer no `git status`, é de outra sessão — não commitar.
- SLA é medido em **horário útil**: 1 dia = 480 minutos (`MIN_POR_DIA_UTIL` em `src/pages/onboarding/config/utils.ts`).
- Textos de checklist do template PDV Legal vão **literais**, com os erros de digitação da Digi Office ("Conferencia", "Multiplicas formas de pagamento", "Validar modelo das maquininha"). Corrigir cria divergência silenciosa com a operação real.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/pages/onboarding/config/templates/types.ts` | tipos `OnboardingTemplate`, `TemplateBlueprint`, `TemplateStage`, `TemplateChecklistGroup` |
| `src/pages/onboarding/config/templates/pdvLegal.ts` | conteúdo do template PDV Legal |
| `src/pages/onboarding/config/templates/softwareGenerico.ts` | conteúdo do template genérico |
| `src/pages/onboarding/config/templates/index.ts` | `ONBOARDING_TEMPLATES` + `resumoTemplate()` |
| `src/pages/onboarding/config/templates/apply.ts` | funções puras: sufixo por colisão de nome, escolha de produto, filtro pela seleção do usuário |
| `src/pages/onboarding/config/ApplyTemplateDialog.tsx` | o diálogo (escolha → produto → revisão → aplicar) |
| `src/pages/onboarding/OnboardingConfigPage.tsx` | botão "Usar template" no cabeçalho |
| `supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql` | `CREATE OR REPLACE` da RPC |
| `scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql` | asserções da RPC estendida |

---

### Task 1: Tipos e template PDV Legal

**Files:**
- Create: `src/pages/onboarding/config/templates/types.ts`
- Create: `src/pages/onboarding/config/templates/pdvLegal.ts`
- Create: `src/pages/onboarding/config/templates/index.ts`
- Test: `src/pages/onboarding/config/templates/pdvLegal.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `OnboardingTemplate`, `TemplateBlueprint`, `TemplateStage`, `TemplateChecklistGroup`, `PDV_LEGAL_TEMPLATE`, `ONBOARDING_TEMPLATES: OnboardingTemplate[]`, `resumoTemplate(t): { pipelines: number; etapas: number; itens: number }`.

- [ ] **Step 1: Escrever o teste que falha**

`src/pages/onboarding/config/templates/pdvLegal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PDV_LEGAL_TEMPLATE } from "./pdvLegal";
import { resumoTemplate } from "./index";

const stages = PDV_LEGAL_TEMPLATE.blueprint.pipelines.flatMap((p) => p.stages);
const groups = stages.flatMap((s) => s.checklist_groups ?? []);
const itens = groups.flatMap((g) => g.itens);

describe("template PDV Legal", () => {
  it("tem os 2 pipelines de PDV, um por jornada", () => {
    const nomes = PDV_LEGAL_TEMPLATE.blueprint.pipelines.map((p) => `${p.fase}:${p.nome}`);
    expect(nomes).toEqual(["onboarding:Onboarding PDV", "implantacao:Implantação PDV"]);
  });

  it("tem 10 etapas, 9 grupos e 54 itens de checklist", () => {
    expect(resumoTemplate(PDV_LEGAL_TEMPLATE)).toEqual({ pipelines: 2, etapas: 10, itens: 54 });
    expect(groups).toHaveLength(9);
    expect(itens).toHaveLength(54);
  });

  it("na Implantação a etapa inicial é 'Treinamento Marcado', a 3a da lista", () => {
    const impl = PDV_LEGAL_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages.findIndex((s) => s.is_initial)).toBe(2);
    expect(impl.stages[2].nome).toBe("Treinamento Marcado");
    expect(impl.stages[2].inicia_sla).toBe(true);
  });

  it("a janela de SLA fecha na última etapa da Implantação", () => {
    const impl = PDV_LEGAL_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages.filter((s) => s.encerra_sla).map((s) => s.nome)).toEqual(["Sub-tickets Finalizados"]);
    expect(impl.stages.filter((s) => s.is_final).map((s) => s.nome)).toEqual(["Sub-tickets Finalizados"]);
  });

  it("'Pendente Agendar' é quem recebe o treino faltado de volta", () => {
    const impl = PDV_LEGAL_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages.filter((s) => s.retorno_no_show).map((s) => s.nome)).toEqual(["Pendente Agendar"]);
  });

  it("não leva nada do cliente Nutrebem", () => {
    expect(JSON.stringify(PDV_LEGAL_TEMPLATE).toLowerCase()).not.toContain("nutrebem");
  });

  it("todo grupo de checklist aponta para um tipo de demanda do próprio template", () => {
    const demandas = new Set(PDV_LEGAL_TEMPLATE.blueprint.demand_types.map((d) => d.nome));
    for (const g of groups) {
      expect(g.demandas?.length ?? 0).toBeGreaterThan(0);
      for (const d of g.demandas!) expect(demandas.has(d)).toBe(true);
    }
  });

  it("sugere o produto PDV Legal", () => {
    expect(PDV_LEGAL_TEMPLATE.produto_sugerido).toBe("PDV Legal");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bunx vitest run src/pages/onboarding/config/templates/pdvLegal.test.ts`
Expected: FAIL — `Failed to resolve import "./pdvLegal"`.

- [ ] **Step 3: Criar `types.ts`**

```ts
/**
 * Formato dos templates de operação do onboarding/implantação.
 *
 * É um superset do blueprint que a IA gera (`generate-onboarding-blueprint`):
 * todo campo além de `nome`/`sla_minutos`/`checklist` é OPCIONAL, para que a RPC
 * `apply_onboarding_blueprint` continue aceitando o blueprint da IA sem mudança.
 */

export type TemplateChecklistItem = { texto: string; is_required: boolean };

export type TemplateChecklistGroup = {
  nome: string;
  /** Nomes de tipos de demanda. Quem não existir no tenant é criado na importação. */
  demandas?: string[];
  itens: TemplateChecklistItem[];
};

export type TemplateStage = {
  nome: string;
  sla_minutos: number | null;
  pausa_sla?: boolean;
  cor?: string;
  is_initial?: boolean;
  is_final?: boolean;
  inicia_sla?: boolean;
  encerra_sla?: boolean;
  retorno_no_show?: boolean;
  visible_sections?: string[];
  /** Checklist plano — formato antigo, o que a IA gera. */
  checklist?: TemplateChecklistItem[];
  /** Checklist agrupado. Se vier, o `checklist` plano da mesma etapa é ignorado. */
  checklist_groups?: TemplateChecklistGroup[];
};

export type TemplatePipeline = {
  fase: "onboarding" | "implantacao";
  nome: string;
  descricao: string | null;
  stages: TemplateStage[];
};

export type TemplateBlueprint = {
  pipelines: TemplatePipeline[];
  demand_types: { nome: string; descricao: string | null }[];
  training_types: { nome: string; conta_como_pdv: boolean }[];
  pause_reasons: { nome: string }[];
  accounting_fields: { nome: string; tipo: "text" | "number" | "date" | "select"; opcoes: string[] | null }[];
  vendor_return_reasons: { nome: string; atribuivel_vendedor: boolean }[];
};

export type OnboardingTemplate = {
  id: string;
  nome: string;
  descricao: string;
  /** Nome do produto a pré-selecionar na tela, quando o tenant tiver um com esse nome. */
  produto_sugerido?: string;
  blueprint: TemplateBlueprint;
};
```

- [ ] **Step 4: Criar `pdvLegal.ts`**

```ts
import type { OnboardingTemplate } from "./types";

/**
 * Espelho da operação de PDV Legal da Digi Office, sem nada do cliente Nutrebem
 * (grupos "Recolhimento de Dados", "Cadastro Fiscal - Nutrebem" e "Finalizar Ticket",
 * e o tipo de demanda "Novo Cliente - Nutrebem" ficaram de fora de propósito).
 *
 * Os textos vão LITERAIS, inclusive os erros de digitação. Corrigir aqui criaria
 * divergência silenciosa entre o template e a operação real deles.
 */

const SECOES = [
  "participantes", "timeline", "pausas", "modulos", "contabilidade",
  "treinos", "checklist", "atendimentos", "eventos", "anexos",
];
const SECOES_COM_ACOMP = [...SECOES, "acompanhamento"];

export const PDV_LEGAL_TEMPLATE: OnboardingTemplate = {
  id: "pdv-legal",
  nome: "PDV Legal",
  descricao: "Operação completa de PDV: onboarding com cadastro fiscal e implantação com checklist de treinamento por frente (balcão, mesa, retaguarda).",
  produto_sugerido: "PDV Legal",
  blueprint: {
    pipelines: [
      {
        fase: "onboarding",
        nome: "Onboarding PDV",
        descricao: "Da venda até o treinamento agendado.",
        stages: [
          {
            nome: "Novo Cliente",
            sla_minutos: 120,
            cor: "#0EA5E9",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
          },
          {
            nome: "Conferência",
            sla_minutos: 120,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Checklist",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Conferencia", is_required: true },
                  { texto: "Mensagem de boas vindas", is_required: true },
                ],
              },
            ],
          },
          {
            nome: "Recolhimento Dados",
            sla_minutos: 480,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Validações",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Validar modelo das maquininha", is_required: true },
                  { texto: "Validar produtos com o cliente.", is_required: true },
                  { texto: "Liberação do app PDV Legal", is_required: true },
                  { texto: "Anexar print - Valid Produtos", is_required: false },
                ],
              },
            ],
          },
          {
            nome: "Cadastro Produtos",
            sla_minutos: 960,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Cadastro Fiscal",
                demandas: ["Novo Cliente", "Mudança Regime Fiscal"],
                itens: [
                  { texto: "Lançar licença no OEM", is_required: false },
                  { texto: "Fazer a planilha de produtos", is_required: false },
                  { texto: "Importar cadastro", is_required: true },
                  { texto: "Configurar grupos", is_required: true },
                  { texto: "Configurar usuários", is_required: true },
                  { texto: "Configurar formas de pagamento", is_required: true },
                  { texto: "Configurar filiais", is_required: true },
                  { texto: "Configurar perfil PDV", is_required: true },
                  { texto: "Configurar Fiscal", is_required: false },
                  { texto: "Envio e-mail XML contabilidade", is_required: false },
                  { texto: "Colocar dados do invoicy no Doctor Saas", is_required: false },
                ],
              },
            ],
          },
          {
            nome: "Marcar treinamento PDV",
            sla_minutos: 480,
            cor: "#0EA5E9",
            is_final: true,
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Marcação de Treinamento",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Validar PDV nas maquininhas", is_required: true },
                  { texto: "Enviar orientações sobre o agendamento", is_required: true },
                  { texto: "Enviar link para agendamento", is_required: false },
                ],
              },
            ],
          },
        ],
      },
      {
        fase: "implantacao",
        nome: "Implantação PDV",
        descricao: "Do treinamento agendado ao encerramento dos sub-tickets.",
        stages: [
          {
            nome: "Pendências",
            sla_minutos: 0,
            cor: "#EF4444",
            visible_sections: SECOES,
          },
          {
            nome: "Pendente Agendar",
            sla_minutos: 0,
            cor: "#F59E0B",
            retorno_no_show: true,
            visible_sections: SECOES_COM_ACOMP,
          },
          {
            nome: "Treinamento Marcado",
            sla_minutos: 120,
            cor: "#22C55E",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
            checklist_groups: [
              {
                nome: "Checklist PDV",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Fundo de caixa | Sangria", is_required: true },
                  { texto: "Encerramento de caixa", is_required: true },
                ],
              },
              {
                nome: "Check List Balcão",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Cancelamento de item", is_required: true },
                  { texto: "Cancelamento total venda", is_required: true },
                  { texto: "Desconto", is_required: true },
                  { texto: "Recebimento", is_required: true },
                  { texto: "Multiplicas formas de pagamento", is_required: true },
                ],
              },
              {
                nome: "Check List Mesa",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Emissão de conta", is_required: false },
                  { texto: "Função fecha | paga", is_required: false },
                  { texto: "Nomear mesa", is_required: false },
                  { texto: "Mapa de mesa", is_required: false },
                  { texto: "Cores das mesas", is_required: false },
                  { texto: "Transferência", is_required: false },
                  { texto: "Reabertura", is_required: false },
                  { texto: "Pagamento Parcial", is_required: false },
                  { texto: "Processo 10%", is_required: false },
                ],
              },
              {
                nome: "Checklist Gestão | Retaguarda",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Enviar login do gestão", is_required: true },
                  { texto: "Valorizar 100% online", is_required: true },
                  { texto: "Cadastro grupo produtos", is_required: true },
                  { texto: "Cadastro produtos (duplicar)", is_required: true },
                  { texto: "Tabela de preços", is_required: true },
                  { texto: "Cadastro usuário PDV", is_required: true },
                ],
              },
              {
                nome: "Checklist Geral",
                demandas: ["Novo Cliente"],
                itens: [
                  { texto: "Alinhamento agenda no início", is_required: true },
                  { texto: "Ressaltar benefícios pg integrado", is_required: true },
                  { texto: "Valorizar já cadastramos produtos", is_required: true },
                  { texto: "Marcar produtos como favorito", is_required: true },
                  { texto: "Importância Modificadores", is_required: true },
                  { texto: "Verificar PIX integrado", is_required: true },
                  { texto: "Teste de estresse no final", is_required: true },
                  { texto: "Apresentação final PDF", is_required: true },
                  { texto: "Enviar vídeos no wpp", is_required: true },
                  { texto: "Enviar contato do suporte", is_required: true },
                  { texto: "Enviar pesquisa satisfação", is_required: true },
                  { texto: "Enviar gravação treinamento", is_required: true },
                ],
              },
            ],
          },
          {
            nome: "No-Show",
            sla_minutos: 0,
            cor: "#F59E0B",
            visible_sections: SECOES,
          },
          {
            nome: "Sub-tickets Finalizados",
            sla_minutos: 0,
            cor: "#22C55E",
            is_final: true,
            encerra_sla: true,
            visible_sections: SECOES,
          },
        ],
      },
    ],
    demand_types: [
      { nome: "Novo Cliente", descricao: null },
      { nome: "Mudança Regime Fiscal", descricao: null },
      { nome: "Up-Sell", descricao: null },
      { nome: "Down-Sell", descricao: null },
      { nome: "Treinamento Extra", descricao: null },
      { nome: "Mudança de CNPJ", descricao: null },
      { nome: "Mudança Servidor", descricao: null },
      { nome: "Troca de adquirente", descricao: null },
    ],
    training_types: [
      { nome: "Treinamento PDV", conta_como_pdv: true },
      { nome: "Segundo Treinamento", conta_como_pdv: false },
      { nome: "Estoque", conta_como_pdv: false },
      { nome: "Financeiro", conta_como_pdv: false },
      { nome: "NF-e", conta_como_pdv: false },
      { nome: "Delivery Legal", conta_como_pdv: false },
      { nome: "Fidelidade Legal", conta_como_pdv: false },
      { nome: "Conta Assinada", conta_como_pdv: false },
      { nome: "Auto Atendimento Food", conta_como_pdv: false },
      { nome: "iFood/99", conta_como_pdv: false },
      { nome: "Mudança para Servidor Legal", conta_como_pdv: false },
      { nome: "Mudança de CNPJ", conta_como_pdv: false },
    ],
    pause_reasons: [
      { nome: "Aguardando contabilidade" },
      { nome: "Aguardando inauguração" },
      { nome: "Aguardando maquininha" },
      { nome: "Configuração Impressora" },
    ],
    accounting_fields: [
      { nome: "Nome Contabilidade", tipo: "text", opcoes: null },
      { nome: "E-mail Contabilidade", tipo: "text", opcoes: null },
      { nome: "Telefone Contabilidade", tipo: "number", opcoes: null },
      { nome: "Anexo Certificado Digital", tipo: "text", opcoes: null },
      { nome: "Senha Certificado", tipo: "text", opcoes: null },
      { nome: "ID CSC", tipo: "number", opcoes: null },
      { nome: "CSC NFC-e", tipo: "text", opcoes: null },
      { nome: "Token IBPT", tipo: "text", opcoes: null },
    ],
    vendor_return_reasons: [
      { nome: "Dados errados", atribuivel_vendedor: true },
      { nome: "Faltou dados", atribuivel_vendedor: true },
      { nome: "Falta de retorno do cliente", atribuivel_vendedor: true },
    ],
  },
};
```

- [ ] **Step 5: Criar `index.ts`**

```ts
import type { OnboardingTemplate } from "./types";
import { PDV_LEGAL_TEMPLATE } from "./pdvLegal";

export * from "./types";

export const ONBOARDING_TEMPLATES: OnboardingTemplate[] = [PDV_LEGAL_TEMPLATE];

export function resumoTemplate(t: OnboardingTemplate): { pipelines: number; etapas: number; itens: number } {
  const stages = t.blueprint.pipelines.flatMap((p) => p.stages);
  const itens = stages.reduce(
    (acc, s) =>
      acc +
      (s.checklist_groups
        ? s.checklist_groups.reduce((a, g) => a + g.itens.length, 0)
        : s.checklist?.length ?? 0),
    0,
  );
  return { pipelines: t.blueprint.pipelines.length, etapas: stages.length, itens };
}
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `bunx vitest run src/pages/onboarding/config/templates/pdvLegal.test.ts`
Expected: PASS — 8 testes.

Se "10 etapas, 9 grupos e 54 itens" falhar, conferir a contagem antes de mexer no teste: são 20 itens no Onboarding (2+4+11+3) e 34 na Implantação (2+5+9+6+12).

- [ ] **Step 7: Typecheck e commit**

```bash
bunx tsc -p tsconfig.app.json
git add src/pages/onboarding/config/templates/types.ts \
        src/pages/onboarding/config/templates/pdvLegal.ts \
        src/pages/onboarding/config/templates/index.ts \
        src/pages/onboarding/config/templates/pdvLegal.test.ts
git commit -m "feat(onboarding): template de operacao PDV Legal"
```

---

### Task 2: Template "Software genérico"

**Files:**
- Create: `src/pages/onboarding/config/templates/softwareGenerico.ts`
- Modify: `src/pages/onboarding/config/templates/index.ts`
- Test: `src/pages/onboarding/config/templates/softwareGenerico.test.ts`

**Interfaces:**
- Consumes: `OnboardingTemplate` e `resumoTemplate` da Task 1.
- Produces: `SOFTWARE_GENERICO_TEMPLATE`; `ONBOARDING_TEMPLATES` passa a ter 2 itens, nesta ordem: PDV Legal, Software genérico.

- [ ] **Step 1: Escrever o teste que falha**

`src/pages/onboarding/config/templates/softwareGenerico.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SOFTWARE_GENERICO_TEMPLATE } from "./softwareGenerico";
import { ONBOARDING_TEMPLATES, resumoTemplate } from "./index";

describe("template Software genérico", () => {
  it("tem 2 pipelines, 8 etapas e 21 itens de checklist", () => {
    expect(resumoTemplate(SOFTWARE_GENERICO_TEMPLATE)).toEqual({ pipelines: 2, etapas: 8, itens: 21 });
  });

  it("usa checklist plano, sem grupo por demanda", () => {
    const stages = SOFTWARE_GENERICO_TEMPLATE.blueprint.pipelines.flatMap((p) => p.stages);
    expect(stages.every((s) => s.checklist_groups === undefined)).toBe(true);
    expect(stages.every((s) => (s.checklist?.length ?? 0) > 0)).toBe(true);
  });

  it("abre e fecha a janela de SLA na Implantação", () => {
    const impl = SOFTWARE_GENERICO_TEMPLATE.blueprint.pipelines[1];
    expect(impl.stages[0].inicia_sla).toBe(true);
    expect(impl.stages[0].is_initial).toBe(true);
    expect(impl.stages[impl.stages.length - 1].encerra_sla).toBe(true);
    expect(impl.stages[impl.stages.length - 1].is_final).toBe(true);
  });

  it("não sugere produto", () => {
    expect(SOFTWARE_GENERICO_TEMPLATE.produto_sugerido).toBeUndefined();
  });

  it("entra no catálogo depois do PDV Legal", () => {
    expect(ONBOARDING_TEMPLATES.map((t) => t.id)).toEqual(["pdv-legal", "software-generico"]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bunx vitest run src/pages/onboarding/config/templates/softwareGenerico.test.ts`
Expected: FAIL — `Failed to resolve import "./softwareGenerico"`.

- [ ] **Step 3: Criar `softwareGenerico.ts`**

```ts
import type { OnboardingTemplate } from "./types";

/**
 * Desenho enxuto para quem não vende PDV: 4 etapas por jornada e checklist curto,
 * sem grupo por tipo de demanda. Serve de ponto de partida, não de operação pronta.
 */

const SECOES = [
  "participantes", "timeline", "pausas", "modulos", "contabilidade",
  "treinos", "checklist", "atendimentos", "eventos", "anexos",
];

export const SOFTWARE_GENERICO_TEMPLATE: OnboardingTemplate = {
  id: "software-generico",
  nome: "Software genérico",
  descricao: "Ponto de partida simples para qualquer software: 4 etapas por jornada, checklist curto e catálogos mínimos.",
  blueprint: {
    pipelines: [
      {
        fase: "onboarding",
        nome: "Onboarding",
        descricao: "Da venda até o treinamento agendado.",
        stages: [
          {
            nome: "Novo cliente",
            sla_minutos: 240,
            cor: "#0EA5E9",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Enviar mensagem de boas-vindas", is_required: true },
              { texto: "Confirmar contato do responsável", is_required: true },
            ],
          },
          {
            nome: "Conferência do pedido",
            sla_minutos: 480,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist: [
              { texto: "Conferir o que foi vendido", is_required: true },
              { texto: "Confirmar módulos contratados", is_required: true },
              { texto: "Registrar particularidades do cliente", is_required: false },
            ],
          },
          {
            nome: "Coleta de dados",
            sla_minutos: 960,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist: [
              { texto: "Coletar dados cadastrais", is_required: true },
              { texto: "Coletar acessos e credenciais", is_required: true },
              { texto: "Receber base para migração", is_required: false },
              { texto: "Validar infraestrutura do cliente", is_required: true },
            ],
          },
          {
            nome: "Agendar treinamento",
            sla_minutos: 480,
            cor: "#0EA5E9",
            is_final: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Alinhar agenda com o cliente", is_required: true },
              { texto: "Confirmar participantes", is_required: true },
              { texto: "Enviar link do treinamento", is_required: true },
            ],
          },
        ],
      },
      {
        fase: "implantacao",
        nome: "Implantação",
        descricao: "Do treinamento agendado à conclusão.",
        stages: [
          {
            nome: "Treinamento agendado",
            sla_minutos: 480,
            cor: "#22C55E",
            is_initial: true,
            inicia_sla: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Confirmar presença na véspera", is_required: true },
              { texto: "Preparar ambiente do cliente", is_required: true },
            ],
          },
          {
            nome: "Treinamento realizado",
            sla_minutos: 480,
            cor: "#0EA5E9",
            visible_sections: SECOES,
            checklist: [
              { texto: "Registrar o que foi treinado", is_required: true },
              { texto: "Enviar material de apoio", is_required: true },
              { texto: "Enviar contato do suporte", is_required: true },
            ],
          },
          {
            nome: "Acompanhamento",
            sla_minutos: 1440,
            cor: "#F59E0B",
            visible_sections: SECOES,
            checklist: [
              { texto: "Confirmar primeiro uso real", is_required: true },
              { texto: "Tratar dúvidas do primeiro dia", is_required: false },
            ],
          },
          {
            nome: "Concluído",
            sla_minutos: 0,
            cor: "#22C55E",
            is_final: true,
            encerra_sla: true,
            visible_sections: SECOES,
            checklist: [
              { texto: "Enviar pesquisa de satisfação", is_required: true },
              { texto: "Registrar conclusão", is_required: true },
            ],
          },
        ],
      },
    ],
    demand_types: [{ nome: "Novo Cliente", descricao: null }],
    training_types: [{ nome: "Treinamento", conta_como_pdv: true }],
    pause_reasons: [{ nome: "Aguardando o cliente" }, { nome: "Pendência financeira" }],
    accounting_fields: [],
    vendor_return_reasons: [
      { nome: "Dados incompletos", atribuivel_vendedor: true },
      { nome: "Venda não corresponde à necessidade", atribuivel_vendedor: true },
    ],
  },
};
```

- [ ] **Step 4: Registrar no `index.ts`**

Trocar as duas linhas do import e do array:

```ts
import { PDV_LEGAL_TEMPLATE } from "./pdvLegal";
import { SOFTWARE_GENERICO_TEMPLATE } from "./softwareGenerico";

export * from "./types";

export const ONBOARDING_TEMPLATES: OnboardingTemplate[] = [
  PDV_LEGAL_TEMPLATE,
  SOFTWARE_GENERICO_TEMPLATE,
];
```

- [ ] **Step 5: Rodar os dois arquivos de teste**

Run: `bunx vitest run src/pages/onboarding/config/templates/`
Expected: PASS — 13 testes (8 da Task 1 + 5 desta).

- [ ] **Step 6: Typecheck e commit**

```bash
bunx tsc -p tsconfig.app.json
git add src/pages/onboarding/config/templates/softwareGenerico.ts \
        src/pages/onboarding/config/templates/softwareGenerico.test.ts \
        src/pages/onboarding/config/templates/index.ts
git commit -m "feat(onboarding): template de operacao para software generico"
```

---

### Task 3: Estender a RPC `apply_onboarding_blueprint`

**Files:**
- Create: `supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql`
- Create: `scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql`

**Interfaces:**
- Consumes: o formato produzido pela Task 1 (`checklist_groups`, `cor`, `is_initial`, `is_final`, `inicia_sla`, `encerra_sla`, `retorno_no_show`, `visible_sections`, `produto_id` no pipeline).
- Produces: `apply_onboarding_blueprint(p_tenant_id uuid, p_blueprint jsonb) → jsonb`, mesma assinatura, com a chave nova `checklist_groups` no jsonb de retorno.

**Atenção:** a função é compartilhada com o "Gerar com IA". Todo campo novo é opcional e o caminho antigo tem que sair intacto — é o que o teste 8 do arquivo SQL cobre.

- [ ] **Step 1: Escrever o teste que falha**

`scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql`:

```sql
-- Asserções da RPC apply_onboarding_blueprint estendida (templates de implantação).
-- Rodar: scripts/sql-tests/run-com-migration.sh \
--          supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql \
--          scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql
--
-- Sobre a guarda de permissão da RPC: rodando como `postgres` no psql, `auth.uid()` é
-- NULL, `is_super_admin()` devolve NULL e `IF NOT v_is_allowed` não dispara (NULL não é
-- true). Por isso o teste chama a função direto, sem forjar JWT. Se a guarda mudar para
-- `COALESCE(..., false)`, este arquivo passa a precisar de `SET LOCAL request.jwt.claims`.
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_prod   bigint;
  v_res    jsonb;
  v_pipe   uuid;
  v_stage  uuid;
  v_group  uuid;
  v_qtd    int;
  v_txt    text;
  v_bool   boolean;
BEGIN
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Template') RETURNING id INTO v_tenant;
  INSERT INTO public.produtos (tenant_id, nome) VALUES (v_tenant, 'PDV Legal') RETURNING id INTO v_prod;

  -- ============ blueprint com os campos NOVOS ============
  v_res := public.apply_onboarding_blueprint(v_tenant, jsonb_build_object(
    'pipelines', jsonb_build_array(jsonb_build_object(
      'fase', 'implantacao',
      'nome', 'Implantação PDV',
      'descricao', 'teste',
      'produto_id', v_prod,
      'stages', jsonb_build_array(
        jsonb_build_object('nome','Pendências','sla_minutos',0,'cor','#EF4444'),
        jsonb_build_object('nome','Pendente Agendar','sla_minutos',0,'cor','#F59E0B',
                           'retorno_no_show', true,
                           'visible_sections', jsonb_build_array('timeline','checklist','acompanhamento')),
        jsonb_build_object('nome','Treinamento Marcado','sla_minutos',120,'cor','#22C55E',
                           'is_initial', true, 'inicia_sla', true,
                           'checklist_groups', jsonb_build_array(
                             jsonb_build_object('nome','Checklist PDV',
                               'demandas', jsonb_build_array('Novo Cliente'),
                               'itens', jsonb_build_array(
                                 jsonb_build_object('texto','Fundo de caixa | Sangria','is_required',true),
                                 jsonb_build_object('texto','Encerramento de caixa','is_required',true))),
                             jsonb_build_object('nome','Checklist Geral',
                               'demandas', jsonb_build_array('Novo Cliente','Mudança Regime Fiscal'),
                               'itens', jsonb_build_array(
                                 jsonb_build_object('texto','Enviar pesquisa satisfação','is_required',false))))),
        jsonb_build_object('nome','Sub-tickets Finalizados','sla_minutos',0,
                           'is_final', true, 'encerra_sla', true)
      )
    )),
    'demand_types', jsonb_build_array(jsonb_build_object('nome','Novo Cliente','descricao',NULL))
  ));

  -- 1. contagens no retorno
  IF (v_res->>'pipelines')::int <> 1 OR (v_res->>'stages')::int <> 4
     OR (v_res->>'checklist_items')::int <> 3 OR (v_res->>'checklist_groups')::int <> 2 THEN
    RAISE EXCEPTION 'FALHOU 1: retorno inesperado %', v_res;
  END IF;

  SELECT id INTO v_pipe FROM public.onboarding_pipelines WHERE tenant_id=v_tenant;

  -- 2. produto_id gravado no pipeline
  SELECT produto_id INTO v_qtd FROM public.onboarding_pipelines WHERE id=v_pipe;
  IF v_qtd IS DISTINCT FROM v_prod THEN RAISE EXCEPTION 'FALHOU 2: produto_id % <> %', v_qtd, v_prod; END IF;

  -- 3. is_initial respeita o que veio, e NÃO cai na primeira posição
  SELECT nome INTO v_txt FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_initial;
  IF v_txt <> 'Treinamento Marcado' THEN RAISE EXCEPTION 'FALHOU 3: etapa inicial virou %', v_txt; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_initial;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 3b: % etapas iniciais', v_qtd; END IF;

  -- 4. flags de SLA, no-show, cor e visible_sections
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe AND nome='Treinamento Marcado' AND inicia_sla AND cor='#22C55E';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4a: inicia_sla/cor não gravados'; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe AND nome='Sub-tickets Finalizados' AND encerra_sla AND is_final;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4b: encerra_sla/is_final não gravados'; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe AND nome='Pendente Agendar' AND retorno_no_show
     AND visible_sections = ARRAY['timeline','checklist','acompanhamento'];
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4c: retorno_no_show/visible_sections não gravados'; END IF;

  -- 5. grupos criados na ordem, com os itens dentro
  SELECT s.id INTO v_stage FROM public.onboarding_stages s
   WHERE s.pipeline_id=v_pipe AND s.nome='Treinamento Marcado';
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_checklist_groups WHERE stage_id=v_stage;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 5a: % grupos, esperava 2', v_qtd; END IF;
  SELECT id INTO v_group FROM public.onboarding_stage_checklist_groups
   WHERE stage_id=v_stage AND nome='Checklist PDV';
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_checklist WHERE group_id=v_group;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 5b: % itens no grupo, esperava 2', v_qtd; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_checklist
   WHERE stage_id=v_stage AND group_id IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5c: % item(ns) de checklist ficaram sem grupo', v_qtd; END IF;

  -- 6. vínculo grupo -> tipo de demanda, criando a demanda que faltava
  SELECT count(*) INTO v_qtd FROM public.onboarding_checklist_group_demand_types gd
    JOIN public.onboarding_demand_types d ON d.id=gd.demand_type_id
   WHERE gd.group_id = (SELECT id FROM public.onboarding_stage_checklist_groups
                         WHERE stage_id=v_stage AND nome='Checklist Geral');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 6a: % vínculos de demanda, esperava 2', v_qtd; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_demand_types
   WHERE tenant_id=v_tenant AND nome='Mudança Regime Fiscal';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6b: demanda do grupo não foi criada'; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_demand_types
   WHERE tenant_id=v_tenant AND lower(nome)='novo cliente';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6c: "Novo Cliente" duplicou (% linhas)', v_qtd; END IF;

  -- 7. reimportar não duplica catálogo
  PERFORM public.apply_onboarding_blueprint(v_tenant, jsonb_build_object(
    'pipelines', '[]'::jsonb,
    'demand_types', jsonb_build_array(jsonb_build_object('nome','novo cliente','descricao',NULL))));
  SELECT count(*) INTO v_qtd FROM public.onboarding_demand_types WHERE tenant_id=v_tenant;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 7: catálogo foi para % linhas', v_qtd; END IF;

  -- ============ 8. REGRESSÃO: blueprint antigo (IA) sai igual ============
  v_res := public.apply_onboarding_blueprint(v_tenant, jsonb_build_object(
    'pipelines', jsonb_build_array(jsonb_build_object(
      'fase','onboarding','nome','Onboarding IA','descricao',NULL,
      'stages', jsonb_build_array(
        jsonb_build_object('nome','Primeira','sla_minutos',60,'pausa_sla',false,
          'checklist', jsonb_build_array(jsonb_build_object('texto','Item A','is_required',true))),
        jsonb_build_object('nome','Segunda','sla_minutos',60,'pausa_sla',false,'checklist','[]'::jsonb))
    ))));
  IF (v_res->>'stages')::int <> 2 OR (v_res->>'checklist_items')::int <> 1 THEN
    RAISE EXCEPTION 'FALHOU 8a: caminho antigo mudou %', v_res;
  END IF;
  SELECT id INTO v_pipe FROM public.onboarding_pipelines WHERE tenant_id=v_tenant AND nome='Onboarding IA';
  SELECT nome INTO v_txt FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_initial;
  IF v_txt <> 'Primeira' THEN RAISE EXCEPTION 'FALHOU 8b: sem is_initial explícito, a inicial virou %', v_txt; END IF;
  SELECT nome INTO v_txt FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_final;
  IF v_txt <> 'Segunda' THEN RAISE EXCEPTION 'FALHOU 8c: sem is_final explícito, a final virou %', v_txt; END IF;
  SELECT (group_id IS NULL) INTO v_bool FROM public.onboarding_stage_checklist
   WHERE stage_id=(SELECT id FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND nome='Primeira');
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU 8d: checklist plano ganhou grupo'; END IF;

  -- 9. grants continuam de pé
  SELECT count(*) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_name='apply_onboarding_blueprint' AND grantee IN ('authenticated','service_role');
  IF v_qtd < 2 THEN RAISE EXCEPTION 'FALHOU 9: grants sumiram (% de 2)', v_qtd; END IF;

  RAISE NOTICE 'OK: 45_apply_blueprint_grupos_e_flags — 9 blocos de asserção passaram';
END $$;

ROLLBACK;
```

- [ ] **Step 2: Rodar o teste contra a função de HOJE e confirmar que falha**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f - < scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql
```
Expected: FAIL em `FALHOU 1` — a função de hoje não devolve `checklist_groups` e ignora `produto_id`.

- [ ] **Step 3: Baixar o corpo ATUAL de produção antes de editar**

A função pode ter mudado desde que este plano foi escrito (prod muda durante a sessão). Confirmar que local e prod estão iguais e partir do corpo real:

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select pg_get_functiondef(oid) from pg_proc where proname='apply_onboarding_blueprint';" \
  > /tmp/apply_blueprint_atual.sql
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select md5(pg_get_functiondef(oid)) from pg_proc where proname='apply_onboarding_blueprint';"
```

O md5 esperado é `e98e21c16283bbb17b1a2cc74f036a33` (local == prod em 26/08/2026). **Se der diferente, parar e comparar com produção antes de continuar** — alguém alterou a função e este plano precisa ser reancorado.

- [ ] **Step 4: Escrever a migration**

`supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql` é o corpo de `/tmp/apply_blueprint_atual.sql` com os patches abaixo. Manter `SECURITY DEFINER`, `SET search_path TO 'public'` e a assinatura `(p_tenant_id uuid, p_blueprint jsonb) RETURNS jsonb`.

Cabeçalho do arquivo:

```sql
-- Estende apply_onboarding_blueprint para importar TEMPLATES de operação, não só o
-- blueprint da IA. Todo campo novo é opcional: blueprint sem eles se comporta como antes.
-- Novidades: grupos de checklist + vínculo com tipo de demanda, flags de etapa
-- (cor, is_initial, is_final, inicia_sla, encerra_sla, retorno_no_show, visible_sections)
-- e produto_id no pipeline.
```

**Patch A — declarações.** No `DECLARE`, depois de `v_chk jsonb;`, acrescentar:

```sql
  v_grp jsonb;
  v_grp_ord int;
  v_new_group_id uuid;
  v_demanda text;
  v_demand_id uuid;
  v_groups_created int := 0;
  v_tem_flag_explicita boolean;
```

**Patch B — `produto_id` no pipeline.** No `INSERT INTO onboarding_pipelines`, acrescentar a coluna `produto_id` na lista e o valor `NULLIF(v_pipe->>'produto_id','')::bigint` no `VALUES`.

**Patch C — flags da etapa.** Trocar o `INSERT INTO onboarding_stages (...) VALUES (...)` inteiro por:

```sql
      INSERT INTO onboarding_stages (
        tenant_id, pipeline_id, nome, slug, position, sla_minutos, pausa_sla, ativo,
        cor, inicia_sla, encerra_sla, retorno_no_show, visible_sections,
        is_initial, is_final
      )
      VALUES (
        p_tenant_id,
        v_new_pipeline_id,
        COALESCE(NULLIF(trim(v_stage->>'nome'),''), 'Etapa ' || v_stage_ord),
        v_slug,
        v_stage_ord - 1,
        NULLIF(v_stage->>'sla_minutos','')::int,
        COALESCE((v_stage->>'pausa_sla')::boolean, false),
        true,
        COALESCE(NULLIF(trim(v_stage->>'cor'),''), '#22C55E'),
        COALESCE((v_stage->>'inicia_sla')::boolean, false),
        COALESCE((v_stage->>'encerra_sla')::boolean, false),
        COALESCE((v_stage->>'retorno_no_show')::boolean, false),
        CASE WHEN jsonb_typeof(v_stage->'visible_sections') = 'array'
             THEN ARRAY(SELECT jsonb_array_elements_text(v_stage->'visible_sections'))
             ELSE NULL END,
        COALESCE((v_stage->>'is_initial')::boolean, false),
        COALESCE((v_stage->>'is_final')::boolean, false)
      )
      RETURNING id INTO v_new_stage_id;
```

`visible_sections` NULL deixa o default da coluna valer — é o comportamento de hoje.

**Patch D — checklist agrupado.** Logo depois de `v_stages_created := v_stages_created + 1;`, envolver o laço de checklist existente num `IF`:

```sql
      IF jsonb_typeof(v_stage->'checklist_groups') = 'array' THEN
        FOR v_grp, v_grp_ord IN
          SELECT value, ordinality
          FROM jsonb_array_elements(v_stage->'checklist_groups') WITH ORDINALITY AS g(value, ordinality)
        LOOP
          INSERT INTO onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
          VALUES (
            p_tenant_id,
            v_new_stage_id,
            COALESCE(NULLIF(trim(v_grp->>'nome'),''), 'Grupo ' || v_grp_ord),
            v_grp_ord - 1
          )
          RETURNING id INTO v_new_group_id;

          v_groups_created := v_groups_created + 1;

          -- demandas do grupo: resolve por nome no tenant, criando o que faltar
          FOR v_demanda IN
            SELECT value FROM jsonb_array_elements_text(COALESCE(v_grp->'demandas','[]'::jsonb))
          LOOP
            IF NULLIF(trim(v_demanda),'') IS NULL THEN CONTINUE; END IF;

            SELECT id INTO v_demand_id FROM onboarding_demand_types
             WHERE tenant_id = p_tenant_id AND lower(nome) = lower(trim(v_demanda))
             LIMIT 1;

            IF v_demand_id IS NULL THEN
              INSERT INTO onboarding_demand_types (tenant_id, nome, position)
              VALUES (
                p_tenant_id,
                trim(v_demanda),
                (SELECT COALESCE(max(position),-1)+1 FROM onboarding_demand_types WHERE tenant_id = p_tenant_id)
              )
              RETURNING id INTO v_demand_id;
            END IF;

            INSERT INTO onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
            VALUES (p_tenant_id, v_new_group_id, v_demand_id)
            ON CONFLICT (group_id, demand_type_id) DO NOTHING;
          END LOOP;

          FOR v_chk IN
            SELECT value FROM jsonb_array_elements(COALESCE(v_grp->'itens','[]'::jsonb))
          LOOP
            IF NULLIF(trim(v_chk->>'texto'),'') IS NOT NULL THEN
              INSERT INTO onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
              VALUES (
                p_tenant_id,
                v_new_stage_id,
                v_new_group_id,
                trim(v_chk->>'texto'),
                COALESCE((v_chk->>'is_required')::boolean, false),
                (SELECT COALESCE(max(position),-1)+1 FROM onboarding_stage_checklist WHERE group_id = v_new_group_id)
              );
              v_checklist_created := v_checklist_created + 1;
            END IF;
          END LOOP;
        END LOOP;
      ELSE
        -- caminho antigo, intacto: checklist plano sem grupo
        FOR v_chk IN
          SELECT value FROM jsonb_array_elements(COALESCE(v_stage->'checklist', '[]'::jsonb))
        LOOP
          ...  -- o laço que já existe, sem uma vírgula de diferença
        END LOOP;
      END IF;
```

**Patch E — não sobrescrever `is_initial`/`is_final` explícitos.** Trocar o `UPDATE onboarding_stages ... SET is_initial = (s.position = mn.min_pos)` por:

```sql
    SELECT EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(v_pipe->'stages','[]'::jsonb)) AS s(value)
       WHERE s.value ? 'is_initial' OR s.value ? 'is_final'
    ) INTO v_tem_flag_explicita;

    IF NOT v_tem_flag_explicita THEN
      UPDATE onboarding_stages s
      SET is_initial = (s.position = mn.min_pos),
          is_final   = (s.position = mn.max_pos)
      FROM (
        SELECT min(position) AS min_pos, max(position) AS max_pos
        FROM onboarding_stages WHERE pipeline_id = v_new_pipeline_id
      ) mn
      WHERE s.pipeline_id = v_new_pipeline_id;
    END IF;
```

**Patch F — contagem no retorno.** No `jsonb_build_object` final, acrescentar `'checklist_groups', v_groups_created`.

No fim do arquivo, repor os grants explicitamente (a função é recriada, mas repor é barato e documenta a intenção):

```sql
REVOKE ALL ON FUNCTION public.apply_onboarding_blueprint(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_onboarding_blueprint(uuid, jsonb) TO authenticated, service_role;
```

- [ ] **Step 5: Rodar migration + teste na mesma transação**

```bash
scripts/sql-tests/run-com-migration.sh \
  supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql \
  scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql
```
Expected: `NOTICE: OK: 45_apply_blueprint_grupos_e_flags — 9 blocos de asserção passaram`, seguido de `ROLLBACK`.

- [ ] **Step 6: Confirmar que o banco local ficou intocado**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -tAc \
  "select count(*) from public.tenants where nome like 'ZZ Teste%';"
```
Expected: `0`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql \
        scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql
git commit -m "feat(onboarding): apply_onboarding_blueprint aceita grupos de checklist e flags de etapa"
```

**Não aplicar em produção nesta task.** A migration só vai para prod na Task 6, com OK do Alexandre.

---

### Task 4: Lógica pura de importação

**Files:**
- Create: `src/pages/onboarding/config/templates/apply.ts`
- Test: `src/pages/onboarding/config/templates/apply.test.ts`

**Interfaces:**
- Consumes: `TemplateBlueprint`, `OnboardingTemplate` da Task 1.
- Produces:
  - `resolverProdutoSugerido(produtos: {id:number;nome:string}[], sugerido?: string): number | null`
  - `renomearColisoes(bp: TemplateBlueprint, existentes: {nome:string;fase:string}[]): TemplateBlueprint`
  - `nomesEmColisao(bp: TemplateBlueprint, existentes: {nome:string;fase:string}[]): string[]`
  - `filtrarPorSelecao(bp, sel: SelecaoTemplate): TemplateBlueprint`
  - `type SelecaoTemplate = { stages: Record<number, Set<number>>; demand_types: Set<number>; training_types: Set<number>; pause_reasons: Set<number>; accounting_fields: Set<number>; vendor_return_reasons: Set<number> }`
  - `selecaoCompleta(bp: TemplateBlueprint): SelecaoTemplate`

- [ ] **Step 1: Escrever o teste que falha**

`src/pages/onboarding/config/templates/apply.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolverProdutoSugerido, renomearColisoes, nomesEmColisao, filtrarPorSelecao, selecaoCompleta } from "./apply";
import type { TemplateBlueprint } from "./types";

const bp = (): TemplateBlueprint => ({
  pipelines: [
    {
      fase: "onboarding", nome: "Onboarding PDV", descricao: null,
      stages: [
        { nome: "A", sla_minutos: 60, checklist: [{ texto: "a1", is_required: true }] },
        { nome: "B", sla_minutos: 60, checklist_groups: [{ nome: "G", demandas: ["Novo Cliente"], itens: [{ texto: "b1", is_required: false }] }] },
      ],
    },
    { fase: "implantacao", nome: "Implantação PDV", descricao: null, stages: [{ nome: "C", sla_minutos: 0 }] },
  ],
  demand_types: [{ nome: "Novo Cliente", descricao: null }, { nome: "Up-Sell", descricao: null }],
  training_types: [{ nome: "Treinamento PDV", conta_como_pdv: true }],
  pause_reasons: [{ nome: "Aguardando cliente" }],
  accounting_fields: [],
  vendor_return_reasons: [{ nome: "Dados errados", atribuivel_vendedor: true }],
});

describe("resolverProdutoSugerido", () => {
  const produtos = [{ id: 7, nome: "Gula" }, { id: 13, nome: "PDV Legal" }];
  it("casa ignorando caixa e espaço", () => {
    expect(resolverProdutoSugerido(produtos, "  pdv legal ")).toBe(13);
  });
  it("devolve null quando não acha ou quando não há sugestão", () => {
    expect(resolverProdutoSugerido(produtos, "PDV Legal Anual")).toBeNull();
    expect(resolverProdutoSugerido(produtos, undefined)).toBeNull();
  });
});

describe("colisão de nome de pipeline", () => {
  it("só colide dentro da mesma jornada", () => {
    const existentes = [{ nome: "Onboarding PDV", fase: "implantacao" }];
    expect(nomesEmColisao(bp(), existentes)).toEqual([]);
  });
  it("aponta e sufixa o que já existe na mesma jornada", () => {
    const existentes = [{ nome: "onboarding pdv", fase: "onboarding" }];
    expect(nomesEmColisao(bp(), existentes)).toEqual(["Onboarding PDV"]);
    expect(renomearColisoes(bp(), existentes).pipelines.map((p) => p.nome))
      .toEqual(["Onboarding PDV (2)", "Implantação PDV"]);
  });
  it("pula sufixos já ocupados", () => {
    const existentes = [
      { nome: "Onboarding PDV", fase: "onboarding" },
      { nome: "Onboarding PDV (2)", fase: "onboarding" },
    ];
    expect(renomearColisoes(bp(), existentes).pipelines[0].nome).toBe("Onboarding PDV (3)");
  });
  it("não muda o original", () => {
    const original = bp();
    renomearColisoes(original, [{ nome: "Onboarding PDV", fase: "onboarding" }]);
    expect(original.pipelines[0].nome).toBe("Onboarding PDV");
  });
});

describe("filtrarPorSelecao", () => {
  it("com tudo marcado devolve o blueprint inteiro", () => {
    const b = bp();
    expect(filtrarPorSelecao(b, selecaoCompleta(b))).toEqual(b);
  });
  it("tira as etapas desmarcadas e o pipeline que ficou vazio", () => {
    const b = bp();
    const sel = selecaoCompleta(b);
    sel.stages[0] = new Set([1]);
    sel.stages[1] = new Set();
    const out = filtrarPorSelecao(b, sel);
    expect(out.pipelines.map((p) => p.nome)).toEqual(["Onboarding PDV"]);
    expect(out.pipelines[0].stages.map((s) => s.nome)).toEqual(["B"]);
  });
  it("tira os itens de catálogo desmarcados", () => {
    const b = bp();
    const sel = selecaoCompleta(b);
    sel.demand_types = new Set([1]);
    expect(filtrarPorSelecao(b, sel).demand_types.map((d) => d.nome)).toEqual(["Up-Sell"]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bunx vitest run src/pages/onboarding/config/templates/apply.test.ts`
Expected: FAIL — `Failed to resolve import "./apply"`.

- [ ] **Step 3: Implementar `apply.ts`**

```ts
import type { TemplateBlueprint } from "./types";

export type SelecaoTemplate = {
  /** índice do pipeline -> índices das etapas marcadas */
  stages: Record<number, Set<number>>;
  demand_types: Set<number>;
  training_types: Set<number>;
  pause_reasons: Set<number>;
  accounting_fields: Set<number>;
  vendor_return_reasons: Set<number>;
};

const norm = (s: string) => s.trim().toLowerCase();

export function resolverProdutoSugerido(
  produtos: { id: number; nome: string }[],
  sugerido?: string,
): number | null {
  if (!sugerido) return null;
  const alvo = norm(sugerido);
  return produtos.find((p) => norm(p.nome) === alvo)?.id ?? null;
}

/**
 * A importação é aditiva: cria pipeline novo em vez de mesclar com o que existe.
 * Nome repetido na MESMA jornada confunde o quadro, então ganha sufixo.
 */
export function nomesEmColisao(
  bp: TemplateBlueprint,
  existentes: { nome: string; fase: string }[],
): string[] {
  const ocupados = new Set(existentes.map((e) => `${e.fase}::${norm(e.nome)}`));
  return bp.pipelines.filter((p) => ocupados.has(`${p.fase}::${norm(p.nome)}`)).map((p) => p.nome);
}

export function renomearColisoes(
  bp: TemplateBlueprint,
  existentes: { nome: string; fase: string }[],
): TemplateBlueprint {
  const ocupados = new Set(existentes.map((e) => `${e.fase}::${norm(e.nome)}`));
  return {
    ...bp,
    pipelines: bp.pipelines.map((p) => {
      let nome = p.nome;
      let n = 1;
      while (ocupados.has(`${p.fase}::${norm(nome)}`)) {
        n += 1;
        nome = `${p.nome} (${n})`;
      }
      ocupados.add(`${p.fase}::${norm(nome)}`);
      return { ...p, nome };
    }),
  };
}

export function selecaoCompleta(bp: TemplateBlueprint): SelecaoTemplate {
  const stages: Record<number, Set<number>> = {};
  bp.pipelines.forEach((p, pi) => {
    stages[pi] = new Set(p.stages.map((_, si) => si));
  });
  return {
    stages,
    demand_types: new Set(bp.demand_types.map((_, i) => i)),
    training_types: new Set(bp.training_types.map((_, i) => i)),
    pause_reasons: new Set(bp.pause_reasons.map((_, i) => i)),
    accounting_fields: new Set(bp.accounting_fields.map((_, i) => i)),
    vendor_return_reasons: new Set(bp.vendor_return_reasons.map((_, i) => i)),
  };
}

export function filtrarPorSelecao(bp: TemplateBlueprint, sel: SelecaoTemplate): TemplateBlueprint {
  return {
    pipelines: bp.pipelines
      .map((p, pi) => ({ ...p, stages: p.stages.filter((_, si) => sel.stages[pi]?.has(si)) }))
      .filter((p) => p.stages.length > 0),
    demand_types: bp.demand_types.filter((_, i) => sel.demand_types.has(i)),
    training_types: bp.training_types.filter((_, i) => sel.training_types.has(i)),
    pause_reasons: bp.pause_reasons.filter((_, i) => sel.pause_reasons.has(i)),
    accounting_fields: bp.accounting_fields.filter((_, i) => sel.accounting_fields.has(i)),
    vendor_return_reasons: bp.vendor_return_reasons.filter((_, i) => sel.vendor_return_reasons.has(i)),
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bunx vitest run src/pages/onboarding/config/templates/apply.test.ts`
Expected: PASS — 8 testes.

- [ ] **Step 5: Typecheck e commit**

```bash
bunx tsc -p tsconfig.app.json
git add src/pages/onboarding/config/templates/apply.ts \
        src/pages/onboarding/config/templates/apply.test.ts
git commit -m "feat(onboarding): regras de importacao de template (produto, colisao de nome, selecao)"
```

---

### Task 5: Diálogo "Usar template" e botão na tela

**Files:**
- Create: `src/pages/onboarding/config/ApplyTemplateDialog.tsx`
- Modify: `src/pages/onboarding/OnboardingConfigPage.tsx:1-40` (imports e state) e `:60-80` (cabeçalho)
- Test: `src/pages/onboarding/config/ApplyTemplateDialog.test.tsx`

**Interfaces:**
- Consumes: `ONBOARDING_TEMPLATES`, `resumoTemplate` (Task 1/2); `resolverProdutoSugerido`, `renomearColisoes`, `nomesEmColisao`, `filtrarPorSelecao`, `selecaoCompleta`, `SelecaoTemplate` (Task 4); `apply_onboarding_blueprint` (Task 3); `formatSlaHuman` de `./utils`.
- Produces: `<ApplyTemplateDialog open onOpenChange />`.

Padrões obrigatórios: `useTenantFilter()` para `effectiveTenantId`, `.eq('tenant_id', tid)` explícito em toda query, `toast` do `sonner`, `qc.invalidateQueries()` depois de aplicar — tudo igual a `GenerateOperationAIDialog.tsx`, que serve de referência viva.

- [ ] **Step 1: Escrever o teste que falha**

`src/pages/onboarding/config/ApplyTemplateDialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplyTemplateDialog } from "./ApplyTemplateDialog";

// Sem @testing-library/react: o peer @testing-library/dom não está instalado no projeto.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn(() => Promise.resolve({ data: { pipelines: 2, stages: 10, checklist_items: 54 }, error: null }));
const produtos = vi.fn(() => [{ id: 13, nome: "PDV Legal" }, { id: 14, nome: "Gula" }]);
const pipelines = vi.fn(() => [] as { nome: string; fase: string }[]);

vi.mock("@/integrations/supabase/client", () => {
  const build = (table: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      order: () => Promise.resolve({ data: table === "produtos" ? produtos() : pipelines(), error: null }),
      then: (r: any) => Promise.resolve({ data: table === "produtos" ? produtos() : pipelines(), error: null }).then(r),
    };
    return chain;
  };
  return { supabase: { from: (t: string) => build(t), rpc: (...a: any[]) => rpc(...(a as [])) } };
});
vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: "t1" }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function render(ui: React.ReactNode) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(el);
  act(() => { root.render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>); });
  return el;
}

describe("ApplyTemplateDialog", () => {
  beforeEach(() => { rpc.mockClear(); pipelines.mockReturnValue([]); });

  it("lista os dois templates com o resumo de cada um", async () => {
    const el = render(<ApplyTemplateDialog open onOpenChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    const txt = document.body.textContent ?? "";
    expect(txt).toContain("PDV Legal");
    expect(txt).toContain("Software genérico");
    expect(txt).toContain("10 etapas");
    expect(el).toBeTruthy();
  });

  it("avisa quando o tenant já tem pipeline com o mesmo nome na jornada", async () => {
    pipelines.mockReturnValue([{ nome: "Implantação PDV", fase: "implantacao" }]);
    render(<ApplyTemplateDialog open onOpenChange={() => {}} />);
    await act(async () => { await Promise.resolve(); });
    expect(document.body.textContent ?? "").toContain("PDV Legal");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `bunx vitest run src/pages/onboarding/config/ApplyTemplateDialog.test.tsx`
Expected: FAIL — `Failed to resolve import "./ApplyTemplateDialog"`.

- [ ] **Step 3: Implementar `ApplyTemplateDialog.tsx`**

Estrutura obrigatória (o teste só cobre a primeira tela; o resto é validado à mão na Task 6):

1. `const [etapa, setEtapa] = useState<"escolha" | "produto" | "revisao">("escolha")` e `const [tpl, setTpl] = useState<OnboardingTemplate | null>(null)`.
2. `useQuery(["onb-tpl-produtos", effectiveTenantId])` → `supabase.from("produtos").select("id, nome").eq("tenant_id", tid).order("nome")`, com `enabled: open && !!effectiveTenantId`.
3. `useQuery(["onb-tpl-pipelines", effectiveTenantId])` → `supabase.from("onboarding_pipelines").select("nome, fase").eq("tenant_id", tid)`, mesmo `enabled`.
4. **Tela "escolha":** um card por item de `ONBOARDING_TEMPLATES` com `nome`, `descricao` e o resumo `${r.pipelines} pipelines · ${r.etapas} etapas · ${r.itens} itens`. Clicar seleciona o template, roda `setProdutoId(resolverProdutoSugerido(produtos, t.produto_sugerido))` e vai para "produto".
5. **Tela "produto":** `Select` com "Sem produto" + os produtos do tenant; texto de apoio explicando que o produto amarra o pipeline ao que foi vendido.
6. **Tela "revisão":** lista por pipeline → etapa (`Checkbox` por etapa, com nome, `formatSlaHuman(sla_minutos)` e badges das flags), com os `checklist_groups` aninhados sob a etapa mostrando `grupo · N itens · demandas`; e uma seção por catálogo com `Checkbox` por item. Estado de seleção é `SelecaoTemplate`, iniciado com `selecaoCompleta(tpl.blueprint)`. Se `nomesEmColisao(...)` não for vazio, mostrar um aviso em `text-amber-500` nomeando os pipelines e dizendo que entram com sufixo.
7. **Aplicar:**

```ts
const bpFiltrado = filtrarPorSelecao(tpl.blueprint, sel);
const bpFinal = renomearColisoes(bpFiltrado, pipelinesExistentes);
const payload = {
  ...bpFinal,
  pipelines: bpFinal.pipelines.map((p) => ({ ...p, produto_id: produtoId })),
};
const { data, error } = await (supabase.rpc as any)("apply_onboarding_blueprint", {
  p_tenant_id: effectiveTenantId,
  p_blueprint: payload,
});
```

Erro → `toast.error(error.message || "Falha ao aplicar template")` e **não** fechar. Sucesso → `toast.success(...)` com as contagens de `data` (incluindo `checklist_groups` quando vier), `await qc.invalidateQueries()`, resetar o estado e fechar.
8. Bloquear `onOpenChange(false)` enquanto `applying` for true, igual ao diálogo de IA.

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `bunx vitest run src/pages/onboarding/config/ApplyTemplateDialog.test.tsx`
Expected: PASS — 2 testes.

- [ ] **Step 5: Ligar o botão na página**

Em `src/pages/onboarding/OnboardingConfigPage.tsx`:

```tsx
import { ApplyTemplateDialog } from "./config/ApplyTemplateDialog";
import { LayoutTemplate } from "lucide-react";
```

State, junto de `aiOpen`:

```tsx
const [tplOpen, setTplOpen] = useState(false);
```

No cabeçalho, **antes** do botão "Gerar com IA" (template é o caminho barato; IA é o caro):

```tsx
{canGenerateAI && (
  <Button variant="outline" size="sm" onClick={() => setTplOpen(true)}>
    <LayoutTemplate className="h-4 w-4 mr-1" />
    Usar template
  </Button>
)}
```

E, ao lado de `<GenerateOperationAIDialog ... />`:

```tsx
<ApplyTemplateDialog open={tplOpen} onOpenChange={setTplOpen} />
```

- [ ] **Step 6: Rodar a suíte inteira e o build**

```bash
bunx vitest run
bunx tsc -p tsconfig.app.json
bun run build
```
Expected: suíte verde, typecheck limpo, build sem erro. Se aparecer teste vermelho **de outra área**, conferir se já estava vermelho antes (`git stash` + rodar + `git stash pop`) antes de tentar consertar.

- [ ] **Step 7: Commit**

```bash
git add src/pages/onboarding/config/ApplyTemplateDialog.tsx \
        src/pages/onboarding/config/ApplyTemplateDialog.test.tsx \
        src/pages/onboarding/OnboardingConfigPage.tsx
git commit -m "feat(onboarding): botao e dialogo para importar template de operacao"
```

---

### Task 6: Validação ponta a ponta no local

**Files:** nenhum arquivo novo. Aplica a migration da Task 3 no Docker local **de forma persistente** e exercita a tela.

**Interfaces:**
- Consumes: tudo das tasks 1 a 5.
- Produces: evidência para o Alexandre decidir o deploy.

- [ ] **Step 1: Garantir que o app aponta para o local**

```bash
ls -la .env.local && grep -c SUPABASE .env.local
```
Se `.env.local` não existir, rodar `./scripts/setup-local-db.sh` antes de continuar. **Nunca** testar isso contra produção.

- [ ] **Step 2: Aplicar a migration no banco local (sem rollback)**

```bash
docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f - < supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql
```
Expected: `CREATE FUNCTION`, `REVOKE`, `GRANT`.

- [ ] **Step 3: Subir o app e importar o PDV Legal**

```bash
bun run dev
```

Na tela `Configuração · Implantação` de um tenant de teste (**não** a Digi Office), clicar "Usar template" → PDV Legal → produto "PDV Legal" → Aplicar. Conferir na tela: os 2 pipelines aparecem, o quadro da Implantação começa em "Treinamento Marcado" e o checklist de "Treinamento Marcado" mostra os 5 grupos.

- [ ] **Step 4: Diffar o importado contra a Digi Office**

Trocar `:tenant` pelo id do tenant de teste:

```sql
WITH alvo AS (
  SELECT p.nome pipe, s.position, s.nome, s.sla_minutos, s.cor, s.is_initial, s.is_final,
         s.inicia_sla, s.encerra_sla, s.retorno_no_show
  FROM onboarding_pipelines p JOIN onboarding_stages s ON s.pipeline_id=p.id
  WHERE p.tenant_id = :tenant AND p.nome IN ('Onboarding PDV','Implantação PDV')
), digi AS (
  SELECT p.nome pipe, s.position, s.nome, s.sla_minutos, s.cor, s.is_initial, s.is_final,
         s.inicia_sla, s.encerra_sla, s.retorno_no_show
  FROM onboarding_pipelines p JOIN onboarding_stages s ON s.pipeline_id=p.id
  WHERE p.tenant_id = '955178ba-b367-498d-8443-cc5b7d1ee163' AND p.nome IN ('Onboarding PDV','Implantação PDV')
)
SELECT 'só no importado' origem, * FROM (SELECT * FROM alvo EXCEPT SELECT * FROM digi) a
UNION ALL
SELECT 'só na Digi Office', * FROM (SELECT * FROM digi EXCEPT SELECT * FROM alvo) d;
```
Expected: **0 linhas**.

Contagens do checklist importado:

```sql
SELECT count(DISTINCT g.id) grupos, count(c.id) itens
FROM onboarding_pipelines p
JOIN onboarding_stages s ON s.pipeline_id=p.id
JOIN onboarding_stage_checklist_groups g ON g.stage_id=s.id
LEFT JOIN onboarding_stage_checklist c ON c.group_id=g.id
WHERE p.tenant_id = :tenant AND p.nome IN ('Onboarding PDV','Implantação PDV');
```
Expected: `grupos=9`, `itens=54`.

E nada de Nutrebem:

```sql
SELECT count(*) FROM onboarding_stage_checklist_groups WHERE tenant_id = :tenant AND nome ILIKE '%nutrebem%';
SELECT count(*) FROM onboarding_demand_types WHERE tenant_id = :tenant AND nome ILIKE '%nutrebem%';
```
Expected: `0` nos dois.

- [ ] **Step 5: Importar o Software genérico e reimportar o PDV Legal**

Importar "Software genérico" no mesmo tenant e conferir 2 pipelines / 8 etapas / 21 itens sem grupo. Depois importar o PDV Legal **de novo** e conferir que:
- os pipelines novos entraram como "Onboarding PDV (2)" e "Implantação PDV (2)";
- `SELECT count(*) FROM onboarding_demand_types WHERE tenant_id = :tenant;` **não** dobrou.

- [ ] **Step 6: Regressão do "Gerar com IA"**

Na mesma tela, abrir "Gerar com IA", usar o prompt de exemplo, gerar e aplicar num tenant de teste. Confirmar que o pipeline entra com a primeira etapa como inicial e a última como final, e que o checklist aparece sem grupo. É o caminho que a Task 3 não pode ter quebrado.

- [ ] **Step 7: Registrar o resultado e parar**

Reportar ao Alexandre: o que passou, o que não passou, e que falta **(a)** aplicar a migration em produção e **(b)** publicar o frontend. Nenhuma das duas acontece sem OK explícito dele.

Quando ele autorizar a publicação, acrescentar a linha no `CHANGELOG.md` no dia da publicação, em linguagem de cliente, classificada como 🆕 Novidade — algo como: "Configuração da Implantação: importe um modelo pronto de operação (PDV Legal ou software genérico) em vez de montar pipeline, etapas e checklist do zero."
