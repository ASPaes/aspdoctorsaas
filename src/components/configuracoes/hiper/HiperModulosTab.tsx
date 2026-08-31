import React, { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Download, Loader2 } from "lucide-react";
import { Explica, PortalDesatualizado, Vazio, brl, num, TIPO_CONTRATO } from "./ui";

/**
 * O de-para entre o catálogo do portal e o daqui.
 *
 * Diferente do OEM, aqui NÃO existe tabela de preços: o Hiper cobra por cliente,
 * e o custo do mesmo app varia de um para outro. Por isso a coluna mostra faixa
 * (mín–máx), não preço.
 *
 * A chave do vínculo é o NOME, porque é o que o portal tem: app e plano são
 * texto, não código. Se o Hiper renomear um app, o vínculo cai e o item volta
 * para "não vinculado" — falha visível, nunca silenciosa.
 */
/** Fora do componente de propósito: declarado dentro do render, cada render cria
 *  um tipo novo e o React remonta o <select> — o campo perde o foco a cada tecla. */
function Sel({ value, onChange, children, disabled }: {
  value: string | number | null | undefined;
  onChange: (v: string | null) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <select value={value ?? ""} disabled={disabled}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className="h-8 w-full max-w-[18rem] rounded-md border bg-background px-2 text-sm">
      <option value="">— não vinculado —</option>
      {children}
    </select>
  );
}

