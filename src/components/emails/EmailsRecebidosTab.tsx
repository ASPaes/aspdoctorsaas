import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import {
  ChevronLeft, ChevronRight, Inbox, Loader2, Lock, Mail, RefreshCw, RotateCcw, Search, Trash2,
} from "lucide-react";
import { subDays } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ClienteSearchSelect, type SelectedCliente } from "@/components/whatsapp/contatos/ClienteSearchSelect";
import { FiltroMulti } from "./FiltroMulti";
import { useOpcoesFiltro } from "./useEmailsEnviados";
import {
  OPCOES_ACAO, POR_PAGINA_RECEBIDOS, ROTULO_ACAO, nomeDoClienteRecebido, useContagemRecebidos, useEmailsRecebidos,
  useEstadoDaLeitura, useLerAgora, useLixeiraRecebidos, useResolverTriagem,
  type EmailRecebido, type FiltrosRecebidos, type TomAcao,
} from "./useEmailsRecebidos";

const TOM: Record<TomAcao, string> = {
  ok: "bg-success/15 text-success",
  info: "bg-accent/15 text-accent",
  warn: "bg-warning/15 text-warning",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  plain: "bg-muted text-muted-foreground",
  erro: "bg-destructive/10 text-destructive",
};

const ROTULO_STATUS: Record<string, string> = {
  vinculado: "respondeu a e-mail enviado daqui",
  remetente_diferente: "veio de outro endereço, não entrou no ticket",
  avulso: "e-mail novo de cliente cadastrado",
  desconhecido: "remetente não identificado",
};

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return {
    data: d.toLocaleDateString("pt-BR"),
    hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
};

