import { useEffect, useMemo, useRef, useState } from "react";
import { addSeconds, format } from "date-fns";
import { CalendarClock, Check, Clock, FileText, Info, Loader2, Paperclip, Search, Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useBusinessHoursConfig } from "@/components/whatsapp/hooks/useBusinessHoursConfig";
import { dentroDoHorario, proximoHorarioUtil } from "@/lib/businessHours";
import { aplicarNome } from "./nomeNaMensagem";
import {
  RITMO_PADRAO, subirPdfDoLote, useCriarEnvioLote, useDestinosLote,
  type Destino, type OrigemDestino,
} from "./useEnvioLote";

const RITMOS = [
  { id: "lento", rotulo: "Mais lento", min: 15, max: 60 },
  { id: "padrao", rotulo: "Recomendado", min: RITMO_PADRAO.min, max: RITMO_PADRAO.max },
  { id: "rapido", rotulo: "Mais rápido", min: 3, max: 10 },
  { id: "custom", rotulo: "Personalizado", min: 0, max: 0 },
] as const;

const PDF_MAX = 16 * 1024 * 1024;

// "Começar agora" = daqui a 1 minuto. O motor olha a fila 1x por minuto e pega
// a mensagem de lote até 55 s antes; começando em 15 s, a primeira podia ficar
// para o tique seguinte e sair colada na segunda (visto no teste de 30/09: 3 s).
const FOLGA_INICIO_MS = 60 * 1000;

