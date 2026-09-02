import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useOemIntegracaoAtiva } from "@/hooks/useOemIntegracaoAtiva";
import { Badge } from "@/components/ui/badge";
import { Cpu, Lock, TrendingDown } from "lucide-react";
import OemLicencaEstadoBotoes from "./OemLicencaEstadoBotoes";

// ============================================================================
// As licenças do OEM deste cliente.
//
// Era um card próprio ("Licenças no OEM") logo abaixo do card do Omie; virou seção
// do card único "Integração", em três linhas: o título com as contagens, os
// números do mês e a lista de licenças.
//
// A mensalidade é do CLIENTE e o custo é da FILIAL: um cliente com três lojas
// paga uma mensalidade e consome três licenças. Por isso a margem aqui é
// mensalidade − SOMA dos custos, e não uma conta por linha.
//
// "Desativado" e "Bloqueado" são dimensões independentes, e a regra comercial
// é do Alexandre: desativado não cobra, bloqueado cobra. O custo total só
// soma as licenças ativas.
// ============================================================================

type Licenca = {
  id: string;
  filial_codigo: string | null;
  empresa_codigo: string | null;
  razao_oem: string | null;
  custo_oem: number | null;
  status_oem: string | null;
  bloqueado_oem: boolean | null;
  desativa_em: string | null;
  mensalidade_ds: number | null;
  status_usuario: string;
  resolvido_em: string | null;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Quantas vezes a mensalidade cobre o custo. Sem custo ativo não existe divisão
// — e "infinito" não é informação, então o campo simplesmente não aparece.
const num2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
// Comparar `desativa_em` (date) com o "hoje" do navegador em UTC vira erro de um
// dia inteiro à noite no Brasil: às 21h de 31/07 o UTC já é 01/08 e uma baixa
// marcada para hoje apareceria como vencida. O fuso é o da operação.
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/**
 * O status da licença como ele está no OEM, com a data quando ela existe.
 *
 * `desativa_em` é a MAIOR `datavalidade` entre os módulos ativos, gravada pela
 * sincronização (`oem-espelho-sync`). Ela quer dizer coisas diferentes conforme
 * o status, e é por isso que a leitura não pode ser só "tem data / não tem":
 *
 * - `Desativado` + data no passado (713 linhas em 01/09/2026): é o dia em que a
 *   licença caiu. É o "Desativado · 31/07/2026" que o portal do OEM mostra.
 * - `Ativo` + data no futuro: baixa já combinada. A licença está de pé e cai
 *   naquele dia — cancelar no OEM não desliga na hora, vale até o fim do mês.
 * - Sem data: o OEM não deixou rastro (licença antiga, ou nenhum módulo ativo
 *   sobrou para carregar a validade). Aí só resta o status seco, sem inventar
 *   uma data que não veio de lá.
 */
function statusDaLicenca(l: Licenca): { texto: string; classe: string } {
  if (l.status_oem === "Desativado") {
    return {
      texto: l.desativa_em ? `Desativado · ${dataBR(l.desativa_em)}` : "Desativado",
      classe: "text-muted-foreground",
    };
  }
  if (l.status_oem === "Ativo") {
    if (l.desativa_em && l.desativa_em >= hojeSP()) {
      return {
        texto: `Ativo até ${dataBR(l.desativa_em)}`,
        classe: "text-amber-600 dark:text-amber-400",
      };
    }
    return { texto: "Ativo", classe: "text-emerald-600 dark:text-emerald-400" };
  }
  return { texto: l.status_oem ?? "sem leitura", classe: "text-muted-foreground" };
}

/**
 * O que esta seção tem para mostrar — e se tem alguma coisa.
 *
 * Quem monta o card "Integração" precisa saber disso ANTES de desenhar o cabeçalho: com o OEM
 * ligado mas sem licença nem pendência, a seção não se desenha, e um card só com título é pior
 * do que card nenhum. Como é react-query, chamar o hook nos dois lugares custa uma consulta só.
 */
export function useOemDoCliente(clienteId: string) {
  const { effectiveTenantId: tid } = useTenantFilter();

  // Sem conta OEM conectada a seção nem existe — não é para aparecer vazia nos
  // tenants que não usam a integração.
  const temConta = useOemIntegracaoAtiva();

  // A FONTE DA VERDADE DO VÍNCULO É O CÓDIGO NA FICHA DO PRODUTO.
  //
  // Isto lia reconciliacao_oem por ds_customer_id e listava tudo que apontava
  // para o cliente. No grupo Bem Docado isso deu 38 licenças numa ficha só —
  // e, pior, somou o custo do grupo inteiro (R$ 1.028,53) contra a
  // mensalidade de um cliente (R$ 138,02), inventando uma margem de -R$ 890,51
  // que não existe. Ficha de cliente mostrando prejuízo falso é pior que ficha
  // sem informação nenhuma.
  //
  // ds_customer_id é PALPITE do casamento automático por CNPJ; quando o CNPJ do
  // grupo se repete, ele aponta todas as filiais para o mesmo cadastro. O que
  // vale é o par grupo+filial gravado em cliente_produtos, que só é escrito
  // quando não há dúvida.
  const { data: codigos = [] } = useQuery({
    queryKey: ["oem-codigos-cliente", tid, clienteId],
    enabled: !!tid && !!clienteId && temConta === true,
    queryFn: async () => {
      const { data, error } = await (supabase.from("cliente_produtos" as any) as any)
        .select("oem_codigo_filial")
        .eq("cliente_id", clienteId)
        .not("oem_codigo_filial", "is", null);
      if (error) throw error;
      return (data ?? []).map((r: any) => String(r.oem_codigo_filial));
    },
  });

  // Quantas licenças o de/para ainda atribui a este cliente sem confirmação.
  // Não viram lista: viram aviso, porque nenhuma delas é dele com certeza.
  const { data: pendentes = 0 } = useQuery({
    queryKey: ["oem-pendentes-cliente", tid, clienteId],
    enabled: !!tid && !!clienteId && temConta === true && codigos.length === 0,
    queryFn: async () => {
      const { count, error } = await (supabase.from("reconciliacao_oem" as any) as any)
        .select("id", { count: "exact", head: true })
        .eq("ds_customer_id", clienteId)
        .not("filial_codigo", "is", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: licencas = [] } = useQuery({
    queryKey: ["oem-licencas-cliente", tid, clienteId, codigos.join(",")],
    enabled: !!tid && !!clienteId && temConta === true && codigos.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("reconciliacao_oem" as any) as any)
        .select(
          "id, filial_codigo, empresa_codigo, razao_oem, custo_oem, status_oem, " +
          "bloqueado_oem, desativa_em, mensalidade_ds, status_usuario, resolvido_em",
        )
        .eq("tenant_id", tid)
        .in("filial_codigo", codigos)
        .order("filial_codigo");
      if (error) throw error;
      return (data ?? []) as Licenca[];
    },
  });

  const ativo = !!tid && temConta === true;
  // Vínculo indefinido: o de/para aponta para cá, mas nenhuma licença foi
  // confirmada. Dizer isso é mais útil do que listar 38 palpites.
  const indefinido = ativo && codigos.length === 0 && pendentes > 0;

  return {
    licencas: licencas as Licenca[],
    pendentes,
    indefinido,
    visivel: ativo && (licencas.length > 0 || indefinido),
  };
}

export default function IntegracaoOemSection({ clienteId }: { clienteId: string }) {
  const { licencas, pendentes, indefinido, visivel } = useOemDoCliente(clienteId);

  if (!visivel) return null;

  const cabecalho = (extra?: ReactNode, acoes?: ReactNode) => (
    <div className="flex flex-wrap items-center gap-2 mb-2.5">
      <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        OEM
      </span>
      {extra}
      {acoes && <div className="ml-auto">{acoes}</div>}
    </div>
  );

  if (indefinido) {
    return (
      <section className="px-6 py-4">
        {cabecalho(
          <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/40">
            vínculo indefinido
          </Badge>,
        )}
        <p className="text-sm text-muted-foreground">
          {pendentes === 1
            ? "Uma licença do OEM aponta para este cliente, mas o vínculo não foi confirmado."
            : `${pendentes} licenças do OEM apontam para este cliente. O casamento automático é por CNPJ e, num grupo que repete o CNPJ, ele aponta todas para o mesmo cadastro.`}{" "}
          Enquanto isso não for resolvido em <strong>Configurações › Integrações › OEM ›
          Pendências</strong>, nenhuma delas é dada como deste cliente, e nenhum custo é
          atribuído a ele aqui.
        </p>
      </section>
    );
  }

  const ativas = licencas.filter((l) => l.status_oem === "Ativo");
  const custo = ativas.reduce((a, l) => a + Number(l.custo_oem || 0), 0);
  const mensalidade = Number(licencas[0]?.mensalidade_ds || 0);
  const margem = mensalidade - custo;
  // Derivado do mesmo par custo/mensalidade que a margem: qualquer mudança em
  // um dos dois já chega aqui no próximo render, sem estado nem efeito.
  const markup = custo > 0 ? mensalidade / custo : null;
  const bloqueadas = ativas.filter((l) => l.bloqueado_oem).length;

  return (
    <section className="px-6 py-4">
      {/* Linha 1: o que é, quantas são e o que dá para fazer com elas.

          Os botões de estado só ficam no cabeçalho quando há UMA licença. Com
          duas ou mais, um botão aqui em cima não diz em qual filial ele age, e
          desligar a loja errada é o erro que não se desfaz com um clique: nesse
          caso eles descem para a linha de cada licença. Medido em 01/09/2026:
          dos 880 clientes com licença vinculada, todos têm exatamente uma, então
          o caminho normal é o do cabeçalho. */}
      {cabecalho(
        <>
          <Badge variant="secondary">
            {licencas.length} licença{licencas.length > 1 ? "s" : ""}
          </Badge>
          {bloqueadas > 0 && (
            <Badge variant="destructive" className="gap-1">
              <Lock className="h-3 w-3" /> {bloqueadas} bloqueada{bloqueadas > 1 ? "s" : ""}
            </Badge>
          )}
        </>,
        licencas.length === 1 ? (
          <OemLicencaEstadoBotoes clienteId={clienteId} licenca={licencas[0]} />
        ) : undefined,
      )}

      {/* Linha 2: o dinheiro. Um ponto menor e mais junto que o resto porque agora divide a
          largura do card com a coluna do Omie — em text-sm com gap-4 os quatro números não cabiam
          na metade e o "Markup" caía sozinho numa segunda linha. */}
      <div className="text-[13px] text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>Custo das ativas: <strong className="tabular-nums">{brl(custo)}</strong></span>
        <span>Mensalidade: <strong className="tabular-nums">{brl(mensalidade)}</strong></span>
        <span className={margem < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}>
          Margem: <strong className="tabular-nums">{brl(margem)}</strong>
          {margem < 0 && <TrendingDown className="inline h-3.5 w-3.5 ml-1" />}
        </span>
        {markup !== null && (
          <span
            className={markup < 1 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}
            title={`${brl(mensalidade)} ÷ ${brl(custo)}`}
          >
            Markup: <strong className="tabular-nums">{num2(markup)}</strong>
          </span>
        )}
      </div>

      {/* Linha 3: as licenças, uma por linha.

          Status e Bloqueado saíram de dois selos soltos para duas colunas com rótulo. O selo
          "bloqueada" só aparecia quando era verdade, então a ausência dele não distinguia
          "não está bloqueada" de "o OEM não disse" — e o selo do status nunca carregava a data.
          Com rótulo em cima, as duas dimensões estão sempre na tela, do jeito que o portal do
          OEM as mostra: Ativado/Desativado de um lado, Sim/Não do outro. */}
      <div className="mt-3 rounded-md border divide-y">
        {licencas.map((l) => {
          const st = statusDaLicenca(l);
          return (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{l.razao_oem ?? `Filial ${l.filial_codigo}`}</p>
                <p className="text-xs text-muted-foreground">
                  filial {l.filial_codigo} · grupo {l.empresa_codigo}
                  {/* `status_usuario = 'vinculado'` também é o que a
                      sincronização grava no casamento automático — o que separa
                      a decisão humana é o carimbo de quem e quando. */}
                  {l.resolvido_em && " · vinculada à mão"}
                </p>
              </div>

              <div className="shrink-0 text-left leading-tight">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/80">Status</p>
                <p className={`text-[13px] font-medium whitespace-nowrap ${st.classe}`}>{st.texto}</p>
              </div>

              <div className="shrink-0 w-[76px] text-left leading-tight">
                <p className="text-[11px] font-medium uppercase tracking-wide text-foreground/80">
                  Bloqueado
                </p>
                {/* `null` é o OEM não ter respondido essa filial na última leitura — não é "não".
                    Dizer "Não" aí seria afirmar o que ninguém verificou. */}
                <p
                  className={
                    "text-[13px] font-medium " +
                    (l.bloqueado_oem === true
                      ? "text-destructive"
                      : l.bloqueado_oem === false
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60")
                  }
                >
                  {l.bloqueado_oem === true ? (
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3 w-3" /> Sim
                    </span>
                  ) : l.bloqueado_oem === false ? (
                    "Não"
                  ) : (
                    "sem leitura"
                  )}
                </p>
              </div>

              <span className="tabular-nums text-muted-foreground w-24 text-right">
                {l.status_oem === "Ativo" ? brl(l.custo_oem) : "—"}
              </span>

              {/* Só quando o cabeçalho não pôde levá-los: com mais de uma
                  licença, a ação precisa estar do lado da filial em que ela
                  age. */}
              {licencas.length > 1 && (
                <OemLicencaEstadoBotoes clienteId={clienteId} licenca={l} />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
