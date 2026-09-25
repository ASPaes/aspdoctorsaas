/**
 * DEM-0474: o título da aba diz em que tela a pessoa está, para achar o Chat no
 * meio de várias abas do DoctorSaaS sem clicar em cada uma.
 *
 * O nome da tela vem ANTES da marca. Com muitas abas o Chrome corta o título
 * pelo fim e sobra só o começo: "DoctorSaaS - Tickets" viraria "DoctorS" em
 * todas, que é exatamente o problema que a demanda quer resolver.
 */
export const MARCA = "DoctorSaaS";

// Os nomes seguem o menu lateral. Rota nova sem entrada aqui mostra só a marca.
const TELAS: Array<[RegExp, string]> = [
  [/^\/dashboard$/, "Dashboard"],
  [/^\/clientes\/novo$/, "Novo cliente"],
  [/^\/clientes\/[^/]+$/, "Cliente"],
  [/^\/clientes$/, "Clientes"],
  [/^\/certificados-a1$/, "Certificados A1"],
  [/^\/emails$/, "E-mails"],
  [/^\/financeiro$/, "Financeiro"],
  [/^\/configuracoes\/notificacoes$/, "Notificações"],
  [/^\/configuracoes$/, "Configurações"],
  [/^\/customer-success$/, "Customer Success"],
  [/^\/atendimento\/dashboard$/, "Dashboard de Atendimento"],
  [/^\/whatsapp\/contatos$/, "Contatos"],
  [/^\/whatsapp$/, "Chat"],
  [/^\/tickets$/, "Tickets"],
  [/^\/painel-uso$/, "Painel de Uso"],
  [/^\/admin\/limpeza-uras$/, "Limpeza de URAs"],
  [/^\/onboarding-implantacao\/dashboard$/, "Dashboard de Implantação"],
  [/^\/onboarding-implantacao\/config$/, "Configuração de Implantação"],
  [/^\/onboarding-implantacao$/, "Implantação"],
  [/^\/super\/tenants\/[^/]+$/, "Tenant"],
  [/^\/super\/tenants$/, "Tenants"],
  [/^\/super\/templates$/, "Templates"],
  [/^\/super\/monitor$/, "Monitor"],
  [/^\/login$/, "Entrar"],
  [/^\/signup$/, "Criar conta"],
  [/^\/forgot-password$/, "Esqueci a senha"],
  [/^\/reset-password$/, "Nova senha"],
];

export function tituloDaAba(pathname: string): string {
  const caminho = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const tela = TELAS.find(([padrao]) => padrao.test(caminho))?.[1];
  return tela ? `${tela} - ${MARCA}` : MARCA;
}
