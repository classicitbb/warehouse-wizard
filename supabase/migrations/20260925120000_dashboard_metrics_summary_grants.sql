-- dashboard_metrics_summary: re-assert who may call it.
--
-- The function has been recreated several times (supabase 20260909211107,
-- drizzle 0006) and its grants revoked and re-granted in between (drizzle
-- 0008, 0011, 0012). Whatever order those reached the live database in, the
-- end state is: signed-in users and the service role may execute it; anon and
-- PUBLIC may not. Requests made after a failed token refresh arrive as anon
-- and are meant to be refused. The client no longer sends them (see
-- src/features/dashboard/dashboard-core.ts).

revoke execute on function public.dashboard_metrics_summary(uuid) from public;
revoke execute on function public.dashboard_metrics_summary(uuid) from anon;
grant execute on function public.dashboard_metrics_summary(uuid) to authenticated, service_role;