function duracaoTexto(seg: number) {
  const m = Math.round(seg / 60);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

interface Props {
  mudaRitmo: boolean;
  onCriado: (envioId: string) => void;
}

export function NovoEnvioLote({ mudaRitmo, onCriado }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { instances = [] } = useWhatsAppInstances();
  const horario = useBusinessHoursConfig();
  const criar = useCriarEnvioLote();

  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [origem, setOrigem] = useState<OrigemDestino>("grupos");
  const [busca, setBusca] = useState("");
  const [segmento, setSegmento] = useState<string>("todos");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [mensagem, setMensagem] = useState("Olá, {nome_cliente}!\n\n");
  const [pdf, setPdf] = useState<File | null>(null);
  const [ritmoId, setRitmoId] = useState<(typeof RITMOS)[number]["id"]>("padrao");
  const [custom, setCustom] = useState({ min: 5, max: 30 });
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");
  const [agendarPara, setAgendarPara] = useState("");
  const [confirmo, setConfirmo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  // Número da API oficial da Meta fica de fora: ela não entrega em grupo e só
  // aceita texto livre para quem escreveu nas últimas 24 h.
  const ativas = instances.filter((i: any) => i.is_active !== false && i.provider_type !== "meta_cloud");
  useEffect(() => {
    if (!instanceId && ativas.length) {
      const conectada = ativas.find((i: any) => i.status === "connected") || ativas[0];
      setInstanceId(conectada.id);
    }
  }, [ativas, instanceId]);

  const { data, isLoading: carregandoDestinos } = useDestinosLote(instanceId);
  const destinos = data?.destinos ?? [];
  const segmentos = data?.segmentos ?? [];

  // Trocar de número zera a seleção: grupo de um número não recebe pelo outro.
  useEffect(() => { setMarcados(new Set()); setNomes({}); }, [instanceId]);

  const porOrigem = useMemo(() => ({
    grupos: destinos.filter((d) => d.ehGrupo),
    contatos: destinos.filter((d) => !d.ehGrupo),
    clientes: destinos.filter((d) => d.clienteId),
  }), [destinos]);

  // Número sem grupo nenhum abre direto na primeira aba que tem gente.
  useEffect(() => {
    if (carregandoDestinos || porOrigem[origem].length > 0) return;
    const primeira = (["grupos", "contatos", "clientes"] as OrigemDestino[]).find((o) => porOrigem[o].length > 0);
    if (primeira) setOrigem(primeira);
  }, [porOrigem, origem, carregandoDestinos]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return porOrigem[origem].filter((d) =>
      (!q || d.nomeContato.toLowerCase().includes(q) || (d.clienteNome || "").toLowerCase().includes(q)) &&
      (origem !== "clientes" || segmento === "todos" || String(d.segmentoId) === segmento),
    );
  }, [porOrigem, origem, busca, segmento]);

  const nomeDe = (d: Destino) => nomes[d.conversationId] ?? d.nomeSugerido;
  const selecionados = destinos.filter((d) => marcados.has(d.conversationId));
  const n = selecionados.length;
  const todosVisiveis = visiveis.length > 0 && visiveis.every((d) => marcados.has(d.conversationId));

  const ritmo = ritmoId === "custom" ? custom : RITMOS.find((r) => r.id === ritmoId)!;
  const ritmoValido = ritmo.min >= 2 && ritmo.max <= 600 && ritmo.min <= ritmo.max;
  const duracaoSeg = Math.max(0, n - 1) * ((ritmo.min + ritmo.max) / 2);
  const inicio = quando === "agendar" && agendarPara ? new Date(agendarPara) : new Date(Date.now() + FOLGA_INICIO_MS);
  const fim = addSeconds(inicio, duracaoSeg);
  const foraDoHorario = horario && (!dentroDoHorario(inicio, horario) || !dentroDoHorario(fim, horario));
  const proximoUtil = foraDoHorario ? proximoHorarioUtil(new Date(), horario) : null;
  const porMinuto = 60 / ((ritmo.min + ritmo.max) / 2);

  const textoFinal = mensagem.trim();
  const passa = pdf ? textoFinal.length <= 1000 : textoFinal.length > 0 && textoFinal.length <= 4000;

  const inserirNome = () => {
    const ta = textoRef.current;
    const pos = ta?.selectionStart ?? mensagem.length;
    const fimSel = ta?.selectionEnd ?? pos;
    setMensagem(mensagem.slice(0, pos) + "{nome_cliente}" + mensagem.slice(fimSel));
    requestAnimationFrame(() => {
      ta?.focus();
      const p = pos + "{nome_cliente}".length;
      ta?.setSelectionRange(p, p);
    });
  };

  const disparar = async () => {
    if (!tid || !instanceId) return;
    setEnviando(true);
    try {
      const anexo = pdf ? await subirPdfDoLote(tid, pdf) : null;
      const r = await criar.mutateAsync({
        instanceId,
        conteudo: textoFinal,
        destinos: selecionados.map((d) => ({ conversation_id: d.conversationId, nome: nomeDe(d).trim() })),
        anexo,
        intervaloMin: ritmo.min,
        intervaloMax: ritmo.max,
        inicioEm: quando === "agendar" && agendarPara ? new Date(agendarPara) : new Date(Date.now() + FOLGA_INICIO_MS),
      });
      toast.success(`Envio criado para ${r.total} destinatários.`);
      onCriado(r.bulk_send_id);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível criar o envio.");
    } finally {
      setEnviando(false);
    }
  };

  const exemplo = selecionados[0] || visiveis[0];
  const instancia = ativas.find((i: any) => i.id === instanceId) as any;

  const passos = ["Destinatários", "Mensagem", "Revisar"];

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">Novo envio</h2>
        <div className="flex gap-1">
          {passos.map((p, i) => {
            const k = (i + 1) as 1 | 2 | 3;
            const liberado = k === 1 || (k === 2 && n > 0) || (k === 3 && n > 0 && passa);
            return (
              <button
                key={p}
                type="button"
                disabled={!liberado}
                onClick={() => { setPasso(k); setConfirmo(false); }}
                className={`flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2.5 text-xs font-semibold transition-colors ${passo === k ? "bg-muted text-foreground" : "text-muted-foreground"} disabled:opacity-50`}
              >
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${passo === k ? "bg-primary text-primary-foreground" : k < passo ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {k < passo ? <Check className="h-3 w-3" /> : k}
                </span>
                {p}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        {passo === 1 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label className="block text-xs">Enviar pelo número</Label>
                <Select value={instanceId ?? undefined} onValueChange={setInstanceId}>
                  <SelectTrigger className="h-9 w-64"><SelectValue placeholder="Escolha o número" /></SelectTrigger>
                  <SelectContent>
                    {ativas.map((i: any) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.display_name || i.instance_name}{i.status !== "connected" ? " (desconectado)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="block text-xs">Destinatários</Label>
                <div className="inline-flex rounded-lg bg-muted p-1">
                  {(["grupos", "contatos", "clientes"] as OrigemDestino[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => { setOrigem(o); setBusca(""); }}
                      disabled={porOrigem[o].length === 0}
                      title={o === "clientes" && porOrigem.clientes.length === 0 ? "Nenhum contato deste número está vinculado a cliente cadastrado" : undefined}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold capitalize ${origem === o ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"} disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {o}
                      <span className="rounded-full bg-border px-1.5 text-[10px] tabular-nums text-foreground">{porOrigem[o].length}</span>
                    </button>
                  ))}
                </div>
              </div>
              {origem === "clientes" && segmentos.length > 0 && (
                <div className="space-y-1.5">
                  <Label className="block text-xs">Segmento</Label>
                  <Select value={segmento} onValueChange={setSegmento}>
                    <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      {segmentos.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="min-w-[180px] flex-1 space-y-1.5">
                <Label className="block text-xs" htmlFor="lote-busca">Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input id="lote-busca" className="h-9 pl-8" placeholder="Nome do grupo, contato ou cliente" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-sky-500/10 px-3 py-2 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span>
                <b>Nome na mensagem</b> é o que entra no lugar de <code className="font-mono">{"{nome_cliente}"}</code>.
                {origem === "grupos" ? " Já vem sem o nome da sua empresa e sem o \"x\"." : " Contato usa o primeiro nome."} Dá para editar, e o sistema lembra na próxima vez.
              </span>
            </div>

            <div className="max-h-[calc(100vh-24rem)] min-h-[200px] overflow-auto rounded-lg border border-border">
              {ativas.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  Nenhum número disponível para envio em lote. Números da API oficial da Meta não entram: ela não entrega em grupo e só aceita texto livre para quem escreveu nas últimas 24 horas.
                </div>
              ) : carregandoDestinos ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando conversas deste número...</div>
              ) : visiveis.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Nenhuma conversa encontrada neste número.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <Checkbox
                          checked={todosVisiveis}
                          onCheckedChange={(v) => {
                            const novo = new Set(marcados);
                            visiveis.forEach((d) => (v ? novo.add(d.conversationId) : novo.delete(d.conversationId)));
                            setMarcados(novo);
                          }}
                          aria-label="Selecionar todos"
                        />
                      </th>
                      <th className="px-3 py-2 font-semibold">{origem === "grupos" ? "Grupo" : origem === "clientes" ? "Contato · cliente" : "Contato"}</th>
                      <th className="px-3 py-2 font-semibold">Nome na mensagem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((d) => (
                      <tr key={d.conversationId} className="border-t border-border">
                        <td className="px-3 py-1.5">
                          <Checkbox
                            checked={marcados.has(d.conversationId)}
                            onCheckedChange={(v) => {
                              const novo = new Set(marcados);
                              v ? novo.add(d.conversationId) : novo.delete(d.conversationId);
                              setMarcados(novo);
                            }}
                            aria-label={`Selecionar ${d.nomeContato}`}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          {d.nomeContato}
                          {origem === "clientes" && d.clienteNome && <span className="ml-1 text-xs text-muted-foreground">· {d.clienteNome}</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            className="h-8"
                            value={nomeDe(d)}
                            onChange={(e) => setNomes((m) => ({ ...m, [d.conversationId]: e.target.value }))}
                            aria-label={`Nome na mensagem para ${d.nomeContato}`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {passo === 2 && (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-2">
              <Label htmlFor="lote-msg" className="text-xs">Mensagem</Label>
              <Textarea id="lote-msg" ref={textoRef} rows={9} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">Inserir:</span>
                  <button type="button" onClick={inserirNome} className="rounded-md border border-dashed border-sky-500 bg-sky-500/10 px-2 py-0.5 font-mono text-sky-700 dark:text-sky-300">
                    {"{nome_cliente}"}
                  </button>
                </div>
                <span className={`tabular-nums ${passa ? "text-muted-foreground" : "text-red-600"}`}>
                  {textoFinal.length} / {pdf ? "1.000 (com PDF vai como legenda)" : "4.000"}
                </span>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                {pdf ? (
                  <>
                    <div className="grid h-9 w-8 place-items-center rounded bg-red-500/15 text-[10px] font-bold text-red-600">PDF</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{pdf.name}</div>
                      <div className="text-xs text-muted-foreground">{(pdf.size / 1024).toFixed(0)} KB · o mesmo arquivo para todos</div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setPdf(null)}><X className="mr-1 h-3.5 w-3.5" />Remover</Button>
                  </>
                ) : (
                  <>
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 text-sm text-muted-foreground">Nenhum anexo. Só PDF, até 16 MB.</span>
                    <Button variant="outline" size="sm" asChild>
                      <label className="cursor-pointer">
                        Anexar PDF
                        <input
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f) return;
                            if (f.type !== "application/pdf") return toast.error("Só dá para anexar PDF.");
                            if (f.size > PDF_MAX) return toast.error("O PDF passa de 16 MB.");
                            setPdf(f);
                          }}
                        />
                      </label>
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Prévia{exemplo ? ` para ${exemplo.nomeContato}` : ""}</Label>
              <div className="flex min-h-[240px] flex-col rounded-lg border border-border bg-[#EFEAE2] p-3 dark:bg-[#0B141A]">
                <div className="ml-auto max-w-[92%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-[#D9FDD3] px-2.5 pb-4 pt-2 text-[13.5px] text-[#111B21] shadow-sm dark:bg-[#005C4B] dark:text-[#E9EDEF] relative">
                  {pdf && (
                    <div className="mb-1.5 flex items-center gap-2 rounded-md bg-black/5 p-2">
                      <FileText className="h-5 w-5 text-red-600" />
                      <span className="truncate text-xs font-semibold">{pdf.name}</span>
                    </div>
                  )}
                  {aplicarNome(mensagem, exemplo ? nomeDe(exemplo) : "cliente") || <span className="opacity-50">Sua mensagem aparece aqui</span>}
                  <span className="absolute bottom-0.5 right-2 text-[10px] opacity-60">{format(new Date(), "HH:mm")}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Cada destinatário recebe o próprio nome.</p>
            </div>
          </div>
        )}

        {passo === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Resumo k="Destinatários" v={String(n)} s={`${selecionados.filter((d) => d.ehGrupo).length} grupos · ${selecionados.filter((d) => !d.ehGrupo).length} contatos`} />
              <Resumo k="Número" v={instancia?.display_name || instancia?.instance_name || ""} s={instancia?.status === "connected" ? "conectado" : "desconectado"} pequeno />
              <Resumo k="Anexo" v={pdf ? "1 PDF" : "Sem anexo"} s={pdf ? pdf.name : "só texto"} pequeno />
              <Resumo k="Duração estimada" v={duracaoTexto(duracaoSeg)} s={`de ${format(inicio, "dd/MM HH:mm")} até ~${format(fim, "HH:mm")}`} />
            </div>

            <div className="rounded-lg border border-border p-3.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">Ritmo: uma mensagem a cada {ritmo.min} a {ritmo.max} segundos, em ordem sorteada</span>
                <span className="text-xs text-muted-foreground tabular-nums">cerca de {porMinuto.toFixed(1).replace(".", ",")} por minuto</span>
              </div>
              {mudaRitmo ? (
                <div className="flex flex-wrap items-end gap-3">
                  <Select value={ritmoId} onValueChange={(v) => setRitmoId(v as any)}>
                    <SelectTrigger className="h-9 w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RITMOS.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.id === "custom" ? r.rotulo : `${r.rotulo} (${r.min} a ${r.max} s)`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {ritmoId === "custom" && (
                    <div className="flex items-center gap-2 text-sm">
                      de <Input type="number" className="h-9 w-20" min={2} max={600} value={custom.min} onChange={(e) => setCustom((c) => ({ ...c, min: Number(e.target.value) }))} aria-label="Intervalo mínimo em segundos" />
                      a <Input type="number" className="h-9 w-20" min={2} max={600} value={custom.max} onChange={(e) => setCustom((c) => ({ ...c, max: Number(e.target.value) }))} aria-label="Intervalo máximo em segundos" />
                      segundos
                    </div>
                  )}
                  {!ritmoValido && <span className="text-xs text-red-600">Use de 2 a 600 segundos, o menor antes do maior.</span>}
                  {ritmoValido && ritmo.min < 5 && (
                    <span className="text-xs text-amber-600">Abaixo de 5 s o risco de o WhatsApp bloquear o número aumenta.</span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Só o admin muda o ritmo.</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="lote-quando" checked={quando === "agora"} onChange={() => setQuando("agora")} className="accent-primary" /> Começar agora
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="lote-quando" checked={quando === "agendar"} onChange={() => setQuando("agendar")} className="accent-primary" /> Agendar para
              </label>
              {quando === "agendar" && (
                <Input type="datetime-local" className="h-9 w-56" value={agendarPara} onChange={(e) => setAgendarPara(e.target.value)} aria-label="Data e hora de início" />
              )}
            </div>

            {foraDoHorario && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
                <span className="flex-1">O envio {quando === "agora" ? "começa ou termina" : "cai"} fora do horário de atendimento. Dá para seguir mesmo assim.</span>
                {proximoUtil && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => { setQuando("agendar"); setAgendarPara(format(proximoUtil, "yyyy-MM-dd'T'HH:mm")); }}>
                    <CalendarClock className="mr-1 h-3.5 w-3.5" /> Agendar para {format(proximoUtil, "dd/MM HH:mm")}
                  </Button>
                )}
              </div>
            )}

            <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm">
              <Checkbox checked={confirmo} onCheckedChange={(v) => setConfirmo(!!v)} className="mt-0.5" />
              <span>
                Confirmo o envio para <b>{n} destinatários</b> pelo número <b>{instancia?.display_name || instancia?.instance_name}</b>.
                Depois de começar, só dá para cancelar o que ainda não saiu.
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        {passo === 1 ? (
          <span className="text-sm text-muted-foreground"><b className="text-foreground">{n}</b> selecionados</span>
        ) : (
          <Button variant="outline" onClick={() => { setPasso((passo - 1) as 1 | 2); setConfirmo(false); }}>Voltar</Button>
        )}
        {passo === 1 && <Button disabled={n === 0} onClick={() => setPasso(2)}>Continuar</Button>}
        {passo === 2 && <Button disabled={!passa} onClick={() => setPasso(3)}>Revisar</Button>}
        {passo === 3 && (
          <Button
            disabled={!confirmo || !ritmoValido || enviando || (quando === "agendar" && !agendarPara)}
            onClick={disparar}
          >
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {quando === "agendar" ? `Agendar para ${n}` : `Disparar para ${n}`}
          </Button>
        )}
      </div>
    </div>
  );
}

function Resumo({ k, v, s, pequeno }: { k: string; v: string; s: string; pequeno?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="text-xs font-semibold text-muted-foreground">{k}</div>
      <div className={`${pequeno ? "text-base" : "text-xl"} truncate font-bold tabular-nums`}>{v}</div>
      <div className="truncate text-xs text-muted-foreground">{s}</div>
    </div>
  );
}