export default function EmailsRecebidosTab() {
  const { profile } = useAuth();
  const ehAdmin = profile?.role === "admin" || profile?.is_super_admin === true;
  const podeTriar = ehAdmin || profile?.role === "head";

  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosRecebidos>({
    busca: "",
    contas: [],
    acoes: [],
    setor: null,
    periodo: { from: subDays(new Date(), 30), to: new Date() },
    lixeira: false,
  });
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.busca === buscaDigitada ? f : { ...f, busca: buscaDigitada }));
      setPagina(0);
    }, 400);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  const { contas, setores } = useOpcoesFiltro();
  const { data, isLoading } = useEmailsRecebidos(filtros, pagina);
  const { data: contagem } = useContagemRecebidos(filtros.periodo, filtros.lixeira);
  const { data: caixasLendo = [] } = useEstadoDaLeitura();
  const lixeira = useLixeiraRecebidos();
  const lerAgora = useLerAgora();

  const linhas = data?.linhas ?? [];
  const total = data?.total ?? 0;
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA_RECEBIDOS) - 1);

  useEffect(() => setSelecionados([]), [filtros, pagina]);

  const selecionaveis = useMemo(() => linhas.filter((l) => !l.referencia_id).map((l) => l.id), [linhas]);
  const travados = selecionados.filter((id) => !selecionaveis.includes(id)).length;

  // aba Geral + os setores que têm e-mail no período (e o selecionado, mesmo zerado)
  const abasSetor = useMemo(() => {
    const porSetor = contagem?.porSetor ?? {};
    return setores.filter((s) => (porSetor[s.id] ?? 0) > 0 || s.id === filtros.setor);
  }, [setores, contagem, filtros.setor]);

  const mudarFiltro = (parcial: Partial<FiltrosRecebidos>) => {
    setFiltros((f) => ({ ...f, ...parcial }));
    setPagina(0);
  };

  const soTriagem = filtros.acoes.length === 1 && filtros.acoes[0] === "triagem";

  const executar = (acao: "lixeira" | "restaurar" | "excluir") => {
    lixeira.mutate(
      { ids: selecionados, acao },
      {
        onSuccess: ({ afetados, bloqueados }) => {
          const feito = acao === "lixeira" ? "movido para a lixeira" : acao === "restaurar" ? "restaurado" : "excluído de vez";
          toast.success(`${afetados} e-mail${afetados === 1 ? "" : "s"} ${feito}.`, {
            description: bloqueados ? `${bloqueados} ficou de fora por estar ligado a um atendimento ou ticket.` : undefined,
          });
          setSelecionados([]);
          setConfirmarExclusao(false);
        },
        onError: (err: any) => toast.error(err?.message || "Não foi possível concluir a ação."),
      },
    );
  };

  const lerCaixasAgora = () => {
    lerAgora.mutate(undefined, {
      onSuccess: (r) => {
        if (!r.caixas) {
          toast.info(r.mensagem || "Nenhuma caixa com leitura ligada.", {
            description: "Ligue a leitura numa conta em Configurações › Atendimento › Canais › E-mail.",
            duration: 9000,
          });
          return;
        }
        const resultados = r.resultados ?? [];
        const comErro = resultados.filter((x) => x.erro);
        if (comErro.length) {
          toast.error(`Erro em ${comErro.length} caixa${comErro.length === 1 ? "" : "s"}: ${comErro[0].erro}`, { duration: 12000 });
          return;
        }
        const registradas = resultados.reduce((s, x) => s + x.registradas, 0);
        const lidas = resultados.reduce((s, x) => s + x.lidas, 0);
        const tickets = r.tickets_abertos ?? 0;
        const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
        if (registradas) {
          toast.success(`${plural(registradas, "mensagem registrada", "mensagens registradas")}.`, {
            description: [
              tickets ? plural(tickets, "ticket aberto", "tickets abertos") : null,
              lidas > registradas
                ? `${plural(lidas - registradas, "outra mensagem foi ignorada", "outras mensagens foram ignoradas")} por não ser de cliente`
                : null,
            ].filter(Boolean).join(" · ") || undefined,
          });
        } else if (lidas) {
          toast.info(`${plural(lidas, "mensagem nova lida", "mensagens novas lidas")}, nenhuma registrada.`, {
            description: "Só entra aqui resposta a e-mail enviado pelo DoctorSaaS ou e-mail para um endereço que abre ticket.",
            duration: 9000,
          });
        } else if (resultados.some((x) => x.ocupada)) {
          toast.info("A leitura automática está rodando agora. Em instantes a lista se atualiza.");
        } else {
          toast.info("Nenhuma mensagem nova nas caixas desde a última leitura.");
        }
      },
      onError: (err: any) => toast.error(err?.message || "Não foi possível ler as caixas agora."),
    });
  };

  // sem nenhuma caixa ligada, a tela explica o que fazer em vez de ficar vazia
  if (!isLoading && caixasLendo.length === 0 && total === 0 && !filtros.lixeira && !filtros.setor && !filtros.acoes.length) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-dashed px-6 py-10 text-center">
        <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Nenhuma caixa está sendo lida</p>
          <p className="text-sm text-muted-foreground">
            Para as mensagens dos clientes aparecerem aqui, ligue a leitura numa conta em Configurações › Atendimento ›
            Canais › E-mail: em Cadastros, para registrar respostas, ou em Parâmetros de Recebidos, para e-mail novo
            virar ticket.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">A leitura nunca marca nada como lido na caixa.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-auto flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Setor">
          <AbaSetor ativa={!filtros.setor} onClick={() => mudarFiltro({ setor: null })} rotulo="Geral" contagem={contagem?.total} />
          {abasSetor.map((s) => (
            <AbaSetor
              key={s.id}
              ativa={filtros.setor === s.id}
              onClick={() => mudarFiltro({ setor: s.id })}
              rotulo={s.name}
              contagem={contagem?.porSetor[s.id] ?? 0}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="busca-recebidos"
            value={buscaDigitada}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            placeholder="Buscar por assunto, remetente, cliente ou texto da mensagem"
            className="h-9 pl-9"
          />
        </div>
        {(contagem?.triagem ?? 0) > 0 || soTriagem ? (
          <button
            type="button"
            onClick={() => mudarFiltro({ acoes: soTriagem ? [] : ["triagem"] })}
            className={cn(
              "flex h-9 items-center gap-2 rounded-md border px-3 text-sm",
              soTriagem ? "border-warning bg-warning/10" : "border-input bg-background",
            )}
            aria-pressed={soTriagem}
          >
            Triagem
            <span className="rounded-full bg-warning px-1.5 text-[11px] font-semibold text-white tabular-nums">
              {contagem?.triagem ?? 0}
            </span>
          </button>
        ) : null}
        <FiltroMulti
          rotulo="Caixa"
          icone={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
          opcoes={contas.map((c) => ({ id: c.id, label: c.rotulo, detalhe: c.email }))}
          value={filtros.contas}
          onChange={(v) => mudarFiltro({ contas: v })}
        />
        <FiltroMulti
          rotulo="O que aconteceu"
          opcoes={OPCOES_ACAO}
          value={filtros.acoes}
          onChange={(v) => mudarFiltro({ acoes: v })}
        />
        <DateRangePicker dateRange={filtros.periodo} onDateRangeChange={(r) => mudarFiltro({ periodo: r })} align="end" />
        {ehAdmin && (
          <>
            <Button variant="outline" size="sm" className="h-9" onClick={lerCaixasAgora} disabled={lerAgora.isPending}>
              {lerAgora.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Ler agora
            </Button>
            <Button
              variant={filtros.lixeira ? "default" : "outline"}
              size="sm"
              className="h-9"
              onClick={() => mudarFiltro({ lixeira: !filtros.lixeira })}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Lixeira
            </Button>
          </>
        )}
      </div>

      {caixasLendo.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Lendo {caixasLendo.length} caixa{caixasLendo.length === 1 ? "" : "s"}:{" "}
          {caixasLendo.map((c: any) => c.rotulo).join(", ")}
          {caixasLendo.some((c: any) => c.ultimo_erro) && (
            <span className="ml-1 text-destructive">
              · erro na última leitura: {caixasLendo.find((c: any) => c.ultimo_erro)?.ultimo_erro}
            </span>
          )}
        </p>
      )}

      {selecionados.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-accent bg-accent/10 px-3 py-2 text-sm">
          <strong>{selecionados.length} selecionado{selecionados.length === 1 ? "" : "s"}</strong>
          {filtros.lixeira ? (
            <>
              <Button size="sm" variant="outline" className="h-7" onClick={() => executar("restaurar")} disabled={lixeira.isPending}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Restaurar
              </Button>
              <Button size="sm" variant="destructive" className="h-7" onClick={() => setConfirmarExclusao(true)} disabled={lixeira.isPending}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Excluir de vez
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7" onClick={() => executar("lixeira")} disabled={lixeira.isPending}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Mover para a lixeira
            </Button>
          )}
          {travados > 0 && (
            <span className="text-xs text-muted-foreground">
              {travados} está ligado a atendimento ou ticket e não sai da lista
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : linhas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center">
          <Inbox className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {filtros.lixeira ? "A lixeira está vazia" : soTriagem ? "Nada esperando na triagem" : "Nenhuma mensagem no período"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            Quando um cliente responder a um e-mail enviado daqui, ou escrever para um endereço que abre ticket, a
            mensagem aparece nesta lista.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {ehAdmin && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selecionados.length > 0 && selecionados.length === selecionaveis.length}
                      onCheckedChange={(v) => setSelecionados(v ? selecionaveis : [])}
                      aria-label="Selecionar todos os que podem ser excluídos"
                    />
                  </TableHead>
                )}
                <TableHead className="w-[100px]">Data e hora</TableHead>
                <TableHead className="min-w-[260px]">Assunto</TableHead>
                <TableHead className="w-[190px]">De</TableHead>
                <TableHead className="w-[160px]">Cliente</TableHead>
                <TableHead className="w-[130px]">Setor</TableHead>
                <TableHead className="w-[190px]">O que aconteceu</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha) => {
                const { data: dia, hora } = dataHora(linha.recebido_em);
                const ligado = !!linha.referencia_id;
                const cliente = nomeDoClienteRecebido(linha);
                const naTriagem = linha.acao === "triagem" && !filtros.lixeira;
                return (
                  <TableRow
                    key={linha.id}
                    className={cn(selecionados.includes(linha.id) && "bg-accent/10", naTriagem && "bg-warning/5")}
                  >
                    {ehAdmin && (
                      <TableCell className="align-top">
                        {ligado ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex h-4 w-4 items-center justify-center">
                                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">
                                Ligado a um atendimento ou ticket, não pode ser excluído
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <Checkbox
                            checked={selecionados.includes(linha.id)}
                            onCheckedChange={(v) =>
                              setSelecionados((s) => (v ? [...s, linha.id] : s.filter((i) => i !== linha.id)))
                            }
                            aria-label={`Selecionar mensagem de ${linha.de_email}`}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap align-top font-mono text-xs">
                      {dia}
                      <span className="block text-muted-foreground">{hora}</span>
                    </TableCell>
                    <TableCell className="align-top">
                      <span className="font-medium">{linha.assunto || "(sem assunto)"}</span>
                      {linha.corpo_texto && (
                        <span className="mt-0.5 block max-w-[420px] truncate text-[11.5px] text-muted-foreground">
                          {linha.corpo_texto.replace(/\s+/g, " ").slice(0, 140)}
                        </span>
                      )}
                      {naTriagem && podeTriar && <CaixaTriagem linha={linha} setores={setores} />}
                    </TableCell>
                    <TableCell className="max-w-[190px] align-top">
                      <span className="block truncate font-mono text-xs">{linha.de_email}</span>
                      {linha.de_nome && <span className="block truncate text-[11px] text-muted-foreground">{linha.de_nome}</span>}
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate align-top text-sm">
                      {cliente ?? <span className="text-xs text-muted-foreground">não identificado</span>}
                    </TableCell>
                    <TableCell className="max-w-[130px] truncate align-top text-sm">
                      {linha.support_departments?.name ?? <span className="text-xs text-muted-foreground">sem setor</span>}
                    </TableCell>
                    <TableCell className="align-top">
                      <OQueAconteceu linha={linha} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {total > POR_PAGINA_RECEBIDOS && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {pagina * POR_PAGINA_RECEBIDOS + 1} a {Math.min((pagina + 1) * POR_PAGINA_RECEBIDOS, total)} de {total}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={pagina >= ultimaPagina} onClick={() => setPagina((p) => p + 1)}>
              Próxima
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={confirmarExclusao} onOpenChange={setConfirmarExclusao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir de vez {selecionados.length} mensagem{selecionados.length === 1 ? "" : "ns"}?</AlertDialogTitle>
            <AlertDialogDescription>
              A mensagem do cliente sai do sistema e não tem como voltar. Quem está ligado a atendimento ou ticket
              continua protegido e não será excluído.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => executar("excluir")}
            >
              Excluir de vez
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AbaSetor({ ativa, onClick, rotulo, contagem }: { ativa: boolean; onClick: () => void; rotulo: string; contagem?: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ativa ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {rotulo}
      {typeof contagem === "number" && <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">{contagem}</span>}
    </button>
  );
}

function OQueAconteceu({ linha }: { linha: EmailRecebido }) {
  const acao = linha.acao ?? "registrado";
  const rotulo = ROTULO_ACAO[acao];
  const codigo = linha.support_tickets?.ticket_code;

  let detalhe: React.ReactNode = null;
  if ((acao === "ticket_aberto" || acao === "resposta_ticket" || acao === "ticket_reaberto") && linha.ticket_id) {
    detalhe = (
      <Link to={`/tickets?ticket=${linha.ticket_id}`} className="font-mono text-xs text-accent hover:underline">
        {codigo ?? "abrir ticket"}
      </Link>
    );
  } else if (acao === "jornada") {
    detalhe = <span className="text-xs text-muted-foreground">entrou na jornada do cliente</span>;
  } else if (acao === "registrado") {
    detalhe = (
      <span className="text-xs text-muted-foreground">
        {linha.email_envios ? `em resposta a “${linha.email_envios.assunto}”` : ROTULO_STATUS[linha.status] ?? null}
      </span>
    );
  }

  return (
    <div className="grid justify-items-start gap-1">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", TOM[rotulo.tom])}>{rotulo.texto}</span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{rotulo.ajuda}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {detalhe}
      {linha.acao_detalhe && acao !== "registrado" && (
        <span className="text-[11px] leading-snug text-muted-foreground">{linha.acao_detalhe}</span>
      )}
    </div>
  );
}

function CaixaTriagem({ linha, setores }: { linha: EmailRecebido; setores: { id: string; name: string }[] }) {
  const [cliente, setCliente] = useState<SelectedCliente | null>(null);
  const [setor, setSetor] = useState<string | undefined>(linha.department_id ?? undefined);
  const resolver = useResolverTriagem();

  const abrir = () => {
    if (!cliente) {
      toast.error("Escolha o cliente antes de abrir o ticket.");
      return;
    }
    if (!setor) {
      toast.error("Escolha o setor do ticket.");
      return;
    }
    resolver.mutate(
      { id: linha.id, acao: "abrir_ticket", clienteId: cliente.id, setorId: setor },
      {
        onSuccess: (r) =>
          toast.success(`Ticket ${r.ticket_code ?? ""} aberto para ${cliente.label}.`, {
            description: "O aviso de abertura sai para o cliente na próxima leitura, se estiver ligado.",
          }),
        onError: (err: any) => toast.error(err?.message || "Não foi possível abrir o ticket."),
      },
    );
  };

  const ignorar = () =>
    resolver.mutate(
      { id: linha.id, acao: "ignorar" },
      {
        onSuccess: () => toast.success("E-mail ignorado. Ele continua visível pelo filtro O que aconteceu."),
        onError: (err: any) => toast.error(err?.message || "Não foi possível ignorar."),
      },
    );

  return (
    <div className="mt-2 grid gap-2 rounded-md border bg-card p-2.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_auto]">
      <div className="min-w-0">
        <ClienteSearchSelect value={cliente} onChange={setCliente} placeholder="Buscar cliente por nome, CNPJ ou código" inputId={`triagem-cliente-${linha.id}`} />
      </div>
      <Select value={setor} onValueChange={setSetor}>
        <SelectTrigger className="h-9" aria-label="Setor do ticket">
          <SelectValue placeholder="Setor" />
        </SelectTrigger>
        <SelectContent>
          {setores.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button size="sm" className="h-9" onClick={abrir} disabled={resolver.isPending}>
          {resolver.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Abrir ticket"}
        </Button>
        <Button size="sm" variant="outline" className="h-9" onClick={ignorar} disabled={resolver.isPending}>
          Ignorar
        </Button>
      </div>
    </div>
  );
}
