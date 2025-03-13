-- All procedures int the database
SELECT routine_name, routine_schema, specific_schema, routine_type
FROM information_schema.routines
WHERE 
--routine_schema = 'public'
--AND 
routine_type = 'PROCEDURE';

-- All parameters of of (one) all procedures
SELECT 
    --r.routine_name, 
    p.parameter_name, 
    p.parameter_mode, 
    p.data_type
FROM information_schema.routines r
LEFT JOIN information_schema.parameters p 
    ON r.specific_name = p.specific_name
WHERE 
--r.routine_schema = 'public'
--AND 
r.routine_type = 'PROCEDURE'
ORDER BY r.routine_name, p.ordinal_position;

-- The body of a procedure
SELECT 
    p.proname AS procedure_name,
    n.nspname AS schema_name,
    pg_get_functiondef(p.oid) AS procedure_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE 
--n.nspname = 'public'  -- Change this to your schema
--AND 
p.prokind = 'p';  -- 'p' means procedure