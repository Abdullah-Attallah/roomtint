"""
RoomTint Backend v2 — Fully Offline FastAPI Server
────────────────────────────────────────────────────
• SAM vit_h       → backend/sam/sam_vit_h_4b8939.pth     (you provide)
• Mask2Former     → backend/models/mask2former/           (auto-cached on first run)
• PostgreSQL      → localhost:5432/roomtint
• No internet required after first Mask2Former download.
"""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s — %(message)s")

app = FastAPI(title="RoomTint", version="2.0.0", docs_url="/docs")

# Allow localhost frontend on any port
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://localhost:5173", "http://127.0.0.1:8080", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from routes.detect_walls import router as detect_walls_router
from routes.recolor import router as recolor_router
from routes.recommend_colors import router as recommend_colors_router
from routes.results import router as results_router

app.include_router(detect_walls_router)
app.include_router(recolor_router)
app.include_router(recommend_colors_router)
app.include_router(results_router)


@app.get("/health")
def health():
    import torch
    from services.sam_service import SAM_CHECKPOINT, device
    from pathlib import Path
    mask2former_cached = Path(__file__).parent / "models" / "mask2former" / "config.json"
    return {
        "status": "ok",
        "offline_ready": SAM_CHECKPOINT.exists() and mask2former_cached.exists(),
        "sam_vit_h": SAM_CHECKPOINT.exists(),
        "mask2former_cached": mask2former_cached.exists(),
        "device": device,
        "cuda": torch.cuda.is_available(),
    }
