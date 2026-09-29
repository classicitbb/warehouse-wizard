DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.delete_email(text, bigint)',
    'public.enqueue_email(text, jsonb)',
    'public.move_to_dlq(text, text, bigint, jsonb)',
    'public.read_email_batch(text, integer, integer)',
    'public.get_deployment_licence()',
    'public.email_queue_dispatch()',
    'public.claim_integration_sync_jobs(uuid, integer)',
    'public.reclaim_stale_integration_sync_jobs()',
    'public.purge_expired_system_log_archive()',
    'public.refresh_reorder_alerts()',
    'public.evaluate_reorder_alert(uuid, uuid)',
    'public.get_or_create_unsubscribe_token(text)',
    'public.admin_invite_user(text, text, text, text, uuid)',
    'public.enforce_developer_role_unassigner()',
    'public.preserve_user_role_assigned_by()',
    'public.set_user_role_assigned_by()',
    'public.compute_cycle_count_line_variance()',
    'public.refresh_reorder_alert_from_balance()',
    'public.refresh_reorder_alert_from_product()',
    'public.refresh_reorder_alert_from_settings()',
    'public._delete_guard_check()',
    'public.email_queue_wake()',
    'public.handle_new_user()',
    'public.auto_approve_on_developer_role()',
    'public.enforce_developer_approved()',
    'public.prevent_developer_profile_delete()',
    'public.prevent_self_approval()',
    'public.prevent_self_disable()',
    'public.enqueue_netsuite_inventory_sync()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;