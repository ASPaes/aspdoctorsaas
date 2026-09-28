import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Sparkles, Star, RefreshCw, PlayCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  useEvolucaoFeed,
  useEvolucaoVistoEm,
  useMarcarEvolucaoVista,
  naoVisto,
  type ItemEvolucao,
  type TipoEvolucao,
} from "@/hooks/useEvolucaoDS";

/**
 * Evolução DS: novidades, melhorias e correções do DoctorSaaS, dentro do próprio
 * sistema. Substitui o "Atualizações DS", que abria o DoctorDev em outra aba.
 *
 * Entrar aqui conta como visto (o item do menu para de piscar). O "visto" de
 * antes da entrada é guardado para marcar como novo o que a pessoa ainda não viu.
 */

type Filtro = "tudo" | TipoEvolucao | "minha_empresa";

const TZ = "America/Sao_Paulo";
const DIAS_POR_PAGINA = 14;

const TIPO: Record<TipoEvolucao, { rotulo: string; plural: string; chip: string }> = {
  nova_funcionalidade: {
    rotulo: "Novidade",
    plural: "Novidades",
    chip: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  },
  melhoria: {
    rotulo: "Melhoria",
    plural: "Melhorias",
    chip: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
  correcao: {
    rotulo: "Correção",
    plural: "Correções",
    chip: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  },
};

function chaveDia(iso: string) {
  // en-CA formata como AAAA-MM-DD, que ordena como texto.
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

function rotuloDia(chave: string) {
  const d = new Date(`${chave}T12:00:00-03:00`);
  const hoje = chaveDia(new Date().toISOString());
  const ontem = chaveDia(new Date(Date.now() - 86400000).toISOString());
  const data = d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
  const semana = d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "long" });
  if (chave === hoje) return `Hoje · ${data}`;
  if (chave === ontem) return `Ontem · ${data}`;
  return `${data} · ${semana}`;
}

function ChipTipo({ tipo, plural = false }: { tipo: TipoEvolucao; plural?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", TIPO[tipo].chip)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {plural ? TIPO[tipo].plural : TIPO[tipo].rotulo}
    </span>
  );
}

function SeloEmpresa() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-300">
      <Star className="h-3 w-3 fill-current" />
      Sua empresa pediu isso
    </span>
  );
}

/** Vídeo e/ou passo a passo gravados pelo /novidade. */
function temConteudo(i: ItemEvolucao) {
  return !!i.video_url || !!i.passo_a_passo?.length;
}

function BotaoComoFunciona({ item, onAbrir }: { item: ItemEvolucao; onAbrir: () => void }) {
  const partes = [item.video_url ? "vídeo" : null, item.passo_a_passo?.length ? `${item.passo_a_passo.length} passos` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <Button size="sm" onClick={onAbrir} className="bg-green-600 text-white hover:bg-green-700">
      <PlayCircle className="mr-2 h-4 w-4" />
      Ver como funciona
      <span className="ml-2 text-xs font-normal opacity-80">{partes}</span>
    </Button>
  );
}

