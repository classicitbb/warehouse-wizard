import { useCallback, useEffect, useRef, useState, type RefObject, type ReactNode } from "react";
import { Camera, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { getLearnedContainerScanRegion, recordContainerScannerSuccess, type ContainerScannerSuccessSample } from "@/lib/container-scanner-learning";
import { clampRegion, getContainerScanRegions, scanRegionToPixels, type NormalizedScanRegion } from "@/lib/container-scanner-regions";
import { updateScanDwell, type ScanDwellState } from "@/lib/scan-dwell";
import { getScanDwellMs, isWithinScanCooldown } from "@/lib/scan-settings";
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
  footerAction?: {
    label: string;
    icon?: ReactNode;
    onClick: () => void;
  };
  /** After scan is accepted, simulate Enter keydown on this input to advance focus. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

type PendingScan = {
  raw: string;
  value: string;
  message?: string;
  region?: NormalizedScanRegion;
  source: "barcode" | "text" | "ocr";
};

type DetectionPoint = { x: number; y: number };
type DetectionBounds = { x: number; y: number; width: number; height: number };
type DetectedBarcode = { rawValue: string; boundingBox?: DetectionBounds; cornerPoints?: DetectionPoint[] };
type BarcodeDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]> };
type BarcodeDetectorConstructor = {
  new(options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};
type DetectedTextBlock = { rawValue?: string; text?: string; boundingBox?: DetectionBounds; cornerPoints?: DetectionPoint[] };
type TextDetectorLike = { detect: (source: HTMLVideoElement) => Promise<DetectedTextBlock[]> };
type TextDetectorConstructor = { new(): TextDetectorLike };

const BARCODE_FORMATS = [
  "qr_code", "code_128", "code_39", "code_93",
  "ean_13", "ean_8", "upc_a", "upc_e",
  "data_matrix", "pdf417", "aztec",
];

const OCR_SCAN_INTERVAL_MS = 1800;
const CONTAINER_RETRY_NOTICE_MS = 5000;
const BARCODE_PREVIEW_DELAY_MS = 450;
const TEXT_PREVIEW_DELAY_MS = 1500;
/** Local OCR passes to complete before asking the AI vision helper for a read. */
const CONTAINER_AI_AFTER_ATTEMPTS = 1;
/** Minimum gap between AI vision calls while the scanner stays open. */
const CONTAINER_AI_INTERVAL_MS = 6000;

function captureFrame(video: HTMLVideoElement) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, width, height);
  try {
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}

/**
 * AI-assisted container read. Returns the container number only when the edge
 * function has re-validated the ISO 6346 check digit server-side.
 */
async function readContainerNumberWithAi(image: string) {
  const { data, error } = await supabase.functions.invoke("container-vision", { body: { image } });
  if (error) return null;
  const value = (data as { containerNumber?: string | null } | null)?.containerNumber;
  return typeof value === "string" && value ? value : null;
}

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

