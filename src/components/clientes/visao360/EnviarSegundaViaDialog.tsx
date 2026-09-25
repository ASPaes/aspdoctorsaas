import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Loader2, Phone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { normalizeBRPhone } from "@/lib/phoneBR";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Etiqueta } from "./Visao360Ui";
import { brl, chaveTelefoneBR, legendaBoleto, textoSemAnexo, type Titulo360 } from "./visao360Calc";
import type { Contato360 } from "./useVisao360";

const dataBR = (iso: string) => format(parseISO(iso), "dd/MM/yyyy");

function foneBonito(digitos: string) {
  const d = digitos.replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos;
}

interface Destino { chave: string; fone: string; rotulo: string; sub: string }

/**
 * "Enviar 2ª via" da Visão 360°: uma PESSOA manda o boleto pelo WhatsApp.
 *
 * SEMPRE pelo número padrão da régua de cobrança (`configuracoes.fin_regua_instance_id`),
 * decisão do Alexandre em 25/09/2026, tomada sabendo que a régua automática faz o
 * contrário (continua a conversa do número em que o cliente já fala, por risco de
 * banimento). Aqui a conversa é aberta ou reaproveitada NESSE número pela mesma
 * função do Chat (`wa_open_or_reuse_conversation`), e o boleto sai como anexo de
 * quem clicou, pela send-whatsapp-message. Sem número configurado, não envia.
 */
