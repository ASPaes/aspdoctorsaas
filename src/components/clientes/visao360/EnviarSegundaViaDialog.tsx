import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Loader2, MessageCircle, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Etiqueta } from "./Visao360Ui";
import { brl, legendaBoleto, textoSemAnexo, type Titulo360 } from "./visao360Calc";

export interface ConversaDoCliente {
  id: string;
  nome: string;
  grupo: boolean;
  quando: string;
  aberta: boolean;
}

const dataBR = (iso: string) => format(parseISO(iso), "dd/MM/yyyy");

/**
 * "Enviar 2ª via" da Visão 360°: uma PESSOA manda o boleto pelo chat.
 *
 * Cada título vira um anexo PDF mandado pela send-whatsapp-message, igual a um
 * anexo do operador (sai com a assinatura dele e conta no atendimento dele).
 * Se o PDF não puder ser preparado, vai o link com a linha digitável em texto:
 * o cliente recebe de todo jeito.
 */
export function EnviarSegundaViaDialog({
  open, onOpenChange, titulos, conversas, preSelecionado, onEnviado,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  titulos: Titulo360[];
  conversas: ConversaDoCliente[];
  preSelecionado?: string | null;
  onEnviado?: () => void;
}) {
  const comBoleto = useMemo(
    () => titulos.filter((t) => t.aberto && t.boleto_gerado).sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
    [titulos],
  );
  const semBoleto = titulos.filter((t) => t.aberto && !t.boleto_gerado).length;
  const individuais = conversas.filter((c) => !c.grupo);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [conversa, setConversa] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Ao abrir: marca o título pedido (ou os vencidos), e a conversa aberta, se houver.
  useEffect(() => {
    if (!open) return;
    const vencidos = comBoleto.filter((t) => t.situacao === "atrasado").map((t) => t.id);
    setMarcados(preSelecionado ? [preSelecionado] : vencidos.length ? vencidos : comBoleto.slice(0, 1).map((t) => t.id));
    setConversa((conversas.find((c) => c.aberta) ?? individuais[0] ?? conversas[0])?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const enviar = async () => {
    if (!conversa || !marcados.length) return;
    setEnviando(true);
    let ok = 0; let comoLink = 0; const falhas: string[] = [];
    for (const t of comBoleto.filter((x) => marcados.includes(x.id))) {
      try {
        const { data: prep, error: e1 } = await supabase.functions.invoke("fin-boleto-para-chat", { body: { titulo_id: t.id } });
        if (e1) throw e1;
        if (!prep?.ok) throw new Error(prep?.error ?? "Não deu para buscar o boleto.");
        const corpo = prep.pdf
          ? {
              conversationId: conversa, messageType: "document", storagePath: prep.pdf.storagePath,
              fileName: prep.pdf.fileName, mediaMimetype: "application/pdf", mediaSizeBytes: prep.pdf.bytes,
              content: legendaBoleto(t),
            }
          : { conversationId: conversa, messageType: "text", content: textoSemAnexo(t, prep.link) };
        const { data: env, error: e2 } = await supabase.functions.invoke("send-whatsapp-message", { body: corpo });
        if (e2) throw e2;
        if (env?.success === false) throw new Error(env?.error ?? "O envio não saiu.");
        ok++;
        if (!prep.pdf) comoLink++;
      } catch (e) {
        falhas.push(`${dataBR(t.vencimento)}: ${(e as Error).message}`);
      }
    }
    setEnviando(false);
    if (ok) {
      toast.success(`${ok} boleto${ok > 1 ? "s enviados" : " enviado"} no chat.`, {
        description: comoLink ? `${comoLink} foi como link, porque o PDF não pôde ser anexado.` : undefined,
      });
      onEnviado?.();
    }
    if (falhas.length) toast.error(`Não saiu: ${falhas.join(" · ")}`);
    if (!falhas.length) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !enviando && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar 2ª via</DialogTitle>
          <DialogDescription>O boleto vai em PDF pela conversa escolhida, com a sua assinatura, como qualquer anexo que você manda no chat.</DialogDescription>
        </DialogHeader>

        {comBoleto.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">
            Nenhum título em aberto tem boleto gerado no Omie.{semBoleto ? ` ${semBoleto} título${semBoleto > 1 ? "s estão" : " está"} sem boleto: quem gera é o financeiro, dentro do Omie.` : ""}
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <div className="text-xs font-semibold text-muted-foreground">Boletos</div>
              {comBoleto.map((t) => {
                const on = marcados.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setMarcados((m) => (on ? m.filter((x) => x !== t.id) : [...m, t.id]))}
                    className={cn("flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors", on ? "border-primary bg-primary/5" : "hover:bg-muted")}
                  >
                    <Checkbox checked={on} tabIndex={-1} className="pointer-events-none" />
                    <span className="flex-1">
                      <b className="tabular-nums">{brl(t.valor)}</b>
                      <span className="text-muted-foreground"> · vence {dataBR(t.vencimento)}</span>
                    </span>
                    <Etiqueta tom={t.situacao === "atrasado" ? "ruim" : t.situacao === "vence_hoje" ? "alerta" : "info"}>
                      {t.situacao === "atrasado" ? `Vencido há ${t.dias_atraso} d` : t.situacao === "vence_hoje" ? "Vence hoje" : "A vencer"}
                    </Etiqueta>
                  </button>
                );
              })}
              {semBoleto > 0 && <p className="text-[11.5px] text-muted-foreground">{semBoleto} título{semBoleto > 1 ? "s" : ""} em aberto sem boleto no Omie não aparece{semBoleto > 1 ? "m" : ""} aqui.</p>}
            </div>

            <div className="grid gap-1.5">
              <div className="text-xs font-semibold text-muted-foreground">Mandar para</div>
              {conversas.length === 0 ? (
                <p className="rounded-lg bg-muted px-3 py-2.5 text-sm text-muted-foreground">
                  Este cliente ainda não tem conversa no chat. Abra uma pelo botão "Abrir conversa" e volte aqui.
                </p>
              ) : (
                conversas.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setConversa(c.id)}
                    className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors", conversa === c.id ? "border-primary bg-primary/5" : "hover:bg-muted")}
                  >
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-muted">
                      {c.grupo ? <Users className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{c.nome}</span>
                      <span className="block text-xs text-muted-foreground">{c.aberta ? "Atendimento aberto" : `Último atendimento em ${format(parseISO(c.quando), "dd/MM/yy")}`}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={enviando || !conversa || !marcados.length || !comBoleto.length}>
            {enviando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {enviando ? "Enviando…" : `Enviar ${marcados.length > 1 ? `${marcados.length} boletos` : "boleto"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
