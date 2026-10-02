// F5: quem pediu para sair da lista e o limite diário de cada número.
//
// Descadastro entra sozinho quando o cliente responde "SAIR" (ou PARAR, STOP,
// DESCADASTRAR...) a um envio em lote dos últimos 30 dias: gatilho
// trg_bulk_optout_da_resposta. Nenhuma resposta automática é enviada.
import { useState } from "react";
import { format } from "date-fns";
import { Loader2, ShieldCheck, Trash2, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { formatBRPhone } from "@/lib/phoneBR";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useDescadastrados, useDescadastrar, useLimiteNumero, useRecadastrar } from "./useEnvioLoteExtras";

const telTela = (t: string) => (t.startsWith("55") ? formatBRPhone(t) : t);

export function PainelDescadastrados() {
  const { data: lista = [], isLoading } = useDescadastrados();
  const descadastrar = useDescadastrar();
  const recadastrar = useRecadastrar();
  const [tel, setTel] = useState("");
  const [nome, setNome] = useState("");
  const [busca, setBusca] = useState("");

  const q = busca.trim().toLowerCase();
  const qd = q.replace(/\D/g, "");
  const visiveis = lista.filter((o) => !q || (o.nome || "").toLowerCase().includes(q) || (qd.length >= 3 && o.telefone.includes(qd)));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">Não recebem envio em lote</h2>
        <p className="text-xs text-muted-foreground">
          Quem responde <b>SAIR</b>, <b>PARAR</b>, <b>STOP</b> ou <b>DESCADASTRAR</b> a um envio em lote entra aqui sozinho e fica de fora dos próximos,
          inclusive dos recorrentes. O atendimento normal pelo chat continua. Dá para incluir alguém à mão ou tirar daqui.
        </p>
      </div>
      <div className="flex-1 space-y-3 overflow-auto px-5 py-4">
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <div className="space-y-1.5">
            <Label htmlFor="opt-tel" className="text-xs">Telefone</Label>
            <Input id="opt-tel" className="h-9 w-48" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="49 99911-2233" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="opt-nome" className="text-xs">Nome (opcional)</Label>
            <Input id="opt-nome" className="h-9 w-56" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <Button
            className="h-9"
            disabled={tel.replace(/\D/g, "").length < 10 || descadastrar.isPending}
            onClick={async () => {
              try { await descadastrar.mutateAsync({ telefone: tel, nome }); setTel(""); setNome(""); toast.success("Incluído na lista de quem não recebe."); }
              catch (e: any) { toast.error(e?.message || "Não consegui incluir."); }
            }}
          >
            <UserX className="mr-1 h-4 w-4" /> Não enviar mais
          </Button>
          <Input className="ml-auto h-9 w-56" placeholder="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>

        <div className="overflow-hidden rounded-lg border border-border">
          {isLoading ? (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
          ) : visiveis.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">{lista.length ? "Ninguém com esse nome." : "Ninguém pediu para sair até agora."}</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Telefone</th>
                  <th className="px-3 py-2">Como entrou</th>
                  <th className="px-3 py-2">Quando</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((o) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="px-3 py-2">{o.nome || "Sem nome"}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{telTela(o.telefone)}</td>
                    <td className="px-3 py-2">
                      {o.origem === "resposta"
                        ? <Badge variant="secondary" className="text-[10px]" title={o.mensagem || undefined}>Respondeu "{(o.mensagem || "").slice(0, 20)}"</Badge>
                        : <Badge variant="secondary" className="text-[10px]">Incluído à mão</Badge>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted-foreground">{format(new Date(o.created_at), "dd/MM/yyyy")}</td>
                    <td className="px-2 py-1">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7" title="Voltar a receber"
                        onClick={async () => {
                          try { await recadastrar.mutateAsync(o.id); toast.success(`${o.nome || telTela(o.telefone)} volta a receber envio em lote.`); }
                          catch (e: any) { toast.error(e?.message || "Não consegui tirar."); }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/** Limite diário de mensagens de lote por número. Só admin altera (a RPC confere). */
export function LimitesNumerosDialog({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const { instances = [] } = useWhatsAppInstances();
  const salvar = useLimiteNumero();
  const ativas = instances.filter((i: any) => i.is_active !== false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const valorDe = (i: any) => valores[i.id] ?? (i.lote_limite_diario != null ? String(i.lote_limite_diario) : "");

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Proteção dos números</DialogTitle>
          <DialogDescription>
            Máximo de mensagens de envio em lote por dia em cada número. Passou do limite, o envio não é criado e a tela diz quantas ainda cabem.
            Número novo ou recém-conectado: comece com 50 a 100 por dia e aumente aos poucos (o "aquecimento" que o WhatsApp espera). Vazio = sem limite.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {ativas.map((i: any) => (
            <div key={i.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm">
                {i.display_name || i.instance_name}
                {i.provider_type === "meta_cloud" && <span className="ml-1 text-xs text-muted-foreground">· oficial Meta</span>}
              </span>
              <Input
                type="number" min={1} className="h-9 w-28" placeholder="sem limite"
                value={valorDe(i)}
                onChange={(e) => setValores((v) => ({ ...v, [i.id]: e.target.value }))}
                aria-label={`Limite diário de ${i.display_name || i.instance_name}`}
              />
              <Button
                size="sm" variant="outline" className="h-9"
                disabled={salvar.isPending || valorDe(i) === (i.lote_limite_diario != null ? String(i.lote_limite_diario) : "")}
                onClick={async () => {
                  const n = valorDe(i).trim() === "" ? null : Number(valorDe(i));
                  try { await salvar.mutateAsync({ instanceId: i.id, limite: n }); toast.success("Limite salvo."); }
                  catch (e: any) { toast.error(e?.message || "Não consegui salvar."); }
                }}
              >
                Salvar
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