export function EnviarSegundaViaDialog({
  open, onOpenChange, titulos, preSelecionado, cliente, contatos, onEnviado,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  titulos: Titulo360[];
  preSelecionado?: string | null;
  cliente: { id: string; tenant_id: string | null; nome: string; telefone_whatsapp: string | null };
  contatos: Contato360[];
  onEnviado?: () => void;
}) {
  const navigate = useNavigate();
  const comBoleto = useMemo(
    () => titulos.filter((t) => t.aberto && t.boleto_gerado).sort((a, b) => a.vencimento.localeCompare(b.vencimento)),
    [titulos],
  );
  const semBoleto = titulos.filter((t) => t.aberto && !t.boleto_gerado).length;

  // Número padrão da régua desta empresa.
  const canal = useQuery({
    queryKey: ["visao360_canal_regua", cliente.tenant_id],
    enabled: open && !!cliente.tenant_id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: cfg } = await (supabase.from("configuracoes" as any) as any)
        .select("fin_regua_instance_id")
        .eq("tenant_id", cliente.tenant_id)
        .maybeSingle();
      if (!cfg?.fin_regua_instance_id) return null;
      const { data: inst } = await (supabase.from("whatsapp_instances") as any)
        .select("id, display_name, instance_name, status, is_active")
        .eq("id", cfg.fin_regua_instance_id)
        .maybeSingle();
      return inst
        ? { id: inst.id as string, nome: (inst.display_name || inst.instance_name) as string, status: inst.status as string | null, is_active: inst.is_active !== false }
        : { id: cfg.fin_regua_instance_id as string, nome: null, status: null, is_active: false };
    },
  });

  // Telefones possíveis: o WhatsApp da ficha primeiro (é o que a régua usa), depois os contatos.
  const destinos = useMemo(() => {
    const out: Destino[] = [];
    const vistos = new Set<string>();
    const por = (bruto: string | null | undefined, rotulo: string, sub: string) => {
      const fone = normalizeBRPhone(bruto ?? "");
      const chave = chaveTelefoneBR(fone);
      if (!chave || vistos.has(chave)) return;
      vistos.add(chave);
      out.push({ chave, fone, rotulo, sub });
    };
    por(cliente.telefone_whatsapp, "WhatsApp da ficha", cliente.nome);
    for (const c of contatos) por(c.fone, c.nome, c.cargo || "Contato do cliente");
    return out;
  }, [cliente, contatos]);

  const [marcados, setMarcados] = useState<string[]>([]);
  const [destino, setDestino] = useState<string>("");
  const [outro, setOutro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open) return;
    const vencidos = comBoleto.filter((t) => t.situacao === "atrasado").map((t) => t.id);
    setMarcados(preSelecionado ? [preSelecionado] : vencidos.length ? vencidos : comBoleto.slice(0, 1).map((t) => t.id));
    setDestino(destinos[0]?.chave ?? "outro");
    setOutro("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const foneEscolhido = destino === "outro"
    ? normalizeBRPhone(outro)
    : destinos.find((d) => d.chave === destino)?.fone ?? "";
  const foneValido = chaveTelefoneBR(foneEscolhido) !== null;
  const canalOk = !!canal.data?.id && canal.data.is_active;

  const enviar = async () => {
    if (!canal.data || !canalOk || !foneValido || !marcados.length || !cliente.tenant_id) return;
    const instanceId = canal.data.id;
    setEnviando(true);
    try {
      // 1) Abre (ou reaproveita) a conversa no número da régua. É a mesma função do Chat.
      const { data: conv, error: eConv } = await (supabase.rpc as any)("wa_open_or_reuse_conversation", {
        p_tenant_id: cliente.tenant_id,
        p_instance_id: instanceId,
        p_phone: foneEscolhido,
        p_contact_name: cliente.nome,
        p_cliente_id: cliente.id,
      });
      if (eConv) throw eConv;
      if (conv?.status === "blocked") throw new Error(`Esta conversa está em atendimento com ${conv.tech_name ?? "outro atendente"}. Peça para essa pessoa enviar ou transferir o atendimento.`);
      if (conv?.status === "inactive_contact") throw new Error("O contato deste número está inativo. Reative em Chat › Contatos.");
      const conversationId: string | undefined = conv?.conversation_id;
      if (!conversationId) throw new Error("Não deu para abrir a conversa.");

      // 2) Um boleto por mensagem.
      let ok = 0; let comoLink = 0; const falhas: string[] = [];
      for (const t of comBoleto.filter((x) => marcados.includes(x.id))) {
        try {
          const { data: prep, error: e1 } = await supabase.functions.invoke("fin-boleto-para-chat", { body: { titulo_id: t.id } });
          if (e1) throw e1;
          if (!prep?.ok) throw new Error(prep?.error ?? "Não deu para buscar o boleto.");
          const corpo = prep.pdf
            ? {
                conversationId, instanceId, messageType: "document", storagePath: prep.pdf.storagePath,
                fileName: prep.pdf.fileName, mediaMimetype: "application/pdf", mediaSizeBytes: prep.pdf.bytes,
                content: legendaBoleto(t),
              }
            : { conversationId, instanceId, messageType: "text", content: textoSemAnexo(t, prep.link) };
          const { data: env, error: e2 } = await supabase.functions.invoke("send-whatsapp-message", { body: corpo });
          if (e2) throw e2;
          if (env?.success === false) throw new Error(env?.error ?? "O envio não saiu.");
          ok++;
          if (!prep.pdf) comoLink++;
        } catch (e) {
          falhas.push(`${dataBR(t.vencimento)}: ${(e as Error).message}`);
        }
      }

      if (ok) {
        toast.success(`${ok} boleto${ok > 1 ? "s enviados" : " enviado"} pelo ${canal.data.nome ?? "número da régua"}.`, {
          description: comoLink ? `${comoLink} foi como link, porque o PDF não pôde ser anexado.` : undefined,
          action: { label: "Abrir conversa", onClick: () => navigate(`/whatsapp?conversation=${conversationId}`) },
        });
        onEnviado?.();
      }
      if (falhas.length) toast.error(`Não saiu: ${falhas.join(" · ")}`);
      if (!falhas.length) onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !enviando && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Enviar 2ª via</DialogTitle>
          <DialogDescription>O boleto vai em PDF pelo número padrão da régua de cobrança, com a sua assinatura. Se ainda não houver conversa nesse número, ela é aberta agora.</DialogDescription>
        </DialogHeader>

        {canal.isLoading ? null : canalOk ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
            <Smartphone className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Sai pelo <b>{canal.data?.nome ?? "número da régua"}</b></span>
            {canal.data?.status && canal.data.status !== "connected" && <Etiqueta tom="ruim" className="ml-auto">Desconectado</Etiqueta>}
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-amber-600" />
            <span>{canal.data ? "O número padrão da régua de cobrança está inativo." : "A empresa ainda não definiu o número padrão da régua de cobrança."} Defina em <b>Financeiro › Régua de cobrança</b> para enviar a 2ª via.</span>
          </div>
        )}

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
              {destinos.map((d) => (
                <button
                  key={d.chave}
                  type="button"
                  onClick={() => setDestino(d.chave)}
                  className={cn("flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors", destino === d.chave ? "border-primary bg-primary/5" : "hover:bg-muted")}
                >
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-md bg-muted"><Phone className="h-3.5 w-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{d.rotulo}</span>
                    <span className="block truncate text-xs text-muted-foreground">{foneBonito(d.fone)} · {d.sub}</span>
                  </span>
                </button>
              ))}
              <div
                className={cn("rounded-lg border px-3 py-2 text-sm transition-colors", destino === "outro" && "border-primary bg-primary/5")}
                onClick={() => setDestino("outro")}
              >
                <label htmlFor="v360-2via-outro" className="mb-1.5 block font-semibold">{destinos.length ? "Outro número" : "Número de WhatsApp"}</label>
                <Input
                  id="v360-2via-outro"
                  inputMode="tel"
                  placeholder="(45) 99999-9999"
                  value={outro}
                  onFocus={() => setDestino("outro")}
                  onChange={(e) => setOutro(e.target.value)}
                  className="h-8"
                />
                {destino === "outro" && outro && !foneValido && <p className="mt-1 text-[11.5px] text-red-600 dark:text-red-400">Número incompleto. Use DDD e número.</p>}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>Cancelar</Button>
          <Button onClick={enviar} disabled={enviando || !canalOk || !foneValido || !marcados.length || !comBoleto.length}>
            {enviando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {enviando ? "Enviando…" : `Enviar ${marcados.length > 1 ? `${marcados.length} boletos` : "boleto"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
