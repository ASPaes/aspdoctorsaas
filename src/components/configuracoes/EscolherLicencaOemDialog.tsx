import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Search, AlertTriangle, Unlink } from "lucide-react";

// ============================================================================
// O CAMINHO INVERSO: escolher a LICENÇA de um cliente.
//
// O `EscolherClienteOemDialog` responde "de quem é esta licença?", e é o que a
// fila de conciliação pede. Este responde a pergunta oposta, que só aparece na
// divergência "Cliente sem licença no OEM": o cliente existe, paga, e nenhuma
// filial casou com ele — quase sempre porque o CNPJ da loja no OEM é diferente
// do cadastrado aqui. Sem esta tela, as únicas saídas eram Ignorar (que esconde
// o problema) e Abrir ficha (que não diz qual filial escolher).
//
// A lista vem PRONTA do pai, sem query nova: a aba já carregou a reconciliação
// inteira para montar as divergências, e são ~2.600 linhas — buscar de novo só
// para filtrar aqui dentro seria egress repetido.
// ============================================================================

export type LicencaOem = {
  id: string;                       // id da linha de reconciliação — é o que a RPC recebe
  empresa_codigo: string | null;
  filial_codigo: string | null;
  razao_oem: string | null;
  cnpj_norm: string | null;
  custo_oem: number | null;
  status_oem: string | null;
  ds_customer_id: string | null;    // dono atual, quando já tem
  razao_ds: string | null;
};

const brl = (v: number | null | undefined) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const soDigitos = (s: string) => s.replace(/\D/g, "");

// Quantas linhas a lista mostra de uma vez. São 2.600 licenças: desenhar todas
// trava a rolagem do diálogo, e ninguém decide olhando 2.600 opções. Quem não
// achou nas primeiras refina a busca — e a tela diz que existem mais.
const TETO = 40;

