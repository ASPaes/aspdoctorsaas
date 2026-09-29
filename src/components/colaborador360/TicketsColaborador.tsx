import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Cartao, Mini, Vazio } from "@/components/clientes/visao360/Visao360Ui";
import { TicketsDoCartao } from "@/components/clientes/visao360/Visao360Listas";
import type { Periodo } from "@/components/clientes/visao360/visao360Calc";
import type { TicketColaborador } from "./useColaborador360";

function noPeriodo(iso: string | null, p: Periodo) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= p.from.getTime() && t <= p.to.getTime();
}

const idadeDias = (t: TicketColaborador) => {
  const fim = t.status_final && t.concluido_em ? new Date(t.concluido_em) : new Date();
  return Math.max(0, Math.floor((fim.getTime() - new Date(t.aberto_em).getTime()) / 86_400_000));
};

/**
 * Aba Tickets da Visão 360° do colaborador. Cada cartão abre a lista dos
 * tickets que formam o número; "Abrir ticket" abre o detalhe por cima dela,
 * o mesmo da tela de Tickets, então dá para trabalhar sem sair daqui.
 */
export function TicketsColaborador({
  tickets, userId, periodo, nomeAgente, onAbrir,
}: {
  tickets: TicketColaborador[];
  userId: string;
  periodo: Periodo;
  nomeAgente: (uid: string | null) => string | null;
  onAbrir: (id: string) => void;
}) {
  const [cartao, setCartao] = useState<{ titulo: string; itens: TicketColaborador[] } | null>(null);

  const g = useMemo(() => {
    const abertos = tickets.filter((t) => t.responsavel_user_id === userId && !t.status_final);
    const resolvidos = tickets.filter((t) => t.responsavel_user_id === userId && t.status_final && noPeriodo(t.concluido_em, periodo));
    const criados = tickets.filter((t) => t.criado_por === userId && noPeriodo(t.aberto_em, periodo));
    const idades = abertos.map(idadeDias);
    const duracoes = resolvidos
      .filter((t) => t.concluido_em)
      .map((t) => (new Date(t.concluido_em!).getTime() - new Date(t.aberto_em).getTime()) / 86_400_000);
    return {
      abertos: abertos.sort((a, b) => (a.aberto_em > b.aberto_em ? 1 : -1)),
      resolvidos,
      criados,
      maisAntigo: idades.length ? Math.max(...idades) : null,
      mediaDias: duracoes.length ? duracoes.reduce((s, x) => s + x, 0) / duracoes.length : null,
      criadosAbertos: criados.filter((t) => !t.status_final).length,
    };
  }, [tickets, userId, periodo]);

  const dias = (n: number) => `${n} dia${n === 1 ? "" : "s"}`;

  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Mini
          rotulo="Abertos com a pessoa" valor={g.abertos.length}
          sub={g.maisAntigo != null ? `mais antigo: ${dias(g.maisAntigo)}` : "nenhum pendente"}
          onClick={() => setCartao({ titulo: "Tickets abertos sob responsabilidade", itens: g.abertos })}
        />
        <Mini
          rotulo="Resolvidos no período" valor={g.resolvidos.length}
          sub={g.mediaDias != null ? `levaram ${g.mediaDias.toFixed(1).replace(".", ",")} dias em média` : undefined}
          onClick={() => setCartao({ titulo: "Tickets resolvidos no período", itens: g.resolvidos })}
        />
        <Mini
          rotulo="Abertos pela pessoa" valor={g.criados.length}
          sub={g.criados.length ? `${g.criadosAbertos} ainda em andamento` : "nenhum no período"}
          onClick={() => setCartao({ titulo: "Tickets abertos pela pessoa no período", itens: g.criados })}
        />
        <Mini
          rotulo="Parados há mais de 7 dias"
          valor={g.abertos.filter((t) => idadeDias(t) > 7).length}
          tom={g.abertos.some((t) => idadeDias(t) > 7) ? "ruim" : undefined}
          sub="entre os abertos com a pessoa"
          onClick={() => setCartao({ titulo: "Tickets abertos há mais de 7 dias", itens: g.abertos.filter((t) => idadeDias(t) > 7) })}
        />
      </div>

      <TicketsDoCartao cartao={cartao} onFechar={() => setCartao(null)} onAbrir={onAbrir} nomeAgente={nomeAgente} />

      <Cartao titulo="Tickets sob responsabilidade" sub={`${g.abertos.length} aberto${g.abertos.length === 1 ? "" : "s"}, do mais antigo para o mais novo`}>
        {g.abertos.length === 0 ? (
          <Vazio>Nenhum ticket aberto com a pessoa.</Vazio>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Código</TableHead>
                  <TableHead className="whitespace-nowrap">Aberto em</TableHead>
                  <TableHead className="whitespace-nowrap">Cliente</TableHead>
                  <TableHead className="whitespace-nowrap">Assunto</TableHead>
                  <TableHead className="whitespace-nowrap">Categoria</TableHead>
                  <TableHead className="whitespace-nowrap">Status</TableHead>
                  <TableHead className="whitespace-nowrap text-right">Idade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.abertos.map((t) => {
                  const idade = idadeDias(t);
                  return (
                    <TableRow key={t.id} className="cursor-pointer" onClick={() => onAbrir(t.id)}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{t.ticket_code ?? "Ticket"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{format(parseISO(t.aberto_em), "dd/MM/yy")}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={t.cliente ?? undefined}>{t.cliente ?? "Sem cliente"}</TableCell>
                      <TableCell className="max-w-[280px] truncate" title={t.assunto}>{t.assunto}</TableCell>
                      <TableCell className="whitespace-nowrap">{t.categoria ?? "Sem categoria"}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.status_cor || "#0EA5E9" }} />
                          {t.status_nome ?? "Aberto"}
                        </span>
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", idade > 7 && "font-bold text-amber-600 dark:text-amber-400")}>
                        {idade} d
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Cartao>
    </div>
  );
}
