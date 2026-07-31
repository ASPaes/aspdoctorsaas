// Cobrança automática NÃO pode trocar o setor de um atendimento vivo.
//
// A RLS de `support_attendances` só deixa role 'user' enxergar atendimento do
// próprio setor. Mover para o Financeiro um atendimento que já está em curso o
// torna invisível para quem está atendendo: o chat some da lista, parece
// "encerrado sozinho", e o botão Reabrir não resolve — `claim_conversation` é
// SECURITY DEFINER e não mexe no setor.
//
// O setor só pode ser definido quando não há nada a preservar: sem setor E sem
// dono. É a regra que estes testes travam.
//
// ESCOPO: cobre o ramo de atendimento ATIVO (waiting/in_progress), que é onde
// mora a regra. O ramo de criação/reabertura (quando não há atendimento ativo)
// não está coberto aqui — depende de getSupportConfig e da janela de reabertura.
import { describe, it, expect } from "vitest";
import { ensureAttendanceForBilling } from "./message-processor.ts";

type Chamada = { tabela: string; op: "select" | "update" | "insert"; payload?: any };

/**
 * Client do Supabase falso, encadeável e "thenable" — o código faz
 * `await supabase.from(x).update(y).eq(...)` sem chamar `.single()`.
 */
function fakeSupabase(atendimentoAtivo: any) {
  const chamadas: Chamada[] = [];

  const from = (tabela: string) => {
    let op: Chamada["op"] = "select";
    let payload: any;

    const registrar = () => {
      chamadas.push({ tabela, op, payload });
    };

    const chain: any = {
      select: () => chain,
      insert: (p: any) => { op = "insert"; payload = p; return chain; },
      update: (p: any) => { op = "update"; payload = p; return chain; },
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => {
        registrar();
        return { data: atendimentoAtivo };
      },
      single: async () => {
        registrar();
        return { data: { id: "novo", attendance_code: "AT-1" }, error: null };
      },
      // torna o builder awaitable: `await …update(…).eq(…)`
      then: (resolve: any) => {
        registrar();
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };
    return chain;
  };

  return { supabase: { from } as any, chamadas };
}

const updatesDeSetor = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.op === "update" && c.payload && "department_id" in c.payload);

const updatesDeCliente = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.op === "update" && c.payload && "cliente_id" in c.payload);

const chamar = (supabase: any, clienteId?: string | null) =>
  ensureAttendanceForBilling(supabase, "conv-1", "contato-1", "tenant-1", "setor-financeiro", clienteId);

describe("ensureAttendanceForBilling — atendimento já em curso", () => {
  it("NÃO troca o setor de atendimento que já tem setor", async () => {
    const { supabase, chamadas } = fakeSupabase({
      id: "att-1",
      department_id: "setor-suporte",
      assigned_to: null,
    });

    await chamar(supabase);

    expect(updatesDeSetor(chamadas)).toEqual([]);
  });

  it("NÃO troca o setor de atendimento que já tem dono", async () => {
    const { supabase, chamadas } = fakeSupabase({
      id: "att-1",
      department_id: null,
      assigned_to: "operador-7",
    });

    await chamar(supabase);

    expect(updatesDeSetor(chamadas)).toEqual([]);
  });

  it("NÃO troca o setor quando tem setor E dono", async () => {
    const { supabase, chamadas } = fakeSupabase({
      id: "att-1",
      department_id: "setor-suporte",
      assigned_to: "operador-7",
    });

    await chamar(supabase);

    expect(updatesDeSetor(chamadas)).toEqual([]);
  });

  it("define o setor quando não há setor NEM dono — não há o que preservar", async () => {
    const { supabase, chamadas } = fakeSupabase({
      id: "att-1",
      department_id: null,
      assigned_to: null,
    });

    await chamar(supabase);

    const updates = updatesDeSetor(chamadas);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.department_id).toBe("setor-financeiro");
  });

  it("grava o cliente mesmo quando não pode mexer no setor", async () => {
    const { supabase, chamadas } = fakeSupabase({
      id: "att-1",
      department_id: "setor-suporte",
      assigned_to: "operador-7",
    });

    await chamar(supabase, "cliente-42");

    expect(updatesDeSetor(chamadas)).toEqual([]);
    const updates = updatesDeCliente(chamadas);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.cliente_id).toBe("cliente-42");
  });

  it("não cria atendimento novo quando já existe um ativo", async () => {
    const { supabase, chamadas } = fakeSupabase({
      id: "att-1",
      department_id: "setor-suporte",
      assigned_to: null,
    });

    await chamar(supabase, "cliente-42");

    expect(chamadas.filter((c) => c.op === "insert")).toEqual([]);
  });
});
