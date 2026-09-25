-- Vendedor que só vê a própria carteira na Visão 360° do cliente.
--
-- Decisão do Alexandre em 25/09/2026: a marca fica no cadastro do funcionário
-- (Configurações › Cadastros › Funcionários) e vale SÓ para a Visão 360°. Quem
-- está marcado só encontra e só abre os clientes em que aparece como vendedor
-- em algum produto (cliente_produtos.funcionario_id). A lista de Clientes, o
-- Chat e os Tickets não mudam.
--
-- É organização, não segurança: a lista de Clientes continua aberta para ele.
-- Por isso o filtro mora na tela e não no RLS de clientes.
--
-- NOT NULL DEFAULT false: ninguém muda de comportamento até alguém marcar.
alter table public.funcionarios
  add column if not exists so_propria_carteira boolean not null default false;

comment on column public.funcionarios.so_propria_carteira is
  'Visão 360°: true = só encontra/abre clientes em que é vendedor em algum produto.';
