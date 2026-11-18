CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = _user_id
      AND ur.is_hidden = false
      AND r.code = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.has_min_role(_user_id uuid, _minimum_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH role_rank(code, rank_value) AS (
    VALUES ('warehouse_operator',10),('inventory_clerk',20),('warehouse_supervisor',30),
           ('warehouse_manager',40),('admin',50),('developer',60)
  ),
  minimum AS (SELECT rank_value FROM role_rank WHERE code = _minimum_role)
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    JOIN role_rank rr ON rr.code = r.code::text
    CROSS JOIN minimum
    WHERE ur.user_id = _user_id
      AND ur.is_hidden = false
      AND rr.rank_value >= minimum.rank_value
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_roles public.app_role_code[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid()
      AND ur.is_hidden = false
      AND r.code = ANY (SELECT unnest(_roles)::text)
  );
$$;