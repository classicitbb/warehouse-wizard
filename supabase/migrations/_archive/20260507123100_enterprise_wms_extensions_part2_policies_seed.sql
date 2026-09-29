-- Enterprise WMS extension, part 2:
-- RLS enablement, policies, and default report/label definitions.
-- Run after 20260507123000_enterprise_wms_extensions_part1_schema.sql.

alter table public.integration_connections enable row level security;
alter table public.external_record_links enable row level security;
alter table public.integration_sync_jobs enable row level security;
alter table public.integration_payload_logs enable row level security;
alter table public.integration_dead_letters enable row level security;
alter table public.report_definitions enable row level security;
alter table public.report_exports enable row level security;
alter table public.printer_stations enable row level security;
alter table public.label_templates enable row level security;
alter table public.print_jobs enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.quality_inspections enable row level security;
alter table public.return_authorizations enable row level security;
alter table public.dock_appointments enable row level security;
alter table public.staging_loads enable row level security;
alter table public.replenishment_tasks enable row level security;
alter table public.work_templates enable row level security;

do $$
declare
  enterprise_table text;
begin
  foreach enterprise_table in array array[
    'integration_connections',
    'external_record_links',
    'integration_sync_jobs',
    'integration_payload_logs',
    'integration_dead_letters',
    'report_definitions',
    'report_exports',
    'printer_stations',
    'label_templates',
    'print_jobs',
    'ai_recommendations',
    'quality_inspections',
    'return_authorizations',
    'dock_appointments',
    'staging_loads',
    'replenishment_tasks',
    'work_templates'
  ]
  loop
    execute format('drop policy if exists "Approved users read %I" on public.%I', enterprise_table, enterprise_table);
    execute format('create policy "Approved users read %I" on public.%I for select to authenticated using (public.is_approved())', enterprise_table, enterprise_table);
    execute format('drop policy if exists "Managers manage %I" on public.%I', enterprise_table, enterprise_table);
    execute format(
      'create policy "Managers manage %I" on public.%I for all to authenticated using (public.has_any_role(array[''admin''::public.app_role_code, ''warehouse_manager''::public.app_role_code])) with check (public.has_any_role(array[''admin''::public.app_role_code, ''warehouse_manager''::public.app_role_code]))',
      enterprise_table,
      enterprise_table
    );
  end loop;
end $$;

insert into public.report_definitions (code, name, audience, filters, columns)
values
  ('expiration-risk', 'Expiration Risk', array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code], '{"days": 30}'::jsonb, '["sku", "lot", "expiry_date", "available_quantity", "warehouse", "location"]'::jsonb),
  ('low-stock', 'Low Stock Warnings', array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code, 'inventory_clerk'::public.app_role_code], '{"threshold": 10}'::jsonb, '["sku", "available_quantity", "warehouse", "location", "netsuite_status"]'::jsonb),
  ('six-sigma-variance', 'Six Sigma Variance', array['admin'::public.app_role_code, 'warehouse_manager'::public.app_role_code], '{}'::jsonb, '["count_number", "sku", "variance_quantity", "variance_percent", "root_cause_code"]'::jsonb)
on conflict (code) do nothing;

insert into public.label_templates (code, label_type, printer_language, template_body)
values
  ('zpl-pallet-default', 'pallet', 'zpl', '^XA^CI28^PW609^LL406^FO28,24^GB553,358,3^FS^FO40,44^A0N,36,36^FD{{title}}^FS^FO40,134^BY2,3,88^BCN,88,Y,N,N^FD{{code}}^FS^XZ'),
  ('zpl-location-default', 'location', 'zpl', '^XA^CI28^PW609^LL300^FO32,32^A0N,42,42^FD{{location_code}}^FS^FO32,100^BY2,3,100^BCN,100,Y,N,N^FD{{location_code}}^FS^XZ')
on conflict (code) do nothing;
