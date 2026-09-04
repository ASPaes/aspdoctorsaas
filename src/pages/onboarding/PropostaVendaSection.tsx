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
import { FileText, Paperclip } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// O payload manda data em ISO (2026-09-03) porque é o formato do contrato da
// integração. Mostrar o ISO cru na tela é ruído: quem lê é brasileiro.
// Confere mês e dia para não estragar um código que só se parece com data.
const ISO_DATA = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]|$)/;
function dataBR(s: string): string | null {
  const m = ISO_DATA.exec(s);
  if (!m) return null;
  const [, a, mes, dia] = m;
  if (+mes < 1 || +mes > 12 || +dia < 1 || +dia > 31) return null;
  return `${dia}/${mes}/${a}`;
}

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
  // Estado interno do sistema de origem: identificadores, celulas de planilha
  // (K3, L7, mrrKey), percentual de preenchimento e caminhos de storage. Nada
  // disso significa coisa alguma para quem vai implantar.
  "id", "completion_percentage", "snapshot", "row", "path", "size",
  // Renderizados em bloco proprio, com nome legivel
  "itens", "modulos", "produtos", "anexos",
  // Idem: tem bloco proprio, agrupado por secao. Ficou escondido daqui ate
  // 03/09/2026 por um comentario que envelheceu ("chave UUID, ilegivel") — a
  // origem passou a mandar {pergunta, resposta} e ninguem reparou. Era por isso
  // que Segmento, Instagram, Adquirente e TODA a implantacao pareciam nao ter
  // sido puxados: chegavam e a tela escondia.
  "respostas_ticket",
]);

// Chave que e um UUID nao tem rotulo possivel — mostrar so polui.
const ehUuid = (k: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k);

