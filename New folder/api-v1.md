# Warehouse Wizard API v1

This document defines the first shippable API surface for Warehouse Wizard Enterprise WMS. The current app remains Supabase-backed; production deployments can expose these routes through Supabase Edge Functions or a small server layer.

## Authentication

- All routes require an authenticated user or integration token.
- Human users are authorized through Supabase RLS and app roles.
- ERP integrations use idempotency keys and write to `integration_sync_jobs`, `integration_payload_logs`, and `integration_dead_letters`.

## Core Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/v1/inventory` | `GET` | Search live inventory by SKU, pallet, status, lot, expiry, warehouse, or location. |
| `/api/v1/inventory/adjustments` | `POST` | Create audited stock adjustments and optional NetSuite inventory adjustment jobs. |
| `/api/v1/receipts` | `POST` | Create receipt, lot, pallet, label, inventory balance, and putaway task. |
| `/api/v1/picks/waves` | `POST` | Release outbound wave/cluster work from available FEFO/FIFO stock. |
| `/api/v1/picks/:id/confirm` | `POST` | Confirm scan-based pick execution with short/exception reason support. |
| `/api/v1/transfers` | `POST` | Create inter-warehouse or intra-warehouse transfer work. |
| `/api/v1/labels/zpl` | `POST` | Generate Zebra ZPL payloads for pallet, location, carton, count sheet, pick list, or transfer labels. |
| `/api/v1/reports/:code/export` | `POST` | Queue saved report exports and return CSV output metadata. |
| `/api/v1/alerts` | `GET` | Return Warehouse Brain recommendations and operational alerts for the current role. |
| `/api/v1/webhooks/netsuite` | `POST` | Receive NetSuite item, PO, transfer, sales order, fulfillment, and inventory callbacks. |

## NetSuite Adapter Defaults

The first adapter maps:

- NetSuite item to `products` and `product_packaging_profiles`.
- Purchase order receipt to WMS receiving.
- Sales order or transfer order to WMS order, pick list, and pick tasks.
- Cycle count variance or status change to NetSuite inventory adjustment.
- Fulfillment confirmation to NetSuite item fulfillment.

Each sync request must include or derive:

- `connection_id`
- `idempotency_key`
- `external_record_type`
- `external_id`
- `payload`
- `local_table` and `local_id` after successful mapping

## Example Label Request

```json
{
  "labelType": "pallet",
  "code": "PLT-12345678",
  "title": "Pallet Label",
  "subtitle": "Cold Chain Foods",
  "quantity": 48
}
```

The response body contains `zpl`, `labelTemplateCode`, and the queued `printJobId` when a printer station is supplied.

## Webhook Behavior

- Validate signature before parsing payload.
- Create an `integration_sync_jobs` row before mutating WMS data.
- Use `external_record_links` for upsert matching.
- Store raw inbound/outbound payloads in `integration_payload_logs`.
- Move repeatedly failing jobs to `integration_dead_letters` with a human-readable reason.
