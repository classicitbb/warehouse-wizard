import { describe, expect, it } from "vitest";

import {
  buildShipmentLinesFromInbound,
  containersOf,
  findShipmentDrafts,
  pickContainerNumber,
  summarizeInboundLines,
} from "@/features/receiving/inbound-shipment-lines";
import { mergeLoadedLines, netsuiteRefFromDraftMeta } from "@/features/receiving/netsuite-lookup-lines";
import type { InboundShipmentDetail, InboundShipmentLine, InboundShipmentSummary } from "@/features/receiving/netsuite-inbound";

const helpers = {
  productExpiryTracked: (id: string) => id === "p-lot",
  defaultExpiryDate: () => "2028-01-01",
  defaultPackagingProfileId: () => "profile-1",
};

const shipment: InboundShipmentSummary = {
  id: "5", number: "ISH-0098", containers: [], externalDocumentNumber: "MSKU1234565", billOfLading: "BL77", vesselNumber: "",
  status: { code: "inTransit", label: "In Transit" }, expectedDeliveryDate: "2026-10-20", actualShippingDate: null,
  memo: "", poCount: 2, lineCount: 3, quantityExpected: 750,
};

function line(overrides: Partial<InboundShipmentLine>): InboundShipmentLine {
  return {
    shipmentLineId: "1", lineKey: "k1", lineNumber: 1, itemId: "7", itemName: "Lens A", description: "",
    quantityExpected: 600, quantityReceived: 0, quantityRemaining: 600, unit: "EA", location: null, localProductId: "p-1",
    ...overrides,
  };
}

const detail: InboundShipmentDetail = {
  shipmentId: "5",
  receivedKnown: true,
  pos: [
    { poId: "10", poNumber: "PO100", vendor: "Acme", lines: [line({}), line({ shipmentLineId: "2", lineKey: "k2", lineNumber: 2, localProductId: "p-lot", quantityExpected: 100, quantityRemaining: 100 })] },
    { poId: "11", poNumber: "PO200", vendor: "Beta", lines: [line({ shipmentLineId: "3", lineKey: "k3", lineNumber: 1, quantityExpected: 50, quantityRemaining: 50 })] },
  ],
};

describe("pickContainerNumber", () => {
  it("uses the carrier reference when it is a valid container number", () => {
    expect(pickContainerNumber(shipment)).toBe("MSKU1234565");
  });

  it("falls back to the next field that is a valid container number", () => {
    expect(pickContainerNumber({ containers: [], externalDocumentNumber: "REF-1", billOfLading: "", vesselNumber: "msku 123456-5" })).toBe("MSKU1234565");
  });

  it("hands back the carrier reference, normalised, when nothing validates", () => {
    expect(pickContainerNumber({ containers: [], externalDocumentNumber: "ref-1", billOfLading: "", vesselNumber: "" })).toBe("REF1");
    expect(pickContainerNumber({ containers: [], externalDocumentNumber: "", billOfLading: "", vesselNumber: "" })).toBe("");
  });
});

describe("containersOf", () => {
  it("reads every container from the Container No field", () => {
    expect(containersOf({ ...shipment, containers: ["SMLU7872173", "SMLU3120938"] })).toEqual(["SMLU7872173", "SMLU3120938"]);
  });

  it("prefers the Container No field over the carrier reference", () => {
    expect(containersOf({ ...shipment, containers: ["SMLU7872173"], externalDocumentNumber: "MSKU1234565" })).toEqual(["SMLU7872173"]);
  });

  it("falls back to the carrier reference when the field is empty", () => {
    expect(containersOf(shipment)).toEqual(["MSKU1234565"]);
    expect(containersOf({ ...shipment, externalDocumentNumber: "", billOfLading: "" })).toEqual([]);
  });
});

describe("buildShipmentLinesFromInbound", () => {
  it("makes one line per receivable PO line and names the PO and shipment on each", () => {
    const { lines, skipped } = buildShipmentLinesFromInbound(shipment, detail, helpers);
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => l.netsuite?.poNumber)).toEqual(["PO100", "PO100", "PO200"]);
    expect(lines[0]).toMatchObject({ product_id: "p-1", total_quantity: 600, packaging_profile_id: "profile-1", expiry_date: "" });
    expect(lines[0].netsuite).toMatchObject({ lineKey: "k1", ordered: 600, remaining: 600, inboundShipmentId: "5", inboundShipmentNumber: "ISH-0098", poId: "10" });
    expect(lines[1].expiry_date).toBe("2028-01-01");
  });

  it("starts at what NetSuite still expects when part has been received", () => {
    const partial: InboundShipmentDetail = {
      ...detail,
      pos: [{ ...detail.pos[0], lines: [line({ quantityReceived: 200, quantityRemaining: 400 })] }],
    };
    const { lines } = buildShipmentLinesFromInbound(shipment, partial, helpers);
    expect(lines[0]).toMatchObject({ total_quantity: 400 });
    expect(lines[0].netsuite).toMatchObject({ ordered: 600, received: 200, remaining: 400 });
  });

  it("skips and names lines that are done or whose item is not imported", () => {
    const mixed: InboundShipmentDetail = {
      ...detail,
      pos: [{ ...detail.pos[0], lines: [line({ quantityRemaining: 0 }), line({ shipmentLineId: "9", lineKey: "k9", lineNumber: 4, localProductId: null })] }],
    };
    const { lines, skipped } = buildShipmentLinesFromInbound(shipment, mixed, helpers);
    expect(lines).toHaveLength(0);
    expect(skipped).toEqual([
      { lineNumber: 1, itemName: "Lens A", poNumber: "PO100", reason: "nothing_remaining" },
      { lineNumber: 4, itemName: "Lens A", poNumber: "PO100", reason: "item_not_imported" },
    ]);
  });

  it("records how many containers a multi-container shipment holds, on every line", () => {
    const two = { ...shipment, containers: ["SMLU7872173", "SMLU3120938"] };
    const { lines } = buildShipmentLinesFromInbound(two, detail, helpers);
    expect(lines.every((l) => l.netsuite?.inboundContainerCount === 2)).toBe(true);
    expect(summarizeInboundLines(lines)?.containerCount).toBe(2);
    expect(buildShipmentLinesFromInbound(shipment, detail, helpers).lines[0].netsuite).not.toHaveProperty("inboundContainerCount");
    expect(netsuiteRefFromDraftMeta({ netsuite: JSON.parse(JSON.stringify(lines[0].netsuite)) })?.inboundContainerCount).toBe(2);
  });

  it("loading the same shipment twice does not duplicate lines", () => {
    const first = buildShipmentLinesFromInbound(shipment, detail, helpers).lines;
    const second = buildShipmentLinesFromInbound(shipment, detail, helpers).lines;
    expect(mergeLoadedLines(first, second)).toHaveLength(3);
  });
});

