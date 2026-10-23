import { describe, expect, it } from "vitest";

import {
  DISCOVERY_RECORDS,
  isDiscoveryRecord,
  summariseSchema,
} from "../../supabase/functions/_shared/netsuite-discovery";
import {
  DEFAULT_RESTLET_DEPLOY_ID,
  DEFAULT_RESTLET_SCRIPT_ID,
  buildRestletUrl,
  isValidRestletId,
  resolveRestletTarget,
  restletHost,
} from "../../supabase/functions/_shared/netsuite-restlet";

describe("RESTlet addressing", () => {
  it("uses the restlets host, which differs from the REST host only by the sub-domain", () => {
    expect(restletHost("9738806-sb1")).toBe("9738806-sb1.restlets.api.netsuite.com");
    expect(restletHost("9738806_SB1")).toBe("9738806-sb1.restlets.api.netsuite.com");
    expect(restletHost("9738806")).toBe("9738806.restlets.api.netsuite.com");
  });

  it("defaults to the text ids so only the host changes between environments", () => {
    expect(resolveRestletTarget({})).toEqual({
      scriptId: DEFAULT_RESTLET_SCRIPT_ID,
      deployId: DEFAULT_RESTLET_DEPLOY_ID,
    });
    expect(DEFAULT_RESTLET_SCRIPT_ID).toBe("customscript_spx_ww_inb_receipt_rl");
    expect(DEFAULT_RESTLET_DEPLOY_ID).toBe("customdeploy_spx_ww_inb_receipt_rl");
  });

  it("accepts a stored override and ignores a malformed one", () => {
    expect(resolveRestletTarget({ restlet_script_id: "2142", restlet_deploy_id: "1" })).toEqual({
      scriptId: "2142",
      deployId: "1",
    });
    expect(resolveRestletTarget({ restlet_script_id: "2142&x=1", restlet_deploy_id: "a b" })).toEqual({
      scriptId: DEFAULT_RESTLET_SCRIPT_ID,
      deployId: DEFAULT_RESTLET_DEPLOY_ID,
    });
    expect(isValidRestletId(2142)).toBe(false);
  });

  it("builds the GET url from the text ids and the shipment internal id", () => {
    const url = buildRestletUrl(
      "9738806-sb1",
      { scriptId: DEFAULT_RESTLET_SCRIPT_ID, deployId: DEFAULT_RESTLET_DEPLOY_ID },
      { inboundShipmentId: "52" },
    );
    expect(url).toBe(
      "https://9738806-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl" +
        "?script=customscript_spx_ww_inb_receipt_rl&deploy=customdeploy_spx_ww_inb_receipt_rl&inboundShipmentId=52",
    );
  });
});

describe("discovery", () => {
  it("only allows the receiving-flow record types", () => {
    expect(DISCOVERY_RECORDS).toContain("purchaseOrder");
    expect(isDiscoveryRecord("itemReceipt")).toBe(true);
    expect(isDiscoveryRecord("employee")).toBe(false);
    expect(isDiscoveryRecord("../customer")).toBe(false);
  });

  it("reduces a record schema to body fields and sublist line fields", () => {
    const summary = summariseSchema({
      properties: {
        tranId: { type: "string" },
        tranDate: { type: "string", format: "date" },
        item: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { line: { type: "integer" }, quantityReceived: { type: "number" } },
              },
            },
          },
        },
      },
    });
    expect(summary.bodyFields).toEqual({ tranId: "string", tranDate: "string(date)" });
    expect(summary.sublists).toEqual({ item: { line: "integer", quantityReceived: "number" } });
  });

  it("follows $ref sublists through definitions", () => {
    const summary = summariseSchema({
      definitions: {
        itemList: {
          properties: { items: { items: { $ref: "#/definitions/itemLine" } } },
        },
        itemLine: { properties: { orderLine: { type: "integer" } } },
      },
      properties: { item: { $ref: "#/definitions/itemList" } },
    });
    expect(summary.sublists).toEqual({ item: { orderLine: "integer" } });
  });

  it("returns an empty summary for something that is not a schema", () => {
    expect(summariseSchema(null)).toEqual({ bodyFields: {}, sublists: {} });
  });
});
