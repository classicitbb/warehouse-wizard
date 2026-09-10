// pallet-stack-preview.tsx — the isometric pallet render.
//
// Presentational only: it takes a spec, calls buildPalletStackGeometry, and
// maps quads to <polygon>. No queries, no form state, no callbacks. All the
// arithmetic lives in src/lib/pallet-geometry.ts so it can be asserted as
// numbers rather than through a render.
//
// Inline SVG rather than a 3D library, as ratified: this runs on the same
// cheap Android scanners as the rest of the floor UI, has to survive the print
// path, and has to render inside a Sheet on a five-inch screen. WebGL would
// buy rotation the operator does not need for roughly half a megabyte.

import { useMemo } from "react";

import {
  buildPalletStackGeometry,
  describeStackConformance,
  describeStackFit,
  type PalletStackSpec,
  type QuadFace,
  type QuadKind,
} from "@/lib/pallet-geometry";
import { formatPackCode } from "@/lib/measure";
import { cn } from "@/lib/utils";

/**
 * Face shading is opacity on one hue, never a second colour token — AGENTS.md
 * locks the palette in src/index.css and forbids adding to it.
 *
 * Two rules, both learned from the render looking like one solid block:
 *
 *  - The spread has to be wide. Three faces within a narrow opacity band read
 *    as a slab, and the point of the render is seeing individual cartons.
 *  - The lit top face is fully opaque. Translucent cargo lets the back of the
 *    stack show through the front, which turns a pallet into a wireframe.
 *
 * Carton edges are therefore drawn in the page background rather than the
 * cargo hue: a same-hue outline is invisible against an opaque fill, and dark
 * grout lines between cases is how a real stack reads at a glance.
 */
const FACE_OPACITY: Record<QuadFace, number> = { top: 1, right: 0.66, left: 0.42 };

const KIND_FILL: Record<QuadKind, string | null> = {
  // Timber, not filler: the deck and blocks are drawn in the warning (orange)
  // token so the pallet under the cargo reads as a pallet rather than as
  // ghosted-out background.
  "pallet-block": "hsl(var(--warning))",
  "pallet-deck": "hsl(var(--warning))",
  full: "hsl(var(--primary))",
  slab: "hsl(var(--primary))",
  part: "hsl(var(--accent))",
  ghost: null,
};

const KIND_STROKE: Record<QuadKind, string> = {
  "pallet-block": "hsl(var(--background))",
  "pallet-deck": "hsl(var(--background))",
  full: "hsl(var(--background))",
  slab: "hsl(var(--background))",
  part: "hsl(var(--background))",
  // Ghost boxes have no fill, so their outline is the only thing drawn.
  ghost: "hsl(var(--muted-foreground))",
};

const PALLET_KINDS: ReadonlySet<QuadKind> = new Set<QuadKind>(["pallet-block", "pallet-deck"]);

const LABEL_FILL = {
  muted: "hsl(var(--muted-foreground))",
  primary: "hsl(var(--primary))",
  warning: "hsl(var(--warning))",
  destructive: "hsl(var(--destructive))",
} as const;

export interface PalletStackPreviewProps {
  spec: PalletStackSpec;
  className?: string;
  showCeilings?: boolean;
  showLayerBracket?: boolean;
  /** Overrides the generated description. Prefer letting it derive. */
  ariaLabel?: string;
}

export function PalletStackPreview({
  spec,
  className,
  showCeilings = true,
  showLayerBracket = true,
  ariaLabel,
}: PalletStackPreviewProps) {
  const geometry = useMemo(() => buildPalletStackGeometry(spec), [spec]);
  const { quads, guides, labels, rules, viewBox, metrics } = geometry;

  const packCode = formatPackCode({
    packages_per_layer: metrics.packagesPerLayer,
    layers_per_pallet: metrics.layersPerPallet,
  });

  // The accessible description is the whole feature for a screen reader, so it
  // carries the same three facts the sighted reader gets from the picture.
  const description = ariaLabel
    ?? [
      packCode ? `Pallet build ${packCode}.` : "No pack standard set.",
      describeStackConformance(metrics),
      describeStackFit(metrics),
    ].join(" ");

  if (quads.length === 0) {
    return (
      <div
        className={cn(
          "flex min-h-[220px] items-center justify-center rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground",
          className,
        )}
        role="img"
        aria-label="No pallet build to preview yet — set cases per layer, layers, and carton height."
      >
        Set cases per layer, layers, and carton height to preview the build.
      </div>
    );
  }

  const bracketKeys = new Set(["layer-count", "layer-caption"]);
  const visibleLabels = showLayerBracket ? labels : labels.filter((label) => !bracketKeys.has(label.key));
  const visibleRules = showLayerBracket ? rules : [];
  const visibleGuides = showCeilings ? guides : guides.filter((guide) => !guide.kind.endsWith("ceiling"));

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={description}
      className={cn("h-auto w-full max-w-full", className)}
    >
      <title>{packCode ? `Pallet build ${packCode}` : "Pallet build"}</title>
      <desc>{description}</desc>

      {quads.map((quad) => {
        const fill = KIND_FILL[quad.kind];
        const isPallet = PALLET_KINDS.has(quad.kind);
        return (
          <polygon
            key={quad.key}
            points={quad.points}
            fill={fill ?? "none"}
            fillOpacity={fill ? FACE_OPACITY[quad.face] * (isPallet ? 0.35 : 1) : 0}
            stroke={KIND_STROKE[quad.kind]}
            strokeOpacity={quad.kind === "ghost" ? 0.6 : 1}
            strokeWidth={quad.kind === "ghost" ? 1 : 1.25}
            strokeDasharray={quad.kind === "ghost" ? "4 3" : undefined}
            strokeLinejoin="round"
            // The viewBox is far taller than the box it renders into, so the
            // whole scene is scaled to roughly 40%. Without this the carton
            // outlines land on half a pixel and the stack reads as one slab.
            vectorEffect="non-scaling-stroke"
          />
        );
      })}

      {visibleGuides.map((guide) => (
        <polygon
          key={guide.key}
          points={guide.points}
          fill="none"
          stroke={guide.exceeded ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"}
          strokeWidth={guide.exceeded ? 2 : 1.25}
          strokeDasharray={guide.kind === "space-allowance" ? "5 4" : "8 5"}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {visibleRules.map((rule) => (
        <line
          key={rule.key}
          x1={rule.x1.toFixed(1)}
          y1={rule.y1.toFixed(1)}
          x2={rule.x2.toFixed(1)}
          y2={rule.y2.toFixed(1)}
          stroke={rule.tone === "primary" ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
        />
      ))}

      {visibleLabels.map((label) => (
        <text
          key={label.key}
          x={label.x.toFixed(1)}
          y={label.y.toFixed(1)}
          textAnchor={label.anchor}
          dominantBaseline="middle"
          fill={LABEL_FILL[label.tone]}
          fontSize={label.size.toFixed(1)}
          fontWeight={600}
          fontFamily="var(--font-mono, 'IBM Plex Mono', monospace)"
        >
          {label.text}
        </text>
      ))}
    </svg>
  );
}

export default PalletStackPreview;
