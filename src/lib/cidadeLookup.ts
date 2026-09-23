import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaginate";

/**
 * Resolve o `cidade_id` a partir do que as APIs externas devolvem.
 *
 * O ViaCEP escreve o nome acentuado ("Teutônia"); a Receita (BrasilAPI /
 * ReceitaWS) devolve caixa alta e SEM acento ("TEUTONIA"). Como `ilike` não
 * ignora acento, o casamento direto por nome falhava em 2.384 das 5.570
 * cidades e o campo ficava vazio no cadastro.
 */

export type CidadeRef = { id: number; nome: string };

export function normalizeCidadeNome(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function acharCidadePorNome(cidades: CidadeRef[], nome: string): CidadeRef | null {
  const alvo = normalizeCidadeNome(nome ?? "");
  if (!alvo) return null;
  return cidades.find((c) => normalizeCidadeNome(c.nome) === alvo) ?? null;
}

async function porCodigoIbge(estadoId: number, ibge: string): Promise<number | null> {
  const { data } = await supabase
    .from("cidades")
    .select("id")
    .eq("estado_id", estadoId)
    .eq("codigo_ibge", ibge)
    .limit(1);
  return data && data.length > 0 ? data[0].id : null;
}

/**
 * Ordem: código IBGE (imune a grafia) → nome sem acento → CEP consultado no
 * ViaCEP só para obter o IBGE, que cobre divergência de grafia além do acento
 * ("Moji Mirim" x "Mogi Mirim").
 */
export async function resolverCidadeId(
  estadoId: number,
  opts: { nome?: string | null; codigoIbge?: string | number | null; cep?: string | null }
): Promise<number | null> {
  const ibge = opts.codigoIbge ? String(opts.codigoIbge).replace(/\D/g, "") : "";
  if (ibge) {
    const porIbge = await porCodigoIbge(estadoId, ibge);
    if (porIbge) return porIbge;
  }

  if (opts.nome) {
    const cidades = await fetchAllRows<CidadeRef>(() =>
      supabase.from("cidades").select("id, nome").eq("estado_id", estadoId)
    );
    const hit = acharCidadePorNome(cidades, opts.nome);
    if (hit) return hit.id;
  }

  const cepDigits = (opts.cep ?? "").replace(/\D/g, "");
  if (!ibge && cepDigits.length === 8) {
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepDigits}/json/`);
      const via = await res.json();
      if (via?.ibge) return await porCodigoIbge(estadoId, String(via.ibge));
    } catch {
      // último recurso: se o ViaCEP não responder, fica sem cidade como antes
    }
  }

  return null;
}
