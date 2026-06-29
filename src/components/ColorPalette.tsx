import { Check } from "lucide-react";

interface ColorPaletteProps {
  selectedColor: string;
  onColorSelect: (color: string) => void;
}

const PALETTES = [
  {
    name: "Warm & Cozy",
    colors: ["#E8D5B7", "#C4956A", "#A0522D", "#8B4513", "#D2691E", "#F5DEB3"],
  },
  {
    name: "Cool & Calm",
    colors: ["#B0C4DE", "#87CEEB", "#6495ED", "#4682B4", "#5F9EA0", "#708090"],
  },
  {
    name: "Fresh & Natural",
    colors: ["#98D8C8", "#7CB342", "#558B2F", "#8BC34A", "#C5E1A5", "#E8F5E9"],
  },
  {
    name: "Bold & Modern",
    colors: ["#2C3E50", "#1A1A2E", "#16213E", "#0F3460", "#533483", "#E94560"],
  },
  {
    name: "Soft Pastels",
    colors: ["#FFD1DC", "#FFDAB9", "#E6E6FA", "#B5EAD7", "#C7CEEA", "#F0E68C"],
  },
];

const ColorPalette = ({ selectedColor, onColorSelect }: ColorPaletteProps) => {
  return (
    <div className="space-y-5">
      {PALETTES.map((palette) => (
        <div key={palette.name}>
          <p className="text-sm font-medium text-muted-foreground mb-2">
            {palette.name}
          </p>
          <div className="flex gap-2 flex-wrap">
            {palette.colors.map((color) => (
              <button
                key={color}
                onClick={() => onColorSelect(color)}
                className="w-10 h-10 rounded-lg transition-all duration-200 hover:scale-110 ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 relative"
                style={{
                  backgroundColor: color,
                  boxShadow:
                    selectedColor === color
                      ? `0 0 0 2px hsl(var(--background)), 0 0 0 4px ${color}`
                      : "var(--color-swatch-shadow)",
                }}
                title={color}
              >
                {selectedColor === color && (
                  <Check
                    className="w-4 h-4 absolute inset-0 m-auto"
                    style={{
                      color: isLightColor(color) ? "#333" : "#fff",
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div>
        <p className="text-sm font-medium text-muted-foreground mb-2">
          Custom Color
        </p>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={selectedColor}
            onChange={(e) => onColorSelect(e.target.value)}
            className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
          />
          <span className="text-sm font-mono text-muted-foreground uppercase">
            {selectedColor}
          </span>
        </div>
      </div>
    </div>
  );
};

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export default ColorPalette;
