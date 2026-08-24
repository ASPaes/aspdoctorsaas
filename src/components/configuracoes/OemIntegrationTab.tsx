import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import OemFilaSincronizacaoPanel from "./OemFilaSincronizacaoPanel";
import EscolherLicencaOemDialog from "./EscolherLicencaOemDialog";
import { useAbaNaUrl } from "@/hooks/useDeepLinkIntegracao";
import {
  Loader2, RefreshCw, Plug, Link2, HelpCircle, TrendingDown, Search, AlertTriangle, KeyRound,
  Undo2, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink,
  ArrowUpDown, ArrowUp, ArrowDown, Boxes, Plus, CalendarClock,
} from "lucide-react";
import { maskCNPJ, maskCPF } from "@/lib/masks";
import EscolherClienteOemDialog, { type LinhaRecon } from "./EscolherClienteOemDialog";
import VincularProdutoOemDialog, { type ProdutoOem, type VinculoOem } from "./VincularProdutoOemDialog";

// ============================================================================
// Integrações › OEM
//
// Espelha a estrutura da aba do Omie, mas a semântica é diferente num ponto
// que importa: no Omie a conferência procura valores IGUAIS e divergência é
// erro. Aqui os dois valores TÊM que diferir — a mensalidade é preço de venda
// e o custo é o da licença. A diferença é a margem, e é isso que se olha.
//
// Grão do vínculo é a FILIAL, não o CNPJ: medido em 14/08/2026, 188 CNPJs têm
// mais de uma filial (633 no total), um deles com 38. Cada filial é uma
// licença com custo próprio.
// ============================================================================

type Recon = {
  id: string;
  cnpj_norm: string | null;
  empresa_codigo: string | null;
  filial_codigo: string | null;
  razao_oem: string | null;
  custo_oem: number | null;
  status_oem: string | null;
  bloqueado_oem: boolean | null;
  ds_customer_id: string | null;
  razao_ds: string | null;
  mensalidade_ds: number | null;
  cancelado_ds: boolean | null;
  qtd_candidatos_ds: number;
  estado_match: string | null;
  acao_sugerida: string | null;
  status_usuario: string;
  margem: number | null;
  observacao: string | null;
  resolvido_em: string | null;
  cnpj_ds: string | null;
  divergencias: string[] | null;
  // O par que a conferência de fato comparou. razao_oem/razao_ds são nome
  // fantasia e servem para reconhecer a loja nas outras abas; aqui não valem,
  // porque não foram eles que decidiram a divergência.
  razao_social_oem: string | null;
  razao_social_ds: string | null;
  // Como o vínculo foi achado: codigo (confirmado na ficha) · cnpj · nome
  // (o CNPJ era do grupo e não desempata).
  criterio_match: string | null;
  // Quando o OEM já agendou a baixa da licença (o "Desativa em: 31/08/2026" do
  // portal). Null = sem baixa marcada.
  desativa_em: string | null;
  // Divergências que alguém marcou como certas: {tipo: assinatura aceita}.
  ignoradas: Record<string, string> | null;
};

// Um reajuste do parceiro, já agregado pela view: módulo, de → para, no dia,
// com quantos clientes pegaram e quanto isso mexeu no custo por mês.
type MudancaCusto = {
  modulo_id: string | null;
  modulo_nome: string;
  dia: string;
  valor_anterior: number | null;
  valor_novo: number | null;
  clientes: number;
  variacao_mensal: number | null;
  ocorrido_em: string;
};

// Hoje em São Paulo, no mesmo formato do `date` do Postgres — assim a
// comparação é string contra string, sem fuso no meio. `new Date(...)` em cima
// de "2026-08-31" seria lido como UTC e, no horário de Brasília, viraria dia 30.
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
// O MRR é foto do mês corrente, do dia 1 ao último: não é acumulado de período
// nenhum. Dizer qual mês é evita a leitura de que ali há soma de meses.
const mesReferencia = () =>
  new Date().toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo", month: "long", year: "numeric",
  });
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

// Uma célula da tabela de preços do parceiro: quanto o módulo custa naquele
// produto do catálogo. Não tem cliente dentro — é preço de tabela, e é o que
// diferencia esta aba das de Custos/Margem, onde o valor é o da licença.
type PrecoModulo = {
  produto_codigo: string;
  produto_nome: string;
  modulo_codigo: number;
  modulo_nome: string;
  valor_unitario: number | null;
  atualizado_em: string;
};