function getDetectedRegion(
  detection: { boundingBox?: DetectionBounds; cornerPoints?: DetectionPoint[] },
  video: HTMLVideoElement,
): NormalizedScanRegion | null {
  const frameWidth = video.videoWidth || video.clientWidth || 0;
  const frameHeight = video.videoHeight || video.clientHeight || 0;
  if (frameWidth <= 0 || frameHeight <= 0) return null;

  const points = detection.cornerPoints?.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ?? [];
  if (points.length > 0) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const left = Math.min(...xs);
    const right = Math.max(...xs);
    const top = Math.min(...ys);
    const bottom = Math.max(...ys);
    if (right > left && bottom > top) {
      return clampRegion({
        name: "detected-code",
        x: left / frameWidth,
        y: top / frameHeight,
        width: (right - left) / frameWidth,
        height: (bottom - top) / frameHeight,
        source: "fallback",
        faceDetected: false,
      });
    }
  }

  const bounds = detection.boundingBox;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  return clampRegion({
    name: "detected-code",
    x: bounds.x / frameWidth,
    y: bounds.y / frameHeight,
    width: bounds.width / frameWidth,
    height: bounds.height / frameHeight,
    source: "fallback",
    faceDetected: false,
  });
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
  footerAction,
  inputRef,
}: BarcodeScanButtonProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detected, setDetected] = useState<string | null>(null);
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [activeScanRegion, setActiveScanRegion] = useState<NormalizedScanRegion | null>(null);
  const [dwellProgress, setDwellProgress] = useState<number | null>(null);
  const pendingScanRef = useRef<PendingScan | null>(null);
  const dwellStateRef = useRef<ScanDwellState>(null);
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
  const aiBusyRef = useRef(false);
  const lastAiCallRef = useRef(0);
  const lastAcceptedRef = useRef<{ value: string; at: number } | null>(null);

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
    lastAcceptedRef.current = { value, at: Date.now() };
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
    if (candidate.valid && candidate.value && isWithinScanCooldown(lastAcceptedRef.current, candidate.value, Date.now())) {
      // Same code re-read straight after a successful scan — ignore it so a
      // double trigger cannot submit the value twice.
      setScanMessage(`Already scanned ${candidate.value} — wait a moment before scanning it again.`);
      return false;
    }
    if (!candidate.valid) {
      if (validateScan || source !== "barcode") {
        setScanMessage(scanMode === "containerNumber"
          ? "Verify failed. Keeping scanner open."
          : candidate.message ?? "No usable scan was found. Keep the code centered and try again.");
      }
      return false;
    }

    if (region) setActiveScanRegion(region);

    const pending = {
      raw: rawValue,
      value: candidate.value,
      message: scanMode === "containerNumber" ? "Verify true" : candidate.message,
      region,
      source,
    };
    if (requireConfirm) {
      pendingScanRef.current = pending;
      setPendingScan(pending);
      setScanMessage(scanMode === "containerNumber" ? "Verify true" : candidate.message ?? "Valid scan recognized. Confirm to insert.");
      stopStream();
      return true;
    }

    pendingScanRef.current = pending;
    setPendingScan(pending);
    setScanMessage(
      scanMode === "containerNumber"
        ? "Verify true"
        : source === "barcode"
          ? candidate.message ?? "Code found. Insert will continue automatically."
          : candidate.message ?? "Text recognized. Insert will continue automatically.",
    );
    stopStream();
    if (acceptTimerRef.current != null) clearTimeout(acceptTimerRef.current);
    acceptTimerRef.current = setTimeout(() => {
      acceptTimerRef.current = null;
      if (pendingScanRef.current?.value === pending.value) {
        acceptScan(pending.value);
      }
    }, source === "barcode" ? BARCODE_PREVIEW_DELAY_MS : TEXT_PREVIEW_DELAY_MS);
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

    // AI-assisted fallback: local OCR could not produce a check-digit-valid
    // code, so send one frame to the vision helper. Failures are silent — the
    // local OCR loop keeps running exactly as before.
    const now = Date.now();
    if (
      attemptCount >= CONTAINER_AI_AFTER_ATTEMPTS &&
      !aiBusyRef.current &&
      now - lastAiCallRef.current > CONTAINER_AI_INTERVAL_MS
    ) {
      const frame = captureFrame(video);
      if (frame) {
        aiBusyRef.current = true;
        lastAiCallRef.current = now;
        setScanMessage("Reading container with AI…");
        try {
          const aiValue = await readContainerNumberWithAi(frame);
          if (aiValue) {
            pendingContainerSuccessRef.current = null;
            emitScanTelemetry({
              event: "scan-success",
              scanMode,
              value: aiValue,
              rejectedCandidates: rejectedCandidatesRef.current,
              rejectedRegions: rejectedRegionsRef.current,
              attemptCount,
              elapsedMs: Date.now() - scanStartedAtRef.current,
              fallbackUsed: true,
              faceDetected: true,
              tags: ["container-scanner", "iso6346", "scan-success", "ai-vision"],
            });
            return handleScanValue(aiValue, "ocr");
          }
          setScanMessage("AI could not read the container number. Keeping scanner open.");
        } catch {
          // Offline, rate-limited, or function error — stay on local OCR.
        } finally {
          aiBusyRef.current = false;
        }
      }
    }

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
      dwellStateRef.current = null;
      setDwellProgress(null);
      ocrBusyRef.current = false;
      scanStartedAtRef.current = 0;
      attemptCountRef.current = 0;
      rejectedCandidatesRef.current = [];
      rejectedRegionsRef.current = [];
      failureLoggedRef.current = false;
      aiBusyRef.current = false;
      lastAiCallRef.current = 0;
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
              const detectedCode = codes[0];
              // Dwell is configurable per device in Settings > Environment (default 0 = instant).
              const dwell = updateScanDwell(dwellStateRef.current, detectedCode.rawValue, Date.now(), getScanDwellMs());
              dwellStateRef.current = dwell.state;
              setDwellProgress(dwell.progress);
              if (!dwell.ready) {
                rafRef.current = requestAnimationFrame(scan);
                return;
              }
              setDwellProgress(null);
              const detectedRegion = getDetectedRegion(detectedCode, videoRef.current);
              if (handleScanValue(detectedCode.rawValue, "barcode", detectedRegion ?? undefined)) return;
            } else if (dwellStateRef.current) {
              dwellStateRef.current = null;
              setDwellProgress(null);
            }

            const now = Date.now();
            if (textDetectorRef.current && now - lastTextScanRef.current > 750) {
              lastTextScanRef.current = now;
              const detectedText = await textDetectorRef.current.detect(videoRef.current);
              const detectedBlock = detectedText.find((item) => Boolean((item.rawValue ?? item.text ?? "").trim()));
              const ocrValue = detectedText.map((item) => item.rawValue ?? item.text ?? "").filter(Boolean).join(" ");
              const detectedRegion = detectedBlock ? getDetectedRegion(detectedBlock, videoRef.current) : null;
              if (ocrValue && !cancelled && handleScanValue(ocrValue, "text", detectedRegion ?? undefined)) return;
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

  const activeRegionStyle = activeScanRegion
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
                <div
                  className={cn(
                    "relative transition-all duration-200 ease-out",
                    !activeRegionStyle && (scanMode === "containerNumber" ? "h-[82%] aspect-[3/4]" : "h-[68%] aspect-square"),
                  )}
                  style={activeRegionStyle}
                >
                  <div className={cn(
                    "absolute inset-0 rounded border border-white/20 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-all duration-200 ease-out",
                    pendingScan && "shadow-[0_0_0_9999px_rgba(22,163,74,0.25)]",
                  )} />
                  <div className={cn("absolute left-0 top-0 h-6 w-6 rounded-tl border-l-2 border-t-2 border-white transition-colors duration-150", pendingScan ? "border-green-400" : dwellProgress != null && "border-amber-400")} />
                  <div className={cn("absolute right-0 top-0 h-6 w-6 rounded-tr border-r-2 border-t-2 border-white transition-colors duration-150", pendingScan ? "border-green-400" : dwellProgress != null && "border-amber-400")} />
                  <div className={cn("absolute bottom-0 left-0 h-6 w-6 rounded-bl border-b-2 border-l-2 border-white transition-colors duration-150", pendingScan ? "border-green-400" : dwellProgress != null && "border-amber-400")} />
                  <div className={cn("absolute bottom-0 right-0 h-6 w-6 rounded-br border-b-2 border-r-2 border-white transition-colors duration-150", pendingScan ? "border-green-400" : dwellProgress != null && "border-amber-400")} />
                </div>
              </div>
              {dwellProgress != null && !pendingScan && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/75 px-3 py-2">
                  <p className="mb-1 text-xs font-medium text-amber-300">Hold steady…</p>
                  <div className="h-1.5 w-full overflow-hidden rounded bg-white/20">
                    <div
                      className="h-full bg-amber-400 transition-[width] duration-100"
                      style={{ width: `${Math.round(dwellProgress * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {pendingScan && (
                <div className="absolute bottom-0 left-0 right-0 flex items-center gap-2 bg-black/75 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-green-300">
                      {scanMode === "containerNumber" ? "Verify true" : pendingScan.source === "barcode" ? "Code found" : "Text recognized"}
                    </p>
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
          {footerAction ? (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center"
              onClick={() => {
                updateOpen(false);
                footerAction.onClick();
              }}
            >
              {footerAction.icon}
              {footerAction.label}
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
