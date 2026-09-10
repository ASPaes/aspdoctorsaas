import { useCallback, useEffect, useRef, useState } from "react";
import { KPICardEnhanced } from "@/components/dashboard/cards/KPICardEnhanced";
import { Skeleton } from "@/components/ui/skeleton";
import { entradaPorId, type CatalogEntry, type KpiArea } from "@/lib/kpiCatalog";
import { resolverIndicador } from "@/lib/valorDoIndicador";
import { areasDaSecao, type LayoutSecao } from "@/lib/dashboardLayout";
import { normalizarFiltros, type FiltrosSecao } from "./filtrosDaSecao";
import { FiltrosDaSecaoBar } from "./FiltrosDaSecaoBar";
import { GraficoDoPainel } from "./GraficoDoPainel";
import {
  ehProviderAtendimento, useDadosAtendimento,
  useDadosCS, useDadosCertificados, useDadosFinanceiro, type DadosDaSecao,
} from "./useDadosDaSecao";

const NOME_AREA: Record<KpiArea, string> = {
  atendimento: "Atendimento",
  financeiro: "Financeiro",
  cs: "Customer Success",
  implantacao: "Implantação",
  certificados: "Certificados A1",
};

const COR_AREA: Record<KpiArea, string> = {
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

type Publicar = (dados: DadosDaSecao, carregando: boolean, area: KpiArea) => void;

/** Cada carregador é montado só quando a seção tem item daquela área — é o
 *  gate que impede uma seção sem Financeiro de disparar as varreduras dele.
 *  Não desenham nada: entregam o dado ao pai, que monta uma grade só. */
function CarregaAtendimento({ entradas, filtros, publicar }: {
  entradas: CatalogEntry[]; filtros: FiltrosSecao; publicar: Publicar;
}) {
  const necessarios = new Set(
    entradas.map((e) => e.source.provider).filter(ehProviderAtendimento),
  );
  const { carregando, ...dados } = useDadosAtendimento(necessarios, filtros);
  const assinatura = JSON.stringify(Object.keys(dados).map((k) => dados[k as never] !== undefined));
  useEffect(() => {
    publicar(dados, carregando, "atendimento");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, assinatura]);
  return null;
}

function CarregaFinanceiro({ filtros, publicar }: { filtros: FiltrosSecao; publicar: Publicar }) {
  const { carregando, ...dados } = useDadosFinanceiro(filtros);
  useEffect(() => {
    publicar(dados, carregando, "financeiro");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, dados["financeiro.dashboard"], dados["financeiro.visao_geral"],
      dados["financeiro.crescimento"], dados["financeiro.cancelamentos"]]);
  return null;
}

function CarregaCS({ filtros, publicar }: { filtros: FiltrosSecao; publicar: Publicar }) {
  const { carregando, ...dados } = useDadosCS(filtros);
  useEffect(() => {
    publicar(dados, carregando, "cs");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, dados["cs.dashboard"]]);
  return null;
}

function CarregaCertificados({ filtros, publicar }: { filtros: FiltrosSecao; publicar: Publicar }) {
  const { carregando, ...dados } = useDadosCertificados(filtros);
  useEffect(() => {
    publicar(dados, carregando, "certificados");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, dados["certificados.a1"]]);
  return null;
}

function GradeDeItens({ entradas, dados, areasCarregando }: {
  entradas: CatalogEntry[];
  dados: DadosDaSecao;
  areasCarregando: Set<KpiArea>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
      {entradas.map((entrada) => {
        if (areasCarregando.has(entrada.area)) {
          return <Skeleton key={entrada.id} className="h-24 w-full rounded-lg" />;
        }

        if (entrada.kind === "chart") {
          /** As classes estão escritas por extenso porque o Tailwind varre o
           *  código procurando o nome inteiro — `col-span-${n}` nunca chega
           *  no CSS. */
          const largura =
            entrada.span === 4 ? "col-span-2 md:col-span-4"
              : entrada.span === 3 ? "col-span-2 md:col-span-3"
                : "col-span-2";
          return (
            <div key={entrada.id} className={largura}>
              <GraficoDoPainel entrada={entrada} dados={dados[entrada.source.provider]} />
            </div>
          );
        }

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

export function SecaoDoPainel({
  secao, onMudarFiltro,
}: {
  secao: LayoutSecao;
  onMudarFiltro: (secaoId: string, campo: string, valor: unknown) => void;
}) {
  const filtros = normalizarFiltros(secao.filtros);
  const entradas = secao.itens
    .map((i) => entradaPorId(i.id))
    .filter((e): e is CatalogEntry => !!e && !e.pending);

  const areas = areasDaSecao(secao);
  const temImplantacao = areas.includes("implantacao");
  const areasComDados = areas.filter((a) => a !== "implantacao");

  const [dados, setDados] = useState<DadosDaSecao>({});
  const [carregando, setCarregando] = useState<Set<KpiArea>>(() => new Set(areasComDados));

  const publicar = useCallback<Publicar>((novos, estaCarregando, area) => {
    setDados((d) => ({ ...d, ...novos }));
    setCarregando((c) => {
      const tem = c.has(area);
      if (estaCarregando === tem) return c;
      const n = new Set(c);
      if (estaCarregando) n.add(area);
      else n.delete(area);
      return n;
    });
  }, []);

  const entradasAtendimento = entradas.filter((e) => e.area === "atendimento");

  return (
    <section className="mt-5 rounded-xl border border-border bg-card/40">
      {/* Título e filtros em LINHAS separadas. Na mesma linha, com
          `justify-between` e `flex-wrap`, os filtros somem para fora quando o
          nome da seção é comprido ou a janela é estreita. */}
      <header className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{secao.nome}</h3>
          {areas.map((a) => (
            <span
              key={a}
              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${COR_AREA[a]}`}
            >
              {NOME_AREA[a]}
            </span>
          ))}
        </div>
        <FiltrosDaSecaoBar
          areas={areas}
          filtros={filtros}
          onMudar={(campo, valor) => onMudarFiltro(secao.id, campo, valor)}
        />
      </header>

      {entradas.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">
          Nenhum indicador nesta seção ainda.
        </p>
      ) : (
        <QuandoVisivel>
          {areasComDados.includes("atendimento") && (
            <CarregaAtendimento
              entradas={entradasAtendimento}
              filtros={filtros}
              publicar={publicar}
            />
          )}
          {areasComDados.includes("financeiro") && (
            <CarregaFinanceiro filtros={filtros} publicar={publicar} />
          )}
          {areasComDados.includes("cs") && (
            <CarregaCS filtros={filtros} publicar={publicar} />
          )}
          {areasComDados.includes("certificados") && (
            <CarregaCertificados filtros={filtros} publicar={publicar} />
          )}

          <GradeDeItens
            entradas={entradas.filter((e) => e.area !== "implantacao")}
            dados={dados}
            areasCarregando={carregando}
          />

          {temImplantacao && (
            <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Os indicadores de Implantação ainda não aparecem no painel: aquela tela monta os
              números dentro da própria página, sem um hook reaproveitável.
            </p>
          )}
        </QuandoVisivel>
      )}
    </section>
  );
}
