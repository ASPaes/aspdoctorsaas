import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { FiltroMulti } from "./FiltroMulti";
import { useOpcoesFiltro } from "./useEmailsEnviados";
import {
  POR_PAGINA_RECEBIDOS, ROTULO_STATUS, nomeDoClienteRecebido, useEmailsRecebidos, useEstadoDaLeitura,
  useLerAgora, useLixeiraRecebidos, type FiltrosRecebidos,
} from "./useEmailsRecebidos";

const SITUACOES = [
  { id: "vinculado", label: "Vinculado" },
  { id: "remetente_diferente", label: "Remetente diferente" },
  { id: "avulso", label: "E-mail novo" },
];

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

  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosRecebidos>({
    busca: "",
    contas: [],
    situacoes: [],
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

  const { contas } = useOpcoesFiltro();
  const { data, isLoading, isFetching } = useEmailsRecebidos(filtros, pagina);
  const { data: caixasLendo = [] } = useEstadoDaLeitura();
  const lixeira = useLixeiraRecebidos();
  const lerAgora = useLerAgora();

  const linhas = data?.linhas ?? [];
  const total = data?.total ?? 0;
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA_RECEBIDOS) - 1);

  useEffect(() => setSelecionados([]), [filtros, pagina]);

  const selecionaveis = useMemo(() => linhas.filter((l) => !l.referencia_id).map((l) => l.id), [linhas]);
  const travados = selecionados.filter((id) => !selecionaveis.includes(id)).length;

  const mudarFiltro = (parcial: Partial<FiltrosRecebidos>) => {
    setFiltros((f) => ({ ...f, ...parcial }));
    setPagina(0);
  };

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
        const registradas = (r.resultados ?? []).reduce((s, x) => s + x.registradas, 0);
        const comErro = (r.resultados ?? []).filter((x) => x.erro);
        if (comErro.length) {
          toast.error(`Erro em ${comErro.length} caixa${comErro.length === 1 ? "" : "s"}: ${comErro[0].erro}`, { duration: 12000 });
          return;
        }
        toast.success(
          registradas ? `${registradas} mensagem${registradas === 1 ? "" : "s"} registrada${registradas === 1 ? "" : "s"}.` : "Nada novo nas caixas.",
        );
      },
      onError: (err: any) => toast.error(err?.message || "Não foi possível ler as caixas agora."),
    });
  };

  // sem nenhuma caixa ligada, a tela explica o que fazer em vez de ficar vazia
  if (!isLoading && caixasLendo.length === 0 && total === 0 && !filtros.lixeira) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 rounded-lg border border-dashed px-6 py-10 text-center">
        <Inbox className="mx-auto h-6 w-6 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Nenhuma caixa está sendo lida</p>
          <p className="text-sm text-muted-foreground">
            Para as respostas dos clientes aparecerem aqui, ligue a leitura numa conta em Configurações › Atendimento ›
            Canais › E-mail, na aba Cadastros. Sugestão: comece só pelo Suporte.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          A leitura nunca marca nada como lido na caixa, e só registra resposta a e-mail que saiu daqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={buscaDigitada}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            placeholder="Buscar por assunto, remetente, cliente ou texto da mensagem"
            className="h-9 pl-9"
          />
        </div>
        <FiltroMulti
          rotulo="Caixa"
          icone={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
          opcoes={contas.map((c) => ({ id: c.id, label: c.rotulo, detalhe: c.email }))}
          value={filtros.contas}
          onChange={(v) => mudarFiltro({ contas: v })}
        />
        <FiltroMulti
          rotulo="Situação"
          opcoes={SITUACOES}
          value={filtros.situacoes}
          onChange={(v) => mudarFiltro({ situacoes: v })}
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
            {filtros.lixeira ? "A lixeira está vazia" : "Nenhuma resposta no período"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            Quando um cliente responder a um e-mail enviado daqui, a mensagem aparece nesta lista ligada ao atendimento
            que deu origem.
          </p>
        </div>
      ) : (
        <div className={cn("rounded-lg border", isFetching && "opacity-70")}>
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
                <TableHead className="w-[110px]">Data e hora</TableHead>
                <TableHead>Assunto</TableHead>
                <TableHead className="w-[190px]">De</TableHead>
                <TableHead className="w-[160px]">Cliente</TableHead>
                <TableHead className="w-[170px]">Em resposta a</TableHead>
                <TableHead className="w-[150px]">Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha) => {
                const { data: dia, hora } = dataHora(linha.recebido_em);
                const ligado = !!linha.referencia_id;
                const cliente = nomeDoClienteRecebido(linha);
                const situacao = ROTULO_STATUS[linha.status] ?? { texto: linha.status, ajuda: "" };
                return (
                  <TableRow key={linha.id} className={cn(selecionados.includes(linha.id) && "bg-accent/10")}>
                    {ehAdmin && (
                      <TableCell>
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
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {dia}
                      <span className="block text-muted-foreground">{hora}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{linha.assunto || "(sem assunto)"}</span>
                      {linha.corpo_texto && (
                        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                          {linha.corpo_texto.replace(/\s+/g, " ").slice(0, 120)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="truncate">
                      <span className="block truncate font-mono text-xs">{linha.de_email}</span>
                      {linha.de_nome && <span className="block truncate text-[11px] text-muted-foreground">{linha.de_nome}</span>}
                    </TableCell>
                    <TableCell className="truncate text-sm">
                      {cliente ?? <span className="text-xs text-muted-foreground">não confere com a ficha</span>}
                    </TableCell>
                    <TableCell className="truncate text-xs">
                      {linha.email_envios ? (
                        <>
                          <span className="block truncate">{linha.email_envios.assunto}</span>
                          <span className="block text-muted-foreground">
                            {new Date(linha.email_envios.created_at).toLocaleDateString("pt-BR")}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">não é resposta</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              variant={linha.status === "remetente_diferente" ? "outline" : "secondary"}
                              className={cn(
                                "font-normal",
                                linha.status === "vinculado" && "bg-success/15 text-success hover:bg-success/15",
                                linha.status === "remetente_diferente" && "border-warning/50 text-warning",
                              )}
                            >
                              {situacao.texto}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">{situacao.ajuda}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
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
              A resposta do cliente sai do sistema e não tem como voltar. Quem está ligado a atendimento ou ticket
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