type Conta = {
  id: string;
  unidades_base_ids: number[] | null;
  chave_prefixo: string | null;
  api_url: string;
  ativo: boolean;
  ultimo_status: string;
  ultimo_sync_em: string | null;
  ultimo_sync_status: string | null;
  ultimo_sync_msg: string | null;
  criado_em: string;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const num2 = (v: number) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Documento vem só com dígitos das duas bases. 11 é CPF, 14 é CNPJ; o que não
// for nenhum dos dois sai como veio, sem máscara mentirosa por cima.
const doc = (v: string | null | undefined) => {
  const d = String(v ?? "").replace(/\D/g, "");
  if (!d) return "—";
  if (d.length === 11) return maskCPF(d);
  if (d.length === 14) return maskCNPJ(d);
  return d;
};

// Busca que aceita o documento como ele aparece na TELA. As duas bases guardam
// CNPJ só com dígitos, e a tela mostra com máscara: quem copiava o número do
// cadastro e colava aqui — "23.293.992/0001-98" — não achava nada, porque o
// texto guardado é "23293992000198". Compara primeiro como foi digitado e, se
// não bater, compara os dois lados sem pontuação nenhuma.
function combina(q: string, campos: (string | null | undefined)[]) {
  const alvo = campos.map((c) => String(c ?? "").toLowerCase());
  if (alvo.some((c) => c.includes(q))) return true;
  const digitos = q.replace(/\D/g, "");
  if (digitos.length < 2) return false;
  return alvo.some((c) => c.replace(/\D/g, "").includes(digitos));
}

// Colunas ordenáveis da aba Custos.
type CustoSort = "cliente" | "cnpj" | "custo_ds" | "mensalidade" | "markup" | "custo_oem" | "diferenca";

/**
 * `ao lado` é um segundo número no mesmo card — o contraponto do principal
 * (contratos daqui × licenças do OEM, markup × margem). Fica na coluna da
 * direita, na altura do número grande: embaixo ele lia como rodapé do card, e
 * a pergunta que ele responde é a mesma linha de raciocínio do número da
 * esquerda, não uma nota de pé.
 */
function Numero({
  valor, rotulo, sub, tom = "normal", ao_lado,
}: {
  valor: string; rotulo: string; sub?: React.ReactNode;
  tom?: "normal" | "bom" | "alerta" | "ruim";
  ao_lado?: { valor: React.ReactNode; rotulo: string; title?: string };
}) {
  const cor =
    tom === "bom" ? "text-emerald-600 dark:text-emerald-400"
    : tom === "alerta" ? "text-amber-600 dark:text-amber-400"
    : tom === "ruim" ? "text-destructive"
    : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-stretch justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
          <p className="text-sm font-medium mt-1">{rotulo}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        {/* Espelha a coluna da esquerda linha a linha: o rótulo na altura (e no
            tamanho) do rótulo principal, o número na do sub. Os dois lados
            respondem à mesma pergunta — tamanhos diferentes faziam um parecer
            mais importante que o outro. */}
        {/* text-left, e não right: o número alinhado pela direita ficava com o
            primeiro dígito no meio do rótulo, quebrando a régua vertical que
            todos os outros cards seguem — número e rótulo começam juntos. */}
        {ao_lado && (
          <div className="flex shrink-0 flex-col justify-end text-left" title={ao_lado.title}>
            <p className="text-sm font-medium">{ao_lado.rotulo}</p>
            <p className="text-xs text-muted-foreground tabular-nums mt-0.5">{ao_lado.valor}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Duas bases, dois vocabulários. A tela mistura as duas o tempo todo e sem
// rótulo ninguém sabe qual número está olhando: "custo" é sempre do OEM (o que
// a licença custa) e "mensalidade" é sempre do DoctorSaaS (o que o cliente
// paga). Onde aparecer valor, aparece de onde ele vem.
function Explica({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function Origem({ lado }: { lado: "oem" | "ds" }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        lado === "oem"
          ? "bg-sky-500/15 text-sky-600 dark:text-sky-400"
          : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      }`}
    >
      {lado === "oem" ? "OEM" : "DoctorSaaS"}
    </span>
  );
}

// Contar não resolve: com 342 casos, o número sozinho não diz em qual cliente
// mexer. A lista é o que transforma o diagnóstico em trabalho.
function ListaSemCodigo({
  titulo, itens, total, explica, acao,
}: {
  titulo: string;
  itens: Recon[];
  total: number;
  explica: React.ReactNode;
  acao: (l: Recon) => React.ReactNode;
}) {
  const TETO = 100;
  return (
    <div className="rounded-lg border">
      <div className="p-3 border-b">
        <p className="text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
          {total}
        </p>
        <p className="text-sm font-medium mt-1">{titulo}</p>
        <p className="text-xs text-muted-foreground mt-1">{explica}</p>
      </div>
      <div className="divide-y max-h-72 overflow-y-auto">
        {itens.slice(0, TETO).map((l) => (
          <div key={l.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate">{l.razao_ds ?? l.razao_oem ?? "—"}</p>
              <p className="text-xs text-muted-foreground truncate">
                <span className="text-sky-600 dark:text-sky-400">OEM</span> {l.razao_oem} · filial{" "}
                {l.filial_codigo} · grupo {l.empresa_codigo}
              </p>
            </div>
            <span className="tabular-nums text-muted-foreground shrink-0">
              {(Number(l.custo_oem) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
            <div className="shrink-0">{acao(l)}</div>
          </div>
        ))}
        {itens.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground text-center">
            Nada aqui com a busca atual.
          </p>
        )}
      </div>
      {itens.length > TETO && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Mostrando {TETO} de {itens.length}. Use a busca acima para chegar num caso específico.
        </p>
      )}
    </div>
  );
}

export default function OemIntegrationTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { effectiveTenantId: tid } = useTenantFilter();
  const navigate = useNavigate();
  const [sincronizando, setSincronizando] = useState(false);
  const [contaSel, setContaSel] = useState<string | null>(null);
  const [novaUnidade, setNovaUnidade] = useState<string>("");
  const [novaChave, setNovaChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [escolhendo, setEscolhendo] = useState<LinhaRecon | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [ignorandoChave, setIgnorandoChave] = useState<string | null>(null);
  // O cliente que está procurando a própria licença no OEM (a divergência
  // "Cliente sem licença"). Guarda id e nome porque o diálogo mostra o nome nos
  // dois lados da troca de vínculo.
  const [procurandoLicenca, setProcurandoLicenca] = useState<{ id: string; nome: string } | null>(null);
  // Ignorar é decisão silenciosa: some da lista e o alerta não volta enquanto o
  // dado for o mesmo. Por isso passa por confirmação, com o apontamento inteiro
  // na frente de quem decide — a mesma coisa que a dica do botão diz, só que
  // agora com o de/para do caso concreto.
  const [confirmarIgnorar, setConfirmarIgnorar] = useState<{
    chave: string; tipo: string; assinatura: string;
    reconId: string | null; clienteId: string;
    rotulo: string; detalhe: React.ReactNode;
  } | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [buscaCusto, setBuscaCusto] = useState("");
  const [paginaCusto, setPaginaCusto] = useState(0);
  const [custoSort, setCustoSort] = useState<CustoSort>("cliente");
  // Qual linha está gravando (o código da filial), e se o lote foi confirmado.
  const [atualizandoDs, setAtualizandoDs] = useState<string | null>(null);
  // Seleção por CLIENTE (o id), não por linha da página: ela sobrevive a
  // paginar, ordenar e buscar, que é o que a pessoa espera de um checkbox.
  // "A corrigir" e "Em dia" em vez de "divergente" e "conferido": o primeiro par
  // diz o que fazer, o segundo só descreve o estado — e "conferido" sugeriria
  // que alguém conferiu, quando o que houve foi o valor bater com o do OEM.
  const [filtroCusto, setFiltroCusto] = useState<"todos" | "corrigir" | "emdia">("todos");
  const [custoDir, setCustoDir] = useState<"asc" | "desc">("asc");
  // Controlado para que os atalhos "Resolver em Divergências" das abas de
  // resumo consigam levar a pessoa até onde a decisão acontece.
  // Na URL (e não em useState) desde 23/08/2026: é assim que a notificação de
  // fila parada abre direto na aba Fila, na linha que travou.
  const [aba, setAba] = useAbaNaUrl("visao");
  // Licença desativada não cobra, então divergência nela é ruído na maior parte
  // do tempo. A tela abre em "Ativo" e o usuário amplia se quiser.
  const [statusConf, setStatusConf] = useState<"Ativo" | "Desativado" | "todos">("Ativo");
  // Grade de preços: dos ~57 módulos do catálogo, a maioria está zerada em
  // quase todo produto. A tela abre igual ao portal (mostrando tudo) e quem
  // quiser enxergar só o que cobra liga o filtro.
  const [buscaModulo, setBuscaModulo] = useState("");
  const [soComValor, setSoComValor] = useState(false);
  // Qual coluna da grade está sendo vinculada a um produto do DoctorSaaS.
  const [vinculandoProduto, setVinculandoProduto] = useState<ProdutoOem | null>(null);
  const POR_PAGINA = 25;

  // Uma conta POR UNIDADE BASE, igual ao Omie. A view não tem a coluna da
  // chave nem o ponteiro do Vault — nada disso chega ao navegador.
  // O erro NÃO pode virar lista vazia: foi assim que "Nenhuma conta conectada
  // ainda" ficou aparecendo com conta conectada — a policy de leitura faltava e
  // a tela dizia que não havia nada, em vez de dizer que não conseguiu ler.
  const { data: contas = [], error: erroContas } = useQuery({
    queryKey: ["oem-contas", tid],
    queryFn: async () => {
      const { data, error } = await (supabase.from("oem_integration_status" as any) as any)
        .select("id, unidades_base_ids, chave_prefixo, api_url, ativo, ultimo_status, ultimo_sync_em, ultimo_sync_status, ultimo_sync_msg, criado_em")
        .eq("tenant_id", tid)
        .order("criado_em");
      if (error) throw error;
      return (data ?? []) as Conta[];
    },
    enabled: !!tid,
  });

  // A conta escolhida sobe para cá porque as queries abaixo dependem dela: a
  // aba inteira é da unidade desta conta, e não do tenant.
  const conta = useMemo(
    () => contas.find((c) => c.id === contaSel) ?? contas[0] ?? null,
    [contas, contaSel],
  );

  const { data: unidades = [] } = useQuery({
    queryKey: ["oem-unidades", tid],
    queryFn: async () => {
      const { data } = await (supabase.from("unidades_base" as any) as any)
        .select("id, nome").eq("tenant_id", tid).order("nome");
      return (data ?? []) as { id: number; nome: string }[];
    },
    enabled: !!tid,
  });

  // Quais licenças já têm o código gravado na ficha do cliente. Medido em
  // 15/08/2026: de 1.254 vínculos, 637 gravaram. É pelo que NÃO gravou que se
  // enxerga o buraco de cadastro — e ele não pode viver só num relatório.
  // Traz também o CUSTO do lado DoctorSaaS (`vlr_custo`, digitado na ficha do
  // produto) — é ele que a aba Custos compara com o que a licença cobra de fato
  // no OEM. Uma query só: o código da filial e o custo moram na mesma linha.
  const { data: produtosOem = [] } = useQuery({
    queryKey: ["oem-codigos-gravados", tid, conta?.id],
    enabled: !!tid,
    queryFn: () =>
      fetchAllRows<{
        oem_codigo_filial: string; cliente_id: string; produto_id: number;
        vlr_custo: number | null; ativo: boolean;
      }>(() => {
        let q = (supabase.from("cliente_produtos" as any) as any)
          .select("oem_codigo_filial, cliente_id, produto_id, vlr_custo, ativo, clientes!inner(unidade_base_id)")
          .eq("tenant_id", tid)
          .not("oem_codigo_filial", "is", null);
        // A aba é da unidade desta conta: o custo digitado na ficha de um
        // cliente de outra unidade não tem o que fazer aqui, e o código de
        // filial de outra conta poderia até casar por acaso com uma filial
        // desta e dar vínculo confirmado onde não há.
        const unidadesDaConta = conta?.unidades_base_ids ?? [];
        if (unidadesDaConta.length) q = q.in("clientes.unidade_base_id", unidadesDaConta);
        return q;
      }),
  });

  // O conjunto de filiais com código gravado continua contando TODO produto,
  // ativo ou não: o que ele responde é "o vínculo foi confirmado?", e produto
  // cancelado não desfaz confirmação.
  const filiaisComCodigo = useMemo(
    () => new Set(produtosOem.map((p) => String(p.oem_codigo_filial))),
    [produtosOem],
  );

  // Só o número da aba. O painel da fila busca o resto por conta dele — puxar a
  // lista inteira aqui carregaria a página toda por causa de um badge.
  const { data: filaParada = 0 } = useQuery({
    queryKey: ["oem-fila-badge", tid],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("fn_oem_fila_status", {
        p_tenant_id: tid ?? null,
      });
      if (error) throw error;
      const s = (data ?? {}) as { erros?: number; invalidos?: number };
      return (Number(s.erros) || 0) + (Number(s.invalidos) || 0);
    },
  });

  // Já o CUSTO só soma produto ATIVO — produto cancelado não custa mais nada, e
  // somá-lo faria a tela cobrar do cliente um custo que não existe.
  const custoDsPorFilial = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of produtosOem) {
      if (!p.ativo) continue;
      const k = String(p.oem_codigo_filial);
      m.set(k, (m.get(k) ?? 0) + Number(p.vlr_custo || 0));
    }
    return m;
  }, [produtosOem]);

  // Quantos produtos ATIVOS cada cliente tem. Sem isto a tela classificava por
  // eliminação — "não é o caso de várias filiais, então deve ser falta de
  // produto" — e rotulava de "cliente sem produto ativo" cliente com produto,
  // custo e contrato. Rótulo deduzido é rótulo que mente.
  const { data: produtosAtivos = new Map<string, number>() } = useQuery({
    queryKey: ["oem-produtos-ativos", tid],
    enabled: !!tid,
    queryFn: async () => {
      const linhas = await fetchAllRows<{ cliente_id: string }>(() =>
        (supabase.from("cliente_produtos" as any) as any)
          .select("cliente_id")
          .eq("tenant_id", tid)
          .eq("ativo", true),
      );
      const m = new Map<string, number>();
      for (const l of linhas) m.set(l.cliente_id, (m.get(l.cliente_id) ?? 0) + 1);
      return m;
    },
  });

  const rotulo = (c: Conta) =>
    (c.unidades_base_ids ?? []).map((u) => unidades.find((x) => x.id === u)?.nome ?? `Unidade ${u}`)
      .join(", ") || "Todas as unidades";

  // Sem chave, todo número desta tela é zero — e zero aqui LÊ como diagnóstico
  // ("este tenant não tem licença nenhuma") quando na verdade é falta de
  // cadastro. As outras abas ficam travadas até a chave existir.
  //
  // `erroContas` fica de fora de propósito: falha de leitura não é ausência de
  // conta. Foi assim que "Nenhuma conta conectada ainda" já apareceu com conta
  // conectada, quando faltava a policy — dizer "sem chave" ali seria repetir o
  // mesmo engano com outra roupa.
  const semConta = !erroContas && contas.length === 0;
  // Derivado em vez de efeito: com a aba travada não existe o instante entre
  // "abriu em Visão geral" e "o efeito corrigiu", que pisca a tela vazia.
  const abaEfetiva = semConta ? "conexao" : aba;
  const travada = semConta
    ? "Conecte uma chave do OEM em Conexão para liberar esta aba"
    : undefined;

  // São ~3.000 linhas: acima do teto de 1000 do PostgREST, então fetchAllRows.
  const { data: linhas = [], isLoading } = useQuery({
    queryKey: ["oem-recon", conta?.id],
    queryFn: () =>
      fetchAllRows<Recon>(() =>
        (supabase.from("reconciliacao_oem" as any) as any)
          .select(
            "id, cnpj_norm, empresa_codigo, filial_codigo, razao_oem, custo_oem, status_oem, " +
            "bloqueado_oem, ds_customer_id, razao_ds, mensalidade_ds, cancelado_ds, " +
            "qtd_candidatos_ds, estado_match, acao_sugerida, status_usuario, margem, " +
            "observacao, resolvido_em, cnpj_ds, divergencias, " +
            "razao_social_oem, razao_social_ds, criterio_match, desativa_em, ignoradas",
          )
          .eq("conta_integration_id", conta!.id),
      ),
    enabled: !!conta?.id,
  });

  // Tabela de preços desta conta. São ~120 pares produto×módulo — longe do
  // teto do PostgREST —, mas o fetchAllRows é a convenção do projeto e não
  // custa nada aqui: se o catálogo crescer, não vira bug silencioso.
  const { data: precos = [], isLoading: precosCarregando } = useQuery({
    queryKey: ["oem-precos-modulo", conta?.id],
    enabled: !!conta?.id,
    queryFn: () =>
      fetchAllRows<PrecoModulo>(() =>
        (supabase.from("oem_espelho_modulo_preco" as any) as any)
          .select("produto_codigo, produto_nome, modulo_codigo, modulo_nome, valor_unitario, atualizado_em")
          .eq("conta_integration_id", conta!.id)
          .order("modulo_codigo"),
      ),
  });

  // O de-para produto do OEM ↔ produto do DoctorSaaS. É ele que transforma a
  // grade em cadastro: sem vínculo, a coluna é só preço de tabela. Vem POR
  // CONTA, igual à grade — a mesma unidade que tem a chave tem o vínculo.
  // Reajuste que o parceiro aplicou: o custo do módulo já foi trocado em todos
  // os clientes pela carga do espelho, e esta lista é o aviso de que isso
  // aconteceu. Uma linha por módulo × valor × dia — um reajuste de "Licença
  // PDV" mexe em centenas de clientes e não pode virar centenas de linhas.
  const { data: mudancasCusto = [] } = useQuery({
    queryKey: ["oem-mudancas-custo", tid, conta?.id],
    enabled: !!tid && !!conta,
    queryFn: async () => {
      let q = (supabase.from("v_oem_mudanca_custo_modulo" as any) as any)
        .select("modulo_id, modulo_nome, dia, valor_anterior, valor_novo, clientes, variacao_mensal, ocorrido_em")
        .eq("tenant_id", tid);
      // A aba inteira é da unidade desta conta: com duas contas conectadas, uma
      // não pode ver o reajuste que atingiu os clientes da outra. O mesmo
      // recorte da contagem de contratos e da reconciliação.
      const unidadesDaConta = conta?.unidades_base_ids ?? [];
      if (unidadesDaConta.length) q = q.in("unidade_base_id", unidadesDaConta);
      const { data, error } = await q.order("ocorrido_em", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as MudancaCusto[];
    },
  });

  // O selo da aba conta só o que é NOVIDADE. Mudança de meses atrás continua na
  // lista, mas não pode manter a aba marcada para sempre — selo permanente é
  // selo que ninguém mais enxerga.
  const mudancasRecentes = useMemo(() => {
    const limite = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    return mudancasCusto.filter((m) => String(m.dia) >= limite);
  }, [mudancasCusto]);

  const { data: vinculos = [] } = useQuery({
    queryKey: ["oem-vinculos-produto", conta?.id],
    enabled: !!conta?.id,
    queryFn: async () => {
      const { data, error } = await (supabase.from("oem_produto_vinculo" as any) as any)
        .select("produto_codigo, produto_id, ultimo_upgrade_em")
        .eq("conta_integration_id", conta!.id);
      if (error) throw error;
      return (data ?? []) as VinculoOem[];
    },
  });

  const { data: produtosDs = [] } = useQuery({
    queryKey: ["oem-produtos-ds", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await (supabase.from("produtos" as any) as any)
        .select("id, nome").eq("tenant_id", tid).order("nome");
      if (error) throw error;
      return (data ?? []) as { id: number; nome: string }[];
    },
  });

  // Um produto do OEM pode virar VÁRIOS produtos do DoctorSaaS — a mesma
  // licença é vendida aqui em mais de uma linha (Servidor e Terminal).
  const vinculosPorProduto = useMemo(() => {
    const m = new Map<string, VinculoOem[]>();
    for (const v of vinculos) {
      const lista = m.get(v.produto_codigo);
      if (lista) lista.push(v); else m.set(v.produto_codigo, [v]);
    }
    return m;
  }, [vinculos]);
  const nomeProdutoDs = useMemo(
    () => new Map(produtosDs.map((p) => [p.id, p.nome])),
    [produtosDs],
  );

  // Os produtos do DoctorSaaS que representam a licença do OEM. Sem vínculo
  // não há o que comparar — e é por isso que a contagem abaixo fica desligada
  // em vez de mostrar zero, que se leria como "nenhum contrato".
  const produtosOemIds = useMemo(
    () => [...new Set(vinculos.map((v) => v.produto_id))],
    [vinculos],
  );

  // CONTRATOS ATIVOS DO LADO DAQUI, na mesma régua das licenças ativas do OEM.
  //
  // Só conta contrato que tenha item de um produto vinculado ao OEM: contar
  // todo contrato do cliente somaria o sistema fiscal de quem também tem PDV, e
  // o número deixaria de ser comparável com as filiais ativas — que é a única
  // razão de ele estar nesse card.
  //
  // A conta é feita no servidor (`head` + count exato): são ~3.700 contratos e
  // trazer as linhas para contar no navegador seria egress por nada. O `!inner`
  // não duplica o contrato que tem dois itens do mesmo produto — verificado no
  // PostgREST local com um contrato de 2 itens: veio 1.
  const { data: contratosOem, isLoading: contratosOemCarregando } = useQuery({
    queryKey: ["oem-contratos-ativos-ds", tid, conta?.id, produtosOemIds.join(",")],
    enabled: !!tid && produtosOemIds.length > 0,
    queryFn: async () => {
      let q = (supabase.from("contratos" as any) as any)
        .select(
          "id, contrato_itens!inner(cliente_produtos!inner(produto_id)), clientes!inner(unidade_base_id)",
          { count: "exact", head: true },
        )
        .eq("tenant_id", tid)
        .eq("status", "ativo")
        .in("contrato_itens.cliente_produtos.produto_id", produtosOemIds);
      // Conta com unidade definida enxerga só as unidades dela — o mesmo
      // recorte que separa as filiais de uma conta das da outra.
      const unidadesDaConta = conta?.unidades_base_ids ?? [];
      if (unidadesDaConta.length) q = q.in("clientes.unidade_base_id", unidadesDaConta);
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Monta a grade módulo × produto, que é como o portal mostra e como se lê a
  // regra comercial: a mesma linha (o módulo) custa diferente em cada coluna
  // (o produto). Célula vazia não é zero — é módulo que não existe naquele
  // produto, e confundir os dois faria a tela inventar preço.
  const grade = useMemo(() => {
    const produtos = new Map<string, string>();
    const modulos = new Map<number, { nome: string; valores: Map<string, number> }>();
    let atualizado: string | null = null;

    for (const p of precos) {
      produtos.set(p.produto_codigo, p.produto_nome);
      if (!modulos.has(p.modulo_codigo)) {
        modulos.set(p.modulo_codigo, { nome: p.modulo_nome, valores: new Map() });
      }
      modulos.get(p.modulo_codigo)!.valores.set(p.produto_codigo, Number(p.valor_unitario) || 0);
      if (!atualizado || p.atualizado_em > atualizado) atualizado = p.atualizado_em;
    }

    // Ordem pelo código, dos dois lados: é a ordem em que o OEM devolve e a que
    // o portal usa — "Gestao" primeiro, os agregados no fim. Ordenar por nome
    // jogaria o módulo principal para o meio da lista.
    const listaProdutos = [...produtos.entries()]
      .map(([codigo, nome]) => ({ codigo, nome }))
      .sort((a, b) => Number(a.codigo) - Number(b.codigo));
    const listaModulos = [...modulos.entries()]
      .map(([codigo, m]) => ({ codigo, ...m }))
      .sort((a, b) => a.codigo - b.codigo);

    return { produtos: listaProdutos, modulos: listaModulos, atualizado };
  }, [precos]);

  const modulosVisiveis = useMemo(() => {
    const q = buscaModulo.trim().toLowerCase();
    return grade.modulos.filter((m) => {
      if (soComValor && ![...m.valores.values()].some((v) => v > 0)) return false;
      if (!q) return true;
      return m.nome.toLowerCase().includes(q) || String(m.codigo).includes(q);
    });
  }, [grade.modulos, buscaModulo, soComValor]);

  // A coluna da grade vira a lista de módulos daquele produto. Só entra o que
  // existe na coluna: célula vazia é módulo que não existe naquele produto.
  function abrirVinculo(codigo: string, nome: string) {
    setVinculandoProduto({
      codigo,
      nome,
      modulos: precos
        .filter((p) => p.produto_codigo === codigo)
        .map((p) => ({
          codigo: p.modulo_codigo,
          nome: p.modulo_nome,
          valor: Number(p.valor_unitario) || 0,
        })),
    });
  }

  async function salvarChave() {
    if (!tid || !novaUnidade || !novaChave.trim()) return;
    setSalvando(true);
    try {
      const { error } = await (supabase as any).rpc("salvar_chave_oem", {
        p_tenant_id: tid,
        p_unidades: [Number(novaUnidade)],
        p_chave: novaChave.trim(),
      });
      if (error) throw error;
      toast({ title: "Conta conectada", description: "Agora atualize o espelho para trazer as filiais." });
      setNovaChave("");
      setNovaUnidade("");
      queryClient.invalidateQueries({ queryKey: ["oem-contas", tid] });
    } catch (e: any) {
      toast({ title: "Falha ao salvar", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  }

  const { data: ultimaCarga } = useQuery({
    // Por CONTA: com duas conectadas, a data da carga de uma não pode aparecer
    // no cabeçalho da outra — é ela que diz se o que está na tela é fresco.
    queryKey: ["oem-espelho-ultima", tid, conta?.id],
    queryFn: async () => {
      const { data } = await (supabase.from("oem_espelho_filial" as any) as any)
        .select("atualizado_em, last_sync_oem")
        .eq("tenant_id", tid)
        .eq("conta_integration_id", conta!.id)
        .order("atualizado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { atualizado_em: string; last_sync_oem: string | null } | null;
    },
    enabled: !!tid && !!conta,
  });

  // O CÓDIGO DA LICENÇA NO PRODUTO ERRADO.
  //
  // O vínculo por código é o mais forte que existe aqui: se a ficha diz que o
  // cliente é da filial 22043, ele casa com ela. Só que o código pode ter sido
  // gravado num produto que não é do parceiro — e aí o cliente entra na conta
  // do OEM com a receita de um produto de outra empresa.
  //
  // Medido em 24/08/2026: 8 clientes (ZOOM ZOOM BAR, a rede PASTELANDIA…) com o
  // código do OEM no produto "Gula", do fornecedor Gula Menu, R$ 500 cada. São
  // eles, e só eles, a diferença entre esta aba e o Dashboard filtrado por PDV
  // Legal: R$ 4.891 e 8 clientes. Não dá para escolher um lado e ficar quieto —
  // ou a licença é dele e o produto está errado, ou o código foi para a linha
  // errada. Os dois casos são cadastro a consertar, e agora a aba diz qual.
  const codigoEmProdutoDeOutro = useMemo(() => {
    if (!produtosOemIds.length) return new Map<string, { filial: string; produto: number }>();
    const doOem = new Set(produtosOemIds.map(Number));
    const m = new Map<string, { filial: string; produto: number }>();
    for (const p of produtosOem) {
      if (!p.oem_codigo_filial || doOem.has(Number(p.produto_id))) continue;
      m.set(p.cliente_id, { filial: String(p.oem_codigo_filial), produto: Number(p.produto_id) });
    }
    return m;
  }, [produtosOem, produtosOemIds]);

  const r = useMemo(() => {
    // Só a conferência respeita este filtro: as outras abas têm semânticas
    // próprias de status e mudá-las junto quebraria os números delas.
    const naFaixa = (l: Recon) => statusConf === "todos" || l.status_oem === statusConf;

    // REGRA DE ESCOPO (Alexandre, 16/08/2026): conferência é sobre o que está
    // vivo. Cliente cancelado no DoctorSaaS ou licença desativada no OEM não
    // entra em lista nenhuma que peça decisão — pedir vínculo para cadastro
    // morto é gerar trabalho que não muda nada. Das 426 "cliente sem produto
    // ativo", boa parte era exatamente isso.
    //
    // Desativado no OEM não cobra (regra do Alexandre: desativado não cobra,
    // bloqueado cobra), então também não há custo a reconciliar.
    const vivo = (l: Recon) => l.status_oem === "Ativo" && !l.cancelado_ds;

    // BAIXA JÁ MARCADA NO OEM. Cancelar lá não desliga na hora: a licença fica
    // ativa até o último dia do mês. Enquanto a data não chega, "ativa no OEM e
    // cancelada aqui" é o estado CERTO dos dois lados, não uma divergência.
    // Medido em 22/08/2026: os 13 alertas desse tipo eram todos assim.
    //
    // Comparar com hoje, e não guardar um "está ok", é o que faz o alerta
    // voltar sozinho: passada a data, se o OEM desativou a licença sai das
    // ativas; se alguém reativou, a data fica no passado e o alarme acende de
    // novo no dia 1º, sem ninguém precisar rodar nada.
    const hoje = hojeSP();
    const baixaMarcada = (l: Recon) =>
      l.desativa_em && l.desativa_em >= hoje ? l.desativa_em : null;

    const ativas = linhas.filter((l) => l.status_oem === "Ativo");
    const comPar = ativas.filter(
      (l) => l.ds_customer_id && l.mensalidade_ds != null && l.custo_oem != null && !l.cancelado_ds,
    );

    // Um cliente pode ter várias licenças: a mensalidade entra uma vez só, o
    // custo soma todas. É essa conta que dá a margem real do cliente.
    const porCliente = new Map<string, number>();
    const custoCliente = new Map<string, number>();
    for (const l of comPar) {
      const k = l.ds_customer_id!;
      porCliente.set(k, Number(l.mensalidade_ds || 0));
      custoCliente.set(k, (custoCliente.get(k) ?? 0) + Number(l.custo_oem || 0));
    }
    // A margem POR CLIENTE só vale onde o vínculo está confirmado. Sem isso, um
    // cadastro que recebeu as 38 licenças de um grupo aparece devendo R$ 890 —
    // número inventado por atribuição, não por prejuízo. Os totais acima
    // continuam corretos: soma de custo é soma de custo, independe de a quem
    // cada licença foi atribuída.
    const confirmado = (l: Recon) => filiaisComCodigo.has(String(l.filial_codigo));
    const porClienteNeg = [...porCliente.entries()]
      .map(([id, mensal]) => {
        const doCliente = comPar.filter((l) => l.ds_customer_id === id);
        const confirmadas = doCliente.filter(confirmado);
        const ref = doCliente[0];
        const custo = confirmadas.reduce((a, l) => a + Number(l.custo_oem || 0), 0);
        return {
          id,
          razao_ds: ref?.razao_ds ?? null,
          razao_oem: ref?.razao_oem ?? null,
          filiais: confirmadas.length,
          naoConfirmadas: doCliente.length - confirmadas.length,
          mensalidade_ds: mensal,
          custo_oem: custo,
          margem: mensal - custo,
        };
      })
      // Nenhuma licença confirmada = nada a afirmar sobre a margem dele.
      .filter((x) => x.filiais > 0 && x.margem < 0)
      .sort((a, b) => a.margem - b.margem);

    return {
      total: linhas.length,
      filiais: linhas.filter((l) => l.filial_codigo).length,
      ativas: ativas.length,
      vinculadas: ativas.filter((l) => l.acao_sugerida === "vinculo_auto_ok").length,
      // Só entra na fila quem TEM filial: cliente sem licença não tem o que
      // escolher, e o `l.filial_codigo` protege as linhas gravadas antes de a
      // sincronização parar de marcá-las como escolher_candidato.
      escolher: linhas.filter(
        (l) => l.filial_codigo && l.acao_sugerida === "escolher_candidato"
          && l.status_usuario === "novo" && vivo(l),
      ),
      decididas: linhas
        .filter((l) => l.resolvido_em && (l.status_usuario === "vinculado" || l.status_usuario === "ignorado"))
        .sort((a, b) => String(b.resolvido_em).localeCompare(String(a.resolvido_em))),
      // Licença ATIVA no OEM em cliente CANCELADO no DoctorSaaS. Não é vínculo
      // a fazer — é dinheiro saindo: a licença é cobrada e o cliente não paga
      // mais. Ficou fora das listas de decisão pela regra de escopo, e sem um
      // lugar próprio sumiria de vista justamente o caso que custa caro.
      pagandoPorCancelado: ativas
        .filter((l) => l.filial_codigo && l.cancelado_ds === true && !baixaMarcada(l))
        .sort((a, b) => Number(b.custo_oem || 0) - Number(a.custo_oem || 0)),
      // Cancelado aqui e baixa já agendada lá: está tudo certo, e por isso sai
      // das divergências. Continua visível num bloco próprio porque ainda é
      // dinheiro saindo até a data — quem confere precisa saber quanto e até
      // quando, sem que isso vire alarme vermelho.
      baixaProgramada: ativas
        .filter((l) => l.filial_codigo && l.cancelado_ds === true && baixaMarcada(l))
        .sort((a, b) => String(a.desativa_em).localeCompare(String(b.desativa_em))),
      // O CASO INVERSO, que ninguém via: o OEM vai desligar a licença e o
      // cliente está ativo aqui, pagando. Ou o cancelamento foi feito só lá, ou
      // a licença vai cair na cara do cliente. Medido em 22/08/2026: 8 filiais.
      desativaComClienteAtivo: ativas
        .filter((l) => l.filial_codigo && l.ds_customer_id && !l.cancelado_ds && baixaMarcada(l))
        .sort((a, b) => String(a.desativa_em).localeCompare(String(b.desativa_em))),
      semCliente: ativas.filter((l) => l.estado_match === "SO_NO_OEM" && l.status_usuario === "novo"),
      // Cliente que NÃO tem licença nenhuma no OEM.
      soNoDs: linhas.filter(
        (l) => l.estado_match === "SO_NO_DS" && !l.cancelado_ds
          && l.acao_sugerida !== "escolher_licenca",
      ),
      // Cliente que TEM licença — mais de uma, com o mesmo CNPJ — e ninguém
      // escolheu qual é a dele. Dizer "sem licença" aqui seria falso, e a saída
      // é outra: escolher entre as que existem.
      escolherLicenca: linhas.filter(
        (l) => l.estado_match === "SO_NO_DS" && !l.cancelado_ds
          && l.acao_sugerida === "escolher_licenca",
      ),
      // Vínculo existe mas o código não chegou à ficha do cliente. São dois
      // motivos distintos, e a saída de cada um é diferente:
      //   - o mesmo cliente recebeu mais de uma filial → falta cadastro de
      //     cliente (a regra é 1 filial = 1 cliente) ou o vínculo automático
      //     errou. Gravar o código escolheria uma filial no chute.
      //   - o cliente não tem produto ativo → não há onde gravar, e também não
      //     há de onde sair o custo.
      semCodigo: (() => {
        const todosComFilial = linhas.filter((l) => l.ds_customer_id && l.filial_codigo);
        const comFilial = todosComFilial.filter(vivo);
        // A contagem de filiais por cliente usa TODAS as linhas: uma segunda
        // filial desativada ainda torna a escolha ambígua para quem decide.
        const porCli = new Map<string, Set<string>>();
        for (const l of todosComFilial) {
          const k = l.ds_customer_id!;
          if (!porCli.has(k)) porCli.set(k, new Set());
          porCli.get(k)!.add(String(l.filial_codigo));
        }
        const pendentes = comFilial.filter((l) => !filiaisComCodigo.has(String(l.filial_codigo)));
        const nProd = (l: Recon) => produtosAtivos.get(l.ds_customer_id!) ?? 0;
        // Cada balde é uma causa VERIFICADA, com uma saída própria. O que não
        // se encaixa em nenhuma vai para "outro motivo" em vez de ser empurrado
        // para o rótulo mais próximo.
        return {
          multiplas: pendentes.filter((l) => (porCli.get(l.ds_customer_id!)?.size ?? 0) > 1),
          semProduto: pendentes.filter(
            (l) => (porCli.get(l.ds_customer_id!)?.size ?? 0) <= 1 && nProd(l) === 0),
          variosProdutos: pendentes.filter(
            (l) => (porCli.get(l.ds_customer_id!)?.size ?? 0) <= 1 && nProd(l) > 1),
          outroMotivo: pendentes.filter(
            (l) => (porCli.get(l.ds_customer_id!)?.size ?? 0) <= 1 && nProd(l) === 1),
          gravados: comFilial.length - pendentes.length,
          total: comFilial.length,
          // Fora de escopo por estarem mortos dos dois lados — contados para a
          // tela poder dizer que eles existem sem pedir trabalho por eles.
          foraDeEscopo: todosComFilial.length - comFilial.length,
        };
      })(),
      // Conferência: o vínculo está feito, mas algo deixou de bater. CNPJ vem
      // primeiro porque é o sinal forte — nome divergente é o normal entre um
      // sistema que guarda loja e outro que guarda razão social.
      // Cliente cancelado sai da conferência mesmo quando o usuário escolhe
      // "Todas": o seletor é sobre o status da LICENÇA, não sobre reabrir
      // cadastro morto.
      divCnpj: linhas.filter((l) => l.divergencias?.includes("cnpj") && naFaixa(l) && !l.cancelado_ds),
      divNome: linhas.filter(
        (l) => l.divergencias?.includes("nome") && !l.divergencias?.includes("cnpj")
          && naFaixa(l) && !l.cancelado_ds,
      ),
      confereOk: linhas.filter(
        (l) => l.ds_customer_id && l.filial_codigo && !l.divergencias?.length
          && naFaixa(l) && !l.cancelado_ds,
      ).length,
      comPar,
      clientesComPar: porCliente.size,
      // RECEITA DA OPERAÇÃO, e não a dos pares casados.
      //
      // Até 23/08/2026 a margem somava só quem tinha licença ATIVA vinculada e
      // custo conhecido: 726 clientes, R$ 281 mil. Ficavam de fora os que têm
      // produto do parceiro mas nenhuma filial casada e os de licença
      // desativada — 131 clientes e R$ 30 mil na conta da Digi Office. Eles
      // pagam, então a receita é deles também; a conta certa é "o que a
      // operação do parceiro rende aqui menos o que ela custa lá".
      //
      // A mensalidade é do CLIENTE e o custo é da FILIAL: a receita entra uma
      // vez por cliente (um cliente com 3 licenças não vale o triplo) e o custo
      // soma todas as licenças ativas.
      //
      // O recorte de quem entra já vem pronto do espelho: a reconciliação só
      // tem cliente das unidades desta conta e com produto vinculado ao OEM.
      // Por isso este número NÃO bate com o dashboard filtrado por fornecedor,
      // que soma o tenant inteiro — lá entram unidades que não têm conta OEM.
      receita: (() => {
        const porCli = new Map<string, number>();
        for (const l of linhas) {
          if (!l.ds_customer_id || l.cancelado_ds || l.mensalidade_ds == null) continue;
          porCli.set(l.ds_customer_id, Number(l.mensalidade_ds));
        }
        return [...porCli.values()].reduce((a, m) => a + m, 0);
      })(),
      clientesDaConta: new Set(
        linhas.filter((l) => l.ds_customer_id && !l.cancelado_ds).map((l) => l.ds_customer_id),
      ).size,
      custo: ativas.reduce((a, l) => a + Number(l.custo_oem || 0), 0),
      negativas: porClienteNeg,
    };
  }, [linhas, filiaisComCodigo, produtosAtivos, statusConf]);


  // ------------------------------------------------------------------ custos
  //
  // Dois custos com o mesmo nome e origens diferentes, e é por isso que a aba
  // existe: o CUSTO DS é o `vlr_custo` digitado na ficha do produto, e o CUSTO
  // OEM é o que a licença cobra de fato. Onde os dois divergem, o cadastro está
  // desatualizado — é essa a lacuna que o botão "Atualizar DS" vai fechar.
  //
  // Uma linha por CLIENTE, e só com vínculo CONFIRMADO (código gravado na ficha)
  // — pela mesma razão da aba Margem: sem confirmação, um cadastro que recebeu
  // as licenças de um grupo inteiro apareceria com um custo que não é dele.
  const custos = useMemo(() => {
    const confirmadas = linhas.filter(
      (l) =>
        l.ds_customer_id && l.filial_codigo && l.status_oem === "Ativo" && !l.cancelado_ds
        && filiaisComCodigo.has(String(l.filial_codigo)),
    );

    type Linha = {
      id: string; cliente: string; cnpj: string | null; filiais: string[];
      mensalidade: number; custo_ds: number; custo_oem: number;
    };
    const porCliente = new Map<string, Linha>();
    for (const l of confirmadas) {
      const k = l.ds_customer_id!;
      const filial = String(l.filial_codigo);
      const custoDs = custoDsPorFilial.get(filial) ?? 0;
      const atual = porCliente.get(k);
      if (!atual) {
        porCliente.set(k, {
          id: k,
          cliente: l.razao_ds ?? l.razao_oem ?? "—",
          cnpj: l.cnpj_ds ?? l.cnpj_norm ?? null,
          filiais: [filial],
          // A mensalidade é do CLIENTE: entra uma vez só, mesmo que ele tenha
          // várias licenças. O custo é da FILIAL e soma todas.
          mensalidade: Number(l.mensalidade_ds || 0),
          custo_ds: custoDs,
          custo_oem: Number(l.custo_oem || 0),
        });
      } else {
        atual.filiais.push(filial);
        atual.custo_ds += custoDs;
        atual.custo_oem += Number(l.custo_oem || 0);
      }
    }

    const lista = [...porCliente.values()].map((c) => ({
      ...c,
      // Markup é quantas vezes a mensalidade cobre o custo da licença, e o
      // divisor é SEMPRE o custo do OEM (decisão do Alexandre, 17/08/2026: o
      // valor do OEM é o correto por definição; o do DoctorSaaS é cópia que
      // pode estar velha). É o mesmo divisor do markup da ficha do cliente —
      // dois markups com o mesmo nome e denominadores diferentes seriam duas
      // respostas para a mesma pergunta.
      // Sem custo não há divisão: null é "não dá para calcular", não zero.
      markup: c.custo_oem > 0 ? c.mensalidade / c.custo_oem : null,
      // Quanto o cadastro daqui está fora do que a licença cobra. O sinal é a
      // informação: POSITIVO = Custo DS acima do OEM (a margem real é melhor
      // do que a tela do cliente mostra); NEGATIVO = abaixo (a margem real é
      // pior). É a mesma conta do total no topo do card — lá somada, aqui
      // cliente a cliente.
      diferenca: c.custo_ds - c.custo_oem,
      // Centavo de diferença já é divergência de cadastro; o que não passa
      // disso é arredondamento e não merece alarme.
      divergente: Math.abs(c.custo_ds - c.custo_oem) >= 0.01,
    }));

    const totalDs = lista.reduce((a, c) => a + c.custo_ds, 0);
    const totalOem = lista.reduce((a, c) => a + c.custo_oem, 0);
    return {
      lista,
      totalDs,
      totalOem,
      // O que a diferença SIGNIFICA, não só quanto ela é: cadastro acima do
      // que o OEM cobra faz a margem parecer pior do que é, e abaixo, melhor.
      diferenca: totalDs - totalOem,
      divergentes: lista.filter((c) => c.divergente).length,
      emDia: lista.filter((c) => !c.divergente).length,
    };
  }, [linhas, filiaisComCodigo, custoDsPorFilial]);

  // ------------------------------------------------------- Divergências
  // Uma linha por CLIENTE, e dentro dela tudo o que está errado com ele —
  // venha de onde vier. Antes, o mesmo cliente aparecia em Conferência pelo
  // CNPJ, em Custos pelo valor e em Margem pelo prejuízo, e quem resolvia
  // precisava percorrer três abas para descobrir que era o mesmo problema.
  //
  // As outras abas continuam existindo, mas viraram RESUMO: os números e o que
  // é ação de massa (atualizar custo em lote) ficam lá; a decisão caso a caso
  // acontece só aqui.
  const divergencias = useMemo(() => {
    type Item = {
      chave: string;
      tipo: string;
      rotulo: string;
      detalhe: React.ReactNode;
      grave: boolean;
      linha?: Recon;
      custo?: (typeof custos.lista)[number];
      // O que exatamente está sendo apontado. É isto que fica guardado quando
      // alguém clica em Ignorar: o item só continua escondido enquanto os
      // valores comparados forem os mesmos. Mudou o nome, o custo ou a data, a
      // divergência volta em vez de ficar calada para sempre.
      assinatura: string;
    };
    const porCliente = new Map<string, {
      id: string; nome: string; cnpj: string | null;
      itens: Item[]; ignorados: Item[]; decisoes: Recon[];
    }>();

    const doCliente = (id: string, nome: string, cnpj: string | null) => {
      let c = porCliente.get(id);
      if (!c) { c = { id, nome, cnpj, itens: [], ignorados: [], decisoes: [] }; porCliente.set(id, c); }
      // O primeiro nome não-vazio vence: algumas linhas de recon vêm só com a
      // razão do OEM, e o cliente ficaria "—" por acaso da ordem.
      if ((c.nome === "—" || !c.nome) && nome) c.nome = nome;
      if (!c.cnpj && cnpj) c.cnpj = cnpj;
      return c;
    };
    const nomeDe = (l: Recon) => l.razao_ds ?? l.razao_oem ?? "—";

    for (const l of r.divCnpj) {
      if (!l.ds_customer_id) continue;
      doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? null).itens.push({
        chave: `cnpj:${l.id}`, tipo: "cnpj", grave: true, linha: l,
        assinatura: `${l.cnpj_norm ?? ""}|${l.cnpj_ds ?? ""}|${l.filial_codigo ?? ""}`,
        rotulo: "CNPJ diferente dos dois lados",
        detalhe: <>OEM <strong>{l.cnpj_norm ?? "—"}</strong> · DoctorSaaS <strong>{l.cnpj_ds ?? "—"}</strong> · filial {l.filial_codigo}</>,
      });
    }
    for (const l of r.divNome) {
      if (!l.ds_customer_id) continue;
      doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? null).itens.push({
        chave: `nome:${l.id}`, tipo: "nome", grave: false, linha: l,
        assinatura: `${l.razao_oem ?? ""}|${l.razao_ds ?? ""}|${l.filial_codigo ?? ""}`,
        rotulo: "Só o nome diferente",
        detalhe: <>OEM <strong>{l.razao_oem ?? "—"}</strong> · DoctorSaaS <strong>{l.razao_ds ?? "—"}</strong></>,
      });
    }
    for (const c of custos.lista) {
      if (!c.divergente) continue;
      doCliente(c.id, c.cliente, c.cnpj).itens.push({
        chave: `custo:${c.id}`, tipo: "custo", grave: false, custo: c,
        assinatura: `${c.custo_ds}|${c.custo_oem}`,
        rotulo: "Custo da ficha diferente do que o OEM cobra",
        detalhe: <>ficha {brl(c.custo_ds)} · OEM {brl(c.custo_oem)} · diferença{" "}
          <strong className={c.diferenca > 0 ? "text-amber-500" : "text-destructive"}>
            {c.diferenca > 0 ? "+" : ""}{brl(c.diferenca)}
          </strong></>,
      });
    }
    for (const n of r.negativas) {
      doCliente(n.id, n.razao_ds ?? n.razao_oem ?? "—", null).itens.push({
        chave: `margem:${n.id}`, tipo: "margem", grave: true,
        assinatura: `${n.mensalidade_ds}|${n.custo_oem}`,
        rotulo: "Custa mais do que paga",
        detalhe: <>mensalidade {brl(n.mensalidade_ds)} · custo {brl(n.custo_oem)} ·{" "}
          <strong className="text-destructive">{brl(n.margem)}</strong>/mês</>,
      });
    }
    for (const l of r.pagandoPorCancelado) {
      if (!l.ds_customer_id) continue;
      doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? l.cnpj_norm ?? null).itens.push({
        chave: `cancelado:${l.id}`, tipo: "licenca_cancelado", grave: true, linha: l,
        assinatura: `${l.filial_codigo ?? ""}|${l.custo_oem ?? ""}`,
        rotulo: "Licença OEM ativa de cliente cancelado no DS",
        detalhe: <>filial {l.filial_codigo} · grupo {l.empresa_codigo} · custo{" "}
          <strong className="text-destructive">{brl(Number(l.custo_oem || 0))}</strong>/mês.
          A desativação é pedida no portal do OEM</>,
      });
    }
    for (const l of r.desativaComClienteAtivo) {
      if (!l.ds_customer_id) continue;
      doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? l.cnpj_norm ?? null).itens.push({
        chave: `desativa:${l.id}`, tipo: "desativa_ativo", grave: true, linha: l,
        assinatura: `${l.filial_codigo ?? ""}|${l.desativa_em ?? ""}`,
        rotulo: "OEM vai desativar a licença, e o cliente está ativo aqui",
        detalhe: <>filial {l.filial_codigo} · sai em{" "}
          <strong className="text-destructive">{dataBR(l.desativa_em!)}</strong> ·
          mensalidade {brl(Number(l.mensalidade_ds || 0))}. Ou o cancelamento foi feito só no
          OEM, ou o cliente vai perder o sistema na data</>,
      });
    }
    // O código da licença gravado num produto que não é do parceiro. Grave: é
    // ele que faz a receita de outro fornecedor entrar na conta do OEM.
    for (const [clienteId, info] of codigoEmProdutoDeOutro) {
      const l = linhas.find((x) => x.ds_customer_id === clienteId);
      const nomeProduto = produtosDs.find((p) => p.id === info.produto)?.nome ?? `produto ${info.produto}`;
      doCliente(clienteId, l ? nomeDe(l) : "—", l?.cnpj_ds ?? l?.cnpj_norm ?? null).itens.push({
        chave: `prodoutro:${clienteId}`, tipo: "codigo_produto_errado", grave: true, linha: l,
        assinatura: `${info.filial}|${info.produto}`,
        rotulo: "Código da licença gravado num produto de outro fornecedor",
        detalhe: <>filial {info.filial} está no produto <strong>{nomeProduto}</strong>, que não é
          do OEM. Ou a licença é de outro produto do cliente, ou o produto está com o
          fornecedor errado</>,
      });
    }
    for (const l of r.escolherLicenca) {
      if (!l.ds_customer_id) continue;
      doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? l.cnpj_norm ?? null).itens.push({
        chave: `esclic:${l.id}`, tipo: "escolher_licenca", grave: false, linha: l,
        assinatura: `escolher_licenca|${l.qtd_candidatos_ds}`,
        rotulo: "Falta escolher qual licença do OEM é deste cliente",
        detalhe: <>o CNPJ dele tem <strong>{l.qtd_candidatos_ds}</strong> licenças no OEM ·
          mensalidade {brl(Number(l.mensalidade_ds || 0))}. Enquanto ninguém escolhe, o custo
          da licença não entra na ficha</>,
      });
    }
    for (const l of r.soNoDs) {
      if (!l.ds_customer_id) continue;
      doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? null).itens.push({
        chave: `semlic:${l.id}`, tipo: "sem_licenca", grave: false, linha: l,
        assinatura: "sem_licenca",
        rotulo: "Cliente sem licença no OEM",
        detalhe: <>mensalidade {brl(Number(l.mensalidade_ds || 0))}. Ele tem produto do parceiro
          na ficha, mas nenhuma filial casou com ele</>,
      });
    }
    const motivos: [Recon[], string, string][] = [
      [r.semCodigo.multiplas, "multiplas", "mais de uma filial para o mesmo cliente"],
      [r.semCodigo.semProduto, "sem_produto", "o cliente não tem produto ativo onde gravar"],
      [r.semCodigo.variosProdutos, "varios_produtos", "mais de um produto ativo, e não dá para saber em qual gravar"],
      [r.semCodigo.outroMotivo, "outro", "outro motivo"],
    ];
    for (const [lista, sufixo, porque] of motivos) {
      for (const l of lista) {
        if (!l.ds_customer_id) continue;
        doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? null).itens.push({
          chave: `semcod:${sufixo}:${l.id}`, tipo: "sem_codigo", grave: false, linha: l,
          assinatura: `${l.filial_codigo ?? ""}|${sufixo}`,
          rotulo: "Vínculo sem o código na ficha",
          detalhe: <>filial {l.filial_codigo} · {porque}</>,
        });
      }
    }

    // Vínculo decidido à mão não é divergência — é o histórico da decisão, com
    // o caminho de volta. Mora na linha do cliente como todo o resto (é dele
    // que se trata), mas NÃO conta no selo nem no alerta da aba: contar coisa
    // já resolvida como pendência é o alarme que ensina a ignorar.
    for (const l of r.decididas) {
      if (!l.ds_customer_id) continue;
      doCliente(l.ds_customer_id, nomeDe(l), l.cnpj_ds ?? l.cnpj_norm ?? null).decisoes.push(l);
    }

    // "Está certo assim": o que alguém já conferiu sai da lista de pendências e
    // vai para o balde do próprio cliente, de onde dá para trazer de volta. A
    // comparação é com a ASSINATURA, não com o tipo: se o nome, o custo ou a
    // data mudaram depois do clique, é outra divergência e ela reaparece.
    const ignoradasDoCliente = new Map<string, Record<string, string>>();
    for (const l of linhas) {
      if (!l.ds_customer_id || !l.ignoradas) continue;
      const atual = ignoradasDoCliente.get(l.ds_customer_id) ?? {};
      ignoradasDoCliente.set(l.ds_customer_id, { ...atual, ...l.ignoradas });
    }
    for (const c of porCliente.values()) {
      const marcas = ignoradasDoCliente.get(c.id);
      if (!marcas) continue;
      const visiveis: Item[] = [];
      for (const i of c.itens) {
        if (marcas[i.tipo] === i.assinatura) c.ignorados.push(i);
        else visiveis.push(i);
      }
      c.itens = visiveis;
    }

    // Só entra quem tem algo ERRADO. Vínculo escolhido à mão está resolvido, e
    // um cliente cuja única linha é essa não tem o que decidir — aparecer aqui
    // o faria parecer problema. A decisão continua visível, mas só dentro de um
    // cliente que já esteja na lista por outro motivo.
    const lista = [...porCliente.values()].filter((c) => c.itens.length > 0).sort((a, b) => {
      const ga = a.itens.filter((i) => i.grave).length;
      const gb = b.itens.filter((i) => i.grave).length;
      if (ga !== gb) return gb - ga;
      if (a.itens.length !== b.itens.length) return b.itens.length - a.itens.length;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });

    // Licença que ainda não é de ninguém não tem cliente para entrar embaixo.
    // Fica num bloco próprio em vez de virar um cliente inventado.
    const semDono = [
      ...r.escolher.map((l) => ({ l, escolher: true })),
      ...r.semCliente
        .filter((l) => !r.escolher.some((e) => e.id === l.id))
        .map((l) => ({ l, escolher: false })),
    ];

    // As marcadas como certas vivem num bloco só, e não dentro de cada cliente:
    // cliente cuja única pendência foi ignorada sai da lista, e o caminho de
    // volta precisa existir mesmo assim.
    const ignorados = [...porCliente.values()]
      .flatMap((c) => c.ignorados.map((i) => ({ cliente: c.nome, clienteId: c.id, item: i })));

    return {
      lista,
      semDono,
      ignorados,
      // Fora do `total` de propósito: baixa combinada não é pendência, e contar
      // coisa resolvida no selo da aba é o alarme que ensina a ignorar a tela.
      programadas: r.baixaProgramada,
      total: lista.reduce((a, c) => a + c.itens.length, 0) + semDono.length,
    };
  }, [r, custos, codigoEmProdutoDeOutro, linhas, produtosDs]);

  // É este número que acende o alerta na aba.
  const totalDivergencias = divergencias.total;

  // Cada divergência tem UM caminho de saída, e é ele que vira botão. Onde a
  // saída é fora do sistema — desativar a licença no portal do OEM — o botão
  // leva à ficha, que é de onde a pessoa tira o número da filial.
  //
  // Mora numa função porque os mesmos botões aparecem em dois lugares: na fila
  // e no bloco do que foi marcado como certo. Quem volta atrás precisa das
  // mesmas saídas de quem nunca decidiu — duplicar o JSX faria as duas listas
  // divergirem no primeiro botão novo.
  type ItemDivergencia = (typeof divergencias)["lista"][number]["itens"][number];
  const acoesDaDivergencia = (i: ItemDivergencia, clienteId: string) => (
    <>
      {i.tipo === "custo" && i.custo && (
        <Button size="sm" variant="secondary" className="gap-1.5"
          disabled={atualizandoDs === i.custo.id}
          onClick={() => atualizarCustoDs(i.custo!.filiais, i.custo!.cliente, i.custo!.id)}>
          {atualizandoDs === i.custo.id
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <RefreshCw className="h-3.5 w-3.5" />}
          Ajustar custo
        </Button>
      )}
      {(i.tipo === "cnpj" || i.tipo === "nome") && i.linha && (
        <>
          <Button size="sm" variant="secondary" className="gap-1.5"
            onClick={() => setEscolhendo(i.linha!)}>
            <Link2 className="h-3.5 w-3.5" /> Trocar cliente
          </Button>
          <Button size="sm" variant="ghost"
            disabled={desfazendo === i.linha.id}
            onClick={() => desvincular(i.linha!.id)}>
            {desfazendo === i.linha.id
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : "Desfazer"}
          </Button>
        </>
      )}
      {i.tipo === "sem_codigo" && i.linha && (
        <Button size="sm" variant="secondary" className="gap-1.5"
          onClick={() => navigate(`/clientes/${clienteId}`)}>
          <ExternalLink className="h-3.5 w-3.5" /> Ajustar na ficha
        </Button>
      )}
      {/* "Cliente sem licença" é a única divergência cuja saída é escolher uma
          LICENÇA, e não um cliente: nem Ignorar nem Abrir ficha resolvem, porque
          a ficha não diz qual filial do OEM é a dele. */}
      {(i.tipo === "sem_licenca" || i.tipo === "escolher_licenca") && (
        <Button size="sm" variant="secondary" className="gap-1.5"
          onClick={() => setProcurandoLicenca({
            id: clienteId,
            nome: i.linha?.razao_ds ?? i.linha?.razao_oem ?? "este cliente",
          })}>
          <Boxes className="h-3.5 w-3.5" /> Licenças OEM
        </Button>
      )}
      {(i.tipo === "margem" || i.tipo === "sem_licenca" || i.tipo === "escolher_licenca"
        || i.tipo === "licenca_cancelado" || i.tipo === "desativa_ativo"
        || i.tipo === "codigo_produto_errado") && (
        <Button size="sm" variant="ghost" className="gap-1.5"
          onClick={() => navigate(`/clientes/${clienteId}`)}>
          <ExternalLink className="h-3.5 w-3.5" /> Abrir ficha
        </Button>
      )}
    </>
  );

  const [clienteAberto, setClienteAberto] = useState<string | null>(null);
  // Recolhido por padrão: são mais de cem licenças, e abertas elas empurram a
  // lista de clientes — que é o assunto da aba — para fora da primeira tela.
  const [semDonoAberto, setSemDonoAberto] = useState(false);
  const [programadasAberto, setProgramadasAberto] = useState(false);
  const [ignoradosAberto, setIgnoradosAberto] = useState(false);
  const [buscaDiv, setBuscaDiv] = useState("");
  const divergenciasVisiveis = useMemo(() => {
    const q = buscaDiv.trim().toLowerCase();
    if (!q) return divergencias.lista;
    return divergencias.lista.filter((c) => combina(q, [c.nome, c.cnpj]));
  }, [divergencias.lista, buscaDiv]);

  const custosVisiveis = useMemo(() => {
    const q = buscaCusto.trim().toLowerCase();
    const porEstado = filtroCusto === "todos"
      ? custos.lista
      : custos.lista.filter((c) => (filtroCusto === "corrigir" ? c.divergente : !c.divergente));
    const base = q
      ? porEstado.filter((c) => combina(q, [c.cliente, c.cnpj, ...c.filiais]))
      : porEstado;

    const dir = custoDir === "asc" ? 1 : -1;
    const numero = (c: (typeof base)[number]) =>
      custoSort === "custo_ds" ? c.custo_ds
      : custoSort === "mensalidade" ? c.mensalidade
      : custoSort === "custo_oem" ? c.custo_oem
      // Ordena pelo valor COM sinal, não pelo tamanho do erro: é o que a
      // coluna mostra. Descendo, quem está mais a maior no DS vem primeiro;
      // subindo, quem está mais a menor.
      : custoSort === "diferenca" ? c.diferenca
      : c.markup;

    return [...base].sort((a, b) => {
      if (custoSort === "cliente") return dir * a.cliente.localeCompare(b.cliente, "pt-BR");
      if (custoSort === "cnpj") return dir * String(a.cnpj ?? "").localeCompare(String(b.cnpj ?? ""));
      const na = numero(a);
      const nb = numero(b);
      // Markup incalculável fica no fim nas duas direções: ele não é o menor
      // valor da lista, é a ausência de valor.
      if (na == null) return nb == null ? 0 : 1;
      if (nb == null) return -1;
      return dir * (na - nb);
    });
  }, [custos.lista, buscaCusto, filtroCusto, custoSort, custoDir]);

  const totalPaginasCusto = Math.max(1, Math.ceil(custosVisiveis.length / POR_PAGINA));
  const paginaCustoAtual = Math.min(paginaCusto, totalPaginasCusto - 1);
  const custosPagina = custosVisiveis.slice(
    paginaCustoAtual * POR_PAGINA,
    paginaCustoAtual * POR_PAGINA + POR_PAGINA,
  );

  function ordenarCusto(campo: CustoSort) {
    if (campo === custoSort) {
      setCustoDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setCustoSort(campo);
      // Nome começa em A→Z; dinheiro, do maior para o menor, que é onde está o
      // que importa olhar.
      setCustoDir(campo === "cliente" || campo === "cnpj" ? "asc" : "desc");
    }
    setPaginaCusto(0);
  }

  // Traz o custo do OEM para o cadastro do produto. `filiais` nulo = todas as
  // elegíveis desta empresa; a RPC decide o que é elegível, não a tela, senão a
  // regra viveria em dois lugares e sairia de sincronia.
  async function atualizarCustoDs(filiais: string[] | null, rotulo: string, chave: string) {
    if (!tid) return;
    setAtualizandoDs(chave);
    try {
      const { data, error } = await (supabase as any).rpc("atualizar_custo_ds_oem", {
        p_tenant_id: tid,
        p_filiais: filiais,
      });
      if (error) throw error;
      const r = (data ?? {}) as { atualizados?: number; sem_custo_no_oem?: number; ambiguos?: number };
      // O que NÃO foi gravado precisa aparecer: um "pronto" que escondeu 12
      // linhas recusadas é pior do que não ter botão.
      const recusas: string[] = [];
      if (r.sem_custo_no_oem) recusas.push(`${r.sem_custo_no_oem} sem custo no OEM`);
      if (r.ambiguos) recusas.push(`${r.ambiguos} com mais de um produto ativo`);
      toast({
        title: r.atualizados ? `${r.atualizados} custo(s) atualizado(s)` : "Nada a atualizar",
        description: recusas.length
          ? `${rotulo}. Não gravados: ${recusas.join(" · ")}.`
          : r.atualizados ? rotulo : "Os valores já estavam iguais aos do OEM.",
      });
      queryClient.invalidateQueries({ queryKey: ["oem-codigos-gravados", tid] });
    } catch (e: any) {
      toast({ title: "Não deu para atualizar", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setAtualizandoDs(null);
    }
  }

  // Cabeçalho clicável. É função, não componente, para não remontar (e perder o
  // foco) a cada re-render da tabela.
  function thCusto(campo: CustoSort, rotulo: React.ReactNode, cls: string, direita = false) {
    const ativo = custoSort === campo;
    const Icone = !ativo ? ArrowUpDown : custoDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => ordenarCusto(campo)}
        className={`flex items-center gap-1 hover:text-foreground transition-colors ${
          direita ? "justify-end" : ""
        } ${ativo ? "text-foreground" : ""} ${cls}`}
      >
        {direita && <Icone className={`h-3 w-3 ${ativo ? "" : "opacity-40"}`} />}
        <span className="truncate">{rotulo}</span>
        {!direita && <Icone className={`h-3 w-3 ${ativo ? "" : "opacity-40"}`} />}
      </button>
    );
  }

  async function sincronizar() {
    setSincronizando(true);
    try {
      const { data, error } = await supabase.functions.invoke("oem-espelho-sync", { body: conta ? { contaId: conta.id } : {} });
      // Em erro HTTP o supabase-js só diz "non-2xx status code" e joga fora o
      // corpo. A causa real (sem permissão, chave errada, DoctorOEM fora do ar)
      // está no `mensagem` que a function devolve — vale a pena ir buscar.
      if (error) {
        const resp = (error as any)?.context;
        if (resp instanceof Response) {
          const corpo = await resp.clone().json().catch(() => null);
          if (corpo?.mensagem) throw new Error(corpo.mensagem);
        }
        throw error;
      }
      const res = (data as any)?.resultados?.[0];
      toast({
        title: "Espelho atualizado",
        description: res
          ? `${res.filiais} filiais · ${res.linhasRecon} vínculos · ${res.decisoesPreservadas} decisões preservadas`
            + (res.precosGravados ? ` · ${res.precosGravados} preços de módulo` : "")
          : "Concluído.",
      });
      // A tabela de preços é secundária: quando ela falha, o espelho das
      // filiais já subiu e o aviso não pode passar por sucesso silencioso.
      if (res?.precosErro) {
        toast({
          title: "Tabela de preços não veio",
          description: String(res.precosErro),
          variant: "destructive",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["oem-recon", conta?.id] });
      queryClient.invalidateQueries({ queryKey: ["oem-precos-modulo", conta?.id] });
      queryClient.invalidateQueries({ queryKey: ["oem-espelho-ultima", tid] });
      queryClient.invalidateQueries({ queryKey: ["oem-conexao", tid] });
    } catch (e: any) {
      toast({
        title: "Falha ao sincronizar",
        description: e?.message ?? "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setSincronizando(false);
    }
  }

  function recarregarRecon() {
    queryClient.invalidateQueries({ queryKey: ["oem-recon", conta?.id] });
  }

  // "Esta é a licença deste cliente" — grava o código na ficha e tira a linha
  // da pendência. As outras filiais que apontavam para o mesmo cadastro
  // continuam pendentes, que é o certo: cada uma precisa do seu cliente.
  async function confirmar(l: Recon) {
    if (!l.ds_customer_id) return;
    setConfirmando(l.id);
    try {
      const { error } = await (supabase as any).rpc("vincular_filial_oem", {
        p_recon_id: l.id,
        p_cliente_id: l.ds_customer_id,
      });
      if (error) throw error;
      toast({ title: "Vínculo confirmado", description: "O código foi gravado na ficha do cliente." });
      recarregarRecon();
      queryClient.invalidateQueries({ queryKey: ["oem-codigos-gravados", tid] });
    } catch (e: any) {
      toast({ title: "Não deu para confirmar", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setConfirmando(null);
    }
  }

  // ---------------------------------------------------------------- ignorar
  //
  // O terceiro caminho, que faltava na linha da divergência. "Trocar cliente" e
  // "Desfazer" partem do princípio de que o vínculo está errado; quando ele
  // está certo e só o dado é escrito diferente dos dois lados (o OEM guarda
  // "ACAISE BV 2", a ficha guarda "ACAI-SE BV 2"), nenhum dos dois serve e a
  // divergência ficava na lista para sempre.
  async function marcarIgnorada(
    chave: string, tipo: string, assinatura: string,
    reconId: string | null, clienteId: string | null, voltar = false,
  ) {
    setIgnorandoChave(chave);
    try {
      // Divergência de linha manda o id dela; a que é do cliente inteiro
      // (custo, margem) manda cliente + conta, e a marca vai em todas as
      // linhas dele.
      const args = reconId
        ? { p_recon_id: reconId, p_cliente_id: null, p_conta: null }
        : { p_recon_id: null, p_cliente_id: clienteId, p_conta: conta?.id ?? null };
      const { error } = await (supabase as any).rpc(
        voltar ? "oem_reexibir_divergencia" : "oem_ignorar_divergencia",
        voltar ? { p_tipo: tipo, ...args } : { p_tipo: tipo, p_assinatura: assinatura, ...args },
      );
      if (error) throw error;
      toast({
        title: voltar ? "Divergência de volta na lista" : "Marcada como certa",
        description: voltar
          ? "Ela volta a aparecer para ser decidida."
          : "O vínculo continua valendo. Se o que está sendo comparado mudar, ela aparece de novo.",
      });
      await recarregarRecon();
    } catch (e: any) {
      toast({
        title: "Não deu para salvar",
        description: e?.message ?? String(e),
        variant: "destructive",
      });
    } finally {
      setIgnorandoChave(null);
    }
  }

  async function desvincular(id: string) {
    setDesfazendo(id);
    try {
      const { error } = await (supabase as any).rpc("desvincular_filial_oem", { p_recon_id: id });
      if (error) throw error;
      toast({ title: "Decisão desfeita", description: "A linha volta para a fila." });
      recarregarRecon();
    } catch (e: any) {
      toast({ title: "Não deu para desfazer", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setDesfazendo(null);
    }
  }


  if (!tid) {
    return <p className="text-sm text-muted-foreground">Selecione uma empresa para ver a integração.</p>;
  }
  if (isLoading) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" /> OEM · PDV Legal / TabletCloud
            </CardTitle>
            <CardDescription>
              O espelho é alimentado pelo DoctorOEM, que sincroniza com a API do OEM a cada 6h.
              {ultimaCarga?.atualizado_em && (
                <> Última atualização deste espelho:{" "}
                  <strong>{new Date(ultimaCarga.atualizado_em).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</strong>.
                </>
              )}
              {/* A tela mistura as duas bases o tempo todo; a cor diz de qual
                  lado veio o número, e o rótulo diz o que ele é. */}
              <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-sky-500" />
                  <span className="text-sky-600 dark:text-sky-400">OEM</span>: a licença e o que
                  ela <strong>custa</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">DoctorSaaS</span>: o
                  cliente e a <strong>mensalidade</strong> que ele paga
                </span>
              </span>
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Seletor de conta, igual ao do Omie. Com uma conta só ele some —
                a tela se comporta como se o multi-conta não existisse. */}
            {contas.length > 1 && (
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={conta?.id ?? ""}
                onChange={(e) => setContaSel(e.target.value)}
              >
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>{rotulo(c)}</option>
                ))}
              </select>
            )}
            <Button onClick={sincronizar} disabled={sincronizando || !conta} className="gap-2">
              {sincronizando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {sincronizando ? "Atualizando…" : "Atualizar espelho"}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Dizer por que as abas estão apagadas. Sem isto, aba desabilitada
          parece falta de permissão, e a pessoa vai pedir acesso a alguém em vez
          de colar a chave que está na mão dela. */}
      {semConta && (
        <Card className="border-amber-500/40">
          <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <p className="min-w-0 flex-1 text-muted-foreground">
              <strong className="text-foreground">Nenhuma chave do OEM conectada nesta empresa.</strong>{" "}
              As outras abas ficam fechadas até existir uma: sem a chave não há espelho, e todo
              número delas seria zero, o que pareceria &quot;não há licenças&quot; em vez de
              &quot;falta configurar&quot;. Cole a chave abaixo, em <strong>Conexão</strong>.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs value={abaEfetiva} onValueChange={setAba} className="w-full">
        <TabsList>
          <TabsTrigger value="conexao">Conexão</TabsTrigger>
          <TabsTrigger value="modulos" className="gap-1.5" disabled={semConta} title={travada}>
            <Boxes className="h-3.5 w-3.5" /> Módulos
            {mudancasRecentes.length > 0 && (
              <Badge variant="secondary" title="Preços que o OEM mudou nos últimos 30 dias">
                {mudancasRecentes.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="visao" disabled={semConta} title={travada}>Visão geral</TabsTrigger>
          <TabsTrigger value="custos" className="gap-1.5" disabled={semConta} title={travada}>
            Custos
            {custos.divergentes > 0 && <Badge variant="secondary">{custos.divergentes}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="fila" className="gap-1.5" disabled={semConta} title={travada}>
            Sincronização
            {filaParada > 0 && <Badge variant="destructive">{filaParada}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pendencias" className="gap-1.5" disabled={semConta} title={travada}>
            {/* Esta aba é a única que ninguém abre por vontade própria: ela só
                interessa quando tem coisa dentro. O halo pulsando é para não
                dar para passar batido — e some inteiro quando o número zera,
                senão vira enfeite e a pessoa aprende a ignorar.
                `motion-safe` respeita quem desligou animação no sistema; para
                essas, o ícone e a contagem em vermelho continuam de pé. */}
            {totalDivergencias > 0 && (
              <span className="relative flex h-5 w-5 items-center justify-center" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400/50 motion-safe:animate-ping" />
                <AlertTriangle className="relative h-5 w-5 text-amber-400" />
              </span>
            )}
            Divergências
            {/* O aviso é o alerta; o número é o detalhe dele. Em tamanho cheio o
                vermelho puxava o olho primeiro e invertia essa ordem. */}
            {totalDivergencias > 0 && (
              <Badge variant="destructive" className="px-1.5 py-0 text-[10px] leading-4">
                {totalDivergencias}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* --------------------------------------------------------------- fila */}
        <TabsContent value="fila" className="space-y-3">
          <Explica>
            Toda alteração que sai daqui para a licença do parceiro passa por esta fila antes.
            Um processador roda de <strong>2 em 2 minutos</strong> e envia o que está pendente.
            O que o OEM recusar <strong>fica aqui, com o motivo escrito</strong>, em vez de
            desaparecer num aviso de tela. Linha parada tem o botão{" "}
            <strong>Tentar de novo</strong>: use depois de corrigir a causa, senão ela toma a
            mesma recusa.
          </Explica>
          <OemFilaSincronizacaoPanel />
        </TabsContent>

        {/* ------------------------------------------------------------ conexão */}
        <TabsContent value="conexao" className="space-y-4 max-w-3xl">
          <Explica>
            É aqui que o DoctorSaaS aprende de qual empresa do <strong>DoctorOEM</strong> vêm as
            filiais. A chave é gerada lá, no Nexus Hub, e colada aqui. É{" "}
            <strong>uma conta por unidade base</strong>, como no Omie, para que as filiais de uma
            unidade não se misturem com os clientes de outra. Quem fala com a API do OEM é o
            DoctorOEM; o DoctorSaaS só recebe a cópia.
          </Explica>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Contas conectadas
              </CardTitle>
              <CardDescription>
                Uma conta por unidade base, como no Omie. A chave é gerada no{' '}
                <strong>Nexus Hub</strong> e colada aqui. É ela que diz de qual empresa do
                DoctorOEM vêm as filiais.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {erroContas ? (
                <p className="text-sm text-destructive">
                  Não foi possível ler as contas conectadas: {(erroContas as any)?.message ?? "erro"}.
                </p>
              ) : contas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma conta conectada ainda.</p>
              ) : (
                <div className="rounded-md border divide-y">
                  {contas.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 p-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{rotulo(c)}</p>
                        <p className="font-mono text-xs text-muted-foreground">{c.chave_prefixo}…</p>
                      </div>
                      {c.ultimo_sync_em ? (
                        <div className="text-right">
                          <Badge variant={c.ultimo_sync_status === 'sucesso' ? 'secondary' : 'destructive'}>
                            {c.ultimo_sync_status}
                          </Badge>
                          <p className="text-xs text-muted-foreground mt-1">{c.ultimo_sync_msg}</p>
                        </div>
                      ) : (
                        <Badge variant="outline">nunca sincronizou</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conectar uma unidade</CardTitle>
              <CardDescription>
                No Nexus Hub, crie a empresa, preencha as credenciais da API do OEM e gere uma
                chave de integração. Cole aqui escolhendo a unidade que ela atende.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
                <select
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={novaUnidade}
                  onChange={(e) => setNovaUnidade(e.target.value)}
                >
                  <option value="">Escolha a unidade…</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>{u.nome}</option>
                  ))}
                </select>
                <Input
                  placeholder="oem_live_…"
                  value={novaChave}
                  onChange={(e) => setNovaChave(e.target.value)}
                  type="password"
                />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={salvarChave} disabled={salvando || !novaUnidade || !novaChave.trim()}>
                  {salvando ? 'Salvando…' : 'Conectar'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  A chave vai para o cofre do banco. Nem esta tela consegue lê-la de volta:
                  para trocar, gere outra no Nexus Hub e cole aqui.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ módulos */}
        <TabsContent value="modulos" className="space-y-3">
          <Explica>
            A <strong>tabela de preços</strong> da sua conta no OEM: quanto{" "}
            <strong>cada módulo custa</strong> em cada produto do catálogo. É a mesma grade de{" "}
            <strong>Dados da empresa › Regras comerciais</strong> do portal, e vem{" "}
            <strong>por conta conectada</strong>, cada unidade com a sua. Isto é preço de{" "}
            <strong>tabela</strong>, não o que um cliente paga: a licença de cada filial pode ter
            valor negociado, e é ela que aparece na aba Custos.
            <br />
            No topo de cada coluna dá para <strong>vincular o produto do OEM a um produto
            cadastrado no DoctorSaaS</strong> e, se você quiser, trazer os módulos daquela coluna
            para dentro dele, com o custo de cada um saindo deste preço de tabela.
          </Explica>

          {/* O reajuste do parceiro já foi aplicado sozinho em todos os
              clientes quando o espelho atualizou — este bloco é para isso não
              acontecer em silêncio. É custo: o que o cliente paga não muda
              aqui, o repasse continua sendo decisão de gente.

              Aparece SEMPRE, inclusive vazio. Some quando não há reajuste era
              pior do que parece: quem abre a aba não descobre que o sistema
              vigia isso, e quem sabia que a vigilância existe não consegue
              distinguir "nada mudou" de "quebrou". O vazio diz desde quando
              está olhando, que é a única coisa que ele tem a dizer. */}
          {(
            <Card className={mudancasCusto.length > 0 ? "border-sky-500/40" : undefined}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-sky-500" />
                  {mudancasCusto.length > 0
                    ? "O OEM mudou o preço destes módulos"
                    : "Mudanças de preço do OEM"}
                </CardTitle>
                <CardDescription>
                  Quando o parceiro reajusta um módulo, o custo é ajustado sozinho em todos os
                  clientes que o têm, na carga do espelho, e o que mudou aparece aqui. A{" "}
                  <strong>mensalidade não muda</strong>: repassar aumento é decisão sua, cliente
                  a cliente.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {mudancasCusto.length === 0 && (
                  <p className="border-t px-6 py-4 text-sm text-muted-foreground">
                    Nenhum reajuste até agora. O acompanhamento começou em{" "}
                    <strong>23/08/2026</strong>: da próxima vez que o OEM mexer no preço de um
                    módulo, ele aparece aqui com o valor antigo, o novo e quantos clientes
                    pegaram o ajuste. O que mudou antes dessa data não tem como ser recuperado,
                    porque não era registrado.
                  </p>
                )}
                <div className="divide-y border-t max-h-72 overflow-y-auto">
                  {mudancasCusto.map((m) => {
                    const variacao = Number(m.variacao_mensal || 0);
                    const subiu = Number(m.valor_novo || 0) > Number(m.valor_anterior || 0);
                    return (
                      <div key={`${m.modulo_id}:${m.dia}:${m.valor_novo}`}
                        className="flex items-center gap-3 p-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{m.modulo_nome}</p>
                          <p className="text-xs text-muted-foreground">
                            {brl(Number(m.valor_anterior || 0))} → <strong>{brl(Number(m.valor_novo || 0))}</strong>
                            {" "}por licença · {m.clientes} cliente{m.clientes > 1 ? "s" : ""} ·{" "}
                            {dataBR(String(m.dia))}
                          </p>
                        </div>
                        <span className={`tabular-nums shrink-0 font-medium ${subiu ? "text-destructive" : "text-emerald-600 dark:text-emerald-500"}`}>
                          {variacao > 0 ? "+" : ""}{brl(variacao)}/mês
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="text-base">
                  {grade.modulos.length} módulo(s) em {grade.produtos.length} produto(s)
                </CardTitle>
                <CardDescription>
                  {grade.atualizado
                    ? <>Lida do OEM em{" "}
                        <strong>
                          {new Date(grade.atualizado).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                        </strong>{" "}(atualiza junto com o espelho).</>
                    : "A grade chega no próximo Atualizar espelho."}
                </CardDescription>
              </div>
              <Button
                variant={soComValor ? "default" : "outline"}
                size="sm"
                className="shrink-0"
                onClick={() => setSoComValor((v) => !v)}
              >
                {soComValor ? "Mostrando só os que cobram" : "Só módulos com valor"}
              </Button>
            </CardHeader>

            <CardContent className="p-0">
              <div className="px-6 pb-3">
                <div className="relative max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Buscar módulo pelo nome ou código…"
                    value={buscaModulo}
                    onChange={(e) => setBuscaModulo(e.target.value)}
                  />
                </div>
              </div>

              {precosCarregando ? (
                <div className="space-y-2 px-6 pb-6">
                  {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : grade.modulos.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                  Nenhuma tabela de preços carregada ainda. Clique em{" "}
                  <strong>Atualizar espelho</strong>: ela vem junto com as filiais.
                </p>
              ) : modulosVisiveis.length === 0 ? (
                <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                  Nenhum módulo encontrado com esse filtro.
                </p>
              ) : (
                // A primeira coluna fica presa: com 6 produtos a grade rola na
                // horizontal, e sem isso o nome do módulo sai da tela — quem
                // rola perde a linha que está lendo.
                <div className="overflow-x-auto border-t">
                  <table className="w-full text-sm">
                    <thead>
                      {/* Cabeçalho e célula presa usam o MESMO tom: a coluna
                          fixa precisa ser opaca para tapar o que passa por
                          baixo, e com `bg-muted/50` na linha ela apareceria
                          mais escura que o resto do cabeçalho. */}
                      <tr className="bg-muted text-xs font-medium text-muted-foreground">
                        <th className="sticky left-0 z-10 bg-muted px-6 py-2 text-left font-medium min-w-[260px]">
                          Módulo
                        </th>
                        {/* Cada coluna carrega o vínculo com o produto do
                            DoctorSaaS: é onde a decisão está sendo tomada, e
                            uma lista separada obrigaria a conferir de novo qual
                            coluna é qual. */}
                        {grade.produtos.map((p) => {
                          const vs = vinculosPorProduto.get(p.codigo) ?? [];
                          const nomes = vs.map((v) => nomeProdutoDs.get(v.produto_id) ?? `Produto #${v.produto_id}`);
                          return (
                            <th key={p.codigo} className="px-4 py-2 text-right font-medium whitespace-nowrap align-top">
                              <div className="flex flex-col items-end gap-1">
                                <span>{p.nome}</span>
                                <Button
                                  size="sm"
                                  variant={vs.length ? "secondary" : "outline"}
                                  className="h-6 gap-1 px-2 text-[11px] font-normal"
                                  onClick={() => abrirVinculo(p.codigo, p.nome)}
                                  // Com vários vinculados o botão mostra a
                                  // contagem e os nomes vão para o title: a
                                  // coluna é estreita e o nome de um só deles
                                  // faria parecer que os outros não existem.
                                  title={vs.length
                                    ? `${nomes.join(" · ")}${vs.some((v) => v.ultimo_upgrade_em) ? "" : " (módulos ainda não importados)"}`
                                    : "Vincular a produtos do DoctorSaaS"}
                                >
                                  {vs.length ? <Link2 className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                                  <span className="max-w-[140px] truncate">
                                    {vs.length === 0 ? "Vincular produto"
                                      : vs.length === 1 ? nomes[0]
                                      : `${vs.length} produtos`}
                                  </span>
                                </Button>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    {/* Sem hover de linha de propósito: a coluna presa é opaca
                        e não acompanharia o realce, deixando a primeira coluna
                        apagada enquanto o resto da linha acende. */}
                    <tbody className="divide-y">
                      {modulosVisiveis.map((m) => (
                        <tr key={m.codigo}>
                          <td className="sticky left-0 z-10 bg-card px-6 py-2 font-medium">
                            <span className="truncate">{m.nome}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">#{m.codigo}</span>
                          </td>
                          {grade.produtos.map((p) => {
                            const v = m.valores.get(p.codigo);
                            return (
                              <td
                                key={p.codigo}
                                className={`px-4 py-2 text-right tabular-nums whitespace-nowrap ${
                                  v === undefined || v === 0 ? "text-muted-foreground" : ""
                                }`}
                              >
                                {/* Célula vazia = o módulo não existe nesse
                                    produto. Diferente de existir valendo zero. */}
                                {v === undefined ? "—" : brl(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- visão geral */}
        <TabsContent value="visao" className="space-y-4">
          <Explica>
            O resumo do cruzamento entre as <strong>licenças do OEM</strong> e os{" "}
            <strong>clientes do DoctorSaaS</strong>. Nada aqui é editável: é o retrato do que a
            última atualização do espelho encontrou. O que precisa de decisão fica na aba{" "}
            <strong>Divergências</strong>, cliente por cliente.
          </Explica>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Numero
              valor={String(r.filiais)}
              rotulo="Filiais no OEM"
              sub={`${r.ativas} ativas`}
              // O contraponto do lado daqui, na mesma altura das filiais: a
              // pergunta é uma só — o que o OEM cobra tem contrato aqui?
              ao_lado={{
                valor:
                  produtosOemIds.length === 0 || contratosOem == null
                    ? <span className="text-muted-foreground">—</span>
                    : contratosOem.toLocaleString("pt-BR"),
                rotulo: "Contratos ativos DS",
                title:
                  produtosOemIds.length === 0
                    ? "Nenhum produto do DoctorSaaS está vinculado ao OEM, e sem isso não há contrato a comparar."
                    : contratosOemCarregando
                    ? "Contando…"
                    : contratosOem == null
                    ? "Não foi possível contar os contratos do DoctorSaaS."
                    : "Contratos com status ativo que têm item de um produto vinculado ao OEM, nas unidades desta conta. Este número é do DoctorSaaS, ao vivo, e não vem do espelho.",
              }}
            />
            <Numero valor={String(r.vinculadas)} rotulo="Vinculadas automaticamente" tom="bom"
              sub={r.ativas ? `${((r.vinculadas / r.ativas) * 100).toFixed(1)}% das ativas` : undefined} />
            {/* O número ficou; a lista mudou de aba. Sem dizer para onde, quem
                lê aqui sai procurando a aba que deixou de existir. */}
            <Numero valor={String(r.escolher.length)} rotulo="Aguardando escolha"
              tom={r.escolher.length ? "alerta" : "bom"}
              sub={r.escolher.length ? "CNPJ com mais de um cliente. Resolva em Divergências" : "CNPJ com mais de um cliente"} />
            {/* Markup na mesma régua da aba Custos: mensalidade ÷ custo do OEM,
                como multiplicador. Dois markups com denominadores diferentes
                seriam duas respostas para a mesma pergunta. */}
            <Numero valor={brl(r.receita - r.custo)} rotulo="Margem mensal" tom="bom"
              // Markup na mesma linha do custo e no mesmo tamanho: ele é a
              // leitura da conta que está ali (receita ÷ custo), não um segundo
              // indicador. Régua da aba Custos — custo do OEM no divisor, sempre.
              sub={
                <>
                  <span title={r.custo > 0
                    ? `${brl(r.receita)} ÷ ${brl(r.custo)} (custo do OEM)`
                    : "Sem custo do OEM, não há como calcular o markup"}>
                    {brl(r.receita)} − {brl(r.custo)} · markup{" "}
                    {r.custo > 0 ? (
                      <span className={r.receita / r.custo < 1 ? "text-destructive font-medium" : ""}>
                        {num2(r.receita / r.custo)}×
                      </span>
                    ) : "—"}
                  </span>
                  {/* De QUEM é essa receita e de QUANDO. Sem isso, o número é
                      comparado com o do dashboard e a diferença parece erro:
                      lá o filtro por fornecedor soma o tenant inteiro, aqui
                      entram só as unidades desta conta. */}
                  <span className="block mt-0.5">
                    {r.clientesDaConta} clientes com produto do OEM nesta conta ·{" "}
                    {mesReferencia()}
                  </span>
                </>
              } />
          </div>
        </TabsContent>

        {/* ------------------------------------------------------------ custos */}
        <TabsContent value="custos" className="space-y-3">
          <Explica>
            Os dois custos da mesma licença, lado a lado. O <strong>Custo DS</strong> é o valor
            digitado na ficha do produto, dentro do DoctorSaaS; o <strong>Custo OEM</strong> é o
            que a licença cobra de fato. Esta aba é <strong>só leitura</strong>: onde os dois
            divergem, quem está desatualizado é o cadastro daqui, e a correção acontece na aba{" "}
            <strong>Divergências</strong>, junto do resto do que aquele cliente tem para resolver.
            <br /><br />
            A <strong>Diferença DS</strong> é <strong>Custo DS menos Custo OEM</strong>, e o sinal
            é a informação: com <strong>+</strong>, o cadastro daqui está cobrando custo acima do
            que a licença cobra e a margem real é <em>melhor</em> do que a ficha mostra; com{" "}
            <strong>−</strong>, está abaixo e a margem real é <em>pior</em>. A{" "}
            <strong>Mensalidade DS</strong> é o <strong>MRR atual</strong> do cliente, a base já
            com os movimentos vigentes (upsell, cross-sell, downsell e reajuste), o mesmo número
            que a ficha dele mostra em <em>MRR Atual</em>. O <strong>Markup</strong> é essa
            mensalidade dividida pelo <strong>Custo OEM</strong>: quantas vezes o que o cliente
            paga cobre o que a licença custa. O divisor é sempre o do OEM, aqui e na ficha do
            cliente, porque é ele o valor correto. Num cliente com Custo DS desatualizado, então,
            a conta do markup não fecha com o número da coluna ao lado, e quem está errado é o
            Custo DS. Só entram os clientes com <strong>vínculo confirmado</strong> e licença
            ativa: sem confirmação, o custo seria atribuído no chute.
          </Explica>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div className="min-w-0">
                <CardTitle className="text-base">
                  {custos.lista.length} cliente(s) com licença ativa
                </CardTitle>
                <CardDescription>
                  Custo DS <strong className="tabular-nums">{brl(custos.totalDs)}</strong> · Custo
                  OEM <strong className="tabular-nums">{brl(custos.totalOem)}</strong>
                  {Math.abs(custos.diferenca) >= 0.01 && (
                    <> = <strong className="tabular-nums text-amber-600 dark:text-amber-400">
                      {brl(Math.abs(custos.diferenca))}
                    </strong>{" "}
                    {/* Dizer o sentido importa: cadastro acima do que o OEM cobra
                        faz a margem parecer pior do que é; abaixo, melhor. */}
                    <span className="text-amber-600 dark:text-amber-400">
                      {custos.diferenca > 0 ? "a maior no DS" : "a menor no DS"}
                    </span></>
                  )}
                  {custos.divergentes > 0 && (
                    <> · <span className="text-amber-600 dark:text-amber-400">
                      {custos.divergentes} com valor diferente entre as duas bases
                    </span></>
                  )}
                </CardDescription>
              </div>
              {/* Corrigir saiu daqui — tabela é retrato, e o mesmo cliente que
                  está com o custo velho costuma ter outras coisas erradas junto.
                  O atalho leva para onde tudo dele aparece na mesma linha. */}
              {custos.divergentes > 0 && (
                <Button
                  variant="outline"
                  className="gap-2 shrink-0"
                  onClick={() => { setBuscaDiv(""); setAba("pendencias"); }}
                >
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Corrigir em Divergências
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              <div className="px-6 pb-3 flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Buscar por cliente, CNPJ ou filial…"
                    value={buscaCusto}
                    onChange={(e) => { setBuscaCusto(e.target.value); setPaginaCusto(0); }}
                  />
                </div>
                {/* "A corrigir" saiu: corrigir é assunto de Divergências, e um
                    balde aqui que só serve para olhar convidava a agir no lugar
                    errado. Sobrou o recorte de leitura. */}
                <div className="inline-flex rounded-md border p-0.5">
                  {([
                    ["todos", "Todos", custos.lista.length],
                    ["emdia", "Sem diferença", custos.emDia],
                  ] as const).map(([v, rot, n]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => { setFiltroCusto(v); setPaginaCusto(0); }}
                      className={`px-3 py-1.5 text-sm rounded transition-colors ${
                        filtroCusto === v
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {rot} <span className="tabular-nums opacity-70">{n}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[1064px]">
                  <div className="flex items-center gap-3 border-y bg-muted/50 px-6 py-2 text-xs font-medium text-muted-foreground">
                    {thCusto("cliente", "Cliente", "min-w-0 flex-1")}
                    {thCusto("cnpj", "CNPJ/CPF", "w-40 shrink-0")}
                    {thCusto("custo_ds", <span className="text-emerald-600 dark:text-emerald-400">Custo DS</span>, "w-28 shrink-0", true)}
                    {thCusto("mensalidade", <span className="text-emerald-600 dark:text-emerald-400">Mensalidade DS</span>, "w-32 shrink-0", true)}
                    {thCusto("markup", "Markup", "w-24 shrink-0", true)}
                    {thCusto("custo_oem", <span className="text-sky-600 dark:text-sky-400">Custo OEM</span>, "w-28 shrink-0", true)}
                    {thCusto("diferenca", "Diferença DS", "w-28 shrink-0", true)}
                    <span className="w-36 shrink-0 text-right">Ação</span>
                  </div>

                  {custosPagina.length === 0 ? (
                    <p className="px-6 py-8 text-sm text-muted-foreground text-center">
                      {custos.lista.length === 0
                        ? "Nenhum cliente com vínculo confirmado e licença ativa nesta conta."
                        : filtroCusto === "corrigir" && custos.divergentes === 0
                          ? "Nenhum cliente a corrigir: todos os custos estão iguais aos do OEM."
                          : buscaCusto.trim()
                            ? "Nenhum cliente encontrado para esta busca."
                            : "Nenhum cliente neste filtro."}
                    </p>
                  ) : (
                    <div className="divide-y">
                      {custosPagina.map((c) => (
                        <div key={c.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{c.cliente}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {c.filiais.length === 1
                                ? `filial ${c.filiais[0]}`
                                : `${c.filiais.length} filiais: ${c.filiais.join(", ")}`}
                            </p>
                          </div>
                          <span className="w-40 shrink-0 tabular-nums text-muted-foreground">
                            {doc(c.cnpj)}
                          </span>
                          <span
                            className={`w-28 shrink-0 text-right tabular-nums ${
                              c.divergente ? "text-amber-600 dark:text-amber-400 font-medium" : ""
                            }`}
                            title={c.divergente
                              ? `Diferente do OEM em ${brl(Math.abs(c.custo_ds - c.custo_oem))}`
                              : undefined}
                          >
                            {brl(c.custo_ds)}
                          </span>
                          <span className="w-32 shrink-0 text-right tabular-nums">
                            {brl(c.mensalidade)}
                          </span>
                          <span
                            className={`w-24 shrink-0 text-right tabular-nums font-medium ${
                              c.markup == null ? "text-muted-foreground"
                              : c.markup < 1 ? "text-destructive"
                              : "text-emerald-600 dark:text-emerald-400"
                            }`}
                            title={c.markup == null
                              ? "Licença sem custo no OEM, não há como calcular"
                              : `${brl(c.mensalidade)} ÷ ${brl(c.custo_oem)} (custo do OEM)`}
                          >
                            {c.markup == null ? "—" : num2(c.markup)}
                          </span>
                          <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                            {brl(c.custo_oem)}
                          </span>
                          {/* Custo DS − Custo OEM. O "+" é escrito à mão: o
                              formato de moeda só marca o negativo, e sem o
                              sinal os dois lados da diferença ficariam iguais
                              na leitura rápida. Quem está em dia mostra zero
                              apagado, não fica em branco — em branco pareceria
                              conta que não foi feita. */}
                          <span
                            className={`w-28 shrink-0 text-right tabular-nums ${
                              c.divergente
                                ? "text-amber-600 dark:text-amber-400 font-medium"
                                : "text-muted-foreground"
                            }`}
                            title={c.divergente
                              ? `${brl(c.custo_ds)} (DS) − ${brl(c.custo_oem)} (OEM): o cadastro daqui está ${
                                  brl(Math.abs(c.diferenca))
                                } ${c.diferenca > 0 ? "acima" : "abaixo"} do que a licença cobra`
                              : "O custo daqui é igual ao do OEM"}
                          >
                            {!c.divergente
                              ? brl(0)
                              : c.diferenca > 0 ? `+${brl(c.diferenca)}` : brl(c.diferenca)}
                          </span>
                          {/* Corrigir caso a caso saiu daqui: esta aba virou o
                              retrato dos dois custos lado a lado, e a correção
                              acontece em Divergências, junto do resto do que
                              aquele cliente tem de errado. O lote continua no
                              topo — ação de massa não cabe na linha de um
                              cliente só. */}
                          <span className="w-36 shrink-0 flex justify-end">
                            {c.divergente && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="gap-1.5"
                                title="Abrir este cliente na aba Divergências"
                                onClick={() => { setBuscaDiv(c.cliente); setAba("pendencias"); }}
                              >
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                Corrigir
                              </Button>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {totalPaginasCusto > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-3 text-sm">
                  <span className="text-muted-foreground">
                    {custosVisiveis.length} cliente(s) · página {paginaCustoAtual + 1} de {totalPaginasCusto}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={paginaCustoAtual === 0}
                      onClick={() => setPaginaCusto(paginaCustoAtual - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" disabled={paginaCustoAtual >= totalPaginasCusto - 1}
                      onClick={() => setPaginaCusto(paginaCustoAtual + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------------- pendências */}
        <TabsContent value="pendencias" className="space-y-3">
          <Explica>
            Uma linha por <strong>cliente</strong>. Clique na seta e ela abre uma linha para cada
            coisa que está divergindo nele: CNPJ, nome, custo, margem, licença sem código. Cada
            uma traz ao lado o botão que resolve aquele caso. É aqui que <strong>toda</strong>{" "}
            correção acontece: as outras abas mostram os números, esta é onde se decide.
            <br /><br />
            Só entra o que está <strong>vivo dos dois lados</strong>: licença ativa no OEM e
            cliente não cancelado. A exceção é <strong>licença ativa de cliente cancelado no
            DS</strong>, que não é vínculo a fazer: é dinheiro saindo, e por isso continua na
            lista. Se a baixa já estiver <strong>agendada no OEM</strong>, ela sai daqui e vai
            para o bloco de desativações programadas: até a data, ativa lá e cancelada aqui é o
            estado certo.
            <br /><br />
            Cliente de <strong>outro fornecedor não entra</strong>: quem não tem na ficha nenhum
            produto vinculado ao OEM nunca vai ter licença lá, e pedir decisão por ele seria
            trabalho que não muda nada. Os produtos que contam são os vinculados na aba{" "}
            <strong>Módulos</strong>.
          </Explica>

          {/* Licença que ainda não é de ninguém: não tem cliente para entrar
              embaixo, e inventar um só para uniformizar esconderia que ela
              ainda não foi decidida. Recolhido por padrão — são mais de cem, e
              aberto ele empurrava a lista de clientes para fora da tela. */}
          {divergencias.semDono.length > 0 && (
            <Card className="border-amber-500/40">
              <button
                type="button"
                onClick={() => setSemDonoAberto((v) => !v)}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${semDonoAberto ? "rotate-90" : ""}`}
                />
                <HelpCircle className="h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-amber-500">
                    {divergencias.semDono.length} licenças sem cliente no DoctorSaaS
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ativas e sendo cobradas no OEM, e nenhum cadastro daqui é o dono delas ·{" "}
                    {brl(divergencias.semDono.reduce((a, { l }) => a + Number(l.custo_oem || 0), 0))}/mês
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {semDonoAberto ? "recolher" : "ver lista"}
                </span>
              </button>
              {semDonoAberto && (
                <CardContent className="p-0">
                  <div className="divide-y border-t max-h-80 overflow-y-auto">
                    {divergencias.semDono.map(({ l, escolher }) => (
                      <div key={l.id} className="flex items-center gap-3 p-3 text-sm">
                        <HelpCircle className="h-4 w-4 shrink-0 text-amber-500" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{l.razao_oem ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            filial {l.filial_codigo} · grupo {l.empresa_codigo} · CNPJ {l.cnpj_norm}
                            {escolher && l.qtd_candidatos_ds
                              ? ` · ${l.qtd_candidatos_ds} candidatos` : ""}
                          </p>
                          {l.observacao && (
                            <p className="text-xs text-amber-600 dark:text-amber-400">{l.observacao}</p>
                          )}
                        </div>
                        <span className="tabular-nums text-muted-foreground w-24 text-right shrink-0">
                          {brl(Number(l.custo_oem || 0))}
                        </span>
                        <Button size="sm" variant="secondary" className="gap-1.5 shrink-0"
                          onClick={() => setEscolhendo(l)}>
                          <Link2 className="h-3.5 w-3.5" /> Escolher cliente
                        </Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* O que alguém já disse que está certo. Fica recolhido e fora do
              selo da aba: não é pendência. Mas fica VISÍVEL, porque decisão
              escondida é decisão que ninguém revisa — e daqui sai o caminho de
              volta para quem clicou sem querer. */}
          {divergencias.ignorados.length > 0 && (
            <Card>
              <button
                type="button"
                onClick={() => setIgnoradosAberto((v) => !v)}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${ignoradosAberto ? "rotate-90" : ""}`}
                />
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {divergencias.ignorados.length} divergência{divergencias.ignorados.length > 1 ? "s" : ""}{" "}
                    marcada{divergencias.ignorados.length > 1 ? "s" : ""} como certa{divergencias.ignorados.length > 1 ? "s" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    O vínculo vale e o apontamento foi aceito. Se o valor comparado mudar, a
                    divergência volta sozinha para a lista.
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {ignoradosAberto ? "recolher" : "ver lista"}
                </span>
              </button>
              {ignoradosAberto && (
                <CardContent className="p-0">
                  <div className="divide-y border-t max-h-80 overflow-y-auto">
                    {divergencias.ignorados.map(({ cliente, clienteId, item }) => (
                      <div key={`ign:${item.chave}`} className="flex items-start gap-3 p-3 text-sm">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{cliente}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.rotulo} · {item.detalhe}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5">
                          <Button
                            size="sm" variant="secondary" className="gap-1.5"
                            disabled={ignorandoChave === item.chave}
                            onClick={() => marcarIgnorada(
                              item.chave, item.tipo, item.assinatura,
                              item.linha?.id ?? null, clienteId, true,
                            )}
                          >
                            {ignorandoChave === item.chave
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Undo2 className="h-3.5 w-3.5" />}
                            Voltar para a fila de divergências
                          </Button>
                          {/* As mesmas saídas de quem está na fila: quem abre
                              este bloco pode querer resolver na hora, sem ter
                              de devolver o item para a lista primeiro. */}
                          {acoesDaDivergencia(item, clienteId)}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {/* Cancelamento que já foi feito nos dois lados e só espera a data do
              OEM. Não é alarme — é o extrato do que ainda vai ser cobrado até
              a baixa cair. Fica em cinza e fora do selo da aba de propósito. */}
          {divergencias.programadas.length > 0 && (
            <Card>
              <button
                type="button"
                onClick={() => setProgramadasAberto((v) => !v)}
                className="flex w-full items-center gap-3 p-4 text-left hover:bg-muted/30 transition-colors"
              >
                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${programadasAberto ? "rotate-90" : ""}`}
                />
                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {divergencias.programadas.length} licença{divergencias.programadas.length > 1 ? "s" : ""}{" "}
                    com desativação já programada no OEM
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cancelado aqui e baixa já agendada lá: está certo, e segue cobrando até a data ·{" "}
                    {brl(divergencias.programadas.reduce((a, l) => a + Number(l.custo_oem || 0), 0))}/mês
                  </p>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {programadasAberto ? "recolher" : "ver lista"}
                </span>
              </button>
              {programadasAberto && (
                <CardContent className="p-0">
                  <div className="divide-y border-t max-h-80 overflow-y-auto">
                    {divergencias.programadas.map((l) => (
                      <div key={l.id} className="flex items-center gap-3 p-3 text-sm">
                        <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{l.razao_ds ?? l.razao_oem ?? "—"}</p>
                          <p className="text-xs text-muted-foreground">
                            filial {l.filial_codigo} · grupo {l.empresa_codigo} · desativa em{" "}
                            <strong>{dataBR(l.desativa_em!)}</strong>
                          </p>
                        </div>
                        <span className="tabular-nums text-muted-foreground w-24 text-right shrink-0">
                          {brl(Number(l.custo_oem || 0))}
                        </span>
                        {l.ds_customer_id && (
                          <Button size="sm" variant="ghost" className="gap-1.5 shrink-0"
                            onClick={() => navigate(`/clientes/${l.ds_customer_id}`)}>
                            <ExternalLink className="h-3.5 w-3.5" /> Abrir ficha
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          )}

          {divergencias.lista.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhum cliente com divergência. Se você ainda não clicou em{" "}
              <strong>Atualizar espelho</strong> depois de gravar os códigos, a conferência ainda
              não rodou nenhuma vez.
            </CardContent></Card>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative max-w-sm flex-1 min-w-[16rem]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Buscar cliente por nome ou CNPJ" className="pl-8"
                    value={buscaDiv} onChange={(e) => setBuscaDiv(e.target.value)} />
                </div>
                <p className="text-sm text-muted-foreground">
                  <strong>{divergenciasVisiveis.length}</strong> clientes ·{" "}
                  <strong>{divergenciasVisiveis.reduce((a, c) => a + c.itens.length, 0)}</strong>{" "}
                  divergências
                </p>
              </div>

              <div className="rounded-md border divide-y">
                {divergenciasVisiveis.map((c) => {
                  const aberto = clienteAberto === c.id;
                  const graves = c.itens.filter((i) => i.grave).length;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        // A linha inteira abre: mirar a seta de 16px é o tipo de
                        // precisão que não se pede a quem está com pressa.
                        onClick={() => setClienteAberto(aberto ? null : c.id)}
                        className="flex w-full items-center gap-3 p-3 text-left text-sm hover:bg-muted/50 transition-colors"
                      >
                        <ChevronRight
                          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-90" : ""}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{c.nome}</p>
                          {c.cnpj && <p className="text-xs text-muted-foreground">CNPJ {c.cnpj}</p>}
                        </div>
                        {graves > 0 && (
                          <Badge variant="destructive" className="shrink-0">
                            {graves} grave{graves > 1 ? "s" : ""}
                          </Badge>
                        )}
                        {c.itens.length > 0 && (
                          <Badge variant="outline" className="shrink-0">
                            {c.itens.length} divergência{c.itens.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                        {/* Decisão não é pendência: entra com selo próprio, em
                            verde, para não somar ao que ainda precisa de gente. */}
                        {c.decisoes.length > 0 && (
                          <Badge variant="outline" className="shrink-0 border-emerald-600/40 text-emerald-600 dark:text-emerald-500">
                            {c.decisoes.length} decidida{c.decisoes.length > 1 ? "s" : ""} à mão
                          </Badge>
                        )}
                      </button>

                      {aberto && (
                        <div className="divide-y border-t bg-muted/20">
                          {c.itens.map((i) => (
                            <div key={i.chave} className="flex items-start gap-3 py-2.5 pl-10 pr-3 text-sm">
                              <AlertTriangle
                                className={`h-4 w-4 shrink-0 mt-0.5 ${i.grave ? "text-destructive" : "text-amber-500"}`}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium">{i.rotulo}</p>
                                <p className="text-xs text-muted-foreground">{i.detalhe}</p>
                              </div>
                              <div className="shrink-0 flex items-center gap-1.5">
                                {/* Vale para TODA divergência: às vezes o
                                    apontamento está certo e a situação também
                                    (o OEM escreve o nome de um jeito, a ficha de
                                    outro). Sem esta saída, a linha nunca sairia
                                    da lista. */}
                                <Button
                                  size="sm" variant="ghost" className="gap-1.5"
                                  title="Está certo assim: tirar da lista sem mexer no vínculo"
                                  disabled={ignorandoChave === i.chave}
                                  onClick={() => setConfirmarIgnorar({
                                    chave: i.chave, tipo: i.tipo, assinatura: i.assinatura,
                                    reconId: i.linha?.id ?? null, clienteId: c.id,
                                    rotulo: i.rotulo, detalhe: i.detalhe,
                                  })}
                                >
                                  {ignorandoChave === i.chave
                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    : <CheckCircle2 className="h-3.5 w-3.5" />}
                                  Ignorar
                                </Button>
                                {/* Cada divergência tem UM caminho de saída, e é
                                    ele que vira botão. Onde a saída é fora do
                                    sistema — desativar a licença no portal do
                                    OEM — o botão leva à ficha, que é de onde a
                                    pessoa tira o número da filial. */}
                                {acoesDaDivergencia(i, c.id)}
                              </div>
                            </div>
                          ))}

                          {/* O vínculo que alguém escolheu à mão. Fica aqui pelo
                              Desfazer: sem o caminho de volta, um clique errado
                              vira vínculo permanente — a sincronização preserva
                              a escolha errada exatamente como preservaria a
                              certa. */}
                          {c.decisoes.map((l) => (
                            <div key={`dec:${l.id}`} className="flex items-start gap-3 py-2.5 pl-10 pr-3 text-sm">
                              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-600" />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium">
                                  {l.status_usuario === "ignorado"
                                    ? "Licença ignorada à mão, não vira cliente"
                                    : "Vínculo escolhido à mão"}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {l.razao_oem ?? "—"}
                                  {l.filial_codigo && ` · filial ${l.filial_codigo}`}
                                  {l.resolvido_em &&
                                    ` · ${new Date(l.resolvido_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
                                  {" · sobrevive às próximas sincronizações"}
                                </p>
                              </div>
                              <Button
                                size="sm" variant="ghost" className="gap-1.5 shrink-0"
                                disabled={desfazendo === l.id}
                                onClick={() => desvincular(l.id)}
                              >
                                {desfazendo === l.id
                                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : <Undo2 className="h-3.5 w-3.5" />}
                                Desfazer
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Confirmação do Ignorar. Os botões respondem à pergunta do título em
          vez de dizerem "OK/Cancelar": quem lê depressa precisa entender pelo
          botão o que vai acontecer, e "manter na lista" é exatamente o que o
          não fazer significa aqui. */}
      <Dialog
        open={!!confirmarIgnorar}
        onOpenChange={(v) => { if (!v && !ignorandoChave) setConfirmarIgnorar(null); }}
      >
        {/* Dialog comum, e não AlertDialog: o AlertDialog ignora clique fora de
            propósito, para que confirmação destrutiva não seja dispensada sem
            querer. Aqui a decisão é reversível — o item volta pelo bloco de
            marcadas como certas — e prender a pessoa em dois botões incomoda
            mais do que protege. */}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Está certo assim?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3">
                <div className="rounded border p-2 text-sm">
                  <div className="font-medium">{confirmarIgnorar?.rotulo}</div>
                  <div className="text-xs text-muted-foreground">{confirmarIgnorar?.detalhe}</div>
                </div>
                <p className="text-sm">
                  Isso <strong>tira o aviso da lista sem mexer no vínculo</strong>: o cliente
                  continua ligado à mesma licença do OEM, e nada é enviado ao parceiro.
                </p>
                <p className="text-sm">
                  Fica guardado <strong>o que você está aceitando</strong>. Se o valor comparado
                  mudar depois, o aviso volta sozinho para a lista. Você também pode trazê-lo de
                  volta quando quiser, pelo bloco de divergências marcadas como certas.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={!!ignorandoChave}
              onClick={() => setConfirmarIgnorar(null)}
            >
              Não, manter na lista
            </Button>
            <Button
              disabled={!!ignorandoChave}
              onClick={() => {
                const alvo = confirmarIgnorar;
                if (!alvo) return;
                setConfirmarIgnorar(null);
                marcarIgnorada(alvo.chave, alvo.tipo, alvo.assinatura, alvo.reconId, alvo.clienteId);
              }}
            >
              {ignorandoChave ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sim, está certo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EscolherLicencaOemDialog
        cliente={procurandoLicenca}
        // A lista sai do que a aba já carregou: só as linhas que são licença de
        // verdade (as sem filial são clientes sem licença, o oposto do que se
        // procura aqui).
        licencas={linhas.filter((l) => l.filial_codigo)}
        aberto={!!procurandoLicenca}
        onOpenChange={(v) => { if (!v) setProcurandoLicenca(null); }}
        onDecidido={recarregarRecon}
      />

      <EscolherClienteOemDialog
        linha={escolhendo}
        tenantId={tid}
        unidades={conta?.unidades_base_ids ?? []}
        aberto={!!escolhendo}
        onOpenChange={(v) => { if (!v) setEscolhendo(null); }}
        onDecidido={recarregarRecon}
      />

      <VincularProdutoOemDialog
        produtoOem={vinculandoProduto}
        vinculos={vinculandoProduto ? (vinculosPorProduto.get(vinculandoProduto.codigo) ?? []) : []}
        contaId={conta?.id ?? null}
        tenantId={tid}
        aberto={!!vinculandoProduto}
        onOpenChange={(v) => { if (!v) setVinculandoProduto(null); }}
        onConcluido={() => {
          // O upgrade mexe em produto_modulos, que a tela de Produtos e módulos
          // também lê — invalidar só o vínculo deixaria a outra tela mostrando
          // o catálogo velho até alguém recarregar a página.
          queryClient.invalidateQueries({ queryKey: ["oem-vinculos-produto", conta?.id] });
          queryClient.invalidateQueries({ queryKey: ["produto_modulos"] });
          queryClient.invalidateQueries({ queryKey: ["crud_produtos_master"] });
          // Sem estas duas, a aba Produtos e módulos continuava jurando que o
          // produto não tinha vínculo: o app usa staleTime de 5 min, então quem
          // tivesse aberto o produto ANTES de vincular via o cache velho e
          // achava que o vínculo não pegou.
          queryClient.invalidateQueries({ queryKey: ["oem-vinculo-do-produto"] });
          queryClient.invalidateQueries({ queryKey: ["oem-precos-da-conta"] });
        }}
      />
    </div>
  );
}
