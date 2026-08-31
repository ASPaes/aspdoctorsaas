import { useMemo } from "react";
import { Explica, Numero, brl, num, nomeTipo, Vazio } from "./ui";
import type { LinhaRecon } from "./useHiperDados";

/**
 * O retrato do cruzamento. Nada aqui é editável: o que precisa de decisão está
 * em Divergências, cliente por cliente.
 *
 * A régua muda por tipo de contrato e é por isso que os totais aparecem
 * quebrados: no Hiperador a receita é sua e o custo é do parceiro; nas centrais
 * quem cobra é a Hiper e a sua margem é o repasse. Somar os três numa linha só
 * daria um markup que não significa nada.
 */
export default function HiperVisaoGeralTab({ recon }: { recon: LinhaRecon[] }) {
  const r = useMemo(() => {
    const contas = recon.filter((x) => x.id_portal);
    const vivas = contas.filter((x) => x.situacao_hiper === "ativo" || x.situacao_hiper === "bloqueado");
    const ativas = contas.filter((x) => x.situacao_hiper === "ativo");
    const vinculadas = vivas.filter((x) => x.estado_match === "vinculado");
    const semDono = vivas.filter((x) => x.estado_match === "sem_dono");
    const ambiguas = contas.filter((x) => x.estado_match === "ambiguo");
    const semConta = recon.filter((x) => !x.id_portal);
    const custo = vinculadas.reduce((a, x) => a + Number(x.custo_hiper ?? 0), 0);
    const receita = vinculadas.reduce((a, x) => a + Number(x.mensalidade_ds ?? 0), 0);
    const pendentes = recon.filter((x) => x.status_usuario === "pendente" && x.divergencias.length > 0);

    const porTipo = ["hiper", "central_cobranca", "central_leads"].map((t) => {
      const g = vinculadas.filter((x) => x.responsavel_tipo === t);
      return {
        tipo: t,
        qt: g.length,
        custo: g.reduce((a, x) => a + Number(x.custo_hiper ?? 0), 0),
        receita: g.reduce((a, x) => a + Number(x.mensalidade_ds ?? 0), 0),
      };
    }).filter((x) => x.qt > 0);

    return { contas, vivas, ativas, vinculadas, semDono, ambiguas, semConta, custo, receita, pendentes, porTipo };
  }, [recon]);

  if (recon.length === 0) {
    return <Vazio>O espelho ainda não foi puxado. Vá em <strong>Sincronização</strong> e atualize.</Vazio>;
  }

  return (
    <div className="space-y-4">
      <Explica>
        O resumo do cruzamento entre a <strong>carteira do PortalHiper</strong> e os{" "}
        <strong>clientes do DoctorSaaS</strong>. É o retrato do último espelho, e nada aqui é
        editável — o que precisa de decisão está em <strong>Divergências</strong>.
      </Explica>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Numero valor={num(r.ativas.length)} rotulo="Contas ativas no Hiper"
          sub={`${num(r.contas.length)} no total, incluindo inativas`} />
        <Numero valor={num(r.vinculadas.length)} rotulo="Vinculadas a um cliente" tom="bom"
          sub={r.vivas.length ? `${((r.vinculadas.length / r.vivas.length) * 100).toFixed(1)}% das vivas` : undefined} />
        <Numero valor={num(r.semDono.length)} rotulo="Sem cliente aqui"
          tom={r.semDono.length ? "ruim" : "bom"}
          sub="Conta viva no Hiper que ninguém daqui é dono — custo sem receita" />
        <Numero valor={num(r.semConta.length)} rotulo="Sem conta no Hiper"
          tom={r.semConta.length ? "alerta" : "bom"}
          sub="Contrato ativo aqui sem conta viva lá" />
        <Numero valor={num(r.pendentes.length)} rotulo="Pendências a decidir"
          tom={r.pendentes.length ? "alerta" : "bom"}
          sub="Resolvidas em Divergências" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Numero valor={brl(r.receita)} rotulo="Mensalidade DoctorSaaS"
          sub="Das contas vinculadas" />
        <Numero valor={brl(r.custo)} rotulo="Custo Hiper"
          sub="O que a Hiper cobra ou retém, no último lote fechado" />
        <Numero valor={brl(r.receita - r.custo)} rotulo="Margem bruta"
          tom={r.receita - r.custo >= 0 ? "bom" : "ruim"}
          sub={<span title="Mensalidade ÷ custo do parceiro">
            {r.custo > 0 ? `${(r.receita / r.custo).toFixed(2)}× de markup` : "Sem custo, não há markup"}
          </span>} />
      </div>

      {r.porTipo.length > 0 && (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Tipo de contrato</th>
                <th className="px-3 py-2 text-right font-medium">Contas</th>
                <th className="px-3 py-2 text-right font-medium">Mensalidade DS</th>
                <th className="px-3 py-2 text-right font-medium">Custo Hiper</th>
                <th className="px-3 py-2 text-right font-medium">Margem</th>
                <th className="px-3 py-2 text-right font-medium">Markup</th>
              </tr>
            </thead>
            <tbody>
              {r.porTipo.map((t) => (
                <tr key={t.tipo} className="border-t">
                  <td className="px-3 py-2">{nomeTipo(t.tipo)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(t.qt)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(t.receita)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(t.custo)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(t.receita - t.custo)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.custo > 0 ? `${(t.receita / t.custo).toFixed(2)}×` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Explica>
        A régua não é a mesma nos três. No <strong>Hiperador</strong> quem cobra o cliente é
        você, e o portal nem sabe o preço: o markup é a sua mensalidade dividida pelo custo do
        parceiro. Na <strong>Central de Cobrança</strong> e na <strong>Central de Leads</strong>{" "}
        quem cobra é a Hiper, e o custo é tudo o que ela retém — a sua margem é o repasse que
        você recebe.
      </Explica>
    </div>
  );
}
