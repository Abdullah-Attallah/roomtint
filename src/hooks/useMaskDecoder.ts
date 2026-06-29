import { useState, useEffect, useRef } from "react";
import type { WallRegion, DecodedMask, MaskBounds } from "@/types";

/**
 * Decodes base64 PNG mask strings into GPU-ready ImageBitmaps.
 *
 * FIX #4 (Performance): The old version re-decoded all masks whenever
 * displayWidth/Height changed (e.g., on every resize). Now we decode at
 * NATIVE mask resolution once, then scale to display dimensions as a
 * separate lightweight step. The bitmap cache is keyed by region id+mask
 * so only changed masks re-decode.
 *
 * FIX (Scaling): Previously masks were decoded at displayWidth/displayHeight
 * which caused coordinate mismatches when the container resized. Masks are
 * now decoded at their intrinsic resolution. The canvas renderer handles
 * display-space scaling via drawImage.
 */
export function useMaskDecoder(regions: WallRegion[]) {
  const [decoded, setDecoded] = useState<DecodedMask[]>([]);
  const [loading, setLoading] = useState(false);

  // Cache: region.id → { maskHash, result } to skip re-decoding unchanged masks
  const cacheRef = useRef<Map<string, { maskPrefix: string; result: DecodedMask }>>(new Map());

  useEffect(() => {
    if (!regions.length) {
      setDecoded([]);
      return;
    }

    setLoading(true);
    let cancelled = false;

    async function decode() {
      const results: DecodedMask[] = [];

      for (const region of regions) {
        if (cancelled) break;

        // Cache key: first 64 chars of mask data (cheap identity check)
        const maskPrefix = region.mask.slice(0, 64);
        const cached = cacheRef.current.get(region.id);
        if (cached && cached.maskPrefix === maskPrefix) {
          results.push(cached.result);
          continue;
        }

        try {
          const raw = region.mask.includes(",") ? region.mask.split(",")[1] : region.mask;
          const byteStr = atob(raw);
          const bytes = new Uint8Array(byteStr.length);
          for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);
          const blob = new Blob([bytes], { type: "image/png" });

          // Decode at NATIVE resolution — no scaling here
          const srcBitmap = await createImageBitmap(blob);
          const nw = srcBitmap.width;
          const nh = srcBitmap.height;

          // Extract ImageData at native resolution for hit-testing
          const offscreen = new OffscreenCanvas(nw, nh);
          const ctx = offscreen.getContext("2d")!;
          ctx.drawImage(srcBitmap, 0, 0);
          srcBitmap.close();

          const imageData = ctx.getImageData(0, 0, nw, nh);
          const bounds = computeBounds(imageData, nw, nh);

          // Apply soft Gaussian feather to mask edges (FIX #2: edge smoothness)
          applyEdgeFeather(ctx, nw, nh);

          // Re-read imageData after feathering for hit-test accuracy
          const featheredImageData = ctx.getImageData(0, 0, nw, nh);

          const bitmap = await createImageBitmap(offscreen);

          const result: DecodedMask = {
            id: region.id,
            type: region.type,
            imageData: featheredImageData,
            bitmap,
            bounds,
            naturalWidth: nw,
            naturalHeight: nh,
          };

          cacheRef.current.set(region.id, { maskPrefix, result });
          results.push(result);
        } catch (e) {
          console.warn(`Failed to decode mask ${region.id}:`, e);
        }
      }

      // Clean cache entries for removed regions
      const currentIds = new Set(regions.map((r) => r.id));
      for (const key of cacheRef.current.keys()) {
        if (!currentIds.has(key)) cacheRef.current.delete(key);
      }

      if (!cancelled) {
        setDecoded(results);
        setLoading(false);
      }
    }

    decode();
    return () => { cancelled = true; };
  }, [regions]); // NO displayWidth/displayHeight dependency — masks decode once

  return { decoded, loading };
}

/**
 * FIX #2 (Edge smoothness): Apply a soft Gaussian-like feather to mask boundaries.
 * This prevents harsh hard edges when overlaying the colored mask on the image.
 * Uses a dilate → blur → multiply trick entirely on-canvas.
 */
function applyEdgeFeather(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const featherRadius = Math.max(2, Math.round(Math.min(w, h) * 0.004));

  // Simple box-blur on alpha channel only (fast approximation)
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4] / 255;

  const blurred = boxBlurAlpha(alpha, w, h, featherRadius);

  for (let i = 0; i < w * h; i++) {
    const v = Math.round(blurred[i] * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = v;
  }

  ctx.putImageData(imageData, 0, 0);
}

function boxBlurAlpha(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const inv = 1 / (r * 2 + 1);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[y * w + Math.max(0, Math.min(w - 1, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum * inv;
      const l = Math.max(0, x - r);
      const rr = Math.min(w - 1, x + r + 1);
      sum += src[y * w + rr] - src[y * w + l];
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.max(0, Math.min(h - 1, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum * inv;
      const t = Math.max(0, y - r);
      const b = Math.min(h - 1, y + r + 1);
      sum += tmp[b * w + x] - tmp[t * w + x];
    }
  }

  return out;
}

function computeBounds(data: ImageData, w: number, h: number): MaskBounds {
  let minX = w, minY = h, maxX = 0, maxY = 0;
  const d = data.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i] > 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return { x: 0, y: 0, width: w, height: h };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
