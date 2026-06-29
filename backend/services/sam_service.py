"""
SAM Service — separate model instances for predictor and generator.

WHY TWO INSTANCES:
==================
SamPredictor.set_image() modifies internal model state (image embeddings).
If the same model object is shared with SamAutomaticMaskGenerator, calling
generator.generate() after predictor.set_image() causes a RuntimeError.
Fix: each lru_cache loads a SEPARATE sam model instance.

CUDA ERROR HANDLING:
====================
"CUDA error: unknown error" usually means one of:
1. GPU ran out of VRAM (vit_h needs ~8GB, vit_b needs ~4GB)
2. CUDA context was corrupted after a previous crash
3. Driver/PyTorch version mismatch on Windows

Fix: validate CUDA before loading, fall back to CPU automatically.
Also: clear CUDA cache before each model load to reclaim fragmented VRAM.
"""
from functools import lru_cache
from pathlib import Path
import logging
import torch

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
SAM_CHECKPOINT = BASE_DIR / "sam" / "sam_vit_h_4b8939.pth"
SAM_MODEL_TYPE = "vit_h"


def _get_device() -> str:
    """Validate CUDA with a real allocation test before committing to it."""
    if not torch.cuda.is_available():
        logger.info("CUDA not available — using CPU")
        return "cpu"
    try:
        # Actual allocation test — catches 'unknown error' before model load
        torch.cuda.empty_cache()
        test = torch.zeros(1, device="cuda")
        del test
        torch.cuda.empty_cache()
        name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / 1e9
        logger.info(f"CUDA OK — {name} ({vram:.1f}GB VRAM)")
        return "cuda"
    except RuntimeError as e:
        logger.warning(f"CUDA validation failed: {e} — falling back to CPU")
        return "cpu"


# Computed once at startup
device = _get_device()


def _load_sam_model():
    """Load a fresh SAM model with automatic CUDA → CPU fallback."""
    from segment_anything import sam_model_registry

    if not SAM_CHECKPOINT.exists():
        logger.info("SAM checkpoint not found. Downloading from HuggingFace...")

        from huggingface_hub import hf_hub_download

        SAM_CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)

        hf_hub_download(
            repo_id="aattallah/SAM",
            filename="sam_vit_h_4b8939.pth",
            local_dir=str(SAM_CHECKPOINT.parent)
        )

        logger.info(f"SAM downloaded to: {SAM_CHECKPOINT}")

    global device

    # Load weights on CPU first
    sam = sam_model_registry[SAM_MODEL_TYPE](
        checkpoint=str(SAM_CHECKPOINT)
    )

    if device == "cuda":
        try:
            torch.cuda.empty_cache()
            sam = sam.to("cuda").eval()
            logger.info(f"SAM ({SAM_MODEL_TYPE}) loaded on CUDA")
        except RuntimeError as e:
            logger.warning(
                f"Failed to move SAM to CUDA: {e} — using CPU"
            )
            device = "cpu"
            sam = sam.to("cpu").eval()
    else:
        sam = sam.to("cpu").eval()
        logger.info(f"SAM ({SAM_MODEL_TYPE}) loaded on CPU")

    return sam


def _reset_cuda():
    """Try to recover a broken CUDA context."""
    try:
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    except Exception:
        pass


@lru_cache(maxsize=1)
def load_sam_predictor():
    """Dedicated SAM instance for point-guided prediction (detect_walls route)."""
    from segment_anything import SamPredictor
    logger.info(f"Loading SAM predictor ({SAM_MODEL_TYPE})...")
    sam = _load_sam_model()
    logger.info("SAM predictor ready")
    return SamPredictor(sam)


@lru_cache(maxsize=1)
def load_sam_generator():
    """Dedicated SAM instance for automatic mask generation (recolor route)."""
    from segment_anything import SamAutomaticMaskGenerator
    logger.info(f"Loading SAM generator ({SAM_MODEL_TYPE})...")
    sam = _load_sam_model()
    generator = SamAutomaticMaskGenerator(
        sam,
        points_per_side=16,
        pred_iou_thresh=0.86,
        stability_score_thresh=0.90,
        min_mask_region_area=0,   # disabled — prevents tensor size mismatch
        crop_n_layers=0,          # disabled — prevents tensor size mismatch
    )
    logger.info("SAM generator ready")
    return generator


def reload_sam_on_cuda_error():
    """
    Call this when a CUDA RuntimeError happens during inference.
    Clears lru_cache so next call reloads the model cleanly.
    Useful for auto-recovery without restarting the server.
    """
    logger.warning("CUDA error detected — clearing SAM cache for reload")
    _reset_cuda()
    load_sam_predictor.cache_clear()
    load_sam_generator.cache_clear()
