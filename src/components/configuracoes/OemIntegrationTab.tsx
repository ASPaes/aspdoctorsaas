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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Loader2, RefreshCw, Plug, Link2, HelpCircle, TrendingDown, Search, AlertTriangle, KeyRound,
  Undo2, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink,
} from "lucide-react";
import EscolherClienteOemDialog, { type LinhaRecon } from "./EscolherClienteOemDialog";

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

function Numero({
  valor, rotulo, sub, tom = "normal",
}: { valor: string; rotulo: string; sub?: string; tom?: "normal" | "bom" | "alerta" | "ruim" }) {
  const cor =
    tom === "bom" ? "text-emerald-600 dark:text-emerald-400"
    : tom === "alerta" ? "text-amber-600 dark:text-amber-400"
    : tom === "ruim" ? "text-destructive"
    : "";
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className={`text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="text-sm font-medium mt-1">{rotulo}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
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
  // Licença desativada não cobra, então divergência nela é ruído na maior parte
  // do tempo. A tela abre em "Ativo" e o usuário amplia se quiser.
  const [statusConf, setStatusConf] = useState<"Ativo" | "Desativado" | "todos">("Ativo");
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
  const { data: filiaisComCodigo = new Set<string>() } = useQuery({
    queryKey: ["oem-codigos-gravados", tid],
    enabled: !!tid,
    queryFn: async () => {
      const linhas = await fetchAllRows<{ oem_codigo_filial: string }>(() =>
        (supabase.from("cliente_produtos" as any) as any)
          .select("oem_codigo_filial")
          .eq("tenant_id", tid)
          .not("oem_codigo_filial", "is", null),
      );
      return new Set(linhas.map((l) => String(l.oem_codigo_filial)));
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
        return {
          multiplas: pendentes.filter((l) => (porCli.get(l.ds_customer_id!)?.size ?? 0) > 1),
          semProduto: pendentes.filter((l) => (porCli.get(l.ds_customer_id!)?.size ?? 0) <= 1),
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
      // Vínculo achado por nome merece outro olhar: ele existe porque o OEM
      // mandou o CNPJ do grupo e não o da loja.
      porNome: linhas.filter((l) => l.criterio_match === "nome" && l.ds_customer_id).length,
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
  }, [linhas, filiaisComCodigo, statusConf]);

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
          : "Concluído.",
      });
      queryClient.invalidateQueries({ queryKey: ["oem-recon", conta?.id] });
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
      [l.razao_oem, l.razao_ds, l.cnpj_norm, l.cnpj_ds, l.filial_codigo, l.empresa_codigo]
        .some((c) => String(c ?? "").toLowerCase().includes(q)));
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
          <TabsTrigger value="pendencias">Pendências</TabsTrigger>
        </TabsList>

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

        {/* ------------------------------------------------------- visão geral */}
        <TabsContent value="visao" className="space-y-4">
          <Explica>
            O resumo do cruzamento entre as <strong>licenças do OEM</strong> e os{" "}
            <strong>clientes do DoctorSaaS</strong>. Nada aqui é editável — é o retrato do que a
            última atualização do espelho encontrou.
          </Explica>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Numero valor={String(r.filiais)} rotulo="Filiais no OEM" sub={`${r.ativas} ativas`} />
            <Numero valor={String(r.vinculadas)} rotulo="Vinculadas automaticamente" tom="bom"
              sub={r.ativas ? `${((r.vinculadas / r.ativas) * 100).toFixed(1)}% das ativas` : undefined} />
            <Numero valor={String(r.escolher.length)} rotulo="Aguardando escolha"
              tom={r.escolher.length ? "alerta" : "bom"} sub="CNPJ com mais de um cliente" />
            <Numero valor={brl(r.receita - r.custo)} rotulo="Margem mensal" tom="bom"
              sub={`${brl(r.receita)} − ${brl(r.custo)}`} />
          </div>

          {r.porNome > 0 && (
            <Explica>
              <strong>{r.porNome}</strong> licenças foram casadas <strong>pelo nome</strong>, e não
              pelo CNPJ. Isso acontece quando o OEM manda o CNPJ do <strong>grupo</strong> em toda
              filial em vez do da loja — medido no grupo 8201 (Bem Docado): 23 filiais, um CNPJ só.
              Nesses casos o CNPJ não distingue uma loja da outra e quem desempata é o nome. Vale
              conferir por amostragem antes de confiar nos números delas.
            </Explica>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Como o vínculo é feito</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                O casamento é por CNPJ, mas o vínculo é por <strong>filial</strong> — cada filial
                é uma licença com custo próprio. Quando o CNPJ tem um cliente só, o vínculo nasce
                pronto. Quando tem mais de um, a filial vai para <strong>Escolher candidato</strong>.
              </p>
              <p>
                Decisões tomadas à mão são preservadas quando o espelho é atualizado — ninguém
                precisa escolher duas vezes.
              </p>
            </CardContent>
          </Card>
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
          {(r.semCodigo.multiplas.length > 0 || r.semCodigo.semProduto.length > 0) && (
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
    </div>
  );
}
