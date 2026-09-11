import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowRight, CheckCircle2, Info, LifeBuoy, Loader2, Mail, MoreVertical, Pencil, Plug, Plus, Send, Star, Trash2, Wand2, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { SECURITY_LABELS, providerByValue, type EmailSecurity } from "./emailProviders";
import { EmailAccountDialog } from "./EmailAccountDialog";
import { GuiaProvedor } from "./GuiaProvedor";
import { ProviderLogo } from "./ProviderLogo";
import { EnviarTesteDialog, montarEmailDeTeste } from "./EnviarTesteDialog";
import { diagnosticar, servidoresRecomendados } from "./emailDiagnostico";
import { useEmailAccounts, type EmailAccount } from "./useEmailAccounts";

/** o técnico do erro fica entre colchetes no fim; a tela só mostra a frase */
const motivoDoErro = (erro: string | null) => (erro ?? "").split(" [")[0];
const tecnicoDoErro = (erro: string | null) => {
  const e = erro ?? "";
  const i = e.indexOf(" [");
  return i >= 0 ? e.slice(i + 2, e.endsWith("]") ? -1 : undefined) : "";
};

const servidor = (host: string | null, port: number | null, sec: EmailSecurity | null) =>
  host ? `${host}:${port ?? ""} · ${sec ? SECURITY_LABELS[sec] : ""}` : "sem recebimento";

/** selo de teste: nunca testada, testada quando, ou falhou */
function SeloTeste({ conta, testando }: { conta: EmailAccount; testando: boolean }) {
  if (testando) {
    return (
      <Badge variant="outline" className="gap-1 font-normal">
        <Loader2 className="h-3 w-3 animate-spin" />
        Testando
      </Badge>
    );
  }
  if (!conta.last_test_at) {
    return <Badge variant="outline" className="font-normal text-muted-foreground">Nunca testada</Badge>;
  }
  const quando = formatDistanceToNow(new Date(conta.last_test_at), { addSuffix: true, locale: ptBR });
  const titulo = new Date(conta.last_test_at).toLocaleString("pt-BR");
  return conta.last_test_ok ? (
    <Badge title={titulo} className="gap-1 bg-success/15 font-normal text-success hover:bg-success/15">
      <CheckCircle2 className="h-3 w-3" />
      Testada {quando}
    </Badge>
  ) : (
    <Badge title={titulo} variant="destructive" className="gap-1 font-normal">
      <XCircle className="h-3 w-3" />
      Teste falhou {quando}
    </Badge>
  );
}

