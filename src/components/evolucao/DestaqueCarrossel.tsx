import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import type { ItemEvolucao } from "@/hooks/useEvolucaoDS";

const PASSA_A_CADA_MS = 8000;

interface Props {
  itens: ItemEvolucao[];
  /** Selo, botão "Ver como funciona" etc.: o que a página já desenha no cartão. */
  rodape: (item: ItemEvolucao) => ReactNode;
}

/**
 * Destaques do topo da Evolução DS (30/09/2026). Sempre aparece um; com mais de
 * um, o cliente passa pelas setas, pelas bolinhas ou arrastando no celular
 * (scroll-snap); no celular não há setas, que cobririam o título. Passa sozinho a cada 8 s, mas para com o mouse em cima, com o
 * foco dentro ou com um vídeo tocando, e nunca com "reduzir movimento" ligado.
 */
export function DestaqueCarrossel({ itens, rodape }: Props) {
  const vp = useRef<HTMLDivElement>(null);
  const [atual, setAtual] = useState(0);
  const [parado, setParado] = useState(false);
  const [videoTocando, setVideoTocando] = useState(false);
  const total = itens.length;

  const ir = useCallback(
    (i: number) => {
      const el = vp.current;
      if (!el || total === 0) return;
      const alvo = (i + total) % total;
      // Vídeo do cartão que sai não pode continuar tocando fora da vista.
      el.querySelectorAll("video").forEach((v) => !v.paused && v.pause());
      el.scrollTo({ left: alvo * el.clientWidth, behavior: "smooth" });
      setAtual(alvo);
    },
    [total],
  );

  // O dedo (ou o trackpad) também muda o cartão: acompanha a rolagem.
  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const aoRolar = () => {
      const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
      setAtual((a) => (a === i ? a : i));
    };
    el.addEventListener("scroll", aoRolar, { passive: true });
    return () => el.removeEventListener("scroll", aoRolar);
  }, []);

  useEffect(() => {
    if (total < 2 || parado || videoTocando) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => ir(atual + 1), PASSA_A_CADA_MS);
    return () => window.clearTimeout(t);
  }, [atual, total, parado, videoTocando, ir]);

  if (total === 0) return null;

  return (
    <section
      className="relative"
      aria-roledescription="carrossel"
      aria-label="Novidades em destaque"
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
      onFocusCapture={() => setParado(true)}
      onBlurCapture={() => setParado(false)}
    >
      <div
        ref={vp}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {itens.map((item, i) => (
          <article
            key={item.id}
            aria-roledescription="slide"
            aria-label={`${i + 1} de ${total}`}
            className="grid w-full shrink-0 snap-start overflow-hidden rounded-2xl border bg-card md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
          >
            {item.video_url ? (
              <video
                src={item.video_url}
                controls
                playsInline
                preload="metadata"
                onPlay={() => setVideoTocando(true)}
                onPause={() => setVideoTocando(false)}
                onEnded={() => setVideoTocando(false)}
                className="aspect-video h-full w-full min-w-0 bg-slate-950 object-contain"
              />
            ) : (
              <img src={item.passo_a_passo?.[0]?.imagem_url} alt="" className="h-full w-full min-w-0 object-cover object-left-top" />
            )}
            <div className="flex min-w-0 flex-col gap-2 p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex w-max items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-950 dark:text-green-300">
                  <Sparkles className="h-3 w-3" />
                  Em destaque
                </span>
                {total > 1 && (
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                    {i + 1} de {total}
                  </span>
                )}
              </div>
              <h2 className="text-xl font-bold leading-snug">{item.titulo}</h2>
              <p className="text-sm text-muted-foreground">{item.resumo}</p>
              {rodape(item)}
            </div>
          </article>
        ))}
      </div>

      {total > 1 && (
        <>
          {atual > 0 && (
            <button
              type="button"
              onClick={() => ir(atual - 1)}
              aria-label="Destaque anterior"
              className="absolute left-0 top-1/2 z-10 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-card shadow-md transition-colors hover:bg-muted max-sm:hidden"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
          {atual < total - 1 && (
            <button
              type="button"
              onClick={() => ir(atual + 1)}
              aria-label="Próximo destaque"
              className="absolute right-0 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border bg-card shadow-md transition-colors hover:bg-muted max-sm:hidden"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
          <div className="mt-2.5 flex justify-center gap-1.5">
            {itens.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => ir(i)}
                aria-label={`Ir para o destaque ${i + 1}`}
                aria-current={i === atual}
                className={`h-2 rounded-full transition-all duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${i === atual ? "w-6 bg-green-500" : "w-2 bg-border hover:bg-muted-foreground/40"}`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
