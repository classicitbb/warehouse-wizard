insert into storage.buckets (id, name, public)
values ('email-assets', 'email-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read email-assets" on storage.objects;
create policy "Public read email-assets"
on storage.objects for select
to public
using (bucket_id = 'email-assets');