function DetalheNovidade({ item, onFechar }: { item: ItemEvolucao | null; onFechar: () => void }) {
  return (
    <Sheet open={!!item} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {item && (
          <div className="space-y-5">
            <SheetHeader className="space-y-2 text-left">
              <div className="flex flex-wrap items-center gap-2">
                <ChipTipo tipo={item.tipo} />
                {item.modulo && <span className="text-xs text-muted-foreground">{item.modulo}</span>}
              </div>
              <SheetTitle className="text-2xl">{item.titulo}</SheetTitle>
              {item.resumo && <SheetDescription className="text-base">{item.resumo}</SheetDescription>}
            </SheetHeader>

            {item.video_url && (
              <video
                src={item.video_url}
                controls
                playsInline
                preload="metadata"
                className="w-full rounded-xl border bg-slate-950"
              />
            )}

            {!!item.para_que_serve?.length && (
              <section className="rounded-xl bg-muted/60 p-4">
                <h4 className="font-semibold">Para que serve</h4>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {item.para_que_serve.map((x, k) => (
                    <li key={k}>{x}</li>
                  ))}
                </ul>
              </section>
            )}

            {!!item.passo_a_passo?.length && (
              <section className="space-y-3">
                <h4 className="font-semibold">Passo a passo</h4>
                <ol className="space-y-4">
                  {item.passo_a_passo.map((p) => (
                    <li key={p.passo} className="overflow-hidden rounded-xl border">
                      <div className="flex items-center gap-3 p-3 text-sm font-medium">
                        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-green-500 font-mono text-xs font-bold text-green-950">
                          {p.passo}
                        </span>
                        {p.legenda}
                      </div>
                      {/* Print de tela inteira fica pequeno no painel: o clique abre em tamanho real. */}
                      <a href={p.imagem_url} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
                        <img src={p.imagem_url} alt={`Passo ${p.passo}: ${p.legenda}`} loading="lazy" className="block w-full cursor-zoom-in border-t" />
                      </a>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function CartaoItem({ item, novo, onAbrir }: { item: ItemEvolucao; novo: boolean; onAbrir: () => void }) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-card p-4 transition-shadow hover:shadow-md",
        novo && "border-l-4 border-l-green-500",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChipTipo tipo={item.tipo} />
        {item.modulo && <span className="text-xs text-muted-foreground">{item.modulo}</span>}
        {novo && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-400">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Novo para você
          </span>
        )}
      </div>
      <h3 className="mt-2 text-base font-semibold leading-snug">{item.titulo}</h3>
      {item.resumo && <p className="mt-1 text-sm text-muted-foreground">{item.resumo}</p>}
      {(item.pedido_pela_sua_empresa || temConteudo(item)) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {temConteudo(item) && <BotaoComoFunciona item={item} onAbrir={onAbrir} />}
          {item.pedido_pela_sua_empresa && <SeloEmpresa />}
        </div>
      )}
    </article>
  );
}

function BlocoCorrecoes({
  itens,
  vistoAntes,
  onAbrir,
}: {
  itens: ItemEvolucao[];
  vistoAntes: string | null;
  onAbrir: (i: ItemEvolucao) => void;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-muted/40 p-4">
      <div className="flex items-center gap-2">
        <ChipTipo tipo="correcao" plural={itens.length > 1} />
        <span className="text-xs text-muted-foreground">{itens.length}</span>
      </div>
      <ul className="mt-3 space-y-2">
        {itens.map((i) => (
          <li key={i.id} className="text-sm">
            <span className="font-medium">
              {naoVisto(i, vistoAntes) && <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />}
              {i.titulo}
            </span>
            {i.resumo && <span className="block text-muted-foreground line-clamp-2">{i.resumo}</span>}
            {/* Correção só leva vídeo/prints quando pedido no /novidade, e aí ganha o botão. */}
            {(i.pedido_pela_sua_empresa || temConteudo(i)) && (
              <span className="mt-2 flex flex-wrap items-center gap-3">
                {temConteudo(i) && <BotaoComoFunciona item={i} onAbrir={() => onAbrir(i)} />}
                {i.pedido_pela_sua_empresa && <SeloEmpresa />}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function EvolucaoDS() {
  const feed = useEvolucaoFeed();
  const visto = useEvolucaoVistoEm();
  const marcarVista = useMarcarEvolucaoVista();
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [busca, setBusca] = useState("");
  const [dias, setDias] = useState(DIAS_POR_PAGINA);
  const [aberto, setAberto] = useState<ItemEvolucao | null>(null);

  // Guarda o "visto" de ANTES de entrar e só então marca como visto agora.
  const vistoAntesRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!visto.isSuccess || vistoAntesRef.current !== undefined) return;
    vistoAntesRef.current = visto.data ?? null;
    void marcarVista();
  }, [visto.isSuccess, visto.data, marcarVista]);
  const vistoAntes = vistoAntesRef.current !== undefined ? vistoAntesRef.current : visto.data ?? null;

  const itens = feed.data ?? [];

  const doMes = useMemo(() => {
    const mes = chaveDia(new Date().toISOString()).slice(0, 7);
    const c = { nova_funcionalidade: 0, melhoria: 0, correcao: 0 };
    for (const i of itens) if (chaveDia(i.publicado_em).startsWith(mes)) c[i.tipo]++;
    return c;
  }, [itens]);

  const temPedidoDaEmpresa = itens.some((i) => i.pedido_pela_sua_empresa);

  // Destaque do topo: a novidade marcada como destaque no /novidade, por 14 dias.
  const emDestaque = useMemo(
    () =>
      itens.find(
        (i) => i.destaque && temConteudo(i) && Date.now() - new Date(i.publicado_em).getTime() < 14 * 86400000,
      ) ?? null,
    [itens],
  );

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (filtro === "minha_empresa" ? !i.pedido_pela_sua_empresa : filtro !== "tudo" && i.tipo !== filtro) return false;
      if (!q) return true;
      return `${i.titulo} ${i.resumo} ${i.modulo ?? ""}`.toLowerCase().includes(q);
    });
  }, [itens, filtro, busca]);

  const porDia = useMemo(() => {
    const m = new Map<string, ItemEvolucao[]>();
    for (const i of filtrados) {
      const k = chaveDia(i.publicado_em);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(i);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtrados]);

  const filtros: { id: Filtro; rotulo: string }[] = [
    { id: "tudo", rotulo: "Tudo" },
    { id: "nova_funcionalidade", rotulo: "Novidades" },
    { id: "melhoria", rotulo: "Melhorias" },
    { id: "correcao", rotulo: "Correções" },
    ...(temPedidoDaEmpresa ? [{ id: "minha_empresa" as Filtro, rotulo: "Pedidos da sua empresa" }] : []),
  ];

  const nomeMes = new Date().toLocaleDateString("pt-BR", { timeZone: TZ, month: "long" });

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="overflow-hidden rounded-2xl border bg-card">
        <div className="bg-[radial-gradient(520px_200px_at_0%_0%,rgb(34_197_94/0.16),transparent_70%),radial-gradient(420px_200px_at_100%_0%,rgb(14_165_233/0.14),transparent_70%)] p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400">
            <Sparkles className="h-4 w-4" />
            Evolução DS
          </div>
          <h1 className="mt-2 text-2xl font-bold">Novidades, melhorias e correções</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Tudo que mudou no DoctorSaaS, do mais recente para o mais antigo.
          </p>
          {feed.isSuccess && (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <span className="self-center pr-1 text-muted-foreground">Em {nomeMes}:</span>
              <span className="rounded-lg border bg-background/70 px-3 py-1.5">
                <b>{doMes.nova_funcionalidade}</b> {doMes.nova_funcionalidade === 1 ? "novidade" : "novidades"}
              </span>
              <span className="rounded-lg border bg-background/70 px-3 py-1.5">
                <b>{doMes.melhoria}</b> {doMes.melhoria === 1 ? "melhoria" : "melhorias"}
              </span>
              <span className="rounded-lg border bg-background/70 px-3 py-1.5">
                <b>{doMes.correcao}</b> {doMes.correcao === 1 ? "correção" : "correções"}
              </span>
            </div>
          )}
        </div>
      </header>

      {emDestaque && (
        <section className="grid overflow-hidden rounded-2xl border bg-card md:grid-cols-[1.1fr_1fr]">
          {emDestaque.video_url ? (
            <video
              src={emDestaque.video_url}
              controls
              playsInline
              preload="metadata"
              className="aspect-video h-full w-full bg-slate-950 object-contain"
            />
          ) : (
            <img src={emDestaque.passo_a_passo?.[0]?.imagem_url} alt="" className="h-full w-full object-cover" />
          )}
          <div className="flex flex-col gap-2 p-5">
            <span className="inline-flex w-max items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
              <Sparkles className="h-3 w-3" />
              Em destaque
            </span>
            <h2 className="text-xl font-bold leading-snug">{emDestaque.titulo}</h2>
            <p className="text-sm text-muted-foreground">{emDestaque.resumo}</p>
            {emDestaque.pedido_pela_sua_empresa && <SeloEmpresa />}
            <div className="mt-auto pt-2">
              <BotaoComoFunciona item={emDestaque} onAbrir={() => setAberto(emDestaque)} />
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {filtros.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => {
              setFiltro(f.id);
              setDias(DIAS_POR_PAGINA);
            }}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
              filtro === f.id ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
            )}
          >
            {f.rotulo}
          </button>
        ))}
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="evolucao-busca"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setDias(DIAS_POR_PAGINA);
            }}
            placeholder="Procurar por assunto"
            className="pl-8"
          />
        </div>
      </div>

      {feed.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {feed.isError && (
        <div className="rounded-xl border bg-card p-6 text-center">
          <p className="font-medium">Não foi possível carregar as novidades agora.</p>
          <p className="mt-1 text-sm text-muted-foreground">Tente de novo em alguns minutos.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => feed.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Tentar de novo
          </Button>
        </div>
      )}

      {feed.isSuccess && porDia.length === 0 && (
        <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
          {busca ? `Nada encontrado para "${busca}".` : "Nada por aqui ainda."}
        </p>
      )}

      {porDia.slice(0, dias).map(([dia, lista]) => {
        const destaques = lista.filter((i) => i.tipo !== "correcao");
        const correcoes = lista.filter((i) => i.tipo === "correcao");
        return (
          <section key={dia} className="space-y-3">
            <h2 className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground after:h-px after:flex-1 after:bg-border">
              {rotuloDia(dia)}
            </h2>
            {destaques.map((i) => (
              <CartaoItem key={i.id} item={i} novo={naoVisto(i, vistoAntes)} onAbrir={() => setAberto(i)} />
            ))}
            {correcoes.length > 0 && <BlocoCorrecoes itens={correcoes} vistoAntes={vistoAntes} onAbrir={setAberto} />}
          </section>
        );
      })}

      {porDia.length > dias && (
        <div className="flex justify-center pb-4">
          <Button variant="outline" onClick={() => setDias((d) => d + DIAS_POR_PAGINA)}>
            Ver dias anteriores
          </Button>
        </div>
      )}

      <DetalheNovidade item={aberto} onFechar={() => setAberto(null)} />
    </div>
  );
}
