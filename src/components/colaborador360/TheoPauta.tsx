import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday, parseISO } from "date-fns";
import { History, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface Pauta {
  id: string;
  criado_em: string;
  criado_por: string | null;
  periodo_de: string | null;
  periodo_ate: string | null;
  resumo: string;
  reconhecer: string[];
  conversar: string[];
  desenvolver: string[];
}

const quando = (iso: string) => {
  const d = parseISO(iso);
  return isToday(d) ? `Hoje · ${format(d, "HH:mm")}` : format(d, "dd/MM/yyyy · HH:mm");
};
const lista = (v: unknown) => (Array.isArray(v) ? (v as string[]) : []);

function Blocos({ p }: { p: Pauta }) {
  const grupos = [
    { rotulo: "Reconhecer", itens: p.reconhecer, cor: "text-emerald-700 dark:text-emerald-400" },
    { rotulo: "Conversar", itens: p.conversar, cor: "text-amber-700 dark:text-amber-400" },
    { rotulo: "Desenvolver", itens: p.desenvolver, cor: "text-sky-700 dark:text-sky-400" },
  ].filter((g) => g.itens.length);
  return (
    <>
      <p className="mt-1.5 text-[13px] leading-relaxed">{p.resumo}</p>
      {grupos.map((g) => (
        <div key={g.rotulo} className="mt-2">
          <div className={cn("text-[11px] font-bold uppercase tracking-wider", g.cor)}>{g.rotulo}</div>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-muted-foreground">
            {g.itens.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * Pauta do 1:1 pelo Théo. Ferramenta do gestor: só aparece para head e admin
 * (a tela não monta o card para o operador, e a RPC e a edge recusam também).
 * Só gera quando alguém clica, porque gasta IA da empresa. Toda pauta fica no
 * Histórico.
 */
export function TheoPauta({ userId, nome, de, ate, tenantId, nomeAgente }: {
  userId: string;
  nome: string | null;
  de: Date;
  ate: Date;
  tenantId: string | null;
  nomeAgente: (uid: string | null) => string | null;
}) {
  const qc = useQueryClient();
  const [historico, setHistorico] = useState(false);

  const q = useQuery({
    queryKey: ["colaborador-360-pautas", tenantId, userId],
    staleTime: 60_000,
    queryFn: async (): Promise<Pauta[]> => {
      const { data, error } = await (supabase.rpc as any)("get_colaborador_pautas", { p_user_id: userId, p_tenant_id: tenantId });
      if (error) return [];
      return ((data ?? []) as any[]).map((r) => ({
        ...r, reconhecer: lista(r.reconhecer), conversar: lista(r.conversar), desenvolver: lista(r.desenvolver),
      }));
    },
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("colaborador-pauta-360", {
        body: { user_id: userId, tenant_id: tenantId, de: de.toISOString(), ate: ate.toISOString() },
      });
      if (error) {
        // A edge responde 4xx com a explicação no corpo.
        const ctx = (error as any)?.context;
        const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
        throw new Error(corpo?.error ?? "Não deu para gerar a pauta agora.");
      }
      if (!data?.ok) throw new Error(data?.error ?? "Não deu para gerar a pauta agora.");
      return data.pauta as Pauta;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["colaborador-360-pautas", tenantId, userId] });
      toast.success("Pauta gerada e guardada no histórico.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pautas = q.data ?? [];
  const ultima = pautas[0] ?? null;
  const autor = (p: Pauta) => nomeAgente(p.criado_por) ?? "alguém da equipe";
  const periodo = (p: Pauta) =>
    p.periodo_de && p.periodo_ate ? `${format(parseISO(p.periodo_de), "dd/MM")} a ${format(parseISO(p.periodo_ate), "dd/MM")}` : null;

  return (
    <section className="rounded-xl border bg-gradient-to-br from-emerald-500/10 via-card to-sky-500/10 p-4 shadow-sm">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold">
          <Sparkles className="h-4 w-4 text-emerald-500" />Pauta do 1:1 pelo Théo
        </h3>
        {pautas.length > 0 && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setHistorico(true)}>
            <History className="h-3.5 w-3.5" />Histórico · {pautas.length}
          </Button>
        )}
      </header>

      {ultima ? (
        <div className="mt-2">
          <div className="text-[11.5px] text-muted-foreground">
            {quando(ultima.criado_em)} · pedida por {autor(ultima)}{periodo(ultima) ? ` · números de ${periodo(ultima)}` : ""}
          </div>
          <Blocos p={ultima} />
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          Peça ao Théo uma pauta para a conversa individual com {nome ?? "a pessoa"}: o que reconhecer, o que conversar e o que desenvolver, a partir dos números do período escolhido.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button size="sm" className="h-8 gap-1.5" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
          {gerar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {gerar.isPending ? "Gerando…" : ultima ? "Gerar nova pauta" : "Gerar pauta"}
        </Button>
        <span className="text-[11.5px] text-muted-foreground">Só roda quando você clica. Cada pauta consome crédito de IA da empresa.</span>
      </div>

      <Sheet open={historico} onOpenChange={setHistorico}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Pautas de {nome ?? "1:1"}</SheetTitle>
            <SheetDescription>Todas as pautas pedidas ao Théo, da mais nova para a mais antiga.</SheetDescription>
          </SheetHeader>
          <ul className="mt-4 grid gap-3">
            {pautas.map((p, i) => (
              <li key={p.id} className={cn("rounded-xl border p-3", i === 0 && "border-emerald-500/60 bg-emerald-500/10")}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <b className="text-foreground">{quando(p.criado_em)}</b>
                  <span>{autor(p)}{periodo(p) ? ` · ${periodo(p)}` : ""}</span>
                </div>
                <Blocos p={p} />
              </li>
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </section>
  );
}
