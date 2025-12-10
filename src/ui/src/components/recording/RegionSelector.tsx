import { useCallback, useEffect, useRef, useState } from "react";
import type { RegionBounds } from "../../types";

// In your types file
interface DisplayInfo {
  displayId: string;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number };
  windowBounds?: { x: number; y: number; width: number; height: number }; // Add this
}

interface SelectionRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

const MIN_SELECTION_SIZE = 50;

export default function RegionSelector() {
  const [displayInfo, setDisplayInfo] = useState<DisplayInfo | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [hoveredWindow, setHoveredWindow] = useState<RegionBounds | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cleanup = window.electronAPI.screenRecording.onRegionSelectorInit(
      (data: DisplayInfo) => {
        setDisplayInfo(data);
        console.log(`[RegionSelector] Initialized for display ${data.displayId} with scale factor ${data.scaleFactor}`)
      }
    );
    return cleanup;
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.electronAPI.screenRecording.cancelRegionSelection();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  
  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvas;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw semi-transparent overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, width, height);

    // If there's a selection, cut out the selected area
    if (selection) {
      const x = Math.min(selection.startX, selection.endX);
      const y = Math.min(selection.startY, selection.endY);
      const w = Math.abs(selection.endX - selection.startX);
      const h = Math.abs(selection.endY - selection.startY);

      // Clear the selection area
      ctx.clearRect(x, y, w, h);

      // Draw dashed border around selection
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(x, y, w, h);

      // Draw corner handles
      const handleSize = 8;
      ctx.fillStyle = "#white";
      ctx.setLineDash([]);

      // Top-left
      ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
      // Top-right
      ctx.fillRect(x + w - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
      // Bottom-left
      ctx.fillRect(x - handleSize / 2, y + h - handleSize / 2, handleSize, handleSize);
      // Bottom-right
      ctx.fillRect(x + w - handleSize / 2, y + h - handleSize / 2, handleSize, handleSize);

      // Draw dimensions label
      ctx.fillStyle = "white";
      ctx.font = "14px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      const label = `${Math.round(w)} × ${Math.round(h)}`;
      const labelY = y > 30 ? y - 10 : y + h + 20;
      ctx.fillText(label, x + w / 2, labelY);
    }

    // If hovering over a window (and not drawing), show dashed border
    if (hoveredWindow && !isDrawing && !selection) {
      const { x, y, width: w, height: h } = hoveredWindow;

      // Clear the window area
      ctx.clearRect(x, y, w, h);

      // Draw dashed border
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 5]);
      ctx.strokeRect(x, y, w, h);

      // Draw window label
      ctx.fillStyle = "#3b82f6";
      ctx.font = "bold 14px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      const labelY = y > 30 ? y - 10 : y + h + 20;
      ctx.fillText("Click to select this window", x + w / 2, labelY);
    }
  }, [selection, isDrawing, hoveredWindow]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
  const canvas = canvasRef.current;
  const overlay = overlayRef.current;
  
  if (!canvas || !displayInfo) return;

  const physicalWidth = displayInfo.bounds.width * displayInfo.scaleFactor;
  const physicalHeight = displayInfo.bounds.height * displayInfo.scaleFactor;

  canvas.width = physicalWidth;
  canvas.height = physicalHeight;

  console.log('[RegionSelector] Canvas setup:', {
    canvasInternalSize: { width: canvas.width, height: canvas.height },
    canvasCSSSize: { 
      width: canvas.getBoundingClientRect().width, 
      height: canvas.getBoundingClientRect().height 
    },
    windowSize: { width: window.innerWidth, height: window.innerHeight },
    documentSize: { width: document.body.clientWidth, height: document.body.clientHeight },
    overlaySize: overlay ? { 
      width: overlay.getBoundingClientRect().width, 
      height: overlay.getBoundingClientRect().height 
    } : null,
    displayInfo,
  });

  drawOverlay();
}, [displayInfo, drawOverlay]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !displayInfo) return;

    // Set canvas internal dimensions to match the display's physical pixels
    // This accounts for HiDPI displays (scaleFactor)
    const physicalWidth = displayInfo.bounds.width * displayInfo.scaleFactor;
    const physicalHeight = displayInfo.bounds.height * displayInfo.scaleFactor;

    canvas.width = physicalWidth;
    canvas.height = physicalHeight;

    console.log(
      `[RegionSelector] Canvas dimensions: ${canvas.width}x${canvas.height} ` +
      `(display: ${displayInfo.bounds.width}x${displayInfo.bounds.height}, scale: ${displayInfo.scaleFactor})`
    );

    // Extra debug info to help diagnose overlay sizing issues
    try {
      const rect = canvas.getBoundingClientRect();
      console.log("[RegionSelector] Canvas CSS rect:", { width: rect.width, height: rect.height, left: rect.left, top: rect.top });
      console.log("[RegionSelector] window.inner / screen / devicePixelRatio:", {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        screenX: (window as any).screenX ?? (window as any).screenLeft,
        screenY: (window as any).screenY ?? (window as any).screenTop,
        devicePixelRatio: window.devicePixelRatio,
      });
      console.log("[RegionSelector] overlay DOM rect:", overlayRef.current?.getBoundingClientRect());
    } catch (err) {
      console.warn("[RegionSelector] Failed to read DOM rects for debugging:", err);
    }

    drawOverlay();
  }, [displayInfo, drawOverlay]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // Only left click

      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      if (!canvas || !rect || !displayInfo) return;

      // Convert from CSS coordinates to canvas coordinates
      // Account for the scale factor (canvas internal size vs CSS size)
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      // If clicking on a hovered window, select it immediately
      if (hoveredWindow && !selection) {
        confirmSelection(hoveredWindow);
        return;
      }

      setIsDrawing(true);
      setSelection({
        startX: x,
        startY: y,
        endX: x,
        endY: y,
      });
      setHoveredWindow(null);
    },
    [hoveredWindow, selection, displayInfo]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      if (!canvas || !rect || !displayInfo) return;

      // Convert from CSS coordinates to canvas coordinates
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      if (isDrawing && selection) {
        setSelection((prev) =>
          prev
            ? {
                ...prev,
                endX: x,
                endY: y,
              }
            : null
        );
      }
    },
    [isDrawing, selection, displayInfo]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !selection) return;

    setIsDrawing(false);

    const width = Math.abs(selection.endX - selection.startX);
    const height = Math.abs(selection.endY - selection.startY);

    // If selection is too small, cancel it
    if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
      setSelection(null);
      return;
    }

    // Keep the selection visible for confirmation
  }, [isDrawing, selection]);

  // const confirmSelection = useCallback(
  //   (region?: RegionBounds) => {
  //     if (region) {
  //       window.electronAPI.screenRecording.confirmRegionSelection({
  //         x: region.x,
  //         y: region.y,
  //         width: region.width,
  //         height: region.height,
  //         displayId: displayInfo?.displayId,
  //         scaleFactor: displayInfo?.scaleFactor,
  //         globalOffsetX: displayInfo?.bounds.x ?? 0,
  //         globalOffsetY: displayInfo?.bounds.y ?? 0,
  //       });
  //       return;
  //     }

  //     if (!selection || !displayInfo) return;

  //     // Selection coordinates are in canvas space (physical pixels)
  //     // Convert back to screen space (logical pixels) by dividing by scaleFactor
  //     const canvasX = Math.min(selection.startX, selection.endX);
  //     const canvasY = Math.min(selection.startY, selection.endY);
  //     const canvasWidth = Math.abs(selection.endX - selection.startX);
  //     const canvasHeight = Math.abs(selection.endY - selection.startY);

  //     // Convert from canvas coordinates (physical pixels) to screen coordinates (logical pixels)
  //     const x = canvasX / displayInfo.scaleFactor;
  //     const y = canvasY / displayInfo.scaleFactor;
  //     const width = canvasWidth / displayInfo.scaleFactor;
  //     const height = canvasHeight / displayInfo.scaleFactor;

  //     console.log(
  //       `[RegionSelector] Confirming selection - Canvas: (${canvasX}, ${canvasY}, ${canvasWidth}, ${canvasHeight}), ` +
  //       `Screen: (${x}, ${y}, ${width}, ${height}), Scale: ${displayInfo.scaleFactor}`
  //     );

  //     window.electronAPI.screenRecording.confirmRegionSelection({
  //       x,
  //       y,
  //       width,
  //       height,
  //       displayId: displayInfo.displayId,
  //       scaleFactor: displayInfo.scaleFactor,
  //       globalOffsetX: displayInfo.bounds.x,
  //       globalOffsetY: displayInfo.bounds.y,
  //     });
  //   },
  //   [selection, displayInfo]
  // );

  // In RegionSelector.tsx - confirmSelection
