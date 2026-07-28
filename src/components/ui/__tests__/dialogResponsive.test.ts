import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guarda de grid responsivo dentro de diálogo.
 *
 * `grid-cols-2` sem breakpoint nunca volta a 1 coluna: numa tela estreita os
 * campos ficam espremidos lado a lado em vez de empilhar. Era metade do "a tela
 * não é responsiva" que o cliente reportou.
 *
 * A regra vale só para grade de CAMPO. Nem todo grid-cols é campo — aba,
 * indicador e lista rótulo→valor funcionam bem em 2 colunas em qualquer largura.
 * A guarda dispensa sozinha os casos óbvios (ver `ehExcecao`); o que sobra
 * declara `grid-ok: <motivo>` na linha de cima.
 */
function arquivosTsx(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosTsx(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

function ehExcecao(linha: string, linhaAnterior: string): boolean {
  // Já escalona por conta própria: tem grid-cols com breakpoint na mesma classe.
  if (/\b(sm|md|lg|xl|2xl):grid-cols-/.test(linha)) return true;
  // Abas: TabsList divide o espaço igualmente e deve ficar lado a lado sempre.
  if (/TabsList/.test(linha)) return true;
  // Exceção declarada e justificada.
  if (/grid-ok:\s*\S/.test(linhaAnterior) || /grid-ok:\s*\S/.test(linha)) return true;
  return false;
}

function gridsRigidos(): string[] {
  const fora: string[] = [];
  for (const arquivo of arquivosTsx("src")) {
    const src = fs.readFileSync(arquivo, "utf8");
    const linhas = src.split("\n");

    // linhas que estão dentro de algum <DialogContent>…</DialogContent>
    const dentro = new Set<number>();
    let i = 0;
    while ((i = src.indexOf("<DialogContent", i)) >= 0) {
      const fim = src.indexOf("</DialogContent>", i);
      if (fim < 0) break;
      const a = src.slice(0, i).split("\n").length;
      const b = src.slice(0, fim).split("\n").length;
      for (let n = a; n <= b; n++) dentro.add(n);
      i = fim + "</DialogContent>".length;
    }

    linhas.forEach((linha, idx) => {
      const n = idx + 1;
      if (!dentro.has(n)) return;
      if (!/(^|[\s"'`])grid-cols-([2-9]|1[0-2])\b/.test(linha)) return;
      if (ehExcecao(linha, linhas[idx - 1] ?? "")) return;
      fora.push(`${arquivo.replace(/^src\//, "")}:${n}  ${linha.trim().slice(0, 90)}`);
    });
  }
  return fora;
}

describe("grid responsivo em diálogo", () => {
  it("nenhuma grade de campo fica presa em N colunas", () => {
    const fora = gridsRigidos();
    expect(fora, `Grids que nunca voltam a 1 coluna:\n${fora.join("\n")}\n`).toEqual([]);
  });
});
