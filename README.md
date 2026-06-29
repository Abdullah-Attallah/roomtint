# RoomTint v2 — AI Wall Color Visualizer (Fully Offline)

Upload a room photo → pick a color → SAM `vit_h` recolors only the walls.
**100% offline after initial setup. No internet required to run.**

---

## Architecture

```
roomtint/
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── download_models.py     ← run once for offline setup
│   ├── init_db.sql
│   ├── requirements.txt
│   ├── .env
│   ├── sam/
│   │   └── sam_vit_h_4b8939.pth    ← you provide this
│   ├── models/
│   │   └── mask2former/            ← auto-created by download_models.py
│   ├── routes/
│   │   ├── detect_walls.py
│   │   ├── recolor.py
│   │   ├── recommend_colors.py
│   │   └── results.py
│   └── services/
│       ├── sam_service.py
│       ├── mask_service.py
│       ├── recolor_service.py
│       └── image_service.py
└── src/
    ├── assets/fonts/          ← local woff2 fonts (download_models.py)
    └── ...
```

---

## Setup (one-time, needs internet)

### Step 1 — PostgreSQL
```bash
createdb -U postgres roomtint
psql -U postgres -d roomtint -f backend/init_db.sql
```

### Step 2 — Python dependencies
```bash
cd backend
pip install -r requirements.txt
```

### Step 3 — Download models & fonts (ONCE, needs internet)
```bash
cd backend
python download_models.py
```

This downloads:
- **Mask2Former** (~900MB) → saved to `backend/models/mask2former/`
- **Web fonts** (~300KB) → saved to `src/assets/fonts/`

You must manually place `sam_vit_h_4b8939.pth` in `backend/sam/`.

### Step 4 — Frontend dependencies
```bash
npm install
```

---

## Running (fully offline)

### Backend
```bash
cd backend
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
npm run dev
# Opens at http://localhost:8080
```

### Check offline status
Open: http://localhost:8000/health

Should show:
```json
{
  "offline_ready": true,
  "sam_vit_h": true,
  "mask2former_cached": true
}
```

---

## What's offline vs what needs internet

| Component | Internet needed? | Notes |
|---|---|---|
| SAM vit_h | ❌ Never | You provide the .pth file |
| Mask2Former | First run only | Cached after `download_models.py` |
| Web fonts | First run only | Cached after `download_models.py` |
| npm packages | First run only | Cached in node_modules |
| pip packages | First run only | Cached by pip |
| App runtime | ❌ Never | 100% local |
