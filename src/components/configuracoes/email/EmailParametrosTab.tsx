import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, CheckCircle2, Clock, FileText, Info, Mail, MessageSquare, Sparkles, Ticket, User,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Parâmetros de envio automático de e-mail, por tenant.
 *
 * As chaves moram em `configuracoes.support_config`, o mesmo campo livre onde o
 * motor de distribuição e os limiares de risco já guardam as deles. Por isso não
 * existe migration para esta tela.
 *
 * Decisões do Alexandre (11/09/2026):
 *  - automático ligado vale para QUALQUER encerramento, inclusive o automático
 *    por inatividade;
 *  - o destinatário é o e-mail da ficha do cliente, e só ele;
 *  - com o automático ligado ninguém aprova nada; com ele desligado, o envio é
 *    manual e cada lugar escolhe se mostra o texto para revisão ou manda direto.
 */

interface Contexto {
  id: "chat" | "ticket" | "onboarding";
  titulo: string;
  pergunta: string;
  icone: typeof MessageSquare;
  corIcone: string;
  chaveAuto: string;
  chaveRevisao: string;
  quem: string;
  oQueVai: string;
  conta: string;
  naoEnvia: string;
}

const CONTEXTOS: Contexto[] = [
  {
    id: "chat",
    titulo: "Chat",
    pergunta: "Enviar o resumo do atendimento quando o chat for encerrado?",
    icone: MessageSquare,
    corIcone: "bg-primary/15 text-primary",
    chaveAuto: "email_auto_send_chat",
    chaveRevisao: "email_manual_review_chat",
    quem: "E-mail da ficha do cliente vinculado à conversa.",
    oQueVai: "Resumo do atendimento escrito pela inteligência artificial.",
    conta: "Conta do setor que atendeu, ou a conta padrão de envio.",
    naoEnvia: "quando a conversa não tem cliente vinculado, quando a ficha do cliente está sem e-mail, ou quando nenhuma conta de envio está ativa",
  },
  {
    id: "ticket",
    titulo: "Ticket de atendimento",
    pergunta: "Enviar o resumo quando o ticket for encerrado?",
    icone: Ticket,
    corIcone: "bg-accent/15 text-accent",
    chaveAuto: "email_auto_send_ticket",
    chaveRevisao: "email_manual_review_ticket",
    quem: "E-mail da ficha do cliente do ticket.",
    oQueVai: "Resumo do que foi tratado e de como o ticket terminou.",
    conta: "Conta do setor do ticket, ou a conta padrão de envio.",
    naoEnvia: "quando o ticket não tem cliente, quando a ficha do cliente está sem e-mail, ou quando nenhuma conta de envio está ativa",
  },
  {
    id: "onboarding",
    titulo: "Ticket de onboarding",
    pergunta: "Enviar o resumo quando o ticket de onboarding for encerrado?",
    icone: CheckCircle2,
    corIcone: "bg-warning/15 text-warning",
    chaveAuto: "email_auto_send_onboarding",
    chaveRevisao: "email_manual_review_onboarding",
    quem: "E-mail da ficha do cliente da implantação.",
    oQueVai: "Resumo da etapa concluída e do que vem em seguida.",
    conta: "Conta do setor responsável, ou a conta padrão de envio.",
    naoEnvia: "quando a ficha do cliente está sem e-mail, ou quando nenhuma conta de envio está ativa",
  },
];

/** automático desligado por padrão; no manual, revisar antes é o padrão seguro */
const PADRAO_AUTO = false;
const PADRAO_REVISAO = true;

