import { describe, expect, it } from "vitest";

import {
  buildCustomerPageQuery,
  formatShipAddress,
  mapCustomerRow,
  normalizeCursor,
  normalizeZone,
} from "../../supabase/functions/_shared/netsuite-customers";

describe("netsuite customers", () => {
  it("builds the active-customer import page with a keyset on id", () => {
    const q = buildCustomerPageQuery({ afterId: 1234 });
    expect(q).toContain("FROM customer c LEFT JOIN entityaddress a ON a.nkey = c.defaultshippingaddress");
    expect(q).toContain("BUILTIN.DF(c.custentity_simplex_zone) AS zone");
    expect(q).toContain("c.custentity_spx_credit_review_req AS credit_review");
    expect(q).toContain("WHERE c.isinactive = 'F' AND c.id > 1234");
    expect(q).toMatch(/ORDER BY c\.id$/);
  });

  it("builds the delta page from a cursor and includes inactive customers", () => {
    const q = buildCustomerPageQuery({ afterId: 0, since: "2026-09-28T02:02:19" });
    expect(q).toContain("c.lastmodifieddate >= TO_DATE('2026-09-28 02:02:19', 'YYYY-MM-DD HH24:MI:SS')");
    expect(q).not.toContain("isinactive = 'F'");
  });

  it("never embeds an unsafe cursor or id", () => {
    expect(normalizeCursor("2026-09-28'; DROP")).toBeNull();
    expect(normalizeCursor(42)).toBeNull();
    const q = buildCustomerPageQuery({ afterId: Number.NaN, since: "x' OR 1=1 --" });
    expect(q).toContain("c.isinactive = 'F' AND c.id > 0");
    expect(q).not.toContain("OR 1=1");
  });

  it("maps a SuiteQL row into a customers row", () => {
    const mapped = mapCustomerRow({
      id: "21",
      entityid: "1",
      companyname: "Popular Discounts",
      email: "payables@example.bb",
      zone: "Central",
      oncredithold: "T",
      credit_review: "T",
      shipcomplete: "F",
      isinactive: "F",
      modified: "2026-09-28 02:02:19",
      addressee: "Popular Discounts",
      addr1: "Spooners Hill",
      city: "St. Michael",
      country: "BB",
    });
    expect(mapped).toMatchObject({
      externalId: "21",
      customer_number: "1",
      name: "Popular Discounts",
      delivery_zone: "Central",
      email: "payables@example.bb",
      phone: null,
      on_credit_hold: true,
      credit_review_required: true,
      ship_complete: false,
      active: true,
      source_modified_at: "2026-09-28 02:02:19",
    });
    expect(mapped?.default_ship_address).toMatchObject({ addr1: "Spooners Hill", city: "St. Michael", country: "BB", addr2: null });
    expect(formatShipAddress(mapped?.default_ship_address)).toBe("Spooners Hill, St. Michael, BB");
  });

  it("falls back for names, zones and missing addresses", () => {
    const mapped = mapCustomerRow({ id: "99", entityid: "C-99", altname: "Jane Doe", zone: "0", isinactive: "T" });
    expect(mapped).toMatchObject({ name: "Jane Doe", delivery_zone: null, default_ship_address: null, active: false });
    expect(mapCustomerRow({ id: "100", entityid: "C-100" })?.name).toBe("C-100");
    expect(mapCustomerRow({ entityid: "x" })).toBeNull();
    expect(normalizeZone("north")).toBe("North");
    expect(normalizeZone("")).toBeNull();
  });
});
