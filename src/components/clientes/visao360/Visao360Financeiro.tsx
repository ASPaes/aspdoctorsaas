import { useMemo, useState } from "react";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Copy, QrCode, Send } from "lucide-react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import BotaoBoleto from "@/components/financeiro/BotaoBoleto";
import BotaoDocumentos from "@/components/financeiro/BotaoDocumentos";
import { cn } from "@/lib/utils";
import { Cartao, Chips, Etiqueta, Mini, Vazio } from "./Visao360Ui";
import { brl, kpisFinanceiro, type Titulo360 } from "./visao360Calc";

const SITUACAO: Record<string, { texto: string; tom: "ok" | "ruim" | "alerta" | "info" | "neutro" }> = {
  atrasado: { texto: "Vencido", tom: "ruim" },
  vence_hoje: { texto: "Vence hoje", tom: "alerta" },
  a_vencer: { texto: "A vencer", tom: "info" },
  pago: { texto: "Pago", tom: "ok" },
  parcial: { texto: "Pago em parte", tom: "alerta" },
  cancelado: { texto: "Cancelado", tom: "neutro" },
};

const dataBR = (iso: string | null) => (iso ? format(parseISO(iso), "dd/MM/yyyy") : "—");

async function copiar(texto: string, oque: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${oque} copiado.`);
  } catch {
    toast.error(`Não deu para copiar. Selecione e copie à mão: ${texto}`);
  }
}

type Filtro = "abertos" | "vencidos" | "pagos" | "todos";

export function FinanceiroSubAba({ titulos, atualizadoEm, onEnviar }: { titulos: Titulo360[]; atualizadoEm: string | null; onEnviar?: (tituloId: string) => void }) {
  const k = useMemo(() => kpisFinanceiro(titulos, new Date()), [titulos]);
  const [filtro, setFiltro] = useState<Filtro>(k.abertoQtd ? "abertos" : "todos");
  const [limite, setLimite] = useState(50);

  const lista = useMemo(() => {
    const f = titulos.filter((t) =>
      filtro === "todos" ? true
        : filtro === "abertos" ? t.aberto
        : filtro === "vencidos" ? t.situacao === "atrasado"
        : t.situacao === "pago" || t.situacao === "parcial");
    // Em aberto: o que vence primeiro no topo. Histórico: o mais recente no topo.
    return f.sort((a, b) =>
      a.aberto !== b.aberto ? (a.aberto ? -1 : 1)
        : a.aberto ? a.vencimento.localeCompare(b.vencimento) : b.vencimento.localeCompare(a.vencimento));
  }, [titulos, filtro]);

  // Faixas do que está em aberto, para a barra de cima.
  const faixas = useMemo(() => {
    const ab = titulos.filter((t) => t.aberto);
    const soma = (xs: Titulo360[]) => xs.reduce((a, t) => a + t.valor, 0);
    return [
      { rotulo: "Vencido há mais de 30 dias", cor: "bg-red-600", valor: soma(ab.filter((t) => t.situacao === "atrasado" && t.dias_atraso > 30)) },
      { rotulo: "Vencido até 30 dias", cor: "bg-red-400", valor: soma(ab.filter((t) => t.situacao === "atrasado" && t.dias_atraso <= 30)) },
      { rotulo: "Vence hoje", cor: "bg-amber-500", valor: soma(ab.filter((t) => t.situacao === "vence_hoje")) },
      { rotulo: "A vencer", cor: "bg-sky-500", valor: soma(ab.filter((t) => t.situacao === "a_vencer")) },
    ].filter((f) => f.valor > 0);
  }, [titulos]);
  const totalFaixas = faixas.reduce((a, f) => a + f.valor, 0);

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini rotulo="Em aberto" valor={brl(k.abertoValor)} sub={`${k.abertoQtd} título${k.abertoQtd === 1 ? "" : "s"}`} />
        <Mini
          rotulo="Vencido"
          valor={brl(k.vencidoValor)}
          tom={k.vencidoQtd ? "ruim" : undefined}
          sub={k.vencidoQtd ? `${k.vencidoQtd} título${k.vencidoQtd === 1 ? "" : "s"}, o mais antigo há ${k.maiorAtraso} dia${k.maiorAtraso === 1 ? "" : "s"}` : "nada vencido"}
        />
        <Mini rotulo="Pago em 12 meses" valor={brl(k.pago12Valor)} sub={`${k.pago12Qtd} título${k.pago12Qtd === 1 ? "" : "s"}`} />
        <Mini
          rotulo="Pontualidade"
          valor={k.pontualidade != null ? `${k.pontualidade}%` : "—"}
          sub={k.atrasoMedio != null ? `quando atrasa, atrasa ${Math.round(k.atrasoMedio)} dia${Math.round(k.atrasoMedio) === 1 ? "" : "s"} em média` : k.pontualidade != null ? "pagou tudo em dia" : "sem pagamento em 12 meses"}
        />
      </div>

      <Cartao
        titulo="Títulos"
        sub={atualizadoEm ? `atualizado há ${formatDistanceToNowStrict(parseISO(atualizadoEm), { locale: ptBR })}` : undefined}
        acao={
          <Chips
            valor={filtro}
            onChange={(v) => { setFiltro(v); setLimite(50); }}
            opcoes={[
              { id: "abertos", label: "Em aberto", qtd: k.abertoQtd },
              { id: "vencidos", label: "Vencidos", qtd: k.vencidoQtd },
              { id: "pagos", label: "Pagos" },
              { id: "todos", label: "Todos", qtd: titulos.length },
            ]}
          />
        }
      >
        {totalFaixas > 0 && (
          <div className="px-4 pb-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-muted">
              {faixas.map((f) => <span key={f.rotulo} className={f.cor} style={{ width: `${(f.valor / totalFaixas) * 100}%` }} title={`${f.rotulo}: ${brl(f.valor)}`} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {faixas.map((f) => (
                <span key={f.rotulo} className="inline-flex items-center gap-1.5">
                  <span className={cn("h-2 w-2 rounded-full", f.cor)} />{f.rotulo} · <b className="tabular-nums text-foreground">{brl(f.valor)}</b>
                </span>
              ))}
            </div>
          </div>
        )}

        {titulos.length === 0 ? (
          <Vazio>Nenhum título deste cliente veio do sistema de cobrança. Pode ser que ele exista lá sem vínculo com este cadastro.</Vazio>
        ) : lista.length === 0 ? (
          <Vazio>Nenhum título neste filtro.</Vazio>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Documento</TableHead><TableHead>Emissão</TableHead><TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead><TableHead>Situação</TableHead><TableHead>Nota</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.slice(0, limite).map((t) => {
                  const s = SITUACAO[t.situacao] ?? { texto: t.situacao, tom: "neutro" as const };
                  const atrasoPago = t.pago_em ? Math.round((parseISO(t.pago_em).getTime() - parseISO(t.vencimento).getTime()) / 86_400_000) : 0;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{[t.numero_documento, t.parcela].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{dataBR(t.emissao)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{dataBR(t.vencimento)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{brl(t.valor)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Etiqueta tom={s.tom}>
                          {t.situacao === "atrasado" ? `Vencido há ${t.dias_atraso} dia${t.dias_atraso === 1 ? "" : "s"}` : s.texto}
                          {(t.situacao === "pago" || t.situacao === "parcial") && t.pago_em ? ` em ${dataBR(t.pago_em)}` : ""}
                        </Etiqueta>
                        {atrasoPago > 0 && <span className="ml-1.5 text-[11px] text-amber-600 dark:text-amber-400">{atrasoPago} d de atraso</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{t.numero_nf ? `nº ${t.numero_nf}` : "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-0.5">
                          {t.aberto && t.boleto_gerado && onEnviar && (
                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => onEnviar(t.id)} title="Mandar este boleto pelo chat">
                              <Send className="h-3.5 w-3.5" />Enviar
                            </Button>
                          )}
                          {t.aberto && <BotaoBoleto tituloId={t.id} boletoGerado={t.boleto_gerado} compacto />}
                          {t.aberto && t.codigo_barras && (
                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => copiar(t.codigo_barras as string, "Código de barras")} title="Copiar a linha digitável">
                              <Copy className="h-3.5 w-3.5" />Linha
                            </Button>
                          )}
                          {t.aberto && t.pix_copia_cola && (
                            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => copiar(t.pix_copia_cola as string, "Pix copia e cola")} title="Copiar o Pix copia e cola">
                              <QrCode className="h-3.5 w-3.5" />Pix
                            </Button>
                          )}
                          <BotaoDocumentos tituloId={t.id} temOs={!!t.origem_os_id} compacto />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {lista.length > limite && (
          <div className="border-t px-4 py-2 text-center">
            <Button variant="ghost" size="sm" onClick={() => setLimite((l) => l + 50)}>Mostrar mais ({lista.length - limite} restantes)</Button>
          </div>
        )}
      </Cartao>
    </div>
  );
}
