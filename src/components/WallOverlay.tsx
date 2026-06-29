import React, { useState, useRef, useCallback, useEffect, memo } from "react";
import {
  Layers, MousePointerClick, CheckSquare, Square,
  Palette, X, Loader2, Wand2, ZoomIn, RotateCcw, Paintbrush
} from "lucide-react";
import MaskCanvas from "@/components/MaskCanvas";
import { useMaskDecoder } from "@/hooks/useMaskDecoder";
import { useWallSelection } from "@/hooks/useWallSelection";
import type { WallRegion } from "@/types";

interface WallOverlayProps {
  imageUrl: string;
  regions: WallRegion[];
  globalColor: string;
  onConfirm: (selectedIds: string[], wallColors: Record<string, string>) => void;
  onCancel: () => void;
  isProcessing?: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  wall: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  floor: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  ceiling: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

// ── Wall list item ────────────────────────────────────────────────────
const WallItem = memo(function WallItem({
  region,
  isSelected,
  isHovered,
  color,
  onToggle,
  onColorChange,
  onHover,
}: {
  region: WallRegion;
  isSelected: boolean;
  isHovered: boolean;
  color: string;
  onToggle: () => void;
  onColorChange: (c: string) => void;
  onHover: (id: string | null) => void;
}) {
  const label = region.id.replace("region_", "Wall ");
  const typeClass = TYPE_COLORS[region.type] ?? "bg-gray-500/20 text-gray-300 border-gray-500/30";

  return (
    <div
      className={`flex items-center gap-3 p-2.5 rounded-xl border cursor-pointer transition-all duration-150
        ${isSelected
          ? "border-blue-400/50 bg-blue-500/10 shadow-[0_0_12px_rgba(99,179,255,0.15)]"
          : isHovered
          ? "border-white/20 bg-white/8"
          : "border-white/8 bg-white/4 hover:border-white/15 hover:bg-white/6"
        }`}
      onClick={onToggle}
      onMouseEnter={() => onHover(region.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors
        ${isSelected ? "border-blue-400 bg-blue-500/30" : "border-white/20"}`}>
        {isSelected && <div className="w-2 h-2 rounded-sm bg-blue-300" />}
      </div>

      {isSelected && (
        <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
          <input
            type="color"
            value={color}
            onChange={(e) => onColorChange(e.target.value)}
            className="w-7 h-7 rounded-lg cursor-pointer border border-white/20 p-0.5 bg-transparent"
            title="Pick color for this wall"
          />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white font-medium truncate">{label}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${typeClass}`}>
            {region.type}
          </span>
        </div>
        {isSelected && (
          <div className="flex items-center gap-1 mt-0.5">
            <div className="w-2.5 h-2.5 rounded-sm border border-white/10" style={{ backgroundColor: color }} />
            <span className="text-[10px] font-mono text-white/40 uppercase">{color}</span>
          </div>
        )}
      </div>

      {isSelected && (
        <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 animate-pulse" />
      )}
    </div>
  );
});

// ── Main Component ────────────────────────────────────────────────────
const WallOverlay: React.FC<WallOverlayProps> = ({
  imageUrl,
  regions,
  globalColor,
  onConfirm,
  onCancel,
  isProcessing = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // FIX #6: useMaskDecoder no longer needs displayWidth/displayHeight
  // Masks decode at native resolution; scaling is handled in MaskCanvas
  const { decoded, loading: decoding } = useMaskDecoder(regions);

  const {
    hoveredMaskId, selectedMaskIds, wallColors,
    hover, toggle, selectAll, clearSelection, setWallColor, setAllColor,
    isSelected, isHovered,
  } = useWallSelection(globalColor);

  // FIX #1: globalColor no longer auto-pushes to selected walls via useEffect.
  // Instead, expose a manual "apply global to selected" button so the user
  // has full intentional control. This eliminates the override bug entirely.
  //
  // However, we DO update the defaultColor for newly-toggled walls by passing
  // globalColor to useWallSelection — that's handled inside the hook itself.

  const wallRegions = regions.filter((r) => r.type === "wall");
  const allSelected = wallRegions.length > 0 && wallRegions.every((r) => isSelected(r.id));

  const handleSelectAllWalls = useCallback(() => {
    if (allSelected) clearSelection();
    else selectAll(wallRegions.map((r) => r.id));
  }, [allSelected, wallRegions, selectAll, clearSelection]);

  // Apply global color to all selected walls that haven't been individually set
  const handleApplyGlobalColor = useCallback(() => {
    if (selectedMaskIds.size > 0) {
      setAllColor(Array.from(selectedMaskIds), globalColor);
    }
  }, [selectedMaskIds, globalColor, setAllColor]);

  const handleConfirm = () => {
    onConfirm(Array.from(selectedMaskIds), wallColors);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-0 h-full min-h-[520px] rounded-2xl overflow-hidden border border-white/10 bg-[#0d0f14] shadow-2xl">

      {/* ── Canvas area ─────────────────────────────────────── */}
      <div className="flex-1 relative" ref={containerRef}>
        {/* Toolbar */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-xs text-white/60">
            <ZoomIn className="w-3 h-3" />
            <span>Scroll to zoom</span>
            <span className="text-white/30">·</span>
            <RotateCcw className="w-3 h-3" />
            <span>Dbl-click reset</span>
          </div>
        </div>

        {/* Loading overlay */}
        {(decoding || isProcessing) && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
            <div className="relative w-12 h-12">
              <div className="w-12 h-12 rounded-full border-4 border-white/10 border-t-blue-400 animate-spin" />
              <Wand2 className="w-4 h-4 text-blue-300 absolute inset-0 m-auto" />
            </div>
            <p className="text-sm text-white/70">
              {isProcessing ? "Generating masks…" : "Loading overlays…"}
            </p>
          </div>
        )}

        {!decoding && !isProcessing && decoded.length === 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center">
            <div className="text-center text-white/40">
              <Layers className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No wall masks detected</p>
            </div>
          </div>
        )}

        <MaskCanvas
          imageUrl={imageUrl}
          masks={decoded}
          hoveredMaskId={hoveredMaskId}
          selectedMaskIds={selectedMaskIds}
          wallColors={wallColors}
          onHover={hover}
          onSelect={toggle}
          className="w-full h-full"
        />

        {decoded.length > 0 && selectedMaskIds.size === 0 && !decoding && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm border border-white/10 text-xs text-white/60">
              <MousePointerClick className="w-3 h-3" />
              Click walls to select them
            </div>
          </div>
        )}
      </div>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <div className="w-full lg:w-[260px] shrink-0 flex flex-col border-t lg:border-t-0 lg:border-l border-white/8 bg-[#0a0c10]">

        <div className="px-4 py-3 border-b border-white/8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium text-white">Wall Regions</span>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">
              {regions.length}
            </span>
          </div>
          <button onClick={onCancel} className="p-1 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/8 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {wallRegions.length > 0 && (
          <div className="px-3 pt-3 space-y-2">
            <button
              onClick={handleSelectAllWalls}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/4 hover:bg-white/8 transition-colors text-sm text-white/70 hover:text-white"
            >
              {allSelected
                ? <CheckSquare className="w-4 h-4 text-blue-400" />
                : <Square className="w-4 h-4" />
              }
              {allSelected ? "Deselect All Walls" : "Select All Walls"}
            </button>

            {/* FIX #1: Manual "apply global color" button replaces auto-override useEffect */}
            {selectedMaskIds.size > 0 && (
              <button
                onClick={handleApplyGlobalColor}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 bg-white/4 hover:bg-white/8 transition-colors text-sm text-white/70 hover:text-white"
                title="Apply the globally selected color to all selected walls"
              >
                <Paintbrush className="w-4 h-4 text-blue-400" />
                <span>Apply current color to all</span>
                <div className="ml-auto w-4 h-4 rounded border border-white/20" style={{ backgroundColor: globalColor }} />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5 min-h-0">
          {regions.length === 0 && !decoding && (
            <p className="text-xs text-white/30 text-center py-6">
              Run detection to see wall regions
            </p>
          )}
          {regions.map((r) => (
            <WallItem
              key={r.id}
              region={r}
              isSelected={isSelected(r.id)}
              isHovered={isHovered(r.id)}
              color={wallColors[r.id] ?? globalColor}
              onToggle={() => toggle(r.id)}
              onColorChange={(c) => setWallColor(r.id, c)}
              onHover={hover}
            />
          ))}
        </div>

        <div className="px-3 pb-3 pt-2 border-t border-white/8 space-y-2.5">
          {selectedMaskIds.size > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-400/20">
              <Palette className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-xs text-blue-300">
                {selectedMaskIds.size} wall{selectedMaskIds.size > 1 ? "s" : ""} selected
              </span>
            </div>
          )}
          <button
            onClick={handleConfirm}
            disabled={selectedMaskIds.size === 0 || isProcessing}
            className={`w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-150 flex items-center justify-center gap-2
              ${selectedMaskIds.size > 0 && !isProcessing
                ? "bg-blue-500 hover:bg-blue-400 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-400/30"
                : "bg-white/8 text-white/30 cursor-not-allowed"
              }`}
          >
            {isProcessing
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              : <><Wand2 className="w-4 h-4" /> Apply Recolor</>
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default WallOverlay;
