/**
 * Guarda do e-mail pelo ticket: nota interna não pode vazar por engano.
 *   bun test supabase/functions/gerar-email-chat/
 */
import { describe, expect, test } from "bun:test";
import { cabecalhoDoTicket, eventoVisivel, formatarEventos, type EventoTicket } from "./ticket.ts";

const hora = (iso: string) => iso.slice(11, 16);
const ev = (p: Partial<EventoTicket>): EventoTicket => ({
  event_type: "comment",
  content: null,
  old_value: null,
  new_value: null,
  created_at: "2026-09-17T09:00:00Z",
  ...p,
});

describe("o que a IA lê do ticket", () => {
  const eventos = [
    ev({ event_type: "created", content: "Cliente abriu pelo e-mail" }),
    ev({ event_type: "comment", content: "cliente é chato, empurrar para amanhã", created_at: "2026-09-17T09:05:00Z" }),
    ev({ event_type: "status_change", old_value: "Aberto", new_value: "Em andamento", created_at: "2026-09-17T09:10:00Z" }),
    ev({ event_type: "email_cliente", content: "Segue o print do erro", created_at: "2026-09-17T09:20:00Z" }),
    ev({ event_type: "closed", content: "Certificado renovado", created_at: "2026-09-17T10:00:00Z" }),
  ];

  test("sem as notas internas, o que sobra descreve o andamento", () => {
    const texto = formatarEventos(eventos, false, hora);
    expect(texto).not.toContain("cliente é chato");
    expect(texto).toContain("[09:00] Chamado aberto: Cliente abriu pelo e-mail");
    expect(texto).toContain("[09:10] Status: Aberto para Em andamento");
    expect(texto).toContain("[09:20] E-mail do cliente: Segue o print do erro");
    expect(texto).toContain("[10:00] Chamado encerrado: Certificado renovado");
  });

  test("com a opção ligada, a nota entra marcada como interna", () => {
    expect(formatarEventos(eventos, true, hora)).toContain("[09:05] Nota interna: cliente é chato");
  });

  test("evento desconhecido nunca entra sozinho", () => {
    expect(eventoVisivel("qualquer_coisa_nova", true)).toBe(false);
    expect(formatarEventos([ev({ event_type: "qualquer_coisa_nova", content: "x" })], true, hora)).toBe("");
  });

  test("texto enorme é cortado", () => {
    const grande = formatarEventos([ev({ event_type: "created", content: "a".repeat(2000) })], false, hora);
    expect(grande.length).toBeLessThan(800);
    expect(grande.endsWith("…")).toBe(true);
  });
});

describe("cabeçalho do chamado", () => {
  test("traz código, assunto, status e a descrição da abertura", () => {
    const c = cabecalhoDoTicket(
      {
        ticket_code: "TK-2026-0412",
        assunto: "Nota fiscal rejeitada",
        descricao: "Não sai no fechamento",
        aberto_em: "2026-09-17T09:00:00Z",
        status: "Em andamento",
        encerrado_em: null,
      },
      hora,
    );
    expect(c).toContain("Chamado TK-2026-0412 aberto em 09:00");
    expect(c).toContain("Assunto: Nota fiscal rejeitada");
    expect(c).toContain("Status atual: Em andamento");
    expect(c).toContain("Descrição da abertura: Não sai no fechamento");
  });
});
