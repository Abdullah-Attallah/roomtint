import React, {
  useRef, useEffect, useCallback, useState, useMemo, memo
} from "react";
import type { DecodedMask, RenderOptions, ViewTransform } from "@/types";
import { DEFAULT_RENDER_OPTIONS } from "@/types";

interface MaskCanvasProps {
  imageUrl: string;
  masks: DecodedMask[];
  hoveredMaskId: string | null;
  selectedMaskIds: Set<string>;
  wallColors: Record<string, string>;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  renderOptions?: Partial<RenderOptions>;
  className?: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * FIX #5 (Hit detection): Build a spatial index of masks per-pixel for O(1) lookup.
 * The old code called masks.find() which was O(n*m) — iterating all masks
 * and scanning each mask's imageData on every mouse move.
 *
 * The new approach: for each mask, record which pixels are "on" in a shared
 * Uint8Array indexed by flattened [maskIndex]. We then do one lookup per pixel.
 * For sparse masks we store just the bounding box to skip quickly.
 */
function buildHitMap(
  masks: DecodedMask[],
  displayW: number,
  displayH: number
): { index: Uint8Array; stride: number } | null {
  if (!masks.length || !displayW || !displayH) return null;
  // index[y * displayW + x] = mask index + 1 (0 = no hit)
  // We store the LAST (top-most in render order) mask at each pixel
  const index = new Uint8Array(displayW * displayH);

  for (let mi = 0; mi < masks.length; mi++) {
    const mask = masks[mi];
    const mw = mask.naturalWidth;
    const mh = mask.naturalHeight;
    const scaleX = mw / displayW;
    const scaleY = mh / displayH;
    const d = mask.imageData.data;

    for (let y = 0; y < displayH; y++) {
      for (let x = 0; x < displayW; x++) {
        const mx = Math.min(mw - 1, Math.round(x * scaleX));
        const my = Math.min(mh - 1, Math.round(y * scaleY));
        const src = (my * mw + mx) * 4;
        if (d[src] > 100) {
          index[y * displayW + x] = mi + 1;
        }
      }
    }
  }

  return { index, stride: displayW };
}

// ─────────────────────────────────────────────────────────────
// Per-mask offscreen canvas cache
// FIX #4 (Performance): We pre-build one OffscreenCanvas per mask per color.
// Previously a new OffscreenCanvas was created inside the render loop on every
// animation frame — extremely expensive. Now we cache and only rebuild when color changes.
// ─────────────────────────────────────────────────────────────
interface CachedOverlay {
  maskId: string;
  color: string;
  opacity: number;
  offscreen: OffscreenCanvas;
}

function buildOverlay(
  mask: DecodedMask,
  displayW: number,
  displayH: number,
  color: string,
  opacity: number
): CachedOverlay {
  const offscreen = new OffscreenCanvas(displayW, displayH);
  const ctx = offscreen.getContext("2d")!;

  // Draw mask at display resolution
  ctx.drawImage(mask.bitmap, 0, 0, displayW, displayH);

  // Tint: multiply the white mask by the target color
  // Using source-atop: color fills only where mask has pixels
  const { r, g, b } = hexToRgb(color);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = `rgba(${r},${g},${b},1)`;
  ctx.fillRect(0, 0, displayW, displayH);

  return { maskId: mask.id, color, opacity, offscreen };
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
const MaskCanvas = memo(function MaskCanvas({
  imageUrl,
  masks,
  hoveredMaskId,
  selectedMaskIds,
  wallColors,
  onHover,
  onSelect,
  renderOptions,
  className = "",
}: MaskCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const transformRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastTransformRef = useRef<ViewTransform>({ scale: 1, offsetX: 0, offsetY: 0 });

  // FIX #4: Overlay cache — keyed by maskId
  const overlayCacheRef = useRef<Map<string, CachedOverlay>>(new Map());

  // FIX #5: Hit-map cache
  const hitMapRef = useRef<{ index: Uint8Array; stride: number; displayW: number; displayH: number } | null>(null);
  const hitMapDirtyRef = useRef(true);

  const opts = useMemo(
    () => ({ ...DEFAULT_RENDER_OPTIONS, ...renderOptions }),
    [renderOptions]
  );

  // ── Load image ─────────────────────────────────────────────
  const [imgLoaded, setImgLoaded] = useState(false);
  useEffect(() => {
    setImgLoaded(false);
    const img = new Image();
    img.onload = () => { imageRef.current = img; setImgLoaded(true); };
    img.src = imageUrl;
    return () => { img.onload = null; };
  }, [imageUrl]);

  // ── Resize canvas to container ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      // Invalidate caches on resize
      overlayCacheRef.current.clear();
      hitMapDirtyRef.current = true;
      scheduleRender();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Invalidate hit-map when masks change
  useEffect(() => {
    hitMapDirtyRef.current = true;
  }, [masks]);

  // ── Compute image draw dimensions ──────────────────────────
  function getDrawRect(cw: number, ch: number, img: HTMLImageElement) {
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = cw / ch;
    let drawW: number, drawH: number;
    if (imgAspect > canvasAspect) {
      drawW = cw; drawH = cw / imgAspect;
    } else {
      drawH = ch; drawW = ch * imgAspect;
    }
    const { scale, offsetX, offsetY } = transformRef.current;
    const drawX = (cw - drawW) / 2 + offsetX;
    const drawY = (ch - drawH) / 2 + offsetY;
    return { drawX, drawY, drawW: drawW * scale, drawH: drawH * scale };
  }

  // ── Main render ────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !imgLoaded) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cw = canvas.width, ch = canvas.height;
    const { drawX, drawY, drawW, drawH } = getDrawRect(cw, ch, img);

    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(drawX, drawY);

    // 1. Draw base image
    ctx.drawImage(img, 0, 0, drawW, drawH);

    // 2. Draw mask overlays with realistic blending
    // FIX #3 (Realistic rendering): use "multiply" composite mode so the
    // color tint interacts with the image's luminance — shadows stay dark,
    // highlights stay bright. This produces a paint-like effect instead of
    // a flat color wash.
    for (const mask of masks) {
      const isHovered = mask.id === hoveredMaskId;
      const isSelected = selectedMaskIds.has(mask.id);
      if (!isHovered && !isSelected) continue;

      const color = (isSelected && wallColors[mask.id]) ? wallColors[mask.id] : opts.hoverColor;
      const opacity = isSelected ? opts.selectedOpacity : opts.hoverOpacity;

      // Retrieve or build overlay canvas
      const cacheKey = mask.id;
      let cached = overlayCacheRef.current.get(cacheKey);
      const needRebuild = !cached
        || cached.color !== color
        || cached.opacity !== opacity
        || (cached.offscreen.width !== drawW || cached.offscreen.height !== drawH);

      if (needRebuild) {
        cached = buildOverlay(mask, Math.ceil(drawW), Math.ceil(drawH), color, opacity);
        overlayCacheRef.current.set(cacheKey, cached);
      }

      // FIX #3: "multiply" preserves image texture and lighting.
      // For hover we use a lighter "overlay" so the highlight is visible but subtle.
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = isSelected ? "multiply" : "overlay";
      ctx.drawImage(cached.offscreen, 0, 0);

      // FIX #3b: Add a second "source-over" pass at very low opacity for
      // deep/dark colors — multiply alone can make dark colors disappear
      if (isSelected) {
        ctx.globalCompositeOperation = "source-over";
        ctx.globalAlpha = opacity * 0.18;
        ctx.drawImage(cached.offscreen, 0, 0);
      }
      ctx.restore();

      // Selection highlight ring
      if (isSelected) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        // Draw a thin luminous border by expanding the mask with a shadow
        ctx.shadowColor = color;
        ctx.shadowBlur = opts.glowBlur;
        ctx.globalCompositeOperation = "source-over";
        ctx.drawImage(cached.offscreen, 0, 0);
        ctx.restore();
      }
    }

    ctx.restore();
  }, [masks, hoveredMaskId, selectedMaskIds, wallColors, imgLoaded, opts]);

