import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { collectIso6346ContainerCandidates, extractIso6346ContainerNumber } from "@/lib/container-number";

const ocrMocks = vi.hoisted(() => ({
  recognize: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  recognize: ocrMocks.recognize,
}));

const supabaseMocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ data: { containerNumber: null }, error: null })),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: supabaseMocks.invoke } },
}));

function validateContainerScan(raw: string) {
  const result = extractIso6346ContainerNumber(raw);
  return { valid: result.valid, value: result.normalized, message: result.message };
}

describe("BarcodeScanButton", () => {
  let rafCount = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.invoke.mockResolvedValue({ data: { containerNumber: null }, error: null });
    window.localStorage.clear();
    rafCount = 0;

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: () => ({ drawImage: vi.fn() }),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: () => "data:image/png;base64,container",
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCount += 1;
      if (rafCount <= 3) window.setTimeout(() => callback(performance.now()), 0);
      return rafCount;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  it("uses fallback OCR to produce a valid scan candidate without TextDetector", async () => {
    const onScan = vi.fn();
    ocrMocks.recognize.mockResolvedValueOnce({ data: { text: "M S K U 1 2 3 4 5 6 5" } });

    render(
      <BarcodeScanButton
        title="Scan container number"
        enableTextRecognition
        requireConfirm
        validateScan={validateContainerScan}
        onScan={onScan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan container number" }));

    expect(await screen.findByText("MSKU1234565")).toBeInTheDocument();
    expect(screen.getByText("Text recognized")).toBeInTheDocument();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("does not call onScan for invalid fallback OCR text", async () => {
    const onScan = vi.fn();
    ocrMocks.recognize.mockResolvedValue({ data: { text: "dock door only" } });

    render(
      <BarcodeScanButton
        title="Scan container number"
        enableTextRecognition
        requireConfirm
        validateScan={validateContainerScan}
        onScan={onScan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan container number" }));

    expect(await screen.findByText("No ISO 6346 container number was found in the scan.")).toBeInTheDocument();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("requires confirmation before inserting valid fallback OCR", async () => {
    const onScan = vi.fn();
    ocrMocks.recognize.mockResolvedValueOnce({ data: { text: "MSKU1234565" } });

    render(
      <BarcodeScanButton
        title="Scan container number"
        enableTextRecognition
        requireConfirm
        validateScan={validateContainerScan}
        onScan={onScan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan container number" }));
    await screen.findByText("MSKU1234565");
    expect(onScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("MSKU1234565"));
  });

  it("in container mode rejects invalid crop OCR before confirming a valid ISO code", async () => {
    const onScan = vi.fn();
    const onScanTelemetry = vi.fn();
    ocrMocks.recognize
      .mockResolvedValueOnce({ data: { text: "MAX.GR. 30,480 KG 45G1" } })
      .mockResolvedValueOnce({ data: { text: "MTBU 020059 6\n25G1" } });

    render(
      <BarcodeScanButton
        title="Scan container number"
        enableTextRecognition
        requireConfirm
        scanMode="containerNumber"
        validateScan={validateContainerScan}
        getScanCandidates={collectIso6346ContainerCandidates}
        onScanTelemetry={onScanTelemetry}
        onScan={onScan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan container number" }));

    expect(await screen.findByText("MTBU0200596")).toBeInTheDocument();
    expect(screen.getAllByText("Verify true").length).toBeGreaterThan(0);
    expect(onScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use" }));

    await waitFor(() => expect(onScan).toHaveBeenCalledWith("MTBU0200596"));
    expect(onScanTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      event: "scan-success",
      value: "MTBU0200596",
      tags: expect.arrayContaining(["container-scanner", "iso6346", "scan-success"]),
    }));
  });

  it("in container mode keeps the scanner open when all OCR regions fail validation", async () => {
    const onScan = vi.fn();
    ocrMocks.recognize.mockResolvedValue({ data: { text: "TARE 3510 KG 45G1" } });

    render(
      <BarcodeScanButton
        title="Scan container number"
        enableTextRecognition
        requireConfirm
        scanMode="containerNumber"
        validateScan={validateContainerScan}
        getScanCandidates={collectIso6346ContainerCandidates}
        onScan={onScan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan container number" }));

    expect(await screen.findByText("Verify failed. Keeping scanner open.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("falls back to AI vision when local OCR keeps failing", async () => {
    const onScan = vi.fn();
    ocrMocks.recognize.mockResolvedValue({ data: { text: "TARE 3510 KG 45G1" } });
    supabaseMocks.invoke.mockResolvedValue({ data: { containerNumber: "MTBU0200596" }, error: null });

    render(
      <BarcodeScanButton
        title="Scan container number"
        enableTextRecognition
        requireConfirm
        scanMode="containerNumber"
        validateScan={validateContainerScan}
        getScanCandidates={collectIso6346ContainerCandidates}
        onScan={onScan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan container number" }));

    expect(await screen.findByText("MTBU0200596")).toBeInTheDocument();
    expect(onScan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Use" }));
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("MTBU0200596"));
  });

  it("ignores an AI vision result the server could not validate", async () => {
    const onScan = vi.fn();
    ocrMocks.recognize.mockResolvedValue({ data: { text: "TARE 3510 KG 45G1" } });
    supabaseMocks.invoke.mockResolvedValue({ data: { containerNumber: null }, error: null });

    render(
      <BarcodeScanButton
        title="Scan container number"
        enableTextRecognition
        requireConfirm
        scanMode="containerNumber"
        validateScan={validateContainerScan}
        getScanCandidates={collectIso6346ContainerCandidates}
        onScan={onScan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Scan container number" }));

    expect(await screen.findByText("Verify failed. Keeping scanner open.")).toBeInTheDocument();
    expect(onScan).not.toHaveBeenCalled();
  });
});
