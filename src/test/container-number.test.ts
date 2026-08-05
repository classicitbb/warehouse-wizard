import {
  calculateIso6346CheckDigit,
  extractIso6346ContainerNumber,
  normalizeContainerNumber,
  validateIso6346ContainerNumber,
} from "@/lib/container-number";

describe("ISO 6346 container numbers", () => {
  it("normalizes scanned text", () => {
    expect(normalizeContainerNumber(" msku 123-456-5 ")).toBe("MSKU1234565");
  });

  it("calculates and validates the check digit", () => {
    expect(calculateIso6346CheckDigit("MSKU123456")).toBe(5);
    expect(validateIso6346ContainerNumber("MSKU1234565")).toMatchObject({ valid: true });
  });

  it("validates real container examples from receiving scanner training images", () => {
    expect(validateIso6346ContainerNumber("MEDU2484381")).toMatchObject({ valid: true });
    expect(validateIso6346ContainerNumber("PSSU8023976")).toMatchObject({ valid: true });
    expect(validateIso6346ContainerNumber("MTBU0200596")).toMatchObject({ valid: true });
  });

  it("rejects invalid check digits", () => {
    expect(validateIso6346ContainerNumber("MSKU1234567")).toMatchObject({
      valid: false,
      message: "Container check digit should be 5. Check the number and try again.",
    });
  });

  it("rejects invalid diagram examples and size type markings", () => {
    expect(validateIso6346ContainerNumber("ADNU1234560")).toMatchObject({ valid: false });
    expect(validateIso6346ContainerNumber("BICU1234567")).toMatchObject({ valid: false });
    expect(extractIso6346ContainerNumber("MAX.GR. 30,480 KG TARE 25G1 45G1")).toMatchObject({
      valid: false,
      message: "No ISO 6346 container number was found in the scan.",
    });
  });

  it("extracts a valid container number from OCR text", () => {
    expect(extractIso6346ContainerNumber("Container: MSKU 1234565 / PO-1")).toMatchObject({
      normalized: "MSKU1234565",
      valid: true,
    });
  });

  it("extracts the top-right row while ignoring the nearby ISO size code", () => {
    expect(extractIso6346ContainerNumber("MTBU 020059 6\n25G1\nMAX.GR. 30,480 KGS")).toMatchObject({
      normalized: "MTBU0200596",
      valid: true,
    });
  });

  it("extracts a valid container number from separated OCR characters", () => {
    expect(extractIso6346ContainerNumber("M S K U 1 2 3 4 5 6 5")).toMatchObject({
      normalized: "MSKU1234565",
      valid: true,
    });
  });

  it("repairs common OCR confusions by container-number position", () => {
    expect(extractIso6346ContainerNumber("M5KU I234S65")).toMatchObject({
      normalized: "MSKU1234565",
      valid: true,
    });
  });

  it("returns the invalid candidate when the check digit fails", () => {
    expect(extractIso6346ContainerNumber("Container MSKU 1234567")).toMatchObject({
      normalized: "MSKU1234567",
      valid: false,
      candidate: "MSKU1234567",
      message: "Container check digit should be 5. Check the number and try again.",
    });
  });

  it("reports when OCR does not contain a container candidate", () => {
    expect(extractIso6346ContainerNumber("dock door 12 no box code")).toMatchObject({
      valid: false,
      message: "No ISO 6346 container number was found in the scan.",
    });
  });
});
