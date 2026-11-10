-- Ativa a comparação anual apenas para gestores ativos com setores vinculados.
-- As frequências já configuradas de cada cadastro continuam sendo usadas.
update public.audit_email_recipients
set annual_enabled = true, updated_at = now()
where active and scope = 'management' and not annual_enabled
  and (cardinality(sectors) > 0 or nullif(btrim(sector), '') is not null);
