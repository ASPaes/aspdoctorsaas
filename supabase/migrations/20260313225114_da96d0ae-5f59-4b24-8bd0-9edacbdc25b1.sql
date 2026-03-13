-- Update attendance 00056/26 with proper scoped AI fields
UPDATE support_attendances SET
  ai_summary = 'Dúvida sobre encerramento de caixa sem vendas no dia',
  ai_problem = 'Cliente tentou encerrar o caixa no fim do dia, mas a tela de encerramento não aparecia.',
  ai_solution = 'Orientado que, como não houve vendas no dia, não há movimentação pendente para encerrar. Não é necessário realizar encerramento neste caso.',
  ai_tags = ARRAY['caixa', 'encerramento', 'vendas', 'operacional'],
  updated_at = now()
WHERE id = 'ba838f27-aae4-43ec-ac96-0ece33dc9eac';

-- Update attendance 00057/26 (just CSAT response)
UPDATE support_attendances SET
  ai_summary = 'Avaliação CSAT do atendimento anterior (nota 5)',
  ai_problem = 'Atendimento gerado apenas para coleta da avaliação CSAT.',
  ai_solution = 'Cliente avaliou com nota 5. Nenhuma ação necessária.',
  ai_tags = ARRAY['csat', 'avaliação'],
  updated_at = now()
WHERE id = '6d6eba62-b71c-4adc-8167-7cb0884ca6b1';

-- Update KB article for 00056/26
UPDATE support_kb_articles SET
  title = 'Encerramento de caixa sem vendas no dia',
  problem = 'Cliente tentou encerrar o caixa no fim do dia, mas a tela de encerramento não aparecia.',
  solution = 'Orientado que, como não houve vendas no dia, não há movimentação pendente para encerrar. Não é necessário realizar encerramento neste caso.',
  tags = ARRAY['caixa', 'encerramento', 'vendas', 'operacional'],
  updated_at = now()
WHERE source_attendance_id = 'ba838f27-aae4-43ec-ac96-0ece33dc9eac';

-- Update KB article for 00057/26
UPDATE support_kb_articles SET
  title = 'Avaliação CSAT (nota 5)',
  problem = 'Atendimento gerado apenas para coleta da avaliação CSAT.',
  solution = 'Cliente avaliou com nota 5. Nenhuma ação necessária.',
  tags = ARRAY['csat', 'avaliação'],
  updated_at = now()
WHERE source_attendance_id = '6d6eba62-b71c-4adc-8167-7cb0884ca6b1';