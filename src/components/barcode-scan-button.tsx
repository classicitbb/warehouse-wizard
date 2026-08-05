import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getLearnedContainerScanRegion, recordContainerScannerSuccess, type ContainerScannerSuccessSample } from "@/lib/container-scanner-learning";
import { getContainerScanRegions, scanRegionToPixels, type NormalizedScanRegion } from "@/lib/container-scanner-regions";
import { cn } from "@/lib/utils";

export type ScanValidationResult = {
  valid: boolean;
  value?: string;
  message?: string;
};

export type ScanTelemetryEvent = {
  event: "scan-success" | "scan-failed";
  scanMode: "generic" | "containerNumber";
  value?: string;
  rawText?: string;
  region?: NormalizedScanRegion;
  rejectedCandidates: string[];
  rejectedRegions: Array<{ name: string; rawText?: string; message?: string }>;
  attemptCount: number;
  elapsedMs: number;
  fallbackUsed: boolean;
  faceDetected: boolean;
  tags: string[];
};

interface BarcodeScanButtonProps {
  onScan: (value: string) => void;
  title?: string;
  buttonLabel?: string;
  className?: string;
  disabled?: boolean;
  enableTextRecognition?: boolean;
  requireConfirm?: boolean;
  scanMode?: "generic" | "containerNumber";
  statusText?: string;
  validateScan?: (raw: string) => ScanValidationResult;
  getScanCandidates?: (raw: string) => string[];
  onScanTelemetry?: (event: ScanTelemetryEvent) => void;
  onOpenChange?: (open: boolean) => void;
  autoOpenSignal?: number;
  /** After scan is accepted, simulate Enter keydown on this input to advance focus. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

type PendingScan = {
  raw: string;
  value: string;
  message?: string;
  region?: NormalizedScanRegion;
};

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = {
  new(options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};
type TextDetectorLike = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string; text?: string }>> };
type TextDetectorConstructor = { new(): TextDetectorLike };

const BARCODE_FORMATS = [
  "qr_code", "code_128", "code_39", "code_93",
  "ean_13", "ean_8", "upc_a", "upc_e",
  "data_matrix", "pdf417", "aztec",
];

const OCR_SCAN_INTERVAL_MS = 1800;
const CONTAINER_RETRY_NOTICE_MS = 5000;

function getScanCandidate(raw: string, validateScan?: (raw: string) => ScanValidationResult) {
  if (!validateScan) return { valid: true, value: raw, raw };

  const result = validateScan(raw);
  return {
    valid: result.valid,
    value: result.value ?? raw,
    raw,
    message: result.message,
  };
}

async function recognizeTextFromVideo(video: HTMLVideoElement, region?: NormalizedScanRegion) {
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 360;
  const crop = region
    ? scanRegionToPixels(region, width, height)
    : {
      width: Math.round(width * 0.68),
      height: Math.round(height * 0.44),
      x: Math.max(0, Math.round((width - Math.round(width * 0.68)) / 2)),
      y: Math.max(0, Math.round((height - Math.round(height * 0.44)) / 2)),
    };

  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d");
  if (!context) return "";

  context.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const image = canvas.toDataURL("image/png");
  const tesseract = await import("tesseract.js") as { recognize: (image: string, language: string) => Promise<{ data?: { text?: string } }> };
  const result = await tesseract.recognize(image, "eng");
  return String(result?.data?.text ?? "");
}

export function BarcodeScanButton({
  onScan,
  title = "Scan barcode",
  buttonLabel,
  className,
  disabled = false,
  enableTextRecognition = false,
  requireConfirm = false,
  scanMode = "generic",
  statusText,
  validateScan,
  getScanCandidates,
  onScanTelemetry,
  onOpenChange,
  autoOpenSignal,
  inputRef,
}: BarcodeScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [activeScanRegion, setActiveScanRegion] = useState<NormalizedScanRegion | null>(null);
  const pendingScanRef = useRef<PendingScan | null>(null);
  const acceptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const textDetectorRef = useRef<TextDetectorLike | null>(null);
  const lastTextScanRef = useRef(0);
  const ocrBusyRef = useRef(false);
  const scanStartedAtRef = useRef(0);
  const attemptCountRef = useRef(0);
  const rejectedCandidatesRef = useRef<string[]>([]);
  const rejectedRegionsRef = useRef<ScanTelemetryEvent["rejectedRegions"]>([]);
  const failureLoggedRef = useRef(false);
  const pendingContainerSuccessRef = useRef<{ event: ScanTelemetryEvent; sample: ContainerScannerSuccessSample } | null>(null);

  const updateOpen = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  useEffect(() => {
    if (!autoOpenSignal || disabled) return;
    updateOpen(true);
  }, [autoOpenSignal, disabled, updateOpen]);

  const stopStream = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    detectorRef.current = null;
    textDetectorRef.current = null;
  }, []);

  const acceptScan = useCallback((value: string) => {
    const pendingSuccess = pendingContainerSuccessRef.current;
    if (pendingSuccess?.event.value === value) {
      recordContainerScannerSuccess(pendingSuccess.sample);
      try {
        onScanTelemetry?.(pendingSuccess.event);
      } catch {
        // Telemetry is best-effort and must not block scan acceptance.
      }
      pendingContainerSuccessRef.current = null;
    }
    setDetected(value);
    setPendingScan(null);
    pendingScanRef.current = null;
    stopStream();
    setTimeout(() => {
      onScan(value);
      updateOpen(false);
      if (inputRef?.current) {
        inputRef.current.focus();
        inputRef.current.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
      }
    }, 400);
  }, [inputRef, onScan, onScanTelemetry, stopStream, updateOpen]);

  const emitScanTelemetry = useCallback((event: ScanTelemetryEvent) => {
    try {
      onScanTelemetry?.(event);
    } catch {
      // Telemetry is best-effort and must not block scanning.
    }
  }, [onScanTelemetry]);

  const handleScanValue = useCallback((rawValue: string, source: "barcode" | "text" | "ocr", region?: NormalizedScanRegion) => {
    const candidate = getScanCandidate(rawValue, validateScan);
    if (!candidate.valid) {
      if (validateScan || source !== "barcode") {
        setScanMessage(scanMode === "containerNumber"
          ? "Verify failed. Keeping scanner open."
          : candidate.message ?? "No usable scan was found. Keep the code centered and try again.");
      }
      return false;
    }

    const pending = {
      raw: rawValue,
      value: candidate.value,
      message: scanMode === "containerNumber" ? "Verify true" : candidate.message,
      region,
    };
    if (requireConfirm) {
      pendingScanRef.current = pending;
      setPendingScan(pending);
      setScanMessage(scanMode === "containerNumber" ? "Verify true" : candidate.message ?? "Valid scan recognized. Confirm to insert.");
      stopStream();
      return true;
    }

    if (source === "text" || source === "ocr") {
      pendingScanRef.current = pending;
      setPendingScan(pending);
      setScanMessage(scanMode === "containerNumber" ? "Verify true" : candidate.message ?? "Text recognized. Insert will continue automatically.");
      if (acceptTimerRef.current != null) clearTimeout(acceptTimerRef.current);
      acceptTimerRef.current = setTimeout(() => {
        if (pendingScanRef.current?.value === pending.value) {
          acceptScan(pending.value);
        }
      }, 1500);
      return true;
    }

    acceptScan(candidate.value);
    return true;
  }, [acceptScan, requireConfirm, scanMode, stopStream, validateScan]);

  const runContainerOcrPass = useCallback(async (video: HTMLVideoElement) => {
    const attemptCount = attemptCountRef.current + 1;
    attemptCountRef.current = attemptCount;
    const learnedRegion = getLearnedContainerScanRegion();
    const regions = getContainerScanRegions({
      frameWidth: video.videoWidth || 1280,
      frameHeight: video.videoHeight || 720,
      learnedRegion,
    });

    setScanMessage(attemptCount === 1 ? "Finding container face" : "Checking top-right number");

    for (const region of regions) {
      setActiveScanRegion(region);
      setScanMessage(region.source === "learned" ? "Checking learned container-number area" : region.name.includes("top-right") ? "Checking top-right number" : "Checking container number");
      const rawText = await recognizeTextFromVideo(video, region);
      const trimmed = rawText.trim();
      if (!trimmed) {
        rejectedRegionsRef.current = [...rejectedRegionsRef.current, { name: region.name, message: "No OCR text returned." }];
        continue;
      }

      const candidate = getScanCandidate(trimmed, validateScan);
      const regionCandidates = getScanCandidates?.(trimmed) ?? [];
      if (!candidate.valid) {
        rejectedCandidatesRef.current = Array.from(new Set([...rejectedCandidatesRef.current, ...regionCandidates]));
        rejectedRegionsRef.current = [...rejectedRegionsRef.current, {
          name: region.name,
          rawText: trimmed.slice(0, 240),
          message: candidate.message,
        }];
        continue;
      }

      const elapsedMs = Date.now() - scanStartedAtRef.current;
      const value = candidate.value ?? trimmed;
      pendingContainerSuccessRef.current = {
        sample: { acceptedCode: value, region, rawText: trimmed, attemptCount },
        event: {
          event: "scan-success",
          scanMode,
          value,
          rawText: trimmed.slice(0, 240),
          region,
          rejectedCandidates: rejectedCandidatesRef.current,
          rejectedRegions: rejectedRegionsRef.current,
          attemptCount,
          elapsedMs,
          fallbackUsed: region.source === "fallback" || regions.slice(0, regions.indexOf(region)).some((item) => item.source === "fallback"),
          faceDetected: region.faceDetected,
          tags: ["container-scanner", "iso6346", "scan-success", "learning-sample", "improvement-pass"],
        },
      };
      return handleScanValue(trimmed, "ocr", region);
    }

    const elapsedMs = Date.now() - scanStartedAtRef.current;
    setScanMessage(elapsedMs > CONTAINER_RETRY_NOTICE_MS
      ? "Verify failed. Manual entry is available while the scanner keeps looking."
      : "Verify failed. Keeping scanner open.");

    if (elapsedMs > CONTAINER_RETRY_NOTICE_MS && !failureLoggedRef.current) {
      failureLoggedRef.current = true;
      emitScanTelemetry({
        event: "scan-failed",
        scanMode,
        rejectedCandidates: rejectedCandidatesRef.current,
        rejectedRegions: rejectedRegionsRef.current,
        attemptCount,
        elapsedMs,
        fallbackUsed: rejectedRegionsRef.current.some((region) => region.name === "full-frame-paper-fallback"),
        faceDetected: true,
        tags: ["container-scanner", "iso6346", "scan-failed", "improvement-pass"],
      });
    }

    return false;
  }, [emitScanTelemetry, getScanCandidates, handleScanValue, scanMode, validateScan]);

  useEffect(() => {
    if (!open) {
      stopStream();
      setError(null);
      setDetected(null);
      setPendingScan(null);
      setScanMessage(null);
      setActiveScanRegion(null);
      pendingScanRef.current = null;
      ocrBusyRef.current = false;
      scanStartedAtRef.current = 0;
      attemptCountRef.current = 0;
      rejectedCandidatesRef.current = [];
      rejectedRegionsRef.current = [];
      failureLoggedRef.current = false;
      pendingContainerSuccessRef.current = null;
      if (acceptTimerRef.current != null) {
        clearTimeout(acceptTimerRef.current);
        acceptTimerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    scanStartedAtRef.current = Date.now();

    async function start() {
      const containerMode = scanMode === "containerNumber";
      const BarcodeDetectorCtor = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
      const TextDetectorCtor = (window as Window & { TextDetector?: TextDetectorConstructor }).TextDetector;
      const supportsBarcode = !containerMode && Boolean(BarcodeDetectorCtor);
      const supportsText = enableTextRecognition && !containerMode && Boolean(TextDetectorCtor);
      const supportsOcrFallback = enableTextRecognition && typeof document !== "undefined";
      if (!supportsBarcode && !supportsText && !supportsOcrFallback) {
        setError(enableTextRecognition
          ? "Live scanning or text recognition is not available on this device. Type the code manually instead."
          : "Live scanning requires Chrome on Android or Safari 17+. Type the code manually instead.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (supportsBarcode) {
          let formats = BARCODE_FORMATS;
          try {
            const supported = await BarcodeDetectorCtor?.getSupportedFormats?.();
            if (supported) formats = BARCODE_FORMATS.filter((format) => supported.includes(format));
          } catch {
            // getSupportedFormats is not implemented everywhere.
          }
          if (BarcodeDetectorCtor) {
            detectorRef.current = new BarcodeDetectorCtor({ formats: formats.length ? formats : BARCODE_FORMATS });
          }
        }
        if (supportsText && TextDetectorCtor) {
          textDetectorRef.current = new TextDetectorCtor();
        }

        const scan = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = detectorRef.current
              ? await detectorRef.current.detect(videoRef.current)
              : [];
            if (codes.length > 0) {
              if (cancelled) return;
              if (handleScanValue(codes[0].rawValue, "barcode")) return;
            }

            const now = Date.now();
            if (textDetectorRef.current && now - lastTextScanRef.current > 750) {
              lastTextScanRef.current = now;
              const detectedText = await textDetectorRef.current.detect(videoRef.current);
              const ocrValue = detectedText.map((item) => item.rawValue ?? item.text ?? "").filter(Boolean).join(" ");
              if (ocrValue && !cancelled && handleScanValue(ocrValue, "text")) return;
            } else if (containerMode && supportsOcrFallback && !ocrBusyRef.current && now - lastTextScanRef.current > OCR_SCAN_INTERVAL_MS) {
              lastTextScanRef.current = now;
              ocrBusyRef.current = true;
              runContainerOcrPass(videoRef.current)
                .catch(() => {
                  if (!cancelled) setScanMessage("Verify failed. Keeping scanner open.");
                })
                .finally(() => {
                  ocrBusyRef.current = false;
                });
            } else if (!textDetectorRef.current && supportsOcrFallback && !ocrBusyRef.current && now - lastTextScanRef.current > OCR_SCAN_INTERVAL_MS) {
              lastTextScanRef.current = now;
              ocrBusyRef.current = true;
              setScanMessage("Capturing image and reading container text...");
              recognizeTextFromVideo(videoRef.current)
                .then((text) => {
                  if (!cancelled && text.trim()) handleScanValue(text, "ocr");
                })
                .catch(() => {
                  if (!cancelled) setScanMessage("Text was not clear enough. Keep the container number centered.");
                })
                .finally(() => {
                  ocrBusyRef.current = false;
                });
            }
          } catch {
            // Frame not ready yet; keep scanning.
          }
          rafRef.current = requestAnimationFrame(scan);
        };
        rafRef.current = requestAnimationFrame(scan);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg.includes("Permission") || msg.includes("permission")
            ? "Camera permission denied. Please allow camera access and try again."
            : `Camera error: ${msg}`);
        }
      }
    }

    start();
    return () => {
      cancelled = true;
      stopStream();
      if (acceptTimerRef.current != null) {
        clearTimeout(acceptTimerRef.current);
        acceptTimerRef.current = null;
      }
    };
  }, [enableTextRecognition, handleScanValue, open, runContainerOcrPass, scanMode, stopStream]);

  const activeRegionStyle = activeScanRegion && scanMode === "containerNumber"
    ? {
      left: `${activeScanRegion.x * 100}%`,
      top: `${activeScanRegion.y * 100}%`,
      width: `${activeScanRegion.width * 100}%`,
      height: `${activeScanRegion.height * 100}%`,
    }
    : undefined;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={buttonLabel ? "default" : "icon"}
        className={cn("h-10 shrink-0", buttonLabel ? "px-3" : "w-10", className)}
        title={title}
        disabled={disabled}
        onClick={() => updateOpen(true)}
        aria-label={title}
      >
        <Camera className="h-4 w-4" />
        {buttonLabel ? <span>{buttonLabel}</span> : null}
      </Button>

      <Dialog open={open} onOpenChange={updateOpen}>
        <DialogContent className="p-4 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">{title}</DialogTitle>
            <DialogDescription className="sr-only">
              {statusText ?? (enableTextRecognition ? "Use the camera to scan a barcode, QR code, or readable text." : "Use the camera to scan a barcode or QR code.")}
            </DialogDescription>
          </DialogHeader>

          {detected ? (
            <div className="rounded-md bg-green-50 p-4 text-center dark:bg-green-950/30">
              <p className="mb-1 text-xs text-green-600 dark:text-green-400">Scanned</p>
              <p className="break-all font-mono text-lg font-semibold text-green-800 dark:text-green-200">{detected}</p>
            </div>
          ) : error ? (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          ) : (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
              <video
                ref={videoRef}
                className="h-full w-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <div className={cn(
                "pointer-events-none absolute inset-0",
                !activeRegionStyle && "flex items-center justify-center",
              )}>
                <div className={cn("relative", !activeRegionStyle && "h-36 w-64")} style={activeRegionStyle}>
                  <div className={cn(
                    "absolute inset-0 rounded shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]",
                    pendingScan && "shadow-[0_0_0_9999px_rgba(22,163,74,0.25)]",
                  )} />
                  <div className={cn("absolute left-0 top-0 h-6 w-6 rounded-tl border-l-2 border-t-2 border-white", pendingScan && "border-green-400")} />
                  <div className={cn("absolute right-0 top-0 h-6 w-6 rounded-tr border-r-2 border-t-2 border-white", pendingScan && "border-green-400")} />
                  <div className={cn("absolute bottom-0 left-0 h-6 w-6 rounded-bl border-b-2 border-l-2 border-white", pendingScan && "border-green-400")} />
                  <div className={cn("absolute bottom-0 right-0 h-6 w-6 rounded-br border-b-2 border-r-2 border-white", pendingScan && "border-green-400")} />
                </div>
              </div>
              {pendingScan && (
                <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-black/75 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-green-300">{scanMode === "containerNumber" ? "Verify true" : "Valid text recognized"}</p>
                    <p className="break-all font-mono text-sm font-semibold text-white">{pendingScan.value}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-8 shrink-0 gap-1.5 bg-green-600 text-white hover:bg-green-700"
                    onClick={() => {
                      if (acceptTimerRef.current != null) {
                        clearTimeout(acceptTimerRef.current);
                        acceptTimerRef.current = null;
                      }
                      acceptScan(pendingScan.value);
                    }}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Use
                  </Button>
                </div>
              )}
            </div>
          )}

          <p className={cn("text-center text-xs", scanMessage && !pendingScan ? "text-amber-500" : "text-muted-foreground")}>
            {detected ? "Loading..." : scanMessage ?? statusText ?? (enableTextRecognition ? "Point your camera at a QR code, barcode, or container number" : "Point your camera at a barcode or QR code")}
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
