import { useEffect, useMemo, useRef, useState } from "react";
import { addSeconds, format } from "date-fns";
import {
  CalendarClock, Check, CheckCheck, ChevronDown, ChevronUp, Clock, Filter, FileSpreadsheet, FileText, Info, Loader2, Paperclip, Plus, Search, Send, Shuffle, Trash2, X,
} from "lucide-react";
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
import { formatBRPhone } from "@/lib/phoneBR";
import { contarFiltrosAvancados, FILTROS_CLIENTES_VAZIOS, type FiltrosClientes } from "@/lib/filtrosClientes";
import { FiltrosAvancadosClientesCampos } from "@/components/clientes/FiltrosAvancadosClientes";
import { aplicarNome, sugerirNomeNaMensagem } from "./nomeNaMensagem";
import { chaveTelefone, lerLinhas, lerTexto, type Avulso } from "./destinosAvulsos";
import {
  RITMO_PADRAO, subirPdfDoLote, useCriarEnvioLote, useDestinosLote, useIdsClientesFiltrados,
  type Destino, type DestinoRpc, type OrigemDestino,
} from "./useEnvioLote";

const RITMOS = [
  { id: "lento", rotulo: "Mais lento", min: 15, max: 60 },
  { id: "padrao", rotulo: "Recomendado", min: RITMO_PADRAO.min, max: RITMO_PADRAO.max },
  { id: "rapido", rotulo: "Mais rápido", min: 3, max: 10 },
  { id: "custom", rotulo: "Personalizado", min: 0, max: 0 },
] as const;

// O motor nunca solta duas mensagens de lote com menos que isso entre elas
// (PISO_LOTE_MS em dispatch-scheduled-messages).
const PISO_S = 3;
const MAX_DESTINOS = 500;
// Lista com milhares de linhas (cada uma com um campo de texto) trava a tela.
// Acima disso, mostra o começo e pede para buscar; "marcar todos" vale para todos.
const LIMITE_LINHAS = 300;

const PDF_MAX = 16 * 1024 * 1024;

// "Começar agora" = daqui a 1 minuto. O motor olha a fila 1x por minuto e pega
// a mensagem de lote até 55 s antes; começando em 15 s, a primeira podia ficar
// para o tique seguinte e sair colada na segunda (visto no teste de 30/09: 3 s).
const FOLGA_INICIO_MS = 60 * 1000;

const ABAS: { id: OrigemDestino; rotulo: string }[] = [
  { id: "grupos", rotulo: "Grupos" },
  { id: "contatos", rotulo: "Contatos" },
  { id: "clientes", rotulo: "Clientes" },
  { id: "avulso", rotulo: "Avulso" },
];

