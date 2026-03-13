
-- Update attendance 00058/26 AI fields (scoped to this attendance only)
UPDATE support_attendances SET
  ai_summary = 'Atendimento aberto acidentalmente por mensagem do fluxo de encerramento do 00057/26',
  ai_problem = 'Mensagem automática do fluxo CSAT/encerramento do atendimento anterior gerou abertura indevida de novo atendimento.',
  ai_solution = 'Nenhuma ação necessária. Cooldown de 30s implementado para evitar recorrência.',
  ai_tags = ARRAY['sistema', 'cooldown', 'csat'],
  updated_at = now()
WHERE id = 'ed0f6398-c02d-4cfe-8467-f0da4b5c8405';

-- Update KB article for 00058/26 with scoped data
UPDATE support_kb_articles SET
  title = 'Atendimento acidental por mensagem de encerramento',
  problem = 'Mensagem automática do fluxo CSAT/encerramento do atendimento anterior gerou abertura indevida de novo atendimento.',
  solution = 'Nenhuma ação necessária. Cooldown de 30s implementado para evitar recorrência.',
  tags = ARRAY['sistema', 'cooldown', 'csat'],
  updated_at = now()
WHERE source_attendance_id = 'ed0f6398-c02d-4cfe-8467-f0da4b5c8405';
