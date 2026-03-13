INSERT INTO public.support_kb_articles (
  tenant_id, source_attendance_id, title, summary, problem, solution, tags, status
) VALUES (
  'a0000000-0000-0000-0000-000000000001',
  '09c14d99-a3f5-401c-8af6-e2e9db825087',
  'Solicitação de boleto - Cliente KS',
  'Cliente Sabrina entrou em contato solicitando o boleto da empresa KS. Após seleção da URA para o setor Financeiro, o atendente solicitou o CNPJ para localizar o cliente. Houve dificuldade inicial na busca pelo CNPJ, mas o atendente localizou manualmente. O boleto foi enviado via documento e o cliente confirmou o recebimento.',
  'Cliente solicita envio do boleto de pagamento da empresa KS.',
  'Solicitar o CNPJ ou razão social para localizar o cadastro do cliente no sistema. Após identificar, gerar e enviar o boleto diretamente pelo chat como documento anexo. Confirmar o recebimento com o cliente antes de encerrar.',
  ARRAY['financeiro', 'boleto', 'cobrança'],
  'draft'
);