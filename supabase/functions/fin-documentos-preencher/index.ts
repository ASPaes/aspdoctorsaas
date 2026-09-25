import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

// fin-documentos-preencher — enche o cache de documentos, longe do cliente.
//
// POR QUE EM SEGUNDO PLANO, e esta é a lição mais cara desta feature: buscar
// documento na hora da resposta fez a 2ª via levar 107 SEGUNDOS e o cliente não
// receber nada — o motor de atendimento desistiu de esperar e mandou o aviso de
// fora do expediente no lugar. Buscar documento custa duas chamadas ao Omie, e
// quem espera do outro lado do WhatsApp não tem essa paciência.
//
// Aqui ninguém espera. Roda de tempos em tempos, enche o cache, e o chat só lê.
//
// O QUE ELE PROCURA: o `portal`, e isso é uma decisão baseada em medição. O
// endereço do portal do Omie (`click.omie.com/rXXXXXXX-YYYY`) veio IDÊNTICO em
// três chamadas separadas por horas, enquanto os PDFs mudavam a cada pedido —
// o Omie gera o PDF na hora e o portal é fixo. Então o portal se busca uma vez
// e vale; o PDF não.
//
// E o portal vale MUITO: ele é uma página protegida (pede os 5 primeiros
// dígitos do CNPJ) que reúne todos os boletos, o **Pix**, a nota, o XML e o
// demonstrativo. São 47 caracteres contra os 299 do link de boleto, e o Pix a
// API do `ObterBoleto` nunca devolveu.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LOG = '[fin-documentos-preencher]';

const DOCTOROMIE_DOCS =
  'https://vqrytdntynxuqozehals.supabase.co/functions/v1/ds-omie-documentos-obter';

/**
 * Quantos títulos por rodada.
 *
 * Cada um custa até 3 chamadas ao Omie, e o Omie bloqueia a API por 30 minutos
 * quando leva rajada. Cinco por rodada, com o cron de 5 em 5 minutos, dá 60 por
 * hora — os ~760 títulos em aberto da Digi Office enchem em meio dia, sem
 * ninguém esperando e sem irritar a API deles.
 */
const POR_RODADA = 5;
const PAUSA_MS = 1500;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405);

  const service = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const authHeader = req.headers.get('Authorization') ?? '';
  const recebido = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : authHeader.trim();
  const { data: esperado } = await service.rpc('obter_segredo_cron_fin_sync');
  if (!esperado) return json({ ok: false, error: 'Segredo do cron não configurado' }, 500);
  if (!recebido || recebido !== esperado) return json({ ok: false, error: 'Não autorizado' }, 401);

  const body = await req.json().catch(() => ({}));
  const teto: number = Number.isFinite(body?.teto) ? Math.max(1, Number(body.teto)) : POR_RODADA;

  try {
    // Só títulos em aberto, com OS, que ainda não têm o portal guardado.
    // Vencido primeiro: é dele que o cliente vai falar.
    const { data: alvos } = await service
      .from('vw_fin_titulos_abertos')
      .select('id, tenant_id, origem_conta_id, origem_id, documentos')
      .eq('origem', 'omie')
      .not('origem_os_id', 'is', null)
      .is('documentos', null)
      .order('vencimento', { ascending: true })
      .limit(teto);

    if (!alvos?.length) return json({ ok: true, nada_a_fazer: true, preenchidos: 0 });

    let preenchidos = 0;
    let semPortal = 0;
    const erros: string[] = [];

    for (let i = 0; i < alvos.length; i++) {
      const t = alvos[i];
      if (i > 0) await new Promise((r) => setTimeout(r, PAUSA_MS));

      try {
        if (!t.origem_conta_id) continue;
        const { data: chave } = await service.rpc('obter_chave_omie_por_conta', {
          p_integration_id: t.origem_conta_id,
        });
        if (!chave) continue;

        const resp = await fetch(DOCTOROMIE_DOCS, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
          body: JSON.stringify({ codigo_lancamento_omie: Number(t.origem_id) }),
          signal: AbortSignal.timeout(25000),
        });
        const corpo = await resp.json().catch(() => ({}));

        // Título sem OS ou sem documento também é resposta: grava `{}` para não
        // voltar a ser candidato em toda rodada. Sem isso o preenchedor ficaria
        // preso nos mesmos títulos para sempre.
        const documentos = (!resp.ok || corpo?.ok === false) ? {} : (corpo?.documentos ?? {});
        if (!documentos?.portal) semPortal += 1;

        await service
          .from('fin_titulos')
          .update({
            documentos,
            documentos_em: new Date().toISOString(),
            link_nfse: documentos?.pdf_nfse ?? null,
            atualizado_em: new Date().toISOString(),
          })
          .eq('id', t.id);

        preenchidos += 1;
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        console.warn(LOG, 'falhou em', t.origem_id, msg);
        erros.push(`${t.origem_id}: ${msg.slice(0, 60)}`);
      }
    }

    return json({ ok: true, preenchidos, sem_portal: semPortal, erros });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    console.error(LOG, 'ERRO_GERAL:', msg);
    return json({ ok: false, error: msg }, 500);
  }
});
