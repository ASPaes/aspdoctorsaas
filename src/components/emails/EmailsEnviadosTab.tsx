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
import { LerEmailDialog } from "./LerEmailDialog";
import { EmailsAgendadosBloco } from "./EmailsAgendadosBloco";
import { useArquivarEmails } from "./useArquivarEmails";
import { MenuPastas, MoverParaPasta } from "./MenuPastas";
import { useMoverParaPasta } from "./usePastasEmail";
import {
  Archive, ArchiveRestore, Building2, CheckCircle2, ChevronLeft, ChevronRight, Eye, FolderInput, Lock, Mail, RotateCcw,
  Search, Send, Trash2, XCircle,
} from "lucide-react";
import { subDays } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { FiltroMulti } from "./FiltroMulti";
import {
  POR_PAGINA, ROTULO_ORIGEM, nomeDoCliente, useEmailsEnviados, useLixeiraEnviados, useOpcoesFiltro,
  type FiltrosEnviados,
} from "./useEmailsEnviados";

const ORIGENS = [
  { id: "chat_close", label: "Chat" },
  { id: "ticket", label: "Ticket de atendimento" },
  { id: "onboarding", label: "Ticket de onboarding" },
  { id: "teste", label: "Teste" },
  { id: "manual", label: "Manual" },
  { id: "ticket_email", label: "Aviso de ticket aberto" },
];

const SITUACOES = [
  { id: "enviado", label: "Enviado" },
  { id: "erro", label: "Recusado" },
];

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return {
    data: d.toLocaleDateString("pt-BR"),
    hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
  };
};

