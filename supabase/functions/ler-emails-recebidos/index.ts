import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import {
  ClienteImap, acharToken, cortarCitacao, decodificarCabecalho, ehAutomatico,
  extrairEndereco, extrairTexto, lerCabecalhos, type SegurancaImap,
} from './imap.ts';
import {
  assuntoConfirmacao, ehDeUmaDasNossasCaixas, htmlConfirmacao, resolverEnderecoDestino, semSufixo,
} from './rotas.ts';
import { caminhoDoAnexo, extrairAnexos, selecionarAnexos, type AnexoEmail } from './anexos.ts';

/**
 * Lê as caixas e registra em `email_recebidos` o que interessa:
 *   1. resposta a um e-mail que saiu do DoctorSaaS (identificação no endereço
 *      com sufixo ou no `[#TOKEN]` do assunto);
 *   2. e-mail novo para um endereço que abre ticket (Parâmetros de Recebidos);
 *   3. se a caixa permitir, e-mail novo de quem está na ficha de um cliente.
 * O resto é ignorado, e o corpo dele nem é baixado.
 *
 * Desde 13/09/2026 o robô GUARDA primeiro e PROCESSA depois: a linha nasce em
 * `acao = 'pendente'` e `fn_email_processar_recebido` decide ticket, resposta,
 * reabertura, jornada ou triagem. Se o processamento falhar, a linha fica em
 * 'erro' e é tentada de novo nas próximas leituras; nunca abre dois tickets.
 *
 * A caixa é aberta com EXAMINE (nada vira lido) e a leitura anda por marca
 * d'água de UID. A PRIMEIRA leitura de uma caixa só planta a marca no presente.
 * Duas leituras da mesma caixa nunca rodam juntas (fn_email_ingestao_reservar),
 * e 3 falhas seguidas avisam os admins (fn_email_ingestao_resultado).
 *
 * Chamada pelo cron (todo minuto no comercial, de 5 em 5 fora) ou pela tela
 * (admin) para ler agora.
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
/** reserva maior que qualquer leitura normal; se a função morrer, a caixa se solta sozinha */
const RESERVA_SEGUNDOS = 240;
const MAX_TENTATIVAS = 5;
const LOTE = 50;
/** no máximo 1 aviso de abertura por remetente nesse intervalo: dois robôs não conversam */
const AVISO_A_CADA_MIN = 15;
/** o mesmo bucket dos anexos que a equipe sobe no ticket; a tela abre de lá */
const BUCKET_ANEXOS = 'ticket-attachments';

interface Resultado {
  conta: string;
  lidas: number;
  registradas: number;
  ignoradas: number;
  ocupada?: boolean;
  erro?: string;
}

