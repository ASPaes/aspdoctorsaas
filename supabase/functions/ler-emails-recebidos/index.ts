import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import {
  ClienteImap, acharToken, cortarCitacao, decodificarCabecalho, ehAutomatico,
  extrairEndereco, extrairTexto, lerCabecalhos, type SegurancaImap,
} from './imap.ts';

/**
 * Lê as caixas ligadas e registra a resposta do cliente em `email_recebidos`.
 *
 * O que entra:
 *   1. mensagem que traz a identificação de um envio nosso, no endereço com
 *      sufixo ou no `[#TOKEN]` do assunto;
 *   2. se a caixa permitir, e-mail novo de quem está na ficha de um cliente.
 * O resto é ignorado, e o corpo dele nem é baixado.
 *
 * A caixa é aberta com EXAMINE (nada vira lido) e a leitura anda por marca
 * d'água de UID. A PRIMEIRA leitura de uma caixa só planta a marca no presente:
 * resposta que chegou antes de ligar o robô não entra, de propósito, para não
 * despejar meses de caixa de uma vez.
 *
 * Chamada pelo cron a cada poucos minutos, ou pela tela (admin) para ler agora.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** por rodada e por caixa; segura o custo quando alguém liga uma caixa cheia */
const MAX_POR_CAIXA = 40;
const MAX_CORPO = 20_000;

interface Resultado {
  conta: string;
  lidas: number;
  registradas: number;
  ignoradas: number;
  erro?: string;
}

