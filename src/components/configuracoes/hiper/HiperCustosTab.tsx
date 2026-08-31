import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Explica, Origem, Vazio, brl, nomeTipo, cnpjMask } from "./ui";
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
                const dif = Number(r.custo_ds ?? 0) - Number(r.custo_hiper ?? 0);
                const markup = Number(r.custo_hiper ?? 0) > 0
                  ? Number(r.mensalidade_ds ?? 0) / Number(r.custo_hiper) : null;
                return (
                  <tr key={r.id} className="border-t hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium truncate max-w-[22rem]">{r.razao_social_ds ?? r.razao_social_hiper}</div>
                      <div className="text-xs text-muted-foreground">{cnpjMask(r.cnpj_norm)}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{nomeTipo(r.responsavel_tipo)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(r.mensalidade_ds)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {r.mrr_hiper == null ? "—" : brl(r.mrr_hiper)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(r.custo_ds)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{brl(r.custo_hiper)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${
                      Math.abs(dif) < 0.01 ? "text-muted-foreground"
                        : dif > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}>
                      {dif > 0 ? "+" : ""}{brl(dif)}
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
