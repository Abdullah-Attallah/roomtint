"""
Recolor Service — Accurate wall recoloring using LAB color space.

GOAL: The final wall color must visually match the selected HEX exactly.

APPROACH:
=========
Instead of blending/interpolating between original and target colors
(which always lets the original color contaminate the result),
we use a REPLACEMENT approach:

1. Convert image to LAB
2. Replace AB channels completely with target AB (no blending)
3. Keep L channel (lighting/shadows) but adjust its RANGE to match
   the target color's luminance — this preserves shadow/highlight
   relationships while shifting the brightness level to match the target
4. Apply intensity as a lerp between original and fully-replaced result
   so the user can control how strong the effect is
5. Recover surface texture using L-channel high-pass only (no color bleed)

This way at intensity=100% the wall color EXACTLY matches the target HEX.
At intensity=40% it's a 40% blend between original and exact target.
"""
import numpy as np
import cv2
from fastapi import HTTPException


def hex_to_bgr(hex_color: str) -> np.ndarray:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        raise HTTPException(status_code=400, detail="Invalid hex color")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return np.array([b, g, r], dtype=np.float32)


def recolor_lab(
    image: np.ndarray,
    mask: np.ndarray,
    target_hex: str,
    alpha: float
) -> np.ndarray:
    """
    Accurate wall recolor — target HEX color is applied exactly.

    At alpha=1.0: wall color = target HEX (exact match)
    At alpha=0.4: wall color = 40% toward target, 60% original
    Lighting and texture are always preserved.
    """
    target_bgr = hex_to_bgr(target_hex)
    bool_mask = mask.astype(bool)

    if not bool_mask.any():
        return image.copy()

    # ── Get target LAB ────────────────────────────────────────
    target_px = np.full((1, 1, 3), target_bgr.astype(np.uint8))
    target_lab = cv2.cvtColor(target_px, cv2.COLOR_BGR2LAB).astype(np.float32)
    target_L = float(target_lab[0, 0, 0])   # target brightness (0-255)
    target_A = float(target_lab[0, 0, 1])   # target green-red axis
    target_B = float(target_lab[0, 0, 2])   # target blue-yellow axis

    # ── Convert image to LAB ──────────────────────────────────
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[:, :, 0].copy()
    A_orig = lab[:, :, 1].copy()
    B_orig = lab[:, :, 2].copy()

    # ── Build fully-recolored version ─────────────────────────
    # Replace AB channels completely — no blending, exact target hue/chroma
    lab_new = lab.copy()
    lab_new[:, :, 1] = np.where(bool_mask, target_A, A_orig)
    lab_new[:, :, 2] = np.where(bool_mask, target_B, B_orig)

    # Remap L channel: preserve LOCAL lighting variation (shadows/highlights)
    # but shift the OVERALL brightness level to match the target color.
    # 
    # Formula: L_new = target_L + (L_orig - mean_L_orig) * contrast_scale
    # This keeps shadow/highlight relationships but centers them around target_L.
    #
    # contrast_scale < 1 softens shadows for light target colors (avoids blown highlights)
    # contrast_scale = 1 keeps exact same contrast
    L_wall = L[bool_mask]
    if len(L_wall) > 0:
        mean_L_orig = float(L_wall.mean())
        std_L_orig = float(L_wall.std()) + 1e-6

        # Scale contrast to avoid crushing shadows on very dark targets
        # or blowing out highlights on very light targets
        contrast_scale = min(1.0, (target_L + 30) / (mean_L_orig + 30))
        contrast_scale = max(0.5, contrast_scale)

        L_remapped = target_L + (L - mean_L_orig) * contrast_scale
        lab_new[:, :, 0] = np.where(bool_mask, L_remapped, L)

    result_full = cv2.cvtColor(
        np.clip(lab_new, 0, 255).astype(np.uint8),
        cv2.COLOR_LAB2BGR
    )

    # ── Texture recovery (L-channel only) ────────────────────
    # Extract surface texture from L channel of the recolored image.
    # Adding back high-frequency L detail restores plaster/paint surface
    # without reintroducing any original wall color.
    texture_strength = (1.0 - alpha) * 0.15

    if texture_strength > 0.01:
        result_lab = cv2.cvtColor(result_full, cv2.COLOR_BGR2LAB).astype(np.float32)
        L_res = result_lab[:, :, 0]
        blur_r = max(1, min(image.shape[0], image.shape[1]) // 60)
        if blur_r % 2 == 0:
            blur_r += 1
        L_hp = L_res - cv2.GaussianBlur(L_res, (blur_r, blur_r), 0)
        result_lab[:, :, 0] = np.where(
            bool_mask,
            np.clip(L_res + L_hp * texture_strength, 0, 255),
            L_res
        )
        result_full = cv2.cvtColor(
            np.clip(result_lab, 0, 255).astype(np.uint8),
            cv2.COLOR_LAB2BGR
        )

    # ── Blend original ↔ fully-recolored by alpha ─────────────
    # alpha=1.0 → exact target color
    # alpha=0.4 → 40% toward exact target
    original_f = image.astype(np.float32)
    result_f = result_full.astype(np.float32)

    final = original_f.copy()
    final[bool_mask] = (
        original_f[bool_mask] * (1.0 - alpha) +
        result_f[bool_mask] * alpha
    )

    return np.clip(final, 0, 255).astype(np.uint8)
