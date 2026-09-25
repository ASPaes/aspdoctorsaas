import { useNavigate } from "react-router-dom";
import { MessageCircle, Ticket, KanbanSquare, Mail, TrendingUp } from "lucide-react";
import { useAgentDisplayName } from "@/hooks/useAgentDisplayName";
import { usePortao } from "@/hooks/usePortao";
import { cn } from "@/lib/utils";
import { useContadoresDoMobile } from "./useContadoresDoMobile";

/**
 * Tela inicial do telefone: a porta de entrada da versão mobile.
 *
 * Até 24/09/2026 o endereço abria direto no chat, porque só existia o chat. Com
 * tickets, implantação e e-mails no mesmo app, entrar sempre numa das telas
 * obrigaria a voltar para trocar de assunto — por isso a home vira o ponto de
 * partida, e o gesto de voltar do Android cai aqui em vez de fechar o app.
 *
 * Cada card só aparece para quem tem a permissão do módulo: mostrar um atalho
 * que leva a "você não tem acesso" é pior do que não mostrar.
 */

interface Atalho {
  chave: string;
  titulo: string;
  descricao: string;
  destino: string;
  icone: typeof MessageCircle;
  /** Tom do quadro do ícone. */
  cor: string;
  contagem: number;
  /** Contagem informativa (cinza) em vez de pendência (vermelho). */
  calma?: boolean;
  liberado: boolean;
}

export default function MobileHome() {
  const navigate = useNavigate();
  // Mesmo nome que o operador escolheu para assinar no chat — nao o do cadastro
  // de RH, que e outra coisa (ver useAgentDisplayName).
  const nomeExibido = useAgentDisplayName();
  const contadores = useContadoresDoMobile();

  const podeChat = usePortao("atendimento_chat");
  const podeTickets = usePortao("tickets");
  const podeImplantacao = usePortao("nav.onboarding");
  const podeEmails = usePortao("nav.emails");

  const primeiroNome = (nomeExibido ?? "").split(" ")[0];

  const atalhos: Atalho[] = [
    {
      chave: "chat",
      titulo: "Chat",
      descricao: "Atendimento no WhatsApp",
      destino: "/whatsapp",
      icone: MessageCircle,
      cor: "bg-primary/15 border-primary/30 text-primary",
      contagem: contadores.chat,
      liberado: podeChat,
    },
    {
      chave: "tickets",
      titulo: "Tickets",
      descricao: "Chamados de suporte",
      destino: "/tickets",
      icone: Ticket,
      cor: "bg-sky-500/15 border-sky-500/30 text-sky-400",
      contagem: contadores.tickets,
      liberado: podeTickets,
    },
    {
      chave: "implantacao",
      titulo: "Implantação",
      descricao: "Kanban das jornadas",
      destino: "/implantacao",
      icone: KanbanSquare,
      cor: "bg-violet-500/15 border-violet-500/30 text-violet-400",
      contagem: contadores.implantacao,
      calma: true,
      liberado: podeImplantacao,
    },
    {
      chave: "emails",
      titulo: "E-mails",
      descricao: "Recebidos e enviados",
      destino: "/emails",
      icone: Mail,
      cor: "bg-amber-500/15 border-amber-500/30 text-amber-400",
      contagem: contadores.emails,
      liberado: podeEmails,
    },
  ];

  const visiveis = atalhos.filter((a) => a.liberado);

  return (
    <div className="h-full overflow-y-auto overscroll-contain">
      {/* Mesh de fundo: o mesmo vocabulário visual do resto do sistema, sem custo
          de imagem — são três gradientes. */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 40% at 15% 0%, hsl(var(--primary) / 0.14), transparent 60%)," +
            "radial-gradient(50% 35% at 95% 12%, rgba(14,165,233,.12), transparent 60%)," +
            "radial-gradient(70% 40% at 50% 100%, hsl(var(--primary) / 0.06), transparent 60%)",
        }}
      />

      <div className="px-4 pt-5 pb-2">
        <h1 className="text-xl font-bold tracking-tight">
          {primeiroNome ? `Olá, ${primeiroNome}` : "Olá"}
        </h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">O que você vai abrir agora?</p>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 pb-4">
        {visiveis.map((a) => {
          const Icone = a.icone;
          return (
            <button
              key={a.chave}
              type="button"
              onClick={() => navigate(a.destino)}
              className={cn(
                "relative flex min-h-[124px] flex-col justify-between overflow-hidden rounded-2xl border border-border p-3.5 text-left",
                "bg-gradient-to-br from-card to-muted/40",
                "transition-transform duration-300 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97]"
              )}
            >
              {/* spotlight */}
              <span
                className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full"
                style={{ background: "radial-gradient(circle, rgba(255,255,255,.06), transparent 70%)" }}
              />
              <div className="flex items-start justify-between">
                <span className={cn("grid h-10 w-10 place-items-center rounded-xl border", a.cor)}>
                  <Icone className="h-5 w-5" />
                </span>
                {a.contagem > 0 && (
                  <span
                    className={cn(
                      "grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 text-[11px] font-bold",
                      a.calma ? "bg-foreground/10 text-muted-foreground" : "bg-destructive text-destructive-foreground"
                    )}
                  >
                    {a.contagem > 99 ? "99+" : a.contagem}
                  </span>
                )}
              </div>
              <div>
                <h2 className="text-[15px] font-semibold">{a.titulo}</h2>
                <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{a.descricao}</p>
              </div>
            </button>
          );
        })}
      </div>

      {visiveis.length === 0 && (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum módulo liberado para o seu usuário.
        </p>
      )}

      <div className="px-4 pt-1 text-[11px] uppercase tracking-wider text-muted-foreground">Em breve</div>
      <div className="mx-4 mt-2 flex items-center gap-2.5 rounded-2xl border border-dashed border-border p-3.5 text-xs text-muted-foreground">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-foreground/5">
          <TrendingUp className="h-4 w-4" />
        </span>
        <span>Indicadores do dia — fila, tempo de resposta e atendimentos por aqui mesmo.</span>
      </div>
    </div>
  );
}
