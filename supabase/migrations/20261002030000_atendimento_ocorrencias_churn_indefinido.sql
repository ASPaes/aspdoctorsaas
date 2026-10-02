-- Pedido de cancelamento sem dizer de que ("gostaria de solicitar o
-- cancelamento") passa a avisar como "Possivel cancelamento" e a ficar
-- registrado como churn com alvo 'indefinido' (decisao do Alexandre, 02/10/2026).
alter table public.atendimento_ocorrencias
  drop constraint atendimento_ocorrencias_tipo_alvo_chk;
alter table public.atendimento_ocorrencias
  add constraint atendimento_ocorrencias_tipo_alvo_chk check (
    (tipo = 'churn' and alvo in ('contrato', 'indefinido')) or
    (tipo = 'irritacao' and alvo in ('atendimento', 'produto', 'externo'))
  );
