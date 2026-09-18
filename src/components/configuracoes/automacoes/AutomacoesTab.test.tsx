import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  automationStatus,
  type AutomationRule,
} from "@/components/whatsapp/hooks/useAutomationRules";

/** Sem @testing-library/react: o peer @testing-library/dom não está instalado. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Mocks ──────────────────────────────────────────────────────────────────

const dadosPorTabela: Record<string, any> = {};

/** Builder do PostgREST: qualquer encadeamento devolve ele mesmo e o await resolve. */
function builder(tabela: string) {
  const dados = dadosPorTabela[tabela] ?? [];
  const b: any = {};
  for (const m of ["select", "eq", "neq", "in", "is", "order", "limit", "gte", "lte", "or"]) {
    b[m] = () => b;
  }
  const um = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] ?? null : dados, error: null });
  b.maybeSingle = um;
  b.single = um;
  b.then = (res: any, rej: any) => Promise.resolve({ data: dados, error: null }).then(res, rej);
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (tabela: string) => builder(tabela) },
}));

vi.mock("@/contexts/TenantFilterContext", () => ({
  useTenantFilter: () => ({ effectiveTenantId: "tenant-1" }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import AutomacoesTab from "./AutomacoesTab";

// ─── Fixture ────────────────────────────────────────────────────────────────

const AGORA = Date.now();
const emHoras = (h: number) => new Date(AGORA + h * 3600_000).toISOString();

const base: AutomationRule = {
  id: "r1",
  tenant_id: "tenant-1",
  name: "Falta no Financeiro",
  is_active: true,
  starts_at: emHoras(-1),
  ends_at: emHoras(4),
  trigger_event: "chat_inbound",
  grace_minutes: 30,
  match_department_id: "dept-fin",
  match_agent_id: null,
  match_instance_id: null,
  action: "route_to_department",
  target_department_id: "dept-sup",
  target_agent_id: null,
  priority: 10,
  applied_count: 14,
  last_applied_at: emHoras(-0.2),
  created_by: null,
  created_at: emHoras(-2),
  updated_at: emHoras(-2),
};

const agendadaParaPessoa: AutomationRule = {
  ...base,
  id: "r2",
  name: "Férias da Renata",
  starts_at: emHoras(72),
  ends_at: emHoras(240),
  match_department_id: "dept-fin",
  match_agent_id: "u-renata",
  action: "route_to_agent",
  target_department_id: null,
  target_agent_id: "u-marcos",
  priority: 20,
  applied_count: 0,
  last_applied_at: null,
};

const fixaPorCanal: AutomationRule = {
  ...base,
  id: "r3",
  name: "Número da diretoria",
  starts_at: null,
  ends_at: null,
  match_department_id: null,
  match_instance_id: "inst-diretoria",
  target_department_id: "dept-coord",
  priority: 50,
  applied_count: 212,
};

const semNinguemNoFinanceiro: AutomationRule = {
  ...base,
  id: "r5",
  name: "Financeiro sem ninguém",
  trigger_event: "no_agent_available",
  grace_minutes: 30,
  starts_at: null,
  ends_at: null,
  match_department_id: "dept-fin",
  target_department_id: "dept-sup",
  priority: 5,
  applied_count: 3,
};

const encerrada: AutomationRule = {
  ...base,
  id: "r4",
  name: "Falta no Suporte",
  starts_at: emHoras(-48),
  ends_at: emHoras(-24),
  applied_count: 27,
};

function montarCatalogos() {
  dadosPorTabela.support_departments = [
    { id: "dept-fin", name: "Financeiro" },
    { id: "dept-sup", name: "Suporte" },
    { id: "dept-coord", name: "Coordenação" },
  ];
  dadosPorTabela.profiles = [
    { user_id: "u-renata", funcionario_id: 1 },
    { user_id: "u-marcos", funcionario_id: 2 },
  ];
  dadosPorTabela.funcionarios = [
    { id: 1, nome: "Renata Lima" },
    { id: 2, nome: "Marcos Vieira" },
  ];
  dadosPorTabela.whatsapp_instances = [{ id: "inst-diretoria", display_name: "Diretoria", instance_name: "dir" }];
  dadosPorTabela.configuracoes = [{ support_config: { distribution_enabled_globally: true } }];
  dadosPorTabela.automation_rule_logs = [];
}

// ─── Harness ────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  for (const k of Object.keys(dadosPorTabela)) delete dadosPorTabela[k];
  montarCatalogos();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AutomacoesTab />
      </QueryClientProvider>,
    );
  });
  // As queries do react-query resolvem em ticks encadeados (regras, depois os
  // catálogos que o card usa para virar nome): um flush só não basta.
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

// ─── A conta que decide se a regra vale ─────────────────────────────────────

describe("automationStatus", () => {
  const agora = new Date(AGORA);

  it("dentro da janela é valendo", () => {
    expect(automationStatus(base, agora)).toBe("valendo");
  });

  it("antes do começo é agendada", () => {
    expect(automationStatus(agendadaParaPessoa, agora)).toBe("agendada");
  });

  it("janela vencida é encerrada, mesmo com is_active true", () => {
    expect(encerrada.is_active).toBe(true);
    expect(automationStatus(encerrada, agora)).toBe("encerrada");
  });

  it("sem janela e ativa é valendo", () => {
    expect(automationStatus(fixaPorCanal, agora)).toBe("valendo");
  });

  it("desligada vence a janela", () => {
    expect(automationStatus({ ...base, is_active: false }, agora)).toBe("desligada");
  });
});

// ─── A tela ─────────────────────────────────────────────────────────────────

describe("AutomacoesTab", () => {
  it("gatilho sem agente aparece com o setor, a condição e a espera", async () => {
    dadosPorTabela.automation_rules = [semNinguemNoFinanceiro];
    await render();

    const texto = container.textContent ?? "";
    expect(texto).toContain("Financeiro");
    expect(texto).toContain("fica sem ninguém conectado");
    expect(texto).toContain("Vai para a fila do setor");
    expect(texto).toContain("Espera 30 min depois da abertura");
    // regra fixa, sem janela
    expect(texto).toContain("Fixa");
    expect(texto).not.toContain("Chat entra no setor");
  });

  it("sem nenhuma regra, oferece os 4 modelos", async () => {
    dadosPorTabela.automation_rules = [];
    await render();

    expect(container.textContent).toContain("Nenhuma automação criada");
    expect(container.textContent).toContain("Faltou alguém no setor");
    expect(container.textContent).toContain("Férias de uma pessoa");
    expect(container.textContent).toContain("Número que vai para outro setor");
    expect(container.textContent).toContain("Setor ficou sem ninguém");
  });

  it("mostra o desvio de cada regra em português", async () => {
    dadosPorTabela.automation_rules = [base, agendadaParaPessoa, fixaPorCanal, encerrada];
    await render();

    const texto = container.textContent ?? "";

    // condição e destino, resolvidos para nome
    expect(texto).toContain("Chat entra no setor");
    expect(texto).toContain("Financeiro");
    expect(texto).toContain("Vai para a fila do setor");
    expect(texto).toContain("Suporte");

    // ação de pessoa
    expect(texto).toContain("Chat entra para");
    expect(texto).toContain("Renata Lima");
    expect(texto).toContain("Vai direto para");
    expect(texto).toContain("Marcos Vieira");

    // canal
    expect(texto).toContain("Chat entra pelo canal");
    expect(texto).toContain("Diretoria");

    // situação
    expect(texto).toContain("Valendo agora");
    expect(texto).toContain("Agendada");
    expect(texto).toContain("Encerrada");

    // temporária x fixa, contadores
    expect(texto).toContain("Temporária");
    expect(texto).toContain("Fixa");
    expect(texto).toContain("Sem prazo");
    expect(texto).toContain("14 chats encaminhados");
    expect(texto).toContain("Ainda não aplicada");
  });

  it("regra encerrada não oferece switch nem Encerrar agora, oferece Duplicar", async () => {
    dadosPorTabela.automation_rules = [encerrada];
    await render();

    expect(container.querySelectorAll('[role="switch"]').length).toBe(0);
    expect(container.textContent).not.toContain("Encerrar agora");
    expect(container.textContent).toContain("Duplicar");
  });

  it("regra valendo e temporária oferece Encerrar agora", async () => {
    dadosPorTabela.automation_rules = [base];
    await render();

    expect(container.querySelectorAll('[role="switch"]').length).toBe(1);
    expect(container.textContent).toContain("Encerrar agora");
  });

  it("motor desligado avisa que nada tem efeito", async () => {
    dadosPorTabela.automation_rules = [base];
    dadosPorTabela.configuracoes = [{ support_config: { distribution_enabled_globally: false } }];
    await render();

    expect(container.textContent).toContain("Motor de distribuição desligado");
    expect(container.textContent).toContain("as automações não fazem nada");
  });

  it("conta as regras por situação nos filtros", async () => {
    dadosPorTabela.automation_rules = [base, agendadaParaPessoa, fixaPorCanal, encerrada];
    await render();

    const filtros = Array.from(container.querySelectorAll("button"))
      .map((b) => b.textContent ?? "")
      .filter((t) => /^(Todas|Valendo agora|Agendadas|Encerradas)/.test(t));

    expect(filtros).toContain("Todas 4");
    expect(filtros).toContain("Valendo agora 2");
    expect(filtros).toContain("Agendadas 1");
    expect(filtros).toContain("Encerradas 1");
  });
});