export default function EmailsEnviadosTab() {
  const { profile } = useAuth();
  const podeExcluir = profile?.role === "admin" || profile?.is_super_admin === true;

  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [filtros, setFiltros] = useState<FiltrosEnviados>({
    busca: "",
    setores: [],
    origens: [],
    contas: [],
    situacoes: [],
    periodo: { from: subDays(new Date(), 30), to: new Date() },
    lixeira: false,
    arquivadas: false,
    pasta: null,
  });
  const [pagina, setPagina] = useState(0);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  /** id do e-mail aberto para leitura */
  const [lendo, setLendo] = useState<string | null>(null);

  // a busca espera a digitação parar, para não consultar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.busca === buscaDigitada ? f : { ...f, busca: buscaDigitada }));
      setPagina(0);
    }, 400);
    return () => clearTimeout(t);
  }, [buscaDigitada]);

  const { contas, setores } = useOpcoesFiltro();
  const { data, isLoading } = useEmailsEnviados(filtros, pagina);
  const lixeira = useLixeiraEnviados();
  const arquivar = useArquivarEmails("enviados");
  const mover = useMoverParaPasta("enviados");

  /** move um ou vários para a pasta; null tira da pasta */
  const moverEmails = (ids: string[], pastaId: string | null) => {
    mover.mutate(
      { ids, pastaId },
      {
        onSuccess: ({ afetados, bloqueados }) => {
          toast.success(
            `${afetados} e-mail${afetados === 1 ? "" : "s"} ${pastaId ? "movido" : "tirado"}${afetados === 1 ? "" : "s"} da pasta.`.replace(
              "movidos da pasta",
              "movidos",
            ),
            { description: bloqueados ? `${bloqueados} ficou de fora: é de outra pessoa ou já estava assim.` : undefined },
          );
          setSelecionados([]);
        },
        onError: (err: any) => toast.error(err?.message || "Não foi possível mover."),
      },
    );
  };

  /** arquiva ou devolve para a lista; `bloqueados` vira aviso, não silêncio */
  const arquivarEmails = (ids: string[], paraArquivo: boolean) => {
    arquivar.mutate(
      { ids, arquivar: paraArquivo },
      {
        onSuccess: ({ afetados, bloqueados }) => {
          toast.success(
            `${afetados} e-mail${afetados === 1 ? "" : "s"} ${paraArquivo ? "arquivado" : "devolvido para a lista"}${afetados === 1 ? "" : "s"}.`,
            {
              description: bloqueados ? `${bloqueados} ficou de fora: é de outra pessoa ou já estava assim.` : undefined,
            },
          );
          setSelecionados([]);
        },
        onError: (err: any) => toast.error(err?.message || "Não foi possível arquivar."),
      },
    );
  };

  const linhas = data?.linhas ?? [];
  const total = data?.total ?? 0;
  const ultimaPagina = Math.max(0, Math.ceil(total / POR_PAGINA) - 1);

  useEffect(() => setSelecionados([]), [filtros, pagina]);

  const selecionaveis = useMemo(() => linhas.filter((l) => !l.referencia_id).map((l) => l.id), [linhas]);
  const travados = selecionados.filter((id) => !selecionaveis.includes(id)).length;

  const mudarFiltro = (parcial: Partial<FiltrosEnviados>) => {
    setFiltros((f) => ({ ...f, ...parcial }));
    setPagina(0);
  };

  const executar = (acao: "lixeira" | "restaurar" | "excluir") => {
    lixeira.mutate(
      { ids: selecionados, acao },
      {
        onSuccess: ({ afetados, bloqueados }) => {
          const feito =
            acao === "lixeira" ? "movido para a lixeira" : acao === "restaurar" ? "restaurado" : "excluído de vez";
          toast.success(`${afetados} e-mail${afetados === 1 ? "" : "s"} ${feito}.`, {
            description: bloqueados
              ? `${bloqueados} ficou de fora por estar ligado a um atendimento ou ticket.`
              : undefined,
            duration: bloqueados ? 9000 : 4000,
          });
          setSelecionados([]);
          setConfirmarExclusao(false);
        },
        onError: (err: any) => toast.error(err?.message || "Não foi possível concluir a ação."),
      },
    );
  };

  return (
    <div className="space-y-3">
      {/* busca e filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={buscaDigitada}
            onChange={(e) => setBuscaDigitada(e.target.value)}
            placeholder="Buscar por assunto, cliente, destinatário ou número do ticket"
            className="h-9 pl-9"
          />
        </div>
        <FiltroMulti
          rotulo="Setor"
          icone={<Building2 className="h-3.5 w-3.5 text-muted-foreground" />}
          opcoes={setores.map((s) => ({ id: s.id, label: s.name }))}
          value={filtros.setores}
          onChange={(v) => mudarFiltro({ setores: v })}
        />
        <FiltroMulti
          rotulo="Origem"
          opcoes={ORIGENS}
          value={filtros.origens}
          onChange={(v) => mudarFiltro({ origens: v })}
        />
        <FiltroMulti
          rotulo="Conta"
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
        <DateRangePicker
          dateRange={filtros.periodo}
          onDateRangeChange={(r) => mudarFiltro({ periodo: r })}
          align="end"
        />
        <MenuPastas
          pastaAtual={filtros.pasta}
          onEscolher={(pastaId) => {
            mudarFiltro({ pasta: pastaId });
            setPagina(0);
          }}
        />
        <Button
          variant={filtros.arquivadas ? "default" : "outline"}
          size="sm"
          className="h-9"
          onClick={() => {
            mudarFiltro({ arquivadas: !filtros.arquivadas, lixeira: false });
            setPagina(0);
          }}
        >
          <Archive className="mr-2 h-4 w-4" />
          Arquivadas
        </Button>
        {podeExcluir && (
          <Button
            variant={filtros.lixeira ? "default" : "outline"}
            size="sm"
            className="h-9"
            onClick={() => mudarFiltro({ lixeira: !filtros.lixeira })}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Lixeira
          </Button>
        )}
      </div>

      {/* ações da seleção */}
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
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => arquivarEmails(selecionados, !filtros.arquivadas)}
                disabled={arquivar.isPending}
              >
                {filtros.arquivadas ? (
                  <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
                ) : (
                  <Archive className="mr-1.5 h-3.5 w-3.5" />
                )}
                {filtros.arquivadas ? "Tirar do arquivo" : "Arquivar"}
              </Button>
              <MoverParaPasta pastaAtual={null} onMover={(pastaId) => moverEmails(selecionados, pastaId)} desabilitado={mover.isPending}>
                <Button size="sm" variant="outline" className="h-7" disabled={mover.isPending}>
                  <FolderInput className="mr-1.5 h-3.5 w-3.5" />
                  Mover para
                </Button>
              </MoverParaPasta>
              <Button size="sm" variant="outline" className="h-7" onClick={() => executar("lixeira")} disabled={lixeira.isPending}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Mover para a lixeira
              </Button>
            </>
          )}
          {travados > 0 && (
            <span className="text-xs text-muted-foreground">
              {travados} está ligado a atendimento ou ticket e não sai da lista
            </span>
          )}
        </div>
      )}

      {/* agendados: só na lista principal, fora da lixeira e das arquivadas */}
      {!filtros.lixeira && !filtros.arquivadas && !filtros.pasta && <EmailsAgendadosBloco />}

      {/* tabela */}
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : linhas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-center">
          <Send className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {filtros.lixeira ? "A lixeira está vazia" : "Nenhum e-mail enviado no período"}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {filtros.lixeira
              ? "E-mails movidos para a lixeira aparecem aqui e podem voltar para a lista."
              : "Quando a operação enviar e-mail ao cliente, cada envio aparece aqui com a origem e a situação."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                {podeExcluir && (
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
                <TableHead className="w-[190px]">Remetente</TableHead>
                <TableHead className="w-[170px]">Cliente</TableHead>
                <TableHead className="w-[120px]">Origem</TableHead>
                <TableHead className="w-[130px]">Setor</TableHead>
                <TableHead className="w-[120px]">Pasta</TableHead>
                <TableHead className="w-[110px]">Situação</TableHead>
                <TableHead className="w-[92px] text-right">Abrir</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((linha) => {
                const { data: dia, hora } = dataHora(linha.created_at);
                const ligado = !!linha.referencia_id;
                const cliente = nomeDoCliente(linha);
                return (
                  <TableRow key={linha.id} className={cn(selecionados.includes(linha.id) && "bg-accent/10")}>
                    {podeExcluir && (
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
                            aria-label={`Selecionar ${linha.assunto}`}
                          />
                        )}
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {dia}
                      <span className="block text-muted-foreground">{hora}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{linha.assunto}</span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                        para {linha.para.join(", ")}
                      </span>
                    </TableCell>
                    <TableCell className="truncate font-mono text-xs">{linha.remetente}</TableCell>
                    <TableCell className="truncate text-sm">
                      {cliente ?? <span className="text-xs text-muted-foreground">sem cliente</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal">
                        {ROTULO_ORIGEM[linha.origem] ?? linha.origem}
                      </Badge>
                    </TableCell>
                    <TableCell className="truncate text-sm">
                      {linha.support_departments?.name ?? <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="truncate">
                      {linha.email_pastas ? (
                        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]">
                          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: linha.email_pastas.cor }} aria-hidden />
                          <span className="truncate">{linha.email_pastas.nome}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">sem pasta</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {linha.status === "enviado" ? (
                        <Badge className="gap-1 bg-success/15 font-normal text-success hover:bg-success/15">
                          <CheckCircle2 className="h-3 w-3" />
                          Enviado
                        </Badge>
                      ) : (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="destructive" className="gap-1 font-normal">
                                <XCircle className="h-3 w-3" />
                                Recusado
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm text-xs">
                              {(linha.erro ?? "").split(" [")[0] || "Sem detalhe"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setLendo(linha.id)}
                          aria-label={`Abrir ${linha.assunto}`}
                          title="Abrir o e-mail"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {!filtros.lixeira && (
                          <MoverParaPasta
                            pastaAtual={linha.pasta_id}
                            onMover={(pastaId) => moverEmails([linha.id], pastaId)}
                            desabilitado={mover.isPending}
                          >
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Mover para pasta" aria-label="Mover para pasta">
                              <FolderInput className="h-3.5 w-3.5" />
                            </Button>
                          </MoverParaPasta>
                        )}
                        {!filtros.lixeira && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => arquivarEmails([linha.id], !linha.arquivado_em)}
                            disabled={arquivar.isPending}
                            aria-label={linha.arquivado_em ? `Tirar do arquivo ${linha.assunto}` : `Arquivar ${linha.assunto}`}
                            title={linha.arquivado_em ? "Tirar do arquivo" : "Arquivar"}
                          >
                            {linha.arquivado_em ? (
                              <ArchiveRestore className="h-3.5 w-3.5" />
                            ) : (
                              <Archive className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <LerEmailDialog tipo="enviado" id={lendo} onOpenChange={(aberto) => !aberto && setLendo(null)} />

      {/* paginação */}
      {total > POR_PAGINA && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {pagina * POR_PAGINA + 1} a {Math.min((pagina + 1) * POR_PAGINA, total)} de {total}
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
            <AlertDialogTitle>Excluir de vez {selecionados.length} e-mail{selecionados.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              O registro sai do sistema e não tem como voltar. Quem está ligado a atendimento ou ticket continua
              protegido e não será excluído.
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
