import { format } from "date-fns";
import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/features/shared/core-types";

const samples = [
  "2026-01-01T00:00:00",
  "2026-02-28T23:59:00",
  "2024-02-29T09:05:00",
  "2026-12-31T12:00:30",
  "2026-07-04T07:08:09",
  "1999-10-09T00:01:00",
  "2026-03-15T14:30:00.000Z",
  "2026-11-02T04:00:00+05:30",
];

describe("formatDate / formatDateTime match date-fns output", () => {
  it.each(samples)("datetime %s", (iso) => {
    expect(formatDateTime(iso)).toBe(format(new Date(iso), "dd MMM yyyy, HH:mm"));
    expect(formatDate(iso)).toBe(format(new Date(iso), "dd MMM yyyy"));
  });

  it("formats date-only values as local calendar days", () => {
    expect(formatDate("2026-10-01")).toBe(format(new Date(2026, 9, 1), "dd MMM yyyy"));
    expect(formatDate("2026-10-01")).toBe("01 Oct 2026");
  });

  it("keeps the empty placeholder", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDateTime(undefined)).toBe("—");
  });

  it("throws RangeError on invalid dates like date-fns", () => {
    expect(() => formatDate("not-a-date")).toThrow(RangeError);
    expect(() => formatDateTime("not-a-date")).toThrow(RangeError);
    expect(() => format(new Date("not-a-date"), "dd MMM yyyy")).toThrow(RangeError);
  });
});
