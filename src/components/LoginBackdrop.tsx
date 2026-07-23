import { useEffect, useRef } from "react";
import iconGreen from "@/assets/brand/icon.svg";

/**
 * Fundo da tela de login: o produto DoctorSaaS "vivo" atrás de um vidro fosco.
 * Um dashboard dark (MRR subindo, KPIs, barras respirando, feed de atendimento
 * correndo) renderizado em tamanho real e depois desfocado + escurecido, com
 * leve parallax no ponteiro. O card de login entra por cima como vidro.
 *
 * Sempre dark (o efeito de vidro fica dramático nos dois temas do app).
 * Canvas para os gráficos, WAAPI para o feed. Respeita prefers-reduced-motion,
 * pausa fora de foco e degrada pra um quadro estático se preciso.
 */

const GREEN = "#22C55E";
const GREEN_HI = "#45E37D";
const BLUE = "#0EA5E9";
const AMBER = "#F59E0B";

const CONVERSAS = [
  { n: "Digi Office", m: "Perfeito, pode emitir a NF 👍", t: "09:41", u: true },
  { n: "Contabilidade Prima", m: "Recebi o boleto, obrigado", t: "09:38", u: false },
  { n: "ISP NetVale", m: "O upgrade já está ativo?", t: "09:35", u: true },
  { n: "Revenda SoftMax", m: "Fechamos o plano Pro 🎉", t: "09:31", u: false },
  { n: "Empadas Minas", m: "Consegue renegociar?", t: "09:27", u: false },
  { n: "ASP Softwares", m: "Onboarding concluído ✅", t: "09:22", u: false },
  { n: "FlyERP", m: "Time vai avaliar o cross-sell", t: "09:19", u: true },
  { n: "OMIE Parceiro", m: "Reativação aprovada", t: "09:14", u: false },
];

const KPIS = [
  { label: "MRR", value: "R$ 128,4k", delta: "+4,2%", up: true },
  { label: "Novos clientes", value: "38", delta: "+12", up: true },
  { label: "Churn", value: "1,2%", delta: "-0,3%", up: false },
  { label: "Tickets", value: "42", delta: "8 novos", up: true },
];

function sizeCanvas(canvas: HTMLCanvasElement | null) {
  const c = canvas;
  if (!c) return { w: 0, h: 0, ctx: null as CanvasRenderingContext2D | null };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = c.getBoundingClientRect();
  c.width = Math.max(1, Math.round(r.width * dpr));
  c.height = Math.max(1, Math.round(r.height * dpr));
  const ctx = c.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w: r.width, h: r.height, ctx };
}

