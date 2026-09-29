-- Remove demo receiving drafts that were used for early UI testing.
-- Real draft pallets are preserved.
delete from public.receipts
where status in ('draft', 'queued')
  and (
    notes::text like '%"_seeded_draft"%'
    or notes::text like '%Seeded receiving draft%'
  );
