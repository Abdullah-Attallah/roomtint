from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Tuple
import logging
import numpy as np
import cv2
import torch
import anyio
from pathlib import Path
from functools import lru_cache
from transformers import Mask2FormerForUniversalSegmentation, AutoImageProcessor

from services.sam_service import load_sam_predictor, device, BASE_DIR
from services.mask_service import resize_for_sam, upscale_masks
from services.recolor_service import recolor_lab
from services.image_service import decode_b64, encode_b64, encode_mask_b64

router = APIRouter()
logger = logging.getLogger(__name__)

MASK2FORMER_CACHE = BASE_DIR / "models" / "mask2former"

ADE20K_CLASSES = {
    "wall":    {0, 1},
    "floor":   {3, 28, 53},
    "ceiling": {5},
}


@lru_cache(maxsize=1)
def load_mask2former():
    """
    Load Mask2Former from local cache.
    First run downloads from HuggingFace; all subsequent runs are fully offline.
    """
    MASK2FORMER_CACHE.mkdir(parents=True, exist_ok=True)
    model_id = "facebook/mask2former-swin-large-ade-semantic"
    config_file = MASK2FORMER_CACHE / "config.json"

    if config_file.exists():
        logger.info(f"Loading Mask2Former from local cache: {MASK2FORMER_CACHE}")
        source = str(MASK2FORMER_CACHE)
    else:
        logger.info("Mask2Former not cached — downloading once from HuggingFace...")
        source = model_id

    processor = AutoImageProcessor.from_pretrained(
        source, cache_dir=None, local_files_only=config_file.exists(),
    )
    model = Mask2FormerForUniversalSegmentation.from_pretrained(
        source, cache_dir=None, local_files_only=config_file.exists(),
    ).to(device).eval()

    if device == "cuda":
        model = model.half()

    if not config_file.exists():
        logger.info(f"Saving Mask2Former to local cache: {MASK2FORMER_CACHE}")
        processor.save_pretrained(str(MASK2FORMER_CACHE))
        model.save_pretrained(str(MASK2FORMER_CACHE))

    logger.info("Mask2Former ready")
    return processor, model


# ── API Models ────────────────────────────────────────────────────────
class DetectWallsRequest(BaseModel):
    imageBase64: str
    color: str = "#ff0000"
    intensity: int = 40


class Region(BaseModel):
    id: str
    type: str
    mask: str


class ResponseModel(BaseModel):
    regions: List[Region]
    recolored: str


# ── Segmentation ──────────────────────────────────────────────────────
def segment_mask2former(image: np.ndarray) -> np.ndarray:
    processor, model = load_mask2former()
    img_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    inputs = processor(images=img_rgb, return_tensors="pt").to(device)
    if device == "cuda":
        inputs = {k: v.half() if v.dtype == torch.float32 else v for k, v in inputs.items()}
    with torch.inference_mode():
        with torch.autocast(device_type=device, enabled=(device == "cuda")):
            outputs = model(**inputs)
    return processor.post_process_semantic_segmentation(
        outputs, target_sizes=[image.shape[:2]]
    )[0].cpu().numpy()


def extract_regions(seg_map: np.ndarray, shape: tuple) -> List[Tuple[np.ndarray, str]]:
    """
    FIX #2 (Wall detection): The old threshold was 3% of total pixels, which
    rejected many valid smaller walls (side walls, hallways, niche panels).

    Changes:
    - min_area lowered to 0.8% of total pixels (was 3%)
    - component threshold lowered to 0.3 * min_area (was 0.5)
    - Added Gaussian edge feathering to soften mask boundaries
    - Better morphological cleanup: close first (fills gaps), then open (removes noise)
    - Sort regions by area descending so primary walls come first
    """
    h, w = shape[:2]
    total_pixels = h * w

    # FIX: Much lower minimum area so small walls are not rejected
    min_area = 0.008 * total_pixels  # was 0.03 — 4x more permissive

    regions = []
    for rtype, class_ids in ADE20K_CLASSES.items():
        combined = np.isin(seg_map, list(class_ids)).astype(np.uint8)
        if combined.sum() < min_area:
            continue

        num, labels = cv2.connectedComponents(combined)
        components = []
        for lid in range(1, num):
            comp = (labels == lid).astype(np.uint8)
            area = comp.sum()
            # FIX: threshold lowered to 0.3x min_area (was 0.5x)
            if area < min_area * 0.3:
                continue

            # FIX: Better cleanup — close first (bridges small gaps), then open
            kernel_close = np.ones((9, 9), np.uint8)
            kernel_open = np.ones((3, 3), np.uint8)
            comp = cv2.morphologyEx(comp, cv2.MORPH_CLOSE, kernel_close)
            comp = cv2.morphologyEx(comp, cv2.MORPH_OPEN, kernel_open)

            # FIX: Feather mask edges with Gaussian blur for smooth transitions
            # This prevents hard aliased boundaries when rendering on the frontend
            comp_float = comp.astype(np.float32)
            sigma = max(1.0, min(h, w) * 0.003)
            blurred = cv2.GaussianBlur(comp_float, (0, 0), sigma)
            # Threshold back to binary but keep values near edges in [0,1] range
            # We encode as uint8 with values 0-255 to preserve soft edges in PNG
            comp_soft = np.clip(blurred * 255, 0, 255).astype(np.uint8)

            components.append((comp_soft, area))

        # Sort by area so primary walls come first in the list
        components.sort(key=lambda x: x[1], reverse=True)
        regions.extend([(c, rtype) for c, _ in components])

    logger.info(f"extract_regions: found {len(regions)} regions (threshold={min_area:.0f}px)")
    return regions


