import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

/**
 * Faxina do anexo de e-mail que ficou para trás (16/09/2026).
 *
 * A pessoa anexa um arquivo na tela de enviar e-mail, ele sobe na hora, e às
 * vezes o e-mail nunca é enviado: fecha a janela, desiste, troca de assunto.
 * Quando o envio acontece, a própria send-email apaga o arquivo; quando não
 * acontece, ninguém apaga. Esta function varre o que sobrou.
 *
 * SÓ MEXE EM `<tenant>/emails/`, e é por isso que ela pode apagar sem consultar
 * o banco: nessa pasta só existe anexo de e-mail, que tem vida curta por
 * desenho. Mídia de mensagem e anexo de nota interna moram em `<tenant>/<conversa>/`
 * no mesmo bucket e NÃO são tocados aqui — foi o mesmo motivo que fez a
 * purge-chat-media nunca varrer o bucket (ela vai pela linha da mensagem).
 *
 * Só apaga o que já passou de IDADE_MINIMA_HORAS. Isso protege dois casos:
 * o arquivo que acabou de subir e ainda está na tela aberta, e o envio que
 * falhou e deixa o arquivo de propósito para a pessoa tentar de novo.
 *
 * Anexo de e-mail do chat anterior a 16/09/2026 caiu na pasta da conversa e
 * fica onde está: de lá não dá para distinguir de mídia de mensagem.
 *
 * Chamada pelo cron 1x por dia, de madrugada. verify_jwt=true, como a
 * purge-chat-media: o portão é o JWT do projeto.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUCKET = 'whatsapp-media';
/** arquivo mais novo que isso pode estar em uso numa tela aberta */
const IDADE_MINIMA_HORAS = 24;
/** a listagem do Storage devolve no máximo 100 por página com folga de memória */
const POR_PAGINA = 100;
/** teto por tenant, para uma pasta grande não segurar a execução inteira */
const MAX_PAGINAS = 50;
/** o remove() aceita lista; 200 mantém o payload pequeno */
const LOTE_REMOVER = 200;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface PorTenant {
  tenant_id: string;
  apagados: number;
  bytes: number;
  erro?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* o cron manda {} ou nada */ }

  // dry_run lista o que SERIA apagado sem tocar no Storage
  const dryRun = body.dry_run === true;
  const horas = Math.max(Number(body.horas) || IDADE_MINIMA_HORAS, 1);
  const corte = new Date(Date.now() - horas * 3600_000);
  const soTenant = typeof body.tenant_id === 'string' ? body.tenant_id : null;

  const { data: tenants, error: erroTenants } = await supabase
    .from('tenants')
    .select('id')
    .order('id');

  if (erroTenants) return json(500, { ok: false, error: `Não foi possível listar os tenants: ${erroTenants.message}` });

  // Anexo de e-mail AGENDADO (16/09/2026) fica no Storage até o envio, que
  // pode ser daqui a meses. Sem conseguir ler essa lista, nada é apagado: pior
  // do que sobrar arquivo é o e-mail agendado sair sem o anexo.
  const { data: agendados, error: erroAgendados } = await supabase
    .from('email_agendados')
    .select('anexos')
    .in('status', ['agendado', 'enviando']);
  // tabela ainda não criada (function publicada antes da migration): não há agendado
  if (erroAgendados && erroAgendados.code !== '42P01' && !/does not exist|could not find the table/i.test(erroAgendados.message)) {
    return json(500, { ok: false, error: `Não foi possível ler os e-mails agendados: ${erroAgendados.message}` });
  }
  const protegidos = new Set<string>(
    (agendados ?? []).flatMap((a: { anexos: unknown }) =>
      Array.isArray(a.anexos) ? a.anexos.map((x: any) => String(x?.path ?? '')).filter(Boolean) : [],
    ),
  );

  const alvos = (tenants ?? []).map((t: { id: string }) => t.id).filter((id) => !soTenant || id === soTenant);
  const resultado: PorTenant[] = [];
  const amostra: string[] = [];
  let apagados = 0;
  let bytes = 0;

  for (const tenantId of alvos) {
    const linha: PorTenant = { tenant_id: tenantId, apagados: 0, bytes: 0 };
    const pasta = `${tenantId}/emails`;
    const velhos: { path: string; tamanho: number }[] = [];

    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const { data: itens, error } = await supabase.storage
        .from(BUCKET)
        .list(pasta, { limit: POR_PAGINA, offset: pagina * POR_PAGINA, sortBy: { column: 'name', order: 'asc' } });

      if (error) {
        linha.erro = error.message;
        break;
      }
      if (!itens || itens.length === 0) break;

      for (const item of itens) {
        // pasta dentro de pasta não deveria existir aqui; se existir, ignore
        if (!item.name || !item.id) continue;
        const quando = item.created_at ? new Date(item.created_at) : null;
        if (!quando || quando >= corte) continue;
        if (protegidos.has(`${pasta}/${item.name}`)) continue;
        velhos.push({ path: `${pasta}/${item.name}`, tamanho: Number((item.metadata as any)?.size ?? 0) });
      }

      if (itens.length < POR_PAGINA) break;
    }

    for (let i = 0; i < velhos.length; i += LOTE_REMOVER) {
      const lote = velhos.slice(i, i + LOTE_REMOVER);
      if (!dryRun) {
        const { error } = await supabase.storage.from(BUCKET).remove(lote.map((v) => v.path));
        if (error) {
          linha.erro = error.message;
          break;
        }
      }
      linha.apagados += lote.length;
      linha.bytes += lote.reduce((soma, v) => soma + v.tamanho, 0);
      if (amostra.length < 20) amostra.push(...lote.slice(0, 20 - amostra.length).map((v) => v.path));
    }

    apagados += linha.apagados;
    bytes += linha.bytes;
    if (linha.apagados > 0 || linha.erro) resultado.push(linha);
  }

  const resumo = { ok: true, dry_run: dryRun, corte: corte.toISOString(), apagados, bytes, tenants: resultado, amostra };
  console.log(`[purge-email-anexos] ${dryRun ? 'simulacao' : 'apagou'} ${apagados} arquivo(s), ${bytes} bytes`);
  return json(200, resumo);
});
