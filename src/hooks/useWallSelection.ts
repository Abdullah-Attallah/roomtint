import { useState, useCallback, useRef } from "react";
import type { WallSelectionState, WallColors } from "@/types";

interface UseWallSelectionReturn extends WallSelectionState {
  hover: (id: string | null) => void;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  setWallColor: (id: string, color: string) => void;
  setAllColor: (ids: string[], color: string) => void;
  isSelected: (id: string) => boolean;
  isHovered: (id: string) => boolean;
}

/**
 * Manages wall hover, selection, and per-wall colors.
 *
 * FIX (Bug #1 — globalColor override):
 * The old implementation had a useEffect that called setAllColor whenever
 * globalColor changed. This silently overwrote individually-set wall colors
 * every time the user moved the global color picker.
 *
 * Fix: globalColor is now only applied at TOGGLE time (first selection) as
 * the initial default color. After that, per-wall colors are independent.
 * The caller (WallOverlay) controls when to push globalColor to walls by
 * calling setAllColor explicitly on user intent, NOT automatically.
 */
export function useWallSelection(defaultColor = "#B0C4DE"): UseWallSelectionReturn {
  const [hoveredMaskId, setHoveredMaskId] = useState<string | null>(null);
  const [selectedMaskIds, setSelectedMaskIds] = useState<Set<string>>(new Set());
  const [wallColors, setWallColors] = useState<WallColors>({});

  // Track which walls have had a color explicitly set by the user
  // so we never clobber a manually-chosen color with globalColor
  const userSetColorsRef = useRef<Set<string>>(new Set());

  const hover = useCallback((id: string | null) => {
    setHoveredMaskId(id);
  }, []);

  const toggle = useCallback((id: string) => {
    setSelectedMaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Assign the current defaultColor only when first selected AND
        // the user hasn't already set a custom color for this wall
        setWallColors((c) => {
          if (c[id] && userSetColorsRef.current.has(id)) return c;
          return { ...c, [id]: c[id] ?? defaultColor };
        });
      }
      return next;
    });
  }, [defaultColor]);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedMaskIds(new Set(ids));
    setWallColors((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        if (!next[id]) next[id] = defaultColor;
      });
      return next;
    });
  }, [defaultColor]);

  const clearSelection = useCallback(() => {
    setSelectedMaskIds(new Set());
  }, []);

  const setWallColor = useCallback((id: string, color: string) => {
    // Mark as user-explicitly-set so globalColor pushes never override it
    userSetColorsRef.current.add(id);
    setWallColors((prev) => ({ ...prev, [id]: color }));
  }, []);

  /**
   * setAllColor — only updates walls that the user has NOT individually customized.
   * Called from WallOverlay when the user clicks "Apply global color to selected".
   */
  const setAllColor = useCallback((ids: string[], color: string) => {
    setWallColors((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        if (!userSetColorsRef.current.has(id)) {
          next[id] = color;
        }
      });
      return next;
    });
  }, []);

  const isSelected = useCallback((id: string) => selectedMaskIds.has(id), [selectedMaskIds]);
  const isHovered = useCallback((id: string) => hoveredMaskId === id, [hoveredMaskId]);

  return {
    hoveredMaskId,
    selectedMaskIds,
    wallColors,
    hover,
    toggle,
    selectAll,
    clearSelection,
    setWallColor,
    setAllColor,
    isSelected,
    isHovered,
  };
}
