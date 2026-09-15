/**
 * Regras puras do robô para e-mail novo: para qual endereço o cliente escreveu,
 * se a mensagem saiu de uma caixa nossa e o texto do aviso de abertura.
 *
 * O destino é o endereço, não a caixa: vários endereços podem cair na mesma
 * caixa (financeiro@ chegando no login do suporte@). O cabeçalho To guarda o
 * endereço que o cliente digitou; o Delivered-To costuma trazer o endereço
 * principal da caixa depois do redirecionamento. Por isso To e Cc vêm antes.
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** `suporte+K7M2Q9XP4D@empresa.com.br` -> `suporte@empresa.com.br`, tudo minúsculo */
export function semSufixo(email: string): string {
  const [local, dominio] = email.trim().toLowerCase().split('@');
  if (!dominio) return email.trim().toLowerCase();
  return `${local.split('+')[0]}@${dominio}`;
}

/** todos os endereços de um cabeçalho, sem sufixo e sem repetição */
export function enderecosDe(valor: string | undefined): string[] {
  return [...new Set((valor ?? '').match(EMAIL)?.map(semSufixo) ?? [])];
}

/**
 * Primeiro endereço conhecido (cadastrado em Parâmetros de Recebidos) entre os
 * destinatários; sem nenhum conhecido, o endereço da própria caixa.
 */
export function resolverEnderecoDestino(
  cab: Record<string, string>,
  conhecidos: Set<string>,
  enderecoDaCaixa: string,
): string {
  return resolverDestino(cab, conhecidos, enderecoDaCaixa).endereco;
}

/**
 * Igual a resolverEnderecoDestino, dizendo também se o endereço só está em
 * cópia: achado no Cc sem estar no To. Endereço que não aceita cópia
 * (Parâmetros de Recebidos) não abre ticket nesse caso. Cópia oculta e
 * redirecionamento (só no Delivered-To) contam como enviado direto.
 */
export function resolverDestino(
  cab: Record<string, string>,
  conhecidos: Set<string>,
  enderecoDaCaixa: string,
): { endereco: string; soEmCopia: boolean } {
  for (const campo of ['to', 'cc', 'x-original-to', 'delivered-to']) {
    for (const e of enderecosDe(cab[campo])) {
      if (conhecidos.has(e)) return { endereco: e, soEmCopia: campo === 'cc' };
    }
  }
  const daCaixa = semSufixo(enderecoDaCaixa);
  const estaSoEmCopia = enderecosDe(cab['cc']).includes(daCaixa) && !enderecosDe(cab['to']).includes(daCaixa);
  return { endereco: daCaixa, soEmCopia: estaSoEmCopia };
}

/** mensagem que saiu de uma caixa do próprio tenant nunca abre ticket (evita robô falando sozinho) */
export function ehDeUmaDasNossasCaixas(remetente: string, nossos: Set<string>): boolean {
  return nossos.has(semSufixo(remetente));
}

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** primeiro nome para a saudação; vazio quando o "nome" é na verdade um endereço */
export function primeiroNome(nome: string | null | undefined): string {
  const limpo = (nome ?? '').replace(/["']/g, '').trim();
  if (!limpo || limpo.includes('@')) return '';
  const primeiro = limpo.split(/\s+/)[0];
  if (!/^[\p{L}][\p{L}'-]*$/u.test(primeiro)) return '';
  // JOÃO -> João; nome já escrito certo fica como está
  return primeiro === primeiro.toUpperCase()
    ? primeiro.charAt(0) + primeiro.slice(1).toLowerCase()
    : primeiro;
}

export function assuntoConfirmacao(codigo: string): string {
  return `Recebemos seu chamado ${codigo}`;
}

/** corpo do aviso de abertura; a assinatura da conta entra sozinha na send-email */
export function htmlConfirmacao(p: {
  nome?: string | null;
  assunto?: string | null;
  codigo: string;
  setor?: string | null;
}): string {
  const nome = primeiroNome(p.nome);
  const assunto = (p.assunto ?? '').trim();
  return [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1E293B">',
    `<p style="margin:0 0 10px">${nome ? `Olá, ${escapar(nome)}!` : 'Olá!'}</p>`,
    `<p style="margin:0 0 10px">Recebemos sua mensagem${
      assunto ? ` sobre <strong>“${escapar(assunto)}”</strong>` : ''
    } e abrimos o chamado <strong>${escapar(p.codigo)}</strong>${p.setor ? ` no setor ${escapar(p.setor)}` : ''}.</p>`,
    '<p style="margin:0 0 10px">Para mandar mais detalhes ou prints, é só responder este e-mail: tudo entra no mesmo chamado.</p>',
    '</div>',
  ].join('');
}
