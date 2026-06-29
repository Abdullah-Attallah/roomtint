import { useState, useRef, useCallback } from "react";
import { GripVertical } from "lucide-react";

interface BeforeAfterSliderProps {
  beforeImage: string;
  afterImage: string;
}

const BeforeAfterSlider = ({ beforeImage, afterImage }: BeforeAfterSliderProps) => {
  const [position, setPosition] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const updatePosition = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setPosition((x / rect.width) * 100);
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    isDragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updatePosition(e.clientX);
  }, [updatePosition]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    updatePosition(e.clientX);
  }, [updatePosition]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-xl overflow-hidden border border-border select-none touch-none cursor-col-resize bg-muted"
      style={{ aspectRatio: "16/9" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* After — fills entire container */}
      <img
        src={afterImage}
        alt="After"
        className="absolute inset-0 w-full h-full object-cover"
        draggable={false}
      />

      {/* Before — same size, clipped to left of divider */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${position}%` }}
      >
        <img
          src={beforeImage}
          alt="Before"
          className="absolute inset-0 h-full object-cover"
          style={{ width: containerRef.current?.offsetWidth ?? "100%" }}
          draggable={false}
        />
      </div>

      {/* Divider */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg pointer-events-none"
        style={{ left: `${position}%`, transform: "translateX(-50%)" }}
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white shadow-xl flex items-center justify-center pointer-events-auto cursor-col-resize">
          <GripVertical className="w-4 h-4 text-gray-600" />
        </div>
      </div>

      {/* Labels */}
      <div className="absolute top-3 left-3 bg-black/60 text-white text-xs font-medium px-2.5 py-1 rounded-lg backdrop-blur-sm pointer-events-none">
        Before
      </div>
      <div className="absolute top-3 right-3 bg-primary/90 text-white text-xs font-medium px-2.5 py-1 rounded-lg backdrop-blur-sm pointer-events-none">
        After
      </div>
    </div>
  );
};

export default BeforeAfterSlider;
