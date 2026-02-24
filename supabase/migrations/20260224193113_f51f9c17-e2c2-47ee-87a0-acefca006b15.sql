
-- Enums
CREATE TYPE cs_ticket_tipo AS ENUM (
  'relacionamento_90d','risco_churn','adocao_engajamento',
  'indicacao','oportunidade','clube_comunidade','interno_processo'
);
CREATE TYPE cs_ticket_status AS ENUM (
  'aberto','em_andamento','aguardando_cliente','aguardando_interno',
  'em_monitoramento','concluido','cancelado'
);
CREATE TYPE cs_ticket_prioridade AS ENUM ('baixa','media','alta','urgente');
CREATE TYPE cs_ticket_impacto AS ENUM ('risco','expansao','relacionamento','processo');
CREATE TYPE cs_indicacao_status AS ENUM (
  'recebida','contatada','qualificada','enviada_ao_comercial','fechou','nao_fechou'
);
CREATE TYPE cs_update_tipo AS ENUM (
  'comentario','mudanca_status','mudanca_prioridade','mudanca_owner','nota_ia','registro_acao'
);

-- cs_tickets
CREATE TABLE cs_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES clientes(id) ON DELETE SET NULL,
  tipo cs_ticket_tipo NOT NULL,
  assunto text NOT NULL,
  descricao_curta text NOT NULL DEFAULT '',
  prioridade cs_ticket_prioridade NOT NULL DEFAULT 'media',
  status cs_ticket_status NOT NULL DEFAULT 'aberto',
  escalado boolean NOT NULL DEFAULT false,
  owner_id bigint REFERENCES funcionarios(id),
  criado_por_id bigint REFERENCES funcionarios(id),
  proxima_acao text DEFAULT '',
  proximo_followup_em date,
  impacto_categoria cs_ticket_impacto DEFAULT 'relacionamento',
  mrr_em_risco numeric DEFAULT 0,
  mrr_recuperado numeric DEFAULT 0,
  prob_churn_percent numeric,
  prob_sucesso_percent numeric,
  sla_primeira_acao_ate timestamptz,
  sla_conclusao_ate timestamptz,
  primeira_acao_em timestamptz,
  concluido_em timestamptz,
  indicacao_nome text,
  indicacao_contato text,
  indicacao_cidade text,
  indicacao_status cs_indicacao_status,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cs_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_cs_tickets" ON cs_tickets FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_cs_tickets" ON cs_tickets FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- cs_ticket_updates
CREATE TABLE cs_ticket_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  tipo cs_update_tipo NOT NULL DEFAULT 'comentario',
  conteudo text NOT NULL DEFAULT '',
  privado boolean NOT NULL DEFAULT true,
  criado_por_id bigint REFERENCES funcionarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cs_ticket_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_cs_ticket_updates" ON cs_ticket_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_cs_ticket_updates" ON cs_ticket_updates FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- cs_ticket_reassignments
CREATE TABLE cs_ticket_reassignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES cs_tickets(id) ON DELETE CASCADE,
  de_id bigint REFERENCES funcionarios(id),
  para_id bigint NOT NULL REFERENCES funcionarios(id),
  motivo text,
  reatribuido_por_id bigint REFERENCES funcionarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cs_ticket_reassignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_cs_reassignments" ON cs_ticket_reassignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_write_cs_reassignments" ON cs_ticket_reassignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Trigger updated_at
CREATE TRIGGER set_cs_tickets_updated_at
  BEFORE UPDATE ON cs_tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
