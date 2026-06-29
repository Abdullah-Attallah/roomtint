"""
Image Service — encode/decode helpers shared across routes.
"""
import base64
import numpy as np
import cv2
from fastapi import HTTPException


def decode_b64(img_b64: str) -> np.ndarray:
    try:
        data = img_b64.split(",")[-1]
        arr = np.frombuffer(base64.b64decode(data), np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("imdecode returned None")
        return img
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image: {e}")


def encode_b64(img: np.ndarray, prefix: bool = True) -> str:
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    b64 = base64.b64encode(buf).decode()
    return ("data:image/jpeg;base64," + b64) if prefix else b64


def encode_mask_b64(mask: np.ndarray) -> str:
    m = (mask > 0).astype(np.uint8) * 255
    _, buf = cv2.imencode(".png", m)
    return base64.b64encode(buf).decode()
