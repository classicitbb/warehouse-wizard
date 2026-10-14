import { describe, expect, it } from "vitest";

import {
  buildInboundLinesQuery,
  buildInboundListQuery,
  buildInboundTotalsQuery,
  buildShipmentsForPoQuery,
  findContainerField,
  inboundStatusLabel,
  indexReceived,
  indexTotals,
  mapShipmentDetail,
  mapShipmentSummary,
  normalizeFieldId,
  normalizeInternalId,
  normalizeNetSuiteDate,
  normalizeSearchTerm,
  parseContainers,
} from "../../supabase/functions/_shared/netsuite-inbound";

describe("normalizeSearchTerm", () => {
  it("treats a missing or blank term as no search", () => {
    expect(normalizeSearchTerm(undefined)).toBe("");
    expect(normalizeSearchTerm(null)).toBe("");
    expect(normalizeSearchTerm("   ")).toBe("");
  });

  it("accepts container, shipment and PO style terms", () => {
    expect(normalizeSearchTerm("MSKU1234565")).toBe("MSKU1234565");
    expect(normalizeSearchTerm(" ISH-0098 ")).toBe("ISH-0098");
    expect(normalizeSearchTerm("PO4521")).toBe("PO4521");
  });

  it("rejects anything that could break out of a SuiteQL literal", () => {
    expect(normalizeSearchTerm("x' OR '1'='1")).toBeUndefined();
    expect(normalizeSearchTerm("a;b")).toBeUndefined();
    expect(normalizeSearchTerm(12)).toBeUndefined();
  });
});

describe("normalizeInternalId", () => {
  it("accepts plain integers only", () => {
    expect(normalizeInternalId("1234")).toBe("1234");
    expect(normalizeInternalId(77)).toBe("77");
    expect(normalizeInternalId("12 OR 1=1")).toBeNull();
    expect(normalizeInternalId("")).toBeNull();
    expect(normalizeInternalId(undefined)).toBeNull();
  });
});

describe("buildInboundListQuery", () => {
  const base = { search: "", status: "open", sort: "expected_delivery", direction: "asc" } as const;

  it("filters to receivable shipments by default and sorts by delivery date", () => {
    const q = buildInboundListQuery(base);
    expect(q).toContain("s.shipmentstatus IN ('inTransit', 'partiallyReceived')");
    expect(q).toContain("ORDER BY s.expecteddeliverydate ASC NULLS LAST, s.id DESC");
    expect(q).not.toContain("LIKE");
  });

  it("drops the status filter for All", () => {
    expect(buildInboundListQuery({ ...base, status: "all" })).not.toContain("shipmentstatus IN");
  });

  it("searches shipment number, carrier reference, bill of lading, vessel and PO number", () => {
    const q = buildInboundListQuery({ ...base, search: "msku1234565" });
    for (const column of ["s.shipmentnumber", "s.externaldocumentnumber", "s.billoflading", "s.vesselnumber", "po.tranid"]) {
      expect(q).toContain(`UPPER(${column}) LIKE '%MSKU1234565%'`);
    }
  });

  it("only sorts by whitelisted columns", () => {
    expect(buildInboundListQuery({ ...base, sort: "shipment_number", direction: "desc" })).toContain("ORDER BY s.shipmentnumber DESC");
    expect(buildInboundListQuery({ ...base, sort: "status" })).toContain("ORDER BY s.shipmentstatus ASC");
  });
});

describe("other queries", () => {
  it("builds the totals query only from valid ids", () => {
    expect(buildInboundTotalsQuery([])).toBeNull();
    expect(buildInboundTotalsQuery(["1", "x", "3"])).toContain("IN (1, 3)");
  });

  it("rejects a bad shipment or PO id", () => {
    expect(() => buildInboundLinesQuery("1; DROP")).toThrow();
    expect(() => buildShipmentsForPoQuery("abc")).toThrow();
    expect(buildInboundLinesQuery("42")).toContain("i.inboundshipment = 42");
    expect(buildShipmentsForPoQuery("9")).toContain("i.purchaseordertransaction = 9");
  });
});

describe("normalizeNetSuiteDate", () => {
  it("reads US and ISO dates", () => {
    expect(normalizeNetSuiteDate("10/4/2026")).toBe("2026-10-04");
    expect(normalizeNetSuiteDate("2026-10-04T00:00:00Z")).toBe("2026-10-04");
    expect(normalizeNetSuiteDate("")).toBeNull();
    expect(normalizeNetSuiteDate("soon")).toBeNull();
    expect(normalizeNetSuiteDate(null)).toBeNull();
  });
});

describe("mapShipmentSummary", () => {
  it("maps a header row with totals", () => {
    const totals = indexTotals([{ shipmentid: "5", pocount: "2", linecount: 7, quantityexpected: "1860" }]).get("5");
    const s = mapShipmentSummary(
      { id: 5, shipmentnumber: "ISH-0098", externaldocumentnumber: "MSKU1234565", statuscode: "inTransit", expecteddeliverydate: "10/20/2026" },
      totals,
    );
    expect(s).toMatchObject({
      id: "5", number: "ISH-0098", externalDocumentNumber: "MSKU1234565", expectedDeliveryDate: "2026-10-20",
      status: { code: "inTransit", label: "In Transit" }, poCount: 2, lineCount: 7, quantityExpected: 1860,
    });
  });

  it("survives missing columns", () => {
    expect(mapShipmentSummary({ id: "1" })).toMatchObject({ number: "", poCount: 0, expectedDeliveryDate: null, billOfLading: "" });
  });
});

