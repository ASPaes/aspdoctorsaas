import { describe, it, expect } from "vitest";
import { getSendErrorInfo } from "./metaSendErrors";

/**
 * A tarja de falha não pode acusar a Meta pelo que a Meta não fez.
 *
 * Em 10/09/2026, um vídeo e um áudio enviados a um grupo pela Evolution apareceram
 * para o atendente com "A Meta recusou o envio desta mensagem". O cliente tinha
 * recebido os dois, a instância não é meta_cloud, e não houve recusa nenhuma: o que
 * existia era a nossa própria conclusão de que faltou confirmação de entrega.
 */
describe("getSendErrorInfo", () => {
  it("sem send_error não monta tarja", () => {
    expect(getSendErrorInfo(null)).toBeNull();
    expect(getSendErrorInfo({})).toBeNull();
    expect(getSendErrorInfo({ send_error: null })).toBeNull();
  });

  it("o veredito da verify-failed-deliveries não menciona a Meta", () => {
    const info = getSendErrorInfo({
      send_error: {
        origem: "verify-failed-deliveries",
        motivo: "sem confirmação de entrega após a janela; sem reenvio automático (grupo: ack de falha é por participante)",
        at: "2026-09-10T15:17:02.071Z",
      },
    });
    expect(info?.titulo).toBe("Sem confirmação de entrega");
    expect(info?.motivo).not.toMatch(/Meta/i);
    expect(info?.motivo).not.toMatch(/recus/i);
    expect(info?.escopo).toBe("sistema");
    // o menu "Reenviar mensagem" depende disto
    expect(info?.retryable).toBe(true);
  });

  it("não vaza o registro interno para a tela", () => {
    const info = getSendErrorInfo({
      send_error: { origem: "verify-failed-deliveries", motivo: "sem confirmação de entrega após a janela; sem reenvio automático (mensagem de sistema)" },
    });
    expect(info?.motivo).not.toMatch(/janela|ack|participante/i);
  });

  it("diz que o reenvio automático também falhou, quando foi o caso", () => {
    const info = getSendErrorInfo({
      send_error: {
        origem: "verify-failed-deliveries",
        motivo: "sem confirmação de entrega após a janela, e o reenvio automático também falhou",
      },
    });
    expect(info?.motivo).toMatch(/reenvio automático também não passou/);
  });

  it("código conhecido da Meta continua com o texto próprio", () => {
    const info = getSendErrorInfo({ send_error: { code: 131047, title: "Re-engagement message" } });
    expect(info?.titulo).toBe("Janela de 24h fechada");
    expect(info?.retryable).toBe(false);
  });

  it("erro da Meta sem código mapeado continua nomeando a Meta", () => {
    const info = getSendErrorInfo({ send_error: { code: 999999, title: "Something broke" } });
    expect(info?.motivo).toBe("Erro da Meta: Something broke.");
    expect(info?.escopo).toBe("meta");
  });
});
