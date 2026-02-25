
-- Atualiza plano do tenant ASP para 'internal'
UPDATE public.tenants
SET plano = 'internal'
WHERE id = 'a0000000-0000-0000-0000-000000000001' AND nome = 'ASP';

-- Garante profile super_admin atualizado
INSERT INTO public.profiles(user_id, tenant_id, role, is_super_admin, status)
VALUES (
  '7743d108-318d-4baf-8ccd-eb4fefef320f',
  'a0000000-0000-0000-0000-000000000001',
  'admin',
  true,
  'ativo'
)
ON CONFLICT (user_id) DO UPDATE
  SET tenant_id = excluded.tenant_id,
      role = excluded.role,
      is_super_admin = excluded.is_super_admin,
      status = excluded.status;
