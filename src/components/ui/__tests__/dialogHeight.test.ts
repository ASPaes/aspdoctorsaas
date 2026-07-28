import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Guarda de altura de diálogo.
 *
 * Notebook 13" com barra de favoritos tem ~690px de viewport útil. Um diálogo
 * mais alto que isso é cortado ou obriga o usuário a rolar um formulário.
 *
 * Isto é HEURÍSTICA CALIBRADA, não layout real: estima a altura contando campos.
 * A estimativa deu 600px onde a medição real no Chrome deu 728px (NewJourneyModal),
 * daí o fator 1.21. Pega regressão grosseira — alguém empilhar 10 campos num
 * `max-w-md` — não erro de pixel.
 */
const ORCAMENTO_PX = 690;
const CALIBRACAO = 1.21;

const ALTURA_CAMPO = 66; // label(14) + gap(6) + controle(40) + respiro(6)
const ALTURA_CABECALHO = 34;
const ALTURA_RODAPE = 56;
const PADDING_VERTICAL = 48; // p-6 em cima e embaixo

function arquivosTsx(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) arquivosTsx(p, acc);
    else if (e.name.endsWith(".tsx")) acc.push(p);
  }
  return acc;
}

type Diagnostico = { arquivo: string; campos: number; duasColunas: boolean; altura: number };

function medirDialogos(): Diagnostico[] {
  const fora: Diagnostico[] = [];
  for (const arquivo of arquivosTsx("src")) {
    const src = fs.readFileSync(arquivo, "utf8");
    let i = 0;
    while ((i = src.indexOf("<DialogContent", i)) >= 0) {
      const fim = src.indexOf("</DialogContent>", i);
      if (fim < 0) break;
      const abertura = src.slice(i, src.indexOf(">", i) + 1);
      const corpo = src.slice(i, fim);
      i = fim + "</DialogContent>".length;

      // Isento: layout próprio com miolo rolável (overflow-hidden + flex-col).
      // Esses já têm cabeçalho e rodapé fixos por conta própria.
      if (/overflow-hidden/.test(abertura) && /flex-col/.test(abertura)) continue;

      // Válvula explícita. A contagem de campos não enxerga exclusividade mútua:
      // um formulário com blocos condicionais por provedor tem 13 campos no
      // arquivo mas nunca mais que 7 na tela. Quem sabe que é o caso declara e
      // justifica com `dialog-height-ok: <motivo>` dentro do diálogo — a exceção
      // fica visível na revisão em vez de virar orçamento frouxo para todos.
      if (/dialog-height-ok:\s*\S/.test(corpo)) continue;

      const conta = (re: RegExp) => (corpo.match(re) || []).length;
      const textareas = conta(/<Textarea[\s>]/g);
      const campos =
        conta(/<Input[\s>]/g) +
        conta(/<SelectTrigger[\s>]/g) +
        textareas +
        conta(/<Switch[\s>]/g) +
        conta(/<Checkbox[\s>]/g);
      if (campos === 0) continue;

      const duasColunas = /sm:grid-cols-2|md:grid-cols-2/.test(corpo);
      const linhas = duasColunas ? Math.ceil(campos / 2) : campos;
      const altura = Math.round(
        (ALTURA_CABECALHO + linhas * ALTURA_CAMPO + textareas * 40 + ALTURA_RODAPE + PADDING_VERTICAL) *
          CALIBRACAO,
      );

      if (altura > ORCAMENTO_PX) {
        fora.push({ arquivo: arquivo.replace(/^src\//, ""), campos, duasColunas, altura });
      }
    }
  }
  return fora.sort((a, b) => b.altura - a.altura);
}

describe("altura de diálogo", () => {
  it(`nenhum diálogo passa de ${ORCAMENTO_PX}px (notebook 13")`, () => {
    const fora = medirDialogos();
    const relatorio = fora
      .map((d) => `  ${d.altura}px  ${d.campos} campos  ${d.duasColunas ? "2col" : "1col"}  ${d.arquivo}`)
      .join("\n");
    expect(fora, `Diálogos acima do orçamento:\n${relatorio}\n`).toEqual([]);
  });
});