export function LoginBackdrop() {
  const layerRef = useRef<HTMLDivElement>(null);
  const mrrRef = useRef<HTMLCanvasElement>(null);
  const barsRef = useRef<HTMLCanvasElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const mrrValRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let mrr = sizeCanvas(mrrRef.current);
    let bars = sizeCanvas(barsRef.current);
    let raf = 0;
    let start = 0;

    // ── MRR: área de receita subindo ──
    const drawMRR = (t: number) => {
      const { w, h, ctx } = mrr;
      if (!ctx || !w || !h) return;
      ctx.clearRect(0, 0, w, h);
      const phase = t * 0.00035;
      const pad = 6;
      const N = Math.max(28, Math.floor(w / 12));
      const val = (i: number) => {
        const x = i / N;
        const trend = 0.28 + 0.5 * x;
        const wobble = 0.05 * Math.sin(x * 9 + phase) + 0.028 * Math.sin(x * 21 - phase * 1.6);
        const tip = i > N - 2 ? 0.04 * Math.sin(t * 0.0016) : 0; // ponta "viva"
        return Math.min(0.98, trend + wobble + tip);
      };
      const px = (i: number) => pad + (i / N) * (w - pad * 2);
      const py = (v: number) => h - pad - v * (h - pad * 2);

      // grid horizontal
      ctx.strokeStyle = "rgba(148,163,184,0.08)";
      ctx.lineWidth = 1;
      for (let g = 1; g <= 3; g++) {
        const y = (h / 4) * g;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // área
      ctx.beginPath();
      ctx.moveTo(px(0), h);
      for (let i = 0; i <= N; i++) ctx.lineTo(px(i), py(val(i)));
      ctx.lineTo(px(N), h);
      ctx.closePath();
      const grd = ctx.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, "rgba(34,197,94,0.42)");
      grd.addColorStop(1, "rgba(34,197,94,0)");
      ctx.fillStyle = grd;
      ctx.fill();

      // linha
      ctx.beginPath();
      for (let i = 0; i <= N; i++) {
        const x = px(i);
        const y = py(val(i));
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = GREEN_HI;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.shadowBlur = 10;
      ctx.shadowColor = "rgba(34,197,94,0.6)";
      ctx.stroke();
      ctx.shadowBlur = 0;

      // ponto na ponta
      const ex = px(N);
      const ey = py(val(N));
      ctx.beginPath();
      ctx.arc(ex, ey, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = "#EAFBF0";
      ctx.shadowBlur = 14;
      ctx.shadowColor = GREEN;
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    // ── Barras: receita por mês, respirando ──
    const drawBars = (t: number) => {
      const { w, h, ctx } = bars;
      if (!ctx || !w || !h) return;
      ctx.clearRect(0, 0, w, h);
      const n = 12;
      const gap = w / n;
      const bw = gap * 0.52;
      for (let i = 0; i < n; i++) {
        const base = 0.32 + 0.5 * (i / n); // tendência de alta
        const breathe = 0.06 * Math.sin(t * 0.0011 + i * 0.6);
        const v = Math.min(0.96, base + breathe);
        const bh = v * (h - 8);
        const x = i * gap + (gap - bw) / 2;
        const y = h - bh;
        const grd = ctx.createLinearGradient(0, y, 0, h);
        const c = i === n - 1 ? "69,227,125" : "34,197,94";
        grd.addColorStop(0, `rgba(${c},0.72)`);
        grd.addColorStop(1, `rgba(${c},0.10)`);
        ctx.fillStyle = grd;
        const r = Math.min(3, bw / 2);
        ctx.beginPath();
        ctx.moveTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.arcTo(x + bw, y, x + bw, y + r, r);
        ctx.lineTo(x + bw, h);
        ctx.lineTo(x, h);
        ctx.closePath();
        ctx.fill();
      }
    };

    // valor do MRR "contando" de leve
    let baseMRR = 128.4;
    const tickMRR = (t: number) => {
      if (!mrrValRef.current) return;
      const v = baseMRR + 0.6 * Math.sin(t * 0.0006) + 0.15 * Math.sin(t * 0.004);
      mrrValRef.current.textContent = "R$ " + v.toFixed(1).replace(".", ",") + "k";
    };

    const frame = (now: number) => {
      if (!start) start = now;
      const t = now - start;
      drawMRR(t);
      drawBars(t);
      tickMRR(t);
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => {
      mrr = sizeCanvas(mrrRef.current);
      bars = sizeCanvas(barsRef.current);
    };

    // ── parallax suave no ponteiro ──
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    let parRaf = 0;
    const onPointer = (e: PointerEvent) => {
      const cx = e.clientX / window.innerWidth - 0.5;
      const cy = e.clientY / window.innerHeight - 0.5;
      tx = -cx * 16;
      ty = -cy * 12;
      if (!parRaf) parRaf = requestAnimationFrame(applyParallax);
    };
    const applyParallax = () => {
      px += (tx - px) * 0.08;
      py += (ty - py) * 0.08;
      if (layerRef.current) {
        layerRef.current.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0) scale(1.06)`;
      }
      if (Math.abs(tx - px) > 0.1 || Math.abs(ty - py) > 0.1) {
        parRaf = requestAnimationFrame(applyParallax);
      } else {
        parRaf = 0;
      }
    };

    // ── feed de atendimento rolando ──
    let feedAnim: Animation | null = null;

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        feedAnim?.pause();
      } else if (!reduce) {
        if (!raf) {
          start = 0;
          raf = requestAnimationFrame(frame);
        }
        feedAnim?.play();
      }
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    if (reduce) {
      // um quadro estático
      drawMRR(1400);
      drawBars(600);
      tickMRR(0);
    } else {
      raf = requestAnimationFrame(frame);
      window.addEventListener("pointermove", onPointer);
      if (feedRef.current) {
        feedAnim = feedRef.current.animate(
          [{ transform: "translateY(0)" }, { transform: "translateY(-50%)" }],
          { duration: 34000, iterations: Infinity, easing: "linear" },
        );
      }
    }

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(parRaf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
      feedAnim?.cancel();
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      {/* base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 78% 30%, rgba(34,197,94,0.08), transparent 60%)," +
            "radial-gradient(ellipse 60% 60% at 15% 85%, rgba(14,165,233,0.06), transparent 60%)," +
            "linear-gradient(160deg, #070B12 0%, #0A0F17 45%, #0B1220 100%)",
        }}
      />

      {/* o produto vivo (borrado) */}
      <div
        ref={layerRef}
        className="absolute inset-[-6%] select-none will-change-transform"
        style={{ filter: "blur(6px) brightness(0.62) saturate(1.08)", transform: "scale(1.06)" }}
      >
        <div className="flex h-full w-full gap-5 p-8">
          {/* sidebar fake */}
          <div className="hidden w-16 shrink-0 flex-col items-center gap-6 rounded-2xl border border-[#334155]/60 bg-[#0E1524]/80 py-6 md:flex">
            <img src={iconGreen} alt="" className="h-8 w-8" />
            <div className="flex flex-col items-center gap-4">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span
                  key={i}
                  className="h-6 w-6 rounded-lg"
                  style={{ background: i === 0 ? "rgba(34,197,94,0.28)" : "rgba(148,163,184,0.14)" }}
                />
              ))}
            </div>
          </div>

          {/* main */}
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            {/* topbar */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-lg font-bold text-[#F1F5F9]">Visão geral</div>
                <div className="text-xs text-[#94A3B8]">Receita recorrente · últimos 30 dias</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="rounded-full border border-[#334155]/70 px-3 py-1 text-xs text-[#94A3B8]">
                  Este mês
                </span>
                <span className="h-9 w-9 rounded-full" style={{ background: `linear-gradient(135deg, ${GREEN}, ${BLUE})` }} />
              </div>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {KPIS.map((k) => (
                <div key={k.label} className="rounded-xl border border-[#334155]/60 bg-[#111A2E]/85 p-4">
                  <div className="text-xs text-[#94A3B8]">{k.label}</div>
                  <div className="mt-1 text-2xl font-bold tracking-tight text-[#F1F5F9]">
                    {k.label === "MRR" ? <span ref={mrrValRef}>{k.value}</span> : k.value}
                  </div>
                  <div className="mt-1 text-xs font-semibold" style={{ color: k.up ? GREEN_HI : AMBER }}>
                    {k.up ? "▲" : "▼"} {k.delta}
                  </div>
                </div>
              ))}
            </div>

            {/* MRR grande */}
            <div className="min-h-0 flex-1 rounded-xl border border-[#334155]/60 bg-[#111A2E]/85 p-5">
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-[#E2E8F0]">Receita Recorrente (MRR)</div>
                <div className="text-sm font-bold text-[#45E37D]">+18,6% no trimestre</div>
              </div>
              <canvas ref={mrrRef} className="mt-3 h-[calc(100%-2rem)] w-full" />
            </div>

            {/* baixo: barras + atendimento */}
            <div className="grid min-h-[210px] grid-cols-1 gap-5 lg:grid-cols-[1.15fr_1fr]">
              <div className="rounded-xl border border-[#334155]/60 bg-[#111A2E]/85 p-5">
                <div className="text-sm font-semibold text-[#E2E8F0]">Receita por mês</div>
                <canvas ref={barsRef} className="mt-3 h-[150px] w-full" />
              </div>

              <div className="overflow-hidden rounded-xl border border-[#334155]/60 bg-[#111A2E]/85 p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-[#E2E8F0]">Atendimento</div>
                  <span className="flex items-center gap-1.5 text-xs text-[#94A3B8]">
                    <span className="h-2 w-2 rounded-full" style={{ background: GREEN, boxShadow: `0 0 8px ${GREEN}` }} />
                    ao vivo
                  </span>
                </div>
                <div className="mt-2 h-[150px] overflow-hidden">
                  <div ref={feedRef}>
                    {[...CONVERSAS, ...CONVERSAS].map((c, i) => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <span
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-[#04240F]"
                          style={{ background: `linear-gradient(135deg, ${GREEN_HI}, ${GREEN})` }}
                        >
                          {c.n.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-[#E2E8F0]">{c.n}</span>
                            <span className="shrink-0 text-[11px] text-[#64748B]">{c.t}</span>
                          </div>
                          <div className="truncate text-xs text-[#94A3B8]">{c.m}</div>
                        </div>
                        {c.u && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: GREEN }} />}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* vinheta: escurece bordas e assenta o card no centro */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 44% 46% at 50% 50%, rgba(7,11,18,0.86) 0%, rgba(7,11,18,0.5) 42%, transparent 72%)," +
            "linear-gradient(180deg, rgba(7,11,18,0.55) 0%, transparent 22%, transparent 78%, rgba(7,11,18,0.6) 100%)",
        }}
      />
    </div>
  );
}
