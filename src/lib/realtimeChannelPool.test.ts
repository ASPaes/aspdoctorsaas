import { describe, it, expect, beforeEach, vi } from "vitest";

// Canal falso: guarda o callback do subscribe para dispararmos status à mão.
type FakeChannel = {
  topic: string;
  subscribeCb: ((status: string) => void) | null;
  on: (...args: any[]) => FakeChannel;
  subscribe: (cb: (status: string) => void) => FakeChannel;
};

const created: FakeChannel[] = [];
const removed: FakeChannel[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (topic: string) => {
      const ch: FakeChannel = {
        topic,
        subscribeCb: null,
        on() { return ch; },
        subscribe(cb) { ch.subscribeCb = cb; return ch; },
      };
      created.push(ch);
      return ch;
    },
    removeChannel: (ch: any) => { removed.push(ch); },
  },
}));

const { subscribeSharedChannel } = await import("./realtimeChannelPool");

const emit = (topic: string, status: string) => {
  const ch = created.filter((c) => c.topic === topic).pop();
  ch?.subscribeCb?.(status);
};

beforeEach(() => {
  created.length = 0;
  removed.length = 0;
});

describe("subscribeSharedChannel", () => {
  it("cria UM canal físico para N assinantes do mesmo topic", () => {
    const a = subscribeSharedChannel("t1", () => {});
    const b = subscribeSharedChannel("t1", () => {});
    expect(created.filter((c) => c.topic === "t1")).toHaveLength(1);
    a(); b();
  });

  it("só configura os .on() no primeiro assinante", () => {
    const cfg = vi.fn();
    const a = subscribeSharedChannel("t2", cfg);
    const b = subscribeSharedChannel("t2", cfg);
    expect(cfg).toHaveBeenCalledTimes(1);
    a(); b();
  });

  // A regressão que este arquivo existe para impedir: antes o onStatus ia direto
  // no channel.subscribe(), que roda uma vez só — o SEGUNDO assinante nunca era
  // avisado de CHANNEL_ERROR e perdia a chance de buscar o que o Realtime não
  // entregou (postgres_changes não tem replay).
  it("entrega o status a TODOS os assinantes, não só ao primeiro", () => {
    const s1 = vi.fn();
    const s2 = vi.fn();
    const a = subscribeSharedChannel("t3", () => {}, s1);
    const b = subscribeSharedChannel("t3", () => {}, s2);

    emit("t3", "CHANNEL_ERROR");

    expect(s1).toHaveBeenCalledWith("CHANNEL_ERROR");
    expect(s2).toHaveBeenCalledWith("CHANNEL_ERROR");
    a(); b();
  });

  it("quem saiu não recebe mais status", () => {
    const s1 = vi.fn();
    const s2 = vi.fn();
    const a = subscribeSharedChannel("t4", () => {}, s1);
    const b = subscribeSharedChannel("t4", () => {}, s2);

    a();
    emit("t4", "SUBSCRIBED");

    expect(s1).not.toHaveBeenCalled();
    expect(s2).toHaveBeenCalledWith("SUBSCRIBED");
    b();
  });

  it("um listener que lança não impede os outros de receber", () => {
    const boom = vi.fn(() => { throw new Error("falhou"); });
    const ok = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const a = subscribeSharedChannel("t5", () => {}, boom);
    const b = subscribeSharedChannel("t5", () => {}, ok);

    expect(() => emit("t5", "TIMED_OUT")).not.toThrow();
    expect(ok).toHaveBeenCalledWith("TIMED_OUT");

    spy.mockRestore();
    a(); b();
  });

  it("remove o canal só quando o último assinante sai", () => {
    const a = subscribeSharedChannel("t6", () => {});
    const b = subscribeSharedChannel("t6", () => {});

    a();
    expect(removed.filter((c) => c.topic === "t6")).toHaveLength(0);
    b();
    expect(removed.filter((c) => c.topic === "t6")).toHaveLength(1);
  });

  it("cleanup chamado duas vezes não derruba o canal dos outros (StrictMode)", () => {
    const a = subscribeSharedChannel("t7", () => {});
    const b = subscribeSharedChannel("t7", () => {});

    a();
    a(); // duplicado de propósito
    expect(removed.filter((c) => c.topic === "t7")).toHaveLength(0);
    b();
    expect(removed.filter((c) => c.topic === "t7")).toHaveLength(1);
  });

  it("depois de todos saírem, um novo assinante recria e reconfigura o canal", () => {
    const cfg = vi.fn();
    subscribeSharedChannel("t8", cfg)();
    const again = subscribeSharedChannel("t8", cfg);

    expect(created.filter((c) => c.topic === "t8")).toHaveLength(2);
    expect(cfg).toHaveBeenCalledTimes(2);
    again();
  });
});
