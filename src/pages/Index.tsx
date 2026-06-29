import { useState, useCallback } from "react";
import {
  Paintbrush, RotateCcw, Download,
  Sparkles, Upload, ChevronRight,
  Wand2, Check, ScanSearch
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { recolorRoom, recolorWithMasks, detectWalls } from "@/lib/api";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import WallOverlay from "@/components/WallOverlay";
import type { WallRegion } from "@/types";

const PALETTES = [
  { name: "Warm & Cozy",    colors: ["#E8D5B7","#C4956A","#A0522D","#D2691E","#F5DEB3","#DEB887"] },
  { name: "Cool & Calm",    colors: ["#B0C4DE","#87CEEB","#6495ED","#4682B4","#5F9EA0","#708090"] },
  { name: "Fresh & Natural",colors: ["#98D8C8","#7CB342","#558B2F","#8BC34A","#C5E1A5","#A5D6A7"] },
  { name: "Bold & Modern",  colors: ["#2C3E50","#1A1A2E","#16213E","#0F3460","#533483","#E94560"] },
  { name: "Soft Pastels",   colors: ["#FFD1DC","#FFDAB9","#E6E6FA","#B5EAD7","#C7CEEA","#FFF9C4"] },
];

function isLight(hex: string) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*299+g*587+b*114)/1000 > 150;
}

function UploadZone({ onImage }: { onImage: (url: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const handle = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    onImage(URL.createObjectURL(file));
  };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
      className={`relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer aspect-[4/3]
        ${dragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border bg-muted/40 hover:border-primary/40 hover:bg-muted/60"}`}
      onClick={() => document.getElementById("file-input")?.click()}
    >
      <input id="file-input" type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }} />
      <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Upload className="w-7 h-7 text-primary" />
      </div>
      <div className="text-center px-6">
        <p className="font-medium text-foreground text-sm">Drop your room photo here</p>
        <p className="text-xs text-muted-foreground mt-1">or click to browse · JPG, PNG</p>
      </div>
    </div>
  );
}

type AppMode = "upload" | "select_walls" | "result";