def refine_with_sam(image: np.ndarray, masks: List[np.ndarray]) -> List[np.ndarray]:
    """
    FIX #2 (SAM refinement): Use more sample points per mask for better coverage.
    Old code used up to 5 points. New code samples a 3x3 grid within the mask
    bounding box, giving SAM much better context for large irregular walls.
    """
    if not masks:
        return masks
    predictor = load_sam_predictor()
    predictor.set_image(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    refined = []
    for mask in masks:
        # Threshold the soft mask to binary for SAM input
        binary = (mask > 127).astype(np.uint8)
        ys, xs = np.where(binary)
        if len(xs) == 0:
            refined.append(binary.astype(bool))
            continue

        # Sample a grid of points within the bounding box
        x_min, x_max = int(xs.min()), int(xs.max())
        y_min, y_max = int(ys.min()), int(ys.max())
        grid_pts = []
        for gy in np.linspace(y_min + 1, y_max - 1, 3):
            for gx in np.linspace(x_min + 1, x_max - 1, 3):
                px, py = int(gx), int(gy)
                if 0 <= py < binary.shape[0] and 0 <= px < binary.shape[1]:
                    if binary[py, px] > 0:
                        grid_pts.append([px, py])

        if not grid_pts:
            # Fallback: use centroid
            grid_pts = [[int(xs.mean()), int(ys.mean())]]

        pts = np.array(grid_pts, dtype=float)
        lbls = np.ones(len(pts), dtype=int)

        try:
            sam_masks, scores, _ = predictor.predict(
                point_coords=pts, point_labels=lbls, multimask_output=True
            )
            refined.append(sam_masks[np.argmax(scores)])
        except Exception as e:
            logger.warning(f"SAM prediction failed: {e}, using Mask2Former result")
            refined.append(binary.astype(bool))

    return refined


async def run_pipeline(image, color, intensity):
    small, scale = resize_for_sam(image)
    seg_map = await anyio.to_thread.run_sync(segment_mask2former, small)
    regions_raw = extract_regions(seg_map, small.shape)
    if not regions_raw:
        raise HTTPException(status_code=422, detail="No wall/floor/ceiling regions detected")
    raw_masks = [m for m, _ in regions_raw]
    rtypes = [t for _, t in regions_raw]
    refined = await anyio.to_thread.run_sync(refine_with_sam, small, raw_masks)
    h, w = image.shape[:2]
    if scale < 1.0:
        refined = upscale_masks(refined, (h, w), scale)
    final_mask = np.zeros(image.shape[:2], dtype=np.uint8)
    for m in refined:
        final_mask = np.maximum(final_mask, m.astype(np.uint8))
    alpha = intensity / 100.0
    recolored = recolor_lab(image, final_mask, color, alpha)
    return [(refined[i], rtypes[i], i) for i in range(len(refined))], recolored


@router.post("/api/pro-detect", response_model=ResponseModel)
async def detect(req: DetectWallsRequest):
    if not 0 <= req.intensity <= 100:
        raise HTTPException(status_code=400, detail="Intensity must be 0-100")
    image = decode_b64(req.imageBase64)
    regions, recolored = await run_pipeline(image, req.color, req.intensity)
    return ResponseModel(
        regions=[
            Region(id=f"region_{i}", type=rtype, mask=encode_mask_b64(mask))
            for mask, rtype, i in regions
        ],
        recolored=encode_b64(recolored, prefix=False)
    )