interface Rota {
  tenant_id: string;
  account_id: string;
  endereco: string;
  abre_ticket: boolean;
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

function conjuntoDo(mapa: Map<string, Set<string>>, chave: string): Set<string> {
  let s = mapa.get(chave);
  if (!s) {
    s = new Set();
    mapa.set(chave, s);
  }
  return s;
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

  // ── endereços cadastrados em Parâmetros de Recebidos ──
  let consultaRotas = supabase.from('email_enderecos_destino').select('tenant_id, account_id, endereco, abre_ticket');
  if (tenantFiltro) consultaRotas = consultaRotas.eq('tenant_id', tenantFiltro);
  const { data: rotasLidas, error: erroRotas } = await consultaRotas;
  if (erroRotas) console.warn(`[ler-emails-recebidos] endereços não lidos: ${erroRotas.message}`);
  const rotas = (rotasLidas ?? []) as Rota[];
  const contasQueAbremTicket = new Set(rotas.filter((r) => r.abre_ticket).map((r) => r.account_id));

  let consulta = supabase
    .from('email_accounts')
    .select('id, tenant_id, email, imap_host, imap_port, imap_security, imap_username, receber_respostas, aceitar_cliente_cadastrado, descartar_automaticos')
    .eq('ativo', true)
    .not('imap_host', 'is', null);
  if (contaPedida) consulta = consulta.eq('id', contaPedida);
  if (tenantFiltro) consulta = consulta.eq('tenant_id', tenantFiltro);

  const { data: ativas, error: erroContas } = await consulta;
  if (erroContas) return json(500, { error: erroContas.message });
  // caixa com endereço que abre ticket é lida mesmo sem "registrar respostas"
  const contas = (ativas ?? []).filter((c) => c.receber_respostas || contasQueAbremTicket.has(c.id));
  if (!contas.length) return json(200, { ok: true, caixas: 0, mensagem: 'Nenhuma caixa com leitura ligada.' });

  // endereços de cada tenant: para achar o destino e para nunca abrir ticket de e-mail nosso
  const tenants = [...new Set(contas.map((c) => c.tenant_id as string))];
  const { data: enderecosDasContas } = await supabase.from('email_accounts').select('tenant_id, email').in('tenant_id', tenants);
  const nossos = new Map<string, Set<string>>();
  const conhecidos = new Map<string, Set<string>>();
  const abrem = new Map<string, Set<string>>();
  for (const c of enderecosDasContas ?? []) conjuntoDo(nossos, c.tenant_id).add(semSufixo(c.email));
  for (const r of rotas) {
    conjuntoDo(nossos, r.tenant_id).add(r.endereco);
    conjuntoDo(conhecidos, r.tenant_id).add(r.endereco);
    if (r.abre_ticket) conjuntoDo(abrem, r.tenant_id).add(r.endereco);
  }

  const resultados: Resultado[] = [];
  const paraProcessar: string[] = [];

  for (const conta of contas) {
    const resultado: Resultado = { conta: conta.email, lidas: 0, registradas: 0, ignoradas: 0 };
    const caixaAbreTicket = contasQueAbremTicket.has(conta.id);

    const { data: reservou, error: erroReserva } = await supabase.rpc('fn_email_ingestao_reservar', {
      p_account_id: conta.id,
      p_tenant_id: conta.tenant_id,
      p_segundos: RESERVA_SEGUNDOS,
    });
    if (erroReserva) {
      console.warn(`[ler-emails-recebidos] reserva indisponível para ${conta.email}: ${erroReserva.message}`);
    } else if (reservou === false) {
      // outra leitura ainda está com esta caixa; ela registra o que chegar
      resultados.push({ ...resultado, ocupada: true });
      continue;
    }

    let imap: ClienteImap | null = null;
    let erroDaLeitura: string | null = null;

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
      if (!estado || estado.uid_validity === null || Number(estado.uid_validity) !== caixa.uidValidity) {
        await supabase.from('email_ingestao_estado').upsert({
          account_id: conta.id,
          tenant_id: conta.tenant_id,
          uid_validity: caixa.uidValidity,
          ultimo_uid: Math.max(0, caixa.uidNext - 1),
          ultima_leitura: new Date().toISOString(),
          ultimo_erro: null,
          leitura_ate: null,
          updated_at: new Date().toISOString(),
        });
        console.log(`[ler-emails-recebidos] ${conta.email}: primeira leitura, marca plantada em ${Math.max(0, caixa.uidNext - 1)}`);
        continue; // o finally encerra a conexão, libera a caixa e registra o resultado
      }

      const cabecalhos = await imap.cabecalhosDesde(Number(estado.ultimo_uid), MAX_POR_CAIXA);
      resultado.lidas = cabecalhos.length;
      let maiorUid = Number(estado.ultimo_uid);

      for (const { uid, cabecalho } of cabecalhos) {
        maiorUid = Math.max(maiorUid, uid);
        const cab = lerCabecalhos(cabecalho);

        // boletim e resposta automática: sempre fora em caixa que abre ticket
        if ((conta.descartar_automaticos || caixaAbreTicket) && ehAutomatico(cab)) {
          resultado.ignoradas++;
          continue;
        }

        const de = extrairEndereco(cab['from'] ?? '');
        if (!de.email || ehDeUmaDasNossasCaixas(de.email, nossos.get(conta.tenant_id) ?? new Set())) {
          resultado.ignoradas++;
          continue;
        }

        const destino = resolverEnderecoDestino(cab, conhecidos.get(conta.tenant_id) ?? new Set(), conta.email);
        const abreTicket = abrem.get(conta.tenant_id)?.has(destino) ?? false;

        const identificacao = acharToken(cab);
        let envio: any = null;
        let clienteId: string | null = null;
        let status = 'avulso';
        let acao: 'pendente' | 'registrado';

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
          // senão fica marcado e não entra em ticket sem alguém confirmar
          const destinatariosOriginais = (envio.para ?? []).map((p: string) => p.toLowerCase());
          let confere = destinatariosOriginais.includes(de.email);
          if (!confere && clienteId) {
            const { data: cliente } = await supabase.from('clientes').select('email').eq('id', clienteId).maybeSingle();
            confere = (cliente?.email ?? '').toLowerCase().split(/[;,\s]+/).includes(de.email);
          }
          status = confere ? 'vinculado' : 'remetente_diferente';
          acao = 'pendente';
        } else if (abreTicket) {
          // quem é o cliente e para onde vai, decide o banco
          acao = 'pendente';
        } else if (conta.receber_respostas && conta.aceitar_cliente_cadastrado) {
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
          acao = 'registrado';
        } else {
          // sem identificação e sem endereço que abre ticket: nem baixa o corpo
          resultado.ignoradas++;
          continue;
        }

        const { texto: brutoTexto, binario } = await imap.mensagemCompleta(uid);
        const texto = cortarCitacao(extrairTexto(brutoTexto)).slice(0, MAX_CORPO);
        const assunto = decodificarCabecalho(cab['subject'] ?? '').replace(/\s*\[#[A-HJ-NP-Z2-9]{10}\]\s*$/i, '');
        const recebidoEm = cab['date'] ? new Date(cab['date']) : new Date();
        const agora = new Date().toISOString();
        // sem Message-ID a trava de repetição precisa de outra chave estável
        const messageId = cab['message-id'] || `<imap-${caixa.uidValidity}-${uid}@${conta.id}>`;

        // Anexos sobem ANTES de gravar o e-mail, num caminho fixo por mensagem:
        // se algo cair no meio, a próxima leitura regrava o mesmo arquivo.
        // Quando o e-mail é ligado a um ticket, o banco coloca os anexos nele.
        const { aceitos, ignorados } = selecionarAnexos(extrairAnexos(binario));
        const anexos = await guardarAnexos(supabase, conta.tenant_id, `${conta.id}|${messageId}`, aceitos, ignorados);

        const { data: novo, error: erroInsert } = await supabase
          .from('email_recebidos')
          .insert({
            tenant_id: conta.tenant_id,
            account_id: conta.id,
            envio_id: envio?.id ?? null,
            cliente_id: clienteId,
            referencia_id: envio?.referencia_id ?? null,
            origem: envio?.origem ?? null,
            message_id: messageId,
            imap_uid: uid,
            de_email: de.email,
            de_nome: de.nome || null,
            para: (cab['to'] ?? '').split(',').map((p) => extrairEndereco(p).email).filter(Boolean),
            assunto,
            corpo_texto: texto,
            recebido_em: isNaN(recebidoEm.getTime()) ? agora : recebidoEm.toISOString(),
            status,
            endereco_destino: destino,
            acao,
            processado_em: acao === 'registrado' ? agora : null,
            anexos,
            anexos_ignorados: ignorados,
          })
          .select('id')
          .maybeSingle();

        if (erroInsert) {
          // mesma mensagem já guardada numa leitura anterior: a fila cuida dela
          if (`${erroInsert.message}`.includes('duplicate key')) continue;
          throw erroInsert;
        }
        resultado.registradas++;
        if (acao === 'pendente' && novo?.id) paraProcessar.push(novo.id);
      }

      await supabase.from('email_ingestao_estado').upsert({
        account_id: conta.id,
        tenant_id: conta.tenant_id,
        uid_validity: caixa.uidValidity,
        ultimo_uid: maiorUid,
        ultima_leitura: new Date().toISOString(),
        ultimo_erro: null,
        leitura_ate: null,
        mensagens_lidas: resultado.registradas,
        updated_at: new Date().toISOString(),
      });
      console.log(
        `[ler-emails-recebidos] ${conta.email}: lidas=${resultado.lidas} registradas=${resultado.registradas} ` +
          `ignoradas=${resultado.ignoradas} uid ${estado.ultimo_uid}->${maiorUid} uidNext=${caixa.uidNext}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      erroDaLeitura = msg;
      resultado.erro = msg;
      console.error(`[ler-emails-recebidos] ${conta.email}: ${msg}`);
    } finally {
      await imap?.encerrar();
      resultados.push(resultado);
      // libera a caixa e conta falhas seguidas; na 3ª avisa os admins do tenant
      const { error: erroResultado } = await supabase.rpc('fn_email_ingestao_resultado', {
        p_account_id: conta.id,
        p_erro: erroDaLeitura,
      });
      if (erroResultado) {
        console.warn(`[ler-emails-recebidos] resultado de ${conta.email} não gravado: ${erroResultado.message}`);
        if (erroDaLeitura) {
          await supabase.from('email_ingestao_estado').upsert({
            account_id: conta.id,
            tenant_id: conta.tenant_id,
            ultima_leitura: new Date().toISOString(),
            ultimo_erro: erroDaLeitura.slice(0, 500),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  // ── depois de ler: processa o que chegou e o que ficou para trás ──
  const fila = await processarFila(supabase, tenants, paraProcessar);
  const avisos = await enviarAvisosPendentes(supabase, supabaseUrl, serviceKey, tenants);

  return json(200, {
    ok: true,
    caixas: resultados.length,
    resultados,
    processados: fila.processados,
    tickets_abertos: fila.ticketsAbertos,
    avisos_enviados: avisos,
  });
});

/** sobe os anexos aceitos; a falha de um arquivo vira ignorado com motivo e não derruba os outros */
async function guardarAnexos(
  supabase: SupabaseClient,
  tenantId: string,
  chaveDaMensagem: string,
  aceitos: AnexoEmail[],
  ignorados: string[],
): Promise<{ nome: string; mime: string; tamanho: number; caminho: string }[]> {
  const guardados: { nome: string; mime: string; tamanho: number; caminho: string }[] = [];
  for (const [i, anexo] of aceitos.entries()) {
    const caminho = await caminhoDoAnexo(tenantId, chaveDaMensagem, i, anexo.nome);
    const { error } = await supabase.storage
      .from(BUCKET_ANEXOS)
      .upload(caminho, anexo.bytes, { contentType: anexo.mime, upsert: true });
    if (error) {
      ignorados.push(`${anexo.nome} (não foi guardado: ${error.message})`);
      console.error(`[ler-emails-recebidos] anexo ${anexo.nome} não subiu: ${error.message}`);
      continue;
    }
    guardados.push({ nome: anexo.nome, mime: anexo.mime, tamanho: anexo.bytes.length, caminho });
  }
  return guardados;
}

/** processa as linhas novas e as pendentes/erro das últimas 48h, até 5 tentativas cada */
async function processarFila(supabase: SupabaseClient, tenants: string[], novos: string[]) {
  const desde = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: atrasados, error } = await supabase
    .from('email_recebidos')
    .select('id')
    .in('tenant_id', tenants)
    .in('acao', ['pendente', 'erro'])
    .lt('tentativas', MAX_TENTATIVAS)
    .gte('created_at', desde)
    .order('created_at', { ascending: true })
    .limit(LOTE);
  if (error) console.warn(`[ler-emails-recebidos] fila não lida: ${error.message}`);

  const ids = [...new Set([...novos, ...(atrasados ?? []).map((a: { id: string }) => a.id)])];
  let processados = 0;
  let ticketsAbertos = 0;

  for (const id of ids) {
    const { data, error: erroRpc } = await supabase.rpc('fn_email_processar_recebido', { p_recebido_id: id });
    if (erroRpc) {
      console.error(`[ler-emails-recebidos] processar ${id}: ${erroRpc.message}`);
      continue;
    }
    processados++;
    if (data?.acao === 'ticket_aberto' && !data?.repetido) ticketsAbertos++;
    if (data?.acao === 'erro') console.error(`[ler-emails-recebidos] ${id} ficou em erro: ${data.erro}`);
  }
  return { processados, ticketsAbertos };
}

/** aviso de abertura para ticket aberto por e-mail novo (inclui o aberto na triagem) */
async function enviarAvisosPendentes(
  supabase: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  tenants: string[],
): Promise<number> {
  const desde = new Date(Date.now() - 86_400_000).toISOString();
  const { data: pendentes, error } = await supabase
    .from('email_recebidos')
    .select('id')
    .in('tenant_id', tenants)
    .eq('acao', 'ticket_aberto')
    .is('envio_id', null)
    .is('confirmacao', null)
    .gte('processado_em', desde)
    .order('processado_em', { ascending: true })
    .limit(LOTE);
  if (error) {
    console.warn(`[ler-emails-recebidos] avisos não lidos: ${error.message}`);
    return 0;
  }

  let enviados = 0;
  for (const p of pendentes ?? []) {
    if ((await avisarAbertura(supabase, supabaseUrl, serviceKey, p.id)) === 'enviada') enviados++;
  }
  return enviados;
}

async function avisarAbertura(
  supabase: SupabaseClient,
  supabaseUrl: string,
  serviceKey: string,
  recebidoId: string,
): Promise<string> {
  // reserva o aviso: duas leituras simultâneas nunca mandam o mesmo e-mail
  const { data: r, error } = await supabase
    .from('email_recebidos')
    .update({ confirmacao: 'enviando' })
    .eq('id', recebidoId)
    .is('confirmacao', null)
    .eq('acao', 'ticket_aberto')
    .select('id, tenant_id, account_id, de_email, de_nome, assunto, ticket_id, cliente_id, department_id')
    .maybeSingle();
  if (error || !r) return 'ja_tratado';

  const marcar = (confirmacao: string, envioId: string | null = null) =>
    supabase.from('email_recebidos').update({ confirmacao, confirmacao_envio_id: envioId }).eq('id', r.id);

  const { data: parametros } = await supabase
    .from('email_recebidos_parametros')
    .select('confirmar_abertura')
    .eq('tenant_id', r.tenant_id)
    .maybeSingle();
  if (parametros?.confirmar_abertura === false) {
    await marcar('pulada');
    return 'desligada';
  }

  const desde = new Date(Date.now() - AVISO_A_CADA_MIN * 60_000).toISOString();
  const { count } = await supabase
    .from('email_envios')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', r.tenant_id)
    .eq('origem', 'ticket_email')
    .contains('para', [r.de_email])
    .gte('created_at', desde);
  if ((count ?? 0) > 0) {
    await marcar('pulada');
    return 'limite';
  }

  const { data: ticket } = await supabase
    .from('support_tickets')
    .select('ticket_code, department_id')
    .eq('id', r.ticket_id)
    .maybeSingle();
  if (!ticket?.ticket_code) {
    await marcar('falhou');
    return 'falhou';
  }

  let setor: string | null = null;
  if (ticket.department_id) {
    const { data: d } = await supabase.from('support_departments').select('name').eq('id', ticket.department_id).maybeSingle();
    setor = d?.name ?? null;
  }

  try {
    // pela send-email: sai pela mesma caixa, com a assinatura dela e com a
    // identificação que traz a resposta do cliente de volta para este ticket
    const resposta = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: r.tenant_id,
        account_id: r.account_id,
        to: r.de_email,
        subject: assuntoConfirmacao(ticket.ticket_code),
        html: htmlConfirmacao({ nome: r.de_nome, assunto: r.assunto, codigo: ticket.ticket_code, setor }),
        origem: 'ticket_email',
        referencia_id: r.ticket_id,
        cliente_id: r.cliente_id,
        department_id: r.department_id,
      }),
    });
    const saida = await resposta.json().catch(() => ({}));
    if (resposta.ok && saida?.ok === true) {
      await marcar('enviada', saida.envio_id ?? null);
      return 'enviada';
    }
    console.error(`[ler-emails-recebidos] aviso de ${ticket.ticket_code} não saiu: ${saida?.mensagem || saida?.error || resposta.status}`);
  } catch (e) {
    console.error(`[ler-emails-recebidos] aviso de ${ticket.ticket_code} não saiu: ${e instanceof Error ? e.message : e}`);
  }
  await marcar('falhou');
  return 'falhou';
}
