import { useState } from "react";
import { Loader2, Lightbulb } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { recommendColors, type ColorSuggestion } from "@/lib/api";

interface ColorRecommendationsProps {
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

const ROOM_TYPES = [
  { id: "living_room", label: "Living Room", icon: "🛋️" },
  { id: "bedroom", label: "Bedroom", icon: "🛏️" },
  { id: "kitchen", label: "Kitchen", icon: "🍳" },
  { id: "bathroom", label: "Bathroom", icon: "🚿" },
  { id: "office", label: "Office", icon: "💼" },
  { id: "dining_room", label: "Dining Room", icon: "🍽️" },
];

const ColorRecommendations = ({ selectedColor, onColorSelect }: ColorRecommendationsProps) => {
  const [roomType, setRoomType] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<ColorSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const fetchRecommendations = async (type: string, color: string) => {
    setIsLoading(true);
    try {
      const data = await recommendColors({ roomType: type, currentColor: color });
      if (data?.suggestions) {
        setSuggestions(data.suggestions);
      }
    } catch (err: any) {
      toast({
        title: "Recommendation failed",
        description: err.message || "Could not get color suggestions.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRoomSelect = (type: string) => {
    setRoomType(type);
    fetchRecommendations(type, selectedColor);
  };

  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <h3 className="text-sm font-medium text-foreground flex items-center gap-2">
        <Lightbulb className="w-4 h-4 text-primary" />
        Color Recommendations
      </h3>

      <div>
        <p className="text-xs text-muted-foreground mb-2">Select your room type:</p>
        <div className="grid grid-cols-3 gap-1.5">
          {ROOM_TYPES.map((room) => (
            <button
              key={room.id}
              onClick={() => handleRoomSelect(room.id)}
              className={`px-2 py-2 rounded-lg text-xs font-medium transition-all border text-center ${
                roomType === room.id
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:border-primary/50"
              }`}
            >
              <span className="block text-base mb-0.5">{room.icon}</span>
              {room.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Getting suggestions...</span>
        </div>
      )}

      {!isLoading && suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Recommended colors:</p>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onColorSelect(s.hex)}
              className="w-full flex items-center gap-3 p-2 rounded-lg border border-border hover:border-primary/50 transition-all text-left"
            >
              <div className="w-10 h-10 rounded-lg shrink-0" style={{ backgroundColor: s.hex }} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {s.name}
                  <span className="font-mono text-xs text-muted-foreground ml-2 uppercase">{s.hex}</span>
                </p>
                <p className="text-xs text-muted-foreground truncate">{s.reason}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ColorRecommendations;