function duracaoTexto(seg: number) {
  const m = Math.round(seg / 60);
  if (m < 1) return "menos de 1 min";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Exemplo de como os intervalos saem sorteados, para a tela explicar o ritmo. */
function sortearExemplo(min: number, max: number, qtd = 6): number[] {
  const out = [0];
  for (let i = 1; i < qtd; i++) out.push(Math.max(PISO_S, Math.round(min + Math.random() * (max - min))));
  return out;
}

function telefoneTela(d: Destino) {
  if (d.ehGrupo) return "Grupo";
  if (!d.telefone) return "Sem telefone";
  return d.telefone.startsWith("55") ? formatBRPhone(d.telefone) : `+${d.telefone}`;
}

function avulsoParaDestino(a: Avulso): Destino {
  const nome = a.nome || "";
  return {
    chave: "tel:" + chaveTelefone(a.telefone),
    tipo: "avulso",
    conversationId: null,
    telefone: a.telefone,
    contactId: null,
    nomeContato: nome || "Sem nome",
    ehGrupo: false,
    nomeSugerido: sugerirNomeNaMensagem({ nomeContato: nome, ehGrupo: false }),
    clienteId: null,
    clienteNome: null,
    segmentoId: null,
    clienteCancelado: false,
  };
}

/** CSV com ; , ou TAB. O Excel brasileiro salva com ;. */
function linhasDoCsv(texto: string): string[][] {
  const linhas = texto.replace(/^\s+/, "").split(/\r?\n/).filter((l) => l.trim());
  const sep = [";", "\t", ","].find((s) => linhas[0]?.includes(s)) ?? ";";
  return linhas.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, "").trim()));
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
  const [origem, setOrigem] = useState<OrigemDestino>("clientes");
  const [soSelecionados, setSoSelecionados] = useState(false);
  const [busca, setBusca] = useState("");
  // Mesmos filtros da tela de Clientes (fonte única em src/lib/filtrosClientes.ts).
  const [filtrosCli, setFiltrosCli] = useState<FiltrosClientes>(FILTROS_CLIENTES_VAZIOS);
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  // Chave → destino. Guardar o destino (e não só a chave) é o que deixa a aba
  // "selecionados" listar gente de abas diferentes e os avulsos.
  const [marcados, setMarcados] = useState<Map<string, Destino>>(new Map());
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [avulsos, setAvulsos] = useState<Destino[]>([]);
  const [textoAvulso, setTextoAvulso] = useState("");
  const [recusados, setRecusados] = useState<string[]>([]);
  const [mensagem, setMensagem] = useState("Olá, {nome_cliente}!\n\n");
  const [pdf, setPdf] = useState<File | null>(null);
  const [ritmoId, setRitmoId] = useState<(typeof RITMOS)[number]["id"]>("padrao");
  const [custom, setCustom] = useState({ min: 0, max: 30 });
  const [quando, setQuando] = useState<"agora" | "agendar">("agora");
  const [agendarPara, setAgendarPara] = useState("");
  const [confirmo, setConfirmo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const textoRef = useRef<HTMLTextAreaElement>(null);

  // Número da API oficial da Meta fica de fora por enquanto: ela só aceita
  // template aprovado fora da janela de 24 h (próxima fase).
  const ativas = instances.filter((i: any) => i.is_active !== false && i.provider_type !== "meta_cloud");
  useEffect(() => {
    if (!instanceId && ativas.length) {
      const conectada = ativas.find((i: any) => i.status === "connected") || ativas[0];
      setInstanceId(conectada.id);
    }
  }, [ativas, instanceId]);

  const { grupos, contatos, clientes, carregandoGrupos, carregandoPessoas } = useDestinosLote(instanceId);
  const filtroCli = useIdsClientesFiltrados(filtrosCli);
  const qtdFiltrosCli = contarFiltrosAvancados(filtrosCli);
  const situacao = filtrosCli.status;

  // Trocar de número só tira os GRUPOS marcados: grupo de um número não recebe
  // pelo outro. Pessoas continuam: a conversa é achada ou criada no número novo.
  useEffect(() => {
    setMarcados((m) => {
      if (![...m.values()].some((d) => d.ehGrupo)) return m;
      return new Map([...m].filter(([, d]) => !d.ehGrupo));
    });
  }, [instanceId]);

  const porOrigem: Record<OrigemDestino, Destino[]> = useMemo(
    () => ({ grupos, contatos, clientes, avulso: avulsos }),
    [grupos, contatos, clientes, avulsos],
  );
  const carregando = origem === "grupos" ? carregandoGrupos : origem === "avulso" ? false : carregandoPessoas || (origem === "clientes" && filtroCli.carregando);

  const selecionados = useMemo(() => [...marcados.values()], [marcados]);
  const n = selecionados.length;

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qDig = q.replace(/\D/g, "");
    const base = soSelecionados ? selecionados : porOrigem[origem];
    return base.filter((d) => {
      if (q) {
        const casa =
          d.nomeContato.toLowerCase().includes(q) ||
          (d.clienteNome || "").toLowerCase().includes(q) ||
          (qDig.length >= 3 && (d.telefone || "").includes(qDig));
        if (!casa) return false;
      }
      if (soSelecionados || origem !== "clientes") return true;
      if (filtroCli.ids && (!d.clienteId || !filtroCli.ids.has(d.clienteId))) return false;
      if (situacao === "ativos" && d.clienteCancelado) return false;
      if (situacao === "cancelados" && !d.clienteCancelado) return false;
      return true;
    });
  }, [porOrigem, origem, busca, situacao, filtroCli.ids, soSelecionados, selecionados]);

  const podeMarcar = (d: Destino) => !!(d.conversationId || d.telefone);
  const marcaveis = visiveis.filter(podeMarcar);
  const todosVisiveis = marcaveis.length > 0 && marcaveis.every((d) => marcados.has(d.chave));

  const alternar = (lista: Destino[], marcar: boolean) => {
    setMarcados((m) => {
      const novo = new Map(m);
      lista.forEach((d) => (marcar ? novo.set(d.chave, d) : novo.delete(d.chave)));
      return novo;
    });
  };

  const nomeDe = (d: Destino) => nomes[d.chave] ?? d.nomeSugerido;

  const adicionarAvulsos = (lista: Avulso[], invalidos: string[]) => {
    const novos = lista.map(avulsoParaDestino);
    setAvulsos((atual) => {
      const ja = new Set(atual.map((d) => d.chave));
      return [...atual, ...novos.filter((d) => !ja.has(d.chave))];
    });
    alternar(novos, true);
    setRecusados(invalidos);
    if (novos.length) toast.success(`${novos.length} número(s) adicionado(s) e marcado(s).`);
    if (invalidos.length) toast.warning(`${invalidos.length} linha(s) com telefone inválido ficaram de fora.`);
    if (!novos.length && !invalidos.length) toast.error("Nenhum número encontrado.");
  };

  const importarArquivo = async (arquivo: File) => {
    try {
      let linhas: unknown[][];
      if (/\.csv$|\.txt$/i.test(arquivo.name)) {
        linhas = linhasDoCsv(await arquivo.text());
      } else {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await arquivo.arrayBuffer(), { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        linhas = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, raw: false }) as unknown[][];
      }
      const r = lerLinhas(linhas);
      adicionarAvulsos(r.validos, r.invalidos);
    } catch {
      toast.error("Não consegui ler o arquivo. Use Excel (.xlsx) ou CSV com as colunas nome e telefone.");
    }
  };

  const ritmo = ritmoId === "custom" ? custom : RITMOS.find((r) => r.id === ritmoId)!;
  const ritmoValido = ritmo.min >= 0 && ritmo.max >= 1 && ritmo.max <= 600 && ritmo.min <= ritmo.max;
  const mediaS = Math.max(PISO_S, (ritmo.min + ritmo.max) / 2);
  const duracaoSeg = Math.max(0, n - 1) * mediaS;
  const inicio = quando === "agendar" && agendarPara ? new Date(agendarPara) : new Date(Date.now() + FOLGA_INICIO_MS);
  const fim = addSeconds(inicio, duracaoSeg);
  const foraDoHorario = horario && (!dentroDoHorario(inicio, horario) || !dentroDoHorario(fim, horario));
  const proximoUtil = foraDoHorario ? proximoHorarioUtil(new Date(), horario) : null;
  const porMinuto = 60 / mediaS;
  const exemploRitmo = useMemo(() => sortearExemplo(ritmo.min, ritmo.max), [ritmo.min, ritmo.max]);

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
      const destinos: DestinoRpc[] = selecionados.map((d) =>
        d.ehGrupo && d.conversationId
          ? { conversation_id: d.conversationId, nome: nomeDe(d).trim() }
          : {
              telefone: d.telefone!,
              nome: nomeDe(d).trim(),
              nome_contato: d.nomeContato !== "Sem nome" ? d.nomeContato : undefined,
              cliente_id: d.clienteId,
            },
      );
      const r = await criar.mutateAsync({
        instanceId,
        conteudo: textoFinal,
        destinos,
        anexo,
        intervaloMin: ritmo.min,
        intervaloMax: ritmo.max,
        inicioEm: quando === "agendar" && agendarPara ? new Date(agendarPara) : new Date(Date.now() + FOLGA_INICIO_MS),
      });
      toast.success(`Envio criado para ${r.total} destinatários.`);
      if (r.ignorados?.length) {
        toast.warning(
          `${r.ignorados.length} ficaram de fora: ${r.ignorados.slice(0, 3).map((i) => `${i.nome || i.telefone} (${i.motivo})`).join(", ")}${r.ignorados.length > 3 ? "..." : ""}`,
          { duration: 10000 },
        );
      }
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
  const qtdGrupos = selecionados.filter((d) => d.ehGrupo).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">Novo envio</h2>
        <div className="flex gap-1">
          {passos.map((p, i) => {
            const k = (i + 1) as 1 | 2 | 3;
            const okDest = n > 0 && n <= MAX_DESTINOS;
            const liberado = k === 1 || (k === 2 && okDest) || (k === 3 && okDest && passa);
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
                <div className="inline-flex flex-wrap rounded-lg bg-muted p-1">
                  {ABAS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => { setOrigem(o.id); setSoSelecionados(false); setBusca(""); }}
                      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${!soSelecionados && origem === o.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                    >
                      {o.rotulo}
                      <span className="rounded-full bg-border px-1.5 text-[10px] tabular-nums text-foreground">{porOrigem[o.id].length}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="block text-xs">Conferir</Label>
                <button
                  type="button"
                  onClick={() => { setSoSelecionados((v) => !v); setBusca(""); }}
                  disabled={n === 0 && !soSelecionados}
                  className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${soSelecionados ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:bg-muted"}`}
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  {soSelecionados ? "Voltar para a lista" : "Ver só os selecionados"}
                  <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${soSelecionados ? "bg-primary-foreground/20" : "bg-primary/15 text-primary"}`}>{n}</span>
                </button>
              </div>
              {!soSelecionados && origem === "clientes" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="block text-xs">Situação</Label>
                    <Select value={filtrosCli.status} onValueChange={(v) => setFiltrosCli((f) => ({ ...f, status: v }))}>
                      <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ativos">Ativos</SelectItem>
                        <SelectItem value="cancelados">Cancelados</SelectItem>
                        <SelectItem value="todos">Todos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="block text-xs">Filtros</Label>
                    <Button variant="outline" className="h-9" onClick={() => setFiltrosAbertos((v) => !v)}>
                      <Filter className="mr-1.5 h-4 w-4" />
                      Filtros avançados
                      {qtdFiltrosCli > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums text-primary-foreground">{qtdFiltrosCli}</span>}
                      {filtrosAbertos ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
                    </Button>
                  </div>
                </>
              )}
              <div className="min-w-[180px] flex-1 space-y-1.5">
                <Label className="block text-xs" htmlFor="lote-busca">Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input id="lote-busca" className="h-9 pl-8" placeholder="Nome, cliente ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
              </div>
            </div>

            {!soSelecionados && origem === "clientes" && filtrosAbertos && (
              <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Os mesmos filtros da tela de Clientes. "Selecionar todos" marca só quem passou no filtro.</span>
                  {qtdFiltrosCli > 0 && (
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFiltrosCli((f) => ({ ...FILTROS_CLIENTES_VAZIOS, status: f.status }))}>
                      Limpar filtros
                    </Button>
                  )}
                </div>
                <FiltrosAvancadosClientesCampos
                  idPrefixo="lote"
                  filtros={filtrosCli}
                  onChange={(k, v) => setFiltrosCli((f) => ({ ...f, [k]: v, ...(k === "estadoId" ? { cidadeId: "" } : {}) }))}
                />
              </div>
            )}

            {!soSelecionados && origem === "avulso" && (
              <div className="grid gap-3 rounded-lg border border-border p-3 lg:grid-cols-[1fr_auto]">
                <div className="space-y-1.5">
                  <Label htmlFor="lote-avulso" className="text-xs">Digite ou cole os números, um por linha. O nome é opcional, antes do número.</Label>
                  <Textarea
                    id="lote-avulso"
                    rows={3}
                    value={textoAvulso}
                    onChange={(e) => setTextoAvulso(e.target.value)}
                    placeholder={"49 99911-2233\nMaria; 48 99123-4567"}
                  />
                  <Button
                    size="sm"
                    disabled={!textoAvulso.trim()}
                    onClick={() => { const r = lerTexto(textoAvulso); adicionarAvulsos(r.validos, r.invalidos); if (r.validos.length) setTextoAvulso(""); }}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
                  </Button>
                </div>
                <div className="flex flex-col justify-between gap-2 rounded-lg bg-muted/50 p-3 lg:w-72">
                  <div className="text-xs">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Importar Excel ou CSV</div>
                    A planilha precisa ter <b>só duas colunas: nome e telefone</b>. Com ou sem cabeçalho; telefone com ou sem DDD 55.
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      Escolher arquivo
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv,.txt"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importarArquivo(f); }}
                      />
                    </label>
                  </Button>
                </div>
                {recusados.length > 0 && (
                  <div className="text-xs text-amber-700 dark:text-amber-400 lg:col-span-2">
                    Ficaram de fora por telefone inválido: {recusados.slice(0, 8).join(" · ")}{recusados.length > 8 ? ` e mais ${recusados.length - 8}` : ""}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg bg-sky-500/10 px-3 py-2 text-xs">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-600" />
              <span>
                <b>Nome na mensagem</b> é o que entra no lugar de <code className="font-mono">{"{nome_cliente}"}</code>. Dá para editar, e o sistema lembra na próxima vez.
                {" "}Contatos, clientes e avulsos recebem por <b>qualquer número</b> que você escolher; grupos, só pelo número que está dentro do grupo.
              </span>
            </div>

            {n > MAX_DESTINOS && (
              <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-400">
                São {n} selecionados. O limite é {MAX_DESTINOS} por envio: divida em dois envios.
              </div>
            )}

            <div className="max-h-[calc(100vh-26rem)] min-h-[200px] overflow-auto rounded-lg border border-border">
              {ativas.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  Nenhum número disponível para envio em lote.
                </div>
              ) : carregando && !soSelecionados ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>
              ) : visiveis.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {soSelecionados
                    ? "Nenhum destinatário selecionado ainda."
                    : origem === "avulso"
                      ? "Digite os números acima ou importe uma planilha."
                      : origem === "grupos"
                        ? "Nenhum grupo neste número."
                        : "Nada encontrado."}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-muted text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <Checkbox
                          checked={todosVisiveis}
                          onCheckedChange={(v) => alternar(marcaveis, !!v)}
                          aria-label="Selecionar todos"
                        />
                      </th>
                      <th className="px-3 py-2 font-semibold">{soSelecionados ? "Destinatário" : origem === "grupos" ? "Grupo" : origem === "clientes" ? "Cliente · contato" : "Contato"}</th>
                      <th className="px-3 py-2 font-semibold">Telefone</th>
                      <th className="px-3 py-2 font-semibold">Nome na mensagem</th>
                      {(soSelecionados || origem === "avulso") && <th className="w-10 px-2 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.slice(0, LIMITE_LINHAS).map((d) => {
                      const ok = podeMarcar(d);
                      return (
                        <tr key={d.tipo + d.chave + (d.clienteId ?? "")} className={`border-t border-border ${ok ? "" : "opacity-50"}`}>
                          <td className="px-3 py-1.5">
                            <Checkbox
                              checked={marcados.has(d.chave)}
                              disabled={!ok}
                              onCheckedChange={(v) => alternar([d], !!v)}
                              aria-label={`Selecionar ${d.nomeContato}`}
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            {d.clienteNome && (soSelecionados || origem === "clientes") ? (
                              <>
                                {d.clienteNome}
                                {d.nomeContato !== d.clienteNome && <span className="ml-1 text-xs text-muted-foreground">· {d.nomeContato}</span>}
                              </>
                            ) : (
                              <>
                                {d.nomeContato}
                                {d.clienteNome && <span className="ml-1 text-xs text-muted-foreground">· {d.clienteNome}</span>}
                              </>
                            )}
                            {d.clienteCancelado && <span className="ml-1.5 rounded bg-red-500/10 px-1 text-[10px] font-semibold text-red-600">cancelado</span>}
                            {soSelecionados && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">{ABAS.find((a) => a.id === d.tipo)?.rotulo}</span>}
                          </td>
                          <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">{telefoneTela(d)}</td>
                          <td className="px-3 py-1.5">
                            <Input
                              className="h-8"
                              value={nomeDe(d)}
                              placeholder="cliente"
                              disabled={!ok}
                              onChange={(e) => setNomes((m) => ({ ...m, [d.chave]: e.target.value }))}
                              aria-label={`Nome na mensagem para ${d.nomeContato}`}
                            />
                          </td>
                          {(soSelecionados || origem === "avulso") && (
                            <td className="px-2 py-1.5">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title={soSelecionados ? "Tirar da seleção" : "Remover número"}
                                onClick={() => {
                                  alternar([d], false);
                                  if (!soSelecionados) setAvulsos((l) => l.filter((x) => x.chave !== d.chave));
                                }}
                              >
                                {soSelecionados ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {visiveis.length > LIMITE_LINHAS && (
                <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                  Mostrando {LIMITE_LINHAS} de {visiveis.length}. Use a busca para achar os outros. "Selecionar todos" marca os {marcaveis.length}.
                </div>
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
              <Resumo k="Destinatários" v={String(n)} s={`${qtdGrupos} grupos · ${n - qtdGrupos} pessoas`} />
              <Resumo k="Número" v={instancia?.display_name || instancia?.instance_name || ""} s={instancia?.status === "connected" ? "conectado" : "desconectado"} pequeno />
              <Resumo k="Anexo" v={pdf ? "1 PDF" : "Sem anexo"} s={pdf ? pdf.name : "só texto"} pequeno />
              <Resumo k="Duração estimada" v={duracaoTexto(duracaoSeg)} s={`de ${format(inicio, "dd/MM HH:mm")} até ~${format(fim, "HH:mm")}`} />
            </div>

            <div className="rounded-lg border border-border p-3.5">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <Shuffle className="h-4 w-4 text-primary" /> Envio aleatório: uma por vez, de {ritmo.min} a {ritmo.max} segundos entre uma e outra
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">cerca de {porMinuto.toFixed(1).replace(".", ",")} por minuto</span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">
                A ordem dos destinatários é sorteada e, a cada mensagem, o sistema sorteia quantos segundos esperar dentro dessa faixa.
                Nunca passa de {ritmo.max} s. Exemplo: {exemploRitmo.map((s, i) => (i === 0 ? "1ª agora" : `+${s} s`)).join(", ")}...
                {ritmo.min < PISO_S && ` Por segurança do número, nunca saem duas com menos de ${PISO_S} s entre elas.`}
              </p>
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
                      de <Input type="number" className="h-9 w-20" min={0} max={600} value={custom.min} onChange={(e) => setCustom((c) => ({ ...c, min: Number(e.target.value) }))} aria-label="Intervalo mínimo em segundos" />
                      a <Input type="number" className="h-9 w-20" min={1} max={600} value={custom.max} onChange={(e) => setCustom((c) => ({ ...c, max: Number(e.target.value) }))} aria-label="Intervalo máximo em segundos" />
                      segundos
                    </div>
                  )}
                  {!ritmoValido && <span className="text-xs text-red-600">Use de 0 a 600 segundos, o menor antes do maior.</span>}
                  {ritmoValido && ritmo.max < 10 && (
                    <span className="text-xs text-amber-600">Intervalos curtos aumentam o risco de o WhatsApp bloquear o número.</span>
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
        {passo === 1 && <Button disabled={n === 0 || n > MAX_DESTINOS} onClick={() => { setSoSelecionados(false); setPasso(2); }}>Continuar</Button>}
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