export default function EmailParametrosTab() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: ["email-parametros", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("configuracoes")
        .select("support_config")
        .eq("tenant_id", tid as string)
        .maybeSingle();
      if (error) throw error;
      return (data?.support_config ?? {}) as Record<string, unknown>;
    },
  });

  const salvar = useMutation({
    mutationFn: async (mudanca: Record<string, boolean>) => {
      // relê antes de gravar: o campo é compartilhado com outras telas
      const { data: atual, error: erroLeitura } = await supabase
        .from("configuracoes")
        .select("support_config")
        .eq("tenant_id", tid as string)
        .single();
      if (erroLeitura) throw erroLeitura;

      const base = { ...((atual?.support_config ?? {}) as Record<string, unknown>), ...mudanca };
      const { error } = await supabase
        .from("configuracoes")
        .update({ support_config: base as any })
        .eq("tenant_id", tid as string);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-parametros", tid] });
      toast.success("Parâmetro salvo.");
    },
    onError: (err: any) => toast.error(err?.message || "Não foi possível salvar o parâmetro."),
  });

  const valores = useMemo(() => {
    const c = (config ?? {}) as Record<string, unknown>;
    const ler = (chave: string, padrao: boolean) => (typeof c[chave] === "boolean" ? (c[chave] as boolean) : padrao);
    return { ler };
  }, [config]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h3 className="text-base font-semibold">Envio automático</h3>
        <p className="mt-1 max-w-[76ch] text-sm text-muted-foreground">
          O que a plataforma envia sozinha, sem ninguém clicar. Cada chave vale para um lugar do sistema, e o texto do
          e-mail é escrito pela inteligência artificial a partir do atendimento inteiro.
        </p>
      </div>

      <div className="space-y-3">
        {CONTEXTOS.map((ctx) => {
          const auto = valores.ler(ctx.chaveAuto, PADRAO_AUTO);
          const revisao = valores.ler(ctx.chaveRevisao, PADRAO_REVISAO);
          const Icone = ctx.icone;

          return (
            <section key={ctx.id} className="overflow-hidden rounded-lg border">
              <div className="flex items-start gap-3 p-4">
                <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-[9px]", ctx.corIcone)}>
                  <Icone className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold">{ctx.titulo}</h4>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">{ctx.pergunta}</p>
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2.5">
                  <span className={cn("text-xs font-semibold", auto ? "text-foreground" : "text-muted-foreground")}>
                    {auto ? "Sim" : "Não"}
                  </span>
                  <Switch
                    checked={auto}
                    disabled={salvar.isPending}
                    onCheckedChange={(v) => salvar.mutate({ [ctx.chaveAuto]: v })}
                    aria-label={ctx.pergunta}
                  />
                </div>
              </div>

              {auto ? (
                <>
                  <dl className="grid gap-3 border-t bg-muted/40 px-4 py-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="flex gap-2">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Quando</dt>
                        <dd className="mt-0.5 text-[13px]">Em todo encerramento, inclusive o automático por inatividade.</dd>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <User className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Para quem</dt>
                        <dd className="mt-0.5 text-[13px]">{ctx.quem}</dd>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">O que vai</dt>
                        <dd className="mt-0.5 text-[13px]">{ctx.oQueVai}</dd>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Por qual conta</dt>
                        <dd className="mt-0.5 text-[13px]">{ctx.conta}</dd>
                      </div>
                    </div>
                  </dl>
                  <div className="mx-4 mb-4 flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span>
                      <strong className="font-semibold">Não envia</strong> {ctx.naoEnvia}. O motivo fica registrado, e
                      ninguém precisa ficar conferindo.
                    </span>
                  </div>
                </>
              ) : (
                <div className="space-y-3 border-t bg-muted/40 px-4 py-3">
                  <p className="text-[13px] text-muted-foreground">
                    Nada sai sozinho aqui. O e-mail só vai quando alguém clicar em enviar, e aí vale a escolha abaixo.
                  </p>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Ao clicar em enviar
                    </Label>
                    <RadioGroup
                      value={revisao ? "revisar" : "direto"}
                      onValueChange={(v) => salvar.mutate({ [ctx.chaveRevisao]: v === "revisar" })}
                      disabled={salvar.isPending}
                      className="gap-2"
                    >
                      <label
                        htmlFor={`${ctx.id}-revisar`}
                        className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-card px-3 py-2.5"
                      >
                        <RadioGroupItem value="revisar" id={`${ctx.id}-revisar`} className="mt-0.5" />
                        <span className="text-[13px]">
                          <span className="block font-medium">Mostrar o texto para revisão</span>
                          <span className="block text-muted-foreground">
                            O resumo da inteligência artificial abre na tela, dá para corrigir, e o e-mail só sai depois
                            que a pessoa confirmar.
                          </span>
                        </span>
                      </label>
                      <label
                        htmlFor={`${ctx.id}-direto`}
                        className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-card px-3 py-2.5"
                      >
                        <RadioGroupItem value="direto" id={`${ctx.id}-direto`} className="mt-0.5" />
                        <span className="text-[13px]">
                          <span className="block font-medium">Enviar direto</span>
                          <span className="block text-muted-foreground">
                            Um clique e o e-mail sai, sem passo de revisão.
                          </span>
                        </span>
                      </label>
                    </RadioGroup>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* prévia: tira a dúvida sobre o que o cliente recebe */}
      <section className="overflow-hidden rounded-lg border">
        <div className="flex items-center gap-2 border-b px-4 py-2.5 text-[13px] font-semibold">
          <Mail className="h-4 w-4 text-muted-foreground" />
          O que o cliente recebe
        </div>
        <div className="space-y-2.5 px-4 py-3.5">
          <p className="flex gap-2 text-[13px]">
            <span className="w-[70px] shrink-0 text-muted-foreground">De</span>
            <span>Suporte DoctorSaaS &lt;suporte@suaempresa.com.br&gt;</span>
          </p>
          <p className="flex gap-2 text-[13px]">
            <span className="w-[70px] shrink-0 text-muted-foreground">Assunto</span>
            <span>Resumo do seu atendimento de {new Date().toLocaleDateString("pt-BR")}</span>
          </p>
          <div className="border-t border-dashed pt-3 text-[13px] leading-relaxed">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2 py-0.5 text-[10.5px] font-semibold text-accent">
              <Sparkles className="h-3 w-3" />
              Resumo escrito pela IA
            </span>
            <p className="mt-2">Olá, tudo bem? Segue o resumo do atendimento que acabamos de encerrar.</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>Você relatou que o boleto de setembro não chegou por e-mail.</li>
              <li>Conferimos o cadastro e o endereço estava desatualizado.</li>
              <li>Atualizamos o e-mail de cobrança e reenviamos o boleto.</li>
            </ul>
          </div>
        </div>
      </section>

      <div className="flex items-start gap-2.5 rounded-md border border-l-[3px] border-l-accent bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>
          As chaves valem para toda a empresa e passam a funcionar assim que o envio de cada tela entrar no ar. Até lá, a
          escolha fica guardada e nenhum e-mail é enviado.
        </span>
      </div>
    </div>
  );
}
