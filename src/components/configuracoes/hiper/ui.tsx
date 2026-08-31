/**
 * Vocabulário visual da integração Hiper.
 *
 * Duas bases, dois significados para a mesma palavra. A tela mistura as duas o
 * tempo todo, e sem rótulo ninguém sabe qual número está olhando: "custo" é
 * sempre o que o Hiper cobra de você, "mensalidade" é sempre o que o seu
 * cliente paga. Onde aparecer valor, aparece de onde ele vem.
 */
import React from "react";

export const brl = (v: number | null | undefined) =>
  (Number(v ?? 0)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const num = (v: number | null | undefined) =>
  (Number(v ?? 0)).toLocaleString("pt-BR");

export const cnpjMask = (v: string | null | undefined) => {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length !== 14) return v ?? "—";
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

/**
 * Como o Hiper chama cada arranjo comercial, e o que ele significa para a conta
 * do mês. É a distinção que decide o que pode ser comparado com o cadastro
 * daqui — no Hiperador o preço é seu e o portal nem o conhece.
 */
export const TIPO_CONTRATO: Record<string, { nome: string; explica: string }> = {
  hiper: {
    nome: "Hiperador",
    explica: "Você cobra o cliente. O portal só sabe o custo — o preço é decisão sua e por isso não é comparado.",
  },
  central_cobranca: {
    nome: "Central de Cobrança",
    explica: "A Hiper cobra o cliente e te repassa. MRR e custo saem do portal.",
  },
  central_leads: {
    nome: "Central de Leads",
    explica: "A Hiper cobra o cliente e te repassa. MRR e custo saem do portal.",
  },
};

export const nomeTipo = (t: string | null | undefined) =>
  (t && TIPO_CONTRATO[t]?.nome) || t || "—";

export function Explica({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** De onde o número vem. Sem isso "custo" fica ambíguo em toda a tela. */
export function Origem({ lado }: { lado: "hiper" | "ds" }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        lado === "hiper"
          ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      }`}
    >
      {lado === "hiper" ? "Hiper" : "DoctorSaaS"}
    </span>
  );
}

export function Numero({
  valor, rotulo, sub, tom = "normal", title,
}: {
  valor: React.ReactNode;
  rotulo: string;
  sub?: React.ReactNode;
  tom?: "normal" | "bom" | "alerta" | "ruim";
  title?: string;
}) {
  const cor =
    tom === "bom" ? "text-emerald-600 dark:text-emerald-400"
    : tom === "alerta" ? "text-amber-600 dark:text-amber-400"
    : tom === "ruim" ? "text-destructive"
    : "";
  return (
    <div className="rounded-lg border bg-card p-4" title={title}>
      <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="text-sm font-medium mt-1">{rotulo}</p>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * O aviso que evita a pior leitura possível da tela: aba vazia parecendo bug.
 * Enquanto o PortalHiper não tiver os campos novos, Módulos e Filiais não têm
 * de onde sair — e isso precisa estar escrito, não deduzido.
 */
export function PortalDesatualizado({ o_que }: { o_que: string }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <p className="font-medium text-amber-600 dark:text-amber-400">
        O PortalHiper ainda não envia {o_que}
      </p>
      <p className="text-muted-foreground mt-1">
        Não é erro daqui e não há nada a corrigir nesta tela: a versão do portal que está no ar
        não expõe esses campos. Depois de atualizar o portal, rode <strong>Atualizar espelho
        agora</strong> na aba Sincronização e esta lista se preenche sozinha.
      </p>
    </div>
  );
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
