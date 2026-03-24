-- Back-fill department_id for all conversations on the Financeiro instance without a department
UPDATE public.whatsapp_conversations
SET department_id = 'd050b4e2-d61c-45dd-a1af-e3df6a221ff4'
WHERE instance_id = '405c357f-025e-4f8a-907a-2e9bec00a1a7'
  AND department_id IS NULL;