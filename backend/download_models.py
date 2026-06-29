"""
RoomTint — One-Time Model Download Script
==========================================
Run this ONCE while you have internet access.
After this, the app works 100% offline.

Usage:
    cd backend
    python download_models.py
"""
from pathlib import Path
import sys

BASE_DIR = Path(__file__).resolve().parent

def check_sam():
    sam_path = BASE_DIR / "sam" / "sam_vit_h_4b8939.pth"
    if sam_path.exists():
        size_gb = sam_path.stat().st_size / 1e9
        print(f"  ✅ SAM vit_h found ({size_gb:.1f} GB): {sam_path}")
        return True
    else:
        print(f"  ❌ SAM vit_h NOT found at: {sam_path}")
        print(f"     Download from: https://dl.fbaipublicfiles.com/segment_anything/sam_vit_h_4b8939.pth")
        print(f"     Place it at:   {sam_path}")
        return False


def download_mask2former():
    cache_dir = BASE_DIR / "models" / "mask2former"
    config_file = cache_dir / "config.json"

    if config_file.exists():
        print(f"  ✅ Mask2Former already cached at: {cache_dir}")
        return True

    print("  📥 Downloading Mask2Former from HuggingFace (~900MB)...")
    print("     This is the ONLY download needed. Future runs are fully offline.")

    try:
        from transformers import Mask2FormerForUniversalSegmentation, AutoImageProcessor
        cache_dir.mkdir(parents=True, exist_ok=True)

        model_id = "facebook/mask2former-swin-large-ade-semantic"
        print("     Downloading processor...")
        processor = AutoImageProcessor.from_pretrained(model_id)
        processor.save_pretrained(str(cache_dir))

        print("     Downloading model weights (~900MB, please wait)...")
        model = Mask2FormerForUniversalSegmentation.from_pretrained(model_id)
        model.save_pretrained(str(cache_dir))

        print(f"  ✅ Mask2Former saved to: {cache_dir}")
        return True

    except Exception as e:
        print(f"  ❌ Download failed: {e}")
        return False


def download_fonts():
    """Download web fonts for offline UI."""
    fonts_dir = BASE_DIR.parent / "src" / "assets" / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)

    fonts = {
        "InstrumentSerif-Regular.woff2": "https://fonts.gstatic.com/s/instrumentserif/v1/MELNn8isIsQoeyYLBMG5CLVZ6S8.woff2",
        "InstrumentSerif-Italic.woff2":  "https://fonts.gstatic.com/s/instrumentserif/v1/MELPn8isIsQoeyYLBMG5CLVZ6S8Z6Q.woff2",
        "DMSans-Light.woff2":            "https://fonts.gstatic.com/s/dmsans/v15/rP2Hp2ywxg089UriCZOIHTWEBlwy8Q.woff2",
        "DMSans-Regular.woff2":          "https://fonts.gstatic.com/s/dmsans/v15/rP2Hp2ywxg089UriCZOIHTWEBlwu8Q.woff2",
        "DMSans-Medium.woff2":           "https://fonts.gstatic.com/s/dmsans/v15/rP2Hp2ywxg089UriCZa_HTWEBlwu8Q.woff2",
        "DMSans-SemiBold.woff2":         "https://fonts.gstatic.com/s/dmsans/v15/rP2Hp2ywxg089UriCZKtHTWEBlwu8Q.woff2",
    }

    import urllib.request
    all_ok = True
    for filename, url in fonts.items():
        dest = fonts_dir / filename
        if dest.exists() and dest.stat().st_size > 1000:
            print(f"  ✅ {filename} already exists")
            continue
        try:
            print(f"  📥 Downloading {filename}...")
            urllib.request.urlretrieve(url, dest)
            print(f"  ✅ {filename} saved")
        except Exception as e:
            print(f"  ⚠️  Could not download {filename}: {e} (app still works with system fonts)")
            all_ok = False

    return all_ok


if __name__ == "__main__":
    print("\n🎨 RoomTint — Offline Setup\n" + "─" * 40)

    print("\n[1/3] Checking SAM model...")
    sam_ok = check_sam()

    print("\n[2/3] Setting up Mask2Former...")
    m2f_ok = download_mask2former()

    print("\n[3/3] Downloading fonts...")
    font_ok = download_fonts()

    print("\n" + "─" * 40)
    if sam_ok and m2f_ok:
        print("✅ RoomTint is ready for fully offline use!")
        print("\nStart the app:")
        print("  Backend:  cd backend && uvicorn main:app --reload --port 8000")
        print("  Frontend: cd ..     && npm run dev")
    else:
        print("⚠️  Setup incomplete. See errors above.")
        if not sam_ok:
            print("   → SAM model file is required (you must download it manually)")
        if not m2f_ok:
            print("   → Mask2Former download failed (check your internet connection)")
    print()
