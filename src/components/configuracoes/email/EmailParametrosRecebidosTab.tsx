import { useEffect, useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Inbox, Lock, Mail, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmailAccounts, type EmailAccount } from "./useEmailAccounts";
import {
  mensagemDoBanco, useParametrosRecebidos,
  type DestinoEmail, type EnderecoDestino, type RegraAssunto, type RemetenteBloqueado, type SetorTicket,
} from "./useParametrosRecebidos";

/**
 * Parâmetros de Recebidos: e-mail novo de cliente vira ticket no setor certo.
 *
 * Decisões do Alexandre (13/09/2026): o endereço para o qual o cliente
 * escreveu decide o setor; desconhecido vai para a Triagem; aceita pelo domínio
 * da empresa cliente; onboarding entra na jornada ativa; prazo de reabertura e
 * aviso ao cliente configuráveis por tenant. Cada mudança salva na hora.
 */

const EMAIL_VALIDO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function haQuanto(iso: string | null): string | null {
  if (!iso) return null;
  const segundos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function Secao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border">
      <div className="border-b px-4 py-3">
        <h4 className="text-sm font-semibold">{titulo}</h4>
        {descricao && <p className="mt-0.5 max-w-[76ch] text-[13px] text-muted-foreground">{descricao}</p>}
      </div>
      {children}
    </section>
  );
}

