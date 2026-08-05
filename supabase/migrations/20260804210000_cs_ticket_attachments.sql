-- Anexos no ticket de Customer Success.
--
-- Espelha public.support_ticket_attachments, mas em tabela própria: o ticket de CS vive em
-- cs_tickets e a tabela de suporte tem FK para support_tickets. Mesmo bucket ('ticket-attachments'),
-- com o segmento "cs" no caminho para separar os arquivos: <tenant>/cs/<ticket>/<ts>_<arquivo>.
-- O tenant continua sendo a PRIMEIRA pasta, então a policy de INSERT do bucket (baseada em pasta)
-- vale sem alteração.

CREATE TABLE IF NOT EXISTS public.cs_ticket_attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id),
  ticket_id   uuid NOT NULL REFERENCES public.cs_tickets(id) ON DELETE CASCADE,
  file_name   text NOT NULL,
  file_path   text NOT NULL,
  file_size   bigint,
  file_type   text,
  uploaded_by uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cs_ticket_attachments_ticket ON public.cs_ticket_attachments(ticket_id);
-- A policy de storage casa por file_path; sem este índice ela varre a tabela a cada objeto lido.
CREATE INDEX IF NOT EXISTS idx_cs_ticket_attachments_path ON public.cs_ticket_attachments(file_path);

ALTER TABLE public.cs_ticket_attachments ENABLE ROW LEVEL SECURITY;

-- Mesmo desenho da policy das outras tabelas cs_* (cs_tickets, cs_ticket_updates).
DROP POLICY IF EXISTS cs_ticket_attachments_tenant_rw ON public.cs_ticket_attachments;
CREATE POLICY cs_ticket_attachments_tenant_rw ON public.cs_ticket_attachments FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- Sem trigger set_tenant_id_on_insert de propósito: o insert vem da edge function com service_role,
-- onde auth.uid() é nulo — o trigger sobrescreveria o tenant correto por NULL.

-- Leitura do arquivo no Storage.
--
-- Policy NOVA em vez de reescrever as três existentes: policies permissivas se somam por OR, então
-- esta libera o caso CS sem encostar em ticket_attachments_select_tenant_isolated (que está em
-- produção e pode ter mudado fora do repo).
-- INSERT/UPDATE/DELETE do objeto não precisam de policy: passam pela edge function com service_role.
DROP POLICY IF EXISTS cs_ticket_attachments_read ON storage.objects;
CREATE POLICY cs_ticket_attachments_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ticket-attachments'
    AND EXISTS (
      SELECT 1 FROM public.cs_ticket_attachments a
      WHERE a.file_path = storage.objects.name
        AND (a.tenant_id = public.current_tenant_id() OR public.is_super_admin())
    )
  );
