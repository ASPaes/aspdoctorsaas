import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addSeconds, format } from "date-fns";
import {
  BookmarkPlus, CalendarClock, Check, CheckCheck, ChevronDown, ChevronUp, Clock, Filter, FlaskConical, Repeat, Save, Zap, FileSpreadsheet, FileText, Info, Loader2, Paperclip, Plus, Search, Send, Shuffle, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useWhatsAppInstances } from "@/components/whatsapp/hooks/useWhatsAppInstances";
import { useBusinessHoursConfig } from "@/components/whatsapp/hooks/useBusinessHoursConfig";
import { dentroDoHorario, proximoHorarioUtil } from "@/lib/businessHours";
import { formatBRPhone } from "@/lib/phoneBR";
import { contarFiltrosAvancados, FILTROS_CLIENTES_VAZIOS, type FiltrosClientes } from "@/lib/filtrosClientes";
import { FiltrosAvancadosClientesCampos } from "@/components/clientes/FiltrosAvancadosClientes";
import { aplicarTudo, sugerirNomeNaMensagem } from "./nomeNaMensagem";
import { chaveTelefone, lerLinhas, lerTexto, type Avulso } from "./destinosAvulsos";
import {
  RITMO_PADRAO, subirPdfDoLote, useCriarEnvioLote, useDestinosLote, useIdsClientesFiltrados,
  type Destino, type DestinoRpc, type OrigemDestino,
} from "./useEnvioLote";
import { AbaGruposEnvio, SalvarGrupoDialog, destinoParaMembro } from "./AbaGruposEnvio";
import { MensagemTemplate, paramsParaRpc, type EscolhaTemplate } from "./MensagemTemplate";
import { RegraRepeticao, REGRA_PADRAO, regraValida } from "./RegraRepeticao";
import {
  useGruposEnvio, useMensagensProntas, useSalvarGrupo, useSalvarMensagemPronta, useSalvarRecorrencia,
  type MembroParaSalvar, type MensagemPronta, type RegraRecorrencia,
} from "./useEnvioLoteExtras";

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

type AbaId = OrigemDestino | "listas";

const ABAS: { id: AbaId; rotulo: string }[] = [
  { id: "listas", rotulo: "Grupos de envio" },
  { id: "grupos", rotulo: "Grupos do WhatsApp" },
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
    vars: a.vars ?? null,
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
  /** Recorrência salva: a página abre a aba de recorrentes. */
  onRecorrenciaCriada?: (id: string) => void;
}

