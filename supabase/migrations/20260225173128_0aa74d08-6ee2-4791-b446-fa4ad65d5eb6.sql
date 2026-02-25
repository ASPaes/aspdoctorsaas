
-- Tenant ASP (idempotente)
INSERT INTO public.tenants (id, nome, plano, status)
VALUES ('a0000000-0000-0000-0000-000000000001', 'ASP', 'enterprise', 'ativo')
ON CONFLICT (id) DO NOTHING;

-- Profile super_admin para asp@aspsoftwares.com.br
INSERT INTO public.profiles (user_id, tenant_id, role, is_super_admin, status)
VALUES (
  '7743d108-318d-4baf-8ccd-eb4fefef320f',
  'a0000000-0000-0000-0000-000000000001',
  'admin',
  true,
  'ativo'
)
ON CONFLICT (user_id) DO NOTHING;
