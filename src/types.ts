// ─────────────────────────────────────────────────────────────
// RoomTint — Shared Types
// ─────────────────────────────────────────────────────────────

/** One wall region returned from /api/pro-detect */
export interface WallRegion {
  id: string;           // e.g. "region_0"
  type: "wall" | "floor" | "ceiling" | string;
  mask: string;         // base64-encoded PNG (white = region)
}

/** Decoded mask ready for Canvas rendering */
export interface DecodedMask {
  id: string;
  type: string;
  imageData: ImageData;     // raw pixel data at NATIVE resolution for hit-testing
  bitmap: ImageBitmap;      // GPU-accelerated bitmap (feathered, native res)
  bounds: MaskBounds;       // bounding box in native pixel coords
  naturalWidth: number;     // mask's intrinsic pixel width
  naturalHeight: number;    // mask's intrinsic pixel height
}

export interface MaskBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-wall color assignment */
export type WallColors = Record<string, string>; // maskId → hex color

/** Full wall selection state */
export interface WallSelectionState {
  hoveredMaskId: string | null;
  selectedMaskIds: Set<string>;
  wallColors: WallColors;
}

/** Zoom/pan transform */
export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Canvas render options */
export interface RenderOptions {
  hoverOpacity: number;
  selectedOpacity: number;
  hoverColor: string;
  selectedColor: string;
  glowBlur: number;
  /** Blend mode for selected wall overlay */
  blendMode: GlobalCompositeOperation;
}

export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  hoverOpacity: 0.35,
  selectedOpacity: 0.60,
  hoverColor: "rgba(255,255,255,0.85)",
  selectedColor: "rgba(99,179,255,1)",
  glowBlur: 18,
  blendMode: "multiply",
};