function papelDoToken(token: string, chaveServico: string): string | null {
  if (token === chaveServico) return 'service_role';
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='))).role ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Não autorizado: falta o token.' });
  const token = authHeader.replace('Bearer ', '');

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // o cron manda o segredo do cofre, não um JWT (mesmo desenho do cron do
  // espelho do OEM); chamada de outra function continua valendo pelo papel
  const { data: segredoCron } = await supabase.rpc('obter_segredo_leitor_emails');
  const interno =
    (typeof segredoCron === 'string' && segredoCron.length > 0 && token === segredoCron) ||
    papelDoToken(token, serviceKey) === 'service_role';
  let tenantDoUsuario: string | null = null;

  if (!interno) {
    // leitura sob demanda pela tela: só admin, e só das caixas do tenant dele
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser(token);
    if (!user) return json(401, { error: 'Não autorizado: token inválido.' });
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role, is_super_admin')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!profile || (!profile.is_super_admin && profile.role !== 'admin')) {
      return json(403, { error: 'Apenas administradores podem mandar ler a caixa.' });
    }
    tenantDoUsuario = profile.is_super_admin ? null : profile.tenant_id;
  }

  const body = await req.json().catch(() => ({}));
  const contaPedida = typeof body?.account_id === 'string' ? body.account_id : null;
  // super admin não tem tenant próprio: lê o tenant que a tela está mostrando,
  // senão um clique em "Ler agora" abriria a caixa de todos os clientes
  const tenantPedido = typeof body?.tenant_id === 'string' ? body.tenant_id : null;
  const tenantFiltro = tenantDoUsuario ?? (interno ? null : tenantPedido);

  let consulta = supabase
    .from('email_accounts')
    .select('id, tenant_id, email, imap_host, imap_port, imap_security, imap_username, aceitar_cliente_cadastrado, descartar_automaticos')
    .eq('receber_respostas', true)
    .eq('ativo', true)
    .not('imap_host', 'is', null);
  if (contaPedida) consulta = consulta.eq('id', contaPedida);
  if (tenantFiltro) consulta = consulta.eq('tenant_id', tenantFiltro);

  const { data: contas, error: erroContas } = await consulta;
  if (erroContas) return json(500, { error: erroContas.message });
  if (!contas?.length) return json(200, { ok: true, caixas: 0, mensagem: 'Nenhuma caixa com leitura ligada.' });

  const resultados: Resultado[] = [];

  for (const conta of contas) {
    const resultado: Resultado = { conta: conta.email, lidas: 0, registradas: 0, ignoradas: 0 };
    let imap: ClienteImap | null = null;

    try {
      const { data: senha } = await supabase.rpc('get_email_account_secret', { p_account_id: conta.id });
      if (!senha) throw new Error('A senha desta conta não está no cofre.');

      imap = new ClienteImap(conta.imap_host!, conta.imap_port ?? 993, (conta.imap_security ?? 'ssl') as SegurancaImap);
      await imap.conectar(conta.imap_username || conta.email, senha as string);
      const caixa = await imap.examinar('INBOX');

      const { data: estado } = await supabase
        .from('email_ingestao_estado')
        .select('uid_validity, ultimo_uid')
        .eq('account_id', conta.id)
        .maybeSingle();

      // primeira leitura, ou a caixa foi recriada: planta a marca no presente
      if (!estado || Number(estado.uid_validity) !== caixa.uidValidity) {
        await supabase.from('email_ingestao_estado').upsert({
          account_id: conta.id,
          tenant_id: conta.tenant_id,
          uid_validity: caixa.uidValidity,
          ultimo_uid: Math.max(0, caixa.uidNext - 1),
          ultima_leitura: new Date().toISOString(),
          ultimo_erro: null,
          updated_at: new Date().toISOString(),
        });
        resultados.push({ ...resultado, erro: undefined, ignoradas: 0 });
        await imap.encerrar();
        continue;
      }

      const cabecalhos = await imap.cabecalhosDesde(Number(estado.ultimo_uid), MAX_POR_CAIXA);
      resultado.lidas = cabecalhos.length;
      let maiorUid = Number(estado.ultimo_uid);

      for (const { uid, cabecalho } of cabecalhos) {
        maiorUid = Math.max(maiorUid, uid);
        const cab = lerCabecalhos(cabecalho);

        if (conta.descartar_automaticos && ehAutomatico(cab)) {
          resultado.ignoradas++;
          continue;
        }

        const de = extrairEndereco(cab['from'] ?? '');
        if (!de.email) {
          resultado.ignoradas++;
          continue;
        }

        const identificacao = acharToken(cab);
        let envio: any = null;
        let clienteId: string | null = null;
        let status = 'avulso';

        if (identificacao) {
          const { data } = await supabase
            .from('email_envios')
            .select('id, tenant_id, cliente_id, referencia_id, origem, para')
            .eq('reply_token', identificacao)
            .maybeSingle();
          if (data && data.tenant_id === conta.tenant_id) envio = data;
        }

        if (envio) {
          clienteId = envio.cliente_id;
          // o endereço da resposta precisa bater com o que recebeu o e-mail;
          // senão fica marcado e não entra no histórico sem alguém confirmar
          const destinatariosOriginais = (envio.para ?? []).map((p: string) => p.toLowerCase());
          let confere = destinatariosOriginais.includes(de.email);
          if (!confere && clienteId) {
            const { data: cliente } = await supabase
              .from('clientes')
              .select('email')
              .eq('id', clienteId)
              .maybeSingle();
            confere = (cliente?.email ?? '').toLowerCase() === de.email;
          }
          status = confere ? 'vinculado' : 'remetente_diferente';
        } else if (conta.aceitar_cliente_cadastrado) {
          const { data: cliente } = await supabase
            .from('clientes')
            .select('id')
            .eq('tenant_id', conta.tenant_id)
            .ilike('email', de.email)
            .maybeSingle();
          if (!cliente) {
            resultado.ignoradas++;
            continue;
          }
          clienteId = cliente.id;
          status = 'avulso';
        } else {
          // sem identificação e sem permissão para e-mail novo: nem baixa o corpo
          resultado.ignoradas++;
          continue;
        }

        const bruto = await imap.mensagem(uid);
        const texto = cortarCitacao(extrairTexto(bruto)).slice(0, MAX_CORPO);
        const assunto = decodificarCabecalho(cab['subject'] ?? '').replace(/\s*\[#[A-HJ-NP-Z2-9]{10}\]\s*$/i, '');
        const recebidoEm = cab['date'] ? new Date(cab['date']) : new Date();

        const { error: erroInsert } = await supabase.from('email_recebidos').insert({
          tenant_id: conta.tenant_id,
          account_id: conta.id,
          envio_id: envio?.id ?? null,
          cliente_id: clienteId,
          referencia_id: envio?.referencia_id ?? null,
          origem: envio?.origem ?? null,
          message_id: cab['message-id'] ?? null,
          imap_uid: uid,
          de_email: de.email,
          de_nome: de.nome || null,
          para: (cab['to'] ?? '').split(',').map((p) => extrairEndereco(p).email).filter(Boolean),
          assunto,
          corpo_texto: texto,
          recebido_em: isNaN(recebidoEm.getTime()) ? new Date().toISOString() : recebidoEm.toISOString(),
          status,
        });

        // mesma mensagem duas vezes (índice de Message-ID) não é erro
        if (erroInsert && !`${erroInsert.message}`.includes('duplicate key')) throw erroInsert;
        if (!erroInsert) resultado.registradas++;
      }

      await supabase.from('email_ingestao_estado').upsert({
        account_id: conta.id,
        tenant_id: conta.tenant_id,
        uid_validity: caixa.uidValidity,
        ultimo_uid: maiorUid,
        ultima_leitura: new Date().toISOString(),
        ultimo_erro: null,
        mensagens_lidas: resultado.registradas,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resultado.erro = msg;
      console.error(`[ler-emails-recebidos] ${conta.email}: ${msg}`);
      await supabase.from('email_ingestao_estado').upsert({
        account_id: conta.id,
        tenant_id: conta.tenant_id,
        ultima_leitura: new Date().toISOString(),
        ultimo_erro: msg.slice(0, 500),
        updated_at: new Date().toISOString(),
      });
    } finally {
      await imap?.encerrar();
      resultados.push(resultado);
    }
  }

  return json(200, { ok: true, caixas: resultados.length, resultados });
});