const confirmSelection = useCallback(
  (region?: RegionBounds) => {
    if (region) {
      window.electronAPI.screenRecording.confirmRegionSelection(region);
      return;
    }

    if (!selection || !displayInfo) return;

    const canvasX = Math.min(selection.startX, selection.endX);
    const canvasY = Math.min(selection.startY, selection.endY);
    const canvasWidth = Math.abs(selection.endX - selection.startX);
    const canvasHeight = Math.abs(selection.endY - selection.startY);

    // Convert canvas coordinates to logical pixels
    const logicalX = canvasX / displayInfo.scaleFactor;
    const logicalY = canvasY / displayInfo.scaleFactor;
    const logicalWidth = canvasWidth / displayInfo.scaleFactor;
    const logicalHeight = canvasHeight / displayInfo.scaleFactor;

    // Calculate the actual position considering window offset
    // If Windows moved our window, we need to adjust coordinates
    const windowOffset = displayInfo.windowBounds ? {
      x: displayInfo.windowBounds.x - displayInfo.bounds.x,
      y: displayInfo.windowBounds.y - displayInfo.bounds.y,
    } : { x: 0, y: 0 };

    // The selection is relative to the window, but we need it relative to the display
    const displayRelativeX = logicalX - windowOffset.x;
    const displayRelativeY = logicalY - windowOffset.y;

    const regionData = {
      x: displayRelativeX,
      y: displayRelativeY,
      width: logicalWidth,
      height: logicalHeight,
      displayId: displayInfo.displayId,
      scaleFactor: displayInfo.scaleFactor,
      globalOffsetX: displayInfo.bounds.x,
      globalOffsetY: displayInfo.bounds.y,
    };

    console.log('[RegionSelector] Confirmed selection:', {
      canvas: { x: canvasX, y: canvasY, width: canvasWidth, height: canvasHeight },
      logical: { x: logicalX, y: logicalY, width: logicalWidth, height: logicalHeight },
      windowOffset,
      displayRelative: { x: displayRelativeX, y: displayRelativeY },
      final: regionData,
    });

    window.electronAPI.screenRecording.confirmRegionSelection(regionData);
  },
  [selection, displayInfo]
);

  const cancelSelection = useCallback(() => {
    if (selection) {
      setSelection(null);
    } else {
      window.electronAPI.screenRecording.cancelRegionSelection();
    }
  }, [selection]);

  const hasValidSelection =
    selection &&
    Math.abs(selection.endX - selection.startX) >= MIN_SELECTION_SIZE &&
    Math.abs(selection.endY - selection.startY) >= MIN_SELECTION_SIZE;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 select-none"
      style={{ cursor: isDrawing ? "crosshair" : "crosshair" }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />

      {/* Instructions */}
      {!selection && !isDrawing && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm text-center max-w-md">
          <div>Click and drag to select an area to record.</div>
          <div className="text-xs text-white/70 mt-1">
            Press <kbd className="bg-white/20 px-1.5 py-0.5 rounded mx-1">Esc</kbd> to cancel
          </div>
        </div>
      )}

      {/* Confirm/Cancel buttons */}
      {hasValidSelection && !isDrawing && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3">
          <button
            type="button"
            onClick={cancelSelection}
            className="px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-white rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => confirmSelection()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            Start Recording
          </button>
        </div>
      )}
    </div>
  );
}
