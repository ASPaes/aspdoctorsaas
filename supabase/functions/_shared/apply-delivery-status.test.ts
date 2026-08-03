// O que este teste protege: o webhook nao pode mais gravar status cru. Se ele voltar a
// gravar direto, um ERROR de um aparelho apaga o DELIVERY_ACK de outro — e foi assim que
// ~1.400 mensagens em 21 dias apareceram como enviadas sem terem chegado.
//
// Mock minimo do client do Supabase, no mesmo estilo de business-hours.test.ts: cada
// .from() devolve um objeto encadeavel e "thenable", como o PostgREST.
import { describe, it, expect } from "vitest";
import { applyDeliveryStatus } from "./apply-delivery-status.ts";

function mockSupabase(statusAtual: string | null) {
  const updates: any[] = [];
  const chain: any = {
    select() { return chain; },
    eq() { return chain; },
    maybeSingle: async () => ({
      data: statusAtual === null ? null : { status: statusAtual },
      error: null,
    }),
    update(payload: any) { updates.push(payload); return chain; },
    then(resolve: any) { return Promise.resolve({ error: null }).then(resolve); },
  };
  return { client: { from: () => chain }, updates };
}

const alvo = { tenantId: "t1", messageId: "3EB0ABC" };

describe("applyDeliveryStatus", () => {
  it("nao grava status quando o ack rebaixaria a mensagem", async () => {
    const { client, updates } = mockSupabase("read");
    const r = await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "ERROR" });
    expect(r.changed).toBe(false);
    expect(r.confirmedFailureCandidate).toBe(false);
    // ainda assim registra o sinal para diagnostico, sem mexer no status
    expect(updates[0]).toHaveProperty("last_error_at");
    expect(updates[0]).not.toHaveProperty("status");
  });

  it("grava error em cima de pending e sinaliza candidato a falha", async () => {
    const { client, updates } = mockSupabase("pending");
    const r = await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "ERROR" });
    expect(r.changed).toBe(true);
    expect(r.confirmedFailureCandidate).toBe(true);
    expect(updates[0].status).toBe("error");
    expect(updates[0]).toHaveProperty("last_error_at");
  });

  it("marca delivery_confirmed_at no primeiro ack positivo", async () => {
    const { client, updates } = mockSupabase("sent");
    await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "DELIVERY_ACK" });
    expect(updates[0].status).toBe("delivered");
    expect(updates[0]).toHaveProperty("delivery_confirmed_at");
  });

  it("traduz o vocabulario da Meta: failed vira error", async () => {
    const { client, updates } = mockSupabase("pending");
    const r = await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "failed" });
    expect(updates[0].status).toBe("error");
    expect(r.confirmedFailureCandidate).toBe(true);
  });

  it("traduz o vocabulario da Z-API: DELIVERED vira delivered", async () => {
    const { client, updates } = mockSupabase("sent");
    await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "DELIVERED" });
    expect(updates[0].status).toBe("delivered");
  });

  it("SERVER_ACK promove pending para sent", async () => {
    const { client, updates } = mockSupabase("pending");
    const r = await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "SERVER_ACK" });
    expect(updates[0].status).toBe("sent");
    expect(r.confirmedFailureCandidate).toBe(false);
  });

  it("mensagem inexistente nao explode e nao grava nada", async () => {
    const { client, updates } = mockSupabase(null);
    const r = await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "READ" });
    expect(r.changed).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("ack repetido nao gera escrita", async () => {
    const { client, updates } = mockSupabase("read");
    const r = await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "READ" });
    expect(r.changed).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("status desconhecido do provedor nao vira status no banco", async () => {
    const { client, updates } = mockSupabase("sent");
    const r = await applyDeliveryStatus(client as any, { ...alvo, providerStatus: "BANANA_ACK" });
    expect(r.changed).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
