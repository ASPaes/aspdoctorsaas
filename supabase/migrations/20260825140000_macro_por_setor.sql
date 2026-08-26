-- Macro por setor.
--
-- Regra: `department_ids` NULL ou vazio = a macro aparece para todos os setores,
-- que é exatamente o comportamento de hoje. Toda macro já cadastrada fica NULL e
-- nada muda para ninguém. A partir do momento em que um setor é marcado, só quem
-- é daquele setor enxerga a macro no chat.
--
-- Sem FK: o Postgres não suporta foreign key em elemento de array. Setor apagado
-- deixa um id órfão dentro do array; a tela ignora id que não existe mais.
-- Sem índice: o filtro é feito no cliente (são dezenas de macros por tenant),
-- então um GIN aqui só custaria escrita.

alter table public.whatsapp_macros
  add column if not exists department_ids uuid[];

comment on column public.whatsapp_macros.department_ids is
  'Setores (support_departments.id) que enxergam a macro no chat. NULL ou vazio = todos os setores.';
