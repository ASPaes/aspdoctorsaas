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
import OemFilaSincronizacaoPanel from "./OemFilaSincronizacaoPanel";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, RefreshCw, Plug, Link2, HelpCircle, TrendingDown, Search, AlertTriangle, KeyRound,
  Undo2, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink,
  ArrowUpDown, ArrowUp, ArrowDown, DownloadCloud, Boxes, Plus,
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
};

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
        {ao_lado && (
          <div className="flex shrink-0 flex-col justify-end text-right" title={ao_lado.title}>
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

// Divergência tem que mostrar os DOIS lados na mesma linha. Dizer "CNPJ
// divergente" sem dizer contra o quê obriga a abrir duas telas para entender.
function LinhaConferencia({
  l, onTrocar, onDesfazer, desfazendo,
}: {
  l: Recon;
  onTrocar: (l: Recon) => void;
  onDesfazer: (id: string) => void;
  desfazendo: string | null;
}) {
  const difNome = l.divergencias?.includes("nome");
  const difCnpj = l.divergencias?.includes("cnpj");
  const cor = (dif?: boolean) => (dif ? "text-destructive font-medium" : "text-muted-foreground");
  return (
    <div className="px-4 py-3 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          filial {l.filial_codigo} · grupo {l.empresa_codigo}
          {l.status_oem && ` · ${l.status_oem}`}
        </p>
        {/* A saída na própria linha: mostrar o problema e mandar procurar o
            mesmo registro em outra aba é meia funcionalidade. */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="secondary" onClick={() => onTrocar(l)}>
            Trocar cliente
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5"
            disabled={desfazendo === l.id} onClick={() => onDesfazer(l.id)}>
            {desfazendo === l.id
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Undo2 className="h-3.5 w-3.5" />}
            Desfazer
          </Button>
        </div>
      </div>
      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-[5.5rem_1fr_1fr] items-baseline">
        {/* Razão social, que é o par comparado — e não nome fantasia, que é o
            que a linha mostrava antes e fazia duas strings iguais na tela
            aparecerem como divergentes. */}
        <span className="text-xs text-muted-foreground">Razão social</span>
        <span className={`truncate ${cor(difNome)}`}>
          <span className="text-sky-600 dark:text-sky-400 text-xs mr-1.5">OEM</span>
          {l.razao_social_oem ?? "—"}
        </span>
        <span className={`truncate ${cor(difNome)}`}>
          <span className="text-emerald-600 dark:text-emerald-400 text-xs mr-1.5">DS</span>
          {l.razao_social_ds ?? "—"}
        </span>

        {/* Fantasia entra só como referência: é por ela que se reconhece a loja,
            mas não é ela que decide a divergência. */}
        {(l.razao_oem || l.razao_ds) && (
          <>
            <span className="text-xs text-muted-foreground">Fantasia</span>
            <span className="truncate text-muted-foreground text-xs">
              <span className="text-sky-600 dark:text-sky-400 mr-1.5">OEM</span>
              {l.razao_oem ?? "—"}
            </span>
            <span className="truncate text-muted-foreground text-xs">
              <span className="text-emerald-600 dark:text-emerald-400 mr-1.5">DS</span>
              {l.razao_ds ?? "—"}
            </span>
          </>
        )}

        <span className="text-xs text-muted-foreground">CNPJ</span>
        <span className={`tabular-nums ${cor(difCnpj)}`}>
          <span className="text-sky-600 dark:text-sky-400 text-xs mr-1.5">OEM</span>
          {l.cnpj_norm ?? "—"}
        </span>
        <span className={`tabular-nums ${cor(difCnpj)}`}>
          <span className="text-emerald-600 dark:text-emerald-400 text-xs mr-1.5">DS</span>
          {l.cnpj_ds ?? "—"}
        </span>
      </div>
    </div>
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
          Mostrando {TETO} de {itens.length} — use a busca acima para chegar num caso específico.
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
  const [busca, setBusca] = useState("");
  const [contaSel, setContaSel] = useState<string | null>(null);
  const [novaUnidade, setNovaUnidade] = useState<string>("");
  const [novaChave, setNovaChave] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [escolhendo, setEscolhendo] = useState<LinhaRecon | null>(null);
  const [desfazendo, setDesfazendo] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [pagina, setPagina] = useState(0);
  const [buscaCusto, setBuscaCusto] = useState("");
  const [paginaCusto, setPaginaCusto] = useState(0);
  const [custoSort, setCustoSort] = useState<CustoSort>("cliente");
  // Qual linha está gravando (o código da filial), e se o lote foi confirmado.
  const [atualizandoDs, setAtualizandoDs] = useState<string | null>(null);
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  // Seleção por CLIENTE (o id), não por linha da página: ela sobrevive a
  // paginar, ordenar e buscar, que é o que a pessoa espera de um checkbox.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // "A corrigir" e "Em dia" em vez de "divergente" e "conferido": o primeiro par
  // diz o que fazer, o segundo só descreve o estado — e "conferido" sugeriria
  // que alguém conferiu, quando o que houve foi o valor bater com o do OEM.
  const [filtroCusto, setFiltroCusto] = useState<"todos" | "corrigir" | "emdia">("todos");
  const [custoDir, setCustoDir] = useState<"asc" | "desc">("asc");
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
    queryKey: ["oem-codigos-gravados", tid],
    enabled: !!tid,
    queryFn: () =>
      fetchAllRows<{ oem_codigo_filial: string; cliente_id: string; vlr_custo: number | null; ativo: boolean }>(() =>
        (supabase.from("cliente_produtos" as any) as any)
          .select("oem_codigo_filial, cliente_id, vlr_custo, ativo")
          .eq("tenant_id", tid)
          .not("oem_codigo_filial", "is", null),
      ),
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

  const conta = useMemo(
    () => contas.find((c) => c.id === contaSel) ?? contas[0] ?? null,
    [contas, contaSel],
  );
  const rotulo = (c: Conta) =>
    (c.unidades_base_ids ?? []).map((u) => unidades.find((x) => x.id === u)?.nome ?? `Unidade ${u}`)
      .join(", ") || "Todas as unidades";

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
            "razao_social_oem, razao_social_ds, criterio_match",
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
    queryKey: ["oem-espelho-ultima", tid],
    queryFn: async () => {
      const { data } = await (supabase.from("oem_espelho_filial" as any) as any)
        .select("atualizado_em, last_sync_oem")
        .eq("tenant_id", tid)
        .order("atualizado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data as { atualizado_em: string; last_sync_oem: string | null } | null;
    },
    enabled: !!tid,
  });

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
        .filter((l) => l.filial_codigo && l.cancelado_ds === true)
        .sort((a, b) => Number(b.custo_oem || 0) - Number(a.custo_oem || 0)),
      semCliente: ativas.filter((l) => l.estado_match === "SO_NO_OEM" && l.status_usuario === "novo"),
      soNoDs: linhas.filter((l) => l.estado_match === "SO_NO_DS" && !l.cancelado_ds),
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
      // A mensalidade é do CLIENTE e o custo é da FILIAL. Somar mensalidade_ds
      // linha a linha contava a receita uma vez por filial: um cliente com 3
      // licenças aparecia valendo o triplo, e a margem saía inflada no mesmo
      // tanto. A receita é somada uma vez por cliente; o custo, por filial.
      receita: [...porCliente.values()].reduce((a, m) => a + m, 0),
      custo: comPar.reduce((a, l) => a + Number(l.custo_oem || 0), 0),
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

  // O lote é EXATAMENTE o que está marcado — nunca "todos os elegíveis". Com
  // busca ativa, mandar a base inteira gravaria em centenas de clientes que a
  // pessoa nem está vendo.
  const alvoLote = useMemo(() => {
    const marcados = custos.lista.filter((c) => selecionados.has(c.id));
    return {
      filiais: marcados.flatMap((c) => c.filiais),
      quantidade: marcados.length,
      // Marcado mas já igual ao OEM não vira escrita; dizer isso na confirmação
      // evita o "cliquei em 40 e ele diz que atualizou 12".
      aGravar: marcados.filter((c) => c.divergente).length,
    };
  }, [custos.lista, selecionados]);

  // O checkbox do cabeçalho age sobre a LISTA FILTRADA inteira, não só sobre a
  // página: quem busca por um CNPJ e marca o topo quer aqueles, todos.
  //
  // SÓ O QUE ESTÁ DIVERGENTE É SELECIONÁVEL. Cliente com o custo já igual ao do
  // OEM não tem o que gravar, e deixá-lo entrar no lote inflava a contagem do
  // botão: "Atualizar 40 selecionados" que na prática escrevia em 12. A lista
  // de marcáveis é esta, e ela manda no cabeçalho e na linha.
  const idsVisiveis = useMemo(
    () => custosVisiveis.filter((c) => c.divergente).map((c) => c.id),
    [custosVisiveis],
  );
  const marcadosVisiveis = idsVisiveis.filter((id) => selecionados.has(id)).length;
  const todosVisiveisMarcados = idsVisiveis.length > 0 && marcadosVisiveis === idsVisiveis.length;

  function alternarTodosVisiveis(marcar: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      for (const id of idsVisiveis) {
        if (marcar) proximo.add(id); else proximo.delete(id);
      }
      return proximo;
    });
  }

  function alternarUm(id: string, marcar: boolean) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (marcar) proximo.add(id); else proximo.delete(id);
      return proximo;
    });
  }

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
      setSelecionados(new Set());
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

  const filtra = (lista: Recon[]) => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((l) =>
      combina(q, [l.razao_oem, l.razao_ds, l.cnpj_norm, l.cnpj_ds, l.filial_codigo, l.empresa_codigo]));
  };

  // Paginação da fila de decisão. É lista client-side (o fetchAllRows já trouxe
  // tudo), então paginar aqui é só fatiar — mas sem isso a tela cortava em 100
  // e as demais simplesmente não existiam para quem não soubesse buscar.
  const escolherFiltrado = filtra(r.escolher);
  const totalPaginas = Math.max(1, Math.ceil(escolherFiltrado.length / POR_PAGINA));
  // Decidir a última filial da última página encolhe a lista debaixo dos pés:
  // sem o clamp, a tela ficaria numa página que não existe mais, vazia.
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const inicio = paginaAtual * POR_PAGINA;
  const escolherPagina = escolherFiltrado.slice(inicio, inicio + POR_PAGINA);

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
              <Plug className="h-5 w-5" /> OEM — PDV Legal / TabletCloud
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
                  <span className="text-sky-600 dark:text-sky-400">OEM</span> — a licença e o que
                  ela <strong>custa</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">DoctorSaaS</span> — o
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

      <Tabs defaultValue="visao" className="w-full">
        <TabsList>
          <TabsTrigger value="conexao">Conexão</TabsTrigger>
          <TabsTrigger value="modulos" className="gap-1.5">
            <Boxes className="h-3.5 w-3.5" /> Módulos
          </TabsTrigger>
          <TabsTrigger value="visao">Visão geral</TabsTrigger>
          <TabsTrigger value="escolher" className="gap-1.5">
            Escolher candidato
            {r.escolher.length > 0 && <Badge variant="secondary">{r.escolher.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="conferencia" className="gap-1.5">
            Conferência
            {r.divCnpj.length > 0 && <Badge variant="destructive">{r.divCnpj.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="margem" className="gap-1.5">
            Margem
            {r.negativas.length > 0 && <Badge variant="destructive">{r.negativas.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="custos" className="gap-1.5">
            Custos
            {custos.divergentes > 0 && <Badge variant="secondary">{custos.divergentes}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="fila" className="gap-1.5">
            Fila
            {filaParada > 0 && <Badge variant="destructive">{filaParada}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pendencias">Pendências</TabsTrigger>
        </TabsList>

        {/* --------------------------------------------------------------- fila */}
        <TabsContent value="fila" className="space-y-3">
          <Explica>
            Toda alteração que sai daqui para a licença do parceiro passa por esta fila antes.
            Um processador roda de <strong>2 em 2 minutos</strong> e envia o que está pendente;
            o que o OEM recusar <strong>fica aqui, com o motivo escrito</strong>, em vez de
            desaparecer num aviso de tela. Linha parada tem o botão{" "}
            <strong>Tentar de novo</strong> — use depois de corrigir a causa, senão ela toma a
            mesma recusa.
          </Explica>
          <OemFilaSincronizacaoPanel />
        </TabsContent>

        {/* ------------------------------------------------------------ conexão */}
        <TabsContent value="conexao" className="space-y-4 max-w-3xl">
          <Explica>
            É aqui que o DoctorSaaS aprende de qual empresa do <strong>DoctorOEM</strong> vêm as
            filiais. A chave é gerada lá, no Nexus Hub, e colada aqui — <strong>uma conta por
            unidade base</strong>, como no Omie, para que as filiais de uma unidade não se
            misturem com os clientes de outra. Quem fala com a API do OEM é o DoctorOEM; o
            DoctorSaaS só recebe a cópia.
          </Explica>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Contas conectadas
              </CardTitle>
              <CardDescription>
                Uma conta por unidade base, como no Omie. A chave é gerada no{' '}
                <strong>Nexus Hub</strong> e colada aqui — é ela que diz de qual empresa do
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
                  A chave vai para o cofre do banco. Nem esta tela consegue lê-la de volta —
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
            <strong>por conta conectada</strong> — cada unidade tem a sua. Isto é preço de{" "}
            <strong>tabela</strong>, não o que um cliente paga: a licença de cada filial pode ter
            valor negociado, e é ela que aparece nas abas Custos e Margem.
            <br />
            No topo de cada coluna dá para <strong>vincular o produto do OEM a um produto
            cadastrado no DoctorSaaS</strong> e, se você quiser, trazer os módulos daquela coluna
            para dentro dele — o custo de cada módulo vem do preço de tabela.
          </Explica>

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
                        </strong>{" "}— atualiza junto com o espelho.</>
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
                  <strong>Atualizar espelho</strong> — ela vem junto com as filiais.
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
            <strong>clientes do DoctorSaaS</strong>. Nada aqui é editável — é o retrato do que a
            última atualização do espelho encontrou.
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
                    ? "Nenhum produto do DoctorSaaS está vinculado ao OEM — sem isso não há contrato a comparar."
                    : contratosOemCarregando
                    ? "Contando…"
                    : contratosOem == null
                    ? "Não foi possível contar os contratos do DoctorSaaS."
                    : "Contratos com status ativo que têm item de um produto vinculado ao OEM, nas unidades desta conta. Este número é do DoctorSaaS, ao vivo — não vem do espelho.",
              }}
            />
            <Numero valor={String(r.vinculadas)} rotulo="Vinculadas automaticamente" tom="bom"
              sub={r.ativas ? `${((r.vinculadas / r.ativas) * 100).toFixed(1)}% das ativas` : undefined} />
            <Numero valor={String(r.escolher.length)} rotulo="Aguardando escolha"
              tom={r.escolher.length ? "alerta" : "bom"} sub="CNPJ com mais de um cliente" />
            {/* Markup na mesma régua da aba Custos: mensalidade ÷ custo do OEM,
                como multiplicador. Dois markups com denominadores diferentes
                seriam duas respostas para a mesma pergunta. */}
            <Numero valor={brl(r.receita - r.custo)} rotulo="Margem mensal" tom="bom"
              // Markup na mesma linha do custo e no mesmo tamanho: ele é a
              // leitura da conta que está ali (receita ÷ custo), não um segundo
              // indicador. Régua da aba Custos — custo do OEM no divisor, sempre.
              sub={
                <span title={r.custo > 0
                  ? `${brl(r.receita)} ÷ ${brl(r.custo)} (custo do OEM)`
                  : "Sem custo do OEM — não há como calcular o markup"}>
                  {brl(r.receita)} − {brl(r.custo)} · markup{" "}
                  {r.custo > 0 ? (
                    <span className={r.receita / r.custo < 1 ? "text-destructive font-medium" : ""}>
                      {num2(r.receita / r.custo)}×
                    </span>
                  ) : "—"}
                </span>
              } />
          </div>
        </TabsContent>

        {/* ---------------------------------------------------------- escolher */}
        <TabsContent value="escolher" className="space-y-3">
          <Explica>
            Cada linha aqui é uma <strong>filial do OEM</strong> — uma licença — cujo CNPJ tem
            mais de um cliente cadastrado no DoctorSaaS. A máquina não desempata sozinha, então
            ela para e pergunta. <strong>Escolher</strong> abre a lista de{" "}
            <strong>clientes do DoctorSaaS</strong> para você dizer qual deles é o dono daquela
            licença. Sua decisão fica gravada e sobrevive às próximas atualizações do espelho.
            Só entram aqui licenças <strong>ativas</strong> no OEM de clientes <strong>não
            cancelados</strong> — desativado não cobra, e cadastro cancelado não vira vínculo.
          </Explica>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por nome, CNPJ ou código" className="pl-8"
              value={busca}
              // Buscar com a página 3 aberta mostraria "nenhum resultado" tendo
              // resultado na 1 — toda busca volta para o começo.
              onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
          </div>
          {r.escolher.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nenhuma filial aguardando escolha.
            </CardContent></Card>
          ) : (
            <div className="rounded-md border">
              <div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2 text-xs font-medium">
                <span className="w-4 shrink-0" />
                <span className="min-w-0 flex-1 text-sky-600 dark:text-sky-400">
                  Filial no OEM
                </span>
                <span className="w-28 text-center text-emerald-600 dark:text-emerald-400">
                  Candidatos
                </span>
                <span className="w-28 text-right text-sky-600 dark:text-sky-400">
                  Custo
                </span>
                <span className="w-[86px] shrink-0" />
              </div>
              <div className="divide-y">
                {escolherPagina.map((l) => (
                  <div key={l.id} className="flex items-center gap-3 p-3 text-sm">
                    <HelpCircle className="h-4 w-4 text-amber-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{l.razao_oem}</p>
                      <p className="text-xs text-muted-foreground">
                        filial {l.filial_codigo} · grupo {l.empresa_codigo} · CNPJ {l.cnpj_norm}
                      </p>
                      {/* Sem isto, a filial travada pela regra 1:1 aparece com
                          "1 candidatos" e nenhuma pista de por que não casou. */}
                      {l.observacao && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">{l.observacao}</p>
                      )}
                    </div>
                    <span className="w-28 text-center">
                      <Badge variant="outline">{l.qtd_candidatos_ds} candidatos</Badge>
                    </span>
                    <span className="tabular-nums text-muted-foreground w-28 text-right">
                      {brl(l.custo_oem)}
                    </span>
                    <Button size="sm" variant="secondary" className="w-[86px]"
                      onClick={() => setEscolhendo(l)}>
                      Escolher
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {escolherFiltrado.length > POR_PAGINA && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground tabular-nums">
                {inicio + 1}–{Math.min(inicio + POR_PAGINA, escolherFiltrado.length)} de{" "}
                {escolherFiltrado.length}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="gap-1"
                  disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>
                  <ChevronLeft className="h-4 w-4" /> Anterior
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums px-1">
                  {paginaAtual + 1} / {totalPaginas}
                </span>
                <Button variant="outline" size="sm" className="gap-1"
                  disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPagina(paginaAtual + 1)}>
                  Próxima <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Decidido à mão — sem o caminho de volta, um clique errado vira
              vínculo permanente: a sincronização preserva a escolha errada
              exatamente como preservaria a certa. */}
          {r.decididas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  {r.decididas.length} decisões tomadas à mão
                </CardTitle>
                <CardDescription>
                  Filial no OEM → cliente no DoctorSaaS. Sobrevivem às próximas sincronizações;
                  desfazer devolve a filial ao casamento automático.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-80 overflow-y-auto">
                <div className="divide-y">
                  {filtra(r.decididas).map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate flex items-center gap-1.5">
                          <Origem lado="oem" /> {l.razao_oem ?? l.razao_ds}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {l.status_usuario === "ignorado"
                            ? "ignorada — não vira cliente"
                            : `→ cliente ${l.razao_ds ?? "removido"}`}
                          {l.filial_codigo && ` · filial ${l.filial_codigo}`}
                          {l.resolvido_em &&
                            ` · ${new Date(l.resolvido_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
                        </p>
                      </div>
                      <Badge variant={l.status_usuario === "ignorado" ? "outline" : "secondary"}>
                        {l.status_usuario}
                      </Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
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
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ------------------------------------------------------- conferência */}
        <TabsContent value="conferencia" className="space-y-3">
          <Explica>
            Aqui não se decide vínculo — ele já está feito. A partir do momento em que o par
            <strong> grupo · filial</strong> foi gravado na ficha do cliente, é ele que segura a
            ligação, e não o CNPJ. A cada atualização do espelho os outros dois campos são
            comparados dos dois lados, e o que deixou de bater aparece aqui.{" "}
            <strong>Divergência é aviso, não desvínculo</strong> — nada é desfeito sozinho, e por
            isso cada linha traz as duas saídas: <strong>Trocar cliente</strong>, quando o vínculo
            está no cadastro errado, e <strong>Desfazer</strong>, que devolve a filial à fila de
            escolha. Se o certo for corrigir o cadastro (num dos dois sistemas), não mexa aqui — a
            próxima atualização do espelho tira a linha desta lista sozinha.
          </Explica>

          <div className="grid gap-3 sm:grid-cols-3">
            <Numero valor={String(r.confereOk)} rotulo="Conferem" tom="bom"
              sub="nome e CNPJ batendo" />
            <Numero valor={String(r.divCnpj.length)} rotulo="CNPJ divergente"
              tom={r.divCnpj.length ? "ruim" : "bom"} sub="sinal forte — provável vínculo errado" />
            <Numero valor={String(r.divNome.length)} rotulo="Só o nome divergente"
              tom="normal" sub="CNPJ bate — é diferença de cadastro" />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1 min-w-[16rem]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome, CNPJ ou código" className="pl-8"
                value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
            </div>
            {/* Licença desativada não cobra — divergência nela raramente é o que
                se quer olhar. A tela abre em Ativo e amplia sob demanda. */}
            <div className="inline-flex rounded-md border p-0.5">
              {([
                ["Ativo", "Ativas"],
                ["Desativado", "Desativadas"],
                ["todos", "Todas"],
              ] as const).map(([v, rot]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setStatusConf(v)}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    statusConf === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {rot}
                </button>
              ))}
            </div>
          </div>

          {r.divCnpj.length === 0 && r.divNome.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nada divergindo{statusConf !== "todos" &&
                <> entre as licenças <strong>{statusConf === "Ativo" ? "ativas" : "desativadas"}</strong></>}.
              {statusConf !== "todos" && " Experimente “Todas”."} Se você ainda não clicou em{" "}
              <strong>Atualizar espelho</strong> depois de gravar os códigos, a conferência ainda
              não rodou nenhuma vez.
            </CardContent></Card>
          ) : (
            <>
              {r.divCnpj.length > 0 && (
                <Card className="border-destructive/40">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2 text-destructive">
                      <AlertTriangle className="h-4 w-4" />
                      {r.divCnpj.length} com CNPJ diferente dos dois lados
                    </CardTitle>
                    <CardDescription>
                      O código diz que esta licença é deste cliente, mas os CNPJs não são o mesmo.
                      Ou o cadastro mudou de um lado só, ou o vínculo está no cliente errado —
                      neste caso, desfaça em <strong>Escolher candidato</strong> e refaça.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y border-t max-h-96 overflow-y-auto">
                      {filtra(r.divCnpj).map((l) => (
                        <LinhaConferencia key={l.id} l={l} onTrocar={setEscolhendo}
                          onDesfazer={desvincular} desfazendo={desfazendo} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {r.divNome.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {r.divNome.length} com só o nome diferente
                    </CardTitle>
                    <CardDescription>
                      CNPJ bate, então o vínculo está certo — aqui é diferença de cadastro. A
                      comparação cruza <strong>razão social e nome fantasia dos dois lados</strong>:
                      basta um nome bater com um nome para não acusar nada, e acento, caixa,
                      pontuação e sufixo (LTDA, ME, EPP) são ignorados. O que sobra são nomes
                      genuinamente diferentes.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y border-t max-h-96 overflow-y-auto">
                      {filtra(r.divNome).map((l) => (
                        <LinhaConferencia key={l.id} l={l} onTrocar={setEscolhendo}
                          onDesfazer={desvincular} desfazendo={desfazendo} />
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ------------------------------------------------------------ margem */}
        <TabsContent value="margem" className="space-y-3">
          <Explica>
            <strong>Receita</strong> é a soma das mensalidades no DoctorSaaS — o que os clientes
            pagam. <strong>Custo</strong> é a soma das licenças ativas no OEM — o que a operação
            paga. A mensalidade é do <strong>cliente</strong> e o custo é da <strong>filial</strong>:
            um cliente com três lojas paga uma mensalidade e consome três licenças, então a
            mensalidade entra uma vez por cliente e o custo, uma vez por licença. Diferente da
            conferência do Omie, aqui os dois números <strong>têm</strong> que ser diferentes — a
            diferença é o resultado, não um erro. Licença desativada não entra: desativado não
            cobra, bloqueado cobra.
          </Explica>
          <div className="grid gap-3 sm:grid-cols-3">
            <Numero valor={brl(r.receita)} rotulo="Receita — mensalidades (DoctorSaaS)"
              sub={`${r.clientesComPar} clientes ativos`} />
            <Numero valor={brl(r.custo)} rotulo="Custo — licenças ativas (OEM)"
              sub={`${r.comPar.length} licenças`} />
            <Numero valor={brl(r.receita - r.custo)} rotulo="Margem — receita menos custo" tom="bom" />
          </div>

          {r.negativas.length > 0 && (
            <Card className="border-destructive/40">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <TrendingDown className="h-4 w-4" />
                  {r.negativas.length} cliente(s) custando mais do que pagam
                </CardTitle>
                <CardDescription>
                  A licença no OEM sai mais caro que a mensalidade cobrada. Pode ser acordo
                  comercial — ou cadastro incompleto. Só entram aqui os clientes com{" "}
                  <strong>vínculo confirmado</strong>: sem isso, um cadastro que recebeu as
                  licenças de um grupo inteiro apareceria devendo centenas de reais por
                  atribuição, não por prejuízo.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="flex items-center gap-3 border-y bg-muted/50 px-6 py-2 text-xs font-medium">
                  <span className="min-w-0 flex-1 text-emerald-600 dark:text-emerald-400">
                    Cliente
                  </span>
                  <span className="w-28 text-right text-sky-600 dark:text-sky-400">
                    Custo
                  </span>
                  <span className="w-28 text-right text-emerald-600 dark:text-emerald-400">
                    Mensalidade
                  </span>
                  <span className="w-24 text-right">Margem</span>
                </div>
                <div className="divide-y">
                  {r.negativas.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{l.razao_ds ?? l.razao_oem}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {l.filiais === 1 ? "1 licença confirmada" : `${l.filiais} licenças confirmadas`} no OEM
                          {l.naoConfirmadas > 0 &&
                            ` · ${l.naoConfirmadas} sem confirmação, fora desta conta`}
                        </p>
                      </div>
                      <span className="tabular-nums text-muted-foreground w-28 text-right">
                        {brl(l.custo_oem)}
                      </span>
                      <span className="tabular-nums text-muted-foreground w-28 text-right">
                        {brl(l.mensalidade_ds)}
                      </span>
                      <span className="tabular-nums font-medium text-destructive w-24 text-right">
                        {brl(l.margem)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ------------------------------------------------------------ custos */}
        <TabsContent value="custos" className="space-y-3">
          <Explica>
            Os dois custos da mesma licença, lado a lado. O <strong>Custo DS</strong> é o valor
            digitado na ficha do produto, dentro do DoctorSaaS; o <strong>Custo OEM</strong> é o
            que a licença cobra de fato. Onde os dois divergem, quem está desatualizado é o
            cadastro daqui — e é isso que o botão <strong>Atualizar DS</strong> vai resolver,
            trazendo o valor do OEM para a ficha. A <strong>Diferença DS</strong> é{" "}
            <strong>Custo DS − Custo OEM</strong>, e o sinal é a informação: com{" "}
            <strong>+</strong>, o cadastro daqui está cobrando custo acima do que a licença cobra
            e a margem real é <em>melhor</em> do que a ficha mostra; com <strong>−</strong>, está
            abaixo e a margem real é <em>pior</em>. A <strong>Mensalidade DS</strong> é o
            <strong> MRR atual</strong> do cliente — a base já com os movimentos vigentes
            (upsell, cross-sell, downsell e reajuste) —, o mesmo número que a ficha dele mostra
            em <em>MRR Atual</em>. O <strong>Markup</strong> é essa mensalidade dividida pelo{" "}
            <strong>Custo OEM</strong>: quantas vezes o que o cliente paga cobre o que a licença
            custa. O divisor é sempre o do OEM, aqui e na ficha do cliente, porque
            é ele o valor correto — então, num cliente com Custo DS desatualizado, a conta do
            markup não fecha com o número da coluna ao lado, e é o Custo DS que está errado. Só
            entram os clientes com <strong>vínculo confirmado</strong> e licença ativa — sem
            confirmação, o custo seria atribuído no chute.
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
              {/* Escrever custo em muitas fichas de uma vez pede confirmação
                  explícita — e o número de fichas afetadas vai nela. Sem nada
                  marcado o botão não tem alvo, então fica desligado. */}
              <Button
                variant="outline"
                className="gap-2 shrink-0"
                disabled={atualizandoDs !== null || alvoLote.quantidade === 0}
                onClick={() => setConfirmandoLote(true)}
              >
                {atualizandoDs === "__lote__"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <DownloadCloud className="h-4 w-4" />}
                {alvoLote.quantidade > 0
                  ? `Atualizar ${alvoLote.quantidade} selecionado${alvoLote.quantidade > 1 ? "s" : ""}`
                  : "Atualizar selecionados"}
              </Button>
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
                {/* Mesmo controle da Conferência. O contador vai no rótulo: o
                    tamanho da fila é a informação, não um detalhe. */}
                <div className="inline-flex rounded-md border p-0.5">
                  {([
                    ["todos", "Todos", custos.lista.length],
                    ["corrigir", "A corrigir", custos.divergentes],
                    ["emdia", "Em dia", custos.emDia],
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
                    {/* Sem nada a corrigir na lista (filtro "Em dia", ou tudo
                        já igual ao OEM) não há o que marcar — o checkbox fica
                        desligado em vez de virar clique que não faz nada. */}
                    <Checkbox
                      className="shrink-0"
                      disabled={idsVisiveis.length === 0}
                      checked={todosVisiveisMarcados ? true : marcadosVisiveis > 0 ? "indeterminate" : false}
                      onCheckedChange={(v) => alternarTodosVisiveis(v === true)}
                      aria-label="Marcar todos os clientes a corrigir da lista"
                      title={idsVisiveis.length === 0
                        ? "Nenhum cliente desta lista precisa de atualização"
                        : todosVisiveisMarcados
                          ? "Desmarcar todos os da lista"
                          : `Marcar os ${idsVisiveis.length} clientes a corrigir desta lista`}
                    />
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
                          ? "Nenhum cliente a corrigir — todos os custos estão iguais aos do OEM."
                          : buscaCusto.trim()
                            ? "Nenhum cliente encontrado para esta busca."
                            : "Nenhum cliente neste filtro."}
                    </p>
                  ) : (
                    <div className="divide-y">
                      {custosPagina.map((c) => (
                        <div
                          key={c.id}
                          className={`flex items-center gap-3 px-6 py-2.5 text-sm ${
                            selecionados.has(c.id) ? "bg-primary/5" : ""
                          }`}
                        >
                          {/* Cliente em dia não tem caixa de seleção: não há o
                              que gravar nele, e deixá-lo marcável fazia o botão
                              prometer atualizações que não aconteceriam. O
                              espaço continua ocupado para as colunas não
                              dançarem de uma linha para a outra. */}
                          {c.divergente ? (
                            <Checkbox
                              className="shrink-0"
                              checked={selecionados.has(c.id)}
                              onCheckedChange={(v) => alternarUm(c.id, v === true)}
                              aria-label={`Marcar ${c.cliente}`}
                            />
                          ) : (
                            <span className="h-4 w-4 shrink-0" aria-hidden="true" />
                          )}
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
                              ? "Licença sem custo no OEM — não há como calcular"
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
                          <span className="w-36 shrink-0 flex justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-1.5"
                              disabled={atualizandoDs !== null || !c.divergente}
                              title={c.divergente
                                ? `Gravar ${brl(c.custo_oem)} no custo do produto deste cliente`
                                : "O custo daqui já é igual ao do OEM"}
                              onClick={() => atualizarCustoDs(c.filiais, c.cliente, c.id)}
                            >
                              {atualizandoDs === c.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <DownloadCloud className="h-3.5 w-3.5" />}
                              Atualizar DS
                            </Button>
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

        <AlertDialog open={confirmandoLote} onOpenChange={setConfirmandoLote}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {alvoLote.aGravar > 0
                  ? `Atualizar o custo de ${alvoLote.aGravar} cliente(s)?`
                  : `Nenhum dos ${alvoLote.quantidade} marcados precisa de atualização`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                O custo cadastrado aqui será substituído pelo que o OEM cobra na fatura,
                em todos os clientes com valor diferente. Isso muda a margem que aparece
                na ficha de cada um deles. Não há desfazer — o valor anterior não fica
                guardado em lugar nenhum.
                <br /><br />
                {alvoLote.quantidade > alvoLote.aGravar && (
                  <><br /><br />Dos <strong>{alvoLote.quantidade} marcados</strong>,{" "}
                  {alvoLote.quantidade - alvoLote.aGravar} já {alvoLote.quantidade - alvoLote.aGravar === 1
                    ? "está igual ao OEM e não será tocado" : "estão iguais ao OEM e não serão tocados"}.</>
                )}
                <br /><br />
                Licença sem custo no OEM e cliente com mais de um produto ativo são
                <strong> deixados de fora</strong>, e a tela diz quantos foram.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => atualizarCustoDs(
                  alvoLote.filiais,
                  `${alvoLote.quantidade} cliente(s) selecionado(s)`,
                  "__lote__",
                )}
              >
                Atualizar selecionados
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* -------------------------------------------------------- pendências */}
        <TabsContent value="pendencias" className="space-y-3">
          <Explica>
            Tudo nesta aba trata só do que está <strong>vivo dos dois lados</strong>: licença ativa
            no OEM e cliente não cancelado no DoctorSaaS. Desativado não cobra, e cadastro
            cancelado não vira vínculo — pedir decisão sobre eles seria trabalho que não muda nada.
            A exceção é <strong>licença ativa em cliente cancelado</strong>: não é vínculo a
            fazer, é dinheiro saindo, e por isso tem card próprio logo abaixo — que aparece
            também quando o número é zero, porque zero ali é o que se quer ver.
            <br /><br />
            Os dois lados que não se encontraram. À esquerda, <strong>licenças do OEM</strong> que
            estão sendo cobradas e não têm cliente correspondente no DoctorSaaS — o valor é o
            custo da licença. À direita, <strong>clientes do DoctorSaaS</strong> que não têm
            licença nenhuma no OEM — o valor é a mensalidade que eles pagam. Podem ser de outro
            produto, e nesse caso não é erro.
          </Explica>
          {/* Dinheiro, não cadastro: vem antes de tudo nesta aba.
              E aparece SEMPRE, inclusive zerado — "nenhum" é a resposta que se
              quer ver aqui, e um card que some quando está tudo bem deixa quem
              procura sem saber se está tudo bem ou se a tela quebrou. */}
          {r.pagandoPorCancelado.length === 0 ? (
            <Card className="border-emerald-500/40">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Nenhuma licença ativa em cliente cancelado
                </CardTitle>
                <CardDescription>
                  Não há licença sendo cobrada no OEM para cliente que já cancelou no DoctorSaaS —
                  o vazamento mais caro que esta integração consegue enxergar está zerado. Se
                  aparecer alguma, ela entra aqui com o custo mensal somado.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card className="border-destructive/50">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <TrendingDown className="h-4 w-4" />
                  {r.pagandoPorCancelado.length} licenças ativas de clientes cancelados —{" "}
                  {brl(r.pagandoPorCancelado.reduce((a, l) => a + Number(l.custo_oem || 0), 0))}/mês
                </CardTitle>
                <CardDescription>
                  A licença continua <strong>ativa e sendo cobrada no OEM</strong>, mas o cliente
                  está <strong>cancelado no DoctorSaaS</strong> — receita zero, custo cheio. Aqui
                  não há vínculo a fazer: a saída é <strong>pedir a desativação no portal do
                  OEM</strong>. O DoctorSaaS não escreve no OEM, então isso é feito lá e some desta
                  lista na próxima atualização do espelho.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y border-t max-h-96 overflow-y-auto">
                  {filtra(r.pagandoPorCancelado).map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{l.razao_oem ?? l.razao_ds}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          filial {l.filial_codigo} · grupo {l.empresa_codigo}
                          {l.razao_ds && <> · cliente {l.razao_ds}</>}
                        </p>
                      </div>
                      <span className="tabular-nums font-medium text-destructive w-24 text-right">
                        {brl(l.custo_oem)}
                      </span>
                      <Button size="sm" variant="ghost" className="gap-1.5 shrink-0"
                        disabled={!l.ds_customer_id}
                        onClick={() => navigate(`/clientes/${l.ds_customer_id}`)}>
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir ficha
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  {r.semCliente.length} filiais ativas sem cliente
                </CardTitle>
                <CardDescription className="flex items-center gap-1.5">
                  <Origem lado="oem" /> valor = custo da licença
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-80 overflow-y-auto">
                <div className="divide-y">
                  {r.semCliente.map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.razao_oem}</p>
                        <p className="text-xs text-muted-foreground">filial {l.filial_codigo} · CNPJ {l.cnpj_norm}</p>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{brl(l.custo_oem)}</span>
                      {/* Não casou por CNPJ, mas o cliente pode existir com
                          outro CNPJ — a busca livre do diálogo resolve. */}
                      <Button size="sm" variant="ghost" onClick={() => setEscolhendo(l)}>
                        Vincular
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground" />
                  {r.soNoDs.length} clientes ativos sem licença
                </CardTitle>
                <CardDescription className="flex items-center gap-1.5">
                  <Origem lado="ds" /> valor = mensalidade do cliente
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0 max-h-80 overflow-y-auto">
                <div className="divide-y">
                  {/* Corte de 200 para não montar milhares de linhas de DOM.
                      Cortar em silêncio é que não pode: o rodapé diz quantas
                      ficaram de fora. */}
                  {r.soNoDs.slice(0, 200).map((l) => (
                    <div key={l.id} className="flex items-center gap-3 px-6 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{l.razao_ds}</p>
                        <p className="text-xs text-muted-foreground">CNPJ {l.cnpj_norm ?? "—"}</p>
                      </div>
                      <span className="tabular-nums text-muted-foreground">{brl(l.mensalidade_ds)}</span>
                    </div>
                  ))}
                </div>
                {r.soNoDs.length > 200 && (
                  <p className="border-t px-6 py-2 text-xs text-muted-foreground">
                    Mostrando os 200 primeiros — outros {r.soNoDs.length - 200} não estão nesta lista.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* O código do OEM só chega à ficha do cliente quando o cadastro
              comporta. O que não chegou é buraco de cadastro, e some da vista
              se ficar só no relatório de quem rodou a migration. */}
          {/* Zerado, este card VIRA a boa notícia em vez de sumir. Card que
              desaparece quando está tudo certo é indistinguível de tela
              quebrada — foi o que fez o Alexandre perguntar "os demais
              sumiram, por quê?" depois de a trava 1:1 esvaziar os baldes. */}
          {r.semCodigo.multiplas.length === 0 && r.semCodigo.semProduto.length === 0
            && r.semCodigo.variosProdutos.length === 0 && r.semCodigo.outroMotivo.length === 0 ? (
            <Card className="border-emerald-500/40">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Todos os vínculos gravaram o código na ficha do cliente
                </CardTitle>
                <CardDescription>
                  Os {r.semCodigo.gravados} vínculos em escopo têm o par grupo · filial gravado no
                  produto do cliente — é essa chave que segura a ligação quando o CNPJ muda de um
                  lado. O que ainda precisa de gente está em <strong>Escolher candidato</strong>,
                  não aqui.
                  {r.semCodigo.foraDeEscopo > 0 && (
                    <> Outros <strong>{r.semCodigo.foraDeEscopo}</strong> ficam de fora da conta:
                    licenças desativadas no OEM ou de clientes cancelados.</>
                  )}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  {r.semCodigo.total - r.semCodigo.gravados} licenças vinculadas sem código na
                  ficha do cliente
                </CardTitle>
                <CardDescription>
                  {r.semCodigo.gravados} de {r.semCodigo.total} vínculos já gravaram o par
                  grupo · filial no produto do cliente. Os demais não gravaram por um destes dois
                  motivos — em nenhum dos dois o sistema deve escolher sozinho.
                  {r.semCodigo.foraDeEscopo > 0 && (
                    <> Outros <strong>{r.semCodigo.foraDeEscopo}</strong> ficaram de fora da conta:
                    são licenças desativadas no OEM ou de clientes cancelados no DoctorSaaS, e não
                    se pede vínculo para cadastro morto — desativado não cobra.</>
                  )}
                </CardDescription>
                <div className="pt-2">
                  <div className="relative max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Buscar por nome, CNPJ ou código" className="pl-8"
                      value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 lg:grid-cols-2">
                <ListaSemCodigo
                  titulo="Mais de uma filial no mesmo cliente"
                  itens={filtra(r.semCodigo.multiplas)}
                  total={r.semCodigo.multiplas.length}
                  acao={(l) => (
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="secondary" className="gap-1.5"
                        disabled={confirmando === l.id} onClick={() => confirmar(l)}>
                        {confirmando === l.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <CheckCircle2 className="h-3.5 w-3.5" />}
                        É esta
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEscolhendo(l)}>
                        Outro cliente
                      </Button>
                    </div>
                  )}
                  explica={<>
                    A regra é <strong>1 filial = 1 cliente</strong>. Aqui várias licenças apontam
                    para o mesmo cadastro, então gravar o código escolheria uma no chute. Ou faltam
                    cadastros de cliente, ou o casamento automático por CNPJ errou. O caminho é
                    criar o cadastro que falta e vincular cada filial ao seu.
                  </>}
                />
                <ListaSemCodigo
                  titulo="Cliente sem produto ativo"
                  itens={filtra(r.semCodigo.semProduto)}
                  total={r.semCodigo.semProduto.length}
                  // Aqui não há o que decidir nesta tela: falta lançar o produto
                  // na ficha. O botão leva para lá em vez de fingir uma ação.
                  acao={(l) => (
                    <Button size="sm" variant="secondary" className="gap-1.5"
                      disabled={!l.ds_customer_id}
                      onClick={() => navigate(`/clientes/${l.ds_customer_id}`)}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir ficha
                    </Button>
                  )}
                  explica={<>
                    A licença é cobrada no OEM, mas o cliente não tem nenhuma linha de produto
                    ativa no DoctorSaaS — não há onde gravar o código, nem de onde sair o custo. O
                    caminho é lançar o produto na ficha do cliente; o código entra na próxima
                    atualização do espelho.
                  </>}
                />
                {r.semCodigo.variosProdutos.length > 0 && (
                  <ListaSemCodigo
                    titulo="Cliente com mais de um produto ativo"
                    itens={filtra(r.semCodigo.variosProdutos)}
                    total={r.semCodigo.variosProdutos.length}
                    acao={(l) => (
                      <Button size="sm" variant="secondary" className="gap-1.5"
                        disabled={!l.ds_customer_id}
                        onClick={() => navigate(`/clientes/${l.ds_customer_id}`)}>
                        <ExternalLink className="h-3.5 w-3.5" /> Abrir ficha
                      </Button>
                    )}
                    explica={<>
                      O cliente tem mais de uma linha de produto ativa e não dá para saber em qual
                      gravar o código. O caminho é inativar o produto que não vale mais, ou dizer
                      qual é o do OEM abrindo a ficha.
                    </>}
                  />
                )}
                {r.semCodigo.outroMotivo.length > 0 && (
                  <ListaSemCodigo
                    titulo="Ainda não gravado"
                    itens={filtra(r.semCodigo.outroMotivo)}
                    total={r.semCodigo.outroMotivo.length}
                    acao={(l) => (
                      <Button size="sm" variant="secondary" className="gap-1.5"
                        disabled={confirmando === l.id} onClick={() => confirmar(l)}>
                        {confirmando === l.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <CheckCircle2 className="h-3.5 w-3.5" />}
                        Gravar agora
                      </Button>
                    )}
                    explica={<>
                      Vínculo único e cliente com um produto ativo — não há impedimento nenhum. São
                      vínculos criados depois do último “Atualizar espelho”: o código entra sozinho
                      na próxima carga, e o botão adianta caso a caso.
                    </>}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

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
