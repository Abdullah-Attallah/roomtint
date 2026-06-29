"""
Mask Service — Wall detection with semantic heuristics.

REDESIGNED FILTERING (v8):
==========================
Previous version was too permissive — windows, paintings, TVs, and shelves
were passing all 6 checks. The issue was individual thresholds were relaxed
too much in isolation. Now uses a SCORING system: each heuristic contributes
a score, and only masks above a threshold are accepted. This is more robust
than boolean AND of weak checks.

Key new rejections:
- Windows: high brightness + rectangular + touches image border
- Paintings/TVs: high edge density + small area + high color variance
- Furniture: bottom-heavy position + high edge density
- Shelves: very small area + high variance + high edge density

Also added:
- Non-maximum suppression (NMS) to remove overlapping masks
- Border-touch logic (walls almost always touch at least one image border)
- Brightness uniformity check (walls are relatively uniform in brightness)
"""
import numpy as np
import cv2
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)


def _score_wall_mask(mask: np.ndarray, image: np.ndarray) -> Tuple[float, str]:
    """
    Score a mask on how likely it is to be a wall.
    Returns (score 0-100, rejection_reason or "").
    Score >= 50 = accept as wall.
    """
    h, w = image.shape[:2]
    area = int(mask.sum())
    total = h * w
    score = 50.0  # start neutral

    ys, xs = np.where(mask)
    if len(xs) < 10:
        return 0.0, "too_small"

    area_ratio = area / total

    # ── 1. Size ───────────────────────────────────────────────
    if area_ratio < 0.012:
        return 0.0, "area_too_small"
    if area_ratio > 0.92:
        return 0.0, "area_too_large"
    # Prefer larger regions (walls are big)
    if area_ratio > 0.15:
        score += 15
    elif area_ratio > 0.07:
        score += 8

    # ── 2. Position ───────────────────────────────────────────
    bbox_top = float(ys.min()) / h
    bbox_bottom = float(ys.max()) / h
    bbox_left = float(xs.min()) / w
    bbox_right = float(xs.max()) / w
    bbox_h_px = int(ys.max() - ys.min())
    bbox_w_px = int(xs.max() - xs.min())

    # Reject regions entirely in bottom 55% of frame (likely floor/furniture)
    if bbox_top > 0.55:
        return 0.0, "position_floor"

    # Walls typically start near top
    if bbox_top < 0.15:
        score += 10

    # ── 3. Border touch ───────────────────────────────────────
    # Walls almost always touch at least one image border.
    # Windows/paintings/TVs float in the middle.
    touches_top = bbox_top < 0.04
    touches_bottom = bbox_bottom > 0.96
    touches_left = bbox_left < 0.04
    touches_right = bbox_right > 0.96
    border_touches = sum([touches_top, touches_bottom, touches_left, touches_right])

    if border_touches == 0:
        # Floating region — likely painting, TV, window, shelf
        score -= 30
    elif border_touches >= 2:
        score += 20
    else:
        score += 8

    # ── 4. Aspect ratio ───────────────────────────────────────
    aspect = bbox_h_px / (bbox_w_px + 1e-6)
    if aspect < 0.15:
        return 0.0, "aspect_too_wide"  # horizontal stripe — not a wall
    if 0.3 <= aspect <= 4.0:
        score += 8

    # ── 5. Solidity ───────────────────────────────────────────
    contours, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return 0.0, "no_contour"
    hull_area = cv2.contourArea(cv2.convexHull(max(contours, key=cv2.contourArea)))
    solidity = area / (hull_area + 1e-6)
    if solidity < 0.35:
        score -= 15  # very irregular — likely furniture/objects
    elif solidity > 0.70:
        score += 10

    # ── 6. Edge density ───────────────────────────────────────
    # Windows, TVs, paintings have dense internal edges.
    # Plain walls have very few internal edges.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 40, 120)
    edge_pixels = int(edges[mask.astype(bool)].sum()) // 255
    edge_ratio = edge_pixels / (area + 1e-6)

    if edge_ratio > 0.28:
        # Very high edge density = window frame, TV, painting — REJECT
        return 0.0, f"edge_density_too_high({edge_ratio:.2f})"
    elif edge_ratio > 0.18:
        score -= 15
    elif edge_ratio < 0.08:
        score += 15  # smooth uniform surface = wall

    # ── 7. Color variance ─────────────────────────────────────
    # Walls are relatively uniform in color.
    # Paintings, windows (sky+frame), TVs have high variance.
    roi = image[mask.astype(bool)].astype(np.float32)
    variance = float(np.var(roi, axis=0).mean())

    if variance > 3500:
        return 0.0, f"variance_too_high({variance:.0f})"
    elif variance > 2000:
        score -= 10
    elif variance < 800:
        score += 12  # uniform color = wall

    # ── 8. Brightness uniformity ──────────────────────────────
    # Windows are bright (daylight). TVs are very bright or very dark.
    # Walls are moderate and relatively uniform in brightness.
    gray_roi = gray[mask.astype(bool)].astype(np.float32)
    mean_brightness = float(gray_roi.mean())
    brightness_std = float(gray_roi.std())

    # Very bright uniform region = likely window
    if mean_brightness > 210 and brightness_std < 30:
        return 0.0, "bright_window"

    # Very high brightness variation = complex object (TV, painting)
    if brightness_std > 80:
        score -= 12

    # Moderate brightness preferred for walls
    if 60 < mean_brightness < 200:
        score += 5

    return max(0.0, min(100.0, score)), ""


