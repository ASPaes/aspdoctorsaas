// Envios recorrentes (F4): o que repete, quando sai o próximo, o que deu errado
// na última vez. Pausar, mudar a regra e apagar.
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, Loader2, Pause, Play, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { RegraRepeticao, regraValida } from "./RegraRepeticao";
import {
  descreverRegra, useApagarRecorrencia, useAtivarRecorrencia, useMensagensProntas, useRecorrencias,
  useSalvarMensagemPronta, useSalvarRecorrencia,
  type Recorrencia, type RegraRecorrencia,
} from "./useEnvioLoteExtras";

export function ListaRecorrentes({ selecionada, onAbrir }: { selecionada: string | null; onAbrir: (id: string) => void }) {
  const { data: recs = [], isLoading } = useRecorrencias();
  if (isLoading) return <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;
  if (!recs.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
        <Repeat className="h-8 w-8 opacity-50" />
        Nenhum envio recorrente. No passo Revisar de um envio, escolha <b>Repetir sempre</b>.
      </div>
    );
  }
  return (
    <>
      {recs.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onAbrir(r.id)}
          className={`flex w-full flex-col gap-1 border-b border-border px-3 py-2.5 text-left hover:bg-muted/60 ${r.id === selecionada ? "bg-muted/60 shadow-[inset_3px_0_0_hsl(var(--primary))]" : ""}`}
        >
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
            {r.titulo}
            {r.ultimo_erro && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
          </span>
          <span className="text-xs text-muted-foreground">{descreverRegra(r).split(".")[0]}</span>
          <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.ativo ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>
            {r.ativo ? (r.proxima_em ? `Próximo ${format(new Date(r.proxima_em), "dd/MM HH:mm")}` : "Ativo") : "Pausado"}
          </span>
        </button>
      ))}
    </>
  );
}

export function DetalheRecorrente({ id, onApagada, onAbrirEnvio }: { id: string; onApagada: () => void; onAbrirEnvio: (envioId: string) => void }) {
  const { data: recs = [] } = useRecorrencias();
  const r = recs.find((x) => x.id === id);
  if (!r) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Recorrência não encontrada.</div>;
  return <DetalheRecorrenteConteudo key={r.id} r={r} onApagada={onApagada} onAbrirEnvio={onAbrirEnvio} />;
}