function Valor({ k, v }: { k: string; v: unknown }) {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">—</span>;
  if (typeof v === "boolean") return <span>{v ? "Sim" : "Não"}</span>;
  if (Array.isArray(v)) return <span>{v.length ? v.map(String).join(", ") : "—"}</span>;
  if (typeof v === "number" && /vlr|valor|mensal|ativacao/.test(k)) return <span>{brl(v)}</span>;
  const s = String(v);
  const d = dataBR(s);
  if (d) return <span>{d}</span>;
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
  const mostra = ([k, v]: [string, unknown]) =>
    !OCULTOS.has(k) && !k.startsWith("_") && !ehUuid(k);
  const linhas = Object.entries(dados).filter((e) => mostra(e) && typeof e[1] !== "object");
  const objetos = Object.entries(dados).filter(
    (e) => mostra(e) && e[1] && typeof e[1] === "object" && !Array.isArray(e[1]),
  );
  if (!linhas.length && !objetos.length) return null;
  return (
    <div className="space-y-2">
      {titulo && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h4>
      )}
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

// Ordem de leitura do resumo em PDF que o vendedor gera na origem — é o
// documento que o especialista de implantação já usa para se alinhar, e a tela
// segue a mesma sequência para as duas coisas serem conferíveis lado a lado.
// Seção que não estiver nesta lista entra depois, na ordem em que chegou.
const SECAO_ORDEM = [
  "Classificação", "Dados Cliente", "Dados Comerciais",
  "Implantação", "Dados Contabilidade", "Outras Informações",
];
const posicaoSecao = (nome: string) => {
  const i = SECAO_ORDEM.indexOf(nome);
  return i === -1 ? SECAO_ORDEM.length : i;
};

// Faixa de seção. O mesmo device do PDF de origem: título curto em caixa alta
// sobre uma barra, para o olho achar a seção sem ler.
function FaixaSecao({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground/90
                   bg-muted/70 border-y border-border px-2.5 py-1.5 rounded-sm">
      {children}
    </h4>
  );
}

// O que o vendedor levantou no formulário, agrupado como ele preencheu.
//
// A ordem do array é a ordem da tela de origem e é preservada dentro de cada
// seção. O agrupamento sai de `secao`, que o sistema de propostas manda em cada
// resposta; sem ele, tudo cai num bloco só. Deduzir a seção pelo texto da
// pergunta seria pior do que não agrupar: quebra em silêncio no dia em que
// renomearem um campo lá, e ninguém descobre porque a tela continua desenhando.
//
// `apos` injeta um bloco logo depois de uma seção — é como a tabela de módulos
// cai entre Implantação e Contabilidade, igual ao PDF.
function Respostas({ itens, apos }: { itens: any[]; apos?: Record<string, React.ReactNode> }) {
  const grupos: { nome: string; linhas: { pergunta: string; resposta: unknown }[] }[] = [];
  for (const r of itens) {
    const pergunta = String(r?.pergunta ?? "").trim();
    if (!pergunta) continue;
    const nome = String(r?.secao ?? "").trim() || "Respostas do formulário";
    let g = grupos.find((x) => x.nome === nome);
    if (!g) {
      g = { nome, linhas: [] };
      grupos.push(g);
    }
    g.linhas.push({ pergunta, resposta: r?.resposta });
  }
  if (!grupos.length) return null;
  grupos.sort((a, b) => posicaoSecao(a.nome) - posicaoSecao(b.nome));

  // Resposta longa ("Conte tudo sobre o cliente" é um parágrafo) numa célula de
  // grade de duas colunas estica a linha inteira e deixa um buraco ao lado. Vai
  // em largura cheia, depois das curtas. É regra de tamanho, não de significado
  // — nada aqui tenta adivinhar o que a pergunta quer dizer.
  const ehLonga = (v: unknown) => String(v ?? "").length > 120;

  return (
    <>
      {grupos.map((g) => {
        const curtas = g.linhas.filter((l) => !ehLonga(l.resposta));
        const longas = g.linhas.filter((l) => ehLonga(l.resposta));
        return (
          <div key={g.nome} className="space-y-3">
            <FaixaSecao>{g.nome}</FaixaSecao>
            {curtas.length > 0 && (
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {curtas.map((l, i) => (
                  <div key={`${l.pergunta}-${i}`}
                       className="min-w-0 rounded-sm bg-muted/35 border-l-2 border-primary/45 px-2.5 py-1.5">
                    <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {l.pergunta}
                    </dt>
                    <dd className="text-sm min-w-0"><Valor k={l.pergunta} v={l.resposta} /></dd>
                  </div>
                ))}
              </dl>
            )}
            {longas.map((l, i) => (
              <div key={`${l.pergunta}-longa-${i}`}
                   className="rounded-sm bg-muted/35 border-l-2 border-primary/45 px-2.5 py-1.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {l.pergunta}
                </div>
                <div className="text-sm leading-relaxed"><Valor k={l.pergunta} v={l.resposta} /></div>
              </div>
            ))}
            {apos?.[g.nome]}
          </div>
        );
      })}
    </>
  );
}

// Cabeçalho: quem é o cliente e quanto vale. É a primeira coisa que o
// especialista procura, e hoje ele tinha que caçar isso no meio das chaves.
function CabecalhoVenda({ cliente, proposta, respostas }: {
  cliente: Record<string, any>; proposta: Record<string, any>; respostas: any[];
}) {
  const nome = cliente.nome_fantasia || cliente.razao_social || cliente.nome || "—";
  const resposta = (p: string) =>
    respostas.find((r) => String(r?.pergunta ?? "").trim().toLowerCase() === p)?.resposta;
  const vendedor = resposta("vendedor");
  const linha = [
    cliente.cnpj ? `CNPJ ${cliente.cnpj}` : null,
    cliente.contato_nome || null,
    cliente.email || null,
    vendedor ? `Vendedor: ${vendedor}` : null,
  ].filter(Boolean).join(" · ");

  const mrr = Number(proposta.valor_mrr);
  const setup = Number(proposta.valor_setup);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold leading-tight break-words">{nome}</div>
          {linha && <div className="text-xs text-muted-foreground mt-1 break-words">{linha}</div>}
        </div>
        <div className="flex gap-2 shrink-0">
          {Number.isFinite(mrr) && (
            <div className="rounded-md border border-border bg-background px-3 py-1.5 text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Mensalidade</div>
              <div className="text-sm font-semibold tabular-nums">{brl(mrr)}</div>
            </div>
          )}
          {Number.isFinite(setup) && (
            <div className="rounded-md border border-border bg-background px-3 py-1.5 text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Implantação</div>
              <div className="text-sm font-semibold tabular-nums">{brl(setup)}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Os itens como o vendedor os vendeu, com total. Vira tabela porque são números
// para conferir: em lista corrida ninguém compara coluna nenhuma.
function TabelaModulos({ itens }: { itens: any[] }) {
  if (!Array.isArray(itens) || itens.length === 0) return null;
  const somaMrr = itens.reduce((s, i) => s + (Number(i?.mrr) || 0), 0);
  const somaSetup = itens.reduce((s, i) => s + (Number(i?.setup) || 0), 0);

  return (
    <div className="space-y-3">
      <FaixaSecao>Módulos contratados</FaixaSecao>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left font-medium pb-1.5 pr-3">Módulo / item</th>
              <th className="text-right font-medium pb-1.5 px-3 w-14">Qnt</th>
              <th className="text-right font-medium pb-1.5 px-3">MRR</th>
              <th className="text-right font-medium pb-1.5 pl-3">Setup</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((it, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1.5 pr-3">{it?.nome ?? "—"}</td>
                <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground">
                  {Number(it?.quantidade) > 0 ? `x${it.quantidade}` : "—"}
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums">{brl(Number(it?.mrr) || 0)}</td>
                <td className="py-1.5 pl-3 text-right tabular-nums">{brl(Number(it?.setup) || 0)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-1.5 pr-3">Total</td>
              <td />
              <td className="py-1.5 px-3 text-right tabular-nums">{brl(somaMrr)}</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{brl(somaSetup)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// A aba so existe para jornada importada. Consulta leve — so o id — para nao
// carregar o payload inteiro apenas para decidir se desenha um botao.
export function useTemProposta(journeyId: string | null, enabled = true) {
  const { data } = useQuery({
    queryKey: ["journey-tem-proposta", journeyId],
    enabled: !!journeyId && enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("onboarding_journeys" as any) as any)
        .select("id")
        .eq("id", journeyId)
        .not("proposta_payload", "is", null)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
  return data === true;
}

export default function PropostaVendaSection({
  journeyId,
  enabled = true,
}: { journeyId: string | null; enabled?: boolean }) {
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

  // Traduz os ids do contrato em nome. Sem isto o bloco "Registrado no contrato"
  // mostra "Produto 13" e UUID de modulo — identificador nao e informacao.
  const produtoIds = (Array.isArray(data?.produtos) ? data.produtos : [])
    .map((p: any) => p?.produto_id).filter((v: any) => v != null);
  const moduloIds = (Array.isArray(data?.produtos) ? data.produtos : [])
    .flatMap((p: any) => (Array.isArray(p?.modulos) ? p.modulos : []))
    .map((m: any) => m?.modulo_id).filter(Boolean);

  const { data: nomes } = useQuery({
    queryKey: ["journey-proposta-nomes", journeyId, produtoIds.length, moduloIds.length],
    enabled: produtoIds.length > 0 || moduloIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [prod, mod] = await Promise.all([
        produtoIds.length
          ? (supabase.from("produtos" as any) as any).select("id, nome").in("id", produtoIds)
          : Promise.resolve({ data: [] }),
        moduloIds.length
          ? (supabase.from("produto_modulos" as any) as any).select("id, nome").in("id", moduloIds)
          : Promise.resolve({ data: [] }),
      ]);
      const mapa: Record<string, string> = {};
      for (const r of (prod.data ?? [])) mapa[`p${r.id}`] = r.nome;
      for (const r of (mod.data ?? [])) mapa[`m${r.id}`] = r.nome;
      return mapa;
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
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4" /> Resumo da venda
        </h3>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5">
          importado do sistema comercial
        </span>
      </div>

      <div className="space-y-6">
          <CabecalhoVenda
            cliente={cliente}
            proposta={proposta}
            respostas={Array.isArray(proposta.respostas_ticket) ? proposta.respostas_ticket : []}
          />

          {/* As seções na ordem do PDF que a origem gera, com a tabela de
              módulos caindo entre Implantação e Contabilidade, como lá. */}
          {Array.isArray(proposta.respostas_ticket) && proposta.respostas_ticket.length > 0 ? (
            <Respostas
              itens={proposta.respostas_ticket}
              apos={{ "Implantação": <TabelaModulos itens={proposta.itens} /> }}
            />
          ) : (
            <TabelaModulos itens={proposta.itens} />
          )}

          {/* Sem `secao`, a tabela ja saiu acima; com `secao`, ela saiu no meio.
              Aqui so entra o caso em que a secao Implantacao nao veio. */}
          {Array.isArray(proposta.respostas_ticket) && proposta.respostas_ticket.length > 0 &&
           !proposta.respostas_ticket.some((r: any) => String(r?.secao ?? "").trim() === "Implantação") && (
            <TabelaModulos itens={proposta.itens} />
          )}

          {produtos.length > 0 && (
            <div className="space-y-3">
              <FaixaSecao>Registrado no contrato</FaixaSecao>
              {produtos.map((p, i) => (
                <div key={i} className="rounded border border-border p-2 text-sm space-y-1">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="font-medium">
                      {p.produto_nome ?? nomes?.[`p${p.produto_id}`] ?? `Produto ${p.produto_id}`}
                    </span>
                    {p.vlr_mensal != null && <span className="text-muted-foreground">{brl(Number(p.vlr_mensal))}/mês</span>}
                    {p.vlr_ativacao != null && Number(p.vlr_ativacao) > 0 && (
                      <span className="text-muted-foreground">setup {brl(Number(p.vlr_ativacao))}</span>
                    )}
                  </div>
                  {Array.isArray(p.modulos) && p.modulos.length > 0 ? (
                    <ul className="text-muted-foreground pl-4 list-disc">
                      {p.modulos.map((m: any, j: number) => (
                        <li key={j}>
                          {m.modulo_nome ?? nomes?.[`m${m.modulo_id}`] ?? m.modulo_id}
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

          {alteracao && (
            <div className="space-y-3">
              <FaixaSecao>Alteração de contrato</FaixaSecao>
              <Grupo titulo="" dados={alteracao} />
            </div>
          )}
          {avulso && (
            <div className="space-y-3">
              <FaixaSecao>Cobrança avulsa</FaixaSecao>
              <Grupo titulo="" dados={avulso} />
            </div>
          )}

          {anexos.length > 0 && (
            <div className="space-y-3">
              <FaixaSecao>Anexos da proposta</FaixaSecao>
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

          {/* O payload como chegou. Fica fechado porque repete, em nome de
              campo, o que as seções acima já dizem em português — mas nada some:
              é aqui que aparece o que a origem manda sem ter virado pergunta,
              como a razão social da Receita e a composição da mensalidade. */}
          <details className="group">
            <summary className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground
                                cursor-pointer select-none hover:text-foreground
                                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
              Dados do envio
            </summary>
            <div className="mt-3 space-y-4 pl-1 border-l border-border">
              <div className="pl-3 space-y-4">
                <Grupo titulo="Cliente" dados={cliente} />
                <Grupo titulo="Comercial" dados={comercial} />
                <Grupo titulo="Proposta" dados={proposta} />
              </div>
            </div>
          </details>
      </div>
    </div>
  );
}