export default function EmailParametrosRecebidosTab() {
  const { accounts, isLoading: carregandoContas } = useEmailAccounts();
  const p = useParametrosRecebidos();
  const dados = p.dados;

  const iniciais = useMemo(() => new Set(dados?.setoresComStatusInicial ?? []), [dados]);
  const setoresTicket = useMemo(() => (dados?.setores ?? []).filter((s) => s.usa_tickets), [dados]);
  const nomeSetor = (id: string | null) => (dados?.setores ?? []).find((s) => s.id === id)?.name ?? null;

  const contasOrdenadas = useMemo(
    () => [...accounts].sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
    [accounts],
  );

  const [dias, setDias] = useState("7");
  useEffect(() => {
    if (dados) setDias(String(dados.parametros.dias_reabrir));
  }, [dados]);

  if (p.isLoading || carregandoContas) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (p.erro || !dados) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span>Não foi possível carregar os parâmetros de recebidos. {(p.erro as any)?.message ?? ""}</span>
      </div>
    );
  }

  const falhou = (err: unknown) => toast.error(mensagemDoBanco(err));
  const ultimaLeitura = dados.estado
    .map((e) => e.ultima_leitura)
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  const caixasComErro = dados.estado.filter((e) => e.ultimo_erro);

  const salvarDias = () => {
    const n = Number(dias);
    if (!Number.isInteger(n) || n < 0 || n > 90) {
      toast.error("O prazo vai de 0 a 90 dias.");
      setDias(String(dados.parametros.dias_reabrir));
      return;
    }
    if (n === dados.parametros.dias_reabrir) return;
    p.salvarParametros.mutate(
      { dias_reabrir: n },
      { onSuccess: () => toast.success(`Prazo de reabertura: ${n} ${n === 1 ? "dia" : "dias"}.`), onError: falhou },
    );
  };

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">E-mail do cliente vira ticket</h3>
          <p className="mt-1 max-w-[76ch] text-sm text-muted-foreground">
            Quando um cliente escreve para um destes endereços, o DoctorSaaS identifica o cliente pelo remetente e abre o
            ticket no setor certo, sem ninguém copiar e colar. O que não der para identificar vai para a Triagem, em
            E-mails › Recebidos.
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
          Lê a cada 1 min no horário comercial e a cada 5 min fora
          {ultimaLeitura ? ` · última leitura ${haQuanto(ultimaLeitura)}` : ""}
        </span>
      </div>

      {caixasComErro.map((e) => (
        <div
          key={e.account_id}
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[13px]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <span>
            <strong className="font-semibold">
              {accounts.find((a) => a.id === e.account_id)?.rotulo ?? "Uma caixa"} não está sendo lida.
            </strong>{" "}
            Enquanto isso, e-mail de cliente não vira ticket. Último erro: {e.ultimo_erro}
          </span>
        </div>
      ))}

      <Secao
        titulo="Endereços que recebem e para onde vai cada e-mail"
        descricao="O endereço para o qual o cliente escreveu decide o destino. Funciona com uma caixa por setor ou com vários endereços caindo na mesma caixa. Endereço desligado continua registrando respostas, mas não abre ticket com e-mail novo."
      >
        {contasOrdenadas.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhuma conta de e-mail cadastrada. Cadastre uma na aba Cadastros.
          </p>
        ) : (
          <div>
            <div className="hidden grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-3 border-b px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
              <span>Endereço</span>
              <span>Abre ticket</span>
              <span>Destino</span>
              <span>Setor</span>
              <span>Como nasce</span>
            </div>
            {contasOrdenadas.flatMap((conta) => {
              const proprio = conta.email.toLowerCase();
              const registroProprio = dados.enderecos.find((e) => e.endereco === proprio) ?? null;
              const extras = dados.enderecos.filter((e) => e.account_id === conta.id && e.endereco !== proprio);
              return [
                <LinhaEndereco
                  key={`${conta.id}-proprio`}
                  conta={conta}
                  endereco={proprio}
                  registro={registroProprio}
                  extra={false}
                  setores={setoresTicket}
                  iniciais={iniciais}
                  nomeSetor={nomeSetor}
                  ocupado={p.salvarEndereco.isPending}
                  onSalvar={(e) => p.salvarEndereco.mutate(e, { onSuccess: () => toast.success("Endereço salvo."), onError: falhou })}
                />,
                ...extras.map((registro) => (
                  <LinhaEndereco
                    key={registro.id}
                    conta={conta}
                    endereco={registro.endereco}
                    registro={registro}
                    extra
                    setores={setoresTicket}
                    iniciais={iniciais}
                    nomeSetor={nomeSetor}
                    ocupado={p.salvarEndereco.isPending || p.removerEndereco.isPending}
                    onSalvar={(e) => p.salvarEndereco.mutate(e, { onSuccess: () => toast.success("Endereço salvo."), onError: falhou })}
                    onRemover={() =>
                      p.removerEndereco.mutate(registro.id, {
                        onSuccess: () => toast.success(`${registro.endereco} removido.`),
                        onError: falhou,
                      })
                    }
                  />
                )),
              ];
            })}
            <div className="border-t px-4 py-3">
              <AdicionarEndereco
                contas={contasOrdenadas.filter((c) => !!c.imap_host)}
                ocupado={p.salvarEndereco.isPending}
                onAdicionar={(endereco, contaId, limpar) =>
                  p.salvarEndereco.mutate(
                    { account_id: contaId, endereco, abre_ticket: false, destino: "suporte", department_id: null },
                    {
                      onSuccess: () => {
                        toast.success(`${endereco} adicionado. Escolha o destino e ligue a abertura de ticket.`);
                        limpar();
                      },
                      onError: falhou,
                    },
                  )
                }
              />
            </div>
          </div>
        )}

        <div className="border-t px-4 py-3">
          <RegrasAssunto
            regras={dados.regras}
            setores={setoresTicket}
            iniciais={iniciais}
            nomeSetor={nomeSetor}
            ocupado={p.criarRegra.isPending || p.removerRegra.isPending}
            onCriar={(palavras, setorId, limpar) =>
              p.criarRegra.mutate(
                { palavras, department_id: setorId },
                { onSuccess: () => { toast.success("Regra criada."); limpar(); }, onError: falhou },
              )
            }
            onRemover={(id) => p.removerRegra.mutate(id, { onSuccess: () => toast.success("Regra removida."), onError: falhou })}
          />
        </div>
      </Secao>

      <Secao
        titulo="Quem pode abrir ticket por e-mail"
        descricao="Todo ticket precisa de cliente. Remetente que não for reconhecido nunca é descartado: vai para a Triagem, e um gestor escolhe o cliente antes do ticket nascer."
      >
        <div className="divide-y">
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Quem está na ficha do cliente</p>
              <p className="text-[13px] text-muted-foreground">E-mail do cadastro do cliente ou de um contato dele.</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Sempre aceito
            </span>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Também pelo domínio da empresa cliente</p>
              <p className="max-w-[70ch] text-[13px] text-muted-foreground">
                Aceita outro funcionário, como compras@padaria.com.br, quando o domínio é de um cliente só. Domínio
                dividido entre dois clientes vai para a Triagem, e Gmail, Hotmail, Outlook e parecidos nunca contam como
                domínio de cliente.
              </p>
            </div>
            <Switch
              checked={dados.parametros.aceitar_dominio_cliente}
              disabled={p.salvarParametros.isPending}
              onCheckedChange={(v) =>
                p.salvarParametros.mutate(
                  { aceitar_dominio_cliente: v },
                  { onSuccess: () => toast.success(v ? "Domínio da empresa cliente aceito." : "Só quem está na ficha abre ticket."), onError: falhou },
                )
              }
              aria-label="Aceitar pelo domínio da empresa cliente"
            />
          </div>
          <RemetentesBloqueados
            bloqueados={dados.bloqueados}
            ocupado={p.bloquear.isPending || p.desbloquear.isPending}
            onBloquear={(padrao, limpar) =>
              p.bloquear.mutate(padrao, { onSuccess: () => { toast.success(`${padrao} nunca abre ticket.`); limpar(); }, onError: falhou })
            }
            onDesbloquear={(r) =>
              p.desbloquear.mutate(r.id, { onSuccess: () => toast.success(`${r.padrao} desbloqueado.`), onError: falhou })
            }
          />
        </div>
      </Secao>

      <Secao titulo="Quando o cliente responde">
        <div className="divide-y">
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Resposta a ticket em andamento</p>
              <p className="text-[13px] text-muted-foreground">
                Entra no mesmo ticket, como mensagem do cliente. Nunca abre outro.
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              Sempre assim
            </span>
          </div>
          <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3">
            <div>
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                Reabrir ticket encerrado há até
                <Input
                  id="dias-reabrir"
                  inputMode="numeric"
                  value={dias}
                  onChange={(e) => setDias(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  onBlur={salvarDias}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                  className="h-8 w-14 text-center tabular-nums"
                  aria-label="Dias para reabrir ticket encerrado"
                />
                dias
              </p>
              <p className="mt-1 max-w-[70ch] text-[13px] text-muted-foreground">
                Resposta dentro do prazo reabre o mesmo ticket, que volta para a fila do setor. Depois do prazo, abre um
                ticket novo, ligado ao anterior pelo histórico.
              </p>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">de 0 a 90 dias</span>
          </div>
        </div>
      </Secao>

      <Secao titulo="Aviso para o cliente">
        <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Confirmar a abertura para o cliente</p>
                <p className="text-[13px] text-muted-foreground">
                  Sai pela mesma caixa em que o cliente escreveu, com a assinatura dela e o número do ticket. Desligado,
                  o ticket abre do mesmo jeito, só sem o aviso.
                </p>
              </div>
              <Switch
                checked={dados.parametros.confirmar_abertura}
                disabled={p.salvarParametros.isPending}
                onCheckedChange={(v) =>
                  p.salvarParametros.mutate(
                    { confirmar_abertura: v },
                    { onSuccess: () => toast.success(v ? "Aviso de abertura ligado." : "Aviso de abertura desligado."), onError: falhou },
                  )
                }
                aria-label="Confirmar a abertura para o cliente"
              />
            </div>
            <div className="flex items-start justify-between gap-4 border-t pt-3">
              <div>
                <p className="text-sm font-medium">Proteção contra conversa entre robôs</p>
                <p className="text-[13px] text-muted-foreground">
                  Resposta automática, férias e no-reply nunca recebem aviso, e cada remetente recebe no máximo 1 aviso a
                  cada 15 minutos.
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                Sempre ligada
              </span>
            </div>
          </div>

          <div
            className={cn("overflow-hidden rounded-md border bg-white text-slate-800", !dados.parametros.confirmar_abertura && "opacity-50")}
            aria-label="Exemplo do aviso de abertura"
          >
            <div className="space-y-0.5 border-b border-slate-200 bg-slate-50 px-3.5 py-2 text-xs text-slate-500">
              <p><span className="font-semibold text-slate-800">Para:</span> Marina Costa &lt;marina@padaria.com.br&gt;</p>
              <p><span className="font-semibold text-slate-800">Assunto:</span> Recebemos seu chamado TK-2026-04127</p>
            </div>
            <div className="space-y-2 px-4 py-3 text-[13px] leading-relaxed">
              <p>Olá, Marina!</p>
              <p>
                Recebemos sua mensagem sobre <strong>“Impressora fiscal não imprime”</strong> e abrimos o chamado{" "}
                <strong>TK-2026-04127</strong> no setor Suporte.
              </p>
              <p>Para mandar mais detalhes ou prints, é só responder este e-mail: tudo entra no mesmo chamado.</p>
              <p className="pt-1 text-xs text-slate-500">Exemplo. A assinatura da caixa entra no final.</p>
            </div>
          </div>
        </div>
      </Secao>

      <Secao titulo="Proteções que ficam sempre ligadas" descricao="Para o e-mail do cliente não se perder e nada abrir ticket duas vezes.">
        <ul className="grid gap-x-6 gap-y-2 p-4 text-[13px] sm:grid-cols-2">
          {[
            "Propaganda e newsletter são descartadas pelos cabeçalhos que elas mesmas trazem.",
            "O mesmo e-mail nunca abre dois tickets, nem se a leitura rodar duas vezes.",
            "E-mail que sai das suas próprias caixas é ignorado, para não abrir ticket de si mesmo.",
            "Caixa que falha em 3 leituras seguidas avisa o administrador, com o motivo.",
            "Se abrir o ticket falhar, o e-mail fica guardado e o robô tenta de novo.",
            "A leitura nunca marca nada como lido nem apaga nada da caixa.",
          ].map((texto) => (
            <li key={texto} className="flex gap-2">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <span>{texto}</span>
            </li>
          ))}
        </ul>
      </Secao>
    </div>
  );
}