describe("mapShipmentDetail", () => {
  const rows = [
    { shipmentlineid: "1", poid: "10", ponumber: "PO100", vendor: "Acme", linekey: "555", linenumber: 3, itemid: "7", itemname: "Lens A", quantityexpected: "600", unit: "EA" },
    { shipmentlineid: "2", poid: "10", ponumber: "PO100", vendor: "Acme", linekey: "556", linenumber: 4, itemid: "8", itemname: "Lens B", quantityexpected: 100 },
    { shipmentlineid: "3", poid: "11", ponumber: "PO200", vendor: "Beta", linekey: "700", linenumber: 1, itemid: "7", itemname: "Lens A", quantityexpected: 50, locationid: "6", locationname: "Main" },
  ];

  it("groups lines under their PO and keeps the PO line key", () => {
    const d = mapShipmentDetail("5", rows, new Map([["1", 200]]));
    expect(d.pos.map((p) => p.poNumber)).toEqual(["PO100", "PO200"]);
    expect(d.pos[0].lines[0]).toMatchObject({ lineKey: "555", lineNumber: 3, quantityExpected: 600, quantityReceived: 200, quantityRemaining: 400, unit: "EA" });
    expect(d.pos[1].lines[0].location).toEqual({ id: "6", name: "Main" });
    expect(d.receivedKnown).toBe(true);
  });

  it("marks received quantities unknown rather than guessing", () => {
    const d = mapShipmentDetail("5", rows, null);
    expect(d.receivedKnown).toBe(false);
    expect(d.pos[0].lines[0]).toMatchObject({ quantityReceived: null, quantityRemaining: 600 });
  });

  it("never reports a negative remaining quantity", () => {
    const d = mapShipmentDetail("5", rows, indexReceived([{ shipmentlineid: "1", quantityreceived: "700" }]));
    expect(d.pos[0].lines[0].quantityRemaining).toBe(0);
  });
});

describe("container field", () => {
  it("accepts script ids only, lower-cased", () => {
    expect(normalizeFieldId("custbody_Container_No")).toBe("custbody_container_no");
    expect(normalizeFieldId("custbody x")).toBeNull();
    expect(normalizeFieldId("x; DROP")).toBeNull();
    expect(normalizeFieldId("1abc")).toBeNull();
    expect(normalizeFieldId(undefined)).toBeNull();
  });

  it("finds the custom container number column among the record's columns", () => {
    const columns = ["id", "shipmentnumber", "externaldocumentnumber", "custrecord_container_size", "custrecord_container_status", "custrecord_container_no", "custrecord_sn_number"];
    expect(findContainerField(columns)).toBe("custrecord_container_no");
    expect(findContainerField(["id", "custrecord_containers"])).toBe("custrecord_containers");
    expect(findContainerField(["id", "shipmentnumber", "custrecord_container_size"])).toBeNull();
    expect(findContainerField([])).toBeNull();
  });

  it("splits several containers out of one value", () => {
    expect(parseContainers("SMLU7872173, SMLU3120938")).toEqual(["SMLU7872173", "SMLU3120938"]);
    expect(parseContainers("SMLU7872173;smlu3120938 / SMLU7872173")).toEqual(["SMLU7872173", "SMLU3120938"]);
    expect(parseContainers(" ")).toEqual([]);
    expect(parseContainers(null)).toEqual([]);
  });

  it("selects and searches the container field when it is known", () => {
    const base = { search: "smlu3120938", status: "open", sort: "expected_delivery", direction: "asc" } as const;
    const withField = buildInboundListQuery(base, "custrecord_container_no");
    expect(withField).toContain("s.custrecord_container_no AS containerno");
    expect(withField).toContain("UPPER(s.custrecord_container_no) LIKE '%SMLU3120938%'");
    expect(buildInboundListQuery(base)).not.toContain("containerno");
  });

  it("never inlines an unsafe field id", () => {
    expect(buildInboundListQuery({ search: "", status: "all", sort: "status", direction: "asc" }, "x FROM y; --")).not.toContain("y;");
  });

  it("reads containers into the summary", () => {
    expect(mapShipmentSummary({ id: "1", containerno: "SMLU7872173, SMLU3120938" }).containers).toEqual(["SMLU7872173", "SMLU3120938"]);
    expect(mapShipmentSummary({ id: "1" }).containers).toEqual([]);
  });
});

describe("shipment status", () => {
  it("derives the label itself, because NetSuite rejects BUILTIN.DF on the status field", () => {
    expect(inboundStatusLabel("inTransit")).toBe("In Transit");
    expect(inboundStatusLabel("partiallyReceived")).toBe("Partially Received");
    expect(inboundStatusLabel("PARTIALLY_RECEIVED")).toBe("Partially Received");
    expect(inboundStatusLabel("")).toBe("");
  });

  it("maps a status code to a labelled status", () => {
    expect(mapShipmentSummary({ id: "1", statuscode: "inTransit" }).status).toEqual({ code: "inTransit", label: "In Transit" });
    expect(mapShipmentSummary({ id: "1" }).status).toEqual({ code: null, label: "" });
  });

  it("never asks NetSuite to resolve the status field", () => {
    const base = { search: "", status: "open", sort: "expected_delivery", direction: "asc" } as const;
    expect(buildInboundListQuery(base)).not.toContain("BUILTIN.DF(s.shipmentstatus)");
    expect(buildInboundListQuery(base)).toContain("s.shipmentstatus AS statuscode");
    expect(buildShipmentsForPoQuery("9")).not.toContain("BUILTIN.DF(s.shipmentstatus)");
    expect(buildShipmentsForPoQuery("9")).toContain("s.shipmentstatus AS statuscode");
  });
});
