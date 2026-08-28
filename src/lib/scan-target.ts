// Geometry helpers for the live scanner target ("reticle").
//
// A decoded code is only captured when it sits inside the target square that is
// drawn over the camera preview. Codes seen outside the square are recognised
// (the reticle glows green) but never read.

export type ScanRect = { x: number; y: number; width: number; height: number };

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/**
 * Normalized (0..1) rectangle of the on-screen scan target.
 *
 * `frameAspect` is the camera preview's width/height ratio. The reticle is sized
 * relative to the preview height, so its normalized width depends on that ratio.
 */
export function getScanTargetRect(
  scanMode: string,
  frameAspect = 16 / 9,
  activeRegion?: ScanRect | null,
): ScanRect {
  if (activeRegion) {
    return {
      x: clamp(activeRegion.x),
      y: clamp(activeRegion.y),
      width: clamp(activeRegion.width, 0.02, 1),
      height: clamp(activeRegion.height, 0.02, 1),
    };
  }

  const isContainer = scanMode === "containerNumber";
  const height = isContainer ? 0.82 : 0.68;
  const boxAspect = isContainer ? 3 / 4 : 1; // width / height, in preview pixels
  const aspect = frameAspect > 0 ? frameAspect : 16 / 9;
  const width = clamp((height * boxAspect) / aspect, 0.05, 1);

  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
}

/**
 * True when the detected code lies inside the target area. A small tolerance
 * (fraction of the target size) keeps borderline reads usable.
 */
export function isRegionInsideTarget(
  region: ScanRect | null | undefined,
  target: ScanRect,
  tolerance = 0.08,
): boolean {
  // Without bounds we cannot tell where the code is; accept it rather than
  // blocking scanning on detectors that report no geometry.
  if (!region || !Number.isFinite(region.width) || !Number.isFinite(region.height)) return true;
  if (region.width <= 0 || region.height <= 0) return true;

  const padX = target.width * tolerance;
  const padY = target.height * tolerance;
  const left = target.x - padX;
  const top = target.y - padY;
  const right = target.x + target.width + padX;
  const bottom = target.y + target.height + padY;

  return (
    region.x >= left &&
    region.y >= top &&
    region.x + region.width <= right &&
    region.y + region.height <= bottom
  );
}
