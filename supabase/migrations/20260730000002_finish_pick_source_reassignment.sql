-- The original SQL-editor run may have completed the function definition and
-- then been retried, where PostgreSQL correctly rejected a duplicate CREATE
-- FUNCTION. Finish the safe post-definition work without recreating it.
do $$
begin
  if to_regprocedure('public.confirm_pick_task(uuid,text,text,numeric,boolean,boolean)') is null then
    raise exception 'confirm_pick_task(uuid, text, text, numeric, boolean, boolean) is missing; apply the source-reassignment definition before this completion migration.';
  end if;
end $$;

revoke all on function public.preview_pick_source_override(uuid, text, text) from public, anon;
grant execute on function public.preview_pick_source_override(uuid, text, text) to authenticated;
revoke all on function public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean) from public, anon;
grant execute on function public.confirm_pick_task(uuid, text, text, numeric, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
