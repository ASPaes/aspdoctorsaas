import * as React from "react";
import { Filter } from "lucide-react";

import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

// ============================================================================
// Funil de filtro no cabeçalho da coluna.
//
// A casca é só isso: o botão de funil, o popover e o "Limpar". O CONTEÚDO vem
// de fora, porque cada coluna filtra de um jeito — texto contém, faixa de
// número, período de data, lista de opções. Os quatro conteúdos usados hoje
// moram aqui embaixo (FiltroTexto, FiltroFaixa, FiltroData, FiltroOpcoes) para
// que duas tabelas diferentes não inventem dois jeitos de escrever "De / Até".
//
// O funil PINTADO é a única pista de que a lista está recortada: sem ele, quem
// abre a tela com um filtro de ontem lê 12 linhas como se fossem o total. Por
// isso `ativo` não é opcional.
//
// O estado mora em quem chama. Filtro que guarda o próprio valor dentro do
// popover não consegue responder "quantas colunas estão filtrando?" nem ter um
// "limpar tudo", e é isso que a tabela precisa saber.
// ============================================================================

interface ColumnFilterProps {
  /** Nome da coluna, do jeito que aparece no cabeçalho. */
  titulo: string;
  /** Verdadeiro quando esta coluna está recortando a lista. */
  ativo: boolean;
  onLimpar: () => void;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  /** Largura do popover. Lista de opções longa pede mais. */
  largura?: string;
}

export function ColumnFilter({
  titulo,
  ativo,
  onLimpar,
  children,
  align = "start",
  largura = "w-64",
}: ColumnFilterProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={ativo ? `${titulo}: filtro ativo` : `Filtrar por ${titulo}`}
          aria-label={`Filtrar por ${titulo}`}
          className={`shrink-0 rounded p-0.5 transition-colors hover:bg-background/80 ${
            ativo ? "text-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Filter className={`h-3 w-3 ${ativo ? "fill-current" : "opacity-40"}`} />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className={`${largura} p-3`}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium">{titulo}</p>
          {/* "Limpar" só existe quando há o que limpar: botão apagado num
              filtro vazio faz a pessoa clicar para descobrir que não faz nada. */}
          {ativo && (
            <button
              type="button"
              onClick={onLimpar}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Limpar
            </button>
          )}
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/** Coluna de texto: contém o que foi digitado. */
export function FiltroTexto({
  valor,
  onChange,
  placeholder,
}: {
  valor: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Contém…"}
      className="h-8"
    />
  );
}

/**
 * Coluna de número: faixa de A até B, e qualquer um dos dois lados pode ficar
 * em branco. "Só o mínimo" é a pergunta mais comum ("quem custa mais de 200?"),
 * e obrigar os dois limites transformaria isso em adivinhar o teto.
 *
 * O valor viaja como TEXTO, não como número: no meio da digitação de "1,5" o
 * campo passa por "1," — número não representa isso, e converter a cada tecla
 * apagaria a vírgula na cara de quem digita.
 */
export function FiltroFaixa({
  min,
  max,
  onChange,
  prefixo,
  dica,
}: {
  min: string;
  max: string;
  onChange: (v: { min: string; max: string }) => void;
  /** "R$" nas colunas de dinheiro. */
  prefixo?: string;
  dica?: string;
}) {
  const campo = (rotulo: string, valor: string, chave: "min" | "max") => (
    <label className="flex-1 space-y-1">
      <span className="text-xs text-muted-foreground">{rotulo}</span>
      <div className="relative">
        {prefixo && (
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {prefixo}
          </span>
        )}
        <Input
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange({ min, max, [chave]: e.target.value })}
          className={`h-8 tabular-nums ${prefixo ? "pl-8" : ""}`}
        />
      </div>
    </label>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        {campo("De", min, "min")}
        {campo("Até", max, "max")}
      </div>
      {dica && <p className="text-xs text-muted-foreground">{dica}</p>}
    </div>
  );
}

/**
 * Coluna de data: período, com os dois lados opcionais pelo mesmo motivo da
 * faixa de número.
 *
 * Não é o DateRangePicker do projeto de propósito, e a razão é o contrato dele:
 * ele exige um período sempre preenchido e abre nos atalhos de período recente
 * (hoje, últimos 7 dias, este mês). Num funil de coluna o estado inicial tem
 * que ser "sem filtro", e a coluna que ele filtra aqui vai de 2009 até hoje.
 */
export function FiltroData({
  de,
  ate,
  onChange,
}: {
  de: string;
  ate: string;
  onChange: (v: { de: string; ate: string }) => void;
}) {
  return (
    <div className="flex items-end gap-2">
      <label className="flex-1 space-y-1">
        <span className="text-xs text-muted-foreground">De</span>
        <Input
          type="date"
          value={de}
          max={ate || undefined}
          onChange={(e) => onChange({ de: e.target.value, ate })}
          className="h-8"
        />
      </label>
      <label className="flex-1 space-y-1">
        <span className="text-xs text-muted-foreground">Até</span>
        <Input
          type="date"
          value={ate}
          min={de || undefined}
          onChange={(e) => onChange({ de, ate: e.target.value })}
          className="h-8"
        />
      </label>
    </div>
  );
}

/**
 * Coluna de poucos valores repetidos: marca o que fica.
 *
 * Nada marcado = tudo passa, e não "nada passa". Lista vazia como "esconde
 * todos" daria uma tabela em branco no primeiro clique do funil.
 *
 * A CONTAGEM ao lado de cada opção é o que evita o filtro que devolve zero: ela
 * mostra antes de clicar que aquele valor tem 44 linhas e o outro 807.
 */
export function FiltroOpcoes({
  opcoes,
  selecionadas,
  onChange,
}: {
  opcoes: { valor: string; rotulo: string; n?: number }[];
  selecionadas: string[];
  onChange: (v: string[]) => void;
}) {
  if (!opcoes.length) {
    return <p className="text-xs text-muted-foreground">Nada para filtrar nesta coluna.</p>;
  }
  return (
    <div className="max-h-60 space-y-1 overflow-y-auto">
      {opcoes.map((o) => {
        const marcada = selecionadas.includes(o.valor);
        const alternar = () =>
          onChange(
            marcada ? selecionadas.filter((v) => v !== o.valor) : [...selecionadas, o.valor],
          );
        // A LINHA inteira é o clique, e não só o quadradinho: acertar 16px de
        // checkbox é mira desnecessária. O Checkbox fica inerte
        // (`pointer-events-none`) porque ele é um botão de verdade por dentro:
        // com os dois vivos, o clique em cima dele contaria duas vezes e o
        // valor voltaria ao que era.
        return (
          <button
            key={o.valor}
            type="button"
            onClick={alternar}
            aria-pressed={marcada}
            className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-muted"
          >
            <Checkbox checked={marcada} tabIndex={-1} className="pointer-events-none" />
            <span className="min-w-0 flex-1 truncate" title={o.rotulo}>
              {o.rotulo}
            </span>
            {o.n != null && (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.n}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
