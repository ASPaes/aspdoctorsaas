import { useEffect, useRef, useState } from "react";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { Skeleton } from "@/components/ui/skeleton";
import { entradaPorId, type CatalogEntry } from "@/lib/kpiCatalog";
import { resolverIndicador } from "@/lib/valorDoIndicador";
import type { LayoutSecao } from "@/lib/dashboardLayout";
import {
  normalizarFiltros, rotuloDoPeriodo, type FiltrosSecao,
} from "./filtrosDaSecao";
import {
  ehProviderAtendimento, useDadosAtendimento,
  useDadosCS, useDadosCertificados, useDadosFinanceiro, type DadosDaSecao,
} from "./useDadosDaSecao";

const NOME_AREA: Record<string, string> = {
  atendimento: "Atendimento",
  financeiro: "Financeiro",
  cs: "Customer Success",
  implantacao: "Implantação",
  certificados: "Certificados A1",
};

const COR_AREA: Record<string, string> = {
  atendimento: "bg-sky-500/15 text-sky-300",
  financeiro: "bg-green-500/15 text-green-300",
  cs: "bg-violet-500/15 text-violet-300",
  implantacao: "bg-amber-500/15 text-amber-300",
  certificados: "bg-slate-500/15 text-slate-300",
};

/** Só monta o filho quando a seção entra na tela. É isso que faz a carga
 *  preguiçosa: enquanto não aparece, nenhum hook de dados é chamado — e uma
 *  seção Financeiro no rodapé não paga as ~20 varreduras enquanto o gestor
 *  olha o topo. */
function QuandoVisivel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (visivel || !ref.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisivel(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) setVisivel(true);
      },
      { rootMargin: "200px" },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visivel]);

  return <div ref={ref}>{visivel ? children : <Skeleton className="h-24 w-full rounded-lg" />}</div>;
}

function GradeDeItens({
  entradas, dados, carregando,
}: {
  entradas: CatalogEntry[];
  dados: DadosDaSecao;
  carregando: boolean;
}) {
  if (carregando) {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        {entradas.map((e) => (
          <Skeleton key={e.id} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
      {entradas.map((entrada) => {
        const { texto, numero } = resolverIndicador(entrada, dados[entrada.source.provider]);
        return (
          <KPICardEnhanced
            key={entrada.id}
            label={entrada.label}
            value={texto}
            helpKey={entrada.helpKey}
            currentValue={numero}
            size="md"
            variant="dark"
          />
        );
      })}
    </div>
  );
}

function DadosAtendimento({ entradas, filtros }: { entradas: CatalogEntry[]; filtros: FiltrosSecao }) {
  const necessarios = new Set(
    entradas.map((e) => e.source.provider).filter(ehProviderAtendimento),
  );
  const { carregando, ...dados } = useDadosAtendimento(necessarios, filtros);
  return <GradeDeItens entradas={entradas} dados={dados} carregando={carregando} />;
}

function DadosFinanceiro({ entradas, filtros }: { entradas: CatalogEntry[]; filtros: FiltrosSecao }) {
  const { carregando, ...dados } = useDadosFinanceiro(filtros);
  return <GradeDeItens entradas={entradas} dados={dados} carregando={carregando} />;
}

function DadosCS({ entradas, filtros }: { entradas: CatalogEntry[]; filtros: FiltrosSecao }) {
  const { carregando, ...dados } = useDadosCS(filtros);
  return <GradeDeItens entradas={entradas} dados={dados} carregando={carregando} />;
}

function DadosCertificados({ entradas, filtros }: { entradas: CatalogEntry[]; filtros: FiltrosSecao }) {
  const { carregando, ...dados } = useDadosCertificados(filtros);
  return <GradeDeItens entradas={entradas} dados={dados} carregando={carregando} />;
}

export function SecaoDoPainel({ secao }: { secao: LayoutSecao }) {
  const filtros = normalizarFiltros(secao.filtros);
  const entradas = secao.itens
    .map((i) => entradaPorId(i.id))
    .filter((e): e is CatalogEntry => !!e && !e.pending);

  const rotulos: string[] = [rotuloDoPeriodo(filtros.periodo)];
  if (filtros.departmentId) rotulos.push("Setor selecionado");
  if (filtros.agentId) rotulos.push("Agente selecionado");
  if (filtros.tipoAtendimento !== "all") {
    rotulos.push(filtros.tipoAtendimento === "group" ? "Só grupos" : "Só individuais");
  }
  if (filtros.plantao !== "all") {
    rotulos.push(filtros.plantao === "plantao" ? "Só plantão" : "Só horário comercial");
  }
  if (filtros.fornecedorIds.length > 0) rotulos.push(`${filtros.fornecedorIds.length} fornecedor(es)`);

  return (
    <section className="mt-5 rounded-xl border border-border bg-card/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{secao.nome}</h3>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              COR_AREA[secao.area] ?? "bg-muted text-muted-foreground"
            }`}
          >
            {NOME_AREA[secao.area] ?? secao.area}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {rotulos.map((r) => (
            <span
              key={r}
              className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground"
            >
              {r}
            </span>
          ))}
        </div>
      </header>

      {entradas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Nenhum indicador nesta seção ainda.
        </p>
      ) : secao.area === "implantacao" ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Os indicadores de Implantação ainda não estão disponíveis no painel. A tela de
          Implantação monta os números dentro da própria página, sem um hook reaproveitável —
          construir isso sem alterar a tela existente é uma entrega à parte.
        </p>
      ) : (
        <QuandoVisivel>
          {secao.area === "atendimento" ? (
            <DadosAtendimento entradas={entradas} filtros={filtros} />
          ) : secao.area === "financeiro" ? (
            <DadosFinanceiro entradas={entradas} filtros={filtros} />
          ) : secao.area === "cs" ? (
            <DadosCS entradas={entradas} filtros={filtros} />
          ) : (
            <DadosCertificados entradas={entradas} filtros={filtros} />
          )}
        </QuandoVisivel>
      )}
    </section>
  );
}