export function NovoEnvioLote({ mudaRitmo, onCriado, onRecorrenciaCriada }: Props) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { instances = [] } = useWhatsAppInstances();
  const horario = useBusinessHoursConfig();
  const criar = useCriarEnvioLote();

  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [origem, setOrigem] = useState<AbaId>("clientes");
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
  const [quando, setQuando] = useState<"agora" | "agendar" | "repetir">("agora");
  const [agendarPara, setAgendarPara] = useState("");
  const [confirmo, setConfirmo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // F3: de qual grupo de envio veio a seleção (e quem estava nele).
  const [grupoUsado, setGrupoUsado] = useState<{ id: string; nome: string; chaves: Set<string> } | null>(null);
  const [salvarGrupo, setSalvarGrupo] = useState<"selecao" | "filtro" | null>(null);
  // F2: template do número oficial.
  const [escolhaTpl, setEscolhaTpl] = useState<EscolhaTemplate>({ templateId: null, valores: [] });
  const [tpl, setTpl] = useState<{ ok: boolean; componentes: unknown; corpo: string }>({ ok: false, componentes: null, corpo: "" });
  // F4: mensagem pronta e repetição.
  const [anexoSalvo, setAnexoSalvo] = useState<{ storagePath: string; mime: string; nome: string; tamanho: number } | null>(null);
  const [salvarModelo, setSalvarModelo] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [regra, setRegra] = useState<RegraRecorrencia>(REGRA_PADRAO);
  // F5: teste e rotação entre números.
  const [telTeste, setTelTeste] = useState(() => { try { return localStorage.getItem("envio-lote-tel-teste") || ""; } catch { return ""; } });
  const [testando, setTestando] = useState(false);
  const [rotacao, setRotacao] = useState<string[]>([]);
  const { data: gruposEnvio = [] } = useGruposEnvio();
  const { data: modelos = [] } = useMensagensProntas();
  const salvarGrupoMut = useSalvarGrupo();
  const salvarModeloMut = useSalvarMensagemPronta();
  const salvarRecorrencia = useSalvarRecorrencia();
  const textoRef = useRef<HTMLTextAreaElement>(null);

  // Número oficial da Meta entra, mas só com template (passo 2) e sem grupo.
  const ativas = instances.filter((i: any) => i.is_active !== false);
  const instancia = ativas.find((i: any) => i.id === instanceId) as any;
  const ehMeta = instancia?.provider_type === "meta_cloud";
  // Rotação só entre números do mesmo tipo (texto livre) e conectados.
  const paraRotacao = ativas.filter((i: any) => i.id !== instanceId && i.provider_type !== "meta_cloud" && i.status === "connected");
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

  useEffect(() => {
    setRotacao([]);
    if (ehMeta && origem === "grupos") setOrigem("clientes");
  }, [instanceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const porOrigem: Record<AbaId, Destino[]> = useMemo(
    () => ({ grupos, contatos, clientes, avulso: avulsos, listas: [] }),
    [grupos, contatos, clientes, avulsos],
  );
  const carregando = origem === "grupos" ? carregandoGrupos : origem === "avulso" || origem === "listas" ? false : carregandoPessoas || (origem === "clientes" && filtroCli.carregando);

  const selecionados = useMemo(() => [...marcados.values()], [marcados]);
  const n = selecionados.length;
  // Variáveis que os marcados trazem (colunas da planilha ou do grupo).
  const variaveis = useMemo(() => {
    const k = new Set<string>();
    selecionados.forEach((d) => Object.keys(d.vars || {}).forEach((x) => k.add(x)));
    return [...k].sort();
  }, [selecionados]);
  const grupoIntacto = !!grupoUsado && grupoUsado.chaves.size === n && selecionados.every((d) => grupoUsado.chaves.has(d.chave));

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
      if (r.variaveis.length) {
        toast.info(`Colunas que viraram variáveis da mensagem: ${r.variaveis.map((v) => `{${v}}`).join(", ")}`, { duration: 8000 });
      }
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
  const temPdf = !!pdf || !!anexoSalvo;
  const nomePdf = pdf?.name || anexoSalvo?.nome || "";
  const passa = ehMeta
    ? tpl.ok
    : temPdf ? textoFinal.length <= 1000 : textoFinal.length > 0 && textoFinal.length <= 4000;
  const onTplValido = useCallback((ok: boolean, componentes: unknown, corpo: string) => setTpl({ ok, componentes, corpo }), []);

  const inserir = (token: string) => {
    const ta = textoRef.current;
    const pos = ta?.selectionStart ?? mensagem.length;
    const fimSel = ta?.selectionEnd ?? pos;
    setMensagem(mensagem.slice(0, pos) + token + mensagem.slice(fimSel));
    requestAnimationFrame(() => {
      ta?.focus();
      const p = pos + token.length;
      ta?.setSelectionRange(p, p);
    });
  };

  const usarModelo = (m: MensagemPronta) => {
    if (m.template_id) {
      if (!ehMeta) return toast.error("Essa mensagem pronta é um template: escolha um número oficial da Meta.");
      const vals = Array.isArray(m.template_params) ? m.template_params : Object.values(m.template_params || {});
      setEscolhaTpl({ templateId: m.template_id, valores: vals as string[] });
    } else {
      if (ehMeta) return toast.error("Número oficial só envia template. Escolha uma mensagem pronta de template ou outro número.");
      setMensagem(m.content);
      setPdf(null);
      setAnexoSalvo(m.storage_path
        ? { storagePath: m.storage_path, mime: m.media_mimetype || "application/pdf", nome: m.media_file_name || "anexo.pdf", tamanho: m.media_size_bytes || 0 }
        : null);
    }
    if (!titulo) setTitulo(m.titulo);
    toast.success(`Mensagem "${m.titulo}" carregada.`);
  };

  /** Anexo pronto para a RPC: sobe o PDF novo uma vez só e reaproveita. */
  const anexoAtual = async () => {
    if (pdf && tid) {
      const a = await subirPdfDoLote(tid, pdf);
      setPdf(null);
      setAnexoSalvo(a);
      return a;
    }
    return anexoSalvo;
  };

  const destinoRpc = (d: Destino): DestinoRpc =>
    d.ehGrupo && d.conversationId
      ? { conversation_id: d.conversationId, nome: nomeDe(d).trim() }
      : {
          telefone: d.telefone!,
          nome: nomeDe(d).trim(),
          nome_contato: d.nomeContato !== "Sem nome" ? d.nomeContato : undefined,
          cliente_id: d.clienteId,
          vars: d.vars ?? null,
        };

  const conteudoDoEnvio = () => ({
    conteudo: ehMeta ? "" : textoFinal,
    templateId: ehMeta ? escolhaTpl.templateId : null,
    templateParams: ehMeta ? paramsParaRpc(tpl.componentes, escolhaTpl.valores) : null,
  });

  const enviarTeste = async () => {
    if (!instanceId) return;
    setTestando(true);
    try {
      try { localStorage.setItem("envio-lote-tel-teste", telTeste); } catch { /* sem storage */ }
      const anexo = ehMeta ? null : await anexoAtual();
      const ex = selecionados.find((d) => !d.ehGrupo) || selecionados[0];
      const nomeEx = ex ? nomeDe(ex) : "Teste";
      const r = await criar.mutateAsync({
        instanceId,
        ...conteudoDoEnvio(),
        destinos: [{ telefone: telTeste, nome: nomeEx, vars: ex?.vars ?? null }],
        anexo,
        intervaloMin: 5,
        intervaloMax: 30,
        inicioEm: null,
        titulo: titulo.trim() || null,
        teste: true,
      });
      if (r.ignorados?.length) toast.warning(`O teste não saiu: ${r.ignorados[0].motivo}.`);
      else toast.success(`Teste agendado: chega em até 1 minuto, com o nome e as variáveis de "${nomeEx}".`);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível enviar o teste.");
    } finally {
      setTestando(false);
    }
  };

  const disparar = async () => {
    if (!tid || !instanceId) return;
    setEnviando(true);
    try {
      const anexo = ehMeta ? null : await anexoAtual();

      // F4: repetir = guarda o grupo, a mensagem pronta e a regra. O primeiro
      // envio sai na próxima data da regra (pelo cron), não agora.
      if (quando === "repetir") {
        const nomeRec = titulo.trim();
        let listId = grupoIntacto ? grupoUsado!.id : null;
        if (!listId) {
          const membros = selecionados.map((d) => destinoParaMembro(d, nomeDe(d))).filter(Boolean) as MembroParaSalvar[];
          listId = await salvarGrupoMut.mutateAsync({ nome: `${nomeRec} (recorrente)`, tipo: "fixa", membros });
        }
        const c = conteudoDoEnvio();
        const modelId = await salvarModeloMut.mutateAsync({
          titulo: `${nomeRec} (recorrente)`, content: c.conteudo, anexo,
          templateId: c.templateId, templateParams: c.templateParams,
        });
        const rec = await salvarRecorrencia.mutateAsync({
          titulo: nomeRec, instanceId, listId, modelId, regra, intervaloMin: ritmo.min, intervaloMax: ritmo.max,
        });
        toast.success(`Envio recorrente salvo. O primeiro sai em ${format(new Date(rec.proxima_em), "dd/MM/yyyy 'às' HH:mm")}.`);
        onRecorrenciaCriada?.(rec.id);
        return;
      }

      // F5: divisão entre números. Grupos do WhatsApp ficam no número
      // escolhido; as pessoas se revezam entre os números, uma para cada.
      const numeros = [instanceId, ...rotacao];
      const partes = new Map<string, Destino[]>(numeros.map((id) => [id, []]));
      let k = 0;
      for (const d of selecionados) {
        if (d.ehGrupo) { partes.get(instanceId)!.push(d); continue; }
        partes.get(numeros[k % numeros.length])!.push(d);
        k++;
      }
      const inicioEm = quando === "agendar" && agendarPara ? new Date(agendarPara) : new Date(Date.now() + FOLGA_INICIO_MS);
      const ids: string[] = [];
      const ignorados: { telefone: string; nome: string | null; motivo: string }[] = [];
      let total = 0;
      for (const [inst, lista] of partes) {
        if (!lista.length) continue;
        const r = await criar.mutateAsync({
          instanceId: inst,
          ...conteudoDoEnvio(),
          destinos: lista.map(destinoRpc),
          anexo,
          intervaloMin: ritmo.min,
          intervaloMax: ritmo.max,
          inicioEm,
          titulo: titulo.trim() || null,
          listId: grupoUsado?.id ?? null,
        });
        ids.push(r.bulk_send_id);
        total += r.total;
        ignorados.push(...(r.ignorados || []));
      }
      toast.success(ids.length > 1
        ? `Envio criado para ${total} destinatários, dividido em ${ids.length} números.`
        : `Envio criado para ${total} destinatários.`);
      if (ignorados.length) {
        toast.warning(
          `${ignorados.length} ficaram de fora: ${ignorados.slice(0, 3).map((i) => `${i.nome || i.telefone} (${i.motivo})`).join(", ")}${ignorados.length > 3 ? "..." : ""}`,
          { duration: 10000 },
        );
      }
      onCriado(ids[0]);
    } catch (e: any) {
      toast.error(e?.message || "Não foi possível criar o envio.");
    } finally {
      setEnviando(false);
    }
  };

  // Prévia: de preferência alguém que tenha as colunas da planilha.
  const exemplo = selecionados.find((d) => d.vars && Object.keys(d.vars).length > 0)
    || selecionados.find((d) => !d.ehGrupo) || selecionados[0] || visiveis[0];
  const qtdListas = gruposEnvio.length;
  // Variável usada no texto que parte dos marcados não tem: sai vazia para eles.
  const textoComVars = ehMeta ? escolhaTpl.valores.join(" ") : mensagem;
  const semVariavel = variaveis
    .filter((v) => textoComVars.includes(`{${v}}`))
    .map((v) => ({ v, n: selecionados.filter((d) => !(d.vars && d.vars[v])).length }))
    .filter((x) => x.n > 0);

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
                        {i.display_name || i.instance_name}{i.provider_type === "meta_cloud" ? " · oficial Meta" : ""}{i.status !== "connected" ? " (desconectado)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="block text-xs">Destinatários</Label>
                <div className="inline-flex flex-wrap rounded-lg bg-muted p-1">
                  {ABAS.map((o) => {
                    const bloqueada = o.id === "grupos" && ehMeta;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        disabled={bloqueada}
                        title={bloqueada ? "A API oficial da Meta não envia para grupo do WhatsApp" : undefined}
                        onClick={() => { setOrigem(o.id); setSoSelecionados(false); setBusca(""); }}
                        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${!soSelecionados && origem === o.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
                      >
                        {o.rotulo}
                        <span className="rounded-full bg-border px-1.5 text-[10px] tabular-nums text-foreground">
                          {o.id === "listas" ? qtdListas : porOrigem[o.id].length}
                        </span>
                      </button>
                    );
                  })}
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
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>Os mesmos filtros da tela de Clientes. "Selecionar todos" marca só quem passou no filtro.</span>
                  <div className="flex items-center gap-1">
                    {qtdFiltrosCli > 0 && (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSalvarGrupo("filtro")}>
                          <Zap className="mr-1 h-3.5 w-3.5" /> Salvar como grupo automático
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFiltrosCli((f) => ({ ...FILTROS_CLIENTES_VAZIOS, status: f.status }))}>
                          Limpar filtros
                        </Button>
                      </>
                    )}
                  </div>
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
                    A planilha precisa das colunas <b>nome e telefone</b>, com ou sem cabeçalho; telefone com ou sem 55.
                    Com cabeçalho, cada coluna a mais vira variável: <span className="font-mono">Vencimento</span> vira <span className="font-mono">{"{vencimento}"}</span>.
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
              {!soSelecionados && origem === "listas" ? (
                <AbaGruposEnvio
                  instanceId={instanceId}
                  ehMeta={ehMeta}
                  selecionados={selecionados}
                  nomeDe={nomeDe}
                  onUsar={(lista, g) => {
                    alternar(lista, true);
                    setNomes((m) => {
                      const novo = { ...m };
                      lista.forEach((d) => { if (!(d.chave in novo)) novo[d.chave] = d.nomeSugerido; });
                      return novo;
                    });
                    setGrupoUsado({ id: g.id, nome: g.nome, chaves: new Set(lista.map((d) => d.chave)) });
                  }}
                />
              ) : ativas.length === 0 ? (
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
                            {d.vars && Object.keys(d.vars).length > 0 && (
                              <span className="ml-1.5 rounded bg-sky-500/10 px-1 text-[10px] text-sky-700 dark:text-sky-300" title={Object.entries(d.vars).map(([k, v]) => `${k}: ${v}`).join("\n")}>
                                {Object.keys(d.vars).length} variáveis
                              </span>
                            )}
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
          <div className="space-y-3">
            {semVariavel.length > 0 && (
              <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {semVariavel.map((x) => `${x.n} dos ${n} marcados não têm {${x.v}}`).join("; ")}.
                {ehMeta ? " Para eles a variável vai como \"-\"." : " Para eles esse trecho sai vazio."} Confira a frase ou tire essas pessoas da seleção.
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <span className="text-xs font-semibold">Mensagens prontas</span>
              <Select value="" onValueChange={(id) => { const m = modelos.find((x) => x.id === id); if (m) usarModelo(m); }}>
                <SelectTrigger className="h-8 w-64"><SelectValue placeholder={modelos.length ? "Usar uma mensagem pronta..." : "Nenhuma salva ainda"} /></SelectTrigger>
                <SelectContent>
                  {modelos.map((m) => (
                    <SelectItem key={m.id} value={m.id} disabled={!!m.template_id !== ehMeta}>
                      {m.titulo}{m.template_id ? " · template" : m.storage_path ? " · com PDF" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-8" disabled={!passa} onClick={() => setSalvarModelo(true)}>
                <Save className="mr-1 h-3.5 w-3.5" /> Salvar esta como pronta
              </Button>
            </div>

            {ehMeta && instanceId ? (
              <MensagemTemplate
                instanceId={instanceId}
                valor={escolhaTpl}
                onChange={setEscolhaTpl}
                variaveis={variaveis}
                exemplo={exemplo ? { nome: nomeDe(exemplo), vars: exemplo.vars } : null}
                onValido={onTplValido}
              />
            ) : (
          <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-2">
              <Label htmlFor="lote-msg" className="text-xs">Mensagem</Label>
              <Textarea id="lote-msg" ref={textoRef} rows={9} value={mensagem} onChange={(e) => setMensagem(e.target.value)} />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">Inserir:</span>
                  {["nome_cliente", ...variaveis].map((v) => (
                    <button key={v} type="button" onClick={() => inserir(`{${v}}`)} className="rounded-md border border-dashed border-sky-500 bg-sky-500/10 px-2 py-0.5 font-mono text-sky-700 dark:text-sky-300">
                      {`{${v}}`}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => inserir("{Olá|Oi|Bom dia}")}
                    title="Cada destinatário recebe uma das opções, sorteada. Deixa as mensagens menos iguais e protege o número."
                    className="rounded-md border border-dashed border-violet-500 bg-violet-500/10 px-2 py-0.5 font-mono text-violet-700 dark:text-violet-300"
                  >
                    {"{Olá|Oi|Bom dia}"}
                  </button>
                </div>
                <span className={`tabular-nums ${passa ? "text-muted-foreground" : "text-red-600"}`}>
                  {textoFinal.length} / {temPdf ? "1.000 (com PDF vai como legenda)" : "4.000"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                <b>Variação:</b> escreva opções entre chaves separadas por barra, como <span className="font-mono">{"{Olá|Oi}"}</span>, e cada pessoa recebe uma delas.
              </p>
              <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
                {temPdf ? (
                  <>
                    <div className="grid h-9 w-8 place-items-center rounded bg-red-500/15 text-[10px] font-bold text-red-600">PDF</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{nomePdf}</div>
                      <div className="text-xs text-muted-foreground">
                        {pdf ? `${(pdf.size / 1024).toFixed(0)} KB · ` : "da mensagem pronta · "}o mesmo arquivo para todos
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => { setPdf(null); setAnexoSalvo(null); }}><X className="mr-1 h-3.5 w-3.5" />Remover</Button>
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
                            setAnexoSalvo(null);
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
                  {temPdf && (
                    <div className="mb-1.5 flex items-center gap-2 rounded-md bg-black/5 p-2">
                      <FileText className="h-5 w-5 text-red-600" />
                      <span className="truncate text-xs font-semibold">{nomePdf}</span>
                    </div>
                  )}
                  {aplicarTudo(mensagem, exemplo ? nomeDe(exemplo) : "cliente", exemplo?.vars, false) || <span className="opacity-50">Sua mensagem aparece aqui</span>}
                  <span className="absolute bottom-0.5 right-2 text-[10px] opacity-60">{format(new Date(), "HH:mm")}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Cada destinatário recebe o próprio nome e as próprias variáveis. Na variação, a prévia mostra a primeira opção.</p>
            </div>
          </div>
            )}
          </div>
        )}

        {passo === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Resumo k="Destinatários" v={String(n)} s={`${qtdGrupos} grupos · ${n - qtdGrupos} pessoas`} />
              <Resumo k="Número" v={instancia?.display_name || instancia?.instance_name || ""} s={instancia?.status === "connected" ? "conectado" : "desconectado"} pequeno />
              <Resumo
                k="Mensagem"
                v={ehMeta ? "Template" : temPdf ? "Texto + PDF" : "Texto"}
                s={ehMeta ? "aprovado pela Meta" : temPdf ? nomePdf : `${textoFinal.length} caracteres`}
                pequeno
              />
              <Resumo
                k="Duração estimada"
                v={duracaoTexto(duracaoSeg / (1 + rotacao.length))}
                s={quando === "repetir" ? "a cada repetição" : `de ${format(inicio, "dd/MM HH:mm")} até ~${format(addSeconds(inicio, duracaoSeg / (1 + rotacao.length)), "HH:mm")}`}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lote-titulo" className="text-xs">Nome do envio {quando === "repetir" ? "(obrigatório)" : "(opcional, aparece na lista)"}</Label>
              <Input id="lote-titulo" className="h-9 max-w-md" maxLength={80} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Lembrete de vencimento" />
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

            {paraRotacao.length > 0 && quando !== "repetir" && (
              <div className="rounded-lg border border-border p-3.5">
                <div className="mb-1 text-sm font-semibold">Dividir entre números</div>
                <p className="mb-2 text-xs text-muted-foreground">
                  As pessoas se revezam entre os números marcados: menos mensagens por número, menos risco de bloqueio e o envio termina antes.
                  Grupos do WhatsApp continuam saindo pelo número deles.
                </p>
                <div className="flex flex-wrap gap-3">
                  {paraRotacao.map((i: any) => (
                    <label key={i.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={rotacao.includes(i.id)}
                        onCheckedChange={(v) => setRotacao((r) => (v ? [...r, i.id] : r.filter((x) => x !== i.id)))}
                      />
                      {i.display_name || i.instance_name}
                    </label>
                  ))}
                </div>
              </div>
            )}

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
              <label className="flex items-center gap-2">
                <input type="radio" name="lote-quando" checked={quando === "repetir"} onChange={() => setQuando("repetir")} className="accent-primary" />
                <Repeat className="h-3.5 w-3.5" /> Repetir sempre
              </label>
            </div>

            {quando === "repetir" && (
              <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3.5">
                <RegraRepeticao regra={regra} onChange={setRegra} />
                <p className="text-xs text-muted-foreground">
                  {grupoIntacto
                    ? <>Usa o grupo <b>{grupoUsado!.nome}</b>: quem entrar ou sair dele depois passa a valer nas próximas repetições.</>
                    : <>Os {n} marcados viram o grupo <b>{titulo.trim() || "..."} (recorrente)</b>, que dá para editar depois.</>}
                  {" "}A mensagem vira uma mensagem pronta com o mesmo nome. O primeiro envio sai na próxima data da regra.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="lote-teste" className="flex items-center gap-1.5 text-xs"><FlaskConical className="h-3.5 w-3.5" /> Enviar um teste antes</Label>
                <Input id="lote-teste" className="h-9 w-56" placeholder="Seu WhatsApp, com DDD" value={telTeste} onChange={(e) => setTelTeste(e.target.value)} />
              </div>
              <Button variant="outline" className="h-9" disabled={testando || telTeste.replace(/\D/g, "").length < 10 || !passa} onClick={enviarTeste}>
                {testando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />} Enviar teste
              </Button>
              <span className="text-xs text-muted-foreground">Chega exatamente como o primeiro destinatário vai receber, com o nome e as variáveis dele.</span>
            </div>

            {foraDoHorario && quando !== "repetir" && (
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
                {quando === "repetir" ? (
                  <>Confirmo o envio <b>recorrente</b> para os destinatários do grupo pelo número <b>{instancia?.display_name || instancia?.instance_name}</b>. Dá para pausar ou apagar na aba Recorrentes.</>
                ) : (
                  <>
                    Confirmo o envio para <b>{n} destinatários</b> pelo número <b>{instancia?.display_name || instancia?.instance_name}</b>
                    {rotacao.length > 0 && <> e mais {rotacao.length} número(s)</>}.
                    Depois de começar, só dá para cancelar o que ainda não saiu. Quem pediu para sair da lista fica de fora sozinho.
                  </>
                )}
              </span>
            </label>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
        {passo === 1 ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              <b className="text-foreground">{n}</b> selecionados
              {grupoUsado && <span className="ml-1 text-xs">(do grupo {grupoUsado.nome}{grupoIntacto ? "" : ", alterado"})</span>}
            </span>
            <Button
              variant="outline" size="sm" className="h-8" disabled={n === 0}
              title="Opcional: guarda estes marcados para usar de novo sem escolher um a um. Fica na aba Grupos de envio."
              onClick={() => setSalvarGrupo("selecao")}
            >
              <BookmarkPlus className="mr-1 h-3.5 w-3.5" /> Salvar como grupo <span className="ml-1 font-normal text-muted-foreground">(opcional)</span>
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => { setPasso((passo - 1) as 1 | 2); setConfirmo(false); }}>Voltar</Button>
        )}
        {passo === 1 && <Button disabled={n === 0 || n > MAX_DESTINOS} onClick={() => { setSoSelecionados(false); setPasso(2); }}>Continuar</Button>}
        {passo === 2 && <Button disabled={!passa} onClick={() => setPasso(3)}>Revisar</Button>}
        {passo === 3 && (
          <Button
            disabled={
              !confirmo || !ritmoValido || enviando
              || (quando === "agendar" && !agendarPara)
              || (quando === "repetir" && (!titulo.trim() || !regraValida(regra)))
            }
            onClick={disparar}
          >
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : quando === "repetir" ? <Repeat className="mr-1.5 h-4 w-4" /> : <Send className="mr-1.5 h-4 w-4" />}
            {quando === "repetir" ? "Salvar envio recorrente" : quando === "agendar" ? `Agendar para ${n}` : `Disparar para ${n}`}
          </Button>
        )}
      </div>

      <SalvarGrupoDialog
        aberto={!!salvarGrupo}
        onFechar={() => setSalvarGrupo(null)}
        selecionados={selecionados}
        nomeDe={nomeDe}
        filtros={salvarGrupo === "filtro" ? filtrosCli : null}
        onSalvo={(id, nome) => {
          if (salvarGrupo === "selecao") setGrupoUsado({ id, nome, chaves: new Set(selecionados.map((d) => d.chave)) });
        }}
      />

      <SalvarModeloDialog
        aberto={salvarModelo}
        onFechar={() => setSalvarModelo(false)}
        tituloInicial={titulo}
        onSalvar={async (t) => {
          const anexo = ehMeta ? null : await anexoAtual();
          const c = conteudoDoEnvio();
          await salvarModeloMut.mutateAsync({ titulo: t, content: c.conteudo, anexo, templateId: c.templateId, templateParams: c.templateParams });
          toast.success(`Mensagem pronta "${t}" salva.`);
        }}
      />
    </div>
  );
}

function SalvarModeloDialog({ aberto, onFechar, tituloInicial, onSalvar }: {
  aberto: boolean;
  onFechar: () => void;
  tituloInicial: string;
  onSalvar: (titulo: string) => Promise<void>;
}) {
  const [t, setT] = useState(tituloInicial);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (aberto) setT(tituloInicial); }, [aberto, tituloInicial]);
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Salvar como mensagem pronta</DialogTitle>
          <DialogDescription>Guarda o texto (ou o template) e o PDF para usar de novo em outro envio ou num envio recorrente.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="modelo-titulo" className="text-xs">Nome</Label>
          <Input id="modelo-titulo" value={t} onChange={(e) => setT(e.target.value)} maxLength={80} placeholder="Ex.: Lembrete de vencimento" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            disabled={!t.trim() || salvando}
            onClick={async () => {
              setSalvando(true);
              try { await onSalvar(t.trim()); onFechar(); }
              catch (e: any) { toast.error(e?.message || "Não consegui salvar."); }
              finally { setSalvando(false); }
            }}
          >
            {salvando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
