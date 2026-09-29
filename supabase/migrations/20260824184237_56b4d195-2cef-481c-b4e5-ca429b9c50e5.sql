revoke all on function public.operator_ticket_touch() from public, anon, authenticated;
revoke all on function public.operator_ticket_log_status() from public, anon, authenticated;
grant execute on function public.operator_ticket_touch() to service_role;
grant execute on function public.operator_ticket_log_status() to service_role;