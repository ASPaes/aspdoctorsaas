import { describe, it, expect } from "vitest";
import { isChurnDismissed, showsCSTicketAlert } from "./churnDismiss";

const descartado = (attId: string | null) => ({
  churn_dismissed_at: "2026-08-26T13:30:00Z",
  churn_dismissed_attendance_id: attId,
});

describe("isChurnDismissed", () => {
  it("é falso sem análise ou sem descarte", () => {
    expect(isChurnDismissed(null, "att-1")).toBe(false);
    expect(isChurnDismissed({ churn_dismissed_at: null, churn_dismissed_attendance_id: null }, "att-1")).toBe(false);
  });

  it("vale enquanto o atendimento ancorado for o ativo", () => {
    expect(isChurnDismissed(descartado("att-1"), "att-1")).toBe(true);
  });

  it("expira quando o atendimento fecha e outro abre — a regra do owner", () => {
    expect(isChurnDismissed(descartado("att-1"), "att-2")).toBe(false);
    expect(isChurnDismissed(descartado("att-1"), null)).toBe(false);
  });

  it("descarte sem atendimento ativo vale até o próximo atendimento abrir", () => {
    expect(isChurnDismissed(descartado(null), null)).toBe(true);
    expect(isChurnDismissed(descartado(null), "att-1")).toBe(false);
  });

  it("undefined e null da mesma âncora são o mesmo caso", () => {
    expect(isChurnDismissed(descartado(null), undefined)).toBe(true);
    expect(isChurnDismissed({ churn_dismissed_at: "2026-08-26T13:30:00Z" }, null)).toBe(true);
  });
});

describe("showsCSTicketAlert", () => {
  const pede = { needs_cs_ticket: true, cs_ticket_created_id: null };

  it("mostra quando a IA pede ticket e ninguém descartou", () => {
    expect(showsCSTicketAlert(pede, null)).toBe(true);
  });

  it("some com ticket já criado", () => {
    expect(showsCSTicketAlert({ ...pede, cs_ticket_created_id: "tk-1" }, null)).toBe(false);
  });

  it("some com descarte ativo — o motivo desta entrega", () => {
    expect(showsCSTicketAlert({ ...pede, ...descartado("att-1") }, "att-1")).toBe(false);
  });

  it("volta a aparecer quando o descarte expira", () => {
    expect(showsCSTicketAlert({ ...pede, ...descartado("att-1") }, "att-2")).toBe(true);
  });

  it("não mostra sem análise nem quando a IA não pediu", () => {
    expect(showsCSTicketAlert(null, null)).toBe(false);
    expect(showsCSTicketAlert({ needs_cs_ticket: false }, null)).toBe(false);
  });
});
