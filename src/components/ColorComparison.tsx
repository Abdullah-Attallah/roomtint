import { useState } from "react";
import { X, Plus, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import ColorPalette from "@/components/ColorPalette";
import { useToast } from "@/hooks/use-toast";
import { recolorRoom } from "@/lib/api";

interface ComparisonItem {
  color: string;
  image: string | null;
  loading: boolean;
}

interface ColorComparisonProps {
  originalImage: string;
  intensity: number;
  selectedWalls: string[];
  onClose: () => void;
}

const ColorComparison = ({ originalImage, intensity, selectedWalls, onClose }: ColorComparisonProps) => {
  const [items, setItems] = useState<ComparisonItem[]>([]);
  const [pickerColor, setPickerColor] = useState("#B0C4DE");
  const { toast } = useToast();

  const imageToBase64 = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxW = 1024;
        const scale = Math.min(1, maxW / img.width);
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
  };

  const addColor = async () => {
    if (items.some((i) => i.color === pickerColor)) {
      toast({ title: "Color already added", variant: "destructive" });
      return;
    }
    if (items.length >= 4) {
      toast({ title: "Max 4 colors", description: "Remove one to add another.", variant: "destructive" });
      return;
    }

    const idx = items.length;
    setItems((prev) => [...prev, { color: pickerColor, image: null, loading: true }]);

    try {
      const base64 = await imageToBase64(originalImage);
      const data = await recolorRoom({
        imageBase64: base64,
        targetColor: pickerColor,
        intensity,
        selectedWalls: selectedWalls.length > 0 ? selectedWalls : undefined,
      });
      if (!data?.image) throw new Error("No image returned");

      setItems((prev) =>
        prev.map((item, i) => (i === idx ? { ...item, image: data.image, loading: false } : item))
      );
    } catch (err: any) {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
      setItems((prev) => prev.filter((_, i) => i !== idx));
    }
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> Compare Colors
        </h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-3">
        <ColorPalette selectedColor={pickerColor} onColorSelect={setPickerColor} />
        <Button size="sm" onClick={addColor} disabled={items.some((i) => i.loading)} className="w-full">
          <Plus className="w-4 h-4 mr-1" /> Generate with {pickerColor}
        </Button>
      </div>

      {items.length > 0 && (
        <div className={`grid gap-3 ${items.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {items.map((item, idx) => (
            <div key={item.color + idx} className="relative rounded-lg overflow-hidden border border-border">
              {item.loading ? (
                <div className="aspect-[4/3] flex items-center justify-center bg-muted">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : (
                <img src={item.image!} alt={`Room in ${item.color}`} className="w-full aspect-[4/3] object-cover" />
              )}
              <div className="absolute top-2 left-2 flex items-center gap-1 bg-foreground/70 text-primary-foreground text-xs font-mono px-2 py-1 rounded">
                <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: item.color }} />
                {item.color}
              </div>
              <button
                onClick={() => removeItem(idx)}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-foreground/70 text-primary-foreground flex items-center justify-center hover:bg-foreground/90 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Pick colors above and generate to compare side by side
        </p>
      )}
    </div>
  );
};

export default ColorComparison;
