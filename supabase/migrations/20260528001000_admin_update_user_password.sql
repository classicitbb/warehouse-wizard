create or replace function public.admin_update_user_password(
  in_user_id uuid,
  in_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can update user passwords';
  end if;

  if in_password is null or length(in_password) < 4 then
    raise exception 'Password or PIN is too short';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(in_password, extensions.gen_salt('bf'::text)),
      updated_at = timezone('utc', now()),
      recovery_token = '',
      recovery_sent_at = null
  where id = in_user_id;

  if not found then
    raise exception 'User not found';
  end if;
end;
$$;

grant execute on function public.admin_update_user_password(uuid, text) to authenticated;
