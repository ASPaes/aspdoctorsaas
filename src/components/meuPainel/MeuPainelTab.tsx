import { useState } from "react";
import { LayoutDashboard, Settings2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserDashboard } from "@/hooks/useUserDashboard";
import { contarItens, MAX_ITENS, MAX_SECOES } from "@/lib/dashboardLayout";
import { SecaoDoPainel } from "./SecaoDoPainel";
import { ConstrutorDoPainel } from "./ConstrutorDoPainel";

export function MeuPainelTab() {
  const { liberado, layout, isLoading } = useUserDashboard();
  const [editando, setEditando] = useState(false);

  if (!liberado) {
    return (
      <div className="rounded-xl border border-border bg-card/40 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          O Meu Painel ainda está em piloto fechado.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  const total = contarItens(layout);
  const vazio = layout.secoes.length === 0;

  return (
    <div>
      {vazio ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 px-6 py-14 text-center">
          <LayoutDashboard className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
          <h3 className="text-base font-semibold">Monte a sua visão diária</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Escolha até {MAX_ITENS} indicadores entre os que já existem no sistema, agrupe em
            seções e dê a cada seção o filtro que faz sentido para ela.
          </p>
          <Button className="mt-5" onClick={() => setEditando(true)}>
            Montar painel
          </Button>
        </div>
      ) : (
        <>
          {layout.secoes.map((s) => (
            <SecaoDoPainel key={s.id} secao={s} />
          ))}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-3">
            <span className="text-sm text-muted-foreground">
              Você está usando{" "}
              <b className="font-mono tabular-nums text-foreground">
                {total} de {MAX_ITENS}
              </b>{" "}
              indicadores em {layout.secoes.length} de {MAX_SECOES} seções.
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditando(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Nova seção
              </Button>
              <Button size="sm" onClick={() => setEditando(true)}>
                <Settings2 className="mr-1 h-3.5 w-3.5" />
                Editar painel
              </Button>
            </div>
          </div>
        </>
      )}

      <ConstrutorDoPainel aberto={editando} onFechar={() => setEditando(false)} />
    </div>
  );
}
