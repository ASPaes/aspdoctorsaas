
-- Função genérica para setar tenant_id no insert
create or replace function public.set_tenant_id_on_insert()
returns trigger
language plpgsql
as $$
begin
  if public.is_super_admin() then
    if new.tenant_id is null then
      new.tenant_id := public.current_tenant_id();
    end if;
  else
    new.tenant_id := public.current_tenant_id();
  end if;
  return new;
end;
$$;

-- Transacionais
drop trigger if exists trg_set_tenant_clientes on public.clientes;
create trigger trg_set_tenant_clientes before insert on public.clientes for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_cs_tickets on public.cs_tickets;
create trigger trg_set_tenant_cs_tickets before insert on public.cs_tickets for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_movimentos_mrr on public.movimentos_mrr;
create trigger trg_set_tenant_movimentos_mrr before insert on public.movimentos_mrr for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_cert_a1 on public.certificado_a1_vendas;
create trigger trg_set_tenant_cert_a1 before insert on public.certificado_a1_vendas for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_cliente_contatos on public.cliente_contatos;
create trigger trg_set_tenant_cliente_contatos before insert on public.cliente_contatos for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_cs_ticket_updates on public.cs_ticket_updates;
create trigger trg_set_tenant_cs_ticket_updates before insert on public.cs_ticket_updates for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_cs_reassignments on public.cs_ticket_reassignments;
create trigger trg_set_tenant_cs_reassignments before insert on public.cs_ticket_reassignments for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_configuracoes on public.configuracoes;
create trigger trg_set_tenant_configuracoes before insert on public.configuracoes for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_funcionarios on public.funcionarios;
create trigger trg_set_tenant_funcionarios before insert on public.funcionarios for each row execute function public.set_tenant_id_on_insert();

-- Catálogos
drop trigger if exists trg_set_tenant_segmentos on public.segmentos;
create trigger trg_set_tenant_segmentos before insert on public.segmentos for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_areas on public.areas_atuacao;
create trigger trg_set_tenant_areas before insert on public.areas_atuacao for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_modelos on public.modelos_contrato;
create trigger trg_set_tenant_modelos before insert on public.modelos_contrato for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_fornecedores on public.fornecedores;
create trigger trg_set_tenant_fornecedores before insert on public.fornecedores for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_produtos on public.produtos;
create trigger trg_set_tenant_produtos before insert on public.produtos for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_formas on public.formas_pagamento;
create trigger trg_set_tenant_formas before insert on public.formas_pagamento for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_motivos on public.motivos_cancelamento;
create trigger trg_set_tenant_motivos before insert on public.motivos_cancelamento for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_origens on public.origens_venda;
create trigger trg_set_tenant_origens before insert on public.origens_venda for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists trg_set_tenant_unidades on public.unidades_base;
create trigger trg_set_tenant_unidades before insert on public.unidades_base for each row execute function public.set_tenant_id_on_insert();
