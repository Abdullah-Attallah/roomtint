import { useState } from "react";
import { Loader2, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { detectWalls, type WallRegion } from "@/lib/api";

interface WallSelectorProps {
  imageUrl: string;
  onWallsSelected: (selectedWalls: string[]) => void;
  selectedWalls: string[];
}

const WallSelector = ({ imageUrl, onWallsSelected, selectedWalls }: WallSelectorProps) => {
  const [walls, setWalls] = useState<WallRegion[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [hasDetected, setHasDetected] = useState(false);
  const { toast } = useToast();

  const imageToBase64 = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxW = 512;
        const scale = Math.min(1, maxW / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject("No canvas context");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = url;
    });
  };

  const handleDetect = async () => {
    setIsDetecting(true);
    try {
      const base64 = await imageToBase64(imageUrl);
      const data = await detectWalls({ imageBase64: base64 });
      if (data?.walls) {
        setWalls(data.walls);
        setHasDetected(true);
        onWallsSelected(data.walls.map((w) => w.id));
      }
    } catch (err: any) {
      toast({
        title: "Wall detection failed",
        description: err.message || "Could not detect walls. All walls will be recolored.",
        variant: "destructive",
      });
    } finally {
      setIsDetecting(false);
    }
  };

  const toggleWall = (wallId: string) => {
    const newSelection = selectedWalls.includes(wallId)
      ? selectedWalls.filter((id) => id !== wallId)
      : [...selectedWalls, wallId];
    onWallsSelected(newSelection);
  };

  if (!hasDetected) {
    return (
      <div className="bg-card rounded-xl border border-border p-5">
        <h3 className="text-sm font-medium text-foreground mb-2 flex items-center gap-2">
          <MousePointerClick className="w-4 h-4 text-primary" />
          Select Specific Walls
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Let SAM detect individual walls so you can choose which ones to recolor.
        </p>
        <Button variant="outline" size="sm" className="w-full" onClick={handleDetect} disabled={isDetecting}>
          {isDetecting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Detecting walls...
            </>
          ) : (
            <>
              <MousePointerClick className="w-4 h-4 mr-2" /> Detect Walls
            </>
          )}
        </Button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
        <MousePointerClick className="w-4 h-4 text-primary" />
        Select Walls to Recolor
      </h3>
      <div className="space-y-2">
        {walls.map((wall) => (
          <button
            key={wall.id}
            onClick={() => toggleWall(wall.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all border ${
              selectedWalls.includes(wall.id)
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/50"
            }`}
          >
            <span className="font-medium">{wall.label}</span>
            {wall.description && (
              <span className="block text-xs text-muted-foreground mt-0.5">{wall.description}</span>
            )}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        {selectedWalls.length === 0
          ? "Select at least one wall"
          : `${selectedWalls.length} wall${selectedWalls.length > 1 ? "s" : ""} selected`}
      </p>
    </div>
  );
};

export default WallSelector;
