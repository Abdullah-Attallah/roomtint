import { useEffect, useRef, useState } from "react";

interface ColorPreviewProps {
  imageUrl: string;
  color: string;
  intensity: number;
}

const ColorPreview = ({ imageUrl, color, intensity }: ColorPreviewProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxW = 800;
      const scale = Math.min(1, maxW / img.width);
      const w = img.width * scale;
      const h = img.height * scale;

      canvas.width = w;
      canvas.height = h;
      setDimensions({ width: w, height: h });

      // Draw original image
      ctx.drawImage(img, 0, 0, w, h);

      // Apply color overlay with multiply blend
      ctx.globalCompositeOperation = "multiply";
      ctx.globalAlpha = intensity / 100;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);

      // Restore some brightness
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = (intensity / 100) * 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);

      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    };
    img.src = imageUrl;
  }, [imageUrl, color, intensity]);

  return (
    <div className="rounded-xl overflow-hidden border border-border">
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{
          aspectRatio:
            dimensions.width && dimensions.height
              ? `${dimensions.width}/${dimensions.height}`
              : "4/3",
        }}
      />
    </div>
  );
};

export default ColorPreview;
