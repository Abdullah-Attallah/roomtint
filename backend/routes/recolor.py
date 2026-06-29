from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import logging
import numpy as np
import anyio
import base64
import cv2

from services.sam_service import load_sam_generator, reload_sam_on_cuda_error
from services.mask_service import filter_wall_masks, resize_for_sam, upscale_masks
from services.recolor_service import recolor_lab
from services.image_service import decode_b64, encode_b64

router = APIRouter()
logger = logging.getLogger(__name__)


class RecolorRequest(BaseModel):
    imageBase64: str
    targetColor: str
    intensity: int = 40
    selectedWalls: Optional[List[str]] = None


class RecolorWithMasksRequest(BaseModel):
    imageBase64: str
    masks: List[str]
    targetColor: str
    intensity: int = 40


class RecolorResponse(BaseModel):
    image: str


def _decode_mask_b64(mask_b64: str, target_shape: tuple) -> np.ndarray:
    raw = mask_b64.split(",")[1] if "," in mask_b64 else mask_b64
    byte_data = base64.b64decode(raw)
    arr = np.frombuffer(byte_data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return np.zeros(target_shape[:2], dtype=bool)
    h, w = target_shape[:2]
    if img.shape != (h, w):
        img = cv2.resize(img, (w, h), interpolation=cv2.INTER_LINEAR)
    return img > 127


def _run_segmentation(image: np.ndarray) -> List[np.ndarray]:
    """Run SAM generation with automatic CUDA error recovery."""
    try:
        generator = load_sam_generator()
        raw_masks = generator.generate(image)
        return filter_wall_masks(raw_masks, image)
    except RuntimeError as e:
        if "CUDA" in str(e) or "cuda" in str(e):
            logger.warning(f"CUDA error during generation: {e} — reloading on CPU")
            reload_sam_on_cuda_error()
            # Retry once on CPU
            generator = load_sam_generator()
            raw_masks = generator.generate(image)
            return filter_wall_masks(raw_masks, image)
        raise


@router.post("/api/recolor", response_model=RecolorResponse)
async def recolor_room(req: RecolorRequest):
    if not 0 <= req.intensity <= 100:
        raise HTTPException(status_code=400, detail="Intensity must be 0–100")

    image = decode_b64(req.imageBase64)
    small, scale = resize_for_sam(image)

    try:
        wall_masks_small = await anyio.to_thread.run_sync(_run_segmentation, small)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {e}")

    if not wall_masks_small:
        logger.warning("No wall masks detected — returning original")
        return RecolorResponse(image=encode_b64(image))

    h, w = image.shape[:2]
    wall_masks = upscale_masks(wall_masks_small, (h, w), scale)

    if req.selectedWalls:
        selected = set(req.selectedWalls)
        wall_masks = [m for i, m in enumerate(wall_masks) if f"wall_{i}" in selected]

    if not wall_masks:
        return RecolorResponse(image=encode_b64(image))

    final_mask = np.zeros(image.shape[:2], dtype=bool)
    for m in wall_masks:
        final_mask |= m

    alpha = req.intensity / 100.0
    result = recolor_lab(image, final_mask, req.targetColor, alpha)
    return RecolorResponse(image=encode_b64(result))


@router.post("/api/recolor-masks", response_model=RecolorResponse)
async def recolor_with_masks(req: RecolorWithMasksRequest):
    if not 0 <= req.intensity <= 100:
        raise HTTPException(status_code=400, detail="Intensity must be 0–100")
    if not req.masks:
        raise HTTPException(status_code=400, detail="No masks provided")

    image = decode_b64(req.imageBase64)
    h, w = image.shape[:2]

    final_mask = np.zeros((h, w), dtype=bool)
    for mask_b64 in req.masks:
        m = _decode_mask_b64(mask_b64, image.shape)
        final_mask |= m

    if not final_mask.any():
        logger.warning("All masks empty — returning original")
        return RecolorResponse(image=encode_b64(image))

    alpha = req.intensity / 100.0
    result = recolor_lab(image, final_mask, req.targetColor, alpha)
    return RecolorResponse(image=encode_b64(result))
