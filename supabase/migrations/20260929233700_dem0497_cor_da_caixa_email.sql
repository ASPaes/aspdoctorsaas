-- DEM-0497: cor por caixa de e-mail.
-- Cada conta pode ter uma cor (hex) e escolher onde ela aparece na tela E-mails:
-- 'linha' pinta a linha inteira; 'email' pinta só a coluna do endereço.
-- Sem cor = a lista fica como sempre foi.
-- Gravado pelo mesmo UPDATE que já leva as chaves de leitura (useEmailAccounts),
-- fora da fn_email_account_save de propósito: a assinatura dela não muda.

alter table public.email_accounts
  add column if not exists cor text,
  add column if not exists cor_modo text not null default 'email';

alter table public.email_accounts
  drop constraint if exists email_accounts_cor_hex,
  add constraint email_accounts_cor_hex check (cor is null or cor ~ '^#[0-9a-fA-F]{6}$'),
  drop constraint if exists email_accounts_cor_modo,
  add constraint email_accounts_cor_modo check (cor_modo in ('linha', 'email'));
