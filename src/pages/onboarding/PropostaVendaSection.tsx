// Resumo da venda que originou a jornada, quando ela veio importada do sistema
// comercial externo.
//
// Arquivo separado de proposito: o JourneyDetailSheet ja passa de 4.000 linhas.
//
// A consulta e propria e sob demanda, em vez de entrar na vw_onboarding_journeys:
// o payload e um JSON grande e passaria a pesar em TODA abertura de jornada, e
// recriar aquela view de 53 colunas para acrescentar uma coluna arrisca perder o
// security_invoker (ja aconteceu neste projeto).

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronRight, FileText, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// snake_case -> "Snake case", com os rotulos que valem a pena traduzir
const ROTULOS: Record<string, string> = {
  cnpj: "CNPJ", cep: "CEP", uf: "UF", email: "E-mail",
  razao_social: "Razão social", nome_fantasia: "Nome fantasia",
  contato_nome: "Contato", nome_responsavel: "Responsável",
  vlr_mensal: "Mensalidade", vlr_ativacao: "Ativação",
  data_inicio_prevista: "Início previsto", prazo_meses: "Prazo (meses)",
  dia_vencimento: "Dia de vencimento", link_d4sign: "Contrato (D4Sign)",
  sobre_o_cliente: "Sobre o cliente", o_que_e_sucesso: "O que é sucesso",
  observacoes_internas: "Observações internas",
  ja_utilizava_sistema: "Já utilizava sistema",
  tipo_operacao: "Tipo de operação", impressora_producao: "Impressora de produção",
  configuracao_rede: "Configuração de rede", formato_treinamento: "Formato do treinamento",
  servidor_nuvem: "Servidor nuvem", menos_de_250_produtos: "Menos de 250 produtos",
  forma_pg_setup_parcelas: "Forma de pagamento do setup",
};
const rotulo = (k: string) =>
  ROTULOS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

// Campos que ja aparecem em outros lugares da jornada ou que nao dizem nada ao
// especialista de implantacao. Mostrar tudo vira parede de texto.
const OCULTOS = new Set([
  "tenant_id", "demand_type_id", "unidade_base_id", "external_ticket_id",
  "produto_id", "segmento_id", "funcionario_id", "origem_venda_id",
  "forma_pagamento_ativacao_id", "forma_pagamento_mensalidade_id",
  "cidade_id", "modulo_id", "quantidade_delta", "classificacao",
]);

function Valor({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return <span>{v ? "Sim" : "Não"}</span>;
  if (Array.isArray(v)) return <span>{v.length ? v.map(String).join(", ") : "—"}</span>;
  if (typeof v === "number" && /vlr|valor|mensal|ativacao/.test(k)) return <span>{brl(v)}</span>;
  const s = String(v);
  if (/^https?:\/\//.test(s)) {
    return (
      <a href={s} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
        abrir link
      </a>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{s}</span>;
}

function Grupo({ titulo, dados }: { titulo: string; dados: Record<string, unknown> }) {
  const linhas = Object.entries(dados).filter(
    ([k, v]) => !OCULTOS.has(k) && !k.startsWith("_") && typeof v !== "object",
  );
  const objetos = Object.entries(dados).filter(
    ([k, v]) => !OCULTOS.has(k) && v && typeof v === "object" && !Array.isArray(v),
  );
  if (!linhas.length && !objetos.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex gap-2 min-w-0">
            <dt className="text-muted-foreground shrink-0">{rotulo(k)}:</dt>
            <dd className="min-w-0"><Valor k={k} v={v} /></dd>
          </div>
        ))}
      </dl>
      {objetos.map(([k, v]) => (
        <Grupo key={k} titulo={rotulo(k)} dados={v as Record<string, unknown>} />
      ))}
    </div>
  );
}

export default function PropostaVendaSection({
  journeyId,
  enabled = true,
}: { journeyId: string | null; enabled?: boolean }) {
  const [aberto, setAberto] = useState(true);

  const { data } = useQuery({
    queryKey: ["journey-proposta", journeyId],
    enabled: !!journeyId && enabled,
    staleTime: 5 * 60_000,          // proposta nao muda depois de importada
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journeys" as any) as any)
        .select("proposta_payload")
        .eq("id", journeyId)
        .maybeSingle();
      if (error) throw error;
      return (data?.proposta_payload ?? null) as Record<string, any> | null;
    },
  });

  // Jornada criada a mao nao tem proposta: a secao simplesmente nao existe.
  if (!data) return null;

  const cliente = data.cliente ?? {};
  const comercial = data.comercial ?? {};
  const proposta = data.proposta ?? {};
  const produtos: any[] = Array.isArray(data.produtos) ? data.produtos : [];
  const anexos: any[] = Array.isArray(data.anexos) ? data.anexos : [];
  const alteracao = data.alteracao ?? null;
  const avulso = data.avulso ?? null;

  return (
    <section className="rounded-lg border border-border">
      <div className="p-3 border-b border-border flex items-center justify-between">
        <button type="button" onClick={() => setAberto((v) => !v)} className="flex items-center gap-2 flex-1 text-left">
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${aberto ? "rotate-90" : ""}`} />
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4" /> Resumo da venda
          </h3>
        </button>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
          importado
        </span>
      </div>

      {aberto && (
        <div className="p-3 space-y-4">
          <Grupo titulo="Cliente" dados={cliente} />
          <Grupo titulo="Comercial" dados={comercial} />

          {produtos.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Itens contratados
              </h4>
              {produtos.map((p, i) => (
                <div key={i} className="rounded border border-border p-2 text-sm space-y-1">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="font-medium">{p.produto_nome ?? `Produto ${p.produto_id}`}</span>
                    {p.vlr_mensal != null && <span className="text-muted-foreground">{brl(Number(p.vlr_mensal))}/mês</span>}
                    {p.vlr_ativacao != null && Number(p.vlr_ativacao) > 0 && (
                      <span className="text-muted-foreground">setup {brl(Number(p.vlr_ativacao))}</span>
                    )}
                  </div>
                  {Array.isArray(p.modulos) && p.modulos.length > 0 ? (
                    <ul className="text-muted-foreground pl-4 list-disc">
                      {p.modulos.map((m: any, j: number) => (
                        <li key={j}>
                          {m.modulo_nome ?? m.modulo_id}
                          {Number(m.quantidade) > 1 ? ` · ${m.quantidade}x` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sem módulos informados — a venda não registra o que foi contratado.
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {alteracao && <Grupo titulo="Alteração de contrato" dados={alteracao} />}
          {avulso && <Grupo titulo="Cobrança avulsa" dados={avulso} />}
          <Grupo titulo="Detalhes da proposta" dados={proposta} />

          {anexos.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Anexos da proposta
              </h4>
              <ul className="space-y-1 text-sm">
                {anexos.map((a, i) => (
                  <li key={i} className="flex items-center gap-2 min-w-0">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-primary underline truncate">
                      {a.nome_arquivo ?? a.nome ?? "anexo"}
                    </a>
                    {a.campo_label && <span className="text-muted-foreground text-xs shrink-0">({a.campo_label})</span>}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                Links do sistema de origem; podem expirar. Os arquivos guardados no ticket estão em Anexos.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