export default function EmailAccountsTab() {
  const { accounts, isLoading, setores, saveAccount, deleteAccount, updateFlags, testAccount, sendEmail } = useEmailAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editando, setEditando] = useState<EmailAccount | null>(null);
  const [excluindo, setExcluindo] = useState<EmailAccount | null>(null);
  const [testandoId, setTestandoId] = useState<string | null>(null);
  const [resolvendoId, setResolvendoId] = useState<string | null>(null);
  const [corrigindo, setCorrigindo] = useState(false);
  const [enviandoTeste, setEnviandoTeste] = useState<EmailAccount | null>(null);

  const setorPorId = useMemo(
    () => new Map(setores.map((s) => [s.id, s.name])),
    [setores],
  );

  // sempre a versão mais nova da conta, para o painel refletir o último teste
  const resolvendo = resolvendoId ? accounts.find((c) => c.id === resolvendoId) ?? null : null;

  const abrirNova = () => {
    setEditando(null);
    setDialogOpen(true);
  };

  const abrirEdicao = (conta: EmailAccount) => {
    setResolvendoId(null);
    setEditando(conta);
    setDialogOpen(true);
  };

  const alternarAtivo = (conta: EmailAccount, ativo: boolean) => {
    updateFlags.mutate(
      { id: conta.id, ativo },
      {
        onSuccess: () => toast.success(ativo ? "Conta ativada." : "Conta desativada."),
        onError: (err: any) => toast.error(err?.message || "Não foi possível alterar a conta."),
      },
    );
  };

  const definirPadrao = (conta: EmailAccount) => {
    updateFlags.mutate(
      { id: conta.id, is_default: true, ativo: true },
      {
        onSuccess: () => toast.success(`${conta.rotulo} agora é a conta padrão de envio.`),
        onError: (err: any) => toast.error(err?.message || "Não foi possível definir a conta padrão."),
      },
    );
  };

  const testar = (id: string) => {
    setTestandoId(id);
    testAccount.mutate(id, {
      onSuccess: (r) => {
        if (r.ok) {
          toast.success(r.mensagem);
        } else {
          toast.error(r.mensagem, {
            duration: 12000,
            action: { label: "Como resolver", onClick: () => setResolvendoId(id) },
          });
        }
      },
      onError: (err: any) => toast.error(err?.message || "Não foi possível testar a conta."),
      onSettled: () => setTestandoId(null),
    });
  };

  /** troca só os servidores pelos do provedor e testa; a senha fica como está */
  const aplicarRecomendados = async (conta: EmailAccount) => {
    const rec = servidoresRecomendados(conta, providerByValue(conta.provider));
    if (!rec) return;
    setCorrigindo(true);
    try {
      await saveAccount.mutateAsync({
        id: conta.id,
        rotulo: conta.rotulo,
        from_name: conta.from_name,
        email: conta.email,
        provider: conta.provider,
        setor_id: conta.setor_id,
        smtp_host: rec.smtp_host,
        smtp_port: rec.smtp_port,
        smtp_security: rec.smtp_security,
        smtp_username: conta.smtp_username,
        imap_host: rec.imap_host,
        imap_port: rec.imap_port,
        imap_security: rec.imap_security,
        imap_username: rec.imap_host ? (conta.imap_username || conta.smtp_username) : null,
        is_default: conta.is_default,
        ativo: conta.ativo,
        senha: "",
      });
      toast.success("Servidores atualizados. Testando de novo.");
      testar(conta.id);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível atualizar os servidores.");
    } finally {
      setCorrigindo(false);
    }
  };

  const confirmarExclusao = () => {
    if (!excluindo) return;
    deleteAccount.mutate(excluindo.id, {
      onSuccess: () => {
        toast.success("Conta excluída.");
        setExcluindo(null);
      },
      onError: (err: any) => toast.error(err?.message || "Não foi possível excluir a conta."),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  const diag = resolvendo ? diagnosticar(resolvendo.last_test_error) : null;
  const presetResolvendo = resolvendo ? providerByValue(resolvendo.provider) : null;
  const recomendados = resolvendo && presetResolvendo ? servidoresRecomendados(resolvendo, presetResolvendo) : null;
  const testandoResolvendo = !!resolvendo && testandoId === resolvendo.id;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={abrirNova}>
          <Plus className="mr-2 h-4 w-4" />
          Nova conta de e-mail
        </Button>
      </div>

      {accounts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-muted">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Nenhuma conta de e-mail cadastrada</p>
            <p className="text-sm text-muted-foreground">
              Cadastre as contas que a operação usa, como suporte, financeiro e onboarding.
            </p>
          </div>
          <Button variant="outline" onClick={abrirNova}>
            <Plus className="mr-2 h-4 w-4" />
            Cadastrar a primeira conta
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {accounts.map((conta) => {
            const provedor = providerByValue(conta.provider);
            const setorNome = conta.setor_id ? setorPorId.get(conta.setor_id) : null;
            const falhou = conta.last_test_ok === false && !!conta.last_test_error;
            return (
              <article
                key={conta.id}
                className={cn(
                  "flex flex-col gap-4 rounded-lg border bg-card p-4 lg:grid lg:grid-cols-[38px_minmax(0,1.15fr)_minmax(0,1.5fr)_auto] lg:items-center",
                  !conta.ativo && "opacity-60",
                  falhou && "border-destructive/40",
                )}
              >
                <ProviderLogo value={conta.provider} />

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-semibold">{conta.rotulo}</strong>
                    {conta.is_default && (
                      <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/15">
                        <Star className="h-3 w-3" />
                        Padrão de envio
                      </Badge>
                    )}
                    {setorNome && <Badge variant="secondary">{setorNome}</Badge>}
                    {!conta.ativo && <Badge variant="outline">Inativa</Badge>}
                    <SeloTeste conta={conta} testando={testandoId === conta.id} />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{conta.email}</p>
                  {falhou && (
                    <div className="mt-1.5 space-y-1.5">
                      <p className="text-xs text-destructive">{motivoDoErro(conta.last_test_error)}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 border-destructive/40 px-2.5 text-xs"
                        onClick={() => setResolvendoId(conta.id)}
                      >
                        <LifeBuoy className="h-3.5 w-3.5" />
                        Como resolver
                      </Button>
                    </div>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-5 gap-y-1 sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Provedor</dt>
                    <dd className="truncate font-mono text-[11.5px]">{provedor.label}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Envio</dt>
                    <dd className="truncate font-mono text-[11.5px] tabular-nums">
                      {conta.smtp_host}:{conta.smtp_port}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Recebimento</dt>
                    <dd className="truncate font-mono text-[11.5px] tabular-nums">
                      {conta.imap_host ? `${conta.imap_host}:${conta.imap_port}` : "não configurado"}
                    </dd>
                  </div>
                </dl>

                <div className="flex items-center gap-1.5 lg:justify-self-end">
                  <Switch
                    checked={conta.ativo}
                    onCheckedChange={(v) => alternarAtivo(conta, v)}
                    aria-label={conta.ativo ? "Desativar conta" : "Ativar conta"}
                  />
                  <Button variant="ghost" size="icon" onClick={() => abrirEdicao(conta)} aria-label="Editar conta">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Mais ações">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => abrirEdicao(conta)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={testandoId === conta.id} onClick={() => testar(conta.id)}>
                        <Plug className="mr-2 h-4 w-4" />
                        Testar conexão
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!conta.ativo} onClick={() => setEnviandoTeste(conta)}>
                        <Send className="mr-2 h-4 w-4" />
                        Enviar e-mail de teste
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setResolvendoId(conta.id)}>
                        <LifeBuoy className="mr-2 h-4 w-4" />
                        Como liberar o acesso
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={conta.is_default} onClick={() => definirPadrao(conta)}>
                        <Star className="mr-2 h-4 w-4" />
                        Definir como padrão
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setExcluindo(conta)}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-md border border-l-[3px] border-l-accent bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>
          A senha fica guardada no cofre do Supabase e nunca aparece de volta na tela. Para trocar, basta digitar a nova
          senha ao editar a conta.
        </span>
      </div>

      <EmailAccountDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        account={editando}
        setores={setores}
        onSave={(input) => saveAccount.mutateAsync(input)}
        onTest={testar}
        saving={saveAccount.isPending}
      />

      <EnviarTesteDialog
        conta={enviandoTeste}
        onOpenChange={(open) => !open && setEnviandoTeste(null)}
        onEnviar={(para) =>
          sendEmail.mutateAsync({
            account_id: enviandoTeste!.id,
            tenant_id: enviandoTeste!.tenant_id,
            to: para,
            origem: "teste",
            ...montarEmailDeTeste(enviandoTeste!),
          })
        }
        enviando={sendEmail.isPending}
      />

      {/* Como resolver: diagnóstico do último teste + passo a passo do provedor */}
      <Dialog open={!!resolvendo} onOpenChange={(open) => !open && setResolvendoId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {resolvendo && presetResolvendo && (
            <>
              <DialogHeader>
                <DialogTitle>{diag ? diag.titulo : `Como liberar o acesso no ${presetResolvendo.label}`}</DialogTitle>
                <DialogDescription className="font-mono text-xs">{resolvendo.email}</DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                {diag && (
                  <div className="space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                      {diag.lado === "ambos"
                        ? "Falhou no envio e no recebimento"
                        : diag.lado === "recebimento"
                          ? "O envio passou; falhou o recebimento"
                          : "Falhou no envio"}
                    </p>
                    <p className="text-sm">{diag.explicacao}</p>
                  </div>
                )}

                {recomendados && (
                  <div className="space-y-3 rounded-md border px-3 py-3">
                    <p className="text-sm font-medium">
                      Os servidores desta conta estão diferentes do recomendado para o {presetResolvendo.label}
                    </p>
                    <div className="grid gap-2 text-xs sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                      <div className="space-y-1 rounded bg-muted/60 px-2.5 py-2 font-mono">
                        <p className="font-sans text-[10px] uppercase tracking-wide text-muted-foreground">Hoje</p>
                        <p>Envio: {servidor(resolvendo.smtp_host, resolvendo.smtp_port, resolvendo.smtp_security)}</p>
                        <p>Entrada: {servidor(resolvendo.imap_host, resolvendo.imap_port, resolvendo.imap_security)}</p>
                      </div>
                      <ArrowRight className="mx-auto hidden h-4 w-4 text-muted-foreground sm:block" />
                      <div className="space-y-1 rounded bg-primary/10 px-2.5 py-2 font-mono">
                        <p className="font-sans text-[10px] uppercase tracking-wide text-primary">Recomendado</p>
                        <p>Envio: {servidor(recomendados.smtp_host, recomendados.smtp_port, recomendados.smtp_security)}</p>
                        <p>Entrada: {servidor(recomendados.imap_host, recomendados.imap_port, recomendados.imap_security)}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => aplicarRecomendados(resolvendo)}
                      disabled={corrigindo || testandoResolvendo}
                    >
                      {corrigindo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                      Usar os recomendados e testar
                    </Button>
                  </div>
                )}

                <div className="space-y-3">
                  <p className="text-sm font-semibold">Como liberar o acesso no {presetResolvendo.label}</p>
                  <GuiaProvedor preset={presetResolvendo} />
                </div>

                {tecnicoDoErro(resolvendo.last_test_error) && (
                  <details className="rounded-md border px-3 py-2 text-xs">
                    <summary className="cursor-pointer text-muted-foreground">Resposta do servidor, para o suporte do provedor</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                      {tecnicoDoErro(resolvendo.last_test_error)}
                    </pre>
                  </details>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" onClick={() => abrirEdicao(resolvendo)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Editar conta
                </Button>
                <Button onClick={() => testar(resolvendo.id)} disabled={testandoResolvendo || corrigindo}>
                  {testandoResolvendo ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plug className="mr-2 h-4 w-4" />}
                  Testar de novo
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!excluindo} onOpenChange={(open) => !open && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {excluindo?.rotulo}?</AlertDialogTitle>
            <AlertDialogDescription>
              A conta {excluindo?.email} sai da lista e a senha é apagada do cofre. Não dá para desfazer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmarExclusao}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