function DetalheRecorrenteConteudo({ r, onApagada, onAbrirEnvio }: { r: Recorrencia; onApagada: () => void; onAbrirEnvio: (envioId: string) => void }) {
  const { instances = [] } = useWhatsAppInstances();
  const ativar = useAtivarRecorrencia();
  const salvar = useSalvarRecorrencia();
  const apagar = useApagarRecorrencia();
  const [confirmar, setConfirmar] = useState(false);
  const regraDe = (x: Recorrencia): RegraRecorrencia => ({
    frequencia: x.frequencia, diaMes: x.dia_mes ?? 10, diasSemana: x.dias_semana ?? [1], hora: x.hora.slice(0, 5), ajuste: x.ajuste_dia_util,
  });
  const [regra, setRegra] = useState<RegraRecorrencia>(regraDe(r));
  useEffect(() => setRegra(regraDe(r)), [r]);
  const mudou = JSON.stringify(regra) !== JSON.stringify(regraDe(r));
  const inst = instances.find((i: any) => i.id === r.instance_id) as any;

  const salvarRegra = async () => {
    try {
      const res = await salvar.mutateAsync({
        id: r.id, titulo: r.titulo, instanceId: r.instance_id, listId: r.list_id, modelId: r.model_id,
        regra, intervaloMin: r.intervalo_min_s, intervaloMax: r.intervalo_max_s, ativo: r.ativo,
      });
      toast.success(`Regra salva. Próximo envio: ${format(new Date(res.proxima_em), "dd/MM/yyyy 'às' HH:mm")}.`);
    } catch (e: any) { toast.error(e?.message || "Não consegui salvar."); }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{r.titulo}</h2>
          <p className="text-xs text-muted-foreground">
            Grupo <b>{r.lista_nome ?? "?"}</b> · mensagem <b>{r.modelo_titulo ?? "?"}</b> · número {inst?.display_name || inst?.instance_name || "?"} · {r.intervalo_min_s} a {r.intervalo_max_s} s entre mensagens
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`border-0 ${r.ativo ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{r.ativo ? "Ativo" : "Pausado"}</Badge>
          <Button
            variant="outline" size="sm"
            disabled={ativar.isPending}
            onClick={async () => {
              try {
                const prox = await ativar.mutateAsync({ id: r.id, ativo: !r.ativo });
                toast.success(r.ativo ? "Pausado." : `Retomado. Próximo: ${prox ? format(new Date(prox), "dd/MM HH:mm") : "-"}.`);
              } catch (e: any) { toast.error(e?.message || "Não consegui mudar."); }
            }}
          >
            {r.ativo ? <><Pause className="mr-1 h-3.5 w-3.5" /> Pausar</> : <><Play className="mr-1 h-3.5 w-3.5" /> Retomar</>}
          </Button>
          <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirmar(true)}><Trash2 className="mr-1 h-3.5 w-3.5" /> Apagar</Button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Caixa k="Próximo envio" v={r.ativo && r.proxima_em ? format(new Date(r.proxima_em), "dd/MM/yyyy HH:mm") : "Pausado"} />
          <Caixa k="Último envio" v={r.ultima_em ? format(new Date(r.ultima_em), "dd/MM/yyyy HH:mm") : "Ainda não saiu"} />
          <Caixa k="Repete" v={descreverRegra(r).split(".")[0]} pequeno />
        </div>

        {r.ultimo_erro && (
          <div className="flex gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>A última repetição não saiu:</b> {r.ultimo_erro}. A próxima data já foi marcada; corrija o motivo antes dela.</span>
          </div>
        )}
        {r.ultimo_bulk_id && (
          <Button variant="outline" size="sm" onClick={() => onAbrirEnvio(r.ultimo_bulk_id!)}>Ver o último envio</Button>
        )}

        <div className="rounded-lg border border-border p-3.5">
          <div className="mb-2 text-sm font-semibold">Quando repete</div>
          <RegraRepeticao regra={regra} onChange={setRegra} />
          <div className="mt-3 flex justify-end">
            <Button disabled={!mudou || !regraValida(regra) || salvar.isPending} onClick={salvarRegra}>
              {salvar.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar regra
            </Button>
          </div>
        </div>
        <MensagemDaRecorrencia modelId={r.model_id} />

        <p className="text-xs text-muted-foreground">
          Para mudar quem recebe, edite o grupo <b>{r.lista_nome}</b>: Novo envio, aba Grupos de envio, lápis do grupo. Vale a partir da próxima repetição.
        </p>
      </div>

      <AlertDialog open={confirmar} onOpenChange={setConfirmar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar "{r.titulo}"?</AlertDialogTitle>
            <AlertDialogDescription>Não sai mais nenhuma repetição. Os envios que já saíram continuam no histórico; o grupo e a mensagem pronta ficam salvos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                try { await apagar.mutateAsync(r.id); toast.success("Recorrência apagada."); onApagada(); }
                catch (e: any) { toast.error(e?.message || "Não consegui apagar."); }
              }}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** O texto que sai em cada repetição. Texto livre edita aqui; template só mostra. */
function MensagemDaRecorrencia({ modelId }: { modelId: string }) {
  const { data: modelos = [] } = useMensagensProntas();
  const salvar = useSalvarMensagemPronta();
  const m = modelos.find((x) => x.id === modelId);
  const [texto, setTexto] = useState(m?.content ?? "");
  useEffect(() => { if (m) setTexto(m.content); }, [m?.id, m?.content]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m) return null;

  return (
    <div className="rounded-lg border border-border p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Mensagem</span>
        {m.media_file_name && <Badge variant="secondary" className="text-[10px]">PDF: {m.media_file_name}</Badge>}
        {m.template_id && <Badge variant="secondary" className="text-[10px]">Template da Meta</Badge>}
      </div>
      {m.template_id ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          Variáveis: {(Array.isArray(m.template_params) ? m.template_params : Object.values(m.template_params || {})).join(" · ") || "nenhuma"}
        </p>
      ) : (
        <>
          <Textarea rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Texto da mensagem recorrente" />
          <div className="mt-2 flex justify-end">
            <Button
              disabled={texto === m.content || !texto.trim() || salvar.isPending}
              onClick={async () => {
                try {
                  await salvar.mutateAsync({
                    id: m.id, titulo: m.titulo, content: texto,
                    anexo: m.storage_path ? { storagePath: m.storage_path, mime: m.media_mimetype || "application/pdf", nome: m.media_file_name || "anexo.pdf", tamanho: m.media_size_bytes || 0 } : null,
                  });
                  toast.success("Mensagem salva. Vale a partir da próxima repetição.");
                } catch (e: any) { toast.error(e?.message || "Não consegui salvar."); }
              }}
            >
              Salvar mensagem
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Caixa({ k, v, pequeno }: { k: string; v: string; pequeno?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-xs font-semibold text-muted-foreground">{k}</div>
      <div className={`${pequeno ? "text-sm" : "text-lg"} font-bold tabular-nums`}>{v}</div>
    </div>
  );
}
