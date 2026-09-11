import type { EmailAccount } from "./useEmailAccounts";
import type { EmailProviderPreset } from "./emailProviders";

/**
 * Diagnóstico da última falha de teste de uma conta de e-mail.
 *
 * Lê o `last_test_error` que a edge function `test-email-account` grava: a frase
 * traduzida, seguida do texto cru do servidor entre colchetes, no formato
 * `[SMTP: … | IMAP: …]`. É o texto cru que decide a categoria, porque ele não
 * muda quando alguém reescreve a frase.
 *
 * Os padrões espelham `mensagemAmigavel` em
 * supabase/functions/test-email-account/smtp.ts. Mudou um, mude o outro.
 */

export type CategoriaFalha =
  | "sem_senha"
  | "microsoft_bloqueio"
  | "senha_app"
  | "senha"
  | "timeout"
  | "seguranca"
  | "dns"
  | "porta_fechada"
  | "sem_auth"
  | "certificado"
  | "desconhecida";

export interface Diagnostico {
  categoria: CategoriaFalha;
  titulo: string;
  explicacao: string;
  /** o problema está nos servidores, não na senha */
  deServidor: boolean;
  /** o que falhou: envio, recebimento ou os dois */
  lado: "envio" | "recebimento" | "ambos";
}

const ORIENTACAO: Record<CategoriaFalha, Omit<Diagnostico, "categoria" | "lado">> = {
  sem_senha: {
    titulo: "A senha não foi encontrada",
    explicacao: "Esta conta ficou sem senha guardada. Edite a conta, digite a senha de novo e teste.",
    deServidor: false,
  },
  microsoft_bloqueio: {
    titulo: "A Microsoft bloqueou o acesso por senha",
    explicacao:
      "O servidor aceitou a conexão, mas a Microsoft não deixa esta conta entrar com senha. Em conta de empresa o administrador precisa liberar o SMTP autenticado. Conta pessoal do Outlook ou do Hotmail não funciona mais por senha.",
    deServidor: false,
  },
  senha_app: {
    titulo: "Esta conta exige senha de aplicativo",
    explicacao:
      "A conta tem verificação em duas etapas, e nesse caso o provedor recusa a senha normal. Gere uma senha de aplicativo e use no lugar dela.",
    deServidor: false,
  },
  senha: {
    titulo: "O provedor recusou o usuário ou a senha",
    explicacao:
      "Os servidores estão certos e responderam, mas não aceitaram o login. Na maioria dos casos é porque o provedor exige senha de aplicativo ou porque a senha foi digitada errada.",
    deServidor: false,
  },
  timeout: {
    titulo: "O servidor não respondeu",
    explicacao:
      "A conexão foi aberta e ficou sem resposta. Normalmente é a porta errada para esse servidor ou um bloqueio do provedor.",
    deServidor: true,
  },
  seguranca: {
    titulo: "A porta e o tipo de segurança não combinam",
    explicacao: "O servidor respondeu num formato diferente do esperado. Porta 465 costuma ser SSL/TLS e 587, STARTTLS.",
    deServidor: true,
  },
  dns: {
    titulo: "O endereço do servidor não existe",
    explicacao: "O nome do servidor não foi encontrado na internet. Confira se está completo e sem erro de digitação.",
    deServidor: true,
  },
  porta_fechada: {
    titulo: "A porta está fechada nesse servidor",
    explicacao: "O servidor existe, mas recusou a conexão nessa porta. Confira o número da porta com o provedor.",
    deServidor: true,
  },
  sem_auth: {
    titulo: "O servidor não aceitou o método de login",
    explicacao:
      "O servidor respondeu, mas não oferece login por senha nessa porta. Em conta corporativa, o administrador precisa liberar o envio autenticado.",
    deServidor: true,
  },
  certificado: {
    titulo: "O certificado do servidor não foi aceito",
    explicacao: "O nome do servidor precisa ser o mesmo que aparece no certificado dele. Confira o nome com o provedor.",
    deServidor: true,
  },
  desconhecida: {
    titulo: "O teste falhou",
    explicacao: "O servidor devolveu uma resposta que não reconhecemos. Confira os dados com o provedor e teste de novo.",
    deServidor: false,
  },
};

export function classificarFalha(erro: string): CategoriaFalha {
  const e = erro.toLowerCase();
  if (/não está no cofre/.test(e)) return "sem_senha";
  if (/5\.7\.139|basic authentication is disabled|smtpclientauthentication is disabled/.test(e)) return "microsoft_bloqueio";
  if (/5\.7\.9|application-specific password required/.test(e)) return "senha_app";
  if (/535|5\.7\.8|5\.7\.3|authentication failed|authenticationfailed|invalid credentials|username and password not accepted|login failed|a1 no/.test(e)) return "senha";
  if (/timeout|timed out/.test(e)) return "timeout";
  if (/wrong version number|record layer|corrupt message|invaliddata|bad record mac|unexpected message|handshake/.test(e)) return "seguranca";
  if (/dns error|failed to lookup|name not resolved|nxdomain/.test(e)) return "dns";
  if (/connection refused|connectionrefused/.test(e)) return "porta_fechada";
  if (/530|authentication required|não anunciou autenticação/.test(e)) return "sem_auth";
  if (/certificate|self.signed|unknownissuer/.test(e)) return "certificado";
  return "desconhecida";
}

export function diagnosticar(erro: string | null): Diagnostico | null {
  if (!erro) return null;
  const tecnico = erro.includes(" [") ? erro.slice(erro.indexOf(" [")) : erro;
  const falhouEnvio = /SMTP:/.test(tecnico);
  const falhouRecebimento = /IMAP:/.test(tecnico);
  const lado = falhouEnvio && falhouRecebimento ? "ambos" : falhouRecebimento ? "recebimento" : "envio";
  const categoria = classificarFalha(tecnico);
  return { categoria, lado, ...ORIENTACAO[categoria] };
}

/** servidores do preset, só quando diferem dos que a conta está usando */
export function servidoresRecomendados(conta: EmailAccount, preset: EmailProviderPreset) {
  if (!preset.smtpHost) return null;
  const imapHost = preset.semRecebimento ? null : preset.imapHost ?? null;
  const imapPort = preset.semRecebimento ? null : preset.imapPort ?? null;
  const imapSecurity = preset.semRecebimento ? null : preset.imapSecurity ?? null;

  const igual =
    conta.smtp_host === preset.smtpHost &&
    conta.smtp_port === preset.smtpPort &&
    conta.smtp_security === preset.smtpSecurity &&
    (conta.imap_host ?? null) === imapHost &&
    (conta.imap_port ?? null) === imapPort &&
    (conta.imap_security ?? null) === imapSecurity;
  if (igual) return null;

  return {
    smtp_host: preset.smtpHost,
    smtp_port: preset.smtpPort ?? 465,
    smtp_security: preset.smtpSecurity ?? "ssl",
    imap_host: imapHost,
    imap_port: imapPort,
    imap_security: imapSecurity,
  };
}