def nms_masks(masks: List[np.ndarray], iou_threshold: float = 0.3) -> List[np.ndarray]:
    """
    Non-maximum suppression: remove masks that overlap too much with
    a higher-scoring mask. Prevents double-counting the same wall region.
    """
    if len(masks) <= 1:
        return masks

    areas = [m.sum() for m in masks]
    keep = []
    suppressed = set()

    for i in range(len(masks)):
        if i in suppressed:
            continue
        keep.append(i)
        for j in range(i + 1, len(masks)):
            if j in suppressed:
                continue
            intersection = int((masks[i] & masks[j]).sum())
            union = int((masks[i] | masks[j]).sum())
            iou = intersection / (union + 1e-6)
            if iou > iou_threshold:
                suppressed.add(j)

    return [masks[i] for i in keep]


def clean_mask(mask: np.ndarray, kernel_size: int = 7) -> np.ndarray:
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    m = mask.astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return m.astype(bool)


def filter_wall_masks(
    raw_masks: List[dict],
    image: np.ndarray,
    max_walls: int = 6
) -> List[np.ndarray]:
    """
    Score-based wall mask filtering with NMS.
    """
    # Sort by area descending — larger regions processed first
    sorted_masks = sorted(raw_masks, key=lambda x: x["area"], reverse=True)

    scored = []
    for m in sorted_masks:
        seg = m["segmentation"].astype(bool)
        score, reason = _score_wall_mask(seg, image)
        if score >= 50.0:
            seg = clean_mask(seg)
            scored.append((score, seg))
            logger.debug(f"ACCEPT score={score:.0f} area={seg.sum()}")
        else:
            logger.debug(f"REJECT reason={reason} area={seg.sum()}")

    if not scored:
        logger.info(f"Wall filter: {len(raw_masks)} masks → 0 walls (all rejected)")
        return []

    # Sort by score descending, take top candidates before NMS
    scored.sort(key=lambda x: x[0], reverse=True)
    candidates = [s[1] for s in scored[:max_walls * 2]]

    # NMS to remove overlapping masks
    walls = nms_masks(candidates, iou_threshold=0.25)[:max_walls]

    logger.info(f"Wall filter: {len(raw_masks)} masks → {len(walls)} walls")
    return walls


def resize_for_sam(image: np.ndarray, max_dim: int = 1024) -> Tuple[np.ndarray, float]:
    h, w = image.shape[:2]
    scale = min(max_dim / max(h, w), 1.0)
    if scale < 1.0:
        image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return image, scale


def upscale_masks(
    masks: List[np.ndarray], orig_shape: Tuple[int, int], scale: float
) -> List[np.ndarray]:
    if scale >= 1.0:
        return masks
    h, w = orig_shape
    return [
        cv2.resize(m.astype(np.uint8), (w, h), interpolation=cv2.INTER_LINEAR) > 127
        for m in masks
    ]
