import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Explica, Numero, Origem, Vazio, anual, brl, nomeTipo, cnpjMask, num } from "./ui";
import type { LinhaRecon } from "./useHiperDados";

/**
 * Os dois custos da mesma conta, lado a lado. Só leitura: onde divergem, quem
 * está desatualizado é o cadastro daqui, e a correção acontece em Divergências,
 * junto do resto do que aquele cliente tem para resolver.
 */
export default function HiperCustosTab({ recon }: { recon: LinhaRecon[] }) {
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<string>("todos");
  const [soDivergentes, setSoDivergentes] = useState(true);

  const linhas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return recon
      .filter((r) => r.estado_match === "vinculado" && r.custo_hiper != null)
      .filter((r) => tipo === "todos" || r.responsavel_tipo === tipo)
      .filter((r) => !soDivergentes || r.divergencias.includes("custo_divergente") || r.divergencias.includes("mrr_divergente"))
      .filter((r) => !q
        || (r.razao_social_ds ?? "").toLowerCase().includes(q)
        || (r.razao_social_hiper ?? "").toLowerCase().includes(q)
        || (r.cnpj_norm ?? "").includes(q.replace(/\D/g, "")))
      .sort((a, b) =>
        Math.abs(Number(b.custo_ds ?? 0) - Number(b.custo_hiper ?? 0))
        - Math.abs(Number(a.custo_ds ?? 0) - Number(a.custo_hiper ?? 0)));
  }, [recon, busca, tipo, soDivergentes]);

  /**
   * Os totais são do que está FILTRADO na tela — o que se vê é o que se soma.
   *
   * E vêm quebrados nos dois sentidos de propósito: o saldo líquido esconde o
   * tamanho do problema, porque quem tem custo cadastrado a mais compensa quem
   * tem a menos. Na ASP o líquido é −R$ 8,4 mil, mas são R$ 11,9 mil a menos e
   * R$ 3,4 mil a mais — R$ 15,3 mil de cadastro errado.
   */
  const totais = useMemo(() => {
    let ds = 0, hiper = 0, aMais = 0, aMenos = 0, qtMais = 0, qtMenos = 0, mens = 0;
    for (const r of linhas) {
      const h = Number(r.custo_hiper ?? 0);
      const d = Number(r.custo_ds ?? 0);
      ds += d; hiper += h; mens += Number(r.mensalidade_ds ?? 0);
      const dif = d - h;
      if (dif > 0.01) { aMais += dif; qtMais++; }
      else if (dif < -0.01) { aMenos += dif; qtMenos++; }
    }
    return { ds, hiper, aMais, aMenos, qtMais, qtMenos, mens, dif: ds - hiper };
  }, [linhas]);

  if (recon.length === 0) {
    return <Vazio>O espelho ainda não foi puxado. Vá em <strong>Sincronização</strong> e atualize.</Vazio>;
  }

  return (
    <div className="space-y-3">
      <Explica>
        O <strong>Custo DS</strong> é o valor no contrato daqui; o <strong>Custo Hiper</strong> é
        o que a Hiper cobra ou retém de fato, no último lote fechado. A{" "}
        <strong>Diferença</strong> é Custo DS menos Custo Hiper, e o sinal é a informação: com{" "}
        <strong>+</strong>, o cadastro daqui cobra custo acima do real e a margem verdadeira é{" "}
        <em>melhor</em> do que a ficha mostra; com <strong>−</strong>, é <em>pior</em>.
        <br /><br />
        O <strong>MRR Hiper</strong> aparece vazio no Hiperador de propósito: ali quem cobra o
        cliente é você e o portal não conhece o seu preço. Comparar seria inventar divergência.
      </Explica>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Numero valor={brl(totais.ds)} rotulo="Custo no DoctorSaaS"
          sub={`${num(linhas.length)} ${linhas.length === 1 ? "conta" : "contas"} nesta lista`} />
        <Numero valor={brl(totais.hiper)} rotulo="Custo no Hiper"
          sub="O que a Hiper cobra ou retém no último lote fechado" />
        <Numero valor={brl(totais.aMenos)} rotulo="Custo a menos no cadastro"
          tom={totais.aMenos < -0.01 ? "ruim" : "bom"}
          sub={`${num(totais.qtMenos)} contas · a margem real é PIOR do que a ficha mostra`} />
        <Numero valor={`+${brl(totais.aMais)}`} rotulo="Custo a mais no cadastro"
          tom={totais.aMais > 0.01 ? "alerta" : "bom"}
          sub={`${num(totais.qtMais)} contas · a margem real é melhor do que a ficha mostra`} />
        <Numero valor={brl(totais.dif)} rotulo="Diferença líquida"
          tom={Math.abs(totais.dif) < 0.01 ? "bom" : totais.dif < 0 ? "ruim" : "alerta"}
          sub={<>
            Esconde o tamanho do erro: os dois sentidos somam{" "}
            <strong>{brl(Math.abs(totais.aMenos) + totais.aMais)}</strong>
          </>} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por nome ou CNPJ…" value={busca}
          onChange={(e) => setBusca(e.target.value)} className="max-w-xs" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}
          className="h-9 rounded-md border bg-background px-3 text-sm">
          <option value="todos">Todos os tipos</option>
          <option value="hiper">Hiperador</option>
          <option value="central_cobranca">Central de Cobrança</option>
          <option value="central_leads">Central de Leads</option>
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={soDivergentes}
            onChange={(e) => setSoDivergentes(e.target.checked)} />
          Só os que divergem
        </label>
        <span className="text-sm text-muted-foreground ml-auto">{linhas.length} contas</span>
      </div>

      {linhas.length === 0 ? (
        <Vazio>Nada aqui com esses filtros.</Vazio>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Cliente</th>
                <th className="px-3 py-2 text-left font-medium">Tipo</th>
                <th className="px-3 py-2 text-right font-medium">Mensalidade <Origem lado="ds" /></th>
                <th className="px-3 py-2 text-right font-medium">MRR <Origem lado="hiper" /></th>
                <th className="px-3 py-2 text-right font-medium">Custo <Origem lado="ds" /></th>
                <th className="px-3 py-2 text-right font-medium">Custo <Origem lado="hiper" /></th>
                <th className="px-3 py-2 text-right font-medium">Diferença</th>
                <th className="px-3 py-2 text-right font-medium">Markup</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((r) => {
                // Tudo no período do contrato: comparar o anual daqui com o
                // mensal do portal daria 12x de diferença inventada.
                const custoH = r.custo_hiper == null ? null : Number(r.custo_hiper);
                const mrrH = r.mrr_hiper == null ? null : Number(r.mrr_hiper);
                const dif = custoH == null ? null : Number(r.custo_ds ?? 0) - custoH;
                const markup = custoH && custoH > 0 ? Number(r.mensalidade_ds ?? 0) / custoH : null;
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium truncate max-w-[22rem]">{r.razao_social_ds ?? r.razao_social_hiper}</div>
                      <div className="text-xs text-muted-foreground">{cnpjMask(r.cnpj_norm)}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{nomeTipo(r.responsavel_tipo)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(r.mensalidade_ds)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {mrrH == null ? "—" : brl(mrrH)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(r.custo_ds)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {custoH == null ? "—" : brl(custoH)}
                      {custoH != null && (
                        <span className="block text-[10px] text-muted-foreground">
                          {brl(anual(custoH))} no ano
                        </span>
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                      dif == null || Math.abs(dif) < 0.01 ? "text-muted-foreground"
                        : dif > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                      {dif == null ? "—" : <>{dif > 0 ? "+" : ""}{brl(dif)}</>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {markup == null ? "—" : `${markup.toFixed(2)}×`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
