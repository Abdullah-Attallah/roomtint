from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import base64
import numpy as np
import cv2
import colorsys
import random
import time

router = APIRouter()

# =========================
# Models
# =========================
class RecommendRequest(BaseModel):
    imageBase64: Optional[str] = None
    roomType: str = "living_room"

class ColorSuggestion(BaseModel):
    hex: str
    name: str
    reason: str

class RecommendResponse(BaseModel):
    suggestions: List[ColorSuggestion]

# =========================
# Helpers
# =========================
def decode(b64):
    try:
        arr = np.frombuffer(base64.b64decode(b64.split(",")[-1]), np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError()
        return img
    except:
        raise HTTPException(400, "Invalid image")

def rgb_to_hex(rgb):
    return "#" + "".join(f"{int(max(0,min(1,c))*255):02X}" for c in rgb)

def adjust_lightness(rgb, factor):
    h, l, s = colorsys.rgb_to_hls(*rgb)
    l = max(0, min(1, l * factor))
    return colorsys.hls_to_rgb(h, l, s)

def complementary(rgb):
    h, l, s = colorsys.rgb_to_hls(*rgb)
    shift = random.choice([0.4, 0.5, 0.6])
    return colorsys.hls_to_rgb((h + shift) % 1.0, l, s)

# =========================
# AI ANALYSIS
# =========================
def get_dominant_color(image):
    img = cv2.resize(image, (100, 100))
    img = img.reshape((-1, 3))

    K = 3
    _, labels, centers = cv2.kmeans(
        np.float32(img),
        K,
        None,
        (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0),
        10,
        cv2.KMEANS_RANDOM_CENTERS
    )

    counts = np.bincount(labels.flatten())
    dominant = centers[np.argmax(counts)]

    return dominant[::-1] / 255.0  # BGR → RGB

def analyze_lighting(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    brightness = np.mean(gray)

    if brightness < 80:
        return "dark"
    elif brightness < 160:
        return "normal"
    else:
        return "bright"

def color_temperature(rgb):
    r, g, b = rgb
    return "warm" if r > b else "cool"

# =========================
# ROOM PERSONALITY
# =========================
ROOM_BEHAVIOR = {
    "living_room": {"light_boost": 1.2, "saturation": 0.5},
    "bedroom": {"light_boost": 1.3, "saturation": 0.4},
    "kitchen": {"light_boost": 1.1, "saturation": 0.7},
    "office": {"light_boost": 1.0, "saturation": 0.3},
    "bathroom": {"light_boost": 1.4, "saturation": 0.5},
    "dining_room": {"light_boost": 0.9, "saturation": 0.6},
}

# =========================
# API
# =========================
@router.post("/api/recommend-colors", response_model=RecommendResponse)
async def recommend(req: RecommendRequest):

    # 🎲 مهم جدًا → يخلي كل request مختلف
    random.seed(time.time())

    suggestions = []

    # =========================
    # AI Analysis
    # =========================
    if req.imageBase64:
        image = decode(req.imageBase64)

        base_rgb = get_dominant_color(image)
        lighting = analyze_lighting(image)
        temp = color_temperature(base_rgb)

        # 🎲 variation subtle
        variation = random.uniform(-0.05, 0.05)
        base_rgb = tuple(max(0, min(1, c + variation)) for c in base_rgb)

    else:
        base_rgb = (0.8, 0.7, 0.6)
        lighting = "normal"
        temp = "warm"

    # =========================
    # Room behavior
    # =========================
    behavior = ROOM_BEHAVIOR.get(req.roomType, ROOM_BEHAVIOR["living_room"])

    # =========================
    # 🎨 1. Complementary
    # =========================
    comp = complementary(base_rgb)
    suggestions.append(ColorSuggestion(
        hex=rgb_to_hex(comp),
        name="Accent Contrast",
        reason="Perfect for feature wall or decor contrast"
    ))

    # =========================
    # 🎨 2. Lighting-aware
    # =========================
    if lighting == "dark":
        lighter = adjust_lightness(base_rgb, 1.4)
        suggestions.append(ColorSuggestion(
            hex=rgb_to_hex(lighter),
            name="Bright Boost",
            reason="Improves brightness in low-light room"
        ))

    elif lighting == "bright":
        darker = adjust_lightness(base_rgb, 0.7)
        suggestions.append(ColorSuggestion(
            hex=rgb_to_hex(darker),
            name="Soft Depth",
            reason="Balances strong lighting"
        ))

    # =========================
    # 🎨 3. Temperature-aware
    # =========================
    if temp == "warm":
        cool = colorsys.hls_to_rgb(0.55, 0.6, 0.4)
        suggestions.append(ColorSuggestion(
            hex=rgb_to_hex(cool),
            name="Cool Balance",
            reason="Balances warm tones"
        ))
    else:
        warm = colorsys.hls_to_rgb(0.08, 0.6, 0.5)
        suggestions.append(ColorSuggestion(
            hex=rgb_to_hex(warm),
            name="Warm Touch",
            reason="Adds warmth"
        ))

    # =========================
    # 🎨 4. Room style adjustment
    # =========================
    styled = adjust_lightness(base_rgb, behavior["light_boost"])
    suggestions.append(ColorSuggestion(
        hex=rgb_to_hex(styled),
        name="Room Optimized",
        reason=f"Optimized for {req.roomType}"
    ))

    # =========================
    # 🎨 5. Creative AI colors
    # =========================
    for _ in range(3):
        h = random.random()
        l = random.uniform(0.4, 0.8)
        s = random.uniform(0.3, 0.7)

        rgb = colorsys.hls_to_rgb(h, l, s)

        suggestions.append(ColorSuggestion(
            hex=rgb_to_hex(rgb),
            name="AI Creative",
            reason="Generated for unique style"
        ))

    # =========================
    # 🎨 6. Shade variations
    # =========================
    for f in [0.8, 1.2]:
        var = adjust_lightness(base_rgb, f)
        suggestions.append(ColorSuggestion(
            hex=rgb_to_hex(var),
            name="Shade Variant",
            reason="Alternative tone"
        ))

    # 🎲 shuffle النهائي
    random.shuffle(suggestions)

    return RecommendResponse(suggestions=suggestions[:6])