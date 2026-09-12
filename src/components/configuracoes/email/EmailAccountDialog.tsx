import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { BookOpen, ChevronDown, Loader2, Plug } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  EMAIL_PROVIDERS, SECURITY_LABELS, providerByValue, type EmailSecurity,
} from "./emailProviders";
import { GuiaProvedor } from "./GuiaProvedor";
import { ProviderLogo } from "./ProviderLogo";
import { SetoresMultiSelect } from "./SetoresMultiSelect";
import { AgentMultiSelect } from "@/components/configuracoes/whatsapp/AgentMultiSelect";
import type { EmailAccount, EmailAccountInput } from "./useEmailAccounts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: EmailAccount | null;
  setores: { id: string; name: string }[];
  /** devolve o id da conta gravada */
  onSave: (input: EmailAccountInput) => Promise<string>;
  /** abre a conexão de verdade na conta recém-gravada */
  onTest: (id: string) => void;
  saving: boolean;
}

/** guia aberto de saída quando o provedor tem pegadinha que a pessoa não adivinha */
const guiaAbreSozinho = (value: string) => {
  const p = providerByValue(value);
  return !!p.exigeSenhaApp || !!p.guia.bloqueio;
};

export function EmailAccountDialog({ open, onOpenChange, account, setores, onSave, onTest, saving }: Props) {
  const editando = !!account;

  const [rotulo, setRotulo] = useState("");
  const [fromName, setFromName] = useState("");
  const [email, setEmail] = useState("");
  const [setorIds, setSetorIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [provider, setProvider] = useState("gmail");
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("465");
  const [smtpSecurity, setSmtpSecurity] = useState<EmailSecurity>("ssl");
  const [imapHost, setImapHost] = useState("");
  const [imapPort, setImapPort] = useState("993");
  const [imapSecurity, setImapSecurity] = useState<EmailSecurity>("ssl");
  const [isDefault, setIsDefault] = useState(false);
  const [ativo, setAtivo] = useState(true);
  const [receberRespostas, setReceberRespostas] = useState(false);
  const [aceitarCliente, setAceitarCliente] = useState(false);
  const [descartarAutomaticos, setDescartarAutomaticos] = useState(true);
  const [servidoresAbertos, setServidoresAbertos] = useState(true);
  const [guiaAberto, setGuiaAberto] = useState(false);

  const preset = providerByValue(provider);

  // recarrega o formulário toda vez que o diálogo abre
  useEffect(() => {
    if (!open) return;
    if (account) {
      setRotulo(account.rotulo);
      setFromName(account.from_name ?? "");
      setEmail(account.email);
      setSetorIds(account.setor_ids);
      setUserIds(account.user_ids);
      setProvider(account.provider);
      setUsuario(account.smtp_username);
      setSenha("");
      setSmtpHost(account.smtp_host);
      setSmtpPort(String(account.smtp_port));
      setSmtpSecurity(account.smtp_security);
      setImapHost(account.imap_host ?? "");
      setImapPort(account.imap_port ? String(account.imap_port) : "");
      setImapSecurity(account.imap_security ?? "ssl");
      setIsDefault(account.is_default);
      setAtivo(account.ativo);
      setReceberRespostas(account.receber_respostas ?? false);
      setAceitarCliente(account.aceitar_cliente_cadastrado ?? false);
      setDescartarAutomaticos(account.descartar_automaticos ?? true);
      // conta que já falhou abre com o guia à vista
      setGuiaAberto(account.last_test_ok === false || guiaAbreSozinho(account.provider));
    } else {
      const p = providerByValue("gmail");
      setRotulo("");
      setFromName("");
      setEmail("");
      setSetorIds([]);
      setUserIds([]);
      setProvider("gmail");
      setUsuario("");
      setSenha("");
      setSmtpHost(p.smtpHost ?? "");
      setSmtpPort(p.smtpPort ? String(p.smtpPort) : "465");
      setSmtpSecurity(p.smtpSecurity ?? "ssl");
      setImapHost(p.imapHost ?? "");
      setImapPort(p.imapPort ? String(p.imapPort) : "993");
      setImapSecurity(p.imapSecurity ?? "ssl");
      setIsDefault(false);
      setAtivo(true);
      setReceberRespostas(false);
      setAceitarCliente(false);
      setDescartarAutomaticos(true);
      setGuiaAberto(guiaAbreSozinho("gmail"));
    }
    setServidoresAbertos(true);
  }, [open, account]);

  const escolherProvedor = (value: string) => {
    setProvider(value);
    const p = providerByValue(value);
    if (p.smtpHost) {
      setSmtpHost(p.smtpHost);
      setSmtpPort(String(p.smtpPort ?? 465));
      setSmtpSecurity(p.smtpSecurity ?? "ssl");
    }
    if (p.semRecebimento) {
      // Microsoft não aceita senha para ler a caixa: deixar a entrada seria falha garantida
      setImapHost("");
      setImapPort("");
    } else if (p.imapHost) {
      setImapHost(p.imapHost);
      setImapPort(String(p.imapPort ?? 993));
      setImapSecurity(p.imapSecurity ?? "ssl");
    }
    setGuiaAberto(guiaAbreSozinho(value));
  };

  const submeter = async (testarDepois = false) => {
    const emailLimpo = email.trim().toLowerCase();
    const porta = Number(smtpPort);
    const portaEntrada = imapPort ? Number(imapPort) : null;

    if (!rotulo.trim()) return toast.error("Informe o rótulo da conta.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(emailLimpo)) return toast.error("Informe um e-mail válido.");
    if (!smtpHost.trim()) return toast.error("Informe o servidor de saída.");
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return toast.error("Porta de saída inválida.");
    if (imapHost.trim() && (!portaEntrada || portaEntrada < 1 || portaEntrada > 65535)) {
      return toast.error("Porta de entrada inválida.");
    }
    if (!editando && !senha) return toast.error("Informe a senha da conta.");
    const temEntrada = !!imapHost.trim();

    try {
      const id = await onSave({
        id: account?.id ?? null,
        rotulo: rotulo.trim(),
        from_name: fromName.trim() || null,
        email: emailLimpo,
        provider,
        setor_ids: setorIds,
        user_ids: userIds,
        smtp_host: smtpHost.trim(),
        smtp_port: porta,
        smtp_security: smtpSecurity,
        smtp_username: usuario.trim() || emailLimpo,
        imap_host: imapHost.trim() || null,
        imap_port: imapHost.trim() ? portaEntrada : null,
        imap_security: imapHost.trim() ? imapSecurity : null,
        imap_username: imapHost.trim() ? (usuario.trim() || emailLimpo) : null,
        is_default: isDefault,
        ativo,
        receber_respostas: temEntrada && receberRespostas,
        aceitar_cliente_cadastrado: temEntrada && receberRespostas && aceitarCliente,
        descartar_automaticos: descartarAutomaticos,
        senha,
      });
      toast.success(editando ? "Conta atualizada." : "Conta cadastrada.");
      onOpenChange(false);
      if (testarDepois && id) onTest(id);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível salvar a conta.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar conta de e-mail" : "Nova conta de e-mail"}</DialogTitle>
          <DialogDescription>
            Escolha o provedor e o DoctorSaaS preenche os servidores. Em servidor próprio, informe os dados na mão.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Identificação */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identificação</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email-rotulo">Rótulo</Label>
                <Input id="email-rotulo" value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Suporte" />
                <p className="text-xs text-muted-foreground">Como essa conta aparece na lista.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-from">Nome do remetente</Label>
                <Input id="email-from" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Suporte DoctorSaaS" />
                <p className="text-xs text-muted-foreground">Nome que o cliente vê ao receber.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-endereco">E-mail</Label>
                <Input
                  id="email-endereco"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="suporte@suaempresa.com.br"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Setores</Label>
                <SetoresMultiSelect setores={setores} value={setorIds} onChange={setSetorIds} />
                <p className="text-xs text-muted-foreground">Opcional. Pode marcar mais de um.</p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Usuários</Label>
                <AgentMultiSelect
                  value={userIds}
                  onChange={setUserIds}
                  placeholder="Selecionar usuários..."
                  rotuloContagem={(n) => (n === 1 ? "1 usuário vinculado" : `${n} usuários vinculados`)}
                />
                <p className="text-xs text-muted-foreground">Opcional. Quem usa esta conta no dia a dia.</p>
              </div>
            </div>
          </section>

          {/* Provedor */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Provedor</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {EMAIL_PROVIDERS.map((p) => {
                const selecionado = p.value === provider;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => escolherProvedor(p.value)}
                    aria-pressed={selecionado}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-md border px-2 py-2.5 text-xs font-medium transition-colors",
                      selecionado
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary"
                        : "border-border hover:bg-muted/60",
                    )}
                  >
                    <ProviderLogo value={p.value} size="sm" />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Acesso */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Acesso</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="email-usuario">Usuário</Label>
                <Input
                  id="email-usuario"
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder={email || "igual ao e-mail"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email-senha">{preset.exigeSenhaApp ? "Senha de aplicativo" : "Senha"}</Label>
                <PasswordInput
                  id="email-senha"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  showRules={false}
                  placeholder={
                    editando
                      ? "Deixe em branco para manter"
                      : preset.exigeSenhaApp
                        ? "Cole aqui a senha de aplicativo"
                        : "Senha da caixa de e-mail"
                  }
                  autoComplete="new-password"
                />
              </div>
            </div>

            <Collapsible
              open={guiaAberto}
              onOpenChange={setGuiaAberto}
              className={cn(
                "rounded-md border",
                preset.guia.bloqueio ? "border-destructive/40" : preset.exigeSenhaApp ? "border-warning/50" : "",
              )}
            >
              <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium">
                <BookOpen className="h-4 w-4 shrink-0 text-accent" />
                <span className="flex-1">Como liberar o acesso no {preset.label}</span>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !guiaAberto && "-rotate-90")} />
              </CollapsibleTrigger>
              <CollapsibleContent className="px-3 pb-4">
                <GuiaProvedor preset={preset} />
              </CollapsibleContent>
            </Collapsible>
          </section>

          {/* Servidores */}
          <Collapsible open={servidoresAbertos} onOpenChange={setServidoresAbertos} className="rounded-md border">
            <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium">
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !servidoresAbertos && "-rotate-90")} />
              Servidores
              {provider !== "custom" && (
                <Badge variant="secondary" className="ml-auto font-normal">Preenchido pelo provedor</Badge>
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 px-3 pb-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saída (SMTP)</p>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1.2fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-host">Servidor</Label>
                    <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.suaempresa.com.br" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-port">Porta</Label>
                    <Input id="smtp-port" inputMode="numeric" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="smtp-sec">Segurança</Label>
                    <Select value={smtpSecurity} onValueChange={(v) => setSmtpSecurity(v as EmailSecurity)}>
                      <SelectTrigger id="smtp-sec"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(SECURITY_LABELS).map(([v, label]) => (
                          <SelectItem key={v} value={v}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entrada (IMAP)</p>
                <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1.2fr]">
                  <div className="space-y-1.5">
                    <Label htmlFor="imap-host">Servidor</Label>
                    <Input id="imap-host" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.suaempresa.com.br" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="imap-port">Porta</Label>
                    <Input id="imap-port" inputMode="numeric" value={imapPort} onChange={(e) => setImapPort(e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="imap-sec">Segurança</Label>
                    <Select value={imapSecurity} onValueChange={(v) => setImapSecurity(v as EmailSecurity)}>
                      <SelectTrigger id="imap-sec"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(SECURITY_LABELS).map(([v, label]) => (
                          <SelectItem key={v} value={v}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {preset.semRecebimento
                    ? `O ${preset.label} não aceita senha para ler a caixa. Deixe em branco: a conta fica só para envio.`
                    : "Deixe em branco se essa conta for só para envio."}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Recebimento: só faz sentido quando a entrada (IMAP) está preenchida */}
          <section className="space-y-2 rounded-md border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Registrar as respostas dos clientes</p>
                <p className="text-xs text-muted-foreground">
                  O DoctorSaaS abre esta caixa de tempos em tempos e guarda, na tela E-mails, a resposta que o cliente
                  der a um e-mail enviado daqui. Nada é marcado como lido na caixa e nada é apagado dela.
                </p>
              </div>
              <Switch
                checked={receberRespostas}
                onCheckedChange={setReceberRespostas}
                disabled={!imapHost.trim()}
                aria-label="Registrar as respostas dos clientes"
              />
            </div>

            {!imapHost.trim() && (
              <p className="text-xs text-muted-foreground">
                Para ligar, preencha o servidor de entrada (IMAP) em Servidores.
                {preset.semRecebimento && ` O ${preset.label} não aceita senha para ler a caixa.`}
              </p>
            )}

            {imapHost.trim() && receberRespostas && (
              <div className="space-y-2 border-t pt-2">
                <label className="flex items-start justify-between gap-3">
                  <span className="space-y-0.5">
                    <span className="block text-sm">Aceitar também e-mail novo de cliente cadastrado</span>
                    <span className="block text-xs text-muted-foreground">
                      Mensagem que não é resposta entra só se o endereço do remetente estiver na ficha de algum cliente.
                      Desligado, a caixa registra apenas respostas.
                    </span>
                  </span>
                  <Switch checked={aceitarCliente} onCheckedChange={setAceitarCliente} />
                </label>
                <label className="flex items-start justify-between gap-3">
                  <span className="space-y-0.5">
                    <span className="block text-sm">Descartar boletins e respostas automáticas</span>
                    <span className="block text-xs text-muted-foreground">
                      Newsletter, propaganda e aviso de férias são reconhecidos pelos próprios cabeçalhos e nem chegam a
                      ser baixados. Recomendado deixar ligado.
                    </span>
                  </span>
                  <Switch checked={descartarAutomaticos} onCheckedChange={setDescartarAutomaticos} />
                </label>
              </div>
            )}
          </section>

          {/* Estado */}
          <section className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Padrão de envio</span>
                <span className="block text-xs text-muted-foreground">Uma conta por tenant.</span>
              </span>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
              <span className="space-y-0.5">
                <span className="block text-sm font-medium">Conta ativa</span>
                <span className="block text-xs text-muted-foreground">Inativa não envia nada.</span>
              </span>
              <Switch checked={ativo} onCheckedChange={setAtivo} />
            </label>
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button variant="outline" onClick={() => submeter(false)} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
          <Button onClick={() => submeter(true)} disabled={saving}>
            <Plug className="mr-2 h-4 w-4" />
            Salvar e testar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
