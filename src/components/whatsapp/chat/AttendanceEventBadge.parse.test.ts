import { describe, it, expect } from "vitest";
import { parseAttendanceEvent } from "./AttendanceEventBadge";

/**
 * Aviso de atendimento em grupo: chip, não balão do operador.
 *
 * Em 09/09/2026 o aviso "✅ Atendimento *07293/26* iniciado." apareceu num grupo como
 * balão verde com ícone de falha e a tarja "A Meta recusou o envio desta mensagem" —
 * numa mensagem que o cliente tinha recebido normalmente. Duas causas se somaram, e
 * estes casos travam a parte que é de tela:
 *
 *   1. o botão "Iniciar atendimento" do cabeçalho manda o aviso pela
 *      send-whatsapp-message como `messageType: 'text'`, então a linha nunca teve o
 *      tipo `system` que o chat usa para reconhecer aviso (corrigido na function, mas
 *      o histórico já gravado continua `text` + `metadata.system_message`);
 *   2. o código do aviso de grupo vem entre asteriscos, e o regex não os previa.
 */
describe("parseAttendanceEvent", () => {
  it("reconhece o aviso de grupo pelo metadata, com o código entre asteriscos", () => {
    expect(
      parseAttendanceEvent({
        content: "✅ Atendimento *07293/26* iniciado.",
        message_type: "system",
        metadata: { system: true, attendance_event: "opened", attendance_id: "a1" },
      }),
    ).toEqual({ eventType: "opened", code: "07293/26" });
  });

  it("reconhece o aviso de 1:1, sem asteriscos", () => {
    expect(
      parseAttendanceEvent({
        content: "✅ Atendimento 00035/26 aberto com sucesso.",
        message_type: "system",
        metadata: null,
      }),
    ).toEqual({ eventType: "opened", code: "00035/26" });
  });

  // O caso que o Alexandre viu na tela: linha antiga, gravada como `text` pelo botão do
  // cabeçalho, e por isso julgada e condenada pela varredura de entrega.
  it("reconhece o aviso já gravado como text, pelo system_message", () => {
    expect(
      parseAttendanceEvent({
        content: "✅ Atendimento *07293/26* iniciado.",
        message_type: "text",
        metadata: { system_message: true, sender_signature_mode: "off" },
      }),
    ).toEqual({ eventType: "opened", code: "07293/26" });
  });

  it("reconhece o encerramento de grupo", () => {
    expect(
      parseAttendanceEvent({
        content:
          "✅ Atendimento *07293/26* encerrado com sucesso.\n\nObrigado pelo contato!",
        message_type: "text",
        metadata: { system_message: true },
      }),
    ).toEqual({ eventType: "closed", code: "07293/26" });
  });

  // `system_message` também marca o convite do CSAT, que é mensagem de verdade para o
  // cliente. Casar pela flag sozinha transformaria a pesquisa num chip.
  it("não transforma o convite do CSAT em chip", () => {
    expect(
      parseAttendanceEvent({
        content: "De 1 a 5, como você avalia o atendimento que acabou de receber?",
        message_type: "text",
        metadata: { system_message: true },
      }),
    ).toBeNull();
  });

  it("não transforma em chip a mensagem do operador que cita um atendimento", () => {
    expect(
      parseAttendanceEvent({
        content: "O Atendimento 07293/26 encerrado ontem era sobre a mesma coisa?",
        message_type: "text",
        metadata: { sender_signature_mode: "name" },
      }),
    ).toBeNull();
  });
});
