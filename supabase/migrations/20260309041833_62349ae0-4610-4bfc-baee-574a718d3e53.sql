
-- Normalize telefone_whatsapp: add 55 prefix to Brazilian numbers without it
UPDATE clientes
SET telefone_whatsapp = '55' || regexp_replace(telefone_whatsapp, '\D', '', 'g')
WHERE telefone_whatsapp IS NOT NULL
  AND length(regexp_replace(telefone_whatsapp, '\D', '', 'g')) BETWEEN 10 AND 11
  AND regexp_replace(telefone_whatsapp, '\D', '', 'g') NOT LIKE '55%';

-- Normalize telefone_contato: add 55 prefix to Brazilian numbers without it
UPDATE clientes
SET telefone_contato = '55' || regexp_replace(telefone_contato, '\D', '', 'g')
WHERE telefone_contato IS NOT NULL
  AND length(regexp_replace(telefone_contato, '\D', '', 'g')) BETWEEN 10 AND 11
  AND regexp_replace(telefone_contato, '\D', '', 'g') NOT LIKE '55%';

-- Normalize cliente_contatos.fone
UPDATE cliente_contatos
SET fone = '55' || regexp_replace(fone, '\D', '', 'g')
WHERE fone IS NOT NULL
  AND length(regexp_replace(fone, '\D', '', 'g')) BETWEEN 10 AND 11
  AND regexp_replace(fone, '\D', '', 'g') NOT LIKE '55%';