export default function Index() {
  const [image, setImage] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState("#B0C4DE");
  const [intensity, setIntensity] = useState(40);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [mode, setMode] = useState<AppMode>("upload");
  const [isDetecting, setIsDetecting] = useState(false);
  const [isRecoloring, setIsRecoloring] = useState(false);
  const [regions, setRegions] = useState<WallRegion[]>([]);

  const { toast } = useToast();

  const imageToBase64 = (url: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1024 / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject("No canvas context");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = url;
    });

  const handleQuickApply = async () => {
    if (!image) return;
    setIsRecoloring(true);
    try {
      const base64 = await imageToBase64(image);
      const data = await recolorRoom({ imageBase64: base64, targetColor: selectedColor, intensity });
      if (data?.image) {
        const img = data.image.startsWith("data:")
          ? data.image
          : `data:image/jpeg;base64,${data.image}`;
        setResultImage(img);
        setMode("result");
      } else throw new Error("No image returned");
    } catch (err: any) {
      toast({ title: "Processing failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRecoloring(false);
    }
  };

  const handleDetectWalls = async () => {
    if (!image) return;
    setIsDetecting(true);
    try {
      const base64 = await imageToBase64(image);
      const data = await detectWalls({ imageBase64: base64, color: selectedColor, intensity });
      if (data?.regions?.length) {
        setRegions(data.regions);
        setMode("select_walls");
      } else {
        toast({ title: "No walls detected", description: "Try Quick Recolor instead.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Detection failed", description: err.message, variant: "destructive" });
    } finally {
      setIsDetecting(false);
    }
  };

  /**
   * Called when user clicks "Apply Recolor" in WallOverlay.
   *
   * FIXES:
   * 1. Use regions[] directly (not a separate regionsMap) — avoids stale state bug
   * 2. Fallback to selectedColor when wallColors[id] is missing
   * 3. Prefix result with data URI so <img> renders correctly
   * 4. Single recolor call for all walls with same color (no sequential calls issue)
   */
  const handleOverlayConfirm = async (
    selectedIds: string[],
    wallColors: Record<string, string>
  ) => {
    if (!image || selectedIds.length === 0) return;
    setIsRecoloring(true);

    try {
      const base64 = await imageToBase64(image);

      // Build a lookup from the current regions state (always fresh)
      const regionById: Record<string, WallRegion> = {};
      regions.forEach(r => { regionById[r.id] = r; });

      // Group selected walls by their assigned color
      const colorGroups: Record<string, string[]> = {};
      for (const id of selectedIds) {
        // wallColors[id] is set when user picks a color in the sidebar
        // Fall back to the global selectedColor if not explicitly set
        const color = (wallColors[id] && wallColors[id] !== "") ? wallColors[id] : selectedColor;
        if (!colorGroups[color]) colorGroups[color] = [];
        colorGroups[color].push(id);
      }

      // Apply each color group — one API call per unique color
      let currentBase64 = base64;

      for (const [color, ids] of Object.entries(colorGroups)) {
        const masks = ids
          .map(id => regionById[id]?.mask)
          .filter((m): m is string => Boolean(m));

        if (!masks.length) {
          console.warn("No masks found for ids:", ids);
          continue;
        }

        const data = await recolorWithMasks({
          imageBase64: currentBase64,
          masks,
          targetColor: color,
          intensity,
        });

        if (data?.image) {
          // Ensure result always has a data URI prefix for next iteration
          currentBase64 = data.image.startsWith("data:")
            ? data.image
            : `data:image/jpeg;base64,${data.image}`;
        }
      }

      setResultImage(currentBase64);
      setMode("result");

    } catch (err: any) {
      toast({ title: "Recolor failed", description: err.message, variant: "destructive" });
    } finally {
      setIsRecoloring(false);
    }
  };

  const handleDownload = () => {
    if (!resultImage) return;
    const a = document.createElement("a");
    a.download = "roomtint-result.png";
    a.href = resultImage;
    a.click();
  };

  // Back: result → select_walls (if regions exist) → upload
  const handleBack = () => {
    if (mode === "result" && regions.length > 0) {
      setResultImage(null);
      setMode("select_walls");
    } else {
      setResultImage(null);
      setRegions([]);
      setMode("upload");
    }
  };

  const handleNewImage = () => {
    setImage(null);
    setResultImage(null);
    setRegions([]);
    setMode("upload");
  };

  return (
    <div className="min-h-screen bg-background">

      <header className="sticky top-0 z-50 border-b border-border/60 bg-background/90 backdrop-blur-md">
        <div className="container max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <Paintbrush className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-display text-lg font-medium text-foreground">RoomTint</span>
              <span className="hidden sm:inline text-xs text-muted-foreground ml-2">AI Wall Color Visualizer</span>
            </div>
          </div>
          <div />
        </div>
      </header>

      <main className="container max-w-6xl mx-auto px-6 py-8">

        {mode === "upload" && !image && (
          <div className="text-center mb-10">
            <h1 className="font-display text-4xl md:text-5xl text-foreground mb-3 leading-tight">
              Reimagine Your<br /><em>Room's Color</em>
            </h1>
            <p className="text-muted-foreground text-base max-w-md mx-auto">
              Upload a photo — our AI recolors <strong>only the walls</strong>. Furniture, floors, and decor stay perfectly untouched.
            </p>
          </div>
        )}

        {/* WALL SELECTION MODE */}
        {mode === "select_walls" && image && (
          <div className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="font-display text-xl text-foreground">Select Walls to Recolor</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Click walls on the image or use the list. Hover to preview.</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleBack}>
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Back
              </Button>
            </div>
            <div className="h-[580px]">
              <WallOverlay
                imageUrl={image}
                regions={regions}
                globalColor={selectedColor}
                onConfirm={handleOverlayConfirm}
                onCancel={handleBack}
                isProcessing={isRecoloring}
              />
            </div>
          </div>
        )}

        {/* RESULT / UPLOAD MODE */}
        {mode !== "select_walls" && (
          <div className="grid lg:grid-cols-[1fr_320px] gap-6">

            <div className="space-y-4">
              {mode === "result" && resultImage && image ? (
                <>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h2 className="font-display text-xl text-foreground flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" /> Before & After
                    </h2>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={handleBack}>
                        <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                        {regions.length > 0 ? "Reselect Walls" : "Try Again"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleNewImage}>
                        <Upload className="w-3.5 h-3.5 mr-1.5" /> New Photo
                      </Button>
                      <Button size="sm" onClick={handleDownload}>
                        <Download className="w-3.5 h-3.5 mr-1.5" /> Download
                      </Button>
                    </div>
                  </div>
                  <BeforeAfterSlider beforeImage={image} afterImage={resultImage} />
                </>
              ) : isRecoloring || isDetecting ? (
                <div className="aspect-[4/3] rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center justify-center gap-4">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <Wand2 className="w-5 h-5 text-primary absolute inset-0 m-auto" />
                  </div>
                  <div className="text-center">
                    <p className="font-medium text-foreground text-sm">
                      {isDetecting ? "Detecting walls…" : "Recoloring walls…"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isDetecting ? "SAM is processing · 15–60s on CPU" : "Applying color…"}
                    </p>
                  </div>
                </div>
              ) : image ? (
                <div className="relative rounded-2xl overflow-hidden border border-border group">
                  <img src={image} alt="Room" className="w-full aspect-[4/3] object-cover" />
                  <button
                    onClick={handleNewImage}
                    className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/50 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >✕</button>
                </div>
              ) : (
                <UploadZone onImage={setImage} />
              )}

              {image && mode === "upload" && !isRecoloring && !isDetecting && (
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    variant="outline"
                    className="h-11 text-sm font-medium border-primary/30 text-primary hover:bg-primary/5"
                    onClick={handleDetectWalls}
                  >
                    <ScanSearch className="w-4 h-4 mr-2" />
                    Detect & Select Walls
                  </Button>
                  <Button className="h-11 text-sm font-medium shadow-md" onClick={handleQuickApply}>
                    <Wand2 className="w-4 h-4 mr-2" />
                    Quick Recolor
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              )}
            </div>

            {/* Right: controls */}
            <aside className="space-y-5">
              <div className="bg-card rounded-2xl border border-border p-5">
                <h3 className="font-display text-base font-medium text-foreground mb-1">Choose a Color</h3>
                <p className="text-xs text-muted-foreground mb-4">Curated palettes or pick any custom color.</p>
                <div className="space-y-4">
                  {PALETTES.map((p) => (
                    <div key={p.name}>
                      <p className="text-xs text-muted-foreground font-medium mb-2">{p.name}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {p.colors.map((c) => (
                          <button
                            key={c} onClick={() => setSelectedColor(c)} title={c}
                            className="w-8 h-8 rounded-lg transition-all duration-150 hover:scale-110 relative focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1"
                            style={{ backgroundColor: c, boxShadow: selectedColor === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : "0 1px 3px rgba(0,0,0,0.15)" }}
                          >
                            {selectedColor === c && (
                              <Check className="w-3 h-3 absolute inset-0 m-auto" style={{ color: isLight(c) ? "#333" : "#fff" }} />
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-2">Custom</p>
                    <div className="flex items-center gap-3">
                      <input type="color" value={selectedColor} onChange={(e) => setSelectedColor(e.target.value)}
                        className="w-9 h-9 rounded-lg cursor-pointer border border-border p-0.5 bg-card" />
                      <span className="text-sm font-mono text-muted-foreground uppercase">{selectedColor}</span>
                    </div>
                  </div>
                </div>
              </div>

              {image && (
                <div className="bg-card rounded-2xl border border-border p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-foreground">Color Intensity</h3>
                    <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded-md text-muted-foreground">{intensity}%</span>
                  </div>
                  <Slider value={[intensity]} onValueChange={(v) => setIntensity(v[0])} min={10} max={80} step={1} />
                  <div className="flex justify-between text-xs text-muted-foreground mt-2">
                    <span>Subtle</span><span>Bold</span>
                  </div>
                </div>
              )}

              <div className="bg-card rounded-2xl border border-border p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl shrink-0 shadow-inner" style={{ backgroundColor: selectedColor }} />
                <div>
                  <p className="text-xs text-muted-foreground">Selected Color</p>
                  <p className="text-sm font-mono font-medium text-foreground uppercase">{selectedColor}</p>
                </div>
              </div>

              {image && mode === "upload" && (
                <div className="bg-muted/50 rounded-2xl border border-border p-4 space-y-2.5">
                  <p className="text-xs font-medium text-foreground">Two ways to recolor:</p>
                  <div className="flex gap-2.5 text-xs text-muted-foreground">
                    <ScanSearch className="w-4 h-4 shrink-0 text-primary mt-0.5" />
                    <div><span className="text-foreground font-medium">Detect & Select</span> — Choose specific walls interactively</div>
                  </div>
                  <div className="flex gap-2.5 text-xs text-muted-foreground">
                    <Wand2 className="w-4 h-4 shrink-0 text-primary mt-0.5" />
                    <div><span className="text-foreground font-medium">Quick Recolor</span> — Auto-detect and recolor all walls</div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}

        {!image && mode === "upload" && (
          <div className="mt-16">
            <div className="text-center mb-8">
              <h2 className="font-display text-2xl text-foreground mb-1">See the Transformation</h2>
              <p className="text-sm text-muted-foreground">Real rooms — only the walls change.</p>
            </div>
            <GalleryGrid />
          </div>
        )}
      </main>
    </div>
  );
}

const GALLERY = [
  { label: "Living Room",  before: "/src/assets/gallery/living-before.jpg",   after: "/src/assets/gallery/living-after.jpg" },
  { label: "Bedroom",      before: "/src/assets/gallery/bedroom-before.jpg",  after: "/src/assets/gallery/bedroom-after.jpg" },
  { label: "Kitchen",      before: "/src/assets/gallery/kitchen-before.jpg",  after: "/src/assets/gallery/kitchen-after.jpg" },
  { label: "Bathroom",     before: "/src/assets/gallery/bathroom-before.jpg", after: "/src/assets/gallery/bathroom-after.jpg" },
];

function GalleryGrid() {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {GALLERY.map((g, i) => (
        <div key={g.label} className="group relative rounded-2xl overflow-hidden border border-border cursor-pointer aspect-square"
          onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
          <img src={hovered === i ? g.after : g.before} alt={g.label} className="w-full h-full object-cover transition-all duration-300" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-3">
            <p className="text-white text-xs font-medium">{g.label}</p>
            <p className="text-white/60 text-xs">{hovered === i ? "After" : "Before"}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
