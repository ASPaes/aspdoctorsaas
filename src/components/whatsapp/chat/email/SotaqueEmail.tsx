import { useEffect, useState } from "react";
import { ChevronDown, Languages, Loader2, MapPin, Undo2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BotaoBarra } from "./EditorEmail";
import {
  alternarIdioma,
  alternarTamanho,
  EXEMPLO_ESTADO,
  NOME_ESTADO,
  REGIOES,
  ROTULO_IDIOMA,
  ROTULO_TAMANHO,
  siglaValida,
  type AjustesTexto,
  type IntensidadeSotaque,
} from "./estadosSotaque";

/**
 * Botão Sotaque ao lado do Anexar (mockup "Conversa Completa e Sotaque",
 * aprovado em 16/09/2026). Escolhe o estado e a intensidade; quem reescreve é a
 * `gerar-email-chat` no modo sotaque. O estado do cliente vem marcado.
 */
export function BotaoSotaque({
  ufCliente,
  aplicando,
  desabilitado,
  onAplicar,
}: {
  ufCliente: string | null;
  aplicando: boolean;
  desabilitado?: boolean;
  onAplicar: (uf: string, intensidade: IntensidadeSotaque) => void;
}) {
  const inicial = siglaValida(ufCliente) ? ufCliente.toUpperCase() : null;
  const [aberto, setAberto] = useState(false);
  const [uf, setUf] = useState<string | null>(inicial);
  const [intensidade, setIntensidade] = useState<IntensidadeSotaque>("leve");

  // o cliente carrega depois da tela abrir: marca o estado dele quando chegar
  useEffect(() => {
    if (inicial) setUf((atual) => atual ?? inicial);
  }, [inicial]);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <BotaoBarra
          titulo="Sotaque: reescrever o texto com o jeito de falar de um estado"
          desabilitado={desabilitado || aplicando}
          ativo={aberto}
          className="gap-1.5 px-2 text-xs font-medium"
        >
          {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
          Sotaque
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </BotaoBarra>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] space-y-3" onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sotaque do texto</p>
          <div className="flex gap-0.5 rounded-md bg-muted p-0.5" role="radiogroup" aria-label="Intensidade do sotaque">
            {(["leve", "raiz"] as const).map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={intensidade === i}
                onClick={() => setIntensidade(i)}
                className={cn(
                  "rounded px-3 py-1 text-xs",
                  intensidade === i ? "bg-background font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {i === "leve" ? "Leve" : "Raiz"}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {REGIOES.map((r) => (
            <div key={r.nome} className="space-y-1">
              <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{r.nome}</p>
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Estados da região ${r.nome}`}>
                {r.ufs.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={uf === s}
                    title={NOME_ESTADO[s]}
                    onClick={() => setUf(s)}
                    className={cn(
                      "rounded border px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      uf === s
                        ? "border-sky-500 bg-sky-500 text-white"
                        : "border-border bg-background hover:border-sky-500/60",
                      s === inicial && uf !== s && "border-sky-500/60",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="rounded-md bg-muted px-2.5 py-2 text-xs">
          {uf ? (
            <>
              <span className="font-semibold">{NOME_ESTADO[uf]}</span>
              {EXEMPLO_ESTADO[uf] ? `: ${EXEMPLO_ESTADO[uf]}.` : "."}
              {uf === inicial && <span className="text-muted-foreground"> Estado do cliente.</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Escolha o estado.</span>
          )}
          <span className="mt-1 block text-muted-foreground">
            Muda só o texto do corpo. Nomes, números, links e a conversa completa ficam como estão. Se o texto estiver
            traduzido, volta para o português.
          </span>
        </p>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAberto(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!uf}
            onClick={() => {
              if (!uf) return;
              setAberto(false);
              onAplicar(uf, intensidade);
            }}
          >
            Aplicar sotaque
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Botão Ajustar (etapa 2, 16/09/2026): Idioma e Tamanho num botão só, para a
 * barra do editor não virar duas linhas. Cada clique aplica na hora; clicar no
 * que está marcado tira.
 */
export function BotaoAjustar({
  ajustes,
  aplicando,
  desabilitado,
  onAjustar,
}: {
  ajustes: AjustesTexto;
  aplicando: boolean;
  desabilitado?: boolean;
  onAjustar: (proximo: AjustesTexto) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <BotaoBarra
          titulo="Ajustar: traduzir ou mudar o tamanho do texto"
          desabilitado={desabilitado || aplicando}
          ativo={!!(ajustes.idioma || ajustes.tamanho)}
          className="gap-1.5 px-2 text-xs font-medium"
        >
          {aplicando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
          Ajustar
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </BotaoBarra>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Idioma</DropdownMenuLabel>
        {(["en", "es"] as const).map((i) => (
          <DropdownMenuCheckboxItem key={i} checked={ajustes.idioma === i} onSelect={() => onAjustar(alternarIdioma(ajustes, i))}>
            Traduzir para {ROTULO_IDIOMA[i].toLowerCase()}
          </DropdownMenuCheckboxItem>
        ))}
        {ajustes.sotaque && (
          <p className="px-2 pb-1 text-[11px] text-muted-foreground">Traduzir tira o sotaque.</p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Tamanho</DropdownMenuLabel>
        {(["curto", "detalhado"] as const).map((t) => (
          <DropdownMenuCheckboxItem key={t} checked={ajustes.tamanho === t} onSelect={() => onAjustar(alternarTamanho(ajustes, t))}>
            {t === "curto" ? "Mais curto e direto" : "Mais detalhado"}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** faixa acima do editor enquanto há sotaque, idioma ou tamanho aplicado */
export function FaixaAjustes({
  ajustes,
  onVoltar,
  desabilitado,
}: {
  ajustes: AjustesTexto;
  onVoltar: () => void;
  desabilitado?: boolean;
}) {
  const partes = [
    ajustes.sotaque
      ? `Sotaque: ${NOME_ESTADO[ajustes.sotaque.uf]} · ${ajustes.sotaque.intensidade === "leve" ? "leve" : "raiz"}`
      : null,
    ajustes.idioma ? ROTULO_IDIOMA[ajustes.idioma] : null,
    ajustes.tamanho ? ROTULO_TAMANHO[ajustes.tamanho] : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-700 dark:text-amber-300">
        {ajustes.sotaque ? <MapPin className="h-3 w-3" /> : <Languages className="h-3 w-3" />}
        {ajustes.sotaque ? partes.join(" · ") : `Ajustado: ${partes.join(" · ")}`}
      </span>
      <button
        type="button"
        onClick={onVoltar}
        disabled={desabilitado}
        className="inline-flex items-center gap-1 text-sky-700 underline underline-offset-2 hover:text-sky-800 disabled:opacity-40 dark:text-sky-400"
      >
        <Undo2 className="h-3 w-3" />
        Voltar ao texto original
      </button>
    </div>
  );
}
