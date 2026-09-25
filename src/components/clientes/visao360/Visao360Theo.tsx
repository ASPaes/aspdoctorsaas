import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday, parseISO } from "date-fns";
import { History, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface Resumo {
  id: string;
  criado_em: string;
  criado_por: string | null;
  resumo: string;
  pontos: string[];
}

function quando(iso: string) {
  const d = parseISO(iso);
  return isToday(d) ? `Hoje · ${format(d, "HH:mm")}` : format(d, "dd/MM/yyyy · HH:mm");
}

/**
 * Resumo do Théo. Só gera quando a pessoa clica (gasta IA da empresa). O card
 * mostra o ÚLTIMO resumo do dia; o de ontem não aparece aqui como se fosse de
 * hoje, fica no Histórico, que guarda todos.
 */
export function TheoResumo({ clienteId, nomeAgente }: { clienteId: string; nomeAgente: (uid: string | null) => string | null }) {
  const qc = useQueryClient();
  const [historico, setHistorico] = useState(false);

  const q = useQuery({
    queryKey: ["visao360_resumos", clienteId],
    staleTime: 60_000,
    queryFn: async (): Promise<Resumo[]> => {
      const { data, error } = await (supabase.from("cliente_resumos_ia" as any) as any)
        .select("id, criado_em, criado_por, resumo, pontos")
        .eq("cliente_id", clienteId)
        .order("criado_em", { ascending: false })
        .limit(200);
      // Tabela ainda não criada ou sem acesso: o card mostra só o botão.
      if (error) return [];
      return (data ?? []).map((r: any) => ({ ...r, pontos: Array.isArray(r.pontos) ? r.pontos : [] }));
    },
  });

  const gerar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("cliente-resumo-360", { body: { cliente_id: clienteId } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Não deu para gerar o resumo.");
      return data.resumo as Resumo;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["visao360_resumos", clienteId] });
      toast.success("Resumo gerado e guardado no histórico.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const lista = q.data ?? [];
  const deHoje = lista.find((r) => isToday(parseISO(r.criado_em))) ?? null;
  const ultimo = lista[0] ?? null;
  const autor = (r: Resumo) => nomeAgente(r.criado_por) ?? "alguém da equipe";

  return (
    <section className="rounded-xl border bg-gradient-to-br from-emerald-500/10 via-card to-sky-500/10 p-4 shadow-sm">
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-bold">
          <Sparkles className="h-4 w-4 text-emerald-500" />Resumo do Théo
        </h3>
        {lista.length > 0 && (
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => setHistorico(true)}>
            <History className="h-3.5 w-3.5" />Histórico · {lista.length}
          </Button>
        )}
      </header>

      {deHoje ? (
        <div className="mt-2">
          <div className="text-[11.5px] text-muted-foreground">Último resumo de hoje · {format(parseISO(deHoje.criado_em), "HH:mm")} · pedido por {autor(deHoje)}</div>
          <p className="mt-1.5 text-[13px] leading-relaxed">{deHoje.resumo}</p>
          {deHoje.pontos.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px] text-muted-foreground">
              {deHoje.pontos.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {ultimo
            ? `Nenhum resumo hoje. O último foi em ${format(parseISO(ultimo.criado_em), "dd/MM/yyyy")}, por ${autor(ultimo)}, e está no Histórico.`
            : "Nenhum resumo deste cliente ainda. Peça um para o Théo ler o histórico e contar como está a relação."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <Button size="sm" className="h-8 gap-1.5" onClick={() => gerar.mutate()} disabled={gerar.isPending}>
          {gerar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {gerar.isPending ? "Gerando…" : deHoje ? "Gerar novo resumo" : "Gerar resumo"}
        </Button>
        <span className="text-[11.5px] text-muted-foreground">O Théo só roda quando você clica. Cada resumo consome crédito de IA da empresa.</span>
      </div>

      <Sheet open={historico} onOpenChange={setHistorico}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Histórico do Théo</SheetTitle>
            <SheetDescription>Todos os resumos pedidos para este cliente, do mais novo para o mais antigo.</SheetDescription>
          </SheetHeader>
          <ul className="mt-4 grid gap-3">
            {lista.map((r) => {
              const destaque = deHoje?.id === r.id;
              return (
                <li key={r.id} className={cn("rounded-xl border p-3", destaque && "border-emerald-500/60 bg-emerald-500/10")}>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <b className="text-foreground">{quando(r.criado_em)}</b>
                    <span className="flex items-center gap-1.5">
                      {autor(r)}
                      {destaque && <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10.5px] font-bold text-emerald-700 dark:text-emerald-400">Último do dia</span>}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px]">{r.resumo}</p>
                  {r.pontos.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12.5px] text-muted-foreground">
                      {r.pontos.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </section>
  );
}
