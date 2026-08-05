# Warehouse Wizard Demo Receiving Manifest

## Inbound Purchase Order

PO: PO-BIM-2026-0509  
Manifest: WW-MAN-2026-0509  
Receipt reference: PO-BIM-2026-0509  
Carrier: Seawell Logistics  
Container: CMAU-441208-7  
Seal: BGI-88421  
Destination: NEW - New Warehouse  
Scheduled arrival: May 9, 2026, 10:00 AM  
Receiving door: IN-02  
Clerk: Darnell Clarke  

## Receiving Lines

| Line | SKU group | Description | Expected pallets | Expected units | Handling |
| --- | --- | --- | ---: | ---: | --- |
| 1 | SKU-0001 to SKU-0008 | Ambient retail replenishment | 8 | 192 | Receive, label, directed putaway |
| 2 | SKU-0010 to SKU-0025 | Cool-chain food/pharma lots | 6 | 144 | QA temperature check, FEFO putaway |
| 3 | SKU-0030 to SKU-0040 | Customer replenishment stock | 5 | 120 | Receive to staging, then rack |
| 4 | Mixed demo pallets | Exception and count examples | 4 | 96 | Hold/quarantine/count workflow |

## Demo Flow

1. Open Receiving and use PO-BIM-2026-0509 as the inbound reference.
2. Confirm pallet labels such as PBC-00001 and the queued putaway tasks.
3. Complete one putaway into the suggested NEW location.
4. Review quality inspection QA records for cold-chain and held pallets.
5. Dispatch or receive a seeded transfer, then complete the destination putaway.
6. Open cycle counts and submit a variance line to show stock adjustment.

## Related Seeded Records

| Record type | Seeded examples |
| --- | --- |
| Purchase orders | PO-BIM-2026-0509, PO-CHILL-2026-0510 |
| Manifests | WW-MAN-2026-0509, WW-MAN-2026-0510 |
| Transfers | TRF-0001 to TRF-0004, TRF-INTRA-0509 |
| Dock appointments | APPT-IN-0509, APPT-OUT-0510, APPT-XFER-WLD |
| Work templates | FULL-FLOW-DEMO-RECEIVE, FULL-FLOW-DEMO-TRANSFER, FULL-FLOW-DEMO-COUNT |
