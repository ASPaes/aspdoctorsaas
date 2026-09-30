import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Headset, Loader2, Search, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Ref, TipoRef } from "./tipos";

const tabela = (nome: string) => (supabase.from(nome as any) as any);

type Opcao = { ref: Ref; rotulo: string; titulo: string; detalhe: string; meu?: boolean };

/** Tira do termo o que quebraria o filtro `.or()` do PostgREST (vírgula, parênteses, curinga). */
const limpar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, " ").trim();

function useOpcoes(tipo: TipoRef, termo: string, ativo: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { user } = useAuth();
  const eu = user?.id ?? "";
  const t = limpar(termo);
  return useQuery({
    queryKey: ["equipe", "anexar", tipo, tid, t],
    enabled: ativo && !!tid,
    staleTime: 20_000,
    queryFn: async (): Promise<Opcao[]> => {
      if (tipo === "ticket") {
        let q = tabela("support_tickets")
          .select("id, ticket_code, assunto, concluido_em, responsavel_user_id, cliente:clientes!support_tickets_cliente_fkey(nome_fantasia, razao_social)")
          .eq("tenant_id", tid).is("deleted_at", null)
          .order("atualizado_em", { ascending: false }).limit(15);
        if (t) q = q.or(`ticket_code.ilike.%${t}%,assunto.ilike.%${t}%`);
        else q = q.eq("responsavel_user_id", eu).is("concluido_em", null);
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []).map((x: any) => ({
          ref: { tipo: "ticket", id: x.id },
          rotulo: x.ticket_code ?? "Ticket",
          titulo: `${x.ticket_code ?? ""} ${x.assunto ?? ""}`.trim(),
          detalhe: [x.cliente?.nome_fantasia || x.cliente?.razao_social, x.concluido_em ? "Concluído" : "Aberto"].filter(Boolean).join(" · "),
          meu: x.responsavel_user_id === eu,
        }));
      }
      if (tipo === "cliente") {
        if (!t) return [];
        const digitos = t.replace(/\D/g, "");
        let q = tabela("clientes")
          .select("id, nome_fantasia, razao_social, cnpj, cancelado")
          .eq("tenant_id", tid).order("nome_fantasia").limit(15);
        // busca_nome é gerada sem acento e em maiúsculas
        q = digitos.length >= 4
          ? q.or(`busca_nome.ilike.%${t.toUpperCase()}%,cnpj_digits.ilike.%${digitos}%`)
          : q.ilike("busca_nome", `%${t.toUpperCase()}%`);
        const { data, error } = await q;
        if (error) throw error;
        return (data ?? []).map((x: any) => {
          const nome = x.nome_fantasia || x.razao_social || "Cliente";
          return { ref: { tipo: "cliente", id: x.id }, rotulo: nome, titulo: nome, detalhe: [x.cnpj, x.cancelado ? "Cancelado" : null].filter(Boolean).join(" · ") };
        });
      }
      // atendimentos abertos que eu enxergo (a RLS recorta pelo meu setor); os meus primeiro
      const { data, error } = await tabela("support_attendances")
        .select("id, attendance_code, status, assigned_to, opened_at, contact:whatsapp_contacts(name, phone_number)")
        .eq("tenant_id", tid).in("status", ["waiting", "in_progress"])
        .order("opened_at", { ascending: false }).limit(200);
      if (error) throw error;
      const tl = t.toLocaleLowerCase("pt-BR");
      return (data ?? [])
        .map((x: any) => {
          const contato = x.contact?.name || x.contact?.phone_number || "Contato";
          return {
            ref: { tipo: "atendimento" as const, id: x.id }, rotulo: contato, titulo: contato,
            detalhe: [x.attendance_code, x.status === "waiting" ? "Na fila" : "Em atendimento", x.assigned_to === eu ? "com você" : null].filter(Boolean).join(" · "),
            meu: x.assigned_to === eu,
            busca: limpar(`${contato} ${x.contact?.phone_number ?? ""} ${x.attendance_code ?? ""}`).toLocaleLowerCase("pt-BR"),
          };
        })
        .filter((o: any) => !tl || o.busca.includes(tl))
        .sort((a: any, b: any) => Number(b.meu) - Number(a.meu))
        .slice(0, 20);
    },
  });
}

const ABAS: { tipo: TipoRef; rotulo: string; icone: typeof Ticket; placeholder: string; vazio: string }[] = [
  { tipo: "atendimento", rotulo: "Atendimento", icone: Headset, placeholder: "Nome ou telefone do contato", vazio: "Nenhum atendimento aberto que você possa ver." },
  { tipo: "ticket", rotulo: "Ticket", icone: Ticket, placeholder: "Código (TK-2026-0418) ou assunto", vazio: "Sem tickets abertos com você. Busque pelo código ou assunto." },
  { tipo: "cliente", rotulo: "Cliente", icone: Building2, placeholder: "Nome ou CNPJ", vazio: "Digite o nome ou o CNPJ do cliente." },
];

export function AnexarDialog({ aberto, tipoInicial, onFechar, onEscolher }: {
  aberto: boolean; tipoInicial: TipoRef; onFechar: () => void; onEscolher: (ref: Ref, rotulo: string) => void;
}) {
  const [tipo, setTipo] = useState<TipoRef>(tipoInicial);
  const [termo, setTermo] = useState("");
  const [atrasado, setAtrasado] = useState("");
  useEffect(() => { if (aberto) { setTipo(tipoInicial); setTermo(""); setAtrasado(""); } }, [aberto, tipoInicial]);
  useEffect(() => { const t = setTimeout(() => setAtrasado(termo), 250); return () => clearTimeout(t); }, [termo]);
  const { data = [], isFetching } = useOpcoes(tipo, atrasado, aberto);
  const aba = ABAS.find((a) => a.tipo === tipo)!;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Anexar à mensagem</DialogTitle>
          <DialogDescription>Vira um cartão vivo: cada colega vê o estado atual, com a permissão dele.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {ABAS.map((a) => (
            <button key={a.tipo} type="button" onClick={() => { setTipo(a.tipo); setTermo(""); setAtrasado(""); }}
              className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium",
                tipo === a.tipo ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              <a.icone className="h-4 w-4" />{a.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-md border px-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input id="equipe-anexar-busca" autoFocus value={termo} onChange={(e) => setTermo(e.target.value)}
            placeholder={aba.placeholder} autoComplete="off" className="h-9 w-full bg-transparent text-sm outline-none" />
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {data.length === 0 && !isFetching && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{termo ? "Nada encontrado." : aba.vazio}</li>}
          {data.map((o) => (
            <li key={o.ref.id}>
              <button type="button" onClick={() => { onEscolher(o.ref, o.rotulo); onFechar(); }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted">
                <aba.icone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{o.titulo}</span>
                  <span className="block truncate text-xs text-muted-foreground">{o.detalhe}</span>
                </span>
                {o.meu && <span className="shrink-0 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-semibold text-sky-700 dark:text-sky-300">Seu</span>}
              </button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