describe("summarizeInboundLines", () => {
  it("lists the shipment and each PO once", () => {
    const { lines } = buildShipmentLinesFromInbound(shipment, detail, helpers);
    expect(summarizeInboundLines(lines)).toEqual({ shipmentNumber: "ISH-0098", poNumbers: ["PO100", "PO200"], containerCount: 1 });
  });

  it("is null for lines that did not come from an inbound shipment", () => {
    expect(summarizeInboundLines([{ netsuite: undefined }])).toBeNull();
    expect(summarizeInboundLines([{ netsuite: { lineKey: "x", lineNumber: 1, itemName: "", ordered: 1, received: 0, remaining: 1, poNumber: "PO1" } }])).toBeNull();
  });
});

describe("netsuiteRefFromDraftMeta", () => {
  it("restores the PO and shipment saved on a draft, and still reads older drafts", () => {
    const { lines } = buildShipmentLinesFromInbound(shipment, detail, helpers);
    const restored = netsuiteRefFromDraftMeta({ netsuite: JSON.parse(JSON.stringify(lines[2].netsuite)) });
    expect(restored).toMatchObject({ lineKey: "k3", poNumber: "PO200", poId: "11", inboundShipmentId: "5", inboundShipmentNumber: "ISH-0098" });
    const older = netsuiteRefFromDraftMeta({ netsuite: { lineKey: "k", lineNumber: 2, itemName: "x", ordered: 5, received: 0, remaining: 5 } });
    expect(older).toEqual({ lineKey: "k", lineNumber: 2, itemName: "x", ordered: 5, received: 0, remaining: 5 });
  });
});

describe("findShipmentDrafts", () => {
  const notes = (meta: object) => JSON.stringify(meta);

  it("finds drafts by NetSuite shipment id", () => {
    const drafts = [{ container_number: null, notes: notes({ netsuite: { inboundShipmentId: "5" } }) }, { container_number: null, notes: notes({ netsuite: { inboundShipmentId: "6" } }) }];
    expect(findShipmentDrafts(drafts, shipment)).toHaveLength(1);
  });

  it("finds drafts by container number however it was typed", () => {
    const drafts = [{ container_number: "msku 123456-5", notes: null }, { container_number: "TEMU6543210", notes: null }];
    expect(findShipmentDrafts(drafts, shipment)).toHaveLength(1);
  });

  describe("a shipment with several containers", () => {
    const two = { ...shipment, containers: ["SMLU7872173", "SMLU3120938"] };
    const idNotes = JSON.stringify({ netsuite: { inboundShipmentId: "5" } });

    it("blocks only the container that already has drafts", () => {
      const drafts = [{ container_number: "SMLU7872173", notes: idNotes }];
      expect(findShipmentDrafts(drafts, two, "SMLU7872173")).toHaveLength(1);
      expect(findShipmentDrafts(drafts, two, "SMLU3120938")).toHaveLength(0);
    });

    it("does not let the shipment id alone block the second container", () => {
      const drafts = [{ container_number: "SMLU3120938", notes: idNotes }];
      expect(findShipmentDrafts(drafts, two, "SMLU7872173")).toEqual([]);
    });

    it("counts drafts for any of its containers when no container is named", () => {
      const drafts = [{ container_number: "SMLU3120938", notes: null }, { container_number: "TEMU6543210", notes: null }];
      expect(findShipmentDrafts(drafts, two)).toHaveLength(1);
    });
  });

  it("finds nothing when no draft matches or the shipment has no container", () => {
    expect(findShipmentDrafts([{ container_number: "TEMU6543210", notes: null }], shipment)).toEqual([]);
    expect(findShipmentDrafts([{ container_number: "", notes: "not json" }], { ...shipment, externalDocumentNumber: "", billOfLading: "" })).toEqual([]);
  });
});
