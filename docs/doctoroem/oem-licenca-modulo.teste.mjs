// Prova do lote com a licença REAL da DEGUST CONCEITO (filial 28533), do jeito
// que a leitura documentada devolve: os 5 escalares zerados e o 99 Food já com
// a `datavalidade` que o OEM pôs no cancelamento de 03/09.
//
//   node docs/doctoroem/oem-licenca-modulo.teste.mjs
//
// Roda offline e não fala com o parceiro: o que ele exercita é o CORPO que
// iria para a licença, que é onde os estragos desta rota moram — ela grava a
// filial inteira, e o que não vai no corpo some da licença.
//
// Ele já pegou dois defeitos: o `CAMPO_ESPELHO` que ficou sem definição no
// meio do conserto, e é a prova de que a baixa de um módulo sobrevive à
// gravação de outro.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A função vive no meio de uma edge function do Deno. Em vez de manter uma
// cópia (que envelhece calada e passaria a testar outra coisa), o teste corta
// o arquivo real antes do `Deno.serve` e importa esse pedaço.
const fonte = readFileSync(fileURLToPath(new URL("./oem-licenca-modulo.index.ts", import.meta.url)), "utf8");
const corte = fonte.indexOf("\nDeno.serve(");
if (corte < 0) throw new Error("Não achei o Deno.serve para cortar o arquivo.");
const miolo = fonte.slice(0, corte).split("\n").filter((l) => !l.startsWith("import ")).join("\n");
const { montarPayloadDocumentado } = await import(
  "data:text/javascript," + encodeURIComponent(miolo + "\nexport { montarPayloadDocumentado };")
);

const mod = (codigo, nome, ativo, quantidade, valorUnitario, datavalidade = null) => ({
  nome, ativo, codigo, codproduto: 1, quantidade,
  valorTotal: Math.round(valorUnitario * quantidade * 100) / 100,
  datacadastro: "2025-01-20T10:08:32.793", datavalidade, valorUnitario,
});

const lido = {
  codloja: 28533, codgrupoeconomico: 23756, codproduto: 1,
  nomeloja: "DEGUST CONCEITO", nomegrupo: "DEGUST CONCEITO",
  cnpJloja: "58.692.597/0001-62", nomeproduto: "GESTAO LEGAL",
  valorTotal: 106.53, bloquearLicenca: false, desativarLicenca: false,
  // ⚠️ Os cinco vêm ZERADOS da leitura documentada. É por isso que existe a
  // leitura complementar; sem ela, gravar zeraria tudo isto na licença.
  codigoTipoNegocio: 0, codigoDetalhesTipoNegocio: 0, codigoOrigemVenda: 0,
  usuariosAdicionais: 0, pdvComandas: 0,
  modulos: [
    mod(8, "Gestao", true, 1, 26.25),
    mod(9, "Usuário Cloud", true, 1, 0),
    mod(10, "PDV/Comandas", true, 5, 6),
    mod(12, "NFCE", true, 1, 21.95),
    mod(13, "NFE", false, 1, 5),
    mod(16, "Estoque", true, 1, 25.2),
    mod(17, "Financeiro", true, 1, 3.13),
    mod(21, "IFood", true, 1, 0),
    mod(25, "Delivery", true, 1, 0),
    mod(26, "Mesa/Ficha", true, 1, 0),
    // A baixa que o OEM registrou e que a gravação seguinte apagou.
    mod(61, "99 Food", true, 1, 0, "2026-09-30T00:00:00"),
    mod(72, "Servidor Legal", true, 1, 15),
  ],
};
const escalares = {
  codigoTipoNegocio: 1, codigoDetalhesTipoNegocio: 5, codigoOrigemVenda: 6,
  usuariosAdicionais: 1, pdvComandas: 5,
  bloquearLicenca: false, desativarLicenca: false,
};

let falhas = 0;
const ok = (nome, cond, extra = "") => {
  console.log(`${cond ? "  ok  " : "FALHOU"}  ${nome}${cond ? "" : `  <- ${extra}`}`);
  if (!cond) falhas++;
};
const acha = (p, c) => p.modulos.find((m) => m.codigo === c);

