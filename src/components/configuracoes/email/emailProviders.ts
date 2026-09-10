/**
 * Presets de provedor da aba Configurações > Atendimento > E-mail.
 *
 * `value` precisa bater com o CHECK de `email_accounts.provider`
 * (migration 20260910120000_email_accounts.sql).
 *
 * Os servidores são o padrão publicado por cada provedor. Servem para o usuário
 * não precisar caçar host e porta; todos continuam editáveis na tela, porque
 * revenda e hospedagem compartilhada mudam esses valores com frequência.
 */

export type EmailSecurity = "ssl" | "starttls" | "none";

export interface EmailProviderPreset {
  value: string;
  label: string;
  initial: string;
  /** cor do selo, no espírito da marca do provedor */
  color: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecurity?: EmailSecurity;
  imapHost?: string;
  imapPort?: number;
  imapSecurity?: EmailSecurity;
  /** aviso mostrado no bloco de senha */
  aviso?: string;
}

export const EMAIL_PROVIDERS: EmailProviderPreset[] = [
  {
    value: "gmail",
    label: "Gmail",
    initial: "G",
    color: "#D93025",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecurity: "ssl",
    aviso:
      "Conta Google com verificação em duas etapas não aceita a senha normal. Gere uma senha de aplicativo em myaccount.google.com e use ela aqui.",
  },
  {
    value: "outlook",
    label: "Outlook",
    initial: "M",
    color: "#0F6CBD",
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecurity: "ssl",
    aviso:
      "Vale para Outlook.com, Hotmail e Microsoft 365. Em conta corporativa, o administrador precisa manter o SMTP autenticado liberado.",
  },
  {
    value: "yahoo",
    label: "Yahoo",
    initial: "Y",
    color: "#6001D2",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecurity: "ssl",
    aviso: "O Yahoo exige senha de aplicativo, gerada nas configurações de segurança da conta.",
  },
  {
    value: "zoho",
    label: "Zoho",
    initial: "Z",
    color: "#E42527",
    smtpHost: "smtp.zoho.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.zoho.com",
    imapPort: 993,
    imapSecurity: "ssl",
  },
  {
    value: "locaweb",
    label: "Locaweb",
    initial: "L",
    color: "#00A4E4",
    smtpHost: "email-ssl.com.br",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.email-ssl.com.br",
    imapPort: 993,
    imapSecurity: "ssl",
  },
  {
    value: "hostinger",
    label: "Hostinger",
    initial: "H",
    color: "#673DE6",
    smtpHost: "smtp.hostinger.com",
    smtpPort: 465,
    smtpSecurity: "ssl",
    imapHost: "imap.hostinger.com",
    imapPort: 993,
    imapSecurity: "ssl",
  },
  {
    value: "uolhost",
    label: "UOL Host",
    initial: "U",
    color: "#0284C7",
    smtpHost: "smtp.uhserver.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    imapHost: "imap.uhserver.com",
    imapPort: 993,
    imapSecurity: "ssl",
  },
  {
    value: "custom",
    label: "Próprio",
    initial: "P",
    color: "#475569",
  },
];

export const providerByValue = (value?: string | null): EmailProviderPreset =>
  EMAIL_PROVIDERS.find((p) => p.value === value) ??
  EMAIL_PROVIDERS[EMAIL_PROVIDERS.length - 1];

export const SECURITY_LABELS: Record<EmailSecurity, string> = {
  ssl: "SSL/TLS",
  starttls: "STARTTLS",
  none: "Sem criptografia",
};