export default function EscolherLicencaOemDialog({
  cliente, licencas, aberto, onOpenChange, onDecidido,
}: {
  // `soltar` é o caso da TROCA: o cliente já tem uma licença vinculada e ela é
  // a errada — foi por ela que a divergência apareceu. Sem isso a tela deixava
  // vincular a certa e a errada continuava no nome dele, com o mesmo alerta na
  // lista logo depois de alguém ter acabado de resolver.
  cliente: { id: string; nome: string; soltar?: LicencaOem | null } | null;
  licencas: LicencaOem[];
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  onDecidido: () => void;
}) {
  const { toast } = useToast();
  const [busca, setBusca] = useState("");
  const [gravando, setGravando] = useState<string | null>(null);
  // A licença escolhida que JÁ é de outro cliente. Enquanto estiver preenchida,
  // a troca espera confirmação: tirar a licença de um cadastro e pôr em outro
  // muda a margem dos dois, e é o tipo de coisa que não pode sair num clique.
  const [trocar, setTrocar] = useState<LicencaOem | null>(null);

  const resultado = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const dig = soDigitos(termo);
    const casa = (l: LicencaOem) => {
      if (!termo) return true;
      if (dig.length >= 3 && (l.cnpj_norm ?? "").includes(dig)) return true;
      if (dig.length >= 2 && (String(l.filial_codigo) === dig || String(l.empresa_codigo) === dig)) return true;
      return (l.razao_oem ?? "").toLowerCase().includes(termo)
        || (l.razao_ds ?? "").toLowerCase().includes(termo);
    };
    const achadas = licencas.filter(casa).sort((a, b) => {
      // A que está no cliente hoje vem antes de tudo: é com ela que a troca é
      // comparada, e sem isso ela cairia no fim de 2.600 linhas — justamente a
      // única que quem abriu a tela já conhece.
      const sa = a.id === cliente?.soltar?.id ? 0 : 1;
      const sb = b.id === cliente?.soltar?.id ? 0 : 1;
      if (sa !== sb) return sa - sb;
      // Livre primeiro: é o caso sem efeito colateral. Depois as já vinculadas,
      // que exigem decisão.
      const da = a.ds_customer_id ? 1 : 0;
      const db = b.ds_customer_id ? 1 : 0;
      if (da !== db) return da - db;
      return (a.razao_oem ?? "").localeCompare(b.razao_oem ?? "", "pt-BR");
    });
    return { achadas: achadas.slice(0, TETO), total: achadas.length };
  }, [licencas, busca, cliente?.soltar?.id]);

  async function vincular(l: LicencaOem) {
    if (!cliente) return;
    setGravando(l.id);
    try {
      // A ORDEM AQUI NÃO É ESCOLHA DE ESTILO. `desvincular_filial_oem` apaga o
      // código do OEM da ficha do cliente; rodando depois do vínculo novo, ela
      // apagaria justamente o código que acabou de ser gravado e o cliente
      // ficaria sem licença nenhuma. Soltar primeiro, vincular depois.
      const aSoltar = cliente.soltar;
      if (aSoltar && aSoltar.id !== l.id) {
        const { error } = await (supabase as any).rpc("desvincular_filial_oem", {
          p_recon_id: aSoltar.id,
        });
        if (error) throw error;
      }
      // A mesma RPC da fila de conciliação: ela já tira o código da ficha do
      // dono antigo antes de gravar no novo, então a troca não deixa dois
      // cadastros dizendo ser a mesma filial.
      const { error } = await (supabase as any).rpc("vincular_filial_oem", {
        p_recon_id: l.id,
        p_cliente_id: cliente.id,
      });
      if (error) throw error;
      toast({
        title: "Licença vinculada",
        description: aSoltar && aSoltar.id !== l.id
          ? `Filial ${l.filial_codigo} agora é de ${cliente.nome}, e a filial ${aSoltar.filial_codigo} voltou para a fila sem dono.`
          : `Filial ${l.filial_codigo} agora é de ${cliente.nome}. A decisão sobrevive às próximas sincronizações.`,
      });
      setTrocar(null);
      onDecidido();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Não deu para vincular", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setGravando(null);
    }
  }

  // Soltar sem pôr nada no lugar. É o caso de quem descobre que a licença não é
  // deste cliente e ainda não sabe de quem é: ela volta para a fila sem dono,
  // onde a tela já sabe oferecer o cliente certo.
  async function soltar(l: LicencaOem) {
    setGravando(l.id);
    try {
      const { error } = await (supabase as any).rpc("desvincular_filial_oem", { p_recon_id: l.id });
      if (error) throw error;
      toast({
        title: "Vínculo desfeito",
        description: `A filial ${l.filial_codigo} voltou para a fila, sem cliente.`,
      });
      onDecidido();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Não deu para soltar", description: e?.message ?? "Erro", variant: "destructive" });
    } finally {
      setGravando(null);
    }
  }

  return (
    <>
      <Dialog open={aberto} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {cliente?.soltar ? "Trocar a licença de " : "Escolher a licença de "}
              {cliente?.nome ?? "—"}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                {cliente?.soltar && (
                  <p className="flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      Hoje ele está na <strong>filial {cliente.soltar.filial_codigo}</strong>
                      {cliente.soltar.razao_oem ? <> ({cliente.soltar.razao_oem})</> : null}. Escolher
                      outra <strong>solta essa filial</strong>, que volta para a fila sem cliente, e
                      grava a nova na ficha.
                    </span>
                  </p>
                )}
                <p>
                  Todas as <strong>licenças do OEM</strong> desta conta. Procure pelo nome da
                  loja, pelo CNPJ ou pelo número da filial e vincule a que é deste cliente.
                </p>
                <p>
                  Vincular grava o <strong>código da filial na ficha do cliente</strong>, que é o
                  que faz o custo da licença aparecer nele. Nada é enviado ao parceiro.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              className="pl-8"
              placeholder="Nome da loja, CNPJ ou número da filial"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div className="divide-y rounded border max-h-[26rem] overflow-y-auto">
            {resultado.achadas.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma licença encontrada. Tente parte do nome da loja ou só os números do CNPJ.
              </p>
            ) : (
              resultado.achadas.map((l) => {
                const doOutro = !!l.ds_customer_id && l.ds_customer_id !== cliente?.id;
                const jaDele = !!cliente && l.ds_customer_id === cliente.id;
                // A que motivou a troca. Ela é "já é deste cliente" como as
                // outras, mas é a única com saída própria: soltar sem escolher
                // substituta, para quem não sabe qual é a certa.
                const aTrocar = l.id === cliente?.soltar?.id;
                return (
                  <div key={l.id}
                    className={`flex items-center gap-3 p-3 text-sm ${aTrocar ? "bg-amber-500/5" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        {l.razao_oem || "(sem nome no OEM)"}
                        {l.status_oem !== "Ativo" && (
                          <Badge variant="outline" className="ml-2 text-xs">{l.status_oem ?? "sem status"}</Badge>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        filial {l.filial_codigo} · grupo {l.empresa_codigo} · CNPJ{" "}
                        {l.cnpj_norm || "—"} · custo {brl(l.custo_oem)}/mês
                      </p>
                      {doOutro && (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          hoje vinculada a {l.razao_ds || "outro cliente"}
                        </p>
                      )}
                    </div>
                    {aTrocar ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
                          vinculada hoje
                        </Badge>
                        <Button size="sm" variant="ghost" className="gap-1.5"
                          disabled={!!gravando} onClick={() => soltar(l)}>
                          {gravando === l.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Unlink className="h-3.5 w-3.5" />}
                          Só soltar
                        </Button>
                      </div>
                    ) : jaDele ? (
                      <Badge variant="outline" className="shrink-0">já é deste cliente</Badge>
                    ) : (
                      <Button
                        size="sm"
                        variant={doOutro ? "secondary" : "default"}
                        className="gap-1.5 shrink-0"
                        disabled={!!gravando}
                        onClick={() => (doOutro ? setTrocar(l) : vincular(l))}
                      >
                        {gravando === l.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Check className="h-3.5 w-3.5" />}
                        {doOutro ? "Trocar vínculo" : "Vincular"}
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {resultado.total > resultado.achadas.length && (
            <p className="text-xs text-muted-foreground">
              Mostrando {resultado.achadas.length} de {resultado.total} licenças. Refine a busca
              para ver as demais.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* A troca de dono. O nome dos dois lados aparece porque é isso que a
          pessoa precisa reconhecer antes de confirmar: um cadastro perde o
          custo da licença e o outro ganha. */}
      <Dialog open={!!trocar} onOpenChange={(v) => { if (!v && !gravando) setTrocar(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Esta licença já é de outro cliente</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3">
                <div className="rounded border p-2 text-sm">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                    Licença
                  </div>
                  <div className="font-medium break-words">{trocar?.razao_oem || "—"}</div>
                  <div className="text-xs text-muted-foreground">
                    filial {trocar?.filial_codigo} · custo {brl(trocar?.custo_oem)}/mês
                  </div>
                </div>
                <p className="text-sm flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                  <span>
                    Hoje ela está vinculada a <strong>{trocar?.razao_ds || "outro cliente"}</strong>.
                    Trocar tira o código da ficha dele e grava na de{" "}
                    <strong>{cliente?.nome}</strong>: o custo da licença sai de um e entra no
                    outro, mudando a margem dos dois.
                  </span>
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={!!gravando} onClick={() => setTrocar(null)}>
              Não, deixar como está
            </Button>
            <Button disabled={!!gravando} onClick={() => trocar && vincular(trocar)}>
              {gravando
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : `Sim, passar para ${cliente?.nome ?? ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