// ---------------------------------------------------------------------------
console.log("\n1) O lote da DEGUST: PDV 5->4, IFood cancelado, 99 Food cancelado");
const r = montarPayloadDocumentado(lido, escalares, [
  { codigo: 10, quantidade: 4 },
  { codigo: 21, quantidade: 0 },
  { codigo: 61, quantidade: 0 },
]);
ok("montou sem erro", !r.erro, JSON.stringify(r.erro));
if (!r.erro) {
  ok("PDV com quantidade 4", acha(r.novo, 10).quantidade === 4);
  ok("PDV com valorTotal recalculado (4 x 6 = 24)", acha(r.novo, 10).valorTotal === 24);
  ok("PDV segue ativo (redução não é baixa)", acha(r.novo, 10).ativo === true);
  ok("pdvComandas do topo acompanha a lista", r.novo.pdvComandas === 4);
  ok("IFood desligado", acha(r.novo, 21).ativo === false && acha(r.novo, 21).quantidade === 0);
  ok("99 Food desligado", acha(r.novo, 61).ativo === false && acha(r.novo, 61).quantidade === 0);
  ok("os TRÊS num payload só", r.alvos.length === 3);

  // O ponto do conserto: a baixa que o OEM já tinha registrado no 99 Food não
  // pode sumir do corpo. Era isso que a 4ª gravação de 03/09 apagava.
  ok("datavalidade do 99 Food preservada", acha(r.novo, 61).datavalidade === "2026-09-30T00:00:00");

  // Nada além do pedido. A rota grava a filial inteira: o que não vai, some.
  const extras = r.diferencas.filter((d) => !/codigo (10|21|61)\)/.test(d.campo));
  ok("nenhum campo se perdendo", extras.length === 0, JSON.stringify(extras));
  ok("os 5 escalares completados", r.completados.length === 5,
    r.completados.map((c) => c.campo).join(","));
  ok("módulo fora do lote intocado", JSON.stringify(acha(r.novo, 16)) === JSON.stringify(acha(lido, 16)));
}

// ---------------------------------------------------------------------------
console.log("\n2) A regressão que o lote existe para impedir");
// Alterar só o Servidor Legal não pode mexer na baixa do 99 Food.
const r2 = montarPayloadDocumentado(lido, escalares, [{ codigo: 72, quantidade: 1 }]);
ok("gravação de outro módulo preserva a baixa do 99 Food",
  !r2.erro && acha(r2.novo, 61).datavalidade === "2026-09-30T00:00:00");

// ---------------------------------------------------------------------------
console.log("\n3) As guardas");
ok("recusa o mesmo módulo duas vezes",
  montarPayloadDocumentado(lido, escalares, [{ codigo: 21, quantidade: 0 }, { codigo: 21, quantidade: 1 }]).erro?.status === 409);
ok("recusa o código 8 (é o produto, não módulo)",
  montarPayloadDocumentado(lido, escalares, [{ codigo: 8, quantidade: 0 }]).erro?.status === 400);
ok("recusa lote vazio",
  montarPayloadDocumentado(lido, escalares, []).erro?.status === 400);
ok("falta um módulo na licença: NÃO grava nenhum",
  montarPayloadDocumentado(lido, escalares, [{ codigo: 10, quantidade: 4 }, { codigo: 999, quantidade: 0 }]).erro?.status === 404);
ok("sem os escalares obrigatórios, recusa (zeraria a licença)",
  montarPayloadDocumentado(lido, { ...escalares, codigoTipoNegocio: undefined }, [{ codigo: 21, quantidade: 0 }]).erro?.status === 409);

// ---------------------------------------------------------------------------
console.log("\n4) A forma antiga (um módulo) continua igual");
const r4 = montarPayloadDocumentado(lido, escalares, [{ codigo: 9, quantidade: 3 }]);
ok("usuariosAdicionais do topo acompanha", !r4.erro && r4.novo.usuariosAdicionais === 3);
ok("reativar limpa a datavalidade do próprio módulo",
  !montarPayloadDocumentado(lido, escalares, [{ codigo: 61, quantidade: 1 }]).erro &&
  acha(montarPayloadDocumentado(lido, escalares, [{ codigo: 61, quantidade: 1 }]).novo, 61).datavalidade === null);

console.log(falhas === 0 ? "\nTUDO PASSOU\n" : `\n${falhas} FALHA(S)\n`);
process.exit(falhas === 0 ? 0 : 1);
