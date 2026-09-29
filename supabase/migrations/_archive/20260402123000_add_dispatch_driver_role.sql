alter type public.app_role_code add value if not exists 'dispatch_driver';

insert into public.roles (code, name, description)
values (
  'dispatch_driver',
  'Dispatch Driver',
  'Confirms transfer dispatches and receives stock between facilities'
)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    updated_at = timezone('utc', now());