export default function HiperModulosTab({
  tid, espelho, modulos, vinculos, catalogo, temRecon,
}: {
  tid: string | null;
  espelho: any[];
  modulos: any[];
  vinculos: any[];
  catalogo: { produtos: any[]; modulos: any[]; modelos: any[] } | undefined;
  temRecon: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [salvando, setSalvando] = useState<string | null>(null);
  const [previa, setPrevia] = useState<any | null>(null);
  const [importando, setImportando] = useState(false);

  const vinculoDe = (tipo: string, chave: string) =>
    vinculos.find((v) => v.tipo === tipo && v.chave === chave);

  /**
   * Módulo do Hiper só pode virar módulo de um produto Hiper. Quem define quais
   * produtos são esses é a seção Planos logo acima — oferecer o catálogo inteiro
   * do tenant deixava vincular um app do Hiper a um módulo de outro produto, e o
   * erro só apareceria depois, na importação, como "sem produto no contrato".
   */
  const produtosDosPlanos = useMemo(
    () => new Set(vinculos.filter((v) => v.tipo === "plano" && v.produto_id).map((v) => v.produto_id)),
    [vinculos],
  );

  const nomeProduto = (id: number) =>
    catalogo?.produtos?.find((p: any) => p.id === id)?.nome ?? "Sem produto";

  /** Os produtos que a seção Planos escolheu, na ordem em que aparecem na tela. */
  const produtosAlvo = useMemo(
    () => Array.from(produtosDosPlanos).sort((a, b) =>
      nomeProduto(a as number).localeCompare(nomeProduto(b as number), "pt-BR")) as number[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [produtosDosPlanos, catalogo],
  );

  const vinculoModulo = (app: string, produtoId: number) =>
    vinculos.find((v) => v.tipo === "modulo" && v.chave === app && v.produto_id === produtoId);

  const modulosDoProduto = (produtoId: number) =>
    (catalogo?.modulos ?? [])
      .filter((m: any) => m.produto_id === produtoId)
      .sort((a: any, b: any) => a.nome.localeCompare(b.nome, "pt-BR"));

  const semPlanoVinculado = produtosDosPlanos.size === 0;

  const apps = useMemo(() => {
    const m = new Map<string, { nome: string; contas: number; bonificados: number; min: number; max: number }>();
    for (const x of modulos) {
      const k = x.app_nome as string;
      const c = Number(x.custo ?? 0);
      const a = m.get(k) ?? { nome: k, contas: 0, bonificados: 0, min: Infinity, max: 0 };
      a.contas++;
      if (String(x.comprado_por ?? "").toLowerCase() === "bonificado" || c === 0) a.bonificados++;
      a.min = Math.min(a.min, c); a.max = Math.max(a.max, c);
      m.set(k, a);
    }
    return Array.from(m.values()).sort((a, b) => b.contas - a.contas);
  }, [modulos]);

  const planos = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of espelho) if (c.plano) m.set(c.plano, (m.get(c.plano) ?? 0) + 1);
    return Array.from(m.entries()).map(([nome, contas]) => ({ nome, contas }))
      .sort((a, b) => b.contas - a.contas);
  }, [espelho]);

  const tiposNaCarteira = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of espelho) if (c.responsavel_tipo) m.set(c.responsavel_tipo, (m.get(c.responsavel_tipo) ?? 0) + 1);
    return Array.from(m.entries()).map(([chave, contas]) => ({ chave, contas }))
      .sort((a, b) => b.contas - a.contas);
  }, [espelho]);

  const gravar = async (
    tipo: string, chave: string, campo: string, valor: any,
    // Só para tipo='modulo': o mesmo app tem um vínculo por produto, então a
    // linha a mexer é a daquele produto, não "a do app".
    produtoId?: number,
  ) => {
    setSalvando(`${tipo}|${chave}|${produtoId ?? ""}`);
    try {
      const t = (supabase.from("hiper_catalogo_vinculo" as any) as any);
      const existente = produtoId != null ? vinculoModulo(chave, produtoId) : vinculoDe(tipo, chave);
      if (valor === null) {
        if (existente) {
          const { error } = await t.delete().eq("id", existente.id);
          if (error) throw error;
        }
      } else if (existente) {
        const { error } = await t.update({ [campo]: valor, atualizado_em: new Date().toISOString() })
          .eq("id", existente.id);
        if (error) throw error;
      } else {
        const { error } = await t.insert({
          tenant_id: tid, tipo, chave, [campo]: valor,
          ...(produtoId != null ? { produto_id: produtoId } : {}),
        });
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ["hiper_vinculos"] });
      toast({ title: "Vínculo salvo", description: "Rode “Só reconciliar” para a mudança valer nas divergências." });
    } catch (e: any) {
      toast({ title: "Erro ao salvar vínculo", description: e.message, variant: "destructive" });
    } finally { setSalvando(null); }
  };

  const importar = async (previaApenas: boolean) => {
    setImportando(true);
    try {
      const { data, error } = await supabase.rpc("hiper_importar_modulos" as any, {
        p_tenant_id: tid, p_previa: previaApenas,
      } as any);
      if (error) throw error;
      const r = data as any;
      if (!r?.ok) throw new Error(r?.erro || "Falhou.");
      if (previaApenas) { setPrevia(r); return; }
      setPrevia(null);
      toast({
        title: `${num(r.inseridos)} módulos importados`,
        description: `${num(r.ja_tinham)} já existiam · ${num(r.sem_produto_no_contrato)} sem o produto no contrato`,
      });
      qc.invalidateQueries({ queryKey: ["hiper_recon"] });
    } catch (e: any) {
      toast({ title: "Erro na importação", description: e.message, variant: "destructive" });
    } finally { setImportando(false); }
  };

  return (
    <div className="space-y-5">
      <Explica>
        Aqui o catálogo do PortalHiper encontra o do DoctorSaaS. Ele é <strong>derivado do
        espelho</strong>: aparece o que a sua carteira realmente usa, não uma lista fixa.
        <br /><br />
        <strong>Não existe tabela de preços como no OEM.</strong> O Hiper cobra por cliente, e o
        mesmo app custa valores diferentes em contas diferentes — por isso a coluna mostra faixa,
        e não preço. Módulo do Hiper <strong>não tem preço de venda</strong>: só custo.
      </Explica>

      {/* Tipo de contrato vem primeiro porque é ele que decide qual regra de
          dinheiro vale para o cliente. Sem esse mapa, a divergência de valor
          compara o número errado. */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Tipo de contrato</h3>
        <p className="text-xs text-muted-foreground">
          Como o Hiper chama o arranjo comercial, e o modelo de contrato equivalente aqui.
        </p>
        <div className="rounded-lg border divide-y">
          {tiposNaCarteira.map(({ chave, contas }) => {
            const v = vinculoDe("contrato", chave);
            return (
              <div key={chave} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{TIPO_CONTRATO[chave]?.nome ?? chave}</p>
                  <p className="text-xs text-muted-foreground">
                    {num(contas)} contas · {TIPO_CONTRATO[chave]?.explica ?? ""}
                  </p>
                </div>
                <Sel value={v?.modelo_contrato_id ?? ""} disabled={salvando === `contrato|${chave}`}
                  onChange={(val) => gravar("contrato", chave, "modelo_contrato_id", val === null ? null : Number(val))}>
                  {(catalogo?.modelos ?? []).map((m: any) => (
                    <option key={m.id} value={m.id}>{m.nome}</option>
                  ))}
                </Sel>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Planos</h3>
        <div className="rounded-lg border divide-y">
          {planos.length === 0 && <div className="p-3"><Vazio>Nenhum plano no espelho ainda.</Vazio></div>}
          {planos.map(({ nome, contas }) => {
            const v = vinculoDe("plano", nome);
            return (
              <div key={nome} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{nome}</p>
                  <p className="text-xs text-muted-foreground">{num(contas)} contas</p>
                </div>
                <Sel value={v?.produto_id ?? ""} disabled={salvando === `plano|${nome}`}
                  onChange={(val) => gravar("plano", nome, "produto_id", val === null ? null : Number(val))}>
                  {(catalogo?.produtos ?? []).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </Sel>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Módulos (apps)</h3>
          {apps.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => importar(true)} disabled={importando}>
              {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Importar módulos para os contratos
            </Button>
          )}
        </div>
        {semPlanoVinculado && apps.length > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              Vincule os planos primeiro
            </p>
            <p className="text-muted-foreground mt-1">
              A lista de módulos sai dos <strong>produtos escolhidos nos planos</strong> acima.
              Sem isso não há de onde tirá-la — e oferecer o catálogo inteiro deixaria ligar um
              app do Hiper a um módulo de outro produto.
            </p>
          </div>
        )}
        {!semPlanoVinculado && (
          <p className="text-xs text-muted-foreground">
            Um vínculo por produto:{" "}
            <strong>{produtosAlvo.map((id) => nomeProduto(id)).join(" e ")}</strong> — os que você
            escolheu nos planos. O mesmo app do Hiper aparece nos dois, e o módulo daqui pertence
            a um produto só.
          </p>
        )}
        {apps.length === 0 ? (
          <PortalDesatualizado o_que="os módulos de cada conta" />
        ) : (
          <div className="rounded-lg border divide-y">
            {apps.map((a) => {
              const gratuito = a.max === 0;
              return (
                <div key={a.nome} className="flex flex-wrap items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm flex items-center gap-2">
                      {a.nome}
                      {gratuito && <Badge variant="secondary" className="text-[10px]">sempre gratuito</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {num(a.contas)} contas ·{" "}
                      {gratuito ? "custo zero em todas"
                        : a.min === a.max ? `custo ${brl(a.max)}`
                        : `custo de ${brl(a.min)} a ${brl(a.max)}`}
                      {a.bonificados > 0 && !gratuito && ` · ${num(a.bonificados)} sem custo`}
                    </p>
                  </div>
                  {/* Um seletor POR PRODUTO. O mesmo app aparece nos dois planos
                      e o módulo daqui pertence a um produto só — um seletor
                      único obrigaria a escolher um plano e deixaria o outro sem
                      o módulo na hora de importar. */}
                  <div className="flex flex-col gap-1.5">
                    {produtosAlvo.map((pid) => (
                      <label key={pid} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">
                          {nomeProduto(pid)}
                        </span>
                        <Sel value={vinculoModulo(a.nome, pid)?.modulo_id ?? ""}
                          disabled={salvando === `modulo|${a.nome}|${pid}`}
                          onChange={(val) => gravar("modulo", a.nome, "modulo_id", val, pid)}>
                          {modulosDoProduto(pid).map((m: any) => (
                            <option key={m.id} value={m.id}>{m.nome}</option>
                          ))}
                        </Sel>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <AlertDialog open={!!previa} onOpenChange={(o) => !o && setPrevia(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Importar módulos para os contratos</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Isto <strong>grava nos contratos do DoctorSaaS</strong>. Cada módulo entra com
                  o custo que o portal cobra e <strong>sem valor de venda</strong> — módulo do
                  Hiper não tem MRR.
                </p>
                <ul className="list-disc pl-5 space-y-0.5">
                  <li><strong>{num(previa?.a_inserir)}</strong> módulos a inserir</li>
                  <li>{num(previa?.ja_tem)} já existem no contrato e não serão tocados</li>
                  <li>
                    {num(previa?.sem_produto_no_contrato)} sem o produto correspondente no
                    contrato do cliente — esses ficam de fora
                  </li>
                </ul>
                {previa?.a_inserir === 0 && (
                  <p className="text-muted-foreground">
                    Nada a fazer: vincule os apps aos módulos do DoctorSaaS acima primeiro.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={!previa?.a_inserir || importando}
              onClick={(e) => { e.preventDefault(); importar(false); }}>
              {importando && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Importar {num(previa?.a_inserir)} módulos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
