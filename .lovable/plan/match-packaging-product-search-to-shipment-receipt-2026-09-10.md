# Match Packaging product search to Shipment Receipt

## Change

- Replace the generic Product select in **New Packaging Profile** with the same shared product search used in Shipment Receipt.
- Match the receipt workflow: search by SKU or product name, scan an exact barcode, show the same searchable scrolling results, and keep keyboard selection/focus behavior consistent.
- Load the complete active product catalogue through the existing narrow, paged product feed so the list is not limited by the 1,000-row database response cap.
- Keep the packaging-specific Saved / Not created indicator in each result without changing the receipt search elsewhere.
- Use the selected product to preserve the existing pack-code defaults and profile form behavior.

## Verified current state

- Shipment Receipt uses the shared `ProductSearch` control with barcode scanning and selection handoff.
- The Pallet Pak Designer already uses that shared control.
- New Packaging Profile still renders `product_id` through the generic select field, so its appearance and behavior differ from Shipment Receipt.

## Validation

- Test typing by SKU and name, exact barcode scanning, keyboard selection, long-list scrolling, and product selection inside the dialog.
- Confirm all active products can be found beyond the first 1,000 records.
- Confirm Saved / Not created status remains visible and pack-code auto-fill still works.
- Run the focused form tests and project typecheck, then verify the dialog in desktop and mobile widths.