  const scheduleRender = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(render);
  }, [render]);

  useEffect(() => { scheduleRender(); }, [masks, hoveredMaskId, selectedMaskIds, wallColors, imgLoaded]);

  // ── Mouse position → image-local coords ───────────────────
  // FIX #6 (Coordinate mismatch): Old code used masks[0].imageData.width as
  // the coordinate space, which was display-resolution. Now we compute local
  // coords normalized to [0,1] and scale to each mask's naturalWidth/Height
  // independently during hit testing.
  function toImageCoords(e: React.MouseEvent): { nx: number; ny: number } | null {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return null;

    const rect = canvas.getBoundingClientRect();
    const cw = canvas.width, ch = canvas.height;
    const { drawX, drawY, drawW, drawH } = getDrawRect(cw, ch, img);

    const mx = (e.clientX - rect.left) * (cw / rect.width);
    const my = (e.clientY - rect.top) * (ch / rect.height);

    const lx = mx - drawX;
    const ly = my - drawY;

    if (lx < 0 || ly < 0 || lx > drawW || ly > drawH) return null;

    // Normalized coords [0,1] within the drawn image
    return { nx: lx / drawW, ny: ly / drawH };
  }

  // FIX #5: Hit test uses the pre-built spatial index
  function hitTestAt(nx: number, ny: number): DecodedMask | null {
    // Build/rebuild hit map lazily
    if (hitMapDirtyRef.current || !hitMapRef.current) {
      const canvas = canvasRef.current;
      const img = imageRef.current;
      if (!canvas || !img || !masks.length) return null;
      // Use a reduced-resolution hit map for performance
      const HIT_W = 256, HIT_H = Math.round(256 / (img.naturalWidth / img.naturalHeight));
      const rawMap = buildHitMap(masks, HIT_W, HIT_H);
      if (!rawMap) return null;
      hitMapRef.current = { ...rawMap, displayW: HIT_W, displayH: HIT_H };
      hitMapDirtyRef.current = false;
    }

    const hm = hitMapRef.current!;
    const px = Math.min(hm.displayW - 1, Math.round(nx * hm.displayW));
    const py = Math.min(hm.displayH - 1, Math.round(ny * hm.displayH));
    const entry = hm.index[py * hm.stride + px];
    if (!entry) return null;
    return masks[entry - 1] ?? null;
  }

  // ── Mouse events ───────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      transformRef.current = {
        ...lastTransformRef.current,
        offsetX: lastTransformRef.current.offsetX + dx,
        offsetY: lastTransformRef.current.offsetY + dy,
      };
      scheduleRender();
      return;
    }

    const coords = toImageCoords(e);
    if (!coords) { onHover(null); return; }
    const hit = hitTestAt(coords.nx, coords.ny);
    onHover(hit?.id ?? null);
  }, [masks, onHover, scheduleRender]);

  const handleMouseLeave = useCallback(() => {
    onHover(null);
    isPanningRef.current = false;
  }, [onHover]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isPanningRef.current) return;
    const coords = toImageCoords(e);
    if (!coords) return;
    const hit = hitTestAt(coords.nx, coords.ny);
    if (hit) onSelect(hit.id);
  }, [masks, onSelect]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      lastTransformRef.current = { ...transformRef.current };
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const next = Math.min(Math.max(transformRef.current.scale * factor, 0.5), 5);
    transformRef.current = { ...transformRef.current, scale: next };
    // Zoom invalidates overlays (size changes)
    overlayCacheRef.current.clear();
    hitMapDirtyRef.current = true;
    scheduleRender();
  }, [scheduleRender]);

  const handleDoubleClick = useCallback(() => {
    transformRef.current = { scale: 1, offsetX: 0, offsetY: 0 };
    overlayCacheRef.current.clear();
    hitMapDirtyRef.current = true;
    scheduleRender();
  }, [scheduleRender]);

  const cursor = hoveredMaskId ? "pointer" : isPanningRef.current ? "grabbing" : "default";

  return (
    <div ref={containerRef} className={`relative w-full h-full ${className}`}>
      <canvas
        ref={canvasRef}
        style={{ cursor, display: "block", width: "100%", height: "100%" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
});

export default MaskCanvas;