function LinhaEndereco({
  conta, endereco, registro, extra, setores, iniciais, nomeSetor, ocupado, onSalvar, onRemover,
}: {
  conta: EmailAccount;
  endereco: string;
  registro: EnderecoDestino | null;
  extra: boolean;
  setores: SetorTicket[];
  iniciais: Set<string>;
  nomeSetor: (id: string | null) => string | null;
  ocupado: boolean;
  onSalvar: (e: Omit<EnderecoDestino, "id">) => void;
  onRemover?: () => void;
}) {
  const abre = registro?.abre_ticket ?? false;
  const destino: DestinoEmail = registro?.destino ?? "suporte";
  const setor = registro?.department_id ?? null;
  const semEntrada = !conta.imap_host || !conta.ativo;
  const semStatus = destino === "suporte" && !!setor && !iniciais.has(setor);

  const salvar = (mudanca: Partial<Pick<EnderecoDestino, "abre_ticket" | "destino" | "department_id">>) => {
    const novo = { abre_ticket: abre, destino, department_id: setor, ...mudanca };
    if (novo.abre_ticket && novo.destino === "suporte") {
      if (!novo.department_id) {
        toast.error("Escolha o setor antes de ligar a abertura de ticket.");
        return;
      }
      if (!iniciais.has(novo.department_id)) {
        toast.error(`O setor ${nomeSetor(novo.department_id) ?? ""} não tem status inicial de ticket.`, {
          description: "Defina um status inicial para esse setor na configuração de status de ticket e depois ligue aqui.",
          duration: 9000,
        });
        return;
      }
    }
    onSalvar({ account_id: conta.id, endereco, ...novo });
  };

  const comoNasce = semEntrada
    ? "Conta sem servidor de entrada ou inativa. Preencha o IMAP em Cadastros."
    : !abre
      ? "Não abre ticket. Respostas continuam registradas."
      : destino === "onboarding"
        ? "Entra na jornada ativa do cliente. Sem jornada ativa, vai para a Triagem."
        : "Abre ticket na fila do setor, sem responsável.";

  return (
    <div className="grid gap-3 border-b px-4 py-3 lg:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-md",
            extra ? "bg-muted text-muted-foreground" : "bg-accent/15 text-accent",
          )}
          aria-hidden="true"
        >
          <Mail className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{extra ? endereco : conta.rotulo}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {extra ? `chega na caixa ${conta.rotulo}` : endereco}
          </p>
        </div>
        {extra && onRemover && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={onRemover}
            disabled={ocupado}
            aria-label={`Remover ${endereco}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch
          checked={abre}
          disabled={semEntrada || ocupado}
          onCheckedChange={(v) => salvar({ abre_ticket: v })}
          aria-label={`Abrir ticket com e-mail para ${endereco}`}
        />
        {abre ? "Sim" : "Não"}
      </label>

      <Select value={destino} onValueChange={(v) => salvar({ destino: v as DestinoEmail })} disabled={semEntrada || ocupado}>
        <SelectTrigger className="h-9" aria-label={`Destino de ${endereco}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="suporte">Ticket de suporte</SelectItem>
          <SelectItem value="onboarding">Jornada de onboarding</SelectItem>
        </SelectContent>
      </Select>

      {destino === "suporte" ? (
        <Select value={setor ?? undefined} onValueChange={(v) => salvar({ department_id: v })} disabled={semEntrada || ocupado}>
          <SelectTrigger className="h-9" aria-label={`Setor de ${endereco}`}>
            <SelectValue placeholder="Escolha o setor" />
          </SelectTrigger>
          <SelectContent>
            {setores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                {iniciais.has(s.id) ? "" : " (sem status inicial)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs text-muted-foreground">Setor da jornada do cliente</span>
      )}

      <p className="text-xs leading-relaxed text-muted-foreground">
        {abre && semStatus ? (
          <span className="flex items-start gap-1.5 text-warning">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            Setor sem status inicial: o e-mail vai para a Triagem até definirem um.
          </span>
        ) : (
          comoNasce
        )}
      </p>
    </div>
  );
}

function AdicionarEndereco({
  contas, ocupado, onAdicionar,
}: {
  contas: EmailAccount[];
  ocupado: boolean;
  onAdicionar: (endereco: string, contaId: string, limpar: () => void) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [endereco, setEndereco] = useState("");
  const [contaId, setContaId] = useState<string | undefined>(undefined);

  if (!aberto) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)} disabled={contas.length === 0}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Adicionar endereço
      </Button>
    );
  }

  const adicionar = () => {
    const e = endereco.trim().toLowerCase();
    if (!EMAIL_VALIDO.test(e)) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    if (!contaId) {
      toast.error("Escolha em qual caixa esse endereço chega.");
      return;
    }
    onAdicionar(e, contaId, () => {
      setEndereco("");
      setContaId(undefined);
      setAberto(false);
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3">
      <div className="min-w-[220px] flex-1 space-y-1">
        <label htmlFor="novo-endereco-recebidos" className="text-xs font-medium">
          Endereço
        </label>
        <Input
          id="novo-endereco-recebidos"
          value={endereco}
          onChange={(e) => setEndereco(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") adicionar();
          }}
          placeholder="financeiro@suaempresa.com.br"
          className="h-9"
        />
      </div>
      <div className="min-w-[220px] space-y-1">
        <span className="text-xs font-medium">Chega na caixa</span>
        <Select value={contaId} onValueChange={setContaId}>
          <SelectTrigger className="h-9" aria-label="Caixa em que o endereço chega">
            <SelectValue placeholder="Escolha a caixa" />
          </SelectTrigger>
          <SelectContent>
            {contas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.rotulo} · {c.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" size="sm" className="h-9" onClick={adicionar} disabled={ocupado}>
        Adicionar
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setAberto(false)}>
        Cancelar
      </Button>
      <p className="basis-full text-xs text-muted-foreground">
        Use quando mais de um endereço cai na mesma caixa, como financeiro@ chegando no login do suporte@. O endereço
        nasce sem abrir ticket.
      </p>
    </div>
  );
}

function RegrasAssunto({
  regras, setores, iniciais, nomeSetor, ocupado, onCriar, onRemover,
}: {
  regras: RegraAssunto[];
  setores: SetorTicket[];
  iniciais: Set<string>;
  nomeSetor: (id: string | null) => string | null;
  ocupado: boolean;
  onCriar: (palavras: string[], setorId: string, limpar: () => void) => void;
  onRemover: (id: string) => void;
}) {
  const [palavras, setPalavras] = useState("");
  const [setor, setSetor] = useState<string | undefined>(undefined);

  const criar = () => {
    const lista = [...new Set(palavras.split(",").map((w) => w.trim()).filter(Boolean))];
    if (lista.length === 0 || lista.length > 20) {
      toast.error("Informe de 1 a 20 palavras, separadas por vírgula.");
      return;
    }
    if (!setor) {
      toast.error("Escolha o setor da regra.");
      return;
    }
    if (!iniciais.has(setor)) {
      toast.error(`O setor ${nomeSetor(setor) ?? ""} não tem status inicial de ticket.`, {
        description: "Defina um status inicial para esse setor antes de criar a regra.",
      });
      return;
    }
    onCriar(lista, setor, () => {
      setPalavras("");
      setSetor(undefined);
    });
  };

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">Regras por assunto (opcional)</p>
        <p className="text-[13px] text-muted-foreground">
          Valem antes do destino do endereço. Com mais de uma regra, vale a primeira criada. Maiúsculas e minúsculas não
          importam.
        </p>
      </div>

      {regras.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[13px]">
          <span className="text-muted-foreground">Se o assunto tiver</span>
          {r.palavras.map((w) => (
            <span key={w} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              {w}
            </span>
          ))}
          <span className="text-muted-foreground">vai para</span>
          <span className="font-medium">{nomeSetor(r.department_id) ?? "setor removido"}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => onRemover(r.id)}
            disabled={ocupado}
            aria-label="Remover regra"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="nova-regra-palavras"
          value={palavras}
          onChange={(e) => setPalavras(e.target.value)}
          placeholder="boleto, nota fiscal, 2ª via"
          className="h-9 min-w-[220px] flex-1"
          aria-label="Palavras do assunto"
        />
        <Select value={setor} onValueChange={setSetor}>
          <SelectTrigger className="h-9 w-[220px]" aria-label="Setor da regra">
            <SelectValue placeholder="Vai para o setor" />
          </SelectTrigger>
          <SelectContent>
            {setores.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
                {iniciais.has(s.id) ? "" : " (sem status inicial)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={criar} disabled={ocupado}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Criar regra
        </Button>
      </div>
    </div>
  );
}

function RemetentesBloqueados({
  bloqueados, ocupado, onBloquear, onDesbloquear,
}: {
  bloqueados: RemetenteBloqueado[];
  ocupado: boolean;
  onBloquear: (padrao: string, limpar: () => void) => void;
  onDesbloquear: (r: RemetenteBloqueado) => void;
}) {
  const [padrao, setPadrao] = useState("");

  const bloquear = () => {
    const v = padrao.trim().toLowerCase();
    if (!v.includes("@") || v.length < 3) {
      toast.error("Use um endereço completo (promo@loja.com.br) ou um domínio começando com @.");
      return;
    }
    onBloquear(v, () => setPadrao(""));
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          Nunca abrir ticket para
        </p>
        <p className="text-[13px] text-muted-foreground">
          Endereço completo (promo@loja.com.br), domínio (@loja.com.br) ou com asterisco (*@newsletter.*).
        </p>
      </div>
      {bloqueados.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {bloqueados.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs">
              {r.padrao}
              <button
                type="button"
                onClick={() => onDesbloquear(r)}
                disabled={ocupado}
                className="rounded text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Desbloquear ${r.padrao}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="novo-bloqueio"
          value={padrao}
          onChange={(e) => setPadrao(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") bloquear();
          }}
          placeholder="*@newsletter.*"
          className="h-9 max-w-xs"
          aria-label="Remetente a bloquear"
        />
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={bloquear} disabled={ocupado}>
          Bloquear remetente
        </Button>
      </div>
    </div>
  );
}